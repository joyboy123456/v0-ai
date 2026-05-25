# Streaming Fission Pipeline

> **一句话契约**：所有「单任务 N 个子镜头独立成图、单子镜头失败不阻塞其他」的 fission 类 feature（photo-fission / pose-fission / 未来同类）**必须**遵循本范式：worker pool + `onShotResult` 流式持久化 + `targetIds` 子集重跑 + `resolveTaskCompletion` planned-vs-actual 判 partial。**禁止**用 `Promise.all` 一次性 settle、**禁止**全量重跑、**禁止**靠 `runThirdPartyWorkflow` 二次封装。

---

## 1. Scope / Trigger

**触发条件（任一即必读本 spec）**：

- 新增任何「一次任务 N 张图、单张可独立成功 / 失败」的 fission feature（如未来的「场景裂变」「构图裂变」）
- 修改 `lib/server/photo-fission-service.ts:runPhotoFissionPipeline`、`lib/server/pose-fission-service.ts:runPoseFissionPipeline`
- 修改 `lib/server/task-store.ts` 中 `runTask` 的 fission 分流、`persistOneResult`、`resolveTaskCompletion`、`retryPhotoFissionShots`、`retryPoseFissionShots`
- 新增 `POST /api/<feature>/tasks/:taskId/retry` 风格的 retry 路由
- 调整 fission 并发度环境变量（`PHOTO_FISSION_CONCURRENCY` / `POSE_FISSION_CONCURRENCY`）
- 调整 fission 多渠道分发 / failover（`image-provider-pool.ts`、`provider-image-router.ts`）

**为什么是 code-spec 不是 guide**：本契约包含 *具体签名*（`RunXxxFissionPipelineOptions` / `targetIds` / `onShotResult`）、*跨层数据流*（route ⇄ task-store ⇄ pipeline ⇄ adapter ⇄ wrapper）、*partial 判定矩阵*、*Wrong-vs-Correct* 对照——全是可执行的硬约束。

**与外部 API 稳定性 spec 的边界**：`external-image-api-reliability.md` 管「单次 provider 调用怎么稳」（重试 / 限流 / 错误分类）；本 spec 管「N 次单调用怎么编排、失败怎么收口」。两者通过 `runImageEditViaProvider` 入参 `traceId / shotId` 接驳。

---

## 2. Signatures

### 2.1 pipeline 主入口

`lib/server/photo-fission-service.ts:436`

```ts
export interface RunPhotoFissionPipelineOptions {
  taskId: string
  inputImages: string[]              // [主图, 可选正面, 可选背面]，全部 dataURL
  params: PhotoFissionParams         // 含 shotPlan（9 个 shotId）
  apiKey: string
  timeoutMs: number
  onShotResult?: (result: ResultAsset) => Promise<void>
  targetShotIds?: string[]           // 非空时仅跑该子集
}

export async function runPhotoFissionPipeline(
  options: RunPhotoFissionPipelineOptions,
): Promise<ResultAsset[]>
```

`lib/server/pose-fission-service.ts:238`

```ts
export interface RunPoseFissionPipelineOptions {
  taskId: string
  inputImages: string[]              // [主图, 可选正面, 可选背面]
  params: PoseFissionParams          // 含 poseTemplateSnapshots（1-9 个 template）
  apiKey: string
  timeoutMs: number
  onShotResult?: (result: ResultAsset) => Promise<void>
  targetTemplateIds?: string[]       // 非空时仅跑该子集
}

export async function runPoseFissionPipeline(
  options: RunPoseFissionPipelineOptions,
): Promise<ResultAsset[]>
```

**形状必须保持完全同构**：字段名差异（`shotPlan` vs `poseTemplateSnapshots`、`targetShotIds` vs `targetTemplateIds`）按 feature 语义保留；`taskId / inputImages / params / apiKey / timeoutMs / onShotResult` 6 个字段名 + 顺序 **禁止改动**。

### 2.2 task-store runTask 分流

