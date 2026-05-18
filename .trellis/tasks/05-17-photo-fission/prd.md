# 服装大片裂变 photo-fission — PRD v2（产品经理 2026-05-17 重新对齐）

> **v2 变更说明**：v1 实施完后 codex E2E 暴露 fetch failed + UI 不符的问题。产品经理给出参考图截图（图同姿势裂变 UI 风格），并明确 4 项决策，此 v2 推翻 v1 的「裂变类型多选 / 生成数量 / 补充提示词 / 积分」设计，UI 与字段全面对齐参考图。

---

## 1. 目标

公司内部 AI 服装电商素材工作台的第二个核心功能。
用户上传一张已满意的服装大片（含可选正面/背面细节图），系统基于这些图生成**同一服装、同一风格**下 **9 张固定套图**（多角度 / 多景别 / 多构图），用于电商主图、详情页、种草图、客户方案。

本期不做：裂变类型多选、生成数量可选、补充提示词、积分计算、案例库 Tab。

## 2. 用户流程

1. 进入服装大片裂变
2. 上传 1 张服装大片主图（必填）
3. （可选）上传产品正面细节图
4. （可选）上传产品背面细节图
5. 选择模型（默认稳定版）
6. 选择品类（默认童装）
7. 选择图片比例（**由主图尺寸自动推断默认值**，可手改）
8. 选择分辨率（**由主图最大边自动推断默认值**，可手改）
9. 点击「立即生成」
10. 后端固定生成 9 张套图，每张带 label
11. 前端按 label 展示，支持下载、复制全部 Prompt
12. 历史记录 Tab 显示（无案例库 Tab）

## 3. 表单字段与默认值

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | `FashionModelId` | ✅ | `gemini-3.1-flash-image-preview` | 复用 AI 服装大片的 2 个模型 id |
| `category` | `PhotoFissionCategory` | ✅ | `childrens` | 6 项下拉：上衣/裤子/裙子/套装/外套/童装 |
| `referenceImage` | UploadedImage | ✅ | - | 主图，compact 上传框 |
| `frontDetailImage` | UploadedImage | ❌ | - | 产品正面细节图 |
| `backDetailImage` | UploadedImage | ❌ | - | 产品背面细节图 |
| `imageRatio` | `PhotoFissionImageRatio` | ✅ | 由主图推断（兜底 `3:4`） | 11 选 1：主组 6 + 更多组 5 |
| `resolution` | `PhotoFissionResolution` | ✅ | 由主图最大边推断（兜底 `2k`） | `1k` / `2k` / `4k` |

### 3.1 主图尺寸 → 默认推断规则

主图上传后立即在前端计算：

**比例推断**（取最接近的预设）：

```
const ratio = width / height
const ratioMap = {
  '1:1': 1.0,
  '3:2': 1.5,
  '2:3': 0.667,
  '3:4': 0.75,
  '4:3': 1.333,
  '4:5': 0.8,
  '5:4': 1.25,
  '9:16': 0.5625,
  '16:9': 1.778,
  '21:9': 2.333,
}
// 选与 ratio 数值最接近的 key
```

**分辨率推断**（按主图最大边）：

```
const maxSide = Math.max(width, height)
if (maxSide >= 3000) → '4k'
else if (maxSide >= 1500) → '2k'
else → '1k'
```

如果用户在选定后手动改了比例 / 分辨率，则尊重用户选择，**不再自动覆盖**（用 ref 标记 isUserOverride）。

### 3.2 图片比例选项

**主组（6 个，含「更多」入口）**：`1:1` / `3:2` / `2:3` / `3:4` / `4:3` / `更多`

**「更多」弹出 popover 内（5 个）**：`4:5` / `5:4` / `9:16` / `16:9` / `21:9`

当前选中的比例如果在「更多」组内，主组的「更多」按钮上方显示一个小角标，且顶部「图片比例 *」右侧显示当前选中值 + `>`。

## 4. ShotPlan 设计

**固定 9 张**，labels 沿用原 PRD v1 第 4.3 节：

| order | shotId | label |
|---|---|---|
| 1 | `shot_1` | 近景 |
| 2 | `shot_2` | 中景 |
| 3 | `shot_3` | 远景 |
| 4 | `shot_4` | 背面 |
| 5 | `shot_5` | 侧面 |
| 6 | `shot_6` | 45度侧面 |
| 7 | `shot_7` | 半身特写 |
| 8 | `shot_8` | 产品细节特写 |
| 9 | `shot_9` | 仰拍/低角度大片 |

`buildPhotoFissionShotPlan(input)` 输入 `{ category, imageRatio, resolution, hasFrontDetail, hasBackDetail }`，输出 `PhotoFissionShot[]`。

每个 shot：

```ts
interface PhotoFissionShot {
  shotId: string   // 'shot_1' .. 'shot_9'
  label: string    // 中文短标签
  prompt: string   // 完整 finalPrompt
  order: number    // 1-based
}
```

## 5. Prompt 构造规则

每条 shot.prompt 必须包含 6 个段落：

### 5.1 任务上下文段
```
本次任务：基于参考图生成服装电商套图中的【<label>】镜头。
```

### 5.2 参考图说明段（按上传情况动态拼接）
```
【参考图说明】
- 图1：主图（用户已满意的服装大片，请保持人物、服装、风格、光线一致）
- 图2：产品正面细节补充（请保持领口、面料、Logo、图案等正面细节一致）   ← 仅当上传时
- 图3：产品背面细节补充（请在背面或侧后角度保持背部结构一致）              ← 仅当上传时
```

