# garment-detail 前端 Mock 接线盘点（研究笔记）

> 目标：列出所有必须改动的前端触点，带精确路径、行号与代码摘录。对应 PRD §21。
> 代码基线：`preview` 分支工作区 `/opt/yibai-fission`（2026-08-16 时点）。

---

## 1. `lib/garment-detail-mock.ts`（468 行，整体待删）

### 1.1 导出清单

| 导出 | 行号 | 作用 |
| --- | --- | --- |
| `GARMENT_DETAIL_MOCK_TASK_PREFIX = 'mock-gd-'` | L25 | mock 任务 ID 前缀，workbench 各分支据此分流 |
| `isGarmentDetailMockTaskId(taskId)` | L40-42 | 前缀判断 |
| `GarmentDetailModelOption`（interface） | L48-59 | 模型选项 DTO（见 §1.2） |
| `fetchGarmentDetailModels()` | L87-93 | mock 模型列表，300ms 假延迟 |
| `buildGarmentDetailShots(category, referenceAssetIds)` | L111-124 | **输出位规划，后端必须逐字对齐** |
| `createGarmentDetailMockTask(input, nowMs)` | L200-238 | 创建 pending 态 mock 任务 |
| `advanceGarmentDetailMockTask(task, nowMs)` | L265-400 | 纯函数时间轴推进 |
| `retryGarmentDetailMockTask(task, nowMs)` | L403-433 | 失败重试（重置时间轴 + mockRetryCount+1） |
| `cancelGarmentDetailMockTask(task, nowMs)` | L436-468 | 本地取消，保留已生成结果 |

文件头注释（L9-10）自述删除时机：「后端接入时：fetchGarmentDetailModels 换成 PRD §6.3 接口，任务创建/轮询换成 §6.1/§6.2，本模块可整体删除」。

### 1.2 `fetchGarmentDetailModels()` mock 形态（L48-93）

```ts
export interface GarmentDetailModelOption {
  algorithmModelId: string
  algorithmModelName: string
  tier: GarmentDetailTier               // 'standard' | 'professional'
  resolutions: GarmentDetailResolution[] // '1k' | '2k' | '4k'
  recommended: boolean
  defaultSelected: boolean
  description: string
  costLabel: string
  estimatedSeconds: number
}
```

内置两档（L61-84）：`std-v1`（标准版，resolutions `['1k']`，defaultSelected=true，约 45s）与 `pro-v1`（专业版，resolutions `['2k','4k']`，recommended=true，约 75s）。`fetchGarmentDetailModels()`（L87-93）仅 `setTimeout 300ms` 后返回拷贝。**`GET /api/garment-detail/models`（PRD §7.1）的响应字段必须与该 interface 完全一致**，前端 `left-panel.tsx` / `garment-detail-form.tsx` 直接消费这些字段（含 `estimatedSeconds` 的「约 Xs」展示）。

### 1.3 `buildGarmentDetailShots()` —— 后端必须匹配的输出位规划（L99-124）

```ts
const DETAIL_PART_LABELS: Record<GarmentDetailCategory, string[]> = {
  tops: ['领口细节', '袖口细节', '面料纹理'],
  bottoms: ['腰头细节', '走线细节', '面料纹理'],
  dress: ['领口细节', '裙摆细节', '面料纹理'],
  accessory: ['材质特写', '工艺细节', '质感纹理'],
  'shoes-bags': ['五金细节', '走线细节', '材质特写'],
}

export function buildGarmentDetailShots(
  category: GarmentDetailCategory,
  referenceAssetIds: (string | null)[],
): GarmentDetailShot[] {
  const parts = DETAIL_PART_LABELS[category]
  if (referenceAssetIds.length === 0) {
    return [{ shotId: 'detail_1', label: parts[0], referenceAssetId: null }]
  }
  return referenceAssetIds.map((assetId, index) => ({
    shotId: `detail_${index + 1}`,
    label: parts[index % parts.length],
    referenceAssetId: assetId,
  }))
}
```