`lib/server/task-store.ts:226-263`

```ts
const isPhotoFission = task.featureType === 'photo-fission'
const isPoseFission  = task.featureType === 'pose-fission'
const useStreamingPersist = isPhotoFission || isPoseFission

const persistedResults: ResultAsset[] = []
const onShotResult = useStreamingPersist
  ? async (result: ResultAsset) => {
      await persistOneResult(taskId, result)
      persistedResults.push(result)
    }
  : undefined

let results: ResultAsset[]
if (isPoseFission) {
  results = await runPoseFissionPipeline({ ... onShotResult })
} else if (isPhotoFission) {
  // photo-fission 通过 runThirdPartyWorkflow 间接调用（demo 路径需要）
  results = await runThirdPartyWorkflow({ ... onShotResult })
} else {
  results = await runThirdPartyWorkflow({ ... onShotResult })
}

const finalResults = useStreamingPersist ? persistedResults : results
const resultAssetIds = useStreamingPersist
  ? persistedResults.map((item) => item.assetId)
  : await saveResults(results)
```

### 2.3 retry 路由

| Feature | 路由 | Body | task-store 函数 |
|---|---|---|---|
| photo-fission | `POST /api/tasks/:taskId/retry-shots` | `{ shotIds: string[] }` | `retryPhotoFissionShots(taskId, shotIds)` |
| pose-fission | `POST /api/pose-fission/tasks/:taskId/retry` | `{ templateIds: string[] }` | `retryPoseFissionShots(taskId, templateIds)` |

返回 `200: GenerationTask` / `400 | 404: { error: string }`。

### 2.4 persistOneResult（流式持久化）

`lib/server/task-store.ts:301`

```ts
async function persistOneResult(taskId: string, result: ResultAsset): Promise<void>
```

副作用清单：
1. 写入 `public/generated/results/<assetId>.<ext>`
2. 在 `store.assets` 注册 `AssetRecord`
3. 增量 push 进 `task.results` / `task.resultAssetIds`
4. 进度按 `Math.min(95, 72 + (results.length / planned) * 23)` 推进
5. `void persistStore()`（不阻塞）

### 2.5 resolveTaskCompletion（partial 判定）

`lib/server/task-store.ts:358`

```ts
function resolveTaskCompletion(
  task: GenerationTask,
  results: ResultAsset[],
): { status: 'success' | 'partial'; message: string }
```

判定规则：`planned = params.resultCount ?? params.<plan>.length ?? results.length`。若 `planned > 0 && results.length < planned` → `partial`，否则 `success`。

### 2.6 provider router（多渠道）

`lib/server/provider-image-router.ts`

```ts
export interface ProviderImageEditInput {
  taskId: string
  provider: ImageProvider
  fallbackApiKey?: string
  model: string
  prompt: string
  inputImages: string[]
  count: number
  aspectRatio?: string
  imageSize?: string
  traceId?: string
  shotId?: string
}

export async function runImageEditViaProvider(
  input: ProviderImageEditInput,
): Promise<ResultAsset[]>
```

`runImageEditViaProvider` 是 fission pipeline 唯一允许调用的 provider 入口。新增渠道时在 router 里加 case，不在 photo/pose pipeline 内写 provider switch。

---

## 3. Contracts

### 3.1 调用链契约（cross-layer 数据流）

