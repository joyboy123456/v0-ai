# 代码摸底：可复用基础设施与现状（2026-08-15）

调研人：主会话。目的：为智能抠图编辑器（图片分层）技术设计提供现状依据。

## 1. 现有抠图链路（已上线 common 模式；upper/lower 未提交）

- 路由：`app/api/assets/[assetId]/cutout/route.ts`
  - `POST /api/assets/{assetId}/cutout?mode=common|upper|lower`
  - 依赖注入式 handler（`createCutoutPostHandler`），认证走 `requireUser`，错误统一 `{error, code, advice, retryable, requestId?}`
  - 未提交改动：mode 校验（非法返回 400 `invalid_cutout_mode`）
- 服务：`lib/server/asset-cutout-service.ts`
  - `cutoutAssetForUser(assetId, userId, mode, deps?)`
  - 幂等：按 `v1\0userId\0assetId[\0mode]` sha256 派生稳定 assetId（common 兼容旧 hash）
  - 并发去重：`globalThis` 上的 inFlight Map
  - 错误分类：`AssetCutoutError`（12 种 code，中文 message/advice，retryable/requestId）
  - 读图：dataURL / `/local-assets/*` `/generated/*` / OSS 公网 URL（自有 OSS 走认证读，否则安全公网下载）
- 适配器：`lib/server/aliyun-cutout-adapter.ts`（885 行，基础设施最全）
  - `callAliyunRpc`：HMAC-SHA1 RPC 签名调用（imageseg + viapi-utils 两个 endpoint）
  - `uploadViapiTemporaryInput`：GetOssStsToken + OSS SDK 直传 viapi 临时桶
  - `prepareAliyunCutoutInput`：sharp 重采样到 ≤1999px + JPEG 质量阶梯压到 ≤3MB
  - `segmentCommonImage` / `segmentCloth`（OutMode=1 + ClothClass.N）
  - `downloadCutoutResult`：安全下载 ≤某上限
  - `restoreCutoutToOriginalCanvas`：alpha 提取 + dest-in 合成回原图画布（sharp）
  - `runAliyunCutout`（入口，mode 分派）
  - 错误：`AliyunCutoutProviderError`（config/auth/invalid_input/no_subject/rate_limit/timeout/invalid_result/network/server_error）
- 未提交改动：`CutoutMode` 类型、SegmentCloth、route mode 校验、editor 三工具 UI（见 git diff）

## 2. 前端现状

### 现有抠图编辑器 `components/workbench/image-editor-dialog.tsx`（509 行）
- 全屏 Dialog（h-dvh），左工具栏（3 个抠图工具按钮）+ 中间 `ImageCanvasViewport`
- 单画布：结果（透明 PNG）与原因切换显示；有撤销/恢复/恢复原图/缩放
- 未提交改动已支持三模式（一键抠图/上装/下装），结果缓存于 `derivedAssets: Partial<Record<CutoutMode, CutoutAsset>>`
- **无**：点击选区、画笔、蒙版、双画布、反选 —— 这正是新 PRD 要补的

### 画布基础
- `components/workbench/image-canvas-viewport.tsx`：`<img>` 视口（overflow-auto，displayWidth/Height 控制缩放），支持 checkerboard、onWheel、children overlay。**不是 canvas 渲染**。
- `components/workbench/face-mask-painter-dialog.tsx`（446 行）—— **重要可复用参考**：
  - canvas overlay 铺在 ImageCanvasViewport 上（absolute inset-0，宽高 = 原图尺寸）
  - 坐标转换：`((clientX - rect.left) / rect.width) * imageWidth`（rect 由 CSS 缩放）
  - 涂抹/橡皮：round cap stroke，destination-out 擦除
  - 历史：每次落笔 push `canvas.toDataURL()` 快照（最多 15 条），undo 回放
  - 空格/中键拖动 pan（改 scrollLeft/Top），Ctrl+滚轮缩放（0.35–3）
  - 笔刷滑杆 12–96
  - 判定是否有内容：getImageData alpha 扫描
- 该组件可整体作为新编辑器「涂抹/擦除」交互的原型；但它单画布、历史是位图快照（新 PRD 需要 undo/redo 栈 + 多 mask 语义，设计会不同）

### 入口点（现有 2 个，均已接 ImageEditorDialog）
1. `components/workbench/upload-components.tsx`（436 行）：单图上传后「编辑」，onApply 替换 UploadedImage（assetId/preview/name/width/height）
2. `components/workbench/left-panel.tsx`（1753 行 editingReference、2381 行渲染）：参考图「编辑」，onApply 替换参考（含 pinned id 迁移）
- 生成结果图（right-panel / image-task-card）目前**没有**编辑入口

### 移动端
- `hooks/use-mobile.ts`：768px 断点；workbench 有 MobileShell
- 现编辑器是全屏 h-dvh 布局，移动端可用但双画布并排在手机上不成立（PRD 未涉及移动端方案，需确认）

## 3. 后端基础设施

- `createAsset`（task-store.ts:409）：支持稳定 assetId、`body: Buffer` 直接持久化（storage-adapter 写 R2/本地），返回 URL —— Mask 和透明 PNG 落库可直接复用
- `AssetRecord`：assetId/userId/projectId/fileName/fileUrl/fileType/dataUrl?/width/height/createdAt/taskId?/favorited?
- storage：`lib/server/storage/storage-adapter.ts` + `oss-client.ts` + local repo
- **计费**：抠图不扣费（credits 只在生成任务上：AI 服装大片 35×resultCount；pose-fission/photo-fission 0）。新编辑器 MVP 可维持免费，无需计费集成
- 鉴权：`requireUser`（多用户隔离，asset 归属校验在 service 层）
- 图片安全下载：`lib/server/safe-remote-image.ts`；本地图读取：`getLocalImageForPublicUrl`
- sharp 已在依赖中，服务端可做 mask 合成/导出/bbox 计算

## 4. 埋点现状

- 无埋点基础设施。`app/layout.tsx` 只有 Vercel `<Analytics/>`（自建 ECS 部署下基本无效）
- 项目惯例是服务端 `console.info` JSON 日志（pm2 日志 + 故障排查），失败任务已有 LLM 诊断
- 结论：MVP 埋点建议 = 前端 `fetch('/api/events', {method:'POST', keepalive:true})` 或服务端 console.info，不引入第三方 SDK

## 5. 待确认问题（brainstorm 用）

1. 与现有 image-editor-dialog 的关系：替换 vs 共存
2. 移动端形态：标签切换 vs 上下堆叠 vs 仅桌面
3. 入口范围：仅现有 2 入口 vs 加上生成结果图入口
4. 上游 API 选型（取决于 aliyun-interactive-segmentation.md 调研）
5. 埋点方案确认（服务端日志即可？）