### 5.3 当前镜头要求段（按 label 差异化）

| label | 镜头要求文案（写入 prompt） |
|---|---|
| 近景 | 镜头距离贴近主体，仅展示头肩或腰部以上区域；强化服装表面纹理与质感 |
| 中景 | 镜头距离适中，完整呈现主体腰部以上至膝盖；构图均衡 |
| 远景 | 远距离全景构图，主体居中，环境氛围参与画面 |
| 背面 | 主体背身展示，突出背部廓形、肩线、裙摆/裤型层次 |
| 侧面 | 主体正侧面展示，展现服装侧身结构与轮廓 |
| 45度侧面 | 主体 45 度斜侧角度，兼顾正面识别与侧面立体感 |
| 半身特写 | 镜头聚焦主体上半身，强调面部状态与上身服装搭配 |
| 产品细节特写 | 极近距离展示服装关键工艺细节，如领口、袖口、纽扣、面料、图案 |
| 仰拍/低角度大片 | 相机自下而上仰拍，强调身材比例与服装气势，画面具有大片质感 |

### 5.4 服装保持要求段

```
【服装保持要求】
严格保留主图中的服装款式、颜色、版型、材质、图案、Logo、纽扣、口袋、领口、袖口、裤脚等所有细节。
不要改变服装颜色，不要新增或删除图案，不要把服装变成其他款式。
```

### 5.5 品类专属保持要求段（按 category 追加）

| category | label | 追加文案 |
|---|---|---|
| `tops` | 上衣 | 突出上衣领口、肩线、袖型与下摆轮廓；下装搭配自然但不抢主体 |
| `pants` | 裤子 | 突出裤型、裤脚、腰线与版型立体感；上身搭配简洁不抢主体 |
| `skirts` | 裙子 | 突出裙摆层次、长度与版型流动感；保持腰线与裙身比例 |
| `suit` | 套装 | 保持上下装色彩、材质、版型的整体协调统一 |
| `outerwear` | 外套 | 突出外套廓形、领型、下摆与厚度感；内搭简洁 |
| `childrens` | 童装 | 保持儿童体型比例、童装版型宽松度与亲和感；避免成人化处理 |

### 5.6 输出参数段

```
【输出参数】
画面比例：<imageRatio>；分辨率档位：<resolution>；品类：<categoryLabel>。
```

### 5.7 风格保持 + 禁止项段

```
【风格保持】
整体摄影风格、光线、画面质感与主图一致。

【允许变化】
仅允许变化镜头角度、景别、构图、距离和细节展示。

【禁止项】
不要改变服装款式 / 颜色 / 图案；不要生成文字、水印、品牌标识；
不要生成畸形手指、异常肢体、扭曲五官、错误服装结构；
不要生成低清晰度、卡通、插画、过度美颜或明显 AI 感图片。
```

## 6. 后端架构

```
POST /api/tasks
  ↓
task-store.createTask
  ↓
task-store.normalizeTaskParams
  └─ photo-fission → normalizePhotoFissionParams
                       ↓
                       buildPhotoFissionShotPlan(input)  // 9 条固定
                       ↓
                       PhotoFissionParams { ..., shotPlan, resultCount=9 }
  ↓
runTask → runThirdPartyWorkflow → runPhotoFissionPipeline
  ├─ 逐 shot 调 runGoogleImageEdit(count=1, model=params.model)
  ├─ 多图（主图+正面细节+背面细节）按 inline_data array 一次性发给 Google API
  ├─ 低并发（默认 2，env PHOTO_FISSION_CONCURRENCY）
  └─ per-shot 失败容忍，全部失败才 throw
  ↓
runTask.resolveTaskCompletion
  ├─ results.length === 9 → success
  ├─ 0 < results.length < 9 → partial（message 写 N/9）
  └─ results.length === 0 → failed
```

### 6.1 多图发送策略

`inputAssetIds` 顺序：`[主图, 正面?, 背面?]`（可选不存在则跳过）

`getInputImagePayload` 在 photo-fission 分支：直接返回 `string[]`（按 ai-fashion-photo 同款逻辑，让 Google API 把每张图当 Image 1 / Image 2 / ... 对应 prompt 中的「图1 / 图2 / 图3」）

**不**再使用 SVG referenceSheet 拼图路径。

## 7. 前端 UI 改造点

### 7.1 LeftPanel — `photo-fission` 表单（参考图样式）

**整体布局**：320px 宽，与姿势裂变左侧面板等宽

```
┌─ 服装大片裂变 ─────────────┐
│ 版本：[稳定版 ▾]            │  ← 改为模型选择
│ 品类：[童装 ▾]              │  ← 6 项下拉
│ * 主图（compact 上传框）     │
│   显示尺寸 W×H px           │
│ 产品正面细节图（非必填）       │  ← compact + 示例图（豹纹）
│ 产品背面细节图（非必填）       │  ← compact + 示例图（豹纹）
│ * 图片比例           3:4 >  │  ← 6 卡片含"更多"
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐│
│ │1:1││3:2││2:3││3:4││4:3││更多││
│ └──┘└──┘└──┘└──┘└──┘└──┘│
│ 分辨率：[1k] [2k] [4k]      │
├────────────────────────────┤
│ [✨ 立即生成]               │  ← 不显示积分
└────────────────────────────┘
```

