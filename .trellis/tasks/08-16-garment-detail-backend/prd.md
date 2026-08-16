# 「高清放大细节图」后端接入 PRD

**功能 ID：** `garment-detail`
**文档版本：** v1.0
**目标分支：** `preview`
**文档日期：** 2026-08-16
**范围：** 后端真实链路接入、前后端联调，不重新设计前端界面

---

## 1. 项目背景

`preview` 分支已经完成「高清放大细节图」的前端界面及完整 Mock 交互，当前支持：

* 上传一张服装原图；
* 自动识别商品分类并允许用户手动修正；
* 标准版、专业版两个模型档位；
* 最多上传 3 张参考图；
* 输入不超过 103 字的自定义提示词；
* 开启或关闭「AI 追加描述」；
* 选择 `1:1`、`3:4`、`4:3` 输出比例；
* 选择 1K、2K、4K 分辨率；
* 查看逐张生成进度；
* 查看原图与细节图对比；
* 取消、失败重试、删除及下载结果。

目前 `garment-detail` 在前端使用本地 Mock 创建和推进任务，并未调用真实 `/api/tasks`。后端尚未实现参数校验、模型解析、Prompt 拼装、图片生成、OSS 结果归档及真实任务状态。

---

## 2. 产品定义

### 2.1 功能定位

「高清放大细节图」不是传统意义上的像素插值或普通超分辨率，而是：

> 以用户上传的商品原图为唯一商品事实来源，通过图片编辑模型生成一张新的电商局部细节摄影图，并直接输出指定的 1K、2K 或 4K 分辨率。

模型可以调整：镜头距离；局部裁切范围；商业布光；景深；背景；合理的衣物摆放和轻微褶皱。

模型不得主动重新设计：商品颜色；版型和结构；纽扣数量；拉链和五金；口袋；Logo；印花；刺绣；已经可见的走线。

### 2.2 MVP 技术边界

本期采用：

```text
服装主图
  ↓
可选：服装分类建议
  ↓
服务端参数校验与细节镜头规划
  ↓
固定 Prompt 模板
  ↓
Nano Banana / GPT Image 2 图片编辑
  ↓
直接生成 1K / 2K / 4K 结果
  ↓
OSS 持久化、缩略图、任务历史
```

本期不增加：Agent；生成后的独立多模态一致性审核；自动验收后循环重画；第二个生成模型进行二次精修；独立的 ESRGAN、Real-ESRGAN 等超分服务；GPU 本地推理；用户手动画框或蒙版指定局部；超过 3 张的批量细节生成。

---

## 3. 项目目标

### 3.1 核心目标

将前端 Mock 功能切换为真实后端任务，使用户能够：

1. 上传服装原图；
2. 获得商品分类建议；
3. 选择标准版或专业版；
4. 可选上传 1～3 张风格/构图参考图；
5. 提交真实异步任务；
6. 通过现有任务列表查看进度；
7. 获得 1～3 张真实生成的高清细节图；
8. 对成功结果进行预览、原图对比、收藏、下载及删除；
9. 对失败输出进行重试；
10. 刷新页面或服务重启后仍能恢复任务和结果。

### 3.2 非目标

本期不承诺：低清原图中不存在的每一根纱线都能被真实还原；Logo、小字和复杂印花做到逐像素一致；生成图可替代实物质检图；自动判断生成结果是否可直接上架；在不同模型之间获得完全一致的视觉表现。

---

## 4. 已有能力与复用原则

### 4.1 直接复用

后端必须复用现有能力：

* `/api/assets/upload` 上传与 OSS 存储；
* `/api/tasks` 创建任务；
* `/api/tasks/:taskId` 查询任务；
* `/api/tasks/:taskId/cancel` 取消任务；
* 任务历史分页；
* 用户身份认证和资产所有权校验；
* Provider Pool；
* Google、Grsai、OpenAI 图片编辑适配器；
* Provider 熔断、限流、同模型渠道故障转移；
* 生成结果下载并上传 OSS；
* 结果缩略图生成；
* 单张结果删除；
* 收藏和自动清理保护；
* PM2、Watchdog 和已有日志体系。

现有 `runImageEditViaProvider()` 已能统一接收模型、Prompt、输入图片、比例和分辨率并路由至 Google、Grsai 或 OpenAI 图片编辑适配器。

现有任务存储层已经能够将上游生成结果下载、读取图片尺寸、上传 OSS、生成 WebP 缩略图并持久化到任务历史。

### 4.2 数据库影响

现有 `tasks` 表使用通用 `type + payload_json + result_json`，`assets` 表也已经支持将生成资产关联到任务，因此本功能原则上不需要新增数据库表或执行数据库迁移。

---

