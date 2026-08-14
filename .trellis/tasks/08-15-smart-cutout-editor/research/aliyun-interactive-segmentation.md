# 阿里云交互式分割能力调研（智能抠图编辑器选型）

> 调研日期：2026-08-15 ｜ 目标：为「智能抠图编辑器（图片分层）」选型阿里云上游能力
> 现状：项目已接入阿里云视觉智能开放平台 imageseg（`SegmentCommonImage` 通用分割 / `SegmentCloth` 服饰分割），RPC 签名、临时 OSS 上传、结果下载、画布恢复均有现成实现（`lib/server/aliyun-cutout-adapter.ts`）。
> 一句话结论：**阿里云曾有两款交互式分割 API（交互式全图分割 / 交互式涂抹分割），但均已于 2025-10-14 官方下架，现（2026-08）不可用；imageseg 类目本身没有任何点选/涂抹式交互 API。建议采用「imageseg 一键自动分割（现有）+ 开源 SAM2 自托管做点选/涂抹交互 + RefineMask 边缘细化 + 客户端合成 Mask/导出」的组合方案。**

---

## 1. API 候选清单

### 1.1 阿里云曾提供的交互式分割 API（均已下架，不可选）

| API 名（Action） | 产品/版本 | 类目 | 状态 | 能力 |
|---|---|---|---|---|
| **InteractiveFullSegmentation**（交互式全图分割） | aigen / 2024-01-11 | 创新专区（生成专区） | **已下架**：2025-08-14 起停止新用户开通，2025-10-14 起下架，不再支持任何用户调用 | 单张图片输入、无需任何提示，自动返回图中**所有元素**的分割 mask（SAM 自动分割风格）；用户"点选"是在**客户端**从返回的多 mask 中挑选 |
| **InteractiveScribbleSegmentation**（交互式涂抹分割） | aigen / 2024-01-11 | 创新专区（生成专区） | **已下架**：同上 | 输入原图 + 当前 Mask + 正/负向涂抹轨迹图，返回修正后的分割结果，支持增选/减选 |

