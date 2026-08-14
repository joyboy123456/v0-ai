# 智能抠图编辑器（服饰智能分层）技术设计 v2

状态：定稿（方案一已确认）。上游依据：`research/aliyun-interactive-segmentation.md` + SegmentCloth 官方 API meta（ClothClass: tops/coat/skirt/pants/bag/shoes/hat；响应 `Data.Elements[].ClassUrl` 按类别返回 URL）。

## 1. 总体架构

```
前端 cutout-editor-dialog（新，替换 image-editor-dialog 的两处使用）
  ├─ 左画布：prepared 原图 + 选区蓝色蒙版 + 悬停高亮 + 笔刷 overlay
  ├─ 右画布：原图 × finalMask 透明预览（棋盘格），与左画布共享 zoom/pan
  ├─ Web Worker：类别 Mask 连通区域分析 → CandidateRegion + regionIndexMap(≤1024px)
  └─ 工具：悬停预览/点击增删（语义区域）、涂抹/擦除/反选（纯前端）、撤销重做、导出

后端 cutout-session-service（会话在内存，TTL 60 分钟）
  ├─ POST /api/cutout-sessions                     prepare：一次 SegmentCloth(7类) + Skin/Hair/Body/Common
  ├─ GET  /api/cutout-sessions/{id}/masks/{category}  准备期缓存的类别 Mask（PNG 二进制，带鉴权）
  ├─ POST /api/cutout-sessions/{id}/refine         可选：RefineMask 边缘细化
  ├─ POST /api/cutout-sessions/{id}/export         合成透明 PNG + Mask + bbox，落库资产（幂等）
  └─ POST /api/events                              轻量埋点（结构化日志）
```

## 2. 分辨率体系（三档）

| 档位 | 尺寸 | 用途 |
| ---- | ---- | ---- |
| 原图 | originalWidth/Height | 最终导出（透明 PNG 与 Mask 尺寸必须与原图一致，PRD §19.3） |
| 工作图 prepared | ≤1999px 长边（沿用 `prepareAliyunCutoutInput`） | 阿里 API 输入；前端画布/笔刷/连通分析/finalMask；导出时由服务端放大回原图 |
| 索引图 index | ≤1024px 长边 | regionIndexMap 悬停查找 + previewMask 悬停高亮（省内存） |

- prepare 时保存 scale = prepared/original，前端坐标换算与后端导出共用。
- 导出：客户端把 prepared 尺寸 finalMask（dataURL）提交 → 服务端可选 RefineMask → alpha 放大回原图 → 与原图 dest-in 合成透明 PNG + 黑白 Mask PNG（白=保留）。

## 3. 后端详细设计

### 3.1 `lib/server/cutout-session-service.ts`
- `CutoutSessionRecord`：sessionId、userId、sourceAssetId、prepared 图信息（buffer/URL、宽高）、original 宽高、scene、`categoryMasks: Map<CutoutCategory, Buffer>`（prepared 尺寸灰度 PNG）、createdAt。
- 注册表：`globalThis` in-memory Map（sessionId → record）+ TTL 清理（60 分钟，惰性清扫）。
- `createGarmentCutoutSession(userId, assetId)`：
  1. 读原图（复用 `asset-cutout-service.ts` 的读取逻辑，抽公共函数或直接复用 `readAssetImageBuffer`）
  2. `readSourceCanvasDimensions` + `prepareAliyunCutoutInput` + `uploadViapiTemporaryInput`（一次上传，后续接口共用该 URL）
  3. `SegmentCloth` 一次调用 7 类（`ClothClass.1..7`），解析 `ClassUrl` 映射（新 adapter 函数 `segmentClothByClass`，保留现有 `segmentCloth` 兼容）
  4. `SegmentSkin` `SegmentHair` `SegmentBody` `SegmentCommonImage` 各一次（新 adapter 函数，通用化现有 `segmentCommonImage` 模式）
  5. 每个类别：下载结果 → 提取 alpha → 转灰度 PNG（prepared 尺寸）→ 存入 session
  6. 失败降级：单个类别失败只记 warn 并跳过该类别（不整体失败）；全部失败才抛错。**不无脑全调**：person/product 场景本期只留 scene 参数与结构，garment 先落地
- 语义：`select`/`subtract` 不在后端（点击命中的是前端已拆好的候选区域，纯前端位运算）
- `exportCutoutSession(sessionId, userId, finalMaskDataUrl, options)`：
  - 校验 session 归属；解析 finalMask（prepared 尺寸灰度）→（可选 `refineMask`：RefineMask(ImageURL+MaskImageURL)）→ alpha 放大到原图 → 与原图合成透明 PNG → 黑白 Mask PNG（原图尺寸）→ bbox（mask 非零外接矩形）→ `createAsset` 落库（派生稳定 assetId：`cutout_export_{hash(session+mask)}` 幂等）
  - 返回 `{ asset: CutoutAsset, mask: { assetId, url, width, height }, boundingBox }`
- 错误模型：复用 `AssetCutoutError` 风格 + 会话错误（session_not_found / session_expired / empty_mask / refine_failed 等），中文 message/advice/retryable/requestId。

