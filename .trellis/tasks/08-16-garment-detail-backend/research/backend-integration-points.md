# garment-detail 后端接入点调研（backend integration points）

调研日期：2026-08-16。对应 PRD §7、§11–§17、§20。仓库：`/opt/yibai-fission`（Next.js App Router，package.json 中 `next: 16.2.6`，TS，pnpm）。

**TL;DR**：后端骨架已完全具备复用条件——`task-store.ts` 的 `retryPhotoFissionShots`/`retryPoseFissionShots`/`persistOneResult`/`resolveTaskCompletion`/`useStreamingPersist` 提供了逐 Shot 流式持久化 + 失败重跑的完整模板；`runImageEditViaProvider()` 内建计费（`recordBillingAndReturn` → `appendBillingEvent`）和熔断/故障转移；`image-provider-pool.ts` 提供 `getAvailableProvidersForModel`/`getRotatedProvidersForModel`/`getNoAvailableProviderMessage` 做模型可用性查询，且 `nano-banana-*`/`gpt-image-*`/`gemini-3*` 等模型 ID 已在 pricing、provider 兼容判断和 adapters 中注册。新增工作集中在：`normalizeGarmentDetailParams`、garment-detail 分支（buildInitialShotProgress / runTask / resolveTaskCompletion / task-recovery / retry-shots 路由）、`garment-detail-model-registry`（PRD 要求的新文件）、以及 `third-party-image-adapter.ts` 的显式分流（当前 garment-detail 会落入通用 `BackgroundReplaceParams` 路径，必须堵掉）。

---

## 1. `lib/server/task-store.ts`（2736 行）

### 1.1 顶部 imports 与 store 形态（L1–96）

```ts
import { runThirdPartyWorkflow } from '@/lib/server/third-party-image-adapter'
import { normalizeAiFashionPhotoParams } from '@/lib/server/ai-fashion-photo-service'
import { normalizePoseFissionParams, runPoseFissionPipeline } from '@/lib/server/pose-fission-service'
import { normalizePhotoFissionParams, runPhotoFissionFaceRefine, runPhotoFissionPipeline } from '@/lib/server/photo-fission-service'
import { cancelScheduledTask } from '@/lib/server/image-work-scheduler'
import { decideInterruptedTaskRecovery, shouldStartInterruptedTaskRecovery } from '@/lib/server/task-recovery'
import { downloadSafeRemoteImage, MAX_GENERATED_IMAGE_BYTES, MAX_INPUT_IMAGE_BYTES } from '@/lib/server/safe-remote-image'
import { getLocalImageForPublicUrl, getStorageAdapter, getTaskRepo, type AssetRow, type TaskRow } from '@/lib/server/storage'
import { DEFAULT_FASHION_MODEL, FEATURE_WORKFLOWS, type ... } from '@/lib/types'
import { logImageEvent, type LogContext } from '@/lib/server/log'
```

Store 是模块级全局单例（HMR 安全），挂在 `globalThis`（L52–73）：

```ts
const globalStore = globalThis as typeof globalThis & {
  fashionMvpStore?: { assets: Map<string, AssetRecord>; tasks: Map<string, GenerationTask> }
  fashionMvpTaskControllers?: Map<string, AbortController>
  fashionMvpRecoveryExecutionKeys?: Set<string>
  fashionMvpRecoveryStarted?: boolean
}
```

持久化到 `data/fashion-mvp-store.json`（原子写入），storage 抽象经 `storage() = getStorageAdapter()` / `taskRepo() = getTaskRepo()`（L114–115）。`defaultUserId = 'demo_user'`（L75）。

### 1.2 `getCredits(params: TaskParams)`（L91–96）

```ts
function getCredits(params: TaskParams) {
  if ('creditsCost' in params) return params.creditsCost
  if ('generateCount' in params) return params.generateCount
  // photo-fission（PRD v2）不计费，无 creditsCost / generateCount 字段。
  return 0
}
```

`GarmentDetailParams.creditsCost: 0` 已有该字段（types.ts L450），`getCredits` 自动返回 0，**无需改动**。在 `createTask` L641 写入 `task.creditsUsed`。注意服务端必须用 normalize 后的 params 覆盖客户端伪造的 `creditsCost`（PRD §8.7）。

### 1.3 `createTask`（L588–680）与 `normalizeTaskParams`（L682–701）

- 校验 `FEATURE_WORKFLOWS[input.featureType]` 存在（L596）。
- `normalizeTaskParams` 按 featureType 分流到 `normalizePoseFissionParams` / `normalizeAiFashionPhotoParams` / `normalizePhotoFissionParams`（L688–698），**其余原样返回**。→ garment-detail 必须在这里加 `normalizeGarmentDetailParams(params, inputAssetCount, inputAssetIds)` 分支。
- 素材存在 + 所有权校验在 L610–618（`asset.userId ?? defaultUserId !== effectiveUserId` → throw '素材不存在或无权访问'）。
- `shotProgress: buildInitialShotProgress(featureType, normalizedParams)`（L639）。
- 创建即 `console.log` 全量 params 日志（L648–667，prompt 截断 8000 字符）。
- `setTimeout(0)` 里异步 `insertTask` + `persistStore` + `runTask(taskId)`（L669–677）。

### 1.4 `buildInitialShotProgress`（L729–751）—— 需加 garment-detail 分支

```ts
function buildInitialShotProgress(featureType, params): ShotProgress[] {
  if (featureType === 'photo-fission') {
    const photoParams = params as PhotoFissionParams
    if (photoParams.childrensCategory !== 'pants') return []
    return buildPhotoFissionShotProgress(photoParams)
  }
  return []
}
```