## 5. 核心业务规则

### 5.1 主图与参考图角色

模型输入图片必须严格区分角色：

#### 图 1：服装原图

服装原图是唯一的商品事实来源，决定：商品类别；商品颜色；结构和版型；面料的可见特征；Logo；印花；纽扣；拉链；五金；走线；口袋；装饰件。

#### 图 2：可选参考图

参考图只用于参考：镜头；构图；局部展示方式；光线；景深；背景氛围。

不得从参考图复制：另一件商品；另一种颜色；另一套印花；Logo；文字；五金；纽扣；材质事实。

### 5.2 输出数量

延续现有前端契约：

| 参考图数量 | 输出数量 |
| ----: | ---: |
|     0 |  1 张 |
|     1 |  1 张 |
|     2 |  2 张 |
|     3 |  3 张 |

每个输出位只使用：服装主图 + 当前输出位所对应的单张参考图。不得将全部 3 张参考图同时发送给每个输出位。

### 5.3 细节输出位

服务端根据用户确认后的商品分类，确定最多 3 个细节输出位：

| 分类              | 第 1 张 | 第 2 张 | 第 3 张 |
| --------------- | ----- | ----- | ----- |
| 上装 `tops`       | 领口细节  | 袖口细节  | 面料纹理  |
| 下装 `bottoms`    | 腰头细节  | 走线细节  | 面料纹理  |
| 连衣裙 `dress`     | 领口细节  | 裙摆细节  | 面料纹理  |
| 配饰 `accessory`  | 材质特写  | 工艺细节  | 质感纹理  |
| 鞋包 `shoes-bags` | 五金细节  | 走线细节  | 材质特写  |

没有参考图时，只生成表格中的第 1 个输出位。

该规则需与前端现有 `buildGarmentDetailShots()` 行为保持一致，避免任务进度卡的 `shotId` 和 `label` 对不上。

### 5.4 分辨率

| 模型档位               | 支持分辨率 |
| ------------------ | ----- |
| 标准版 `standard`     | 1K    |
| 专业版 `professional` | 2K、4K |

分辨率通过模型 API 参数传递：`imageSize = 1K / 2K / 4K`。不得主要依靠在 Prompt 中重复添加 8K / ultra HD / masterpiece / hyper detailed 此类词语。

---

## 6. 模型档位设计

### 6.1 前端模型别名

前端只识别两个稳定的业务别名：`std-v1`、`pro-v1`。前端不得感知实际供应商、API Key 或上游模型切换。

### 6.2 服务端模型注册表

新增服务端模型注册表：`lib/server/garment-detail-model-registry.ts`

建议初始映射：

```text
std-v1
  tier: standard
  resolutions: 1K
  candidateModels:
    - nano-banana-2-lite
    - gemini-3.1-flash-image-preview

pro-v1
  tier: professional
  resolutions: 2K / 4K
  candidateModels:
    - nano-banana-pro
    - gemini-3-pro-image-preview
    - gpt-image-2
```

实际顺序通过环境变量配置，不写死在业务代码中：

```env
GARMENT_DETAIL_STANDARD_MODELS=nano-banana-2-lite,gemini-3.1-flash-image-preview
GARMENT_DETAIL_PRO_MODELS=nano-banana-pro,gemini-3-pro-image-preview,gpt-image-2
GARMENT_DETAIL_CONCURRENCY=2
GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS=15000
GARMENT_DETAIL_PROMPT_VERSION=garment-detail-v1
GARMENT_DETAIL_BACKEND_ENABLED=1
```

### 6.3 模型解析规则

创建任务时：

1. 根据 `algorithmModelId` 查找业务模型；
2. 检查业务模型是否启用；
3. 按候选模型顺序检查 Provider Pool 是否存在可用渠道；
4. 选择第一个可用模型；
5. 将真实模型 ID 固定到任务快照；
6. 同一个任务的初次生成、失败重试和服务恢复必须继续使用同一个真实模型；
7. 不允许一个任务的第 1 张使用 Nano Banana，第 2 张临时切换 GPT Image 2。

同一模型对应多个 Provider 时，继续使用现有 Provider Pool 的渠道故障转移。

### 6.4 不信任客户端字段

以下字段由客户端传入仅用于兼容现有界面，服务端必须重新计算或覆盖：

* `algorithmModelName`、`modelTier`、`referenceImageCount`、`detailShots`、`resultCount`、`creditsCost`、真实上游模型 ID、Prompt 模板版本。

客户端不能通过修改请求体选择未开放模型、越权增加出图数量或伪造计费。

---

## 7. API 设计

## 7.1 获取模型版本列表

### 请求

```http
GET /api/garment-detail/models
```

需要登录。