后端归一化（`normalizeGarmentDetailParams()`）必须逐条复刻的规则：

1. **labels 表**与 PRD §5.3 表格一致；index 超出 3 个时按 `parts[index % parts.length]` 循环取（实际最多 3 个，不会触发）。
2. **shotId 命名**：`detail_${index + 1}`，即 `detail_1` / `detail_2` / `detail_3`，从 1 开始、与参考图顺序一一对应。
3. **referenceAssetId 绑定**：第 N 个 shot 绑定第 N 张参考图的 assetId；**无参考图（空数组）时只生成 1 个 shot，`referenceAssetId: null`**。
4. **数量规则**：输出数量 = 参考图数量，参考图为 0 时输出 1 张（FR-14 / PRD §5.2 表格）。
5. 前端传入的 `referenceAssetIds` 已过滤空槽（left-panel L518-520），服务端应以自己重建的结果覆盖客户端字段（PRD §8.7）。

### 1.4 mock 时间轴（仅供理解阶段语义，不迁移）

L143-147：`QUEUE_MS = 1_500`（排队）→ `CLASSIFY_MS = 3_500`（progress 12，「正在抠图并识别服装类型…」）→ `PLAN_MS = 5_500`（progress 28，「分类完成：{label}，正在规划细节部位…」）→ 每 shot `PER_SHOT_MS = 3_500` 逐张完成，progress 上限 95，完成时 100。失败演示：提示词含「失败」且未重试过 → AUDIT_REJECTED（L149-152, L314-331）。

### 1.5 mock 任务骨架（`createGarmentDetailMockTask` L200-238）

- `taskId = mock-gd-${nowMs.toString(36)}-${random}`；`featureType: 'garment-detail'`；`workflowId: 'garment_detail_mock_v1'`（L27，与 `lib/types.ts` L874 `FEATURE_WORKFLOWS['garment-detail']` 同步——PRD §20.3 要求改为 `garment_detail_v1`）。
- `inputAssetIds` = `[主图, ...参考图]`；`inputAssets` 用 `toMockAssetRecord`（L181-197）伪造 AssetRecord（`fileUrl` 直接用 `image.preview` blob URL——真实后端下这里会是 OSS/local URL，对比弹窗读 `inputAssets[0].fileUrl`，见 §5）。
- 初始 `shotProgress`：每 shot `{ status: 'prompting', message: '等待开始' }`（L227-232）。PRD §12.1 服务端初始为 `message: '正在准备细节图'`——文案微差，前端只展示 `message`，无强耦合。
- `userId: 'demo_user'`、`creditsUsed: params.creditsCost`。

---

## 2. `components/workbench/workbench.tsx`（881 行）—— mock 分支全集

### 2.1 导入（L13-17）

```ts
import {
  advanceGarmentDetailMockTask,
  cancelGarmentDetailMockTask,
  isGarmentDetailMockTaskId,
  retryGarmentDetailMockTask,
} from '@/lib/garment-detail-mock'
```

接入后整段删除。

### 2.2 loadTasks 合并保留 mock 任务（L164-169）

```ts
for (const task of currentTasks) {
  // garment-detail 前端 mock 任务不存在于服务端，刷新列表时必须保留
  if (isGarmentDetailMockTaskId(task.taskId)) {
    nextTasks.push(task)
    continue
  }
  ...
```

`loadTasks` 走 `GET /api/tasks?featureType=${currentFeature}`（L131 附近）；真实任务落库后服务端分页自然返回 garment-detail 任务，该保留分支可删。

### 2.3 单张结果删除（L218-245）

```ts
// garment-detail mock 任务：纯本地删除，逻辑与服务端保持一致（删空 → 整 task 移除）
if (isGarmentDetailMockTaskId(taskId)) {
  const currentTask = tasksRef.current.find(...)
  const willRemoveTask = ... // 过滤后 results/resultAssetIds 全空则整 task 移除
  setTasks(...) // 本地过滤
  if (willRemoveTask) setActiveTaskId(current => current === taskId ? null : current)
  return
}
const response = await fetch(`/api/tasks/${taskId}/results/${assetId}`, { method: 'DELETE' })
```