garment-detail 应返回 `params.detailShots.map(s => ({ shotId: s.shotId, label: s.label, status: 'prompting', message: '正在准备细节图' }))`（PRD §12.1）。注意 `ensureCancellationShotProgress`（L758–764）也要认识 garment-detail，否则取消时无进度卡可标 cancelled。

### 1.5 `runTask`（L881–1084）—— 流式持久化与 targetUnitIds

关键段落：

```ts
interface RunTaskOptions { targetUnitIds?: string[]; recoveryExecutionKey?: string }  // L867
```

- 终态跳过 + `recoveryExecutionKey` 幂等校验（L889–899）。
- 初始 shotProgress 重置只对 `targetUnitIdSet` 内成员生效（L916–921）。
- `preferUrlPassthrough = taskTargetsGeminiFamily(task)`（L946）→ `resolveAssetToDataUrl(asset, { preferUrlPassthrough })`（L953）。garment-detail 走 Gemini 系时需加入 `taskTargetsGeminiFamily`（见 §1.8）。
- **useStreamingPersist**（L958–976）：

```ts
const isPhotoFission = task.featureType === 'photo-fission'
const isPoseFission = task.featureType === 'pose-fission'
const useStreamingPersist = isPhotoFission || isPoseFission   // ← 需加 garment-detail

const onShotResult = useStreamingPersist
  ? async (result: ResultAsset) => {
      assertTaskNotCancelled(taskId, controller.signal)
      await persistOneResult(taskId, result, ownerUserId)
      persistedResults.push(result)
      updateShotProgress(taskId, result.shotId ?? result.assetId, { status: 'success', message: '已生成' })
    }
  : undefined
```

- pose-fission 直连 `runPoseFissionPipeline({... targetPoseIds: targetUnitIds })`（L983–993）；其余走 `runThirdPartyWorkflow({... onShotResult, targetShotIds: targetUnitIds })`（L998–1016）。**garment-detail 建议像 pose-fission 一样直连 `runGarmentDetailPipeline`**，避免 `runThirdPartyWorkflow` 的 BackgroundReplace 通用路径（PRD §20.3 明确要求 adapter 显式分流）。
- 完成后 `finalResults = mergeResultsByAssetId(task.results, store...results)`（L1022–1027，流式分支），然后 `resolveTaskCompletion(task, finalResults)`（L1032），shotProgress 无匹配结果的标 `failed`（L1033–1043）。
- catch 分支：已 cancelled 则全部 shot 标 cancelled 返回（L1055–1058）；否则 `resolveTaskCompletion` 决定 partial/failed（L1059–1077）。

### 1.6 `persistOneResult(taskId, result, ownerUserId = defaultUserId)`（L1095–1176）

```ts
async function persistOneResult(taskId: string, result: ResultAsset, ownerUserId: string = defaultUserId)
```

- 幂等：`assetId` 已存在则 return（L1101–1103）。
- `persistSemaphore.runExclusive` 包住「下载 4K → sharp → OSS」段，waitMs>50 记 `gimg.persist` 日志（L1113–1122）。→ PRD §11.3「继续复用现有结果持久化信号量」= 这个。
- 回填 `result.url/downloadUrl/width/height/thumbnailUrl`（L1123–1127）。
- 登记 `AssetRecord`（`taskId` 关联，L1129–1141）+ `taskRepo().insertAsset(buildAssetRow(..., { kind: 'generated', ... }))`（L1143–1149）。
- 进度公式 `min(95, 72 + floor(len/plannedCount*23))`，plannedCount 取 `params.resultCount ?? 1`（L1162–1168）→ garment-detail normalize 必须写 `resultCount`。
- `label`/`shotId`/`finalPrompt`/`metadata` 由 pipeline 在 ResultAsset 上预填（photo-fission 模式见 §1.11），persistOneResult 不抹掉它们。

### 1.7 `resolveTaskCompletion(task, results)`（L1208–1236）—— 需加 garment-detail 分支

现有 photo-fission / pose-fission 分支：`planned = params.resultCount ?? params.shotPlan?.length ?? results.length`，`results.length < planned` → `{ status: 'partial', message: ... }`，否则 success。garment-detail 分支：`planned = params.detailShots.length ?? params.resultCount`（PRD §12.4）。

### 1.8 `taskTargetsGeminiFamily(task)`（L1582–1591）—— 需加 garment-detail 判断

```ts
function taskTargetsGeminiFamily(task: GenerationTask): boolean {
  if (task.featureType === 'photo-fission' || task.featureType === 'pose-fission') return true
  if (task.featureType === 'ai-fashion-photo') {
    const model = (task.params as AiFashionPhotoParams).model ?? DEFAULT_FASHION_MODEL
    return model.startsWith('gemini-')
  }
  return false
}
```

garment-detail 的 `resolvedModelId` 以 `nano-banana-`/`gemini-` 开头时应返回 true（OSS URL 透传，PRD §11.3）；`gpt-image-2` 走 OpenAI 兼容渠道需 base64，应返回 false。

### 1.9 `retryPhotoFissionShots(taskId, shotIds, userId?)`（L1722–1854）—— retryGarmentDetailShots 的直接模板

完整结构（6 步）：

1. **存在性 + ownership**（L1729–1743）：task 不存在 throw '任务不存在'；`userId` 传入且不匹配（且非 super-admin bypass）也 throw '任务不存在'（不暴露存在性）。
2. **featureType + status 门禁**（L1744–1749）：`task.featureType !== 'photo-fission'` throw；`status` 仅允许 `'partial' | 'failed'`。
3. **计划校验**（L1751–1775）：`params.shotPlan` 必须非空；`plannedShotIds = new Set(shotPlan.map(s => s.shotId))`；`alreadySucceededShotIds` 从 `task.results[].shotId` 收集；去重后逐个校验「在计划中」且「未成功」，否则 throw。
4. **标 running**（L1778–1782）：`updateTask({ status: 'running', progress: 72, message })`。
5. **重建输入 + 调 pipeline**（L1784–1814）：从 `task.inputAssetIds` 经 `resolveAssetToDataUrl(asset, { preferUrlPassthrough: true })` 还原 inputImages；空则 throw '原任务参考图已丢失'；然后