```
HTTP Route (app/api/tasks 创建 / 或 /api/<feature>/tasks/:id/retry)
   ↓
task-store.runTask  or  task-store.retryXxxFissionShots
   ↓
runXxxFissionPipeline({ taskId, inputImages, params, apiKey, timeoutMs, onShotResult, targetIds? })
   ├─ 0. 校验 inputImages.length / shotPlan 或 poseTemplateSnapshots 非空
   ├─ 1. targetIds 非空 → filter 子集；空数组 → throw（不许"空跑全部"）
   ├─ 2. dispatchItemsForModel(items, params.model) 按模型兼容性 + 唯一凭证 lane + provider.weight 分组（同一 apiKey 的多个 provider 只占一条并发 lane；未配 IMAGE_PROVIDERS 且模型为 gemini-* 时退回单 Google provider）
   ├─ 3. 每个 provider group 独立 worker pool：
   │     ├─ concurrency = clamp(env, 1, groupItems.length)
   │     ├─ 每个 worker 循环 `while (currentIndex < groupItems.length)`
   │     ├─ runImageEditViaProvider({ provider, traceId: `${taskId}_${shot|templateId}`, shotId, ... })
   │     ├─ 成功 → 拼装 enriched ResultAsset（assetId=`result_${taskId}_${id}`、label、shotId、finalPrompt）
   │     ├─ await onShotResult(enriched)（如果有）；回调抛错 → 该 item 标 error
   │     └─ 异常 → 标 error，**继续 worker，不抛**
   ├─ 4. 所有 provider group settle 后，逐个失败 item 做 failover
   │     ├─ 排除该 item 刚失败过的 providerId 及同一 apiKey lane
   │     ├─ getFailoverProviderForModel(excludeProviderIds, params.model) 选下一个兼容渠道
   │     └─ 按 failover provider 重新分组跑子集
   └─ 5. 全部 item 都 error → throw（让 runTask 标 failed）；至少 1 张成功 → return successResults
```

**绝对禁止**：
- 在 pipeline 内重新封装 retry 或限流（已由 `callGoogleImageWithRetry` 包办）
- 用 `Promise.all(items.map(...))` 替代 worker pool（违反并发上限）
- failover 时排除所有初始 provider（两渠道场景会导致 A 失败无法转 B）
- 把 `gpt-image-*` 任务分发给 Google 官方 provider（必须先按模型过滤 provider）
- 不传 `onShotResult` 又指望 partial 可恢复（最终失败前的 N-1 张图会丢）
- pipeline 返回值与 task-store 内 `persistedResults` 同时写盘（会重复持久化）

### 3.2 traceId / assetId / label 命名

| 字段 | 格式 | 例 |
|---|---|---|
| `traceId` | `${taskId}_${shotOrTemplateId}` | `task_xx_shot_3` / `task_xx_pose-side-walk` |
| `assetId` | `result_${taskId}_${shotOrTemplateId}` | `result_task_xx_shot_3` |
| `label` | `shot.label` / `template.name` | `正面站姿` / `背面慢走` |
| `shotId` (ResultAsset) | 与 traceId 后缀同源 | `shot_3` / `pose-side-walk` |

**禁止**：临时用 `Date.now()`、跨层重写 traceId、复用 `${taskId}` 当 traceId（grep 不出哪条 shot）。

### 3.3 并发度环境变量

| key | 默认 | 含义 |
|---|---|---|
| `PHOTO_FISSION_CONCURRENCY` | `3` | photo-fission 9/10 shot 的 per-provider 并发上限 |
| `POSE_FISSION_CONCURRENCY` | `2` | pose-fission 1-9 pose 的并发上限 |

**为什么 pose-fission 默认 2**：pose-fission 以用户显式选择的姿势模板为单位调度，默认 2 兼顾速度与稳定性；如果 provider 出现限流或空返回，优先通过 env 下调。

**为什么 photo-fission 默认 3**：服装大片裂变要在一次任务中快速产出 9/10 张图，默认保持高并发吞吐；如果特定 provider 出现限流、空返回或 partial 增多，可通过 env 临时下调。

**强约束**：`concurrency = clamp(env, 1, items.length)`，即「不超过实际镜头数」。原因：worker pool 多余的 worker 会立刻 return，没意义但也无害；负数 / NaN 必须 fallback。

多渠道时并发度是 **per provider group** 的上限，不是整任务全局上限。例如 2 个 provider + `PHOTO_FISSION_CONCURRENCY=3`，最多同时 6 个 in-flight（各渠道最多 3 个），但每次真实 fetch 仍必须经过 provider 级 `maxIpm/maxRpm` 令牌桶。

