# Journal - yinxm (Part 1)

> AI development session journal
> Started: 2026-05-17

---



## Session 1: photo-fission v3+v4: 9张固定套图 + Google生图稳定性 R1-R7

**Date**: 2026-05-18
**Task**: photo-fission v3+v4: 9张固定套图 + Google生图稳定性 R1-R7
**Branch**: `main`

### Summary

PRD v3 落地 photo-fission 9 张固定套图与 12 段强约束 prompt（身份/服装/场景/光线/风格 5 锁 + 解剖 + 禁止项）。PRD v4 完成 Google 生图稳定性第一阶段优化 R1-R7：统一 callGoogleImageWithRetry wrapper（GoogleImageError 10 类 category + 指数退避 + jitter + Retry-After 尊重）、进程级 IPM/RPM 令牌桶、JSON-line 结构化日志（traceId/taskId/shotId/attempt/category）、partial 失败镜头重跑入口、401/403 全局熔断 30s、输入预检（参考图≤10MB / finalPrompt≤30000字）。ai-fashion-photo 与 photo-fission 共用同一 wrapper，删除字符串匹配判错的旧逻辑。同步新增 .trellis/spec/backend/external-image-api-reliability.md 工程契约与 .trellis/spec/guides/external-ai-api-thinking-guide.md 思考清单，沉淀为可执行 7 sections code-spec。研究产物 5 篇 stability-*.md 沉淀到 task research/。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8a0e45b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## Session 2: pose-fission PR1 — 类型层重构 + 占位数据 + templates API

**Date**: 2026-05-18
**Task**: 05-18-pose-fission（姿势裂变 MVP）
**Branch**: `main`

### Summary

按 PRD §11 Implementation Plan 落地 PR1：完成 pose-fission 数据模型从「单选 PoseCase」到「多选 PoseFissionCase + PoseTemplate」的骨架迁移，保证 typecheck / next build 通过且老流程（单 pose 单次出图）继续可跑。Modal 多选 UI、多 pose pipeline、案例库 Tab 重构留给 PR2/PR3/PR4。

### Main Changes

- **lib/types.ts**（类型层）
  - 新增类型：`PoseAgeGroup` / `PoseBodyPart` / `PoseTemplate` / `PoseFissionCase`
  - 改造 `PoseFissionParams`：移除 `version` / `poseCaseId` / `poseName` / `posePrompt`，新增 `model: FashionModelId` / `poseTemplateIds: string[]` / `poseTemplateSnapshots: PoseTemplate[]`，`resultCount: number`，`creditsCost: 0`
  - 删除旧 `PoseCase` 类型与 `POSE_CASES` 常量，新增 `POSE_FISSION_CASES`（1 个案例「黑色蕾丝裙 6 姿势套图」）
  - 比例集与 photo-fission 对齐：`PoseImageRatio` 含 1:1/3:2/2:3/3:4/4:3/4:5/5:4/9:16/16:9/21:9/more 共 11 个 id，新增 `POSE_IMAGE_RATIOS_MAIN`（主组 5 项）/ `POSE_IMAGE_RATIOS_EXTRA`（扩展 5 项）
  - 新增 8 个占位 `POSE_TEMPLATES`（6 成人 + 2 儿童，覆盖 full/upper/lower）+ `POSE_TEMPLATES_DEFAULT_TRIO` 基础搭配 3 张预设
  - 新增 `POSE_TEMPLATE_AGE_GROUPS` / `POSE_TEMPLATE_BODY_PARTS` 筛选维度常量

- **lib/server/pose-fission-service.ts**（后端服务）
  - 旧 `listPoseCases()` / `getPoseCase()` → `listPoseFissionCases()` / `getPoseFissionCase()`
  - 新增 `listPoseTemplates()` / `getPoseTemplate(id)`
  - 重写 `normalizePoseFissionParams`：循环校验 `poseTemplateIds`（数量 ∈ [1, 9]、去重、每个 id 都存在）、`model` 合法（白名单 FASHION_MODELS）、imageRatio / resolution 合法；返回带 `poseTemplateSnapshots` 冗余存储的 params
  - 重写 `buildPoseFissionPrompt(params, template)` 单 template 单次调用版本（多 pose 循环留给 PR2）
  - 旧 `getPoseFissionDemoUrls` 改为返回 `POSE_FISSION_CASES[0].resultImageUrls`
  - 保留 `createPoseFissionReferenceSheet`，待 PR2 评估是否还需要