```ts
await runPhotoFissionPipeline({
  userId: ownerUserId, taskId, inputImages, faceMaskImage, params,
  apiKey: process.env.GOOGLE_API_KEY ?? '',
  timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
  targetShotIds: uniqueShotIds,
  onShotResult: async (result) => { await persistOneResult(taskId, result, ownerUserId) },
})
```

6. **收尾**（L1815–1853）：pipeline 抛错 → 按当前 results 重新 `resolveTaskCompletion`，results 空 → 'failed' + '重跑失败镜头全部失败'，否则 partial/success；成功路径最终 `resolveTaskCompletion(finalTask, finalTask.results)` 收尾，`status==='success'` 时清 errorMessage。

**`retryPoseFissionShots(taskId, poseIds, userId?)`（L2097–2223）结构完全相同**，差异仅在：planned 集合来自 `params.poses.map(p => p.id)`，pipeline 是 `runPoseFissionPipeline({... targetPoseIds: uniquePoseIds })`，**无 signal 传入**（注意：retry 路径两个函数都没传 `AbortController.signal`，取消依赖 `assertTaskNotCancelled` 只在 runTask 主路径；retry 期间 cancel 只会改状态不中断请求——既有行为，garment-detail 如要传 signal 需自建 controller 并登记到 `runningTaskControllers`）。

**`retryGarmentDetailShots` 需要的差异点**：
- planned 集合 = `(task.params as GarmentDetailParams).detailShots.map(s => s.shotId)`（`detail_1`–`detail_3`）。
- 输入图重建要按 shot 区分角色：`inputAssetIds[0]` 主图 + 每个 shot 的 `referenceAssetId`（不能简单把全部 inputImages 传给每个 shot，PRD §5.2）。建议 garment-detail pipeline 内部自己按 `referenceAssetId` 取图，retry 只传主图 + params + `targetShotIds`。
- 模型固定用任务快照 `params.resolvedModelId`（PRD §6.3.6），不能像现有代码那样用 env 默认模型。
- 错误消息文案换成「细节图」语义。

### 1.10 `cancelTask(taskId, userId?)`（L542–586）

- throw '任务不存在'（不存在或越权）；非 pending/running throw '当前任务状态不允许取消'。
- `cancelScheduledTask(taskId, '任务已手动取消')` + `runningTaskControllers.get(taskId)?.abort()`（L563–564）。
- shotProgress：已成功或已有结果的标 success，其余标 cancelled（L575–580）。结果保留（PRD §12.3「用户取消任务时保留已成功结果」已满足）。对 garment-detail 无改动需求，只要 shotProgress 初始化/恢复分支认识该 feature。

### 1.11 `deleteResultFromTask(taskId, assetId, userId?)`（L2619–2705）

- 越权/不存在 → return false（L2626–2638）。
- 从 `results`/`resultAssetIds` 摘除；删空则整 task 删除（L2657–2671）。
- `store.assets.delete(assetId)` + repo.deleteAsset + persistStore（L2673–2679）。
- 物理删除 best-effort：`extractOssKeyFromUrl` 提 key → `storage().deleteImage`，并同步删 `_thumb.webp` 缩略图（L2683–2702，`deriveThumbnailKey` 在 L1696）。

对 garment-detail 开箱即用（结果删除后 shotProgress 不回退——既有行为；PRD 集成测试「删除单张结果后任务数据同步更新」由本函数满足）。

### 1.12 结果 enrich 参考（photo-fission-service.ts L2056–2064）

```ts
const enriched: ResultAsset = {
  ...first,
  assetId: `result_${taskId}_${shot.shotId}${resultAssetIdSuffix ? `_${resultAssetIdSuffix}` : ''}`,
  label: shot.label,
  shotId: shot.shotId,
  finalPrompt: shot.prompt,
}
```

garment-detail pipeline 应仿此在 ResultAsset 上写入 `label` / `shotId` / `finalPrompt` / `metadata`（PRD §13 要求的 metadata 字段全在 params + shot 上可得）。assetId 命名带 shotId 便于幂等。

### 1.13 服务重启恢复（task-store L1404–1485 + task-recovery.ts）

`recoverInterruptedTasks()` 遍历所有 task → `decideInterruptedTaskRecovery(task, MAX_TASK_RECOVERY_ATTEMPTS)` → recover 时重置 pending + 写 `recoveryAttempts/lastRecoveredAt/recoveryExecutionKey`，`setTimeout(0)` 里 `runTask(taskId, { targetUnitIds, recoveryExecutionKey })`（幂等键防同批重复启动）。**task-recovery.ts 必须加 garment-detail 分支**（见 §8）。

---

## 2. `lib/server/provider-image-router.ts`（355 行）—— `runImageEditViaProvider`

### 签名（L26–52）

