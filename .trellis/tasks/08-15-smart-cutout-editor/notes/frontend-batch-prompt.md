# Frontend Batch Dispatch Prompt (draft, to send after backend batch lands)

Active task: .trellis/tasks/08-15-smart-cutout-editor

你已经是 trellis-implement 子代理，直接实现，不要再派发子代理。工作目录 /opt/yibai-fission。

先读：
1. .trellis/tasks/08-15-smart-cutout-editor/prd.md（§37 决策、§39 方案一）
2. .trellis/tasks/08-15-smart-cutout-editor/info.md（§2 分辨率体系、§4 前端详细设计）
3. .trellis/tasks/08-15-smart-cutout-editor/research/codebase-findings.md
4. AGENTS.md

# 批次范围：只做前端（Batch 2）

后端已就绪（Batch 1）：POST /api/cutout-sessions、GET /api/cutout-sessions/{id}/masks/{category}、POST /api/cutout-sessions/{id}/export、POST /api/events。实现前先读后端代码确认 DTO 字段（lib/server/cutout-session-service.ts、app/api/cutout-sessions/**）。

## 1. 新组件 components/workbench/cutout-editor-dialog.tsx
- props 兼容旧 ImageEditorDialog：{ open, image: EditableImage|null, onOpenChange, onApply: (asset: CutoutAsset) => void }
- 状态机：init → preparing（智能抠图准备中…）→ ready（空选区，默认悬停预览模式）→ editing → exporting；错误态展示 advice + 重试
- 打开时 POST /api/cutout-sessions {assetId, scene:'garment'}；成功后取回 session DTO（imageUrl 为画布底图，imageWidth/Height 为工作尺寸，originalWidth/Height + scale）
- 左画布（ImageCanvasViewport + overlay canvas）：prepared 底图 + finalMask 蓝色蒙版(30-45% alpha) + 悬停高亮 + 笔刷光标圈
- 右画布（ImageCanvasViewport，checkerboard）：原图 × finalMask 透明预览，与左画布共享 zoom/pan（同一 displaySize，scrollLeft/Top 联动）
- 工具（互斥）：悬停预览+点击增选/减选（默认增选模式）、涂抹、擦除、反选、撤销/重做/重置、笔刷大小(5-200 默认40，原图坐标语义)、适应画布、缩放 10%-800%（Ctrl+滚轮以鼠标为中心）、空格/中键 pan
- 交互原语参照 components/workbench/face-mask-painter-dialog.tsx（getPoint/paintTo/pointer capture/pan/zoom）
- undo/redo：finalMask canvas 的 PNG dataURL 快照栈 ≤30，新操作清 redo；重置=清空 finalMask（可撤销）
- 完成按钮：准备中/空选区/处理中/导出中禁用；点击完成 → POST export { maskDataUrl } → onApply(asset) 关闭；未保存修改关闭时二次确认
- 埋点：PRD §31 事件 → fetch('/api/events', {method:'POST', keepalive:true, body})，失败静默

## 2. Web Worker components/workbench/cutout-region-worker.ts
- 输入：{ category, maskImageData(工作尺寸灰度), indexScale }，输出候选区域：连通区域分析（BFS，Uint32 label）
- 输出每区域：{ id, category, labelRange, bbox, area } + 降采样 regionIndexMap(Uint32, ≤1024) + previewMask（ImageBitmap 或 ImageData，≤1024）
- main thread 用 transferable 传参；worker 里不做任何网络

## 3. 悬停命中（PRD §39.4/39.5）
- pointer → 工作坐标 → index 坐标 → regionIndexMap → regionId
- 命中优先级：具体服饰(tops/coat/skirt/pants/bag/shoes/hat) > skin/hair > body > common；同级取 area 最小
- 高亮：previewMask 蓝色 overlay；点击：增选 finalMask ∪ regionMask（全分辨率=工作尺寸），减选 finalMask − regionMask

## 4. 入口替换
- components/workbench/upload-components.tsx 与 left-panel.tsx：ImageEditorDialog → CutoutEditorDialog（import 替换即可，props 兼容）
- 旧 image-editor-dialog.tsx 删除；CutoutAsset/EditableImage 类型保留在新组件导出（或迁到 lib/types.ts，以改动最小为准）

## 5. 质量门禁
- npx tsc --noEmit；npx eslint <changed>；npx tsx --test 全量（后端测试不回归）
- 移动端：沿用全屏弹窗布局（桌面优先，本期不做移动端专门适配）；样式全部语义 token；hover 操作补 max-md:opacity-100

## 铁律
- 不提交 git；不 push；不动后端代码（除非发现契约 bug，需在回复里明确列出理由）
- 回复末尾：改动文件清单 + 验证命令结果 + 与后端契约不一致处
