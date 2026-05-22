# 姿势裂变 pose-fission

## Goal

让用户上传一张穿搭主图（可选正面/背面细节图），从「姿势库」Modal 多选姿势模板，
保持人物身份与服装细节，仅替换为目标姿势，每个姿势生成 1 张图。
为电商投流和搭配图提供"同人同款换姿势"的高效素材生产路径。

## What I already know（来自代码巡检）

### 现状：pose-fission 已 80% 打通，需要重构数据模型 + 部分 UI

- **类型层**（`lib/types.ts`）：`PoseFissionParams`（单选）、`PoseCase`、6 个 `POSE_CASES`、`PoseImageRatio`、`PoseResolution` 已就绪
- **后端服务**（`lib/server/pose-fission-service.ts`）：normalize / buildPrompt / SVG 实现完整但仅处理单 pose
- **API 路由**（`app/api/pose-fission/cases/route.ts`）：列出 PoseCase
- **前端表单**（`components/workbench/left-panel.tsx`）：上传 + 姿势选择 + 比例 + 分辨率 + 立即生成完整
- **案例库 UI**（`components/workbench/right-panel.tsx:1520` PoseCaseLibrary）：单选瀑布流 + 收藏机制
- **任务流转**（`lib/server/task-store.ts` + `third-party-image-adapter.ts`）：Google Gemini 3 系列调用 + 流式持久化（photo-fission 范式）
- **photo-fission 复用**（`PhotoFissionCase` + `PhotoFissionCaseLibrary`）：「一键做同款」+ 案例库 Tab 标准实现

### 现有 6 张 pose-*.jpg

经决策（D2）将重新定位为 **1 个 PoseFissionCase**（"黑色蕾丝裙 6 姿势套图"）。

## Decisions (ADR-lite)

### D1（2026-05-18）：渐进式改造，保留后端核心链路

- **Decision**：保留 task-store / Google API 调用 / 流式持久化，重构前端 UI 与数据模型
- **Consequences**：✅ 后端复用 / ⚠️ 类型层和前端 UI 需较大调整

### D2（2026-05-18）：现有 6 张 pose-*.jpg → 1 个 PoseFissionCase（成片案例）

- **Decision**：现有 6 张图归为 1 个 `PoseFissionCase`（黑色蕾丝裙 6 姿势完整成片），姿势模板（`PoseTemplate`）独立成新类型
- **Consequences**：`PoseCase` / `POSE_CASES` → 重命名为 `PoseFissionCase` / `POSE_FISSION_CASES`；新增 `PoseTemplate` 数据模型

### D3（2026-05-18）：「一键做同款」纳入 MVP

- **Decision**：参照 photo-fission 现有实现，案例库 Tab 用 `PoseFissionCaseLibrary` 组件，点击「做同款」回填参数并切到表单
- **Consequences**：`PoseFissionCase` 需含 `poseTemplateIds` / `mainImageUrl` / `model` / `imageRatio` / `resolution`

### D4（2026-05-18）：MVP 姿势模板放占位种子数据

- **Decision**：本小姐为 MVP 编造 5-8 个占位 `PoseTemplate`，含完整 `ageGroup` / `bodyPart` / `prompt`，让 Modal 跑通流程；用户后续替换图片只改数据不动代码

### D5（2026-05-18）：MVP 不计费

- **Decision**：`creditsCost = 0`，「立即生成」按钮不显示金额，与 photo-fission v2 设计一致

### D6（2026-05-18）：10 个图片比例与 photo-fission 同步

- **Decision**：`PoseImageRatio` 与 `PhotoFissionImageRatio` 同步（1:1 / 3:2 / 2:3 / 3:4 / 4:3 / 4:5 / 5:4 / 9:16 / 16:9 / 21:9 / more）
- **Consequences**：可复用 `PhotoRatioSelector` 或抽出通用比例选择器

### D7（2026-05-18）：姿势库 Modal 三组筛选全要

- **Decision**：「全部/成人/儿童」+「全部/全身/上半身/下半身」+「仅看收藏」
- **Consequences**：`PoseTemplate` 需 `ageGroup: 'adult' | 'kid'` + `bodyPart: 'full' | 'upper' | 'lower'` 两字段