```ts
export interface ProviderImageEditInput {
  userId: string
  taskId: string
  provider: ImageProvider            // 来自 provider pool，含 type/apiKey/baseUrl/model/maxIpm/maxRpm/timeoutMs
  fallbackApiKey?: string            // provider.apiKey 为空时使用
  model: string
  prompt: string
  inputImages: string[]              // dataURL 或公开 URL（Gemini 系可 URL 透传）
  inputImageLabels?: string[]        // 与 inputImages 一一对应（Gemini 会把标签放在对应图前）
  count: number
  aspectRatio?: string               // 如 '1:1'
  imageSize?: string                 // 如 '1K'/'2K'/'4K'（大写）
  traceId?: string
  shotId?: string
  signal?: AbortSignal
  onRetryAttempt?: (attempt: number) => void
}

export async function runImageEditViaProvider(input: ProviderImageEditInput): Promise<ResultAsset[]>
```

### 行为

- `resolveImageSize(input.aspectRatio, input.imageSize)`（L56，见 §5 注）。
- `beginProviderRequest(provider.id)` 返回 null 表示熔断/半开探测中 → throw `GoogleImageError({ category: 'server_error', message: '生图渠道 X 当前处于熔断或半开探测状态，请稍后重试', retryable: true })`（L58–65）。
- `switch (provider.type)`：`laozhang` / `grsai` / `openai` / `jimeng` / `volces` / `google`(default)（L69–251）。每个 case 用 **`recordBillingAndReturn(provider.id, model, taskId, adapterPromise)` 包裹**——计费 hook 在 router 内部，调用方无需重复记录（L288–303）：

```ts
async function recordBillingAndReturn(providerId, model, taskId, resultPromise) {
  const results = await resultPromise
  appendBillingEvent({ model, count: results.length, providerId, taskId }).catch(() => undefined)  // 静默
  return results
}
```

注意：`recordBillingAndReturn` 目前**不传 `featureType`**（BillingEvent 有可选 `featureType` 字段，billing-store.ts L39/L165，但 router 没填）。PRD §17.2 只要求记录 provider/模型/次数/taskId/成功数——现有调用已满足；若想按功能维度统计，需给 `ProviderImageEditInput` 加 `featureType` 并透传。

- 失败时 `finishProviderRequest(token, { category: classifyProviderFailure(error) })`（L256–258），分类逻辑 L263–280（rate_limit/auth_failed/timeout/server_error/other_failure），并 `withUpstreamErrorContext` 包装成带渠道 ID 和建议文案的 GoogleImageError（L305–328）。
- 错误类型统一为 `GoogleImageError`（来自 `google-image-retry.ts`，含 `category/httpStatus/retryable/retryAfterSeconds/finishReason/blockReason`）。

**garment-detail 调用形态**（PRD §11.2）：`{ count: 1, inputImages: reference ? [main, ref] : [main], aspectRatio: params.imageRatio, imageSize: params.resolution.toUpperCase(), model: params.resolvedModelId, signal, shotId }`。注意 grsai 渠道 `nano-banana-2-lite` 传 2K/4K 可能报错（grsai-image-adapter.ts L46/L296 注释 + `RESOLUTION_AWARE_MODEL_PATTERNS` L49/L339 把 lite 单独排除）——与 PRD §5.4「标准版仅 1K」一致。

---

## 3. `lib/server/image-provider-pool.ts`（966 行）—— 模型可用性查询

### Provider 声明与模型兼容

`ImageProvider`（L32–55）：`{ id, type: 'google'|'openai'|'jimeng'|'volces'|'laozhang'|'grsai', apiKey, baseUrl?, model?, maxIpm, maxRpm, maxConcurrency?, weight, enabled, timeoutMs }`。Pool 从 `IMAGE_PROVIDERS` JSON 或单渠道 env（`GOOGLE_API_KEY`、`QINIU_IMAGE_API_KEY`、`GRSAI_API_KEY` 等）构造（文件头注释 L5–13；单渠道默认模型 L189 `GOOGLE_IMAGE_MODEL ?? 'gemini-3.1-flash-image-preview'`、L208 `QINIU_IMAGE_MODEL ?? 'openai/gpt-image-2'`）。

**模型兼容判断是字符串前缀匹配**（L542–627）：

| 函数 | 接受的模型前缀 |
| --- | --- |
| `isGoogleImageModel` (L542) | `gemini-` |
| `isQiniuImageModel` (L547) | `gemini-`、`gpt-image-`、`openai/gpt-image-` |
| `isLaozhangImageModel` (L577) | `gemini-`、`gpt-image-`、`openai/gpt-image-`、`doubao`、`seedream` |
| `isGrsaiImageModel` (L593) | **`nano-banana-` 只接受这个系列** |
| `isJimengImageModel` (L565) | `jimeng` |
| `isVolcesImageModel` (L571) | `doubao`/`seedream`/`volces`（且 model 需与 provider.model 归一化后相等） |

`isImageProviderModelCompatible(provider, model)`（L606–627）：`candidate = model || provider.model`；openai 类型还要求 qiniu 家族一致（gemini vs gpt，L614–616）。

### 「模型 X 是否有可用渠道」API

```ts
export function getAvailableProviders(): ImageProvider[]                          // L537：排除 enabled=false/无 key/熔断中
export function getAvailableProvidersForModel(model: string | undefined): ImageProvider[]  // L633：可用 ∩ 兼容；有 console.log 调试输出
export function getRotatedProvidersForModel(model: string | undefined): ImageProvider[]    // L671：去重凭证链 + 起点轮转（cursor++），适合单图逐个 failover
export function getNoAvailableProviderMessage(model: string | undefined): string           // L687：gpt-image-* 有专门长文案
export function getFailoverProviderForModel(excludeProviderIds: string[], model): ImageProvider | null  // L809
export function getProviderHealthSnapshot(): ProviderHealthEntry[]                 // L488：含 available/circuitOpen/circuitRemainMs
```