调度层必须优先铺满 **唯一凭证 lane**：七牛同一把 `apiKey` 下配置多个模型 provider 时，只算一条 lane；Google 仍按 `gemini-*` 模型兼容性参与。9 shot + 4 把七牛 key + 1 个 Google 的典型分布应先并发启动 5 条 lane，再按权重把剩余 shot 补给高权重 lane。

### 3.4 retry 函数前置校验矩阵

| 检查 | 失败时 | 来源 |
|---|---|---|
| `store.tasks.get(taskId)` 存在 | `Error('任务不存在')` | `task-store.ts:628 / 766` |
| `task.featureType === '<feature>'` | `Error('仅<feature>支持重跑...')` | 同上 |
| `task.status ∈ {partial, failed}` | `Error('当前任务状态不允许重跑...')` | 同上 |
| `params.shotPlan / poseTemplateSnapshots` 存在 | `Error('任务缺少 shotPlan/姿势模板快照')` | 同上 |
| 入参 ids 全部 ∈ planned | `Error('${id} 不在原任务计划中')` | 同上 |
| 入参 ids 全部 ∉ alreadySucceeded | `Error('${id} 已成功，无需重跑')` | 同上 |
| `inputImages.length > 0`（运行时） | `Error('原任务参考图已丢失，无法重跑')` | 同上 |

**HTTP 状态映射**：
- 包含「任务不存在」/「丢失」 → 404
- 其他业务错 → 400

### 3.5 task.status 状态机（含 retry）

```
created → running → success
                  → partial   ──┐
                  → failed    ──┤
                                 ↓ POST /retry-shots（或 /retry）
                              running
                                 ↓
                              success | partial | failed
```

retry 期间 `progress = 72`、`message = '正在重跑 N 个失败<镜头|姿势>'`；retry 结束按 `resolveTaskCompletion` 二次定调。

### 3.6 进度推进规则

| 阶段 | progress | 设置点 |
|---|---|---|
| 创建 | 0 | `createTask` |
| 准备参考图 | 72 | `runTask` 进入 pipeline 前 |
| 单 shot 成功 | `72 + (n/planned) * 23`（封顶 95） | `persistOneResult` |
| 全部收口 | 100 | `runTask` 末尾 / `retryXxxFissionShots` 末尾 |

**禁止**：在 pipeline 内手动写 `progress`（已由 `persistOneResult` 包办）。

---

## 4. Validation & Error Matrix

### 4.1 pipeline 内部失败矩阵

| 触发 | 处理 | 后续 |
|---|---|---|
| 单 item `runImageEditViaProvider` throw | catch → 标 `error`，continue 下一个 | partial / failed 由 resolveTaskCompletion 决定 |
| 单 item 返回 `single[0] == null` | 标 `error: '该镜头/姿势未返回图片'` | 同上 |
| 单 item `onShotResult` 回调 throw | 标 `error: '流式持久化失败：...'`、打 `gimg.fail stage=persist` | 同上 |
| 全部 item 失败 | `throw new Error('...全部...失败：${firstError}')` | runTask catch → status = failed |
| `inputImages.length === 0` | 立即 throw（pipeline 头部校验） | runTask catch → failed |
| `targetIds` 非空但与 plan 无交集 | 立即 throw（pipeline 头部校验） | retry 函数 catch → 400 |

### 4.2 retry 路由错误矩阵

| 触发 | HTTP | 响应 |
|---|---|---|
| body 不是 object | 400 | `{ error: '请求体格式错误' }` |
| `shotIds/templateIds` 不是非空数组 | 400 | `{ error: '请传入要重跑的 xxxIds 数组' }` |
| 过滤后 ids 空 | 400 | `{ error: 'xxxIds 不能为空' }` |
| 任务不存在 / 资源丢失 | 404 | `{ error: '任务不存在' }` 等 |
| 其他业务错 | 400 | `{ error: '...' }` |