### 成功响应

```json
{
  "models": [
    {
      "algorithmModelId": "std-v1",
      "algorithmModelName": "标准版",
      "tier": "standard",
      "resolutions": ["1k"],
      "recommended": false,
      "defaultSelected": true,
      "description": "细节稳定，适合常规放大出图",
      "costLabel": "成本低",
      "estimatedSeconds": 45
    },
    {
      "algorithmModelId": "pro-v1",
      "algorithmModelName": "专业版",
      "tier": "professional",
      "resolutions": ["2k", "4k"],
      "recommended": true,
      "defaultSelected": false,
      "description": "细节表现更强，适合电商高清局部图",
      "costLabel": "成本高",
      "estimatedSeconds": 75
    }
  ]
}
```

### 规则

* 前端不硬编码模型；
* 至少存在一个可用上游模型时，才返回该业务档位；
* 模型不可用时不向前端返回；
* 全部模型不可用时返回 `503 MODEL_UNAVAILABLE`；
* 响应不得暴露 API Key、Provider 凭证和内部渠道地址。

---

## 7.2 商品分类建议

### 请求

```http
POST /api/garment-detail/classify
Content-Type: application/json
```

```json
{ "assetId": "asset_xxx" }
```

### 成功响应

```json
{
  "status": "ok",
  "category": "tops",
  "confidence": 0.86,
  "needsConfirmation": false,
  "candidates": [
    { "category": "tops", "score": 0.86 },
    { "category": "dress", "score": 0.09 }
  ],
  "source": "aliyun-segment-cloth",
  "requestId": "aliyun-request-id"
}
```

### 降级响应

分类服务故障不得阻塞用户生成：

```json
{
  "status": "fallback",
  "category": "tops",
  "confidence": 0,
  "needsConfirmation": true,
  "candidates": [],
  "source": "fallback",
  "warning": "智能识别暂不可用，请手动确认商品分类"
}
```

### 分类实现

优先复用现有阿里云 `SegmentCloth` 能力，一次请求获取：`tops`、`coat`、`skirt`、`pants`、`bag`、`shoes`、`hat`。现有适配器已经支持按类别解析 `ClassUrl`。

映射规则：

```text
tops / coat     → tops
pants / skirt   → bottoms
bag / shoes     → shoes-bags
hat             → accessory
tops + skirt 且区域连续 → dress
```

分类仅提供建议，最终以用户在前端确认或手动修正后的 `category` 为准。

### 安全规则

* 只接受 `assetId`，不接受任意公网 URL；
* 校验素材属于当前用户；
* 素材不存在或越权统一返回 404；
* 分类超时后降级，不继续占用请求；
* 不将图片 Base64 写入业务日志。

---

## 7.3 创建生成任务

复用现有接口：`POST /api/tasks`（`Content-Type: application/json`）

### 请求示例

```json
{
  "featureType": "garment-detail",
  "inputAssetIds": ["asset_main", "asset_reference_1", "asset_reference_2"],
  "params": {
    "category": "tops",
    "algorithmModelId": "pro-v1",
    "algorithmModelName": "专业版",
    "modelTier": "professional",
    "resolution": "4k",
    "imageRatio": "1:1",
    "userPrompt": "柔和棚拍光，突出面料与走线",
    "aiAppendDescription": true,
    "referenceImageCount": 2,
    "detailShots": [
      { "shotId": "detail_1", "label": "领口细节", "referenceAssetId": "asset_reference_1" },
      { "shotId": "detail_2", "label": "袖口细节", "referenceAssetId": "asset_reference_2" }
    ],
    "resultCount": 2,
    "creditsCost": 0
  }
}
```

### 输入图片顺序

服务端约定：`inputAssetIds[0] = 服装主图`；`inputAssetIds[1...] = 参考图，最多 3 张`。

### 成功响应

```json
{ "taskId": "task_xxx", "status": "pending" }
```

---

## 8. 服务端参数校验

新增 `normalizeGarmentDetailParams()`。校验规则如下。

### 8.1 素材

* `inputAssetIds` 数量必须为 1～4；
* 第 1 张必须是主图；
* 最多 3 张参考图；
* 所有素材必须存在且属于当前用户；
* 禁止重复 assetId；
* 图片格式及大小继续使用现有上传约束。

### 8.2 分类

仅允许：`tops` / `bottoms` / `dress` / `accessory` / `shoes-bags`

### 8.3 模型档位

仅允许：`std-v1` / `pro-v1`。服务端重新解析 `algorithmModelName`、`modelTier`、支持分辨率、真实上游模型。

### 8.4 分辨率

`std-v1` → 仅 1k；`pro-v1` → 仅 2k / 4k。不匹配时返回 `RESOLUTION_UNSUPPORTED`，不得静默降级。