### D8（2026-05-18）：「基础搭配 3 张」一键预设纳入 MVP

- **Decision**：右上角按钮，点击批量勾选 3 个预设 `templateId`（常量配置）
- **Consequences**：`POSE_TEMPLATES_DEFAULT_TRIO`: `string[]` 常量

### D9（2026-05-18）：多选上限 9 个，与 photo-fission shots 数对齐

- **Decision**：用户最多多选 9 个姿势模板，N 个姿势 → N 次独立 Google API 调用（并发 2）
- **Consequences**：`PoseFissionParams.poseTemplateIds.length ∈ [1, 9]`

### D10（2026-05-18）：失败容忍 partial 状态 + 可重跑

- **Decision**：沿用 photo-fission `partial` 状态机 + 流式持久化 + 「重跑失败镜头」按钮模式
- **Consequences**：复用 `retryPhotoFissionShots` 等价物 → 抽出通用 `retryFissionShots(taskId, shotIds, featureType)` 或新建 `retryPoseFissionShots`

### D11（2026-05-18，2026-05-19 更新）：模型选择复用 FashionModelOption，统一开放三种可用模型

- **Decision**：模型字段使用 `FashionModelId = 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview' | 'gpt-image-2'`；模型选择器统一展示 `SELECTABLE_FASHION_MODELS`：Nano Banana / Nano Banana Pro / GPT Image 2
- **Consequences**：AI 服装大片、服装大片裂变、姿势裂变共用同一种模型下拉样式；后端 provider dispatch 必须按模型过滤，`gpt-image-2` 只能分发给支持 `openai/gpt-image-*` 的 `qiniu` provider，不能落到 Google 官方 adapter

## Requirements

### 用户操作流程

1. 切换到「姿势裂变」功能
2. 上传 1 张穿搭主图（必填）
3. 可选上传产品正面细节图（最多 1 张）
4. 可选上传产品背面细节图（最多 1 张）
5. 选择模型版本（Nano Banana / Nano Banana Pro / GPT Image 2）
6. 点击「+ 去姿势库选择合适的姿势」→ 弹出姿势库 Modal
7. 在 Modal 中筛选（人群/身位/收藏）并多选 1-9 个姿势模板（或点「基础搭配 3 张」快捷选 3 个）
8. 点击「确定」回到主表单，左面板「选择姿势」区显示已选姿势缩略图 + 数量
9. 选择图片比例与分辨率
10. 点击「立即生成」→ 后端为每个姿势独立生成 1 张图，流式返回右侧瀑布流

### 右侧案例库 Tab 流程

1. 切到「案例库」Tab，看到 `PoseFissionCase` 卡片（含主图 + 9-image 网格 + 「做同款」按钮）
2. 点击「做同款」→ 自动回填该 case 的主图、姿势模板组合、模型、比例、分辨率到左侧表单，待用户点「立即生成」

### 技术 Requirements

- `PoseTemplate` 类型：`{ id, name, imageUrl, prompt, ageGroup, bodyPart }`
- `POSE_TEMPLATES`：MVP 含 5-8 个占位种子（成人 4-5 个 + 儿童 1-2 个，覆盖全身/上半身/下半身）
- `PoseFissionCase` 类型：`{ id, featureType, name, description, mainImageUrl, resultImageUrls[9], poseTemplateIds, model, imageRatio, resolution }`
- `POSE_FISSION_CASES`：MVP 含 1 个 case（黑色蕾丝裙 6 姿势，使用现有 6 张 pose-*.jpg）
- `PoseFissionParams` 改造：`{ model, poseTemplateIds, hasFrontDetail, hasBackDetail, imageRatio, resolution, resultCount = poseTemplateIds.length, creditsCost = 0 }`
- 后端 normalize：循环校验 poseTemplateIds 都存在且数量 ∈ [1, 9]
- 后端 pipeline：每个 poseTemplateId 独立调用一次 Google API（参考 photo-fission `runPhotoFissionPipeline` 并发 2）+ 流式持久化
- 「重跑失败姿势」按钮（仿 photo-fission `retryPhotoFissionShots`）
- 姿势库 Modal 组件 `PoseLibraryDialog`：含三组筛选 + 基础搭配 3 张 + 已选计数 + 重置/确定