---

## 5. Good / Base / Bad Cases

### Good — 全部成功
```
photo-fission 9 shot / 2 providers / concurrency=3 / 每 provider IPM=10
→ dispatchItems 按权重分到 provider-a / provider-b
→ 每个 provider 最多 3 个 worker 抢占自己的 groupItems
→ 每张：runImageEditViaProvider 成功 → onShotResult 写盘 → persistedResults.push
→ pipeline 返回 9 张
→ resolveTaskCompletion: planned=9 results=9 → status=success
→ progress: 72 → 76 → 81 → 86 → 91 → 95 → 100
```

### Base — 部分失败 + 重跑
```
shot_5 三次 empty_output 触上限 → wrapper throw → 标 error
其他 8 张正常 → pipeline return 8 张
→ runTask: persistedResults.length=8, planned=9
→ resolveTaskCompletion: status=partial, message='已生成 8/9 张'
→ 前端轮询拿到 partial → 显示「重跑失败镜头 (1)」
→ POST /api/tasks/:taskId/retry-shots { shotIds: ['shot_5'] }
→ retryPhotoFissionShots 校验通过 → 标 running progress=72
→ runPhotoFissionPipeline targetShotIds=['shot_5'] → 仅跑 1 张
→ 成功 → onShotResult 写盘 → results.length=9
→ resolveTaskCompletion: status=success → progress=100
```

### Base — 渠道 failover
```
pose-fission 1 个姿势 / providers=[google-1, qiniu-1]
→ 初次 dispatch 到 google-1
→ google-1 连续 empty_output 达上限，item 标 error(providerId=google-1)
→ getFailoverProvider(['google-1']) 选 qiniu-1
→ 仅该失败姿势在 qiniu-1 重跑
→ 成功后覆盖 item result，task.status=success
```

### Bad — pipeline 全部失败但已成功 X 张不丢
```
任务运行中：3 worker 跑完前 6 shot（4 成功 2 失败）后整体 catch 抛错
→ runTask catch → status=failed
→ task.results 仍包含 4 张（persistedResults 已写盘）
→ 前端展示「失败：…」+ 4 张已成功图 + 「重跑失败镜头 (5)」按钮
→ retry 仅跑 shotIds = [失败的 5 个]，已成功的 4 张不动
```

---

## 6. Tests Required

> 与外部 API 稳定性一样，目前项目无 vitest 集成。下列断言点必须靠手测覆盖（PRD §15.13 / pose-fission D9-D11）。

### 6.1 单元（必加）

- `runXxxFissionPipeline` 头部校验：
  - 空 `inputImages` → throw
  - `targetIds=[]` 且原 plan 非空 → 按全跑（兼容旧 caller）
  - `targetIds=['不存在的id']` → throw `targetIds 与 plan 不匹配`
- `resolveTaskCompletion`：
  - planned=9 results=9 → success
  - planned=9 results=3 → partial / `'已生成 3/9 张...'`
  - planned=9 results=0 → partial（仍是 partial 不是 failed；failed 由 runTask catch 设）
  - 非 fission feature → 必定 success
- 多渠道分组：
  - 2 provider + 1 item，首个 provider 失败后必须能 failover 到另一个 provider
  - 4 把七牛 key + 1 个 Google + 9 item，应至少分出 5 个 provider group，先铺满每条唯一凭证 lane
  - failover 只排除该 item 失败过的 `providerId` 及同一 apiKey lane，不能排除全部初始 providers
  - `auth_failed` provider 被 `tripProviderCircuit` 后，同一 apiKey lane 的 sibling providers 也不再被 `getFailoverProvider` 选中

### 6.2 集成 / 手测