### 8.5 比例

仅允许：`1:1` / `3:4` / `4:3`

### 8.6 提示词

* 可为空；去除首尾空格；最多 103 个 Unicode 字符（不按 UTF-8 字节数计算）；超出返回 400，不静默截断；用户提示词不能覆盖商品身份锁定规则。

### 8.7 服务端重新生成字段

服务端根据真实输入素材重新生成：`referenceImageCount`、`detailShots`、`resultCount`、`creditsCost`。

---

## 9. 任务标准化结果

服务端持久化的任务参数建议包含：

```json
{
  "category": "tops",
  "algorithmModelId": "pro-v1",
  "algorithmModelName": "专业版",
  "modelTier": "professional",
  "resolvedModelId": "nano-banana-pro",
  "resolution": "4k",
  "imageRatio": "1:1",
  "userPrompt": "柔和棚拍光，突出面料与走线",
  "aiAppendDescription": true,
  "referenceImageCount": 2,
  "detailShots": [
    { "shotId": "detail_1", "label": "领口细节", "referenceAssetId": "asset_reference_1" },
    { "shotId": "detail_2", "label": "袖口细节", "referenceAssetId": "asset_reference_2" }
  ],
  "resultCount": 2,
  "creditsCost": 0,
  "promptTemplateVersion": "garment-detail-v1"
}
```

`resolvedModelId` 和 `promptTemplateVersion` 必须保留，以便故障排查、失败重试、服务重启恢复、后续比较不同模型效果、Prompt 版本回溯。

---

## 10. 生成 Prompt 设计

## 10.1 Prompt 原则

优先级：`商品事实锁定 > 目标细节部位 > 参考图角色约束 > 用户附加要求 > 摄影与画质表达`。用户提示词不能取消商品事实锁定。

## 10.2 基础模板

```text
你正在执行电商商品细节摄影生成任务。

【任务】
根据图1中的商品，生成一张全新的高清局部细节商业摄影图。
这不是简单裁剪、普通插值放大，也不是重新设计商品。
目标细节部位：{DETAIL_LABEL}。

【图片角色】
图1是唯一的商品事实来源。
{REFERENCE_RULE}

【必须保持】
1. 保持图1商品原有的颜色、颜色分布和明暗关系。
2. 保持商品原有的版型、轮廓、结构、比例和部件位置。
3. 保持图1中可见的面料类型及其真实特征。
4. 保持纽扣、拉链、五金、口袋、走线和装饰件的数量与位置。
5. 保持图1中可见的Logo、文字、印花、刺绣和图案。
6. 只增强原图能够支持的细节；原图没有提供证据的纹理必须克制处理，不得凭空编造新的织法、文字、Logo或装饰。

【允许变化】
允许改变镜头距离、局部构图、背景、商业布光、景深、合理摆放方式和轻微自然褶皱，但这些变化不能改变商品本身。

【画面要求】
生成一张完整、连续、真实的电商局部细节摄影图。
使用专业棚拍级柔和光线、自然微阴影、真实材质质感、克制景深。
细节主体清楚，画面干净，适合电商详情页使用。

【禁止】
禁止拼贴、对比布局、分屏、说明文字、尺寸标注、边框、水印和额外Logo。
禁止新增或删除纽扣、拉链、五金、口袋、走线、文字、印花和装饰。
禁止改变商品颜色、镜像商品或把商品替换成另一款。
禁止出现无关人物、手、衣架或人体模型，除非图1商品结构必须依赖它们展示。

【用户附加要求】
{USER_PROMPT}

只输出一张图片。
```

## 10.3 有参考图时

```text
图2仅用于参考局部镜头、构图、光线、景深和背景表现。
不得复制图2中的商品、颜色、材质、Logo、文字、印花、纽扣或五金。
最终商品必须来自图1。
```

## 10.4 无参考图时

```text
本次没有构图参考图，请根据目标细节部位自行设计克制、真实的电商微距构图。
```

## 10.5 AI 追加描述开关

### 关闭

只使用：分类模板 + 细节部位 + 用户提示词。

### 开启

MVP 不额外调用一次视觉大模型，也不新增 Agent。服务端在同一次图片编辑 Prompt 中追加：

```text
生成前先观察图1中与目标部位相关的可见事实，包括颜色、结构、面料、走线、Logo、印花、纽扣、拉链和五金。
只使用可以从图1直接观察或合理确认的事实完成细节摄影，不要将猜测当作商品事实。
```

这样由图片编辑模型在生成时完成视觉理解，不增加额外请求、延迟和成本。未来接入独立视觉描述模型时，仍复用 `aiAppendDescription` 字段，无需修改前端契约。