**state 清单**：

```ts
photoFissionModel: FashionModelId
photoFissionCategory: PhotoFissionCategory
photoFissionMainImage: UploadedImage | null
photoFissionFrontDetail: UploadedImage | null
photoFissionBackDetail: UploadedImage | null
photoFissionImageRatio: PhotoFissionImageRatio
photoFissionResolution: PhotoFissionResolution
photoFissionRatioUserOverride: boolean
photoFissionResolutionUserOverride: boolean
photoFissionMoreRatioOpen: boolean   // 控制更多 popover
```

**关键逻辑**：

1. **主图 onUploaded 回调**：根据图片 W/H 推断默认 `imageRatio` 和 `resolution`，仅当 `*UserOverride === false` 时覆盖
2. **`onImageRatioChange / onResolutionChange`**：标记对应 override 为 true
3. **`getInputAssetIds()`**：按顺序返回 `[main, front?, back?]`，至少包含主图
4. **`getParams()`**：返回 v2 PhotoFissionParams 结构
5. **`handleCreateTask`**：未上传主图 → setError('请先上传参考图') 并 return
6. **「立即生成」按钮**：不展示积分

### 7.2 RatioSelector 扩展

`option-selectors.tsx` 的 `RatioSelector` 需要支持「更多」popover 弹出。

实现策略 A（推荐，组件内自管）：
- `RatioSelector` 新增可选 prop `extraOptions?: { id; label }[]`，当传入时主组最后一项显示「更多」，点击展开 popover 平铺 extraOptions

实现策略 B：在 left-panel 内独立写一个 `PhotoFissionRatioSelector` 包装组件（不污染通用 RatioSelector，与姿势裂变隔离）

⚠️ **必须不影响姿势裂变现有的 RatioSelector 行为**——姿势裂变也用 `RatioSelector + POSE_IMAGE_RATIOS`（含 'more' id），但行为不变。策略 B 更稳。

### 7.3 RightPanel — 仅历史记录

- photo-fission 主结果区显示 9 张图（带 label 角标）
- 「复制全部 Prompt」按 label 分段（v1 已实现）
- **不显示「案例库」Tab**（photo-fission 没有案例库；姿势裂变保留其案例库 Tab 不变）
- 不显示积分相关 UI

## 8. 类型与字段调整

### 8.1 重写 `PhotoFissionParams`

```ts
export interface PhotoFissionParams {
  model: FashionModelId
  category: PhotoFissionCategory
  hasFrontDetail: boolean
  hasBackDetail: boolean
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  shotPlan: PhotoFissionShot[]
  resultCount: 9
}
```

**移除**：`variationTypes` / `generateCount` / `userPrompt` / `creditsCost`

### 8.2 重写 `PhotoFissionImageRatio`

```ts
export type PhotoFissionImageRatio =
  | '1:1' | '3:2' | '2:3' | '3:4' | '4:3'   // 主组
  | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' // 更多组
```

注意：不要带 `'more'` 哨兵（v1 的 PHOTO_FISSION_IMAGE_RATIOS 有 more，本期改为「more」只作为 UI 按钮，不写入 params）

### 8.3 新增 `PhotoFissionResolution`

```ts
export type PhotoFissionResolution = '1k' | '2k' | '4k'
```

可以直接复用 `PoseResolution`（值完全一致），用 `export type PhotoFissionResolution = PoseResolution` 即可。

### 8.4 `creditsUsed` 处理

`GenerationTask.creditsUsed` 现仍由 `getCredits(params)` 计算。photo-fission 没有 `creditsCost`/`generateCount`，让 `getCredits` 兜底返回 `0`（photo-fission 内部产品不计费）。

`right-panel` 的「N 张结果 · 消耗 X 点」展示在 photo-fission 上隐藏积分部分。

## 9. 错误处理

- 未上传主图 → 前端拦截
- 服务端 normalize 异常 → 400 中文错误
- 单 shot 失败 → service 内 catch 继续
- 全 shot 失败 → 抛 Error → failed
- 部分成功 → partial（消息：「已生成 N/9 张」）
- 不影响 ai-fashion-photo / pose-fission

## 10. 接受标准（v2）

1. ✅ 表单 UI 与参考图一致（模型/品类/3 上传框/6+5 比例/分辨率，无生成数量/裂变类型/补充提示词/积分）
2. ✅ 主图上传后比例 + 分辨率默认值由图片尺寸推断
3. ✅ 用户手动改过的字段不被自动覆盖
4. ✅ 「更多」按钮弹出 popover 展示 5 个额外比例
5. ✅ 未上传主图点击生成 → 拦截
6. ✅ 上传成功 → 创建任务，shotPlan 9 条
7. ✅ 每张 finalPrompt 互不相同 + 各自含 label 描述 + 6 段必备内容
8. ✅ 上传正面/背面细节图后，每条 prompt 的「参考图说明」段动态体现，且 inputImages 数组按序传给 Google API
9. ✅ 品类专属保持要求段按 category 注入
10. ✅ 结果卡片显示 label + 可下载 + 复制全部 Prompt 按 label 分段
11. ✅ photo-fission 不显示「案例库」Tab + 不显示积分
12. ✅ `pnpm build` + `tsc --noEmit` 通过
13. ✅ 不影响 AI 服装大片 / 姿势裂变 / 元素替换