熔断：`tripProviderCircuit(providerId, category, durationMs)`（L312，auth_failed 默认 5min、基础设施故障默认 60s，按凭证组熔断）；`beginProviderRequest`/`finishProviderRequest`（L352/L372）由 router 调用。`isProviderAvailable`（L298，内部）：`enabled && apiKey && 不在熔断窗口 && 非半开探测占用`。

**`garment-detail-model-registry` 的实现路径**：遍历候选模型，`getAvailableProvidersForModel(modelId).length > 0`（或 `getRotatedProvidersForModel`）即视为可用；全部不可用 → `MODEL_UNAVAILABLE`（文案可复用 `getNoAvailableProviderMessage`）。

### 已知模型 ID 出现位置

- `lib/types.ts` L104–113：`FashionModelId` 联合类型含全部 6 个（`gemini-3.1-flash-image-preview`、`gemini-3-pro-image-preview`、`gpt-image-2`、`nano-banana-2-lite`、`nano-banana-2`、`nano-banana-pro`）。
- `lib/server/billing/pricing.ts` L10–37：单价表全有；L45–52 `ACTIVE_MODEL_IDS` 白名单。
- `lib/server/grsai-image-adapter.ts` L18–21/L49：nano-banana 系列分辨率能力注释。
- `lib/server/openai-image-adapter.ts` L309–326：gemini-*/gpt-image-*/seedream-*/doubao-* 分流。
- `lib/server/laozhang-image-adapter.ts` L10–14、`docs/LAOZHANG_API_SETUP.md` L17–26、`components/billing/shared.ts` L56–61（前端展示名）。

---

## 4. 计费：`lib/server/billing/pricing.ts` + `billing-store.ts`

### `pricing.ts`（98 行）

- `MODEL_UNIT_PRICE_USD: Record<string, number>`（L10–37，键小写）：6 个目标模型全在表内。
- `export function getUnitPriceUsd(model: string): number`（L73–85）：直接命中 → `MODEL_ID_MAPPING` 映射（豆包别名）→ 回退 `DEFAULT_UNIT_PRICE_USD = 0.055`（L55）。
- `ACTIVE_MODEL_IDS`（L45–52）+ `getAllModelPrices()`（L93）供前端单价表展示。
- **featureType→pricing 映射不存在**：计费按模型单价 × 张数，不区分 feature。PRD §20.2 说 pricing.ts「仅补统计映射」——实际 6 个模型都已有单价，**零成本功能无需改动 pricing.ts**；若要在账单上按 feature 拆分，改动点在 billing-store 的 `BillingEvent.featureType`（已存在，可选）+ router 透传（见 §2）。

### `billing-store.ts`（408 行）

```ts
export async function appendBillingEvent(input: {
  model: string; count: number; providerId: string; taskId: string; featureType?: string
}): Promise<void>   // L160–202
```

- 进程内 Map（按日分组）+ `data/billing-events.jsonl` 追加；**失败静默，绝不影响生图**（L158/L199 注释）。
- `BillingEvent`（L17–40）含 `unitPriceUsd/totalUsd/providerId/taskId/featureType?`。
- 查询：`getTodayBilling()`（L207）、`getBillingSummaryByRange(start, end, channel)`（L310，channel 按 providerId 前缀 `grsai`/`laozhang` 过滤）、`getBillingEventsByDate`（L398）。
- 用户侧积分：无独立扣费系统——`creditsUsed` 只是任务字段（`getCredits`，§1.2），garment-detail `creditsCost: 0` 自然零扣费。

---

## 5. 错误响应与日志

### `lib/server/api-error-response.ts`（49 行）

```ts
export function jsonErrorResponse(error: unknown, status: number, fallback = '未知错误')
```

- `error instanceof GoogleImageError` → `{ error, source: 'upstream', code: error.category, advice, upstreamStatus }`（L32–43）。
- 其他 → `{ error: message }`（L45–48）。

**注意：现有响应没有 PRD §16 要求的 `retryable` / `requestId` 字段**，`code` 用的是 GoogleImageError.category（如 `rate_limit`），不是 PRD 的业务错误码（`RESOLUTION_UNSUPPORTED` 等）。garment-detail 路由需要自己的结构化错误 helper（或在现有基础上扩展），例如 `{ error, code: 'RESOLUTION_UNSUPPORTED', retryable: false }`。上游错误分类可参考 router 的 `classifyProviderFailure`（provider-image-router.ts L263）+ `GoogleImageError.retryable`。

### `lib/server/log.ts`（76 行）

```ts
export type ImageEventName = 'gimg.attempt' | 'gimg.success' | 'gimg.fail' | 'gimg.retry'
  | 'gimg.throttle' | 'gimg.persist' | 'pool.dispatch' | 'pool.failover' | 'pool.circuit'
  | 'face.blur' | 'face.blur-fallback' | 'volces.request' | 'volces.success'
  | 'volces.output_format_fallback' | 'volces.batch_complete'

export interface LogContext { traceId: string; taskId: string; shotId?: string; attempt?: number }

export function logImageEvent(evt: ImageEventName, ctx: LogContext, payload: Record<string, unknown> = {}): void  // L52
```

- JSON-line；error/warn → stderr，info → stdout（L68–75）。
- **PRD §17.3 的 `garment_detail.*` 事件不在 ImageEventName 联合类型里**——要么扩 union + `eventLevel` 表（L34–50），要么 garment-detail 用自己的 logger。现有 task 创建日志是直接 `console.log(JSON.stringify({ evt: 'task.created', ... }))`（task-store L655），不走 logImageEvent，也是一种可行模式。

### 附：`resolveImageSize(ratio, resolution)`（image-size-policy.ts L96）

返回 `{ ratio, resolution, width, height, size: 'WxH', pixels }`；resolution 归一化为大写 tier（L116–119 `trim().toUpperCase()`）。ratio 预设表含 `1:1/3:4/4:3` 等（garment-detail 三个比例全覆盖）。