---

## 11. 图片生成管线

新增 `lib/server/garment-detail-service.ts`。建议接口：

```ts
runGarmentDetailPipeline({
  userId, taskId, mainImage, referenceImages, params, signal,
  targetShotIds, onShotProgress, onShotResult,
})
```

### 11.1 单个 Shot 执行步骤

```text
读取 detailShot → 准备图1主图 → 可选准备当前 Shot 对应的图2参考图 → 构建最终 Prompt
→ 根据任务快照获取 resolvedModelId → runImageEditViaProvider() → 获得 ResultAsset
→ 写入 label / shotId / finalPrompt / metadata → onShotResult 流式持久化
```

### 11.2 模型调用参数

```ts
{
  count: 1,
  inputImages: reference ? [mainImage, reference] : [mainImage],
  aspectRatio: params.imageRatio,
  imageSize: params.resolution.toUpperCase(),
}
```

### 11.3 并发

* 单任务最多 3 个 Shot；默认并发 2；通过 `GARMENT_DETAIL_CONCURRENCY` 调整；不允许无上限 `Promise.all`；
* 用户服务器为 4 核 8GB，生成后下载 4K 图片、读取 metadata、上传 OSS 和制作缩略图会产生明显内存峰值；
* 继续复用现有结果持久化信号量；
* Gemini 系渠道优先使用 OSS URL 透传，避免服务器下载后转成大体积 Base64。

---

## 12. 任务状态与流式持久化

### 12.1 初始 ShotProgress

创建任务时，根据服务端重建后的 `detailShots` 初始化：

```json
[{ "shotId": "detail_1", "label": "领口细节", "status": "prompting", "message": "正在准备细节图" }]
```

### 12.2 状态流转

`pending → running/prompting → running/generating → success`；部分输出失败时 `partial`；全部失败 `failed`；用户取消 `cancelled`。

### 12.3 流式持久化

`garment-detail` 必须加入现有 `useStreamingPersist` 逻辑：每张图生成成功后立即上传 OSS、创建 AssetRecord、写入 task.results、更新对应 ShotProgress；后续 Shot 失败不能丢失已成功的图片；用户取消任务时保留已成功结果；服务崩溃时已写入 OSS 的结果仍可恢复。

### 12.4 完成状态

| 成功数量 | 失败数量 | 最终状态 |
| ---: | ---: | --- |
| 全部成功 | 0 | `success` |
| 大于 0 | 大于 0 | `partial` |
| 0 | 全部失败 | `failed` |
| 用户取消 | 任意 | `cancelled` |

---

## 13. ResultAsset 数据要求

每张结果必须写入：

```json
{
  "assetId": "result_xxx",
  "url": "https://oss.example/result.png",
  "downloadUrl": "https://oss.example/result.png",
  "width": 4096,
  "height": 4096,
  "kind": "generated",
  "label": "领口细节",
  "shotId": "detail_1",
  "finalPrompt": "最终发送给模型的Prompt",
  "thumbnailUrl": "https://oss.example/result_thumb.webp",
  "metadata": {
    "featureType": "garment-detail",
    "sourceMainAssetId": "asset_main",
    "referenceAssetId": "asset_reference_1",
    "category": "tops",
    "algorithmModelId": "pro-v1",
    "resolvedModelId": "nano-banana-pro",
    "modelTier": "professional",
    "resolution": "4k",
    "imageRatio": "1:1",
    "aiAppendDescription": true,
    "promptTemplateVersion": "garment-detail-v1"
  }
}
```

原图对比预览继续从 `task.inputAssets[0].fileUrl` 读取商品原图，任务查询必须继续 hydrate `inputAssets`。

---

## 14. 失败重试

复用并扩展：`POST /api/tasks/:taskId/retry-shots`。当前该接口只允许 `photo-fission`，需要增加 `garment-detail` 分支。

请求：`{ "shotIds": ["detail_2"] }`

规则：仅允许 `partial` 或 `failed`；只允许重试原任务 `detailShots` 中存在的 Shot；已经成功的 Shot 不允许重复生成；继续使用原任务主图、对应参考图、真实模型快照、原 Prompt 模板版本；新结果合并进原任务；不创建新任务；本期积分仍为 0，不重复扣费；前端点击「重试任务」可自动提交全部失败 Shot ID。

---

## 15. 服务重启恢复

现有任务恢复逻辑需要识别 `garment-detail` 的最小生成单元：`detail_1` / `detail_2` / `detail_3`。

恢复规则：找出 `detailShots` 中还没有对应结果的 Shot；只恢复未完成 Shot；已持久化结果不得重复生成；使用任务中固定的真实模型 ID；恢复执行必须具备幂等键；恢复次数超过现有上限后标记为 `partial` 或 `failed`；服务重启后前端通过现有任务轮询自然获得恢复状态。