## 11. 不动清单

- `lib/server/ai-fashion-photo-service.ts`
- `lib/server/pose-fission-service.ts`
- `lib/server/google-genai-adapter.ts`（**本期 fetch retry 不做**）
- `app/api/assets/upload/route.ts`（损坏图片魔数校验本期不做）
- `app/api/tasks/route.ts` 与 `[taskId]/route.ts`
- `components/workbench/workbench.tsx`
- `components/workbench/feature-sidebar.tsx`
- 姿势裂变现有的 `PoseFissionForm` 与 `RatioSelector` 行为

## 12. 文件清单（v2 重做）

### 修改

| 路径 | 改动要点 |
|---|---|
| `lib/types.ts` | 重写 `PhotoFissionParams` / `PhotoFissionImageRatio`；新增 `PhotoFissionResolution`；更新对应常量数组；移除 `PhotoFissionVariationType` / `PhotoFissionGenerateCount` |
| `lib/server/photo-fission-service.ts` | 重写 `normalizePhotoFissionParams`（删旧字段加新字段）；重写 `buildPhotoFissionShotPlan`（固定 9 张 + 品类专属段 + 细节图说明段）；`runPhotoFissionPipeline` 改为支持多图 input |
| `lib/server/task-store.ts` | `getCredits` photo-fission 返回 0；`resolveTaskCompletion` photo-fission 按 9 张判定（之前已经做了，可能微调） |
| `lib/server/third-party-image-adapter.ts` | photo-fission 分支：`getInputImagePayload` 直接返回 `string[]`（不走 SVG）；photo-fission 长度校验放宽到 1-3 张 |
| `components/workbench/left-panel.tsx` | photo-fission 表单整体重写：模型/品类/3 上传/比例 6+5/分辨率/无 prompt textarea/无 credits；新增主图尺寸推断 logic |
| `components/workbench/right-panel.tsx` | photo-fission 上不显示「案例库」Tab 与积分行（其他 feature 不变） |

### 新增

| 路径 | 用途 |
|---|---|
| 无新文件 | 「更多」popover 用 Radix Popover 在 left-panel 内联实现，不必新建独立组件 |

### 不增不改

| 路径 | 原因 |
|---|---|
| `components/workbench/option-selectors.tsx` | 不动 RatioSelector（避免污染姿势裂变） |
| `components/workbench/upload-components.tsx` | 用现有 `UploadBox variant='compact'` |

## 13. 历史决议归档

v1（推翻）：

- 4/6/9 generateCount 选择 ❌
- 多角度/多景别/多动作/详情特写 4 项多选 ❌
- 800 字补充提示词 textarea ❌
- creditsCost = generateCount ❌
- PhotoFissionVariationType / PhotoFissionGenerateCount 类型 ❌
- 移除正面/背面细节图 ❌

v2（最终）：

- 固定 9 张
- 删裂变类型
- 删补充提示词
- 不计费
- 恢复正面/背面细节图 + 后端动态拼接说明段
- 加模型切换
- 加分辨率
- 主图尺寸推断默认值
- 「更多」popover 弹出 5 个额外比例

## 14. v3 决议（2026-05-18 产品经理对齐）

> v2 完成后产品经理基于 NanoBanana Pro 多镜头一致性参考精华重新对齐 prompt 强约束策略。
> 本节追加，不修订前 13 节。

### 14.1 产品定义重申

服装大片裂变 = 用户上传一张满意成片 → 系统在保持「同人、同服装、同场景、同光线、同视觉风格」的前提下，生成 9 张套图。覆盖多角度、多景别、多姿势、特殊构图。

**重点是「受控裂变」**——只变化镜头/距离/姿势/构图，**不变化人物身份、服装、场景、光线、风格**。

### 14.2 用户输入边界（确认）

- photo-fission 是「预制模板的按钮触发器」
- 用户**不输入任何 prompt 文字**
- 用户只选：模型/品类/主图/正面细节/背面细节/比例/分辨率
- 所有 prompt 段落由后端固定模板拼装

### 14.3 9 张 label 改版（覆盖 PRD 第 4 节）

按 order 1-9 顺序：

| order | shotId | label（v3） |
|---|---|---|
| 1 | `shot_1` | 正面站姿 |
| 2 | `shot_2` | 45度斜侧 |
| 3 | `shot_3` | 侧面站姿 |
| 4 | `shot_4` | 背面站姿 |
| 5 | `shot_5` | 远景全景 |
| 6 | `shot_6` | 半身近景 |
| 7 | `shot_7` | 坐姿变化 |
| 8 | `shot_8` | 行走动态 |
| 9 | `shot_9` | 局部细节特写 |

每个 label 对应的镜头特征文案写入 `PHOTO_FISSION_SHOT_BLUEPRINT` 常量。

### 14.4 Prompt 模板改版（每条 shot 含 12 段，覆盖 PRD 第 5 节）

每条 shot.prompt 必须按以下 12 段顺序拼装：