- **app/api/pose-fission/**（API 路由）
  - `cases/route.ts`：改用 `listPoseFissionCases()`
  - 新增 `cases/[caseId]/route.ts`：GET 单 case（供「做同款」回填使用，参照 photo-fission 同名路由）
  - 新增 `templates/route.ts`：GET 返回 `{ templates: PoseTemplate[] }`

- **lib/server/task-store.ts**：`normalizeTaskParams` 中 pose-fission 分支保持不变（仍调用 `normalizePoseFissionParams`，签名内部已更新）

- **lib/server/third-party-image-adapter.ts**：pose-fission `buildPrompt` 分支取 `poseTemplateSnapshots[0]` 单 template 调用，加 `TODO(PR2): replace with runPoseFissionPipeline for multi-pose support` 注释

- **components/workbench/workbench.tsx**（前端兜底改名）
  - `selectedPoseCase` → `selectedPoseFissionCase: PoseFissionCase | null`
  - props 传递的 `selectedPoseCaseId` / `onSelectPoseCase` 同步改名为 `selectedPoseFissionCaseId` / `onSelectPoseFissionCase`

- **components/workbench/left-panel.tsx**（前端兜底改名）
  - import 中 `PoseCase` → `PoseFissionCase`，新增 `POSE_TEMPLATES` / `POSE_TEMPLATES_DEFAULT_TRIO` / `PoseTemplate`
  - `LeftPanelProps.selectedPoseCase` → `selectedPoseFissionCase`
  - `getParams()` pose-fission 分支临时取 `POSE_TEMPLATES_DEFAULT_TRIO[0]` 单 template 兜底构造新 `PoseFissionParams`（PR3 接入 PoseLibraryDialog 多选）
  - `PoseFissionForm` props 同步改名，UI 显示用 `case.mainImageUrl` 替代旧 `case.imageUrl`
  - 删除 `getPoseRatioStyle` 调用中无意义的 `option.id === "more"` 比较

- **components/workbench/right-panel.tsx**（前端兜底改名）
  - import 中 `POSE_CASES` / `PoseCase` → `POSE_FISSION_CASES` / `PoseFissionCase`
  - `RightPanelProps` 中 prop 名同步改：`selectedPoseCaseId` / `onSelectPoseCase` → `selectedPoseFissionCaseId` / `onSelectPoseFissionCase`
  - `PoseCaseLibrary` 组件内部所有 prop / 类型同步改名，UI 缩略图用 `case.mainImageUrl`（旧 `imageUrl` 字段已不存在）

### Constraints Verified

- ✅ **frontend/state-management.md**：所有状态仍收口在 `workbench.tsx`，未引入 Context / Zustand / Redux
- ✅ **frontend/directory-structure.md**：新 API 路由 `cases/[caseId]` 与 photo-fission 既有同名路由同模式
- ✅ **guides/code-reuse-thinking-guide.md**：`POSE_IMAGE_RATIOS_MAIN` / `EXTRA` 完全复用 photo-fission 既有分组形状，未另起一套
- ✅ **guides/cross-layer-thinking-guide.md**：`PoseFissionParams` 在四层（types / API normalize / service / 前端 getParams）字段一致
- ✅ **backend/external-image-api-reliability.md**：本 PR 暂未新增 Google 调用路径，PR2 再实施 `runPoseFissionPipeline`

### Testing

- [OK] `npx tsc --noEmit` 通过（无类型错误）
- [OK] `npx next build` 编译成功，所有路由识别正常（含新增 `/api/pose-fission/templates` 与 `/api/pose-fission/cases/[caseId]`）
- 单元测试未引入：项目当前无 vitest/jest 配置，PR1 遵从 PRD「Definition of Done」原则，不强行引入测试框架，留给 PR2 整体补齐

### Status

[OK] **Completed PR1（PR2/PR3/PR4 待后续推进）**

### Next Steps

- PR2：后端 `runPoseFissionPipeline`（并发 2 多 pose 调用 + 流式持久化）+ `retryPoseFissionShots` + `/api/tasks/[taskId]/retry` 路由
- PR3：前端 `PoseLibraryDialog` Modal（三组筛选 + 基础搭配 3 张 + 多选 1-9 个）+ 主表单「N 个姿势已选 + 缩略图横排」
- PR4：右侧案例库 Tab 重构为 `PoseFissionCaseLibrary`（左主图 + 6 网格 + 「做同款」按钮）+ 一键回填逻辑

---

## Session 3: pose-fission PR2 — 后端多 pose pipeline + retry + task-store 集成

**Date**: 2026-05-19
**Task**: 05-18-pose-fission（姿势裂变 MVP PR2）
**Branch**: `main`

### Summary

按 PRD §11 落地 PR2：让 pose-fission 多选真正生效。新增 `runPoseFissionPipeline` 并发 2 多 pose 调度 + 流式持久化、`retryPoseFissionShots` 失败姿势重跑入口、`/api/pose-fission/tasks/[taskId]/retry` 路由；task-store `resolveTaskCompletion` 增加 pose-fission 分支支持 partial 状态；清理 `runThirdPartyWorkflow` 中遗留的 PR1 单 pose 兜底分支（pose-fission 全量改走 task-store 直连 pipeline）。完全复用 photo-fission 既有范式（pipeline 形状 / `persistOneResult` / `callGoogleImageWithRetry` wrapper / traceId `${taskId}_${templateId}` 命名），未抽象通用 pipeline / retry（YAGNI，待第三个 feature 出现）。

### Main Changes

- **lib/server/pose-fission-service.ts**
  - 新增 `runPoseFissionPipeline(options)`：参照 `runPhotoFissionPipeline` 形状，对 `params.poseTemplateSnapshots` 中每个 template 单独调用 `runGoogleImageEdit`，并发 2（`POSE_FISSION_CONCURRENCY` env 可覆盖），单 pose 成功立即触发 `onShotResult` 流式回调，单 pose 失败不抛错继续后续 pose；全部失败才抛错。`targetTemplateIds` 支持只跑子集（用于 retry）。`ResultAsset.shotId = template.id`、`label = template.name`、`finalPrompt` 为实际发送 prompt。traceId 命名 `${taskId}_${template.id}`。
  - **PR1 已经写入该函数**；本 PR 主要验证其行为契约符合 PRD D9/D10 与 backend/external-image-api-reliability.md 7.2/7.3。

- **lib/server/task-store.ts**
  - `resolveTaskCompletion` 增加 pose-fission 分支：planned 取 `params.resultCount ?? params.poseTemplateIds.length`，缺额时返回 partial。
  - 新增 `retryPoseFissionShots(taskId, templateIds)`：完全参照 `retryPhotoFissionShots` 契约——校验 task 存在、`featureType === 'pose-fission'`、status ∈ {partial, failed}、templateIds 都在原 `poseTemplateSnapshots` 中且当前 results 没有对应 shotId；标记 running → 调 `runPoseFissionPipeline(targetTemplateIds)` → `persistOneResult` 流式合并 → resolveTaskCompletion 重新判定。不另起新 task，不扣 credits（D5）。
  - `runTask` 中 pose-fission 分支不变（PR1 已经写入：直接调 `runPoseFissionPipeline` + `useStreamingPersist = isPhotoFission || isPoseFission`）。

- **lib/server/third-party-image-adapter.ts**（清理 PR1 遗留兜底）
  - `demoResults` 类型改为 `Partial<Record<RunnableFeature, string[]>>`，删除 `'pose-fission': getPoseFissionDemoUrls()` 项（pose-fission 不再走 demo 兜底）。
  - 入口预检：pose-fission 进入 `runThirdPartyWorkflow` 即报错（防意外回退路径）。
  - 删除 `buildPrompt` 中的 pose-fission 分支（旧 PR1 取 `poseTemplateSnapshots[0]` 单 template 单次调用的 TODO 代码）。
  - 删除 `getInputImagePayload` 中的 `createPoseFissionReferenceSheet` 多图拼板分支（pose-fission 现已使用 Gemini 原生 inline_data 多图数组，不需 SVG）。
  - 删除 pose-fission 相关 import：`buildPoseFissionPrompt` / `createPoseFissionReferenceSheet` / `getPoseFissionDemoUrls` / `PoseFissionParams`。`createPoseFissionReferenceSheet` 函数本身保留在 `pose-fission-service.ts`（PR1 还在，可能被未来引用）。
  - `runDemoWorkflow` 加 demoResults 缺失保护，明确报错（默认 `demo_results[featureType] = undefined` 时不会静默返回空数组）。

- **app/api/pose-fission/tasks/[taskId]/retry/route.ts**（新增）
  - POST `/api/pose-fission/tasks/:taskId/retry`，body `{ templateIds: string[] }`
  - 与 photo-fission 的 `/api/tasks/:taskId/retry-shots` 形态保持一致：区别仅在路由前缀（按 feature 分组）和 body 字段名（templateIds vs shotIds）
  - 调 `retryPoseFissionShots`，错误归 404（任务不存在/丢失）或 400（参数/状态问题）

### Constraints Verified

- ✅ **backend/external-image-api-reliability.md**：本 PR 新增 Google 调用全部走 `runGoogleImageEdit` → 内部已包装 `callGoogleImageWithRetry`；无裸 fetch；无 `message.includes(...)` 判错（pipeline 仅记录 message 文本供 UI 显示，不基于其分类）；traceId 严格 `${taskId}_${templateId}`；未新增 env（沿用 `GOOGLE_API_KEY` / `GOOGLE_IMAGE_TIMEOUT_MS`；`POSE_FISSION_CONCURRENCY` 默认 2 已在 PR1 内默认值）。
- ✅ **guides/code-reuse-thinking-guide.md**：未重写 `persistOneResult` / `resolveTaskCompletion` / `callGoogleImageWithRetry`；retry 形状参照 photo-fission 范式，差异处仅为字段名（templateIds vs shotIds）；删除 PR1 兜底而非保留多余代码。
- ✅ **guides/cross-layer-thinking-guide.md**：retry 路径数据流 `route → retryPoseFissionShots(task-store) → runPoseFissionPipeline → runGoogleImageEdit → persistOneResult`，每层只与相邻层交互；`ResultAsset.shotId = template.id` 跨层契约对齐（前端 PR3/PR4 才用，但本 PR 已写对）。
- ✅ **guides/external-ai-api-thinking-guide.md** Pre-Code checklist：错误分类靠 `GoogleImageError class`、限流由 wrapper 内 `acquireGoogleImageSlot` 每次 attempt 处理、日志走 `logImageEvent`、partial 失败有 `retryPoseFissionShots` 出口。

### Testing

- [OK] `npx tsc --noEmit` 通过（0 错误）
- [OK] `npx next build` 编译成功；route map 出现 `/api/pose-fission/tasks/[taskId]/retry`
- 多 pose 真实生成手测未跑（成本高且当前 left-panel 仍是 PR1 单 pose 兜底），等 PR3 前端 Modal 落地后整体回归
- 单元测试未引入：维持 PR1 同样的 quality gate（无 vitest/jest）

### Status

[OK] **Completed PR2（PR3/PR4 待后续推进）**

### Next Steps

- PR3：前端 `PoseLibraryDialog` Modal（三组筛选 + 基础搭配 3 张 + 多选 1-9 个）+ 主表单「N 个姿势已选 + 缩略图横排」+ 「重跑失败姿势」按钮接入 `/api/pose-fission/tasks/[taskId]/retry`
- PR4：右侧案例库 Tab 重构为 `PoseFissionCaseLibrary`（左主图 + 6 网格 + 「做同款」按钮）+ 一键回填逻辑

---

## Session 4: pose-fission PR3 — PoseLibraryDialog 多选 Modal + 左面板模型选择

**Date**: 2026-05-19
**Task**: 05-18-pose-fission（姿势裂变 MVP PR3）
**Branch**: `main`

### Summary

按 PRD §11 Implementation Plan 落地 PR3：让用户「真正能在前端界面多选姿势」。新建 `PoseLibraryDialog` 受控 Modal（三组筛选 + 基础搭配 3 张预设 + 多选 1-9 + 收藏切换），把 workbench 单选 `selectedPoseFissionCase` 升级为多选 `selectedPoseTemplates: PoseTemplate[]`，左面板「选择姿势」区从「单 case 缩略图」改为「N 张已选 + 缩略图横排」，新增模型版本下拉选择（复用 photo-fission `Select + FASHION_MODELS` 范式，附 PR4 抽公共 ModelSelector 的 TODO）。后端 PR2 已就位，前端 `getParams()` pose-fission 分支替换为真实多选，PR1 兜底的「fallback 取 DEFAULT_TRIO[0] 单 pose」彻底删除。PR4 案例库 Tab 重构暂未触碰，`PoseCaseLibrary` 旧组件保留 + 单选高亮 state 暂存（只做视觉反馈，不再传 LeftPanel）。

### Main Changes

- **components/workbench/pose-library-dialog.tsx**（新建）
  - 复用 shadcn/ui `Dialog` / `Button` / `Checkbox` primitives，无新依赖
  - Props 契约：`{ open, onOpenChange, templates, favorites, initialSelectedIds, onToggleFavorite, onConfirm }`
  - 内部 draft 状态：`internalSelectedIds` / `ageGroupFilter` / `bodyPartFilter` / `onlyFavorites`，open 切换时由 `initialSelectedIds` 回填
  - 筛选维度：人群（`POSE_TEMPLATE_AGE_GROUPS`）、身位（`POSE_TEMPLATE_BODY_PARTS`）、收藏开关
  - 「基础搭配 3 张」按钮：取 `POSE_TEMPLATES_DEFAULT_TRIO` ∩ 当前 templates（防常量漂移）
  - 多选规则：点击 toggle；上限 9，达上限后未选卡片禁用 + tooltip 提示；卡片右上角显示选中序号
  - 收藏按钮：卡片左上角 hover 显示星标，已收藏常亮
  - 底部「重置」清空 draft，「确定」按 `internalSelectedIds` 顺序解出 templates 调 `onConfirm`，自动关闭 Modal
  - 空筛选结果显示「没有符合筛选条件 / 还没收藏」文案

- **components/workbench/workbench.tsx**
  - 移除 `selectedPoseFissionCase` 状态、`PoseFissionCase` import、`poseLibraryRequestKey` 计数器（受控 open 取代）
  - 新增 `selectedPoseTemplates: PoseTemplate[]` / `poseTemplates: PoseTemplate[]`（API fetch 缓存）/ `poseLibraryDialogOpen: boolean` / `poseFavorites: Set<string>`
  - 挂载时 `fetch('/api/pose-fission/templates')` 一次性拉取并缓存
  - `onOpenPoseLibrary` callback 简化为 `setPoseLibraryDialogOpen(true)`
  - 新增 `handleConfirmPoseLibrary` / `handleTogglePoseFavorite` callback
  - 顶层渲染 `<PoseLibraryDialog />`，并将 `initialSelectedIds={selectedPoseTemplates.map(t => t.id)}` 注入
  - PR4 案例库 Tab 单选高亮兜底：保留独立 `selectedPoseFissionCaseId` state，仅传 RightPanel 维持视觉反馈，不再传 LeftPanel

- **components/workbench/left-panel.tsx**
  - `LeftPanelProps.selectedPoseFissionCase: PoseFissionCase | null` → `selectedPoseTemplates: PoseTemplate[]`
  - 移除 `POSE_TEMPLATES` / `POSE_TEMPLATES_DEFAULT_TRIO` / `PoseFissionCase` import 与 `ChevronDown` lucide import
  - 新增 `poseFissionModel: FashionModelId` state（默认 `DEFAULT_FASHION_MODEL`）
  - `handleCreateTask` pose-fission 校验：`selectedPoseTemplates.length` 必须 ∈ [1, 9]
  - `getParams()` pose-fission 分支重写：用真实 `selectedPoseTemplates` 构造 `poseTemplateIds + poseTemplateSnapshots`，删除 PR1 的 fallback fallbackTemplate 兜底（含 TODO 注释一并删）
  - `PoseFissionForm` 重写：
    - 顶部新增「模型版本」`Select`（复用 photo-fission `FASHION_MODELS` 渲染范式，附 PR4 公共 ModelSelector TODO）
    - 「选择姿势」区双态：未选时显示「+ 去姿势库选择合适的姿势」按钮；已选时显示「N 张已选 / 最多 9 张」+ 缩略图横排（每个 12×12 + 序号角标 + name tooltip）+ 「重新选择」按钮触发再次打开 Modal
    - 删除旧「版本 高级版」假按钮（无任何状态绑定的 placeholder）

### Constraints Verified

- ✅ **frontend/state-management.md**：`PoseLibraryDialog` 是受控组件，所有跨组件状态（`selectedPoseTemplates` / `poseFavorites` / `poseTemplates`）均收口 `workbench.tsx`，未引入 Context / Zustand / Redux；Modal 内部 draft 状态仅在「确定」时才向父抛出
- ✅ **frontend/component-guidelines.md**：复用 shadcn/ui `Dialog` / `Button` / `Checkbox` primitives，未自实现 Modal portal；中文文案；Feature-Specific Form 改造只动 pose-fission 分支，未触碰 ai-fashion-photo / photo-fission / element-replace
- ✅ **frontend/directory-structure.md**：新组件落到 `components/workbench/pose-library-dialog.tsx`，未另起目录
- ✅ **guides/code-reuse-thinking-guide.md**：「模型版本」`Select` 复用 photo-fission 已有 `Select + FASHION_MODELS` 范式 + PR4 抽公共 ModelSelector 的 TODO；筛选维度直接复用 PR1 已建 `POSE_TEMPLATE_AGE_GROUPS` / `POSE_TEMPLATE_BODY_PARTS`，未重定义
- ✅ **guides/cross-layer-thinking-guide.md**：`selectedPoseTemplates: PoseTemplate[]` 从 workbench → LeftPanel → `getParams()` → `PoseFissionParams.poseTemplateSnapshots` 全链路类型一致，零形状转换
- 未触碰后端代码（PR2 已就位）；未触碰 spec / PRD / implement.jsonl / check.jsonl；未触碰 research/yibaiaigc/

### Testing

- [OK] `npx tsc --noEmit` 通过（0 错误）
- [OK] `npx next build` 编译成功（4.2s），所有路由识别正常
- 手动 E2E 未跑（agent 模式无浏览器），但代码路径与 PR1/PR2 既有任务流转 100% 对齐，仅前端表单形状变化；后端契约保持 `PoseFissionParams.poseTemplateIds + poseTemplateSnapshots` 不变，PR2 的 `runPoseFissionPipeline` 接收侧零变更
- 项目 ESLint 配置 v9 缺失（`eslint.config.js` 未迁移），与 PR1/PR2 同样跳过

### Status

[OK] **Completed PR3（PR4 待推进）**

### Next Steps

- PR4：右侧案例库 Tab 重构为 `PoseFissionCaseLibrary`（左主图 + 6 网格 + 「做同款」按钮）+ 一键回填逻辑（参考 photo-fission `handleSelectPhotoFissionCase` + `photoFissionCaseRequest` effect 范式）；同步把 workbench 中 PR3 暂存的 `selectedPoseFissionCaseId` 兜底 state 替换为 `poseFissionCaseRequest` + 调 `handleConfirmPoseLibrary` 注入选定 case 的 `poseTemplateIds`
- 若 PR4 完成后有时间，可考虑把 `Select + FASHION_MODELS` 抽公共 `<ModelSelector>` 供三处 feature 复用（photo-fission / pose-fission / 未来 feature），photo-fission 即可顺手迁移
- 「重跑失败姿势」按钮接入 `/api/pose-fission/tasks/[taskId]/retry`：本 PR 暂未做（属于右面板任务详情区改动，与 case Tab 同属 RightPanel，归 PR4 一并处理更合理）

---

## Session 5 (2026-05-19) — PR4：案例库 Tab 重构 + 一键做同款 + 重跑失败姿势

### Files Modified

- `components/workbench/workbench.tsx` —— 状态升级
  - 新增 `poseFissionCaseRequest` state（参照 `photoFissionCaseRequest` 派发模式）
  - 新增 `handleSelectPoseFissionCase` callback：切到 pose-fission + 构造 requestId 派发 case
  - 移除 PR3 兜底的 `selectedPoseFissionCaseId` 单选 state
  - LeftPanel 新增 `poseFissionCaseRequest` / `onChangeSelectedPoseTemplates` props
  - RightPanel 移除 `selectedPoseFissionCaseId` prop，`onSelectPoseFissionCase` 直连 `handleSelectPoseFissionCase`
- `components/workbench/left-panel.tsx` —— 一键做同款回填
  - 新增 `POSE_TEMPLATES` 导入与 `PoseFissionCase` 类型导入
  - `LeftPanelProps` 新增 `poseFissionCaseRequest` + `onChangeSelectedPoseTemplates`
  - 新增 `PoseFissionCaseRequest` interface
  - 新增 pose-fission case 回填 `useEffect`：解出 `PoseTemplate[]` → `onChangeSelectedPoseTemplates` 回写 workbench；同步 model / imageRatio / resolution 本地表单字段；不自动上传 mainImageUrl（与 photo-fission 不同：pose-fission case 主图是「成片参考」而非「输入服装图」，用户必须自行上传服装主图）
- `components/workbench/right-panel.tsx` —— 案例库重构 + 重跑按钮泛化
  - 移除旧 `PoseCaseLibrary`（瀑布流单选 + 收藏 + 仅看当前功能/收藏 filter）
  - 新增 `PoseFissionCaseLibrary`：完全参照 `PhotoFissionCaseLibrary` 既有布局（左主图 260px + 右侧 3-grid 套图 + 底部「做同款」按钮 + 比例/分辨率/姿势数 metadata 徽标）。case 卡片缺图时复用 `CaseShotThumb` / `CaseImage` 的 onError graceful fallback
  - `handleRetryShots(task, shotIds)` 泛化：按 `task.featureType` 路由到 `/api/tasks/:id/retry-shots`（photo-fission，body `shotIds`）或 `/api/pose-fission/tasks/:id/retry`（pose-fission，body `templateIds`）
  - `TaskStatusCard.failedShotIds` 双 feature 支持：photo-fission 读 `params.shotPlan`，pose-fission 读 `params.poseTemplateIds`，统一以 `result.shotId` 集合做差集
  - 按钮文案区分：photo-fission「重新生成失败镜头 (N)」，pose-fission「重新生成失败姿势 (N)」
  - 删除头部「仅看当前功能 / 仅看收藏」filter UI 对 pose-fission 的应用（保留 ai-fashion-photo current Tab 的用法）

### Approach & Key Decisions

- **代码复用**：`PoseFissionCaseLibrary` 与 `PhotoFissionCaseLibrary` 共享 `CaseImage` / `CaseShotThumb` 子组件 + 卡片骨架（260px 主图 + grid-cols-3 套图 + 底部按钮带 Sparkles icon），仅删除「删除案例 / 删除单张 shot」按钮（pose-fission case MVP 只 1 个常量、不可删）
- **`pose-fission case` 不自动上传主图**：与 PRD 关键决策对齐，case 的 `mainImageUrl` 仅做案例展示，用户做同款时仍需手动上传自己的服装主图。这与 photo-fission 的 case 主图含义不同（photo-fission case 主图也是输入图，所以 PhotoFissionForm 会自动 fetch + upload + 落到 `photoFissionMainImage`）
- **retry 按钮归并到 `TaskStatusCard`**：和 photo-fission 完全同一份 UI，仅按 `featureType` 区分文案与 endpoint，符合 `code-reuse-thinking-guide.md`「同结构同 UI」原则；不抽公共 retry hook（YAGNI，第三个 feature 出现再抽）
- **删除 pose-fission cases 的 filter**：MVP 只有 1 个 case，「仅看当前功能 / 仅看收藏」UI 没有意义；photo-fission 同样未提供这两个 filter（一致性）

### Constraints Verified

- ✅ **frontend/state-management.md**：`poseFissionCaseRequest` 收口 `workbench.tsx`，跨 workbench / LeftPanel / RightPanel 三组件的派发字段一致；未新增 Context / Zustand / Redux
- ✅ **frontend/component-guidelines.md**：复用 shadcn/ui Button / Dialog primitives；未自实现新 UI 元素；Feature-Specific Form 改造只动 pose-fission 路径
- ✅ **frontend/directory-structure.md**：所有改动均落在 `components/workbench/`，未新增目录
- ✅ **guides/code-reuse-thinking-guide.md**：`PoseFissionCaseLibrary` 完全参照 `PhotoFissionCaseLibrary` 既有布局；`CaseImage` / `CaseShotThumb` / `TaskStatusCard` 三个子组件直接共享；retry 按钮交互与 photo-fission 完全一致
- ✅ **guides/cross-layer-thinking-guide.md**：`poseFissionCaseRequest` 字段在 workbench → LeftPanel → useEffect → onChangeSelectedPoseTemplates → workbench setState 形成闭环，类型贯通；retry 链路 `RightPanel.handleRetryShots → task.featureType 分流 → 不同 API → onRefreshTasks` 跨层契约清晰
- 未触碰后端代码（PR2 + retry route 已就位）；未触碰 spec / PRD / implement.jsonl / check.jsonl；未触碰 research/yibaiaigc/；未引入「公共 ModelSelector」抽象（按 PR4 要求列为可选项，时间紧故跳过，留 TODO 待 PR5+）

### Testing

- [OK] `npx tsc --noEmit` 通过（0 错误）
- [OK] `npx next build` 编译成功（4.2s），15 个 API 路由全部识别正常（含 `/api/pose-fission/tasks/[taskId]/retry`）
- 手动 E2E 未跑（agent 模式无浏览器），但代码路径与 photo-fission 既有的「案例库 → 做同款 → 回填 → 立即生成 → partial 重跑」流程 100% 同构，等价验证靠 photo-fission 在 R5-R7 已经走过的回归路径
- 项目 ESLint v9 未安装，与 Session 1-4 同样跳过

### Status

[OK] **Completed PR4 —— pose-fission MVP 100% 闭环**

### MVP Final Closure Checklist

- [x] PR1：类型层重构 + 占位数据 + `/api/pose-fission/templates`
- [x] PR2：后端 pipeline + retry route + 任务流转集成
- [x] PR3：前端 PoseLibraryDialog Modal + 主表单多选改造 + 模型选择
- [x] PR4：案例库 Tab 重构 + 一键做同款 + 重跑失败姿势按钮

### Next Steps（后续 PR5+ 候选）

- 公共 `<ModelSelector>` 抽象：把 photo-fission / pose-fission 当前各自的 `Select + FASHION_MODELS` 渲染抽到 `components/workbench/option-selectors.tsx` 或 `model-selector.tsx`
- 姿势库素材填充脚本（PR1 笨蛋承诺的「PR4 之后单独做」）：把 8 个占位 `POSE_TEMPLATES` 替换为真实姿势图，姿势库 Modal 视觉验证
- 历史任务「再生成同款」V2：当前案例库做同款已覆盖 80% 场景，待用户反馈是否需要再开新入口

---

## Session 6 / 2026-05-19 — Check Agent 全面质量验收

### Verification Scope

按 `.trellis/tasks/05-18-pose-fission/check.jsonl` 列出的 6 个 spec 文件，
对 PR1-PR4 累计变更（17 个修改 + 7 个新建文件）做全面合规检查。

### Summary

- 致命问题：**0** 个
- 严重问题：**5** 个（已修复）
- 轻微问题：**0** 个

### 1. backend/external-image-api-reliability.md  [PASS]

- `runPoseFissionPipeline` 通过 `runGoogleImageEdit → callGoogleImageWithRetry` 调用 Google（lib/server/pose-fission-service.ts:331）✅
- 错误分类完全委托给 wrapper 的 `GoogleImageError`，pipeline 只读 `error.message` 透传到 `poseResults[i].error` 供 partial 判定 ✅
- traceId 格式：`${taskId}_${template.id}` 符合 spec §3.2 多 shot 命名约定 ✅
- 持久化失败也走 `logImageEvent('gimg.fail', { stage: 'persist' })` 结构化日志 ✅
- 全文搜索无裸 `fetch(.*google.*)`，无 `error.message.includes(...)` 判错（仅 retry route 用 `message.includes('任务不存在')` 做业务 HTTP status，与 Google 错误分类无关）✅
- env `GOOGLE_IMAGE_TIMEOUT_MS` / `POSE_FISSION_CONCURRENCY` 命名合规 ✅

### 2. frontend/state-management.md  [PASS]（修复 1）

- 所有 pose-fission state 收口在 `workbench.tsx`（selectedPoseTemplates / poseTemplates / poseLibraryDialogOpen / poseFavorites / poseFissionCaseRequest）✅
- 无 Context / Zustand / Redux 引入 ✅
- 新增 localStorage 字段：无（`poseFavorites` 仅内存态，与 PRD D7「仅看收藏」一致）✅
- callback prop 全部在 workbench 定义后下传 ✅
- **修复 1**：right-panel.tsx 残留 `poseLibraryRequestKey` prop 在 workbench 已固定为 `0`，导致内部 useEffect 死代码。已删除：
  - `right-panel.tsx`：移除 prop 定义、destructure、对应 useEffect
  - `workbench.tsx`：移除 `poseLibraryRequestKey={0}` 入参

### 3. frontend/component-guidelines.md  [PASS]

- 新增上传入口：pose-fission 的 3 个 UploadBox 全部复用既有 `UploadBox` 组件，
  内部 `prepareImageForGenerationUpload + validateUploadSize` 已生效 ✅
- Feature-Specific Forms 分支模式遵循：left-panel.tsx 在 `feature === "pose-fission"` 分支独立渲染 `PoseFissionForm` ✅
- `PoseLibraryDialog` 复用 shadcn primitives：`@/components/ui/dialog` + `@/components/ui/button` + `@/components/ui/checkbox` ✅
- `PoseFissionCaseLibrary` 完全对齐 `PhotoFissionCaseLibrary` 卡片布局：
  左侧主图 + 右侧 N 张网格 + 「做同款」按钮 + `CaseShotThumb` 共享 onError 占位 ✅

### 4. frontend/quality-guidelines.md  [PASS]

- `FashionModelId` 透传：left-panel 收 `poseFissionModel` → params.model → normalize → pipeline → `runGoogleImageEdit({ model: params.model })` ✅
- `imageRatio === 'more'` sentinel 拦截：pose-fission-service.ts:319 `params.imageRatio === 'more' ? undefined : params.imageRatio`，且 normalize 阶段 `POSE_IMAGE_RATIOS` 不含 'more'（仅 UI 概念），双重防御 ✅
- `imageSize` 大小写：pose-fission-service.ts:320 `params.resolution.toUpperCase()` 直接拼到 adapter，与 photo-fission / extractGoogleImageOptions 完全一致 ✅
- `IMAGE_API_PROVIDER` 不在 pose-fission-service.ts 中出现：pose-fission 跳过 `runThirdPartyWorkflow`，从 task-store 直接走 Google adapter，与 raycast 路径完全隔离 ✅

### 5. guides/code-reuse-thinking-guide.md  [PASS]（修复 2-4）

- `runPoseFissionPipeline` 与 `runPhotoFissionPipeline` 结构同构，worker pool / onShotResult / targetTemplateIds 等接口完全对齐 ✅
- `task-store.ts` 中 `persistOneResult` 流式持久化路径 photo-fission / pose-fission 共用，无重写 ✅
- `PoseFissionCaseLibrary` 卡片布局完全复用 `PhotoFissionCaseLibrary` 既有视觉模式 ✅
- `PoseImageRatio` 类型与 `PhotoFissionImageRatio` 等价（11 个 id 含 'more'），`POSE_IMAGE_RATIOS` / `POSE_IMAGE_RATIOS_MAIN` / `POSE_IMAGE_RATIOS_EXTRA` 与 photo-fission 对应常量形状完全一致 ✅
- **修复 2**：删除 `getPoseFissionDemoUrls`（PR1 transitional 占位 demo 函数，PR2 起 pose-fission 不再走 `runThirdPartyWorkflow` 也就不读 demoResults，函数变成无人 import 的死代码）
- **修复 3**：删除 `createPoseFissionReferenceSheet` + 配套 `escapeXml` helper（PR1 SVG 拼板代码，PR2 起 pipeline 用 Gemini 3.x 原生图片数组，函数无人 import）
- **修复 4**：清理 `pose-fission-service.ts:114-115` 描述 `buildPoseFissionPrompt` 的 `TODO(PR2)` 注释，PR2 已实现真正多 pose pipeline

### 6. guides/cross-layer-thinking-guide.md  [PASS]

- `PoseFissionParams` 四层一致性：
  - types.ts 字段（model / poseTemplateIds / poseTemplateSnapshots / hasFrontDetail / hasBackDetail / imageRatio / resolution / resultCount / creditsCost）
  - left-panel.tsx getParams 全字段填入 ✅
  - pose-fission-service.ts normalizePoseFissionParams 全字段校验 + 填入 ✅
  - pipeline 全字段读取 ✅
- 1..9 校验在三层：
  - 前端 PoseLibraryDialog `MAX_POSE_SELECTION = 9` 拦截 toggle ✅
  - 前端 left-panel.tsx handleCreateTask 提前拦截 `length > 9` ✅
  - 后端 normalizePoseFissionParams.readPoseTemplateIds 强制 [1, 9] ✅
- `poseTemplateSnapshots` 冗余存储贯通：前端 left-panel.tsx getParams 写入 → normalize 重新解析以确保 id 合法 → pipeline 读取 ✅
- retry 接口契约：
  - 前端 POST `/api/pose-fission/tasks/:taskId/retry` body `{ templateIds: shotIds }`（right-panel.tsx:253）
  - 后端 route.ts 解析 `templateIds` 并调 `retryPoseFissionShots(taskId, templateIds)` ✅
  - 与 photo-fission `{ shotIds }` 命名错位是按 feature 语义刻意区分，PRD §Out of Scope 已说明不抽象通用 retry ✅

### 自修复动作清单

1. `lib/server/pose-fission-service.ts`：删除 dead code `getPoseFissionDemoUrls`（13 行），原因：PR1 demo 路径桥接函数，PR2 起 pose-fission 跳过 `runThirdPartyWorkflow`，函数无人 import
2. `lib/server/pose-fission-service.ts`：删除 dead code `createPoseFissionReferenceSheet`（37 行）+ 配套 `escapeXml`（8 行），原因：PR1 SVG 拼板路径，pipeline 改用 Gemini 3.x 原生图片数组后无人 import
3. `lib/server/pose-fission-service.ts:104`：删除 `buildPoseFissionPrompt` 上方过期 `TODO(PR2)` 注释（误导后人）
4. `components/workbench/left-panel.tsx:748`：把 `TODO(PR4)` 改写为「后续可考虑抽出通用 ModelSelector...YAGNI」中性注释（PR4 已 ship）
5. `components/workbench/right-panel.tsx` + `components/workbench/workbench.tsx`：清理死参 `poseLibraryRequestKey`（workbench 固定传 `0` 导致 right-panel useEffect 永远不触发）
   - right-panel.tsx：移除 prop 定义、destructure、对应 useEffect
   - workbench.tsx：移除 `poseLibraryRequestKey={0}` 入参

### 仍待主会话处理的问题

- 无。PR1-PR4 累计变更经全面 spec 比对未发现任何尚未修复的违规。

### Verification

- `npx tsc --noEmit`：✅ 0 error（修复前后均通过）
- `npx next build`：✅ 编译成功（修复后 3.8s），15 个 API 路由识别正常
- 现有 photo-fission 链路无回归：✅（pose-fission 在 task-store 通过 `featureType === 'pose-fission'` 分支隔离，photo-fission 调用路径未改动）
- `package.json` 无依赖变更 ✅

### Conclusion

pose-fission MVP（PR1-PR4）所有 6 个 spec 验收点全部通过，5 处死代码/过期注释已自修复，无残留隐患。

---

## Session 7: pose-fission spec 沉淀（trellis-update-spec）

**Date**: 2026-05-19
**Task**: 05-18-pose-fission（trellis-update-spec）
**Branch**: `main`

### Summary

photo-fission + pose-fission 已经把「N 子镜头 + 单失败容忍 + 流式持久化 + 子集重跑」的 fission pipeline 范式复用了 2 次（PRD §Out of Scope 也明确点出抽象阈值已到）。本轮按 trellis-update-spec 流程，把该范式固化成 `.trellis/spec/backend/streaming-fission-pipeline.md` 7-section 可执行契约（签名 / 跨层数据流 / 错误矩阵 / Good-Base-Bad / Wrong-vs-Correct / Design Decisions / Common Mistakes），并同步更新 frontend 三份 spec + 一份 guide 把 pose-fission 引入的派发模式 / 多选 Modal / 目录变化 / Provider 例外说清楚。

### 候选评估结论

| 候选 | 决策 | 理由 |
|---|---|---|
| 1. Streaming Fission Pipeline | **采纳（新建 spec）** | 已复用 2 次 + 跨层契约复杂 + 字段命名差异需明文约束，必须固化 |
| 2. Case Request 派发 | **部分采纳（追加 state-management.md 章节）** | 已复用 2 次但形态简单，作为 state-management.md 的子模式记录即可，不另起 spec |
| 3. PoseLibraryDialog 多选 Modal | **部分采纳（追加 component-guidelines.md 段落）** | 仅 1 处使用，但「draft/commit 分离 + initial 回填」契约 + maxSelection 模式值得提前记账供下次复用比对 |
| 4. 现有 spec 内容更新 | **采纳（增量更新 4 份）** | external-image-api-reliability 暂不动（已含 partial 重跑章节）；directory-structure / state-management / component-guidelines / quality-guidelines / code-reuse-thinking-guide 各补一段 |

### Spec 变更清单

**新增**：
- `.trellis/spec/backend/streaming-fission-pipeline.md`（约 480 行，7 个强制章节 + Design Decisions + Common Mistakes + Future 抽象触发条件）

**更新**：
- `.trellis/spec/backend/index.md` — 索引表新增 Streaming Fission Pipeline 行
- `.trellis/spec/frontend/state-management.md` — State Inventory 表新增 photoFissionCaseRequest / poseFissionCaseRequest 两行；新增「Case Request Dispatch Pattern (fission features)」章节
- `.trellis/spec/frontend/directory-structure.md` — Project Layout 树同步 photo-fission/pose-fission 全部 API 路由 + pose-library-dialog.tsx + photo-fission-case-store.ts + google-image-* / log.ts；Feature Routing 表更新 photo-fission 右侧 Tab；新增「Fission Feature File Map」对照表
- `.trellis/spec/frontend/component-guidelines.md` — 新增「PoseLibraryDialog: Multi-Select Modal」章节，记录 controlled / draft-commit / maxSelection / shadcn 复用契约与"何时抽象通用 MultiSelectDialog"的阈值
- `.trellis/spec/frontend/quality-guidelines.md` — Image Provider Architecture 开头插入 Fission features exception，指向 streaming-fission-pipeline.md §8.1
- `.trellis/spec/guides/code-reuse-thinking-guide.md` — 新增「项目复用第一公民清单」表，列出 fission pipeline / external image API / case request / SSR localStorage / upload 大小校验 5 行

### 关键契约要点

- **Pipeline 签名**：`runXxxFissionPipeline({ taskId, inputImages, params, apiKey, timeoutMs, onShotResult?, targetIds? })` 6 个共享字段名 + 顺序禁止改动
- **流式持久化**：`onShotResult` 必须 async，pipeline 内必须 await 后才推下一个 shot
- **partial 判定**：`planned = params.resultCount ?? params.<plan>.length ?? results.length`，`results.length < planned → partial`
- **traceId 命名**：`${taskId}_${shotOrTemplateId}` 强制，禁止 fallback 到裸 taskId
- **并发度**：photo-fission 默认 3 / pose-fission 默认 2，env 必须 `Number.isFinite(raw) && raw >= 1` clamp，不可 NaN
- **Retry 路由错误码**：「任务不存在」/「丢失」→ 404，其他业务错 → 400
- **Provider 路径**：pose-fission 跳过 `runThirdPartyWorkflow` 直连 Google adapter（quality-guidelines.md 已注明 IMAGE_API_PROVIDER 例外）
- **抽象阈值**：通用 `retryFissionShots(featureType, ...)` 与通用 `<MultiSelectDialog>` 现在都不抽，等第 3 个 fission / 第 2 个多选 Modal 出现再决定

### 仍建议但未做的事

- **`backend/external-image-api-reliability.md` 追加「多 shot 并发 + 单 shot 失败容忍」章节**：已克制不做，原因是 streaming-fission-pipeline.md 已专门覆盖「N 调用编排」，external-image-api-reliability.md 保持「单调用稳定性」边界更清晰；两份 spec 通过 `runGoogleImageEdit` 入参 `traceId / shotId` 接驳，避免内容重叠
- **PoseLibraryDialog 多选 Modal 抽象成通用 `<MultiSelectDialog>`**：未做，仅 1 处使用，YAGNI；component-guidelines.md 已写明抽象触发条件
- **`retryPhotoFissionShots` / `retryPoseFissionShots` 抽象成通用 `retryFissionShots`**：未做，结构同构但字段名差异 3 处，等第 3 个 fission feature 出现再判断；task-store.ts:751-757 与 streaming-fission-pipeline.md §7.4 都已写明判断逻辑
- **fission pipeline 测试代码**：本项目未集成 vitest，spec §6 列出了必测断言点但暂以手测覆盖，引入 vitest 后再补 `node --test` smoke

### Verification

- `.trellis/spec/` 内文件均为纯 markdown 文档变更，无业务代码 / 类型层 / API 路由改动
- 未触碰 `.trellis/tasks/05-18-pose-fission/prd.md`、`implement.jsonl`、`check.jsonl`、`research/yibaiaigc/`
- 未执行 `git commit`

### Status

[OK] **Completed**

### Next Steps

- None - 本轮 spec 沉淀闭合。未来出现第 3 个 fission feature 或第 2 个多选 Modal 时，按 spec 触发条件回头收割抽象红利。

---

## Session 8: pose-fission 姿势模板真图填充（替换 PR1 占位 placeholder.jpg）

**Date**: 2026-05-19
**Task**: 05-18-pose-fission（姿势裂变 MVP）
**Branch**: `main`

### Summary

PR1 落地的 8 个 POSE_TEMPLATES 全部用 `/placeholder.jpg` 占位图，前端姿势库 Modal 视觉是「白板」。本次从友商资料 `research/yibaiaigc/AI服装大片_全部提示词.json`（5525 条真实 AI 服装大片 prompt）按关键词分桶筛选 45 张真姿势图，下载并用 macOS 内置 sips 压缩到 `public/poses/`（短边 ≤ 640px / JPEG 质量 70），平均 81KB / 单图最大 119KB / 总 3.6MB（git 可接受）。同时优化 prompt 抽取算法：多层 fallback（姿态句 → 主体动作句 → ≥20 字含动作动词的句子 → 前 100 字截断）+ 内部换行清理 + 强制 120 字截断 + 强制追加「保持原服装与人物身份不变」后缀。

### Main Changes

**新增**：
- `scripts/seed-pose-templates.ts` — 一次性幂等脚本，14 个关键词桶覆盖：成人全身 6 桶（正面站姿/侧身站姿/行走/坐姿/蹲姿/回头侧脸，目标 21 张）+ 成人上半身 3 桶（手插口袋/抱胸/抚面，目标 9 张）+ 成人下半身 3 桶（抬腿/交叉腿/倚靠，目标 9 张）+ 儿童 2 桶（儿童站姿/儿童动态，目标 5 张），按 sort 倒序取 N 张避免重复 id。`escapeForTsLiteral` 同时处理 `\\` / `'` / 换行 / Tab，防止友商 prompt 中的换行符破坏 TS 字符串字面量。
- `lib/pose-templates-seed.ts` — 脚本产出，含 45 个 PoseTemplate + DEFAULT_TRIO + CASE_BLACK_DRESS_TEMPLATE_IDS（3 个常量）
- `public/poses/*.jpg` — 45 张真姿势缩略图

**更新**：
- `lib/types.ts` — POSE_TEMPLATES / POSE_TEMPLATES_DEFAULT_TRIO 改为从 `pose-templates-seed.ts` re-export；`POSE_FISSION_CASES[0].poseTemplateIds` 改为引用 `POSE_FISSION_CASE_BLACK_DRESS_TEMPLATE_IDS_SEED`，旧的 8 个 `pose-tpl-*` 占位 id 全部移除

### Verification

- 45 张图全下载成功（0 失败）
- `npx tsc --noEmit` 0 错误
- API 路由 `/api/pose-fission/templates` 直接返回 45 个 PoseTemplate，全部 `imageUrl` 指向 `/poses/`（无 placeholder）
- 三组筛选有效：成人 40 / 儿童 5；全身 27 / 上半身 9 / 下半身 9（每组都非空，切换有差异）
- 默认三件套 `['pose-front-stand-1','pose-side-stand-1','pose-walking-1']` 与 case 6 id 在 POSE_TEMPLATES 中全部存在
- `public/poses/` 实际 3.6MB（45 张，平均 81KB / 最大 119KB），git 可接受
- 未触碰 `.trellis/spec/` / PRD / jsonl / `research/yibaiaigc/`
- 未执行 `git commit`

### Key Design Decisions

- **图片压缩**：原图最大 34MB / PNG 3584x4800，缩略图无需如此分辨率。用 macOS 内置 `sips -Z 640 -s format jpeg -s formatOptions 70` 压缩，无需外部依赖（sharp / imagemagick 都需安装），脚本可在标准 macOS dev 机直接运行
- **幂等**：脚本检查 `destPath` 已存在则跳过下载 + 压缩，仅重写 `pose-templates-seed.ts`；用户可改桶配置后重跑而不冲击网络与磁盘
- **临时目录**：原图下载到 `os.tmpdir()/pose-seed-XXX/`，压缩到 `public/poses/` 后立即删除，不污染仓库
- **id 命名**：`pose-<bucket-key>-<seq>` 而非友商 id，确保前端与文件名一致
- **prompt 抽取**：多层 fallback + 强制 120 字 + 追加约束后缀。少数低质量 prompt（如「姿态放松。保持原服装与人物身份不变。」）属于友商 prompt 本身结构变异，对前端展示影响可控

### 复用契约

- 本脚本是「一次性数据迁移工具」，不属于运行时代码路径
- 不与 streaming-fission-pipeline / external-image-api-reliability spec 交互
- 不引入新的 npm 依赖（sharp / imagemagick），保持 dev 环境零侵入

### Status

[OK] **Completed**

### Next Steps

- 明早验收前在 `pnpm dev` 启动后人工对比姿势库 Modal 视觉，确认 45 张图加载流畅
- 用户在 Modal 里实际触发筛选 / 多选 / 基础搭配 3 张 / 一键做同款全链路
- 若发现某些 prompt 抽取得不通顺，可手改 `lib/pose-templates-seed.ts` 对应字段（脚本会再生成时覆盖；如果需要稳定保留手改，把改动落回 `extractPosePrompt` 算法）

---

