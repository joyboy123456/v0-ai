# 服装大片裂变 - 数量控制（童装连衣裙）

## Goal

在服装大片裂变的**童装连衣裙**路径中，新增出图数量选择器（2 / 4 / 10 张），让用户根据需求控制生成数量。默认 9 张不变（向后兼容）。

## Requirements

### 前端

* 新增出图数量类型 `PhotoFissionResultCount = 2 | 4 | 9 | 10`
* 新增常量 `PHOTO_FISSION_RESULT_COUNTS` 选项列表（参考 `GENERATE_COUNTS` 模式）
* 在童装连衣裙表单中添加数量选择器（`OptionSelector`），默认 9
* `resultCount` 参数传入 task 创建 API

### 后端

* `PhotoFissionParams.resultCount` 从字面量 `9` 改为 `PhotoFissionResultCount` 类型
* `normalizePhotoFissionParams` 接受并校验 `resultCount`（合法值 2/4/9/10，默认 9）
* `buildPhotoFissionShotPlan` 根据 `resultCount` 生成对应数量的 shot plan
* `invokeShotPlanner` 的 Zod schema 改为动态 `.min(2).max(10)` 而非 `.length(9)`
* Planner slots 动态生成 `shot_1` ~ `shot_N`

### 场景分布规则（用户确认）

| 数量 | 参考/棚拍 | 蓝天白云草地外景 |
|------|-----------|-----------------|
| 2    | 2 张（全用上传图背景） | 0 |
| 4    | 4 张（全用上传图背景） | 0 |
| 9    | 7 张 | 2 张（默认，不变） |
| 10   | 8 张 | 2 张 |

### LLM Planner 系统提示词适配

* `CHILDRENS_DRESS_PLANNER_SYSTEM_PROMPT` 中所有硬编码 "9" 的地方需要参数化
* 场景分布规则需要按 resultCount 动态调整（2/4 无外景，9 = 7+2，10 = 8+2）
* 微动作互斥铁律中 "9 段" 改为 "N 段"
* user prompt 模板中 "输出 9 段" 改为动态

## Decision (ADR-lite)

**Context**: 童装连衣裙走 v5 LLM Planner 路径，系统提示词、Zod schema、slot metadata 全部硬编码 9。
**Decision**: 将 9 改为动态参数 N（2/4/9/10），Planner prompt 按参数化模板动态拼装，scene 分布按上表规则注入。
**Consequences**: Planner 系统提示词需要从常量改为函数（按 resultCount 生成），增加维护复杂度；但实现逻辑清晰，每种数量场景明确。

## Acceptance Criteria

* [ ] 前端童装连衣裙表单显示数量选择器（2/4/9/10），默认 9
* [ ] 选择 2 张 → 生成 2 张，全部用上传图背景，无外景
* [ ] 选择 4 张 → 生成 4 张，全部用上传图背景，无外景
* [ ] 选择 9 张 → 行为与当前完全一致（向后兼容）
* [ ] 选择 10 张 → 生成 10 张（8 棚拍 + 2 外景）
* [ ] LLM Planner 对每种数量都能正确输出对应 shot 数
* [ ] 非童装品类不受影响（通用 blueprint 路径暂不改）

## Definition of Done

* Types 更新（`PhotoFissionResultCount` + 常量）
* 后端 normalize 校验 + shot plan 动态生成
* LLM Planner schema + prompt 参数化
* 前端 OptionSelector 接入
* 手动测试通过

## Out of Scope

* 用户自选具体 shot 内容（MVP 只做数量控制）
* 自定义任意数量（只支持 2/4/9/10）
* 非童装品类的数量控制（通用 blueprint 路径暂不改）
* 费用计算变更

## Technical Notes

### 关键文件

* `lib/types.ts` — PhotoFissionParams.resultCount 类型变更 + 新常量
* `lib/server/photo-fission-service.ts` — normalize 校验 + buildShotPlan 截取
* `lib/server/photo-fission-shot-planner.ts` — Zod schema 动态化
* `lib/server/photo-fission-rule-engine.ts` — slots 动态生成
* `lib/server/prompt-templates/childrens-dress-planner-system.ts` — prompt 参数化
* `components/workbench/left-panel.tsx` — 前端数量选择器

### 参考模式

* element-replace 的 `GENERATE_COUNTS` + `OptionSelector`（left-panel.tsx:675-681）