删除本地分支后，garment-detail 自动走下方通用的 `DELETE /api/tasks/:taskId/results/:assetId`（L247-291），无需新代码。

### 2.4 取消任务（L298-306）

```ts
// garment-detail mock 任务：本地取消，保留已生成结果
if (isGarmentDetailMockTaskId(taskId)) {
  setTasks((currentTasks) =>
    currentTasks.map((item) =>
      item.taskId === taskId ? cancelGarmentDetailMockTask(item) : item,
    ),
  )
  return
}
```

删除后走通用 `POST /api/tasks/:taskId/cancel`（L308-325）。

### 2.5 loadTask 轮询跳过（L329-331）

```ts
const loadTask = useCallback(async (taskId: string) => {
  // garment-detail mock 任务只存在于本地，轮询直接跳过
  if (isGarmentDetailMockTaskId(taskId)) return
```

删除后所有任务统一 `GET /api/tasks/:taskId`（L333+）。轮询驱动：activeTask 变化即拉一次（L436-439），另有 3s interval 拉全部 in-flight 任务（L441-465，`window.setInterval(loadInFlightTasks, 3000)`）。

### 2.6 mock 任务创建 / 重试回调（L469-483）

```ts
// ---- garment-detail 前端 mock：创建 / 定时推进 / 失败重试 ----
const handleGarmentDetailMockTaskCreated = useCallback((task: GenerationTask) => {
  setTasks((currentTasks) => [task, ...currentTasks])
  setActiveTaskId(task.taskId)
  setMobileFormOpen(false)
}, [])

const handleRetryGarmentDetailMockTask = useCallback((task: GenerationTask) => {
  const retried = retryGarmentDetailMockTask(task)
  latestTaskResponseRef.current.set(task.taskId, ++taskRequestSequenceRef.current)
  setTasks(...)
  setActiveTaskId(task.taskId)
}, [])
```

接入后这两个回调删除，连同透传：`onGarmentDetailMockTaskCreated={handleGarmentDetailMockTaskCreated}`（L777，传给 LeftPanel）与 `onRetryGarmentDetailTask={handleRetryGarmentDetailMockTask}`（L843，传给 RightPanel）。注意创建回调语义与普通 `onTaskCreated`（L772-776）不同：后者拿到 taskId 后调 `loadTask(taskId)`——garment-detail 接入后直接复用 `onTaskCreated` 即可。

### 2.7 600ms tick 推进（L485-506）

```ts
// 本地定时器推进 mock 任务（排队 → 识别分类 → 逐张生成 → 成功/失败）。
// advance 是纯函数，按 createdAt 推导当前阶段，600ms Tick 足够平滑。
useEffect(() => {
  const tick = () => {
    setTasks((currentTasks) => {
      const hasLiveMock = currentTasks.some(
        (task) => isGarmentDetailMockTaskId(task.taskId) &&
          (task.status === 'pending' || task.status === 'running'),
      )
      if (!hasLiveMock) return currentTasks
      const now = Date.now()
      return currentTasks.map((task) =>
        isGarmentDetailMockTaskId(task.taskId)
          ? advanceGarmentDetailMockTask(task, now)
          : task,
      )
    })
  }
  const intervalId = window.setInterval(tick, 600)
  return () => window.clearInterval(intervalId)
}, [])
```

整个 useEffect 删除；真实进度由 §2.5 的 3s 服务端轮询驱动。

### 2.8 移动端外壳

`workbench.tsx` L847-864：`isMobile`（`hooks/use-mobile.ts` 的 `useIsMobile()`，768px 断点）时改用 `MobileShell` 包裹同一棵 `leftPanel` / `rightPanel`——**移动端没有独立的 garment-detail 逻辑**，`mobile-shell.tsx` 仅有 L37 的图标映射（`'garment-detail': ZoomIn`）。删 mock 不需要动 mobile-shell。

