# 姿势裂变功能

## Goal

把当前预留的「姿势裂变」入口升级为与用户截图一致的可用工作流：左侧完整复刻截图中的姿势裂变参数面板，右侧完整复刻「历史记录 / 案例库」与筛选收藏展示，任务可通过现有异步链路跑通。

## What I Already Know

* 用户截图展示的目标界面包含左侧参数面板、右侧「历史记录 / 案例库」切换、案例图网格、仅看当前功能与仅看收藏筛选。
* 当前代码中 `pose-fission` 已存在于功能导航，但状态是 `coming-soon`。
* `components/workbench/left-panel.tsx` 对姿势裂变显示 `PoseComingSoon`，生成按钮被禁用。
* `lib/server/task-store.ts` 通过 `isRunnableFeature` 阻止 `pose-fission` 创建真实任务，并提示「姿势裂变暂未开放真实生成」。
* `lib/server/third-party-image-adapter.ts` 的可运行工作流排除了 `pose-fission`，当前只有 AI 服装大片、元素替换、服装大片裂变三类 prompt 与 demo 结果。
* 当前项目是 Next.js + React 19 + TypeScript，UI 已使用 shadcn/radix 风格组件、lucide 图标和 Tailwind 类。

## Assumptions

* MVP 复用现有异步任务、上传、轮询、结果展示和下载链路，不新增登录、额度支付或真实持久化数据库。
* 姿势裂变更偏「以现有成片为主图，保持服装/人物身份，生成指定姿势变化」，区别于「服装大片裂变」的自动多模特多构图。
* 截图中的案例库先用本地静态示例数据呈现，用于展示姿势裂变效果预期。

## Open Questions

* None. 用户已确认先完全复刻截图上的功能。

## Requirements

* 将 `pose-fission` 从即将上线改为可用功能。
* 左侧面板在姿势裂变下完整复刻截图布局：
  * 顶部标题为「姿势裂变」。
  * 「版本」下拉默认显示「高级版」。
  * 「主图」必填上传区，文案为「请上传需要姿势裂变的清晰主图」。
  * 「产品正面细节图（非必填）」上传区，文案提示上传领口、图案、logo、纹理等细节。
  * 「产品背面细节图（非必填）」上传区，文案提示上传背部细节和背面款型。
  * 「选择姿势」区域展示加号和「去姿势库选择合适的姿势」，用于和右侧案例库联动。
  * 「图片比例」提供 1:1、3:2、2:3、3:4、4:3、更多，其中 3:4 默认选中。
  * 「分辨率」提供 1k、2k、4k，其中 4k 默认选中。
  * 底部按钮为「立即生成」并显示额度 35。
* 姿势裂变的生成数量由截图复刻为固定 35 点额度，不在左侧展示生成数量选择器。
* 创建任务时提交姿势裂变专属 params，并按生成数量扣减 demo 额度。
* 服务端允许 `pose-fission` 任务进入现有异步生成链路。
* 姿势裂变后端模块提供案例库接口、参数规范化、素材数量校验、姿势案例校验、prompt 构建和参考图拼版。
* 第三方图片适配器为姿势裂变构建专属 prompt，强调保持人物身份、服装细节、主体比例和电商质感，同时改变姿势。
* demo 模式下返回姿势裂变示例结果，便于无外部 API 时验证完整链路。
* 右侧面板在姿势裂变下完整复刻截图中的展示方式：
  * 顶部有「历史记录 / 案例库」分段切换，默认进入案例库。
  * 顶部筛选包含「仅看当前功能」和「仅看收藏」复选框。
  * 案例库用横向网格展示 6 张左右姿势裂变案例卡片，每张卡片左上角显示「姿势裂变」标签。
  * 案例卡片可收藏，收藏状态只需前端会话内保持；勾选「仅看收藏」时只展示已收藏案例。
  * 历史记录展示现有任务历史，仍可选择任务查看生成结果。
* 从案例库选择姿势后，左侧「选择姿势」区域显示已选案例/姿势名称；未选择时生成按钮给出明确错误提示。

## Acceptance Criteria

* [ ] 点击「姿势裂变」后不再显示即将上线占位，而是显示与截图一致的可操作表单。
* [ ] 未上传主图时点击生成会给出明确错误。
* [ ] 未选择姿势时点击生成会给出明确错误。
* [ ] 选择姿势、比例和数量后可以创建 `pose-fission` 任务。
* [x] `/api/tasks` 能接受 `pose-fission`，任务可从 pending/running 更新到 success 或 failed。
* [x] `/api/pose-fission/cases` 返回后端姿势案例库。
* [x] 服务端会拒绝不存在的姿势案例。
* [x] 服务端会校验姿势裂变素材数量与正反细节图参数一致。
* [x] demo 模式下姿势裂变能展示对应数量的结果图。
* [x] 非 demo 模式下姿势裂变 prompt 包含所选姿势、比例、可选细节图说明和质量约束。
* [ ] 右侧案例库可在姿势裂变功能下展示截图式案例图并支持收藏筛选。
* [ ] lint/typecheck 通过。

## Definition of Done

* Tests added/updated where appropriate.
* Lint and TypeScript checks pass.
* UI 与现有工作台风格一致，移动/窄屏不出现明显文字溢出。
* 不提交与本任务无关的现有未提交改动。

## Out of Scope

* 不接入真实用户账号、额度结算、数据库持久化。
* 不实现复杂姿势骨架编辑。
* 不实现真实收藏持久化。
* 不实现案例库后台管理。

## Technical Approach

* 扩展 `lib/types.ts`：新增 `PoseFissionParams`、姿势案例数据结构、分辨率选项、`FEATURE_WORKFLOWS` 支持 `pose-fission`。
* 更新 `components/workbench/workbench.tsx`：管理姿势案例选择状态，使右侧案例库能联动左侧选择姿势区域。
* 更新 `components/workbench/left-panel.tsx`：替换 `PoseComingSoon`，构建截图式姿势裂变表单。
* 更新 `lib/server/task-store.ts`：移除姿势裂变禁用逻辑，让任务进入现有 `runTask`。
* 新增 `lib/server/pose-fission-service.ts`：集中管理姿势案例、参数规范化、prompt 和参考图拼版。
* 新增 `app/api/pose-fission/cases/route.ts`：提供姿势案例库接口。
* 更新 `lib/server/third-party-image-adapter.ts`：将 runnable feature 扩展到 `pose-fission`，复用姿势裂变服务模块产出的 demo 结果、prompt 和参考图拼版逻辑。
* 更新 `components/workbench/right-panel.tsx`：为 `pose-fission` 提供截图式「历史记录 / 案例库」视图、筛选和收藏。

## Decision (ADR-lite)

**Context**: 姿势裂变已有导航与模板占位，但真实生成链路被前后端同时禁用。  
**Decision**: MVP 完全复刻用户截图中的可见功能，并复用现有任务系统和图生图适配器添加姿势裂变所需参数、prompt、demo 数据和案例库 UI。  
**Consequences**: 体验贴近目标图，范围仍可控；真实姿势控制精度依赖第三方图像模型，后续如需更稳定可引入更强的姿势参考图或骨架控制。

## Technical Notes

* Relevant files inspected:
  * `components/workbench/workbench.tsx`
  * `components/workbench/left-panel.tsx`
  * `components/workbench/right-panel.tsx`
  * `lib/types.ts`
  * `lib/server/task-store.ts`
  * `lib/server/third-party-image-adapter.ts`
  * `package.json`
* `rg` is unavailable in the current WindowsApps environment due to permission denial, so PowerShell `Get-ChildItem` + `Select-String` was used for repository search.