### 3.2 `lib/server/aliyun-cutout-adapter.ts` 扩展
- `segmentClothByClass(imageUrl, config, classes)`：解析 `ClassUrl`（key=类别，value=URL），返回 `Record<string, {imageUrl, requestId}>`；`ClassUrl` 缺失时回退 `Elements[].ImageURL`。
- `segmentSkin/segmentHair/segmentBody/segmentCommodity/segmentHDCommonImage`：模式照抄 `segmentCommonImage`（Action + ImageURL → Data.ImageURL）。
- `maskPngToGrayscaleAlphaPng`：把四通道 PNG 的 alpha 提成灰度 PNG（白=前景）。
- 保持现有导出函数签名不变，老测试不动。

### 3.3 路由
- `app/api/cutout-sessions/route.ts`（POST create）
- `app/api/cutout-sessions/[sessionId]/masks/[category]/route.ts`（GET，PNG 二进制，`Cache-Control: private, max-age=300`）
- `app/api/cutout-sessions/[sessionId]/refine/route.ts`（POST）
- `app/api/cutout-sessions/[sessionId]/export/route.ts`（POST）
- `app/api/events/route.ts`（POST，事件白名单 + requireUser + console.info 结构化日志）
- 全部依赖注入 handler（对齐现有 cutout route 风格）+ `node:test` 单测（tsx runner）

### 3.4 并发与版本
- 会话操作串行化：session 内 `opQueue`（Promise 链）避免同一会话并发写 mask 状态错乱；`requestVersion` 由前端递增，服务端原样回显（PRD §26）
- prepare 幂等：同 assetId+scene 复用未过期会话（stable sessionId hash），避免重复扣费

## 4. 前端详细设计

### 4.1 组件
- `components/workbench/cutout-editor-dialog.tsx`：props 兼容现有 `ImageEditorDialog`（open/image/onOpenChange/onApply），两入口改 import 即可
- `components/workbench/cutout-region-worker.ts`：连通区域分析（BFS/两遍法，Uint32 label map）
- 复用 `ImageCanvasViewport`（左：原图+蒙版 overlay；右：checkerboard 透明预览）

### 4.2 状态与数据
- `CategoryMask`：{ category, maskCanvas(prepared 尺寸灰度), bbox }
- `CandidateRegion`：{ id, category, labelMap 区间, previewMask(ImageBitmap, ≤1024), bbox, area }（PRD §39.3）
- `regionIndexMap`：≤1024px Uint32Array（regionId per pixel，0=空）
- `finalMask`：prepared 尺寸 canvas（灰度）；undo/redo = PNG dataURL 快照栈（≤30 条）
- 命中规则（PRD §39.5）：category 优先级 具体服饰(7类) > skin/hair > body > common；同级取 area 最小者

### 4.3 交互
- 悬停：pointer → 左画布 rect 比例 → prepared 坐标 → 换算 index 坐标 → regionIndexMap → regionId → 高亮（把 previewMask 以蓝色 30-45% alpha 画到 overlay）
- 点击：增选 `finalMask ∪ regionMask`；减选 `finalMask − regionMask`；push 快照
- 涂抹/擦除：canvas 笔画实时绘制（参照 face-mask-painter-dialog 的 getPoint/paintTo/pan/zoom 原语）；一笔=一条历史
- 反选：`finalMask = 1 − finalMask`；重置=清空 finalMask（可撤销）
- 缩放：10%-800%，Ctrl+滚轮以鼠标为中心；空格/中键 pan；双画布共享 zoom/pan（左右 scroll 联动）
- 完成：禁用条件=准备中/空选区/处理中/导出中；导出后 `onApply(asset)` 并关闭
- 未保存退出：有选区修改时二次确认（PRD §20）
- 埋点：PRD §31 事件表 → `POST /api/events`（keepalive）
- 桌面优先；移动端沿用全屏弹窗不做双画布专门适配（本期约定）

### 4.4 性能
- 悬停零网络（regionIndexMap 查表）
- 画笔仅本地绘制；连通分析在 Worker，不阻塞 UI
- 大图（>1999px）自动降级到 prepared 尺寸交互，导出服务端放大回原图

## 5. 入口改造
- `upload-components.tsx`、`left-panel.tsx`：把 `ImageEditorDialog` 换成 `CutoutEditorDialog`（props 兼容）
- 旧 `image-editor-dialog.tsx` 删除（新编辑器为准，PRD §37）；`CutoutAsset` 类型迁移到新组件或 types.ts

## 6. 质量门禁
- `npx tsc --noEmit`、`npx eslint <changed>`、`npx tsx --test` 全量绿
- 后端单测：service（prepare 类别解析/幂等/错误映射/导出 bbox+合成）、adapter（ClassUrl 解析/新 Action 参数）、路由 handler、events 白名单
- 验收对齐 PRD §32（服饰场景用例）+ §39.6 能力边界表

## 7. 明确不做（P1/P2）
- person/product 场景（结构预留）
- SAM2/任意对象点选、多图层拆分（Qwen-Image-Layered）、PSD 导出、移动端双画布适配
- RefineMask 已实现但 UI 先不挂开关（导出时默认不细化），P1 再上