- **流式持久化幸存**：mock 后 3 shot 抛 500ms 内 throw，断言已成功的前 N 张图存在 `public/generated/results/` 且 `store.tasks.get(taskId).results.length === N`（即使 pipeline 最终 throw）
- **并发上限**：env `PHOTO_FISSION_CONCURRENCY=2` + 2 provider 启动 9 shot 任务，断言任一 provider in-flight 不超过 2；全任务可同时最多 4
- **retry 子集**：partial 任务 6/9，POST `retry-shots {shotIds: 3个失败}`，断言：
  1. pipeline 内 `templates.length === 3`
  2. 成功后 `task.results.length === 9`
  3. status 切回 success
  4. progress=100
- **retry 状态守卫**：success 状态调 retry → 400 `当前任务状态不允许重跑`
- **retry id 守卫**：传一个已成功的 shotId → 400 `xxx 已成功，无需重跑`
- **traceId 唯一性**：grep 日志 `task_xx`，断言每条都带后缀 `_shot_n` / `_pose-xxx`，不存在裸 `task_xx`

---

## 7. Wrong vs Correct

### 7.1 编排方式

#### Wrong — `Promise.all` 一次性 settle
```ts
const results = await Promise.all(
  shotPlan.map((shot) => runImageEditViaProvider({ ... }))
)
```
**为什么错**：
- 没有并发上限，9 个 shot 同时 fetch 立即撞 IPM
- 任意一张抛错就让 Promise.all reject，导致其他已成功的图被丢
- 没法在「单张成功的瞬间」回写 task store / 写盘

#### Correct — worker pool + onShotResult
```ts
const concurrency = Math.min(envValue, shotPlan.length)
let nextIndex = 0
const worker = async () => {
  while (true) {
    const i = nextIndex++; if (i >= shotPlan.length) return
    try {
      const single = await runImageEditViaProvider({ provider, traceId: `${taskId}_${shot.shotId}`, ... })
      const enriched = { ...single[0], assetId: `result_${taskId}_${shot.shotId}`, ... }
      results[i] = { shot, result: enriched }
      await options.onShotResult?.(enriched)
    } catch (error) {
      results[i] = { shot, error: error.message }
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()))
```

### 7.1.1 多渠道 failover

#### Wrong — 排除所有初始 provider
```ts
const usedProviderIds = Array.from(groups.keys())
const failoverProvider = getFailoverProvider(usedProviderIds)
```
**为什么错**：只有两个渠道时，`groups.keys()` 通常就是 `[google-1, qiniu-1]`；任何一个 item 失败都会找不到可用 failover，新增渠道完全发挥不了兜底作用。

#### Correct — 只排除该 item 失败过的 provider
```ts
const excludeProviderIds = result.providerId ? [result.providerId] : []
const failoverProvider = getFailoverProvider(excludeProviderIds)
```
每个 `ShotRunResult` / `PoseRunResult` 必须记录 `providerId`，让 failover 精确到单个失败 item。

---

### 7.2 partial 失败的用户出口

#### Wrong — 让用户全量重跑
photo-fission partial 状态只提示「已生成 X/9 张」，无重试入口 → 用户从头跑 9 张，已成功的 X 张全部白做。

#### Correct — `targetIds` 子集重跑 + 路由
- `runXxxFissionPipeline({ targetIds })` 必须支持过滤后再进 worker 池
- 提供 `POST /api/<feature>/tasks/:taskId/retry`
- 前端 partial / failed-with-partial-results 显示「重新生成失败 (N)」按钮

凡是「N 个子任务 + 单个独立成功」的 pipeline，都应该遵循这条契约。

---

### 7.3 持久化双写

#### Wrong — pipeline 返回 results 后 task-store 再 `saveResults`
```ts
const results = await runPhotoFissionPipeline({ ... onShotResult: persistOneResult })
const resultAssetIds = await saveResults(results)  // 第二次写盘！
```
**为什么错**：每张图在 `onShotResult` 已写过盘，`saveResults` 会重新生成新的 `assetId` 文件，留下两份磁盘文件 + store 引用不一致。