官方停服公告：[关于视觉智能开放平台部分公测能力停止服务的公告](https://help.aliyun.com/zh/viapi/product-overview/announcement-on-the-discontinuation-of-certain-public-testing-services-on-the-visual-intelligence-open-platform)（含 InteractiveScribbleSegmentation、InteractiveFullSegmentation，另含手势识别、视频降噪、人脸美型、Cosplay 动漫人物生成等公测能力）。

### 1.2 imageseg（分割抠图）类目现有能力（全部可用，但均无交互入参）

分割抠图类目全部能力清单见 [分割抠图介绍](https://help.aliyun.com/zh/viapi/developer-reference/segmentation-cutout-is-introduced)，包括：

- **人像分割**：人体分割 SegmentBody、头像分割 SegmentHead、头发分割 SegmentHair、皮肤分割 SegmentSkin
- **商品分割**：商品分割 SegmentCommodity、服饰分割 SegmentCloth
- **通用分割**：通用分割 SegmentCommonImage、天空分割、食品分割 SegmentFood、**Mask精细化分割 RefineMask**、天空高清分割 SegmentHDSky、通用高清分割 SegmentHDCommonImage、高清人体分割
- **分割替换**：天空替换 ChangeSky

关键点：**整个 imageseg 类目没有"交互式/点选式"API**——全部是"输入图 → 输出前景图/mask"的一键式能力，没有任何正负点、涂抹轨迹、当前 Mask 等交互输入参数。

### 1.3 与交互编辑强相关的可复用能力

| API 名（Action） | 类目 | 说明 | 适配角色 |
|---|---|---|---|
| SegmentCommonImage（通用分割） | imageseg | 自动识别视觉中心主体，返回 4 通道透明 PNG；支持 `ReturnForm=mask/whiteBK/crop` | 自动主体分割（现有已接入） |
| SegmentCloth（服饰分割） | imageseg | 按 `ClothClass.N`（tops/pants/skirt 等）组合抠出服饰，4 通道 PNG | 上装/下装自动分割（现有已接入） |
| SegmentHDCommonImage（通用高清分割） | imageseg | 更高清的主体分割，输出 PNG 透明图，质量优于通用分割 | 自动主体分割（质量优先） |
| RefineMask（Mask 精细化分割） | imageseg | 输入原图 + 粗糙 Mask（`ImageURL` + `MaskImageURL`，分辨率需一致），输出精细化 mask | **交互编辑后的边缘细化**（把客户端合并/涂抹产生的粗糙 mask 交给云端细化） |
| GetAsyncJobResult | viapi 通用 | 异步任务结果查询 | 异步能力配套（当前两个同步 API 用不到） |

文档：[通用分割](https://help.aliyun.com/zh/viapi/developer-reference/api-k8cs8t)、[Mask精细化分割](https://help.aliyun.com/zh/viapi/developer-reference/api-w9sg6h)。

### 1.4 候选补充：通义/第三方/开源

- **Qwen-Image-Layered（图片分层，开源模型）**：2025-12-19 发布，Apache-2.0，将单图分解为多个 RGBA 图层（背景 + 各前景元素），天然满足"图片分层"需求。官方仓库 [QwenLM/Qwen-Image-Layered](https://github.com/QwenLM/Qwen-Image-Layered)（ModelScope 权重 [Qwen/Qwen-Image-Layered](https://modelscope.cn/models/Qwen/Qwen-Image-Layered) + 在线 Demo）。**未在阿里云百炼上架**（未检索到官方 API），可通过 ModelScope 权重自托管，或经第三方聚合 API 调用（[302.AI](https://302.ai/product/detail/302ai-qwen-image-layered)、[fal.ai](https://fal.ai/learn/devs/qwen-image-layered-image-to-image-developer-guide)）。
- **通义万相 wanx2.1-imageedit（百炼）**：通用图像编辑，支持基于 mask 的局部重绘（涂抹编辑），见 [wanx2.1-imageedit](https://help.aliyun.com/zh/model-studio/wanx2-1-imageedit)。属**生成式编辑**（重绘被涂抹区域），不是分割/取 Mask，仅可作为"涂抹擦除/局部重绘"的补充能力。
- **火山引擎**：仅提供自动抠图类（通用图像分割、人像抠图、商品分割等，[智能分割](https://www.volcengine.com/docs/86081/1660405)），**无交互式点选/涂抹分割**；其 inpainting 涂抹编辑/涂抹消除亦已下线（[inpainting涂抹编辑（下线中）](https://www.volcengine.com/docs/86081/1804490)）。
- **开源交互式分割**：Meta **SAM / SAM2**（支持正/负点、框、mask 提示，一次调用直接得到修正后的 mask）；**BiRefNet**（高分辨率背景移除，质量领先）；**RMBG-1.4/2.0**（快速背景移除）。均可在 ModelScope/HuggingFace 获取权重自托管。

---

## 2. 能力映射表（PRD 能力 vs API 入参）

| PRD 能力 | 阿里云现役 API | 已下架的 ISS（参考其入参形态） | 开源方案 SAM2 | 备注 |
|---|---|---|---|---|
| 正向点增选选区 | ❌ 无（imageseg 无任何点输入） | `PosScribbleImageUrl`：正向涂抹轨迹图（与原图同分辨率，白笔迹/黑底，≤5MB） | `point_coords`（原图像素坐标数组）+ `point_labels=[1]` | 阿里云把"点"也做成涂抹图（笔迹），无纯坐标点参数 |
| 负向点减选选区 | ❌ 无 | `NegScribbleImageUrl`：负向涂抹轨迹图（同上） | `point_labels=[0]` | 同上 |
| 画笔涂抹增选 | ❌ 无 | `PosScribbleImageUrl`（同涂抹图） | `mask_input`（当前 mask）或涂抹区域转点集 | — |
| 画笔涂抹擦除 | ❌ 无 | `NegScribbleImageUrl` | `mask_input` + 负向提示，或客户端位运算 | — |
| 自动主体分割（前景/背景） | ✅ `SegmentCommonImage` / `SegmentHDCommonImage`（仅 `ImageURL`） | —（IFS 可自动返回全图所有元素 mask） | SAM2 自动模式 / RMBG / BiRefNet | 现有 adapter 已实现 |
| 反选 | ⚠️ 客户端实现（mask 位取反，免费即时） | — | 客户端实现 | 阿里云无"反选"入参 |
| 导出透明 PNG + Mask | ✅ 客户端从 4 通道 PNG 提取 alpha 生成 mask；`SegmentCommonImage` 亦支持 `ReturnForm=mask` 直接返回单通道 mask | `ReturnForm=only_alpha`（单通道 mask）/ `rgb_alpha`（透明 PNG）/ `white_background`；`ReturnFormat=PNG/JPG` | 客户端导出 | 现有 `restoreCutoutToOriginalCanvas` 可复用 |
| 边缘精细化 | ✅ `RefineMask`（`ImageURL` + `MaskImageURL`，分辨率需一致） | `PostprocessOption=edgerefine/maskrefine`、`EdgeFeathering=true` | 本地形态学/CRF 或跳过 | 推荐：交互编辑后调 RefineMask 细化边缘 |

**坐标/掩膜格式结论**：
- 阿里云（已下架 ISS）：**无坐标参数**，正/负向输入均为**与原图同分辨率的涂抹轨迹图片**（客户端把点击/画笔栅格化成图），`MaskImageUrl` 为当前 mask 图（≤5MB、与原图分辨率一致）；`IntegratedMaskUrl` 可把"初始 mask（R 通道）+ 正向笔迹（G）+ 负向笔迹（B）"合成一张 RGB 图减少上传。
- 开源 SAM2：`point_coords` 为**原图像素坐标**（非归一化），`point_labels` 0=负/1=正，`box` 可选，`mask_input` 为当前 mask；一次调用即可完成"当前 mask + 新正负点 → 修正 mask"的**有状态**修正。

---

## 3. 调用流程设计

### 3.1 曾有的官方交互流程（ISS，已下架，仅作形态参考）

1. 上传原图与各输入图到上海 OSS（复用现有 `uploadViapiTemporaryInput` / GetOssStsToken 流程）。
2. 提交 `InteractiveScribbleSegmentation`：`ImageUrl`（原图）+ `MaskImageUrl`（上一次结果 mask）+ `PosScribbleImageUrl`/`NegScribbleImageUrl`（本次新增的正/负涂抹轨迹）→ 返回 `Data.ResultUrl`（30 分钟临时 URL，下载后转存）。
3. 每次用户新增笔迹 = 一次新调用（有状态：把上一轮 mask 传回），坐标体系为原图像素（涂抹图与原图同分辨率）。
4. IFS 流程为异步：先调 `InteractiveFullSegmentation` 拿任务 ID，再调 `GetAsyncJobResult` 查询；结果为临时 txt 文件，内含 JSON：`output.region_index`（0~255 索引图 base64 PNG）+ `output.region_info`（每个元素 `{region: data:image/png;base64（白=选区/黑=非选区）, area, index, bbox[XYWH], crop_box, point_coords, predicted_iou, stability_score}`）。点选交互在客户端完成：命中点 → 查 region_index 对应 index → 取该 region 合并。

### 3.2 推荐方案调用流程（imageseg + SAM2 + RefineMask 组合）

```
用户上传原图
  ├─ 自动主体分割（一键）：复用现有 SegmentCommonImage / SegmentCloth / SegmentHDCommonImage
  │    → 4 通道 PNG → 提取 alpha 得到初始 mask（客户端，0 成本）
  │
  ├─ 智能点击增选/减选、涂抹增选/擦除：SAM2（自托管或托管 API）
  │    → 每次「应用」提交一次：原图 + point_coords(像素) + point_labels + mask_input(当前 mask)
  │    → 返回修正后的 mask（与原图同尺寸单通道）
  │    → 客户端与当前选区做位运算合并（正=或，负=与非），实现反选亦为客户端取反
  │
  ├─ 边缘细化（可选）：把合并后的粗糙 mask 提交 RefineMask(ImageURL + MaskImageURL) → 精细化 mask
  │
  └─ 导出：透明 PNG（原图 × alpha）+ 灰度 Mask（alpha 通道导出）
       复用 restoreCutoutToOriginalCanvas（恢复原图画布）逻辑
```

要点：
- **坐标**：全程原图像素坐标（与上传/预处理后图片同尺寸）；注意现有 adapter 会把原图缩到 ≤1999 边长再上传，交互时需把用户点击坐标按同一缩放比换算到服务端图片坐标（或让客户端直接用服务端同尺寸图做交互）。
- **有状态修正**：SAM2 原生支持"当前 mask + 新提示 → 修正 mask"；阿里云 imageseg 无此能力（需自己客户端合并，且无法做语义级修正）。
- **交互即时性**：点选类建议客户端先行（mask 位运算、反选、涂抹擦除均本地即时完成），仅"智能增选目标语义"时才请求模型，降低调用量与延迟。

---

## 4. 计费 / 限制

### 4.1 imageseg 现役能力（按量付费，官方[分割抠图计费介绍](https://help.aliyun.com/zh/viapi/product-overview/billing-is-introduced-1)）

| 能力 | 按量价格 | QPS（默认） | 免费额度 | 输入限制 |
|---|---|---|---|---|
| 通用分割 SegmentCommonImage | 0.0020 元/次（月≤1万次）→0.0018→0.0016 | 5 QPS | 无免费额度（调用失败不计费） | JPEG/JPG/PNG/BMP/WEBP；≤3MB；32×32 ~ 2000×2000（最长边≤1999） |
| 服饰分割 SegmentCloth | 0.008 元/次（月≤100万次）→0.007→0.006 | 2 QPS | 同上 | 同上 |
| 通用高清分割 SegmentHDCommonImage | 0.007 元/次 | 2 QPS | 同上 | 同上（可支持更大图，详见文档） |
| Mask精细化分割 RefineMask | 0.007 元/次 | 2 QPS | 同上 | ≤3MB；32×32~2000×2000；原图与 Mask 分辨率一致 |

- 另支持预付费 QPS（约 600~1000 元/月/QPS）、单类目资源包（通用分割 0.75 点/次、服饰分割 4 点/次、RefineMask 3.5 点/次等）、通用资源包（0.15 点/次，可跨类目）。
- **免费额度**：imageseg 无固定免费次数；当年两个交互式 API 公测期免费，现已随下架失效。

### 4.2 已下架交互式 API 的历史限制（供参考，不再适用）

- IFS / ISS：JPG/JPEG/PNG/BMP/WEBP；≤10MB；32×32 ~ 4096×4096；URL 不含中文字符；Mask/涂抹图 ≤5MB 且与原图分辨率一致；结果 URL 30 分钟过期。公测期免费。

### 4.3 自托管 SAM2 成本估算（替代路线）

- 托管 API 参考价：Replicate `meta/sam-2` 约 **$0.011/次**（L40S，约 12s/次，90 runs/$1，[链接](https://replicate.com/meta/sam-2)）；302.AI 亦提供 SAM（AI 生成 MASK 图）API（[链接](https://302ai.cn/product/detail/302ai-sam)）。
- 自托管：阿里云 GPU ECS（如 T4/A10 卡）约 2~5 元/小时，vit_l 推理 1~3s/次（可缓存 image embedding，仅解码 mask 亚秒级），月成本取决于并发与调用量；低流量场景建议 serverless（PAI-EAS / 函数计算 GPU）或托管 API。
- Qwen-Image-Layered 自托管需较大显存（扩散模型，Qwen-Image 底座），按图计费走 302.AI/fal 更省事；ModelScope/HF 有免费在线 Demo 可先验证效果。

---

## 5. 推荐方案与理由

### 结论：推荐「**阿里云 imageseg 自动分割（沿用现有）+ 开源 SAM2 自托管交互 + RefineMask 细化**」三层组合

**理由**：

1. **阿里云交互式 API 已不可用（硬约束）**：唯一匹配 PRD 的 `InteractiveFullSegmentation` / `InteractiveScribbleSegmentation` 已于 2025-10-14 官方下架（[停服公告](https://help.aliyun.com/zh/viapi/product-overview/announcement-on-the-discontinuation-of-certain-public-testing-services-on-the-visual-intelligence-open-platform)），且**从未在 imageseg 类目存在过**。继续等阿里云原生交互能力不现实。
2. **现有资产最大化复用**：`SegmentCommonImage`/`SegmentCloth` 自动分割链路（RPC 签名、临时 OSS、结果下载、画布恢复）全部保留，一键抠图与上/下装场景不变；交互编辑仅在"修正选区"环节新增 SAM2。
3. **SAM2 能力与 PRD 一一对应**：正向点（`point_labels=[1]`）、负向点（`[0]`）、框、`mask_input` 有状态修正、自动模式全图分割——正是"智能点击增选/减选 + 涂抹增选/擦除 + 自动主体分割"所需，坐标直接用原图像素，一次调用返回修正 mask，无需客户端拼装语义。
4. **质量与成本平衡**：边缘可用 `RefineMask`（0.007 元/次）把交互结果精细化；高频基础操作（反选、涂抹擦除、位运算合并）全部客户端零成本即时完成，模型调用只发生在"智能修正"时，成本可控（SAM2 自托管或约 $0.011/次的托管 API）。
5. **「图片分层」的专门解**：若"分层"指把图拆成可编辑 RGBA 图层（背景 + 前景元素），阿里云无此 API；可用开源 **Qwen-Image-Layered**（Apache-2.0，ModelScope 权重 / 302.AI 等托管 API）按需生成图层；若分层仅指"人/服装/商品分别抠出"，现有 `SegmentCommonImage`+`SegmentCloth`（+ 人体分割 SegmentBody、商品分割 SegmentCommodity）组合即可，无需新增供应商。
6. **备选/降级**：交互失败或流量峰值时可降级为纯 imageseg 一键分割 + 客户端点选 mask 位运算（功能缩水但链路不断）；火山引擎等无交互式 API，不构成替代。

### 待决策事项（给后续实现）
- SAM2 部署形态：自托管 GPU（数据不出境、无单次费用）vs 托管 API（零运维、按次计费）——建议先托管 API 验证交互体验，量起来后自托管。
- 交互调用频率控制：建议"应用/确认"才触发模型，画笔拖动实时预览走本地位运算。
- 坐标换算：交互画布与服务端上传图尺寸需一致（沿用 adapter 的缩放规则）。

---

## 6. 参考链接

**阿里云官方文档**
- [交互式全图分割 InteractiveFullSegmentation（含下架说明）](https://help.aliyun.com/zh/viapi/developer-reference/api-interactivefullsegmentation)
- [交互式涂抹分割 InteractiveScribbleSegmentation（含下架说明）](https://help.aliyun.com/zh/viapi/developer-reference/api-interactivescribblesegmentation)
- [关于视觉智能开放平台部分公测能力停止服务的公告](https://help.aliyun.com/zh/viapi/product-overview/announcement-on-the-discontinuation-of-certain-public-testing-services-on-the-visual-intelligence-open-platform)
- [分割抠图介绍（imageseg 能力全清单）](https://help.aliyun.com/zh/viapi/developer-reference/segmentation-cutout-is-introduced)
- [通用分割 SegmentCommonImage](https://help.aliyun.com/zh/viapi/developer-reference/api-k8cs8t)
- [Mask精细化分割 RefineMask](https://help.aliyun.com/zh/viapi/developer-reference/api-w9sg6h)
- [分割抠图计费介绍](https://help.aliyun.com/zh/viapi/product-overview/billing-is-introduced-1)
- [GetAsyncJobResult（异步结果查询）](https://help.aliyun.com/document_detail/607824.html)
- [通义万相 wanx2.1-imageedit（涂抹局部重绘）](https://help.aliyun.com/zh/model-studio/wanx2-1-imageedit)
- [文件 URL 处理（上海 OSS 要求）](https://help.aliyun.com/document_detail/155645.html)

**社区佐证**
- [视觉智能平台创新专区的全图分割接口这些字段代表什么？（region_info/bbox/crop_box/point_coords 字段说明）](https://developer.aliyun.com/ask/606566)
- [阿里云视觉智能开放平台中，交互式全图分割有前端交互 UI 吗？（官方答复：UI 需自研）](https://developer.aliyun.com/ask/679962)
- [视觉智能平台这两项能力可以应用到生产环境了吗？（公测免费期说明）](https://developer.aliyun.com/ask/605782)
- [视觉智能平台这个交互式涂抹分割还需要自己实现涂抹图生成分割 mask？（涂抹图自绘）](https://developer.aliyun.com/ask/685603)

**替代方案**
- [SAM 2 (Meta) — Replicate（~$0.011/次）](https://replicate.com/meta/sam-2)
- [SAM（AI 生成 MASK 图）— 302.AI API](https://302ai.cn/product/detail/302ai-sam)
- [Qwen-Image-Layered 官方仓库（Apache-2.0）](https://github.com/QwenLM/Qwen-Image-Layered)
- [Qwen-Image-Layered ModelScope 模型页](https://modelscope.cn/models/Qwen/Qwen-Image-Layered)
- [Qwen-Image-Layered — 302.AI API 价格/文档](https://302.ai/product/detail/302ai-qwen-image-layered)
- [Qwen Image Layered — fal.ai 开发指南](https://fal.ai/learn/devs/qwen-image-layered-image-to-image-developer-guide)
- [火山引擎 智能分割（自动抠图，非交互）](https://www.volcengine.com/docs/86081/1660405)
- [火山引擎 inpainting 涂抹编辑（已下线）](https://www.volcengine.com/docs/86081/1804490)