1. **任务声明**——明确受控裂变要求（只变镜头/姿势/构图，不变身份/服装/场景/光线/风格）
2. **参考图说明**——按 hasFrontDetail/hasBackDetail 动态拼接 1/2/3 张图位置
3. **身份锁 IDENTITY_LOCK**——脸型/五官比例/骨架/眼距/唇形/下颌/眉形/肤色/发型；禁止换脸/美颜/对称化
4. **服装锁 WARDROBE_LOCK**——款式/颜色/版型/材质/图案/Logo/细节；禁止改色/增删图案
5. **场景锁 SCENE_LOCK**（新增）——背景/道具/墙面/地板/家具/灯具/植物；禁止换环境
6. **光线锁 LIGHTING_LOCK**（新增）——光源方向/强度/色温/阴影/高光；禁止改光线性质与色温
7. **视觉风格锁 STYLE_LOCK**（新增）——摄影质感/调色/锐度/氛围；禁止卡通/插画/油画/水彩
8. **当前镜头 SHOT**——按 label 差异化（来自 `PHOTO_FISSION_SHOT_BLUEPRINT.description`）
9. **品类专属保持**——按 category 注入（沿用 PRD 第 5.5 节 6 套文案）
10. **解剖与手部 ANATOMY**（新增）——手指 5 指/关节自然；禁止畸形/缺失/扭曲
11. **输出参数**——画面比例 / 分辨率 / 品类
12. **禁止项 NEGATIVE**——强化文字/水印/Logo/畸形/低清/卡通/动漫；强调不要换脸/换色/换场景/换光线

### 14.5 修订核心理由

NanoBanana Pro 多镜头一致性参考精华提供了完整 lock 机制（identity_lock / reference_image_usage / anatomy_and_hands / negative_prompt），但 Gemini 3.x 没有这些 API 参数。本期把上述结构**翻译成自然语言强约束**，写入每条 shot.prompt：

- 用「**`**」加粗标记关键禁止/必须语句，提升模型注意度
- 5 个 lock 段分别强制约束身份/服装/场景/光线/风格 5 个维度
- 解剖段独立成块，避免手部畸形与肢体扭曲
- 禁止项数组用具体词汇枚举（如「卡通/动漫/插画/油画」而非「非真实风格」）

### 14.6 实现位置

- ✅ `lib/server/photo-fission-service.ts`：重写 `buildPhotoFissionShotPlan`，新增 lock 段构造函数（`buildIdentityLockSection` / `buildWardrobeLockSection` / `buildSceneLockSection` / `buildLightingLockSection` / `buildStyleLockSection` / `buildAnatomySection` / `buildNegativeSection` 等），9 张 label 改用 `PHOTO_FISSION_SHOT_BLUEPRINT` 常量
- ✅ `lib/types.ts`：同步 `PHOTO_FISSION_CASES[0].shotLabels` 为 v3 9 张 label
- ❌ 不动其他文件（前端 v2 已无 userPrompt 字段；google-genai-adapter、third-party-image-adapter、task-store 行为不变）

### 14.7 单条 prompt 字数实测

实际生成的单条 prompt 落在约 **1400-1500 字**（含细节图说明、5 个 lock 段、ANATOMY、中英双语 NEGATIVE 关键字）。
v2 时约 250-300 字；v3 把 NanoBanana Pro 参考精华的具体英文 negative 词（cartoon/anime/illustration/oil painting/watercolor/sketch/3D render/plastic skin/extra fingers/missing fingers/distorted anatomy/multiple panels/grid layout/...）以中文短句包装一同写入，整体仍远低于 Google API ~2000 字软上限。

### 14.8 关键执行差异

每张 shot **独立调用一次** Google `generateContent`（concurrency 默认 2，可配置）：

- ❌ 不在单条 prompt 内要求模型一次输出多宫格 grid（NanoBanana 参考 prompt 用了 `layout: grid`，但 Gemini 3.x 在 4K 出图下若被要求 grid 会把单 panel 缩到 ~1K，电商套图不可用）
- ✅ 每条 prompt 段 1 与段 11 双重强调「单张完整图片输出」，段 12 NEGATIVE 列入 `multiple panels / grid layout / collage / split-screen / photo wall`
- ✅ 流式持久化（`onShotResult` 回调）保证已成功的 shot 不会因后续 shot 卡死而丢失

### 14.9 借鉴来源

NanoBanana Pro 多镜头一致性参考 prompt 精华（v3.1 identity_lock + reference_image_usage + v2.0 anatomy_and_hands + negative_prompt）翻译为 Gemini 3.x 可吃的自然语言约束。原参考的 JSON 结构化字段被压平为 12 段自然语言文本块，并对每个 lock 段加 `**...**` 加粗以提升模型注意度。

## 15. v4 决议（2026-05-18 稳定性优化 · 第一阶段）

> 本节追加于 v3 之后，不修订前 14 节。目标：在仅使用 Google 官方 API（第一阶段，不接七牛云）的前提下，把 AI 服装大片与 AI 服装大片裂变两条生图主链路的 P99 成功率从 ~85% 拉到 95%+。

### 15.1 范围与目标

**覆盖**：

- `ai-fashion-photo`（AI 服装大片）
- `photo-fission`（AI 服装大片裂变）

**不覆盖**（沿用现状）：

- `pose-fission`、`element-replace` 的 Google 调用按现状保留，但若改造点天然惠及（如共用 wrapper）则一并享受。

**量化目标**：

- 生产环境运行 1 天，`gimg.fail / gimg.attempt < 5%`（当前估算 15–20%）
- 主动触发 429 的次数降为 0（依赖客户端节流）
- 任意单次 transient 抖动不再导致整批失败
- partial 状态下用户可只重跑失败的镜头，无需 9 张全部重跑

### 15.2 调研产物索引

实施前必须读完 `.trellis/tasks/05-17-photo-fission/research/` 下：

- `stability-current-state.md` —— 现状盘点与失败处理盲点（含文件:行号）
- `stability-failure-modes.md` —— 12 类失败模式 + 推荐处理矩阵（**implement 的分支映射靠它**）
- `stability-google-best-practices.md` —— Google 官方建议、SDK 重试参数、限额表
- `stability-industry-patterns.md` —— 行业容灾模式对比
- `stability-recommendations.md` —— 7 条建议 + 实施顺序 + 验收口径

### 15.3 R1：统一 `withGoogleImageRetry` wrapper

**目的**：消除 ai-fashion-photo 完全无重试、photo-fission 用字符串匹配判断错误的双重脆弱性。

**新文件**：`lib/server/google-image-retry.ts`

接口（建议）：

```ts
export type GoogleImageErrorCategory =
  | 'network' | 'rate_limit' | 'server_error'
  | 'safety_block' | 'image_safety' | 'prohibited'
  | 'empty_output' | 'bad_request' | 'auth_failed' | 'unknown'