### 2.9 `components/workbench/right-panel.tsx` 中的 garment-detail / mock 分支

| 位置 | 内容 | 处置 |
| --- | --- | --- |
| L30 | `import { isGarmentDetailMockTaskId } ...` | 删 |
| L32 | `import { GarmentDetailCompareStage } ...` | 保留 |
| L142-162 | 结果网格：`task.featureType === "garment-detail"` 时按 `params.detailShots` 逐输出位渲染（结果优先，否则 progress 卡；`shotId ?? \`detail_${index+1}\`` 兜底），extra results 追加在后 | **保留**——真实任务同构（detailShots + shotProgress + results.shotId），是后端数据形态的契约 |
| L278-279 | prop `onRetryGarmentDetailTask?: (task) => void`「garment-detail mock 失败任务重试（前端界面先行阶段本地重置）」 | 改为走 `retry-shots`（见 L762 分支） |
| L731-744 | 批量下载：`isGarmentDetailMockTaskId(visibleTask.taskId)` 时逐张 `<a download>` 浏览器下载（mock 无打包接口），否则 `POST /api/tasks/:id/download` | 删 mock 分支，走服务端打包下载 |
| L762-766 | `handleRetryShots` 入口：`task.featureType === "garment-detail"` → `onRetryGarmentDetailTask?.(task)` 本地重置后 return | 改为与 photo-fission 同路：`POST /api/tasks/:taskId/retry-shots` body `{ shotIds }`（PRD §14） |
| L1979-1989 | 详情弹窗：`isGarmentDetail = task.featureType === "garment-detail"`；原图 URL 取 `task.inputAssets?.[0]?.fileUrl`；模型名取 `params.algorithmModelName` | 保留；依赖服务端 hydrate `inputAssets`（PRD §13 末段） |
| L2050-2068 | `<GarmentDetailCompareStage key detailUrl={image.url} originalUrl compare={compareMode} />` + 「原图对比/退出对比」按钮 | 保留 |
| L3083-3095 | `canRetryShots` 的 garment-detail 分支：仅 `task.status === "failed"` 时显示，按钮文案「重新生成」；`handleRetry` 传 `failedShotIds`（L3102） | 需扩展：支持 `partial` 且按失败 shotId 重试（当前 failedShotIds 计算 L3060-3075 只有 photo-fission/pose-fission 分支，garment-detail 落入 `return []`，需补 detailShots 分支——PRD §14「前端点击重试可自动提交全部失败 Shot ID」） |

---

## 3. `getInputAssetDescriptors()` —— `components/workbench/left-panel.tsx` L778-875

现状签名与形态：

```ts
const getInputAssetDescriptors = (): AssetDescriptor[] => {   // L778
  if (feature === "ai-fashion-photo") { ... }                 // L779-785 全部参考图
  if (feature === "photo-fission") { ... }                    // L787-840 主图+细节+人像小卡
  if (feature === "pose-fission") { ... }                     // L842-866 主图+正/背面参考
  if (!activeImage) return [];                                // L868
  return [{ assetId: activeImage.assetId, name: activeImage.name, role: "主图" }]; // L870-874
};
```

`AssetDescriptor = { assetId, name, role }`。被 `handleCreateTask` L692 与 `getInputAssetIds()` L774-776 消费。

**gap**：没有 `garment-detail` 分支。当前 garment-detail 在 `handleCreateTask` 开头就被 mock 分支拦截（见 §4），走不到这里；而且 `activeImage`（L335-340）对 garment-detail 会落到 `fashionImage`（恒为 null 的其它功能状态），兜底分支会返回错误的素材。接入时必须新增分支，产出（PRD §7.3「inputAssetIds[0]=主图，[1...]=参考图最多 3 张」、§21.4）：