---

## 6. `lib/types.ts`（896 行）

### `ShotProgressStatus` / `ShotProgress`（L44–58）

```ts
export type ShotProgressStatus = 'prompting' | 'generating' | 'retrying' | 'success' | 'failed' | 'cancelled'
export interface ShotProgress {
  shotId: string
  label: string
  status: ShotProgressStatus
  message: string
  retryAttempt?: number
}
```

### `ResultAsset`（L165–178）—— PRD §13 所需字段全有

```ts
export interface ResultAsset {
  assetId: string
  url: string
  downloadUrl: string
  width: number
  height: number
  kind?: 'generated'
  label?: string
  shotId?: string
  finalPrompt?: string
  metadata?: Record<string, unknown>
  thumbnailUrl?: string
}
```

✅ `label` / `shotId` / `finalPrompt` / `thumbnailUrl` / `metadata` 全部存在，无需改类型。

### `GenerationTask`（L184–223）

```ts
export interface GenerationTask {
  taskId: string
  userId?: string
  featureType: FeatureType
  workflowId: string
  inputAssetIds: string[]
  inputAssets?: AssetRecord[]        // hydrate 时填充
  params: TaskParams
  status: TaskStatus                  // 'pending'|'running'|'success'|'failed'|'partial'|'cancelled' (L36)
  progress: number
  message: string
  resultAssetIds: string[]
  results: ResultAsset[]
  shotProgress?: ShotProgress[]
  queuePosition?: number; estimatedStartAt?: string
  activeUnits?: number; completedUnits?: number; totalUnits?: number
  schedulerState?: ImageSchedulerState
  recoveryAttempts?: number           // L214
  lastRecoveredAt?: string
  recoveryExecutionKey?: string       // L218 幂等键
  errorMessage?: string
  createdAt: string
  finishedAt?: string
  creditsUsed: number
}
```

### garment-detail 已有类型（L383–453）

`FeatureType` 已含 `'garment-detail'`（L9）；`TaskParams` union 已含 `GarmentDetailParams`（L381）。现有定义：

```ts
export type GarmentDetailCategory = 'tops' | 'bottoms' | 'dress' | 'accessory' | 'shoes-bags'   // L390
export const GARMENT_DETAIL_CATEGORIES = [...]                                                // L397
export type GarmentDetailTier = 'standard' | 'professional'                                   // L406
export type GarmentDetailResolution = '1k' | '2k' | '4k'                                      // L407
export type GarmentDetailRatio = '1:1' | '3:4' | '4:3'                                        // L409
export const GARMENT_DETAIL_MAX_REFERENCES = 3                                                // L418
export const GARMENT_DETAIL_PROMPT_MAX = 103                                                  // L420

export interface GarmentDetailShot {                                                          // L426
  shotId: string
  label: string
  referenceAssetId: string | null
}

export interface GarmentDetailParams {                                                        // L434
  category: GarmentDetailCategory
  algorithmModelId: string
  algorithmModelName: string
  modelTier: GarmentDetailTier
  resolution: GarmentDetailResolution
  imageRatio: GarmentDetailRatio
  userPrompt: string
  aiAppendDescription: boolean
  referenceImageCount: number
  detailShots: GarmentDetailShot[]
  resultCount: number
  creditsCost: 0
  mockRetryCount?: number       // 仅 mock 用；后端接入后可保留但服务端 normalize 应忽略/剥离
}
```

**PRD §20.3 要加的可选字段 `resolvedModelId`、`promptTemplateVersion` 尚不存在**，需加入 `GarmentDetailParams`。

### `FEATURE_WORKFLOWS`（L870–875）

```ts
export const FEATURE_WORKFLOWS: Record<FeatureType, string> = {
  'ai-fashion-photo': 'ai_fashion_photo_v1',
  'photo-fission': 'photo_fission_v1',
  'pose-fission': 'pose_fission_v1',
  'garment-detail': 'garment_detail_mock_v1',   // ← PRD §20.3：改为 'garment_detail_v1'
}
```

`FEATURE_LABELS`（L877–882）与 `FEATURES` 数组（L505–536，garment-detail `credits: 0, status: 'available'`）已就绪。`DEFAULT_FASHION_MODEL = 'gemini-3.1-flash-image-preview'`（L819）。

---

## 7. API 路由

### `app/api/tasks/route.ts`（130 行）

- `GET`：`requireUser` → `listTasks({ userId })` → featureType 过滤 + 分页（offset/limit，默认 20 上限 100）→ `withTaskScheduling` 包装（L45–75）。
- `POST`：`requireUser` → 校验 `featureType/inputAssetIds/params` → `featureIds`（来自 `FEATURES`）白名单 → `assertImageQueueCapacity(estimateTaskUnits(featureType, params))` → `createTask({ featureType, inputAssetIds, params, userId })` → 返回 `{ taskId, status }`（L77–129）。
- `estimateTaskUnits`（L19–37）：photo-fission 看 `shotPlan.length`，pose-fission 看 `poses.length`，其余看 `resultCount/generateCount`。**garment-detail 的 `detailShots.length` 会落到通用 `resultCount` 分支——normalize 后 resultCount = detailShots.length，行为正确**，但若要精确可在该函数加分支。
- `ImageQueueFullError` 返回 `{ error, code, retryAfterSeconds }` + `Retry-After` 头（L111–123）——是现有「结构化 code」的唯一先例。
- 创建失败的错误只返回 `{ error }` 400（L125–128）；garment-detail 的 `INVALID_PARAMS`/`ASSET_NOT_FOUND`/`MODEL_UNAVAILABLE`/`RESOLUTION_UNSUPPORTED` 需要在 normalize/createTask 抛错处携带 code（可抛自定义 Error 子类并在路由映射，或路由内按 featureType 捕获）。