export class GoogleImageError extends Error {
  category: GoogleImageErrorCategory
  httpStatus?: number
  retryable: boolean
  cause?: unknown
}

export interface RetryOptions {
  attempts?: number       // 默认 4
  baseDelayMs?: number    // 默认 1000
  maxDelayMs?: number     // 默认 60000
  exponent?: number       // 默认 2
  jitter?: number         // 默认 0.25
  /** 单 category 上限（覆盖 attempts），例如 image_safety: 1 */
  perCategoryMaxAttempts?: Partial<Record<GoogleImageErrorCategory, number>>
}

export async function callGoogleImageWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  context: { traceId: string; taskId: string; shotId?: string },
  options?: RetryOptions,
): Promise<T>
```

**行为约束**：

1. 按 category 决定 `retryable`，**绝不重试** `prohibited / bad_request / auth_failed`。
2. 退避：`delay = min(maxDelayMs, baseDelayMs × exponent^(attempt-1)) × (1 ± jitter)`
3. `category = 'rate_limit'`：优先读 response `Retry-After` 头（秒或 HTTP-Date），取 `max(Retry-After, 30s)` 再叠加 jitter
4. `category = 'image_safety' / 'safety_block'` 默认上限 1 次；超出后抛 `GoogleImageError`，由上层决定 partial fail
5. `category = 'empty_output'` 默认上限 2 次（命中 issue #1406）
6. 每次 attempt 与每次 fail 都打结构化日志（见 R4）

### 15.4 R2：3 个失败模式缺口补齐

R2 不是独立模块，**全部在 R1 的 wrapper + `google-genai-adapter.ts` 的错误识别层落地**：

#### R2.1 空 inlineData 自动重试

在 `google-genai-adapter.ts:performSingleCall` 中：

```ts
if (finishReason === 'STOP' && !inline?.data) {
  throw new GoogleImageError({
    category: 'empty_output',
    retryable: true,
    message: 'Gemini 返回 STOP 但未生成 image part',
  })
}
```

wrapper 自动重试 2 次。

#### R2.2 IMAGE_SAFETY / SAFETY 单次重试

```ts
if (finishReason === 'IMAGE_SAFETY') throw new GoogleImageError({ category: 'image_safety', retryable: true, ... })
if (blockReason === 'SAFETY' || blockReason === 'OTHER') throw new GoogleImageError({ category: 'safety_block', retryable: true, ... })
if (blockReason === 'PROHIBITED_CONTENT' || blockReason === 'RECITATION') throw new GoogleImageError({ category: 'prohibited', retryable: false, ... })
```

#### R2.3 Retry-After 头部尊重

`fetchWithTimeout` 返回 Response 时由 wrapper 检查 `response.headers.get('retry-after')`，按上节规则计算等待。

### 15.5 R3：进程级 IPM/RPM 令牌桶

**新文件**：`lib/server/google-image-throttle.ts`

```ts
export interface ThrottleConfig {
  maxImagesPerMinute: number  // env GOOGLE_IMAGE_IPM, 默认 10
  maxRequestsPerMinute: number // env GOOGLE_IMAGE_RPM, 默认 150
}

export async function acquireGoogleImageSlot(
  apiKey: string,
  signal?: AbortSignal,
): Promise<void>
```

**行为约束**：

1. 单例（`globalThis` 挂载），按 apiKey 维护两个时间戳队列（image 次数 + request 次数）
2. `acquire()`：清理过期时间戳（> 60s），若两个队列任一已满，sleep 到队首过期时间 + jitter
3. wrapper 在每次 attempt 进入 fetch **之前**调用 acquire；HTTP 错误不退还令牌（因为 Google 一样在算配额）
4. env 兜底值与 Tier 1 对齐：IPM=10, RPM=150；用户后续升 Tier 改 env 即可
5. acquire 支持 AbortSignal，若 task 已超 timeout 直接放弃

### 15.6 R4：结构化日志 + traceId

**新文件**：`lib/server/log.ts`（轻量，不引入依赖）

```ts
export interface LogContext {
  traceId: string
  taskId: string
  shotId?: string
  attempt?: number
}

