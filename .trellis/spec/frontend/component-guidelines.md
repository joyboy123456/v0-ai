# Component Guidelines

## Upload Size Validation

All upload entry points must call `validateUploadSize(file)` from `lib/utils.ts` before sending to the API.

```typescript
import { validateUploadSize } from '@/lib/utils'

const sizeError = validateUploadSize(file)
if (sizeError) {
  setError(sizeError)
  return
}
```

**Limit**: 8MB per file (`MAX_UPLOAD_BYTES = 8 * 1024 * 1024`).

**Why**: The image proxy (both Raycast and Google Gemini) rejects requests with images > ~10MB. At 8MB raw, base64 encoding inflates to ~10.7MB which is within the safe zone.

**Symptom if missing**: The proxy returns `Invalid JSON` or `Broken pipe` — not a helpful error message.

## Feature-Specific Forms

`LeftPanel` renders different forms per feature. The pattern is:

```tsx
{feature === 'ai-fashion-photo' ? (
  <AiFashionPhotoForm ... />
) : feature === 'element-replace' ? (
  ...
) : feature === 'photo-fission' ? (
  ...
) : (
  <PoseFissionForm ... />
)}
```

**Rule**: Only modify the branch for the feature you're working on. Do not touch other branches.

## AiFashionPhotoForm

The `ai-fashion-photo` form has two upload paths:
1. **Direct upload** via `FashionReferenceUploader` → calls `onAddUploadReference`
2. **From model library** via `CompanyModelStrip` → calls `onAddModelReference`

Both ultimately call `onAddFashionReference` in `Workbench`.

### CompanyModelStrip Behavior

- Shows first 5 models from `companyModels`
- Single click → adds model as reference image (immediate, no confirm)
- Models already in references show "已加" badge and are disabled
- "More" button → opens `MyModelLibraryPanel` in `RightPanel`

### MyModelLibraryPanel Behavior

- Single click → selects/deselects (multi-select)
- Double click → immediately adds that one model and closes panel
- "确定" button → adds all selected models
- Models already in references show "已在参考图" and are disabled
- Shows remaining slots count

## ModelCard Component

`ModelCard` (inside `right-panel.tsx`) handles rename + delete:

- **Rename**: Double-click on name text → inline input → Enter/blur to save, Esc to cancel
- **Delete**: Hover → 🗑️ icon → confirmation overlay → confirm to delete
- **Rename icon**: Hover → ✏️ icon → same as double-click

## Prompt Textarea Placeholder

The `ai-fashion-photo` prompt textarea uses a multi-line placeholder to guide users:

```
描述这张大片要怎么生成。多张参考图按上传顺序叫"图1 / 图2 / ..."。

例如：让图1的女孩穿上图2的连衣裙，戴上图3的帽子，保持图1人物的身份和姿势不变，干净的纯白棚拍背景。
```

**Why**: The model receives images as an array (Image 1, Image 2, ...) and the user must describe each image's role in the prompt. Without guidance, users write vague prompts and get poor results.

## PoseLibraryDialog: Multi-Select Modal (pose-fission)

`components/workbench/pose-library-dialog.tsx` 是项目第一个多选 Modal。当未来出现第二个多选 Modal 时，应优先考虑沿用本组件的状态模式（draft / commit 分离），而不是各自实现一套。

### 控制契约

- **Controlled mode**：`open: boolean` + `onOpenChange(open: boolean)`，宿主组件持有 open state
- **Initial selection 回填**：父组件传入 `initialSelectedIds: string[]`，Modal 打开时把 `internalSelectedIds` 初始化为 `initialSelectedIds` 的副本
- **Open-transition 初始化**：初始化必须只发生在「关闭 → 打开」这一刻；Modal 打开期间父组件可能因轮询、收藏、任务刷新等动作重渲染，不能因为 `initialSelectedIds` 是新数组引用就覆盖用户正在编辑的 draft
- **Draft / Commit 分离**：`internalSelectedIds` 是 Modal 内部 draft state，只在用户点「确定」时通过 `onConfirm(ids)` 传给父组件；点「取消」或关闭直接丢弃 draft

```tsx
const wasOpenRef = useRef(false)

useEffect(() => {
  if (!open) {
    wasOpenRef.current = false
    return
  }
  if (wasOpenRef.current) return

  wasOpenRef.current = true
  setInternalSelectedIds([...initialSelectedIds])
}, [open, initialSelectedIds])

<PoseLibraryDialog
  open={open}
  onOpenChange={setOpen}
  initialSelectedIds={selectedTemplateIds}
  maxSelection={9}
  onConfirm={(ids) => {
    setSelectedTemplateIds(ids)
    setOpen(false)
  }}
/>
```

### Behavioral Rules

- 点击 item 切换选中态；选中数已达 `maxSelection` 时禁止再选（不要静默 swap 旧选中项）
- 多组筛选（年龄 / 身体部位）顺序：先按年龄筛、再按身体部位筛，两组都是「全部 + N 个标签」的单选 chip
- 「重置」按钮把 `internalSelectedIds` 清空但不关闭 Modal（保留筛选条件）
- 「确定」按钮在选中数 < 1 时禁用（pose-fission 至少 1 个）

### 复用的 shadcn primitives

- `@/components/ui/dialog`（Dialog / DialogContent / DialogHeader / DialogTitle / DialogFooter）
- `@/components/ui/button`
- `@/components/ui/checkbox`

不要为多选 Modal 自造 Dialog 容器；本项目 Dialog 视觉与无障碍交互已由 shadcn 统一。

### 何时抽象通用 `<MultiSelectDialog>`

**现在不要抽**：仅 1 处使用。当出现第二个多选 Modal 时，按本组件接口形状（open / initialSelectedIds / maxSelection / onConfirm / 单组或多组筛选）抽象。filter group 的数据形状是最大变量，抽象时应允许 caller 自定义 filter 子树而不是写死「年龄 + 身体部位」。