```ts
if (feature === "garment-detail") {
  if (!garmentDetailMainImage) return [];
  const assets: AssetDescriptor[] = [
    { assetId: garmentDetailMainImage.assetId, name: garmentDetailMainImage.name, role: "主图" },
  ];
  garmentDetailReferences.forEach((image, index) => {
    if (!image) return;                       // 3 槽位可为空，跳过空槽
    assets.push({ assetId: image.assetId, name: image.name, role: `参考图 ${index + 1}` });
  });
  return assets;
}
```

---

## 4. 提交处理器（`handleCreateTask`，`left-panel.tsx` L619-729）

### 4.1 garment-detail mock 特殊分支（L619-645，**待删**）

```ts
const handleCreateTask = async () => {
  // garment-detail 前端界面先行：不走后端 /api/tasks，本地创建 mock 任务
  if (feature === "garment-detail") {
    if (!garmentDetailMainImage) { setError("请先上传服装原图"); return; }
    if (!garmentDetailModels || !garmentDetailModelId) { setError("模型版本列表加载中，请稍候再提交"); return; }
    setError("");
    setIsCreating(true);
    try {
      const task = createGarmentDetailMockTask({
        params: getParams() as GarmentDetailParams,
        mainImage: garmentDetailMainImage,
        referenceImages: garmentDetailReferences.filter(
          (image): image is UploadedImage => Boolean(image),
        ),
      });
      onGarmentDetailMockTaskCreated?.(task);
    } finally {
      setIsCreating(false);
    }
    return;
  }
  ...
```

### 4.2 共享提交路径（L688-729，garment-detail 应并入）

```ts
setError("");
setIsCreating(true);
try {
  const taskInputAssets = getInputAssetDescriptors();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CREATE_TASK_TIMEOUT_MS); // L113: 15_000
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      featureType: feature,
      inputAssetIds: taskInputAssets.map((asset) => asset.assetId),
      params: getParams(),
    }),
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(formatCreateTaskError(data.error, taskInputAssets));
  }
  const data = (await response.json()) as { taskId: string };
  onTaskCreated(data.taskId);
} catch (createError) {
  if (createError instanceof DOMException && createError.name === "AbortError") {
    setError("创建任务超时，请刷新任务列表确认是否已创建，或稍后重试");
    return;
  }
  setError(createError instanceof Error ? createError.message : "创建任务失败");
} finally { setIsCreating(false); }
```

即：所有其它 feature 共用「`POST /api/tasks` + `{featureType, inputAssetIds, params}`」+ 15s 超时 + `formatCreateTaskError`（MISSING_ASSET_ERROR_PREFIX 素材名回填，L489-506）+ `onTaskCreated(taskId)`。workbench 的 `onTaskCreated`（L772-776）置 activeTask 并 `loadTask(taskId)` 开始轮询。garment-detail 接入只需：删 §4.1 分支 + 补 §3 的 descriptors 分支 + 保留 §4.2 前置校验（主图必传、模型列表就绪）。

### 4.3 `getParams()` 的 garment-detail 分支（L508-539）

```ts
if (feature === "garment-detail") {
  const selectedModel =
    garmentDetailModels?.find((m) => m.algorithmModelId === garmentDetailModelId) ?? null;
  const referenceAssetIds = garmentDetailReferences
    .filter((image): image is UploadedImage => Boolean(image))
    .map((image) => image.assetId);
  const detailShots = buildGarmentDetailShots(garmentDetailCategory, referenceAssetIds);
  return {
    category: garmentDetailCategory,
    algorithmModelId: selectedModel?.algorithmModelId ?? "std-v1",
    algorithmModelName: selectedModel?.algorithmModelName ?? "标准版",
    modelTier: selectedModel?.tier ?? "standard",
    resolution: garmentDetailResolution,
    imageRatio: garmentDetailRatio,
    userPrompt: garmentDetailPrompt.trim(),
    aiAppendDescription: garmentDetailAiAppend,
    referenceImageCount: referenceAssetIds.length,
    detailShots,
    resultCount: detailShots.length,
    creditsCost: 0,
  };
}
```