export function logImageEvent(
  evt: 'gimg.attempt' | 'gimg.success' | 'gimg.fail' | 'gimg.retry' | 'gimg.throttle',
  ctx: LogContext,
  payload: Record<string, unknown>,
): void
```

输出 JSON-line：

```
{"lvl":"info","evt":"gimg.attempt","ts":"2026-05-18T...","traceId":"task_xx_shot_3","taskId":"task_xx","shotId":"shot_3","attempt":1,"model":"gemini-3.1-flash-image-preview","promptLen":1452,"refs":3,"aspect":"3:4","size":"2K"}
{"lvl":"warn","evt":"gimg.retry","ts":"...","traceId":"...","attempt":1,"category":"empty_output","delayMs":2380,"reason":"STOP but no inline data"}
{"lvl":"error","evt":"gimg.fail","ts":"...","traceId":"...","attempt":3,"category":"rate_limit","httpStatus":429,"retryAfter":45}
```

**traceId 规则**：

- ai-fashion-photo：`${taskId}`（单次调用）；如未来 count > 1，用 `${taskId}_v${index}`
- photo-fission：`${taskId}_${shotId}`

替换 `google-genai-adapter.ts` 与 `photo-fission-service.ts` 现有 `console.log/warn` 为 `logImageEvent(...)`，保留人类可读的 stderr 兜底（开发模式）。

### 15.7 R5：失败镜头重新生成入口（photo-fission 专属）

**后端**：

- 新增路由 `app/api/tasks/[taskId]/retry-shots/route.ts`
- 接口：`POST /api/tasks/:taskId/retry-shots` body: `{ shotIds: string[] }`
- 行为：
  1. 校验 task 存在、`task.featureType === 'photo-fission'`、`status ∈ {partial, failed}`
  2. 校验每个 shotId 都在原 `task.params.shotPlan` 中且当前 results 没有对应 shotId
  3. 复用原 `task.inputAssetIds` 与原 shotPlan 的 prompt
  4. 调一个新的 `runPhotoFissionPipeline({ ..., targetShotIds })`，pipeline 只跑指定 shot；流式持久化沿用 onShotResult
  5. 完成后重新 `resolveTaskCompletion(task, allResults)` 更新 status
  6. 不另起新 task；credits 不再扣（photo-fission v2 已不计费）
- `photo-fission-service.ts`：`runPhotoFissionPipeline` 接受可选 `targetShotIds: string[]`，**worker 池只处理过滤后的 shotPlan**

**前端**：

- `components/workbench/right-panel.tsx`：photo-fission 结果区在 `status === 'partial' || status === 'failed' && hasAnyResult` 时显示「重新生成失败镜头 (N)」按钮
- 收集 `task.params.shotPlan` 中 shotId 不在 `task.resultAssetIds 对应 shotId` 的项
- 调用 `POST /api/tasks/:taskId/retry-shots` 后轮询 task 状态（已有轮询逻辑复用）

### 15.8 R6：输入预检

**改动**：

- `app/api/assets/upload/route.ts`：对 dataUrl base64 字节数 > 10MB（按 `4 * Math.ceil(base64.length / 4) * 3 / 4` 估算或直接 `Buffer.from(b64,'base64').byteLength`）拒绝并返回 413 中文提示
- `lib/server/ai-fashion-photo-service.ts:normalizeAiFashionPhotoParams`：finalPrompt 字符长度 > 30000 拒绝
- `lib/server/photo-fission-service.ts:normalizePhotoFissionParams`：同上（v3 每条 prompt ~1500 字，9 张共享 prompt 不会超，但加 guard）

### 15.9 R7：401/403 全局熔断

`google-image-retry.ts` 内维护 module-level：

```ts
let authFailureUntil: number | null = null