---

## 16. 错误规范

所有错误响应保持现有 `error` 字符串兼容，同时增加结构化字段：

```json
{ "error": "专业版当前不支持 1K 分辨率", "code": "RESOLUTION_UNSUPPORTED", "retryable": false, "requestId": "optional-upstream-request-id" }
```

### 错误码

| Code | 场景 | 是否可重试 |
| --- | --- | --- |
| `INVALID_PARAMS` | 参数格式或枚举错误 | 否 |
| `ASSET_NOT_FOUND` | 素材不存在或越权 | 否 |
| `MODEL_UNAVAILABLE` | 档位没有可用上游模型 | 是 |
| `RESOLUTION_UNSUPPORTED` | 模型档位与分辨率不匹配 | 否 |
| `CLASSIFY_FAILED` | 分类服务失败 | 是，但不阻塞生成 |
| `UPSTREAM_RATE_LIMIT` | 上游 429 | 是 |
| `UPSTREAM_TIMEOUT` | 上游调用超时 | 是 |
| `AUDIT_REJECTED` | 上游内容审核拒绝 | 修改素材或提示词后重试 |
| `NO_IMAGE_RESULT` | 上游未返回有效图片 | 是 |
| `TASK_CANCELLED` | 用户取消任务 | 否 |
| `PERSIST_FAILED` | 结果下载或 OSS 归档失败 | 是 |

### 前端展示要求

不直接显示冗长的上游原始响应；展示可理解的中文错误；保留 requestId 供排查；`partial` 状态需显示成功图片和失败输出位；失败输出位提供重试入口。

---

## 17. 计费与日志

### 17.1 用户积分

本期保持 `creditsCost = 0`，暂不增加用户侧积分扣减。

### 17.2 上游成本记录

即使用户积分为 0，也必须继续使用现有 `recordBillingAndReturn()` 记录 Provider、真实模型、调用次数、taskId、实际成功结果数。

### 17.3 业务日志

建议新增事件：`garment_detail.models` / `garment_detail.classify` / `garment_detail.normalize` / `garment_detail.shot.start` / `garment_detail.shot.success` / `garment_detail.shot.failed` / `garment_detail.task.partial`。

日志字段示例：

```json
{ "taskId": "task_xxx", "shotId": "detail_1", "category": "tops", "algorithmModelId": "pro-v1", "resolvedModelId": "nano-banana-pro", "resolution": "4k", "referenceCount": 2, "providerId": "grsai-1", "durationMs": 68000, "errorCategory": null }
```

禁止记录：API Key；图片 Base64；完整带签名的私有 OSS URL；用户密码或 Session；未经截断的超长上游响应。

---

## 18. 性能与稳定性目标

### 18.1 接口性能

| 接口 | 目标 |
| --- | --- |
| 模型列表 | P95 ≤ 500ms |
| 创建任务 | P95 ≤ 1s，生成在后台执行 |
| 分类建议 | P95 ≤ 8s，15s 超时降级 |
| 标准版单张 | 目标 ≤ 60s |
| 专业版单张 | 目标 ≤ 90s |
| 取消任务 | P95 ≤ 1s |

### 18.2 资源控制

单任务最多 3 个生成单元；单任务默认 2 并发；结果持久化继续受现有信号量限制；4K 图片不得在多个不受控流程中重复转 Base64；Gemini 支持 URL 时优先 URL 透传；每个 Shot 只传主图和它自己的参考图；分类请求与生成请求不得并行重复下载同一大图；不增加本地 GPU 依赖。

---

## 19. 安全要求

* 所有接口必须调用 `requireUser()`；
* 所有 assetId 必须校验所有权；
* 越权访问与素材不存在统一返回 404；
* 不能让客户端直接提交真实 Provider ID 或任意模型字符串；
* 不能接受用户提供的公网图片 URL；
* 继续使用现有安全远程图片下载器（重定向逐跳校验、响应体大小限制、协议限制）；
* API Key 仅从服务端环境变量读取；
* 任务查询、取消、重试、删除结果均按 userId 隔离；
* 不因错误响应暴露其他用户任务是否存在。

---

## 20. 后端文件改动范围

### 20.1 新增文件

```text
lib/server/garment-detail-model-registry.ts
lib/server/garment-detail-classifier.ts
lib/server/garment-detail-service.ts
lib/server/garment-detail-service.test.ts
lib/server/garment-detail-classifier.test.ts

app/api/garment-detail/models/route.ts
app/api/garment-detail/classify/route.ts
```

### 20.2 修改文件