## Acceptance Criteria

- [ ] 用户能打开姿势库 Modal，看到所有 POSE_TEMPLATES，能按三组筛选
- [ ] 用户能多选 1-9 个姿势模板，已选数量实时显示在 Modal 顶部
- [ ] 「基础搭配 3 张」按钮一键勾选预设 3 个 templateId
- [ ] 「重置」清空已选，「确定」回到主表单并显示已选缩略图
- [ ] 主表单「选择姿势」区域显示「N 个姿势已选」+ 缩略图横排
- [ ] 模型选择支持「Nano Banana」「Nano Banana Pro」「GPT Image 2」三个选项
- [ ] 用户能多选 9 个姿势 + 点立即生成 → 后端流式返回 9 张图，每张对应一个 pose
- [ ] 每张结果图保持原图人物身份、服装细节、画面质感，仅换姿势
- [ ] N 个姿势中部分失败时 task.status = 'partial'，已成功的图正常显示
- [ ] 「重跑失败姿势」能针对失败的姿势重新生成，不影响已成功的图
- [ ] 案例库 Tab 显示 PoseFissionCase（黑色蕾丝裙 6 姿势）卡片
- [ ] 点案例库「做同款」→ 自动回填主图占位（黑色裙子）+ 姿势组合 + 模型 + 比例 + 分辨率
- [ ] 9:16 比例的输出图实际宽高比与选择一致

## Definition of Done

- 单元/集成测试覆盖 `normalizePoseFissionParams` 多选场景 + 1-9 边界
- Lint / typecheck 通过
- 与 photo-fission 共享的 task-store 路径不受回归影响
- 文档 spec 更新：`.trellis/spec/frontend/component-guidelines.md` 增加 PoseLibraryDialog 模式
- 旧字段 `PoseCase.featureType: 'pose-fission'` 数据迁移（如有数据库）—— MVP 阶段无 DB，仅常量重命名

## Out of Scope (explicit)

- 用户上传自定义姿势参考图（V2）
- 姿势模板编辑器 / 后台管理界面（V2）
- 历史任务"再生成同款"（V2，先用案例库做同款覆盖）
- 与 photo-fission 共享 retry 抽象（先各自实现，等第三个 feature 出现再抽象）

## Technical Approach

### 类型层（`lib/types.ts`）

```typescript
export type PoseAgeGroup = 'adult' | 'kid'
export type PoseBodyPart = 'full' | 'upper' | 'lower'

export interface PoseTemplate {
  id: string
  name: string         // e.g. "站姿87", "蹲姿3"
  imageUrl: string
  prompt: string       // 姿势 prompt fragment
  ageGroup: PoseAgeGroup
  bodyPart: PoseBodyPart
}

export interface PoseFissionCase {
  id: string
  featureType: 'pose-fission'
  name: string
  description: string
  mainImageUrl: string
  resultImageUrls: string[]
  poseTemplateIds: string[]
  model: FashionModelId
  imageRatio: PoseImageRatio
  resolution: PoseResolution
}

export interface PoseFissionParams {
  model: FashionModelId
  poseTemplateIds: string[]    // 1..9
  poseTemplateSnapshots: PoseTemplate[]  // 冗余存储，避免后续模板变更影响历史任务
  hasFrontDetail: boolean
  hasBackDetail: boolean
  imageRatio: PoseImageRatio
  resolution: PoseResolution
  resultCount: number          // = poseTemplateIds.length
  creditsCost: 0
}

// 新增常量
export const POSE_TEMPLATE_AGE_GROUPS = [...]
export const POSE_TEMPLATE_BODY_PARTS = [...]
export const POSE_TEMPLATES: PoseTemplate[] = [...占位 5-8 个]
export const POSE_TEMPLATES_DEFAULT_TRIO = ['template-1', 'template-3', 'template-5']
export const POSE_FISSION_CASES: PoseFissionCase[] = [...1 个]
export const POSE_IMAGE_RATIOS = [...10 个与 photo-fission 同步]
export const POSE_IMAGE_RATIOS_MAIN = [...5 个]
export const POSE_IMAGE_RATIOS_EXTRA = [...5 个]

// 移除：PoseCase / POSE_CASES / POSE_TEMPLATES（字符串数组）
```