### `app/api/tasks/[taskId]/route.ts`（29 行）

`GET`：`requireUser` → `getTask(taskId, { userId })`（ownership 不匹配返回 undefined → 统一 404 '任务不存在'，L20–26）→ `withTaskScheduling(task)`。**`getTask` 内部 `hydrateTaskInputAssets`**（task-store L858–865）：

```ts
function hydrateTaskInputAssets(task: GenerationTask): GenerationTask {
  return { ...task, inputAssets: task.inputAssetIds.map((id) => store.assets.get(id)).filter(Boolean) }
}
```

→ PRD §13「任务查询必须继续 hydrate `inputAssets`」已自动满足（`task.inputAssets[0].fileUrl` = 主图，供原图对比）。

### `app/api/tasks/[taskId]/cancel/route.ts`（28 行）

`POST`：`requireUser` → `cancelTask(taskId, userId)` → 200 返回 task；异常统一 400 `{ error }`（没有区分 404；cancelTask 越权时 throw '任务不存在' 也走 400）。

### `app/api/tasks/[taskId]/retry-shots/route.ts`（63 行）—— 需加 garment-detail 分支

```ts
const task = await retryPhotoFissionShots(taskId, shotIds, userId)   // L54 当前唯一分支
```

body 校验 `{ shotIds: string[] }` 非空（L41–51）；错误映射：message 含 '任务不存在'/'丢失' → 404，否则 400，经 `jsonErrorResponse`（L56–62）。**改造方式**：先 `getTask(taskId, { userId })` 拿 featureType 再分流 `retryPhotoFissionShots` / `retryGarmentDetailShots`（注意别改变越权 404 语义——retry 函数内部已做 ownership 校验，路由侧 getTask 只是分流用）。

### `app/api/tasks/[taskId]/results/[assetId]/route.ts`（41 行）

`DELETE`：`requireUser` → `deleteResultFromTask(taskId, assetId, userId)` → false → 404 '未找到对应的生成结果'；true → `{ success: true }`。

### 鉴权

`requireUser(request)`（lib/server/auth/require-user.ts L82）：`Promise<RequestUser | NextResponse>`；未登录返回 401 `{ ok: false, error: 'UNAUTHORIZED' }`。用法固定：

```ts
const userResult = await requireUser(request)
if (userResult instanceof NextResponse) return userResult
const { userId } = userResult
```

所有路由 `export const runtime = 'nodejs'`。

---

## 8. 服务重启恢复：`lib/server/task-recovery.ts`（107 行）

```ts
export type TaskRecoveryDecision =
  | { kind: 'ignore' }
  | { kind: 'complete' }
  | { kind: 'fail'; reason: string }
  | { kind: 'recover'; attempt: number; executionKey: string; targetUnitIds: string[] }

export function decideInterruptedTaskRecovery(task: GenerationTask, maxAttempts: number): TaskRecoveryDecision  // L55
```

- 非 pending/running → ignore（L59）。
- **非 photo-fission/pose-fission → `fail`**（L63–68）：'服务重启时无法安全判断单张任务是否已在上游生成…'。**garment-detail 必须加入允许列表**（L63 的 `!==` 判断 + `getPlannedUnitIds` L33–49 加 `detailShots.map(s => s.shotId)` 分支）。
- planned 为空或有重复 id → fail（L71–80）。
- `targetUnitIds = planned - completed(results[].shotId)`（L82–90）；空 → complete。
- `attempts >= maxAttempts` → fail（L92–98）。
- `executionKey = ${taskId}:recovery:${attempt}:${targetUnitIds.join(',')}`（L103）——幂等键与 PRD §15「恢复执行必须具备幂等键」对应。
- `shouldStartInterruptedTaskRecovery(nodeEnv, alreadyStarted)`（L22）：仅 production 冷启动一次。

`MAX_TASK_RECOVERY_ATTEMPTS` 在 task-store 中定义（recoverInterruptedTasks L1429 使用），恢复后标 partial/failed 的逻辑在 L1445–1454。

---

## 9. 测试与工程命令

### package.json scripts（无 test 脚本）

```json
"scripts": {
  "dev": "next dev -H 0.0.0.0",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit"
}
```

**没有 vitest/jest，没有 `pnpm test`**。测试用 Node 原生 test runner 直接跑 TS：`node --test lib/server/task-recovery.test.ts`（本任务 info.md L90–92 确认命令形态）。现有测试文件：`lib/server/task-recovery.test.ts`、`lib/server/pose-fission-service.test.ts`、`lib/server/grsai-image-adapter.test.ts`、`lib/server/aliyun-cutout-adapter.test.ts`、`lib/server/asset-cutout-service.test.ts`、`lib/server/cutout-session-service.test.ts`、`lib/server/image-provider-metrics.test.ts`、`lib/server/image-work-scheduler.test.ts`、`lib/garment-detail-mock.test.ts`。

### 测试写法约定（task-recovery.test.ts L1–7 / garment-detail-mock.test.ts L1–12）

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import type { GenerationTask, PhotoFissionParams, PoseFissionParams } from '../types.ts'
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { decideInterruptedTaskRecovery, shouldStartInterruptedTaskRecovery } from './task-recovery.ts'
```

**坑（AGENTS.md 已记录）**：
1. 运行时 import 必须带 `.ts` 扩展名 + `// @ts-expect-error` 注释，否则 `ERR_MODULE_NOT_FOUND`；
2. 对 `./types`（lib/types.ts）只能 `import type`——因为 types.ts 顶部有运行时 import（`./yibai-demo-cases`），node --test 直接跑会解析失败；被测模块若需要类型常量的运行时值，要在模块内维护本地副本并注释同步来源；
3. 新测试文件放被测模块旁（`lib/server/garment-detail-service.test.ts`），纯函数化设计（像 pose-fission-service.test.ts 测 normalize/plan 而非整条 pipeline）最易落地。