function isAuthBlocked() {
  return authFailureUntil !== null && Date.now() < authFailureUntil
}
```

- 任何 `category === 'auth_failed'` 触发 `authFailureUntil = Date.now() + 30000`
- 每次 `callGoogleImageWithRetry` 进入前检查，若被熔断直接抛 `GoogleImageError { category: 'auth_failed', retryable: false }`
- 30s 后自动解除

### 15.10 env 新增

`.env.example` 追加（必须有中文注释）：

```bash
# --- Google 生图稳定性（第一阶段，仅官方 Google API） ---
# 客户端节流：每分钟最多发起的 image 请求数。Free=2 / Tier 1=10 / Tier 2=50。
GOOGLE_IMAGE_IPM=10
# 客户端节流：每分钟最多发起的请求数。Tier 1=150 / Tier 2=1000。
GOOGLE_IMAGE_RPM=150
# 重试总尝试次数（含首次）。
GOOGLE_IMAGE_RETRY_ATTEMPTS=4
# 重试基础退避（毫秒）。
GOOGLE_IMAGE_RETRY_BASE_DELAY_MS=1000
# 重试最大退避（毫秒）。
GOOGLE_IMAGE_RETRY_MAX_DELAY_MS=60000
```

**移除/调整**：保留 `PHOTO_FISSION_SHOT_RETRIES`，但语义变为 wrapper attempts 的上限（不再线性退避）。

### 15.11 不动清单

- `lib/server/pose-fission-service.ts`（pose-fission 不在本期范围；可选追加 wrapper 但不强制）
- `lib/server/third-party-image-adapter.ts` 的 Raycast 路径
- 所有 `components/workbench/` 除 `right-panel.tsx` 外
- 任何 `.trellis/spec/` 文档（**spec 由 trellis-update-spec 阶段统一更新**）

### 15.12 文件清单（v4）

#### 新增

| 路径 | 用途 |
|---|---|
| `lib/server/google-image-retry.ts` | 统一 wrapper + 错误分类 + 退避 + 熔断 |
| `lib/server/google-image-throttle.ts` | IPM / RPM 令牌桶 |
| `lib/server/log.ts` | 结构化 JSON-line logger |
| `app/api/tasks/[taskId]/retry-shots/route.ts` | photo-fission 重跑失败镜头 |

#### 修改

| 路径 | 改动要点 |
|---|---|
| `lib/server/google-genai-adapter.ts` | 抽出 performSingleCall；改抛 GoogleImageError；接入 throttle + retry wrapper；替换 console.* 为 logImageEvent |
| `lib/server/photo-fission-service.ts` | 删除 `runPhotoFissionShotWithRetry` 与 `isRetryablePhotoFissionError`（字符串匹配版本）；改调 wrapper；`runPhotoFissionPipeline` 支持 `targetShotIds` |
| `lib/server/third-party-image-adapter.ts` | `runGoogleProviderEdits` 接入 wrapper（替换裸 runGoogleImageEdit 多次串行 loop 为 wrapper × count） |
| `lib/server/task-store.ts` | 暴露 retryShots 流程；persistOneResult 复用 |
| `lib/server/ai-fashion-photo-service.ts` | finalPrompt 长度校验 |
| `app/api/assets/upload/route.ts` | 参考图字节大小预检 |
| `.env.example` | 新增稳定性 env |
| `components/workbench/right-panel.tsx` | partial / failed-with-partial-results 状态下的「重新生成失败镜头」按钮 |

### 15.13 接受标准（v4）

1. ✅ `lib/server/google-image-retry.ts` 与 `lib/server/google-image-throttle.ts` 存在，并被 ai-fashion-photo 与 photo-fission 同时使用
2. ✅ `photo-fission-service.ts` 不再有 `isRetryablePhotoFissionError` 字符串匹配逻辑
3. ✅ `GoogleImageError` 10 个 category 都被 `google-genai-adapter.ts` 的错误识别覆盖
4. ✅ 模拟空 inlineData：重试 2 次后才 fail（可通过日志看到 `gimg.retry, category: empty_output`）
5. ✅ 模拟 429 + Retry-After: 45：第二次 attempt 至少等了 45s + jitter
6. ✅ photo-fission 9 张 + concurrency=3 时，瞬时不超 IPM 配置（日志可见 `gimg.throttle, waitMs`）
7. ✅ 所有日志为 JSON-line，含 traceId / taskId / shotId / attempt / category 字段
8. ✅ partial 状态下，前端「重新生成失败镜头」按钮可见且仅重跑失败 shot；成功合并回原 task
9. ✅ 上传 > 10MB 参考图 → 413 拒绝；finalPrompt > 30000 字 → 400 拒绝
10. ✅ 401/403 触发后 30s 内同 apiKey 全部 fast-fail
11. ✅ `pnpm build` + `tsc --noEmit` 通过
12. ✅ 不影响 pose-fission / element-replace 现状行为
13. ✅ trellis-check 通过

### 15.14 实施顺序建议（对 trellis-implement）

```
Step 1: 新增 lib/server/log.ts + lib/server/google-image-retry.ts（含 GoogleImageError class）+ lib/server/google-image-throttle.ts。
        单元测试三者的纯函数（退避计算、令牌桶 acquire、错误分类映射）
Step 2: 重构 lib/server/google-genai-adapter.ts，抽 performSingleCall + 错误分类 + 接 wrapper + throttle + logger
Step 3: 改 lib/server/third-party-image-adapter.ts: runGoogleProviderEdits 走 wrapper × count
Step 4: 改 lib/server/photo-fission-service.ts: 删 runPhotoFissionShotWithRetry + 接 wrapper + 支持 targetShotIds
Step 5: 改 lib/server/ai-fashion-photo-service.ts + photo-fission-service.ts: finalPrompt 长度 guard
Step 6: 改 app/api/assets/upload/route.ts: 参考图字节预检
Step 7: 新增 app/api/tasks/[taskId]/retry-shots/route.ts + lib/server/task-store.ts: retryShots 流程
Step 8: 改 components/workbench/right-panel.tsx: 「重新生成失败镜头」按钮
Step 9: 改 .env.example: 新增 6 条 env + 中文注释
Step 10: pnpm build + tsc --noEmit + 手测两条主链路 happy / 限流 / safety / 空 inlineData 4 个 case
```

### 15.15 风险与回滚

- **风险**：wrapper 抽象错可能反而把成功路径拖慢——务必保留快路径 attempt 1 时 `delayMs=0`，且 throttle 在配额未满时 `acquire()` 立即返回
- **风险**：IPM env 配错（用户在 Free Tier 但配了 10）会重新触发 429——文档明确告知，并让 `gimg.fail, category: rate_limit` 日志一目了然
- **回滚**：所有改动集中在 lib/server/* + 2 个 API + 1 个 UI 文件，回滚只需 git revert 单个提交

### 15.16 后续阶段预告（**本期不做**）

- 第二阶段：接入七牛云 / 其他中转商，把 wrapper 抽象成 `ImageProviderAdapter` 接口，按 provider 路由
- 第三阶段：引入 Redis 任务队列、Sentry / OTel、Webhook 通知（如果业务规模触达瓶颈）