与 PRD §7.3 请求示例逐字段吻合；PRD §6.4/§8.7 明确 `algorithmModelName`/`modelTier`/`referenceImageCount`/`detailShots`/`resultCount`/`creditsCost` 服务端必须重算，前端保持原样发送即可。

---

## 5. garment-detail UI 组件（消费方式说明）

- **`components/workbench/garment-detail-form.tsx`**（378 行）：纯受控表单（「状态与提交都由 LeftPanel 持有」，L10）。props：`mainImage / recognizePhase / category / models / selectedModelId / references[3] / prompt / aiAppendDescription / imageRatio / resolution` + 对应 onChange（L66-110）。消费 `GarmentDetailModelOption`（L26 import 自 mock 模块——接入后该类型应移到 `lib/types.ts` 或新前端 API 模块）。上传控件复用 `UploadBox`（`./upload-components`），主图单槽 + 参考图固定 3 槽（L251-264）。`recognizePhase: 'idle'|'processing'|'done'`（L29-30 导出类型）——接入后由 §6.2 的分类调用驱动。
- **`components/workbench/garment-detail-compare.tsx`**（156 行）：`GarmentDetailCompareStage({ detailUrl, originalUrl, compare })`（L138-155）。`compare && originalUrl` 时双 `ZoomablePane`（左原图右细节图），否则单窗格；`ZoomablePane` 内部滚轮/按钮缩放 0.5x–4x、拖拽平移、双击 1x↔2.5x（L20-136）。只消费 URL 字符串，**与任务 mock 无耦合**，唯一前提是真实任务的 `inputAssets[0].fileUrl` 可被浏览器直接加载（OSS 公共 URL 或同源 local URL——mock 阶段是 blob URL，真实阶段天然满足）。
- **shotProgress/results 消费点**：right-panel L142-162（结果网格，见 §2.9）。卡片按 `shot.shotId` 关联 `resultsByShotId` 与 `task.shotProgress`，即后端 `ShotProgress { shotId, label, status, message }` 与 `ResultAsset { shotId, label, url, downloadUrl, ... }` 必须与 mock 同构。

---

## 6. 其它联调触点

1. **模型列表**（`left-panel.tsx` L277-298）：进入 feature 时 `fetchGarmentDetailModels()` 拉一次，置默认模型并联动分辨率回退。替换为 `GET /api/garment-detail/models`（PRD §7.1），注意 503 `MODEL_UNAVAILABLE` 时表单态展示。
2. **文件名猜分类 mock**（`left-panel.tsx` L300-322）：主图上传后 1.2s 假识别，按文件名正则猜（`/裤/→bottoms`、`/裙/→dress`、`/鞋|包/→shoes-bags`、`/配饰|帽|围巾/→accessory`、默认 tops）。替换为 `POST /api/garment-detail/classify { assetId }`（PRD §7.2）；失败/降级时保持表单可用、回 `needsConfirmation` 手动确认，不阻塞提交（PRD §21.2）。状态机沿用 `recognizePhase`，fallback 时 `done` + 提示。
3. **FEATURE_WORKFLOWS**：`lib/types.ts` L874 `'garment-detail': 'garment_detail_mock_v1'` → 改 `garment_detail_v1`（PRD §20.3）。`GarmentDetailParams`（L434-453）增可选 `resolvedModelId` / `promptTemplateVersion`；`mockRetryCount`（L452）可删。
4. **测试**：`lib/garment-detail-mock.test.ts` 等 mock 专属测试随模块删除；node --test 跑 TS 的 import 限制（AGENTS.md 约定）不再适用。
5. `IMAGE_API_DEMO=1` 统一后端演示模式在 `lib/server/third-party-image-adapter.ts`（L289-293，`demoResults[input.featureType]`，未登记 garment-detail 会抛错）——若保留演示模式需在该表登记（PRD §21.5）。