### 验收命令

`pnpm exec tsc --noEmit`（= `pnpm typecheck`）、`pnpm lint`、`pnpm build`，加逐个 `node --test <file>`。

---

## 10. 环境变量约定

**没有 `.env.example`**；env 文档分散在 `docs/LAOZHANG_API_SETUP.md`（IMAGE_PROVIDERS 说明 L53/L72）、`docs/performance-optimization-guide.md`、`.env.performance-optimization`（调优参数样例）。生产用 `.env.local`（gitignore），预览站用 `.preview-runtime/` 隔离。

现有命名风格（.env.local 实际键名，全大写蛇形、按子系统前缀分组）：

- Provider：`IMAGE_PROVIDERS`（JSON 数组）、`GOOGLE_IMAGE_MODEL`、`GOOGLE_IMAGE_TIMEOUT_MS`、`GOOGLE_IMAGE_RETRY_ATTEMPTS`、`GRSAI_API_KEY/BASE_URL/IMAGE_IPM/IMAGE_RPM`、`LAOZHANG_API_KEY/...`、`VOLCES_*`、`JIMENG_*`、`QINIU_IMAGE_API_KEY`（pool 代码引用）
- 并发/队列：`PHOTO_FISSION_CONCURRENCY`、`POSE_FISSION_CONCURRENCY`、`IMAGE_GLOBAL_CONCURRENCY`、`IMAGE_PER_PROVIDER_CONCURRENCY`、`IMAGE_PER_USER_CONCURRENCY`、`IMAGE_QUEUE_MAX_PENDING`（.env.performance-optimization）
- 其他：`STORAGE_MODE`、`OSS_*`、`ALIBABA_CLOUD_ACCESS_KEY_*`、`LOCAL_AUTH_MODE`、`IMAGE_API_DEMO`

**新增 `GARMENT_DETAIL_*` 变量（PRD §6.2）完全契合现有 `<FEATURE>_<KEY>` 前缀风格**：`GARMENT_DETAIL_STANDARD_MODELS` / `GARMENT_DETAIL_PRO_MODELS` / `GARMENT_DETAIL_CONCURRENCY`（对齐 `PHOTO_FISSION_CONCURRENCY`）/ `GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS` / `GARMENT_DETAIL_PROMPT_VERSION` / `GARMENT_DETAIL_BACKEND_ENABLED`。文档落点：无 .env.example 可改，建议写进 `docs/`（新建或在性能指南旁加 garment-detail 小节）+ 本任务目录。读取模式参考 `readPositiveInt`（image-provider-pool L102）和各 adapter 的 `process.env.X ?? default`。

---

## 11. 新增 `retryGarmentDetailShots` 清单（汇总 §1 的差异）

1. planned 集合 = `(params as GarmentDetailParams).detailShots.map(s => s.shotId)`；succeeded 集合仍来自 `task.results[].shotId`。
2. 输入重建：主图 = `inputAssetIds[0]` 经 `resolveAssetToDataUrl(asset, { preferUrlPassthrough: model 是 gemini/nano-banana 系 })`；参考图按各 shot 的 `referenceAssetId` 在 pipeline 内解析（不要把全部参考图发给每个 shot）。
3. pipeline 调用必须带 `params`（内含 `resolvedModelId`/`promptTemplateVersion` 快照）+ `targetShotIds` + `onShotResult: persistOneResult`；建议同时传 `signal`（自建 AbortController 并 `runningTaskControllers.set(taskId, controller)`，finally 里 delete），让 cancel 能中断 retry——现有两个 retry 函数没做到这一点，是既有缺陷而非必须照抄。
4. 完成判定走 `resolveTaskCompletion` 的新 garment-detail 分支。
5. 错误：全部失败时 message 用「细节图」语义；`errorMessage` 保留上游信息。
6. 路由：`retry-shots/route.ts` 按 task.featureType 分流，ownership/404 语义不变。

## 12. 其他需要注意的接入点

- **`third-party-image-adapter.ts` `runThirdPartyWorkflow`（L73–136）**：pose-fission 已显式 throw 拒绝进入（L109–113）；garment-detail 当前若进入会落到 `runGoogleProviderEdits`（L138+）通用路径（buildPrompt 按 BackgroundReplaceParams 处理）。PRD §20.3 要求显式分流：要么在 adapter 里 `if (featureType === 'garment-detail') return runGarmentDetailPipeline(...)`，要么像 pose-fission 一样在 task-store `runTask` 直连并让 adapter throw。
- **`image-work-scheduler`**：`cancelScheduledTask` 在 cancelTask 调用；garment-detail 任务的排队/取消自动复用（`estimateTaskUnits` 见 §7）。
- **`IMAGE_API_DEMO=1` demo 模式**（third-party-image-adapter L40/L48–71）：`demoResults` 无 garment-detail 键，demo 模式下 garment-detail 任务会拿不到演示图——PRD §21.5 允许保留统一后端演示模式，需要时补 demoResults['garment-detail']。
- **进度基数**：runTask 把进度推进起点写死为 72（L936），persistOneResult 用 [72,95] 区间；garment-detail 沿用即可。
- **`getInputAssetDescriptors` 前端函数**（PRD §21.4）不在后端范围，但创建任务时 `inputAssetIds[0]=主图` 的顺序契约需要前后端共同遵守。