#### Correct — fission 路径跳过 saveResults
```ts
const finalResults = useStreamingPersist ? persistedResults : results
const resultAssetIds = useStreamingPersist
  ? persistedResults.map((item) => item.assetId)
  : await saveResults(results)
```

---

### 7.4 不抽象通用 `retryFissionShots`

#### Wrong — 过早抽象通用 retry
```ts
// ❌ 试图把 retryPhotoFissionShots + retryPoseFissionShots 合并：
async function retryFissionShots(taskId, ids, opts: { kind: 'photo' | 'pose' }) {
  const planField = opts.kind === 'photo' ? 'shotPlan' : 'poseTemplateSnapshots'
  const callTargetField = opts.kind === 'photo' ? 'targetShotIds' : 'targetTemplateIds'
  // ...大量 if/else 按 kind 分叉...
}
```
**为什么错**：
- 字段名差异、错误文案差异、pipeline 入参字段名差异都要在 helper 内 `if` 一遍，逻辑反而更脆
- 第三个 feature 出现时，差异点未必沿用同一个 union 维度

#### Correct — 重复 2 次先 OK，第 3 个 feature 出现时再抽象
两份 `retryXxxFissionShots` 结构同构、行号相邻、注释里互相引用即可。等出现第三个 fission feature 时再观察「真正的公共契约」是什么，避免 lowest-common-denominator 抽象。

（同样的判断已写在 `task-store.ts:751-757` 注释里，本条对应 PRD §Out of Scope。）

---

### 7.5 traceId 退化

#### Wrong — pipeline 内 fallback 到裸 taskId
```ts
const traceId = shot.shotId ? `${taskId}_${shot.shotId}` : taskId
```
**为什么错**：日志 grep 时无法区分「确实是单图任务」与「某 shot 没传 shotId 退化」。fission pipeline 一定有 shotOrTemplateId，禁止 fallback。

#### Correct — 必带后缀
```ts
traceId: `${taskId}_${shot.shotId}`,   // 或 `${taskId}_${template.id}`
shotId: shot.shotId,
```

---

## 8. Design Decisions

### 8.1 为什么 pose-fission 跳过 `runThirdPartyWorkflow`

`runThirdPartyWorkflow` 是为支持 `IMAGE_API_PROVIDER=raycast | google | demo` 切换设计的；pose-fission 上线时 raycast 路径不支持「锚定主图 + 改姿势」语义。直接在 `task-store.runTask` 内按 `isPoseFission` 分流到 `runPoseFissionPipeline` → `runImageEditViaProvider`，省一层 legacy dispatcher、避免 demo/provider 路径分叉。

photo-fission 仍走 `runThirdPartyWorkflow` 的原因是它早于本契约落地、需要保留 demo 路径占位。新加的 fission feature 若不需要 demo provider，应**直接学 pose-fission 的分流**。

### 8.2 为什么不在 pipeline 里 retry

`callGoogleImageWithRetry` 已经在单调用层面做了 4 次重试 + 分类 + 限流。再在 pipeline 层加一层「单 shot 失败后整体重跑」会让单次任务的总耗时翻倍且没有额外收益。partial 的二次出口由 retry 路由提供，给用户选择权。

### 8.3 为什么并发度按 feature 各自配独立 env

photo-fission 棚拍 prompt 短、稳定性高，可以更激进（3）；pose-fission 需要保住主图人物 + 改姿势，单调用更耗时且对 IPM 敏感（2）。共用一个 `FISSION_CONCURRENCY` 会强迫两个 feature 取其下限，浪费余裕。

多渠道后，这两个 env 仍然表示 **每个 provider group 的 worker 上限**，而不是全局上限。真正的外部 API 配额由 provider 自己的 `maxIpm/maxRpm` 控制；这样新增渠道能线性提升吞吐，但不会让单渠道超配额。

### 8.4 为什么 `onShotResult` 是 `async (result) => Promise<void>` 不是 sync