### 后端

- `lib/server/pose-fission-service.ts`：
  - 重写 `normalizePoseFissionParams`：循环校验 poseTemplateIds
  - 新增 `listPoseTemplates()` / `getPoseTemplate(id)`
  - 重写 `buildPoseFissionPrompt(params, template)`：单个 template 单次调用用
  - 新增 `runPoseFissionPipeline`：参照 `runPhotoFissionPipeline` 实现（并发 2，单 pose 单次调用，流式 onShotResult）
  - 新增 `retryPoseFissionShots`：参照 photo-fission

- `app/api/pose-fission/`：
  - `cases/route.ts`：保留，改返回 POSE_FISSION_CASES
  - `templates/route.ts`：新增，返回 POSE_TEMPLATES
  - `tasks/[taskId]/retry/route.ts`：新增（仿 photo-fission）

- `lib/server/task-store.ts`：
  - `runTask` 加 `featureType === 'pose-fission'` 分支走 `runPoseFissionPipeline`
  - 复用 `persistOneResult` 流式持久化逻辑

- `lib/server/third-party-image-adapter.ts`：
  - `runThirdPartyWorkflow` 增 pose-fission 分支调 `runPoseFissionPipeline`
  - 移除旧的单 pose 调用逻辑

### 前端

- `components/workbench/right-panel.tsx`：
  - `PoseCaseLibrary` → 重构为 `PoseFissionCaseLibrary`（参照 `PhotoFissionCaseLibrary`：左图 + 6×1 网格 + 做同款按钮）
  - 新增 `PoseLibraryDialog`（Modal）：三组筛选 + 多选 + 基础搭配 3 张 + 重置/确定

- `components/workbench/left-panel.tsx`：
  - PoseFissionForm 改用 `selectedPoseTemplates: PoseTemplate[]`（数组）
  - 新增 model 选择器（复用 FashionModelSelector）
  - 「选择姿势」区改为"N 张已选 + 缩略图横排"
  - 「+ 去姿势库」按钮触发打开 Modal

- `components/workbench/workbench.tsx`：
  - `selectedPoseCase` → `selectedPoseTemplates: PoseTemplate[]`
  - `poseLibraryRequestKey` 复用（触发打开 Modal）
  - 新增 `handleSelectPoseFissionCase`（参考 `handleSelectPhotoFissionCase`）

## Implementation Plan (small PRs / commits)

- **PR1（类型 + 占位数据 + API）**：lib/types.ts 重构 + 8 个占位 POSE_TEMPLATES + 1 个 PoseFissionCase + /api/pose-fission/templates 路由 + 单元测试
- **PR2（后端 pipeline）**：lib/server/pose-fission-service.ts 重写 normalize + buildPrompt + runPoseFissionPipeline + retryPoseFissionShots + 任务流转集成 + 集成测试
- **PR3（前端 PoseLibraryDialog + 主表单）**：left-panel.tsx 改造（多选模型 + 模型选择 + 已选展示）+ PoseLibraryDialog Modal（三组筛选 + 基础搭配 3 张）
- **PR4（前端 PoseFissionCaseLibrary + 一键做同款）**：right-panel.tsx 重构案例库 Tab + 回填逻辑 + e2e 手动测试

## Technical Notes

- 单次 Google API 调用上限 14 张输入图（FashionModelOption.maxInputImages），但 pose-fission 每次只传 1-3 张（主图 + 0-2 张细节），与该上限无关
- 单次 Gemini 3 系列调用最坏 1-3 分钟，并发 2 时 9 个姿势最坏约 12-15 分钟
- 流式持久化（photo-fission 已验证）：成功的 pose 立即 persistOneResult，task crash 也不丢
- `PoseFissionParams.poseTemplateSnapshots` 冗余存储：避免后续 POSE_TEMPLATES 数据变更影响历史任务回放
- 不抽象通用 `runFissionPipeline`：两个 feature 都各自实现，等第三个出现再抽象（YAGNI）