```text
lib/types.ts
lib/server/task-store.ts
lib/server/third-party-image-adapter.ts
lib/server/image-provider-pool.ts（仅在需要补模型可用性查询时）
app/api/tasks/route.ts
app/api/tasks/[taskId]/retry-shots/route.ts
lib/server/billing/pricing.ts（仅补统计映射，不做用户扣费）
```

### 20.3 关键修改点

#### `lib/types.ts`

* 将工作流从 `garment_detail_mock_v1` 改为 `garment_detail_v1`；
* 保留现有前端参数类型；
* 增加服务端归一化后的可选字段：`resolvedModelId`、`promptTemplateVersion`。

#### `task-store.ts`

增加：`normalizeGarmentDetailParams()`；`buildInitialShotProgress()` 的 garment-detail 分支；`taskTargetsGeminiFamily()` 的 garment-detail 判断；`useStreamingPersist` 包含 garment-detail；`runGarmentDetailPipeline()` 分支；`resolveTaskCompletion()` 对 `detailShots` 的数量判断；服务恢复时未完成 Shot 计算；失败 Shot 重试。

#### `third-party-image-adapter.ts`

不得让 `garment-detail` 继续落入当前通用 `BackgroundReplaceParams` 分支。应显式：`garment-detail → runGarmentDetailPipeline`。现有适配器当前只对 AI 服装大片、服装大片裂变和姿势裂变做了明确分流，因此这一项是后端接入的必要修改。

---

## 21. 最小前端联调改动

本任务不重新设计前端，但要移除 Mock 接线。

### 21.1 模型列表

将 `fetchGarmentDetailModels()` Mock 替换为 `GET /api/garment-detail/models`。

### 21.2 分类

主图上传完成后调用 `POST /api/garment-detail/classify`。分类失败时保持表单可用、显示手动确认提示、不阻止立即生成。

### 21.3 创建任务

删除 `garment-detail` 的本地特殊提交分支，和其他功能一样调用 `POST /api/tasks`。

### 21.4 输入素材顺序

`getInputAssetDescriptors()` 增加：服装主图 + 非空参考图 1/2/3。当前前端的 `garment-detail` 提交分支直接创建 Mock，且真实任务素材描述函数还没有专属 garment-detail 分支，联调时必须补上。

### 21.5 删除 Mock 特殊逻辑

真实后端上线后删除或停用：Mock task ID 前缀；本地 600ms tick；Mock 任务轮询跳过；Mock 任务本地取消；Mock 结果本地删除；Mock 失败重试；Mock 模型延迟；文件名猜分类。可以保留 `IMAGE_API_DEMO=1` 的统一后端演示模式，但不得继续由浏览器生成本地任务。

---

## 22. 测试要求

### 22.1 单元测试

#### 参数校验

* [ ] 仅 1 张主图时生成 1 个 Shot
* [ ] 1 张参考图时生成 1 个 Shot
* [ ] 2 张参考图时生成 2 个 Shot
* [ ] 3 张参考图时生成 3 个 Shot
* [ ] 4 张参考图被拒绝
* [ ] 非法分类被拒绝
* [ ] 非法比例被拒绝
* [ ] 标准版选择 2K/4K 被拒绝
* [ ] 专业版选择 1K 被拒绝
* [ ] 超过 103 字的提示词被拒绝
* [ ] 服务端覆盖客户端伪造的 resultCount
* [ ] 服务端覆盖客户端伪造的 creditsCost
* [ ] 重复 assetId 被拒绝
* [ ] 越权素材被拒绝

#### Shot 规划

* [ ] 五类商品输出标签正确
* [ ] Shot ID 稳定为 `detail_1～detail_3`
* [ ] 每个 Shot 仅绑定自己的参考图
* [ ] 无参考图时 `referenceAssetId=null`

#### Prompt

* [ ] 图 1 被声明为唯一商品事实来源
* [ ] 有参考图时包含图 2 的限制规则
* [ ] 无参考图时不出现图 2
* [ ] 用户提示词被放在低优先级区域
* [ ] AI 追加描述开关正确控制观察指令
* [ ] 分辨率不依赖 Prompt 词语传递

### 22.2 集成测试

* [ ] 模型列表仅返回可用档位
* [ ] 分类接口校验用户素材所有权
* [ ] 分类服务故障后返回 fallback，不阻塞生成
* [ ] `/api/tasks` 能创建 garment-detail 任务
* [ ] Provider Router 收到正确模型、比例和分辨率
* [ ] 每张成功结果立即写入 OSS
* [ ] 多 Shot 部分失败后任务状态为 partial
* [ ] 用户取消后保留已成功结果
* [ ] 服务重启后只恢复未完成 Shot
* [ ] 失败 Shot 可合并重试
* [ ] 删除单张结果后任务数据同步更新
* [ ] 用户 A 无法访问用户 B 的任务和素材