写盘 + 注册 asset + 更新 store + persistStore 都是 async；同步回调会让 pipeline 在「图片生成完毕」与「持久化完成」之间存在 race（worker 跑下一个时上一个还没写完盘，导致 progress 走在 results 前面）。

---

## 9. Common Mistakes

### 9.1 新 fission feature 没传 `onShotResult`
**症状**：任务跑完之后 task store 里 results 字段是空的，前端等了 10 分钟拿到 100% progress + 0 张图。
**修正**：`runTask` 内 `useStreamingPersist` 标志必须把新 featureType 加进去，并构造 `onShotResult = async (r) => persistOneResult(taskId, r)`。

### 9.2 retry 路由复用了 photo-fission 路由
**症状**：前端给 pose-fission 任务调 `/api/tasks/:id/retry-shots`，后端因 `featureType !== 'photo-fission'` 抛错。
**修正**：每个 fission feature 自带 retry 路由（命名差异：`/api/tasks/:id/retry-shots` vs `/api/<feature>/tasks/:id/retry`），按 feature 语义保留。

### 9.3 retry 函数标 status=running 后忘了在 catch 里收口
**症状**：retry pipeline 全部失败时任务卡在 `running` 状态，前端永远轮询。
**修正**：见 `task-store.ts:698-718`，catch 内必须 `resolveTaskCompletion(currentTask, currentTask.results)` 重新定调并 `finishedAt`。

### 9.4 并发度 env 直接 `Number(process.env.X) ?? 3`
**症状**：env 为 `"abc"` → NaN → worker pool 立即 return，0 张图。
**修正**：`Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), items.length) : <feature默认>`，永远 clamp + 给 floor。

### 9.5 `targetIds` 当作"传空数组等于跑全部"
**症状**：前端误传 `targetShotIds: []` → 期望全跑实际啥都跑不出。
**修正**：pipeline 把 `targetIds && targetIds.length > 0` 才视为「子集模式」，空数组等同于不传。但 retry 路由层必须把空数组拦截为 400，不允许打到 pipeline。

---

## 10. Future: 第三个 fission feature 触发抽象

出现第三个同构 fission feature 时（如「场景裂变」），应观察并验证以下抽象维度的稳定性：

```ts
interface FissionPipelineSpec<TItem, TParams> {
  taskFeatureType: GenerationTask['featureType']
  itemsFromParams: (params: TParams) => TItem[]
  itemId: (item: TItem) => string
  buildPromptAndOptions: (item: TItem, params: TParams) => { prompt: string; imageSize: string; aspectRatio?: string }
  enrichResult: (raw: ResultAsset, item: TItem, taskId: string) => ResultAsset
  concurrencyEnvKey: string
  defaultConcurrency: number
}
```

**不要在两 feature 阶段做**——过早抽象会让字段名差异、错误文案差异、partial 文案差异变成 lowest-common-denominator，丢掉 photo / pose 各自有意义的 feature 语义。

---

## 11. 参考代码

- photo-fission pipeline：`lib/server/photo-fission-service.ts:397-568`
- pose-fission pipeline：`lib/server/pose-fission-service.ts:196-373`
- task-store 分流：`lib/server/task-store.ts:226-280`
- 流式持久化：`lib/server/task-store.ts:301-341`
- partial 判定：`lib/server/task-store.ts:358-388`
- photo-fission retry：`lib/server/task-store.ts:621-737`
- pose-fission retry：`lib/server/task-store.ts:759-879`
- photo-fission retry 路由：`app/api/tasks/[taskId]/retry-shots/route.ts`
- pose-fission retry 路由：`app/api/pose-fission/tasks/[taskId]/retry/route.ts`

## 12. 关联 spec

- `external-image-api-reliability.md`：本契约的单调用层基础（traceId / shotId / 重试 / 限流 / 错误分类）
- `frontend/state-management.md`：fission 任务在前端的轮询与「一键做同款」状态派发
- `guides/code-reuse-thinking-guide.md`：fission pipeline 是项目「复用第一公民清单」中的强模式
