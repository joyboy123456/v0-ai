# State Management

## Architecture

All state lives in `components/workbench/workbench.tsx` (the root) and is passed down as props. There is no global state library (no Zustand, no Redux).

```
Workbench (root state owner)
├── FeatureSidebar          (reads: currentFeature; writes: setCurrentFeature)
├── LeftPanel               (reads: feature, selectedPoseCase, companyModels,
│                            fashionReferences; writes: via callbacks)
└── RightPanel              (reads: feature, tasks, companyModels, fashionReferences;
                             writes: via callbacks)
```

## State Inventory (Workbench)

| State | Type | Persistence | Purpose |
|---|---|---|---|
| `currentFeature` | `FeatureType` | none | Active tab |
| `activeTaskId` | `string \| null` | none | Task being polled |
| `tasks` | `GenerationTask[]` | server JSON | All tasks |
| `photoFissionCaseRequest` | `{ requestId: number, case: PhotoFissionCase } \| null` | none | Photo fission 一键做同款派发载体 |
| `poseFissionCaseRequest` | `{ requestId: number, case: PoseFissionCase } \| null` | none | Pose fission 一键做同款派发载体 |
| `companyModelLibraryRequestKey` | `number` | none | Trigger right panel to open model library tab |
| `companyModels` | `CompanyModel[]` | **localStorage** | User's saved model images |
| `companyModelsHydrated` | `boolean` | none | SSR hydration guard |
| `fashionReferences` | `FashionReferenceImage[]` | none | Current session reference images |

## Critical: SSR Hydration Pattern

**Problem**: `companyModels` is loaded from `localStorage`, which doesn't exist on the server. Initializing state directly from `localStorage` causes React hydration mismatch.

**Solution**: Always initialize to empty, hydrate in `useEffect`:

```typescript
// ✅ Correct
const [companyModels, setCompanyModels] = useState<CompanyModel[]>([])
const [companyModelsHydrated, setCompanyModelsHydrated] = useState(false)

useEffect(() => {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) setCompanyModels(JSON.parse(raw))
  } catch { /* ignore */ }
  finally { setCompanyModelsHydrated(true) }
}, [])

// Guard writes with hydration flag to avoid overwriting storage on first render
useEffect(() => {
  if (!companyModelsHydrated) return
  window.localStorage.setItem(key, JSON.stringify(companyModels))
}, [companyModels, companyModelsHydrated])
```

```typescript
// ❌ Wrong — causes hydration mismatch
const [companyModels, setCompanyModels] = useState<CompanyModel[]>(() => {
  if (typeof window === 'undefined') return []
  return JSON.parse(localStorage.getItem(key) ?? '[]')
})
```

The same pattern applies to `favorites` in `RightPanel`.

## fashionReferences: Lifted State

`fashionReferences` is owned by `Workbench` (not `LeftPanel`) because both panels need to read/write it:
- `LeftPanel` adds references (upload or from model library)
- `RightPanel` reads `fashionReferences.length` to show remaining slots in model library

**Max**: 10 references. Enforced in `handleAddFashionReference` in `Workbench`.

## Model Library → References Flow

When a user selects models from `MyModelLibraryPanel`:
1. `onConfirm(models: CompanyModel[])` is called in `RightPanel`
2. Each model is converted to a `FashionReferenceImage` with `source: 'model'`
3. `onAddFashionReference` is called for each (defined in `Workbench`)
4. The reference appears in the `FashionReferenceUploader` grid in `LeftPanel`

This means **model selection = adding a reference image**. There is no separate "selected model" state.

## Task Polling

Active task is polled every 900ms via `setInterval` in `Workbench`:

```typescript
useEffect(() => {
  if (!activeTaskId) return
  const id = window.setInterval(() => void loadTask(activeTaskId), 900)
  void loadTask(activeTaskId)
  return () => window.clearInterval(id)
}, [activeTaskId, loadTask])
```

Polling stops when `activeTaskId` becomes null (user navigates away or task completes).

## Case Request Dispatch Pattern (fission features)

`photo-fission` 与 `pose-fission` 共享一套「一键做同款」派发模式。Workbench 持有：

```ts
const [photoFissionCaseRequest, setPhotoFissionCaseRequest] = useState<
  { requestId: number; case: PhotoFissionCase } | null
>(null)
const [poseFissionCaseRequest, setPoseFissionCaseRequest] = useState<
  { requestId: number; case: PoseFissionCase } | null
>(null)
```

**派发流程**（RightPanel 案例库 → LeftPanel 表单回填）：

1. 用户在 `RightPanel` 的案例库（`PhotoFissionCaseLibrary` / `PoseFissionCaseLibrary`）点「做同款」
2. Workbench 的 `handleSelectXxxFissionCase(case)` 同时：
   - `setCurrentFeature('photo-fission' | 'pose-fission')`
   - `setXxxFissionCaseRequest({ requestId: Date.now(), case })`
3. `LeftPanel` 收到 `xxxFissionCaseRequest` prop，`useEffect([request])` 触发：
   - 把 `case` 的 model / category / poseTemplateIds / imageRatio / resolution 字段映射到本地表单 state
   - 完成后**不要**清空 request（Workbench 通过 `requestId` 变化保证下次点击 case 仍能触发新一次 effect）

**为什么用 `requestId: number` 而不是 boolean**：同一个 case 第二次点击时 `case` 引用不变，effect 不会重跑；`requestId: Date.now()` 强制让 deps 变化。

**主图自动上传差异**：
- `photo-fission`：派发同时自动 fetch case 主图并塞入 `fashionReferences`
- `pose-fission`：只回填表单字段，主图需用户手动上传（因为 pose-fission 主图通常是用户自己的模特成片，案例库主图仅作灵感参考）

**禁止**：
- 把 case payload 通过 URL query / localStorage 传递（同源 SPA 内 setState 直传即可）
- 在 LeftPanel 内派发后清空 request（会让 useEffect 反复触发 → 把用户改过的字段重置）
- 跨 feature 复用同一个 `caseRequest`（每个 fission feature 应保持独立 state slot，避免类型 union 引入分支）