### 22.3 真实模型冒烟测试

至少准备 5 类样本：纯色针织上衣；带 5 颗纽扣的开衫；带小文字 Logo 的上装；带固定印花的连衣裙；带拉链、口袋或五金的鞋包。每类分别测试：无参考图 / 1 张参考图 / 3 张参考图 / 1K / 2K / 4K / Nano Banana / GPT Image 2 可用渠道。

重点观察：颜色漂移；纽扣数量变化；Logo 乱码；印花变形；五金改变；走线凭空增加；参考图商品污染主商品；4K 是否只是尺寸变大而画面明显失真。

---

## 23. 验收标准

### 23.1 功能验收

* [ ] `preview` 分支「高清放大细节图」不再创建 `mock-gd-*` 任务
* [ ] 提交后获得真实 `task_*` ID
* [ ] 刷新页面后任务仍存在
* [ ] 模型列表由后端动态返回
* [ ] 主图上传后能够获得分类建议
* [ ] 分类失败不影响用户手动生成
* [ ] 标准版只能选择 1K
* [ ] 专业版只能选择 2K、4K
* [ ] 无参考图生成 1 张；1～3 张参考图生成对应数量结果
* [ ] 结果 `label`、`shotId` 与前端卡片一致
* [ ] 每张成功结果进入 OSS、生成缩略图
* [ ] 原图对比功能能读取真实任务主图
* [ ] 任务支持取消；部分成功结果不会因后续失败而丢失；失败输出位支持重试
* [ ] 结果支持单张删除、收藏、下载
* [ ] 不同用户数据互相隔离

### 23.2 工程验收

* [ ] 新增服务均有单元测试
* [ ] Provider 调用具备超时和中止信号
* [ ] 没有在日志中输出 Base64 图片
* [ ] 没有新增 GPU 或本地推理依赖
* [ ] 没有新增不必要数据库表
* [ ] `pnpm exec tsc --noEmit` 通过
* [ ] `pnpm lint` 通过
* [ ] 相关 Node 测试通过
* [ ] `pnpm build` 通过
* [ ] 测试站桌面端、移动端、亮色和暗色主题通过验收
* [ ] 服务端 4 核 8GB 环境执行 3 张 4K 任务时不触发 OOM 或 Watchdog 重启

---

## 24. 发布策略

### 阶段一：后端隐藏接入

`GARMENT_DETAIL_BACKEND_ENABLED=0`，完成服务、API、测试、日志、Provider 路由、OSS 持久化。

### 阶段二：测试站联调

`GARMENT_DETAIL_BACKEND_ENABLED=1`，在 `preview` 测试站：移除浏览器 Mock；使用真实任务；验证 5 类样本；对比 Nano Banana 与 GPT Image 2；记录成功率、耗时、颜色和结构漂移。

### 阶段三：生产发布

满足以下条件后进入生产：真实任务成功率达到可接受水平；取消、部分成功、重试正常；4K 不触发 OOM；OSS 结果可稳定访问；任务刷新和服务恢复正常；模型渠道不可用时能给出明确提示；未发现跨用户访问问题。

---

## 25. 最终技术决策

1. **采用生成式图片编辑，不做普通超分**——功能目标是生成新的商业局部摄影图；普通超分不能改变镜头和构图；当前项目已具备 Nano Banana 和 GPT Image 2 图片编辑链路。
2. **主图是唯一商品事实来源**——参考图仅控制摄影表达，防止污染。
3. **MVP 不增加独立多模态审核**——增加成本和等待；很难稳定判断一致性；用户可自行对比选择；先通过强参考约束和 Prompt 降低漂移。
4. **每张输出独立调用**——每个 Shot 使用主图 + 当前参考图，避免参考图互相干扰。
5. **直接请求目标分辨率**——1K/2K/4K 作为模型参数传入，不增加第二次生成式放大。
6. **复用现有任务和 OSS 体系**——不新建孤立任务表、上传系统和结果目录。

---

## 26. Definition of Done

用户在 `preview` 测试站上传一张真实服装图，选择模型档位、参考图、提示词、比例和分辨率后，前端通过 `/api/tasks` 创建真实 `garment-detail` 任务；后端调用已配置的 Nano Banana 或 GPT Image 2 图片编辑模型生成细节图，将结果和缩略图保存到 OSS，并通过现有任务系统提供进度、部分成功、取消、失败重试、历史记录、原图对比、收藏、删除和下载能力。整个流程中不再依赖浏览器 Mock，不新增 Agent、GPU 和独立多模态审核链路。
