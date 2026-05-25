# Photo-Fission Category Extension

> **一句话契约**：新增 `photo-fission` 品类时，只新增品类策略和少量路由接入；必须复用现有 LLM Planner、JSON schema 校验、worker pool、流式持久化和失败镜头重跑链路。禁止为某个品类复制一套文本 LLM fetch、生图 pipeline 或 retry 流程。

---

## 1. Scope / Trigger

**触发条件（任一即必读本 spec）**：

- 给服装大片裂变新增一级品类，例如成人/通用 `tops`（上衣）、`pants`（裤装）
- 给童装新增二级品类，例如 `childrens/suit`、`childrens/tops`
- 修改 `lib/types.ts:44` 的 `PhotoFissionCategory` 或 `lib/types.ts:45` 的 `PhotoFissionChildrensCategory`
- 修改 `lib/server/photo-fission-rule-engine.ts:54` 的 `buildPlannerRulePlan`
- 新增或修改 `lib/server/prompt-templates/*-planner-system.ts`
- 修改 `lib/server/photo-fission-service.ts:168` 的 `buildPhotoFissionShotPlan`

**边界**：

- 本 spec 管「新增 photo-fission 品类怎么接入」。
- 文本 LLM 调用底座归 [Fission Prompt Planner](./fission-prompt-planner.md)。
- N 张图并发、流式保存、partial、retry 归 [Streaming Fission Pipeline](./streaming-fission-pipeline.md)。
- 单次图像 provider 稳定性归 [External Image API Reliability](./external-image-api-reliability.md)。

---

## 2. Signatures

### 2.1 类型与前端选项

`lib/types.ts:44`

```ts
export type PhotoFissionCategory = 'childrens'
export type PhotoFissionChildrensCategory = 'dress' | 'suit'
export type PhotoFissionResultCount = 2 | 4 | 9 | 10

export const PHOTO_FISSION_CATEGORIES = [
  { id: 'childrens', label: '童装' },
] satisfies { id: PhotoFissionCategory; label: string }[]

export const PHOTO_FISSION_CHILDRENS_CATEGORIES = [
  { id: 'dress', label: '连衣裙' },
  { id: 'suit', label: '套装' },
] satisfies { id: PhotoFissionChildrensCategory; label: string }[]
```

新增一级成人品类时，`childrensCategory` 必须为 `undefined`；新增童装二级品类时，`category` 必须仍是 `childrens`。当前「套装」属于童装二级品类，必须使用 `category: 'childrens'` + `childrensCategory: 'suit'`，不要作为一级 `PhotoFissionCategory` 暴露。

### 2.2 品类策略文件

每个新增策略必须有独立文件，不要塞进童装连衣裙策略里：

```ts
// lib/server/prompt-templates/suit-planner-system.ts
export function buildSuitPlannerUserPrompt(
  resultCount: number,
  recentActionHints?: readonly string[],
): string
export function buildSuitPlannerSlots(resultCount: number): PlannerSlotMeta[]
export function buildSuitPlannerSystemPrompt(
  resultCount: number,
  recentActionHints?: readonly string[],
): string
export function getSuitShotBlueprintForCount(
  resultCount: PhotoFissionResultCount,
): ReadonlyArray<{ label: string; description: string; scene?: string }>
```

策略文件负责品类知识：商品主体、镜头角色、场景比例、动作禁区、负向约束、JSON 输出规则。

### 2.3 Rule Engine 路由

`lib/server/photo-fission-rule-engine.ts:54`

```ts
export function buildPlannerRulePlan(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
  resultCount: PhotoFissionResultCount = 9,
  recentActionHints?: readonly string[],
): PlannerRulePlan | undefined
```

新增品类只能在这里路由到策略文件，不能在 service 或 planner wrapper 里写大段品类 prompt。

### 2.4 Planner Wrapper

`lib/server/photo-fission-shot-planner.ts:38`

```ts
export interface InvokeShotPlannerInput {
  systemPrompt: string
  userPrompt: string
  shotCount: PhotoFissionResultCount
  traceId?: string
}
```

新增品类必须继续调用 `invokeShotPlanner`，由它复用 `invokeFissionPromptPlanner` 做 OpenAI 兼容请求、JSON 容错解析和 Zod schema 校验。

---

## 3. Contracts

### 3.1 新增品类的数据流

```
LeftPanel category selection
  ↓
POST /api/tasks params.category / params.childrensCategory / params.resultCount
  ↓
normalizePhotoFissionParams
  - 校验 category / childrensCategory / resultCount
  - buildPhotoFissionShotPlan 生成稳定 shotId + 初始 label + fallback prompt
  ↓
runPhotoFissionPipeline
  - applyShotPlannerOverride
    - buildPlannerRulePlan(category, childrensCategory, resultCount, recentActionHints?)
    - invokeShotPlanner({ systemPrompt, userPrompt, shotCount })
    - 按 shotId 写回 label + imagePrompt
  ↓
worker pool + provider router + streaming persist + retry
```

### 3.2 品类接入必须改的文件

| 层 | 文件 | 必做 |
|---|---|---|
| 类型 | `lib/types.ts:44` | 扩展 `PhotoFissionCategory` / `PhotoFissionChildrensCategory` |
| 前端 | `components/workbench/left-panel.tsx:449` | 多于 1 个品类时恢复品类 state 和下拉，不要硬编码只传 `childrens` |
| 策略 | `lib/server/prompt-templates/<category>-planner-system.ts` | 新增 system prompt / user prompt / slots / blueprint |
| 路由 | `lib/server/photo-fission-rule-engine.ts:54` | `category` 命中后返回 `PlannerRulePlan` |
| service | `lib/server/photo-fission-service.ts:80` | normalize 时读取新 category；`buildPhotoFissionShotPlan` 能拿到该品类 blueprint |
| service | `lib/server/photo-fission-service.ts:1068` | `applyShotPlannerOverride` 必须继续走 `buildPlannerRulePlan` + `invokeShotPlanner` |
| 案例 | `lib/types.ts:640` | 如新增案例，`category` 必须与新类型一致，案例图不要混成人/童装语义 |

### 3.3 resultCount 契约

新增品类必须支持 `PhotoFissionResultCount = 2 | 4 | 9 | 10`：

- `buildXxxPlannerSystemPrompt(resultCount)` 要显式写清输出数量
- `buildXxxPlannerSlots(resultCount)` 要生成 `shot_1` 到 `shot_N`
- `getXxxShotBlueprintForCount(resultCount)` 要返回 N 个 blueprint
- `invokeShotPlanner` 会用 Zod 校验 `shots.length === resultCount`
- `2 / 4 / 9 / 10` 都必须走 LLM Planner；不得为小数量绕过 LLM

### 3.4 Prompt 策略契约

每个品类 prompt 必须包含：

- 商品主体定义：例如套装必须保持上下装成套关系、色彩/材质/版型一致
- 镜头分布规则：主图候选、正侧背、局部、动态、必要外景或棚拍比例
- 动作禁区：不能遮挡主体卖点，不能把套装拆成单件随机搭配
- 可选跨次动作冷却：策略可以接收最近几次同品类生成的动作/表情族，用于降低短时间内重复姿势；冷却信息只能影响动作选择，不能改变人物、服装、背景或出图链路
- 输出 JSON：只输出 `{ "shots": [{ "shotId", "role", "imagePrompt" }] }`
- `imagePrompt` 必须是最终可直接传给出图模型的自然语言，不再依赖 service 拼接品类大段文案

---

## 4. Validation & Error Matrix

| 条件 | 失败行为 | 修复方式 |
|---|---|---|
| `params.category` 不在 `PHOTO_FISSION_CATEGORIES` | `服装大片裂变服装品类无效` | 同步 `PhotoFissionCategory` 和 `PHOTO_FISSION_CATEGORIES` |
| 成人一级品类仍传 `childrensCategory` | normalize 应忽略或拒绝，不能影响 strategy | 前端按 category 控制二级品类字段 |
| 新品类没有 `buildPlannerRulePlan` 分支 | `applyShotPlannerOverride` 抛「当前服装大片裂变仅支持...」 | 添加 rule-engine 分支 |
| `resultCount=2/4` 没有策略文本 | LLM 输出数量或场景规则错误 | system prompt 按 `resultCount` 动态生成 |
| Planner 返回 shots 数量不等于 resultCount | `ShotPlannerError(stage='schema')` | 修 prompt JSON 示例和 slots |
| Planner 返回未知 `shotId` | service 无法覆盖对应 shot，可能 `overridden === 0` | slots、blueprint、JSON 示例都用 `shot_1..shot_N` |
| 新品类复制 fetch / JSON parse | code review 必须拒绝 | 改用 `invokeShotPlanner` / `invokeFissionPromptPlanner` |
| 新品类复制 pipeline / retry | code review 必须拒绝 | 复用 `runPhotoFissionPipeline` 和 task-store retry |

---

## 5. Good / Base / Bad Cases

**Good**：新增童装二级 `suit` 套装品类。`lib/types.ts` 给 `PhotoFissionChildrensCategory` 加 `suit`；童装二级下拉显示「套装」；新增 `suit-planner-system.ts`；`buildPlannerRulePlan('childrens', 'suit', 4)` 返回 4-shot PlannerRulePlan；`invokeShotPlanner` 校验并返回 4 段 imagePrompt；后续 worker pool、provider failover、streaming persist、retry 不改。

**Base**：当前只保留 `childrens/dress`。未来新增品类时，若 prompt 还没准备好，可以先不把该品类放进 `PHOTO_FISSION_CATEGORIES`，避免用户入口先暴露。

**Bad**：新增童装套装时在 `photo-fission-service.ts` 里写 `if (category === 'childrens' && childrensCategory === 'suit') fetch(TEXT_LLM...)`，再自己 `JSON.parse`，或者给套装另写 `runSuitFissionPipeline`。这会绕过统一 schema、日志、并发、partial 和 retry，必须回滚。

---

## 6. Tests Required

新增任一 photo-fission 品类后至少验证：

- `npx --no-install tsc --noEmit`
- `git diff --check`
- `npm run lint`（若本地缺 eslint，记录阻塞原因）
- 手动或自动创建 `2 / 4 / 9 / 10` 四种 resultCount 的 normalize 输入，断言：
  - `shotPlan.length === resultCount`
  - `shotId` 连续为 `shot_1..shot_N`
  - `buildPlannerRulePlan(category, childrensCategory, resultCount)` 非空
  - `plan.userPrompt` 和 `plan.systemPrompt` 都包含正确数量
  - `invokeShotPlanner` 的 `shotCount` 等于 `params.resultCount`
- 前端验证：
  - 新品类出现在 photo-fission 表单中
  - 成人一级品类不显示童装二级品类下拉
  - 童装一级品类才显示童装二级品类下拉

---

## 7. Wrong vs Correct

### Wrong

```ts
// 错：新品类自己复制一套 LLM 调用，还绕过动态 schema。
if (category === 'childrens' && childrensCategory === 'suit') {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages }),
  })
  const json = JSON.parse(await response.text())
  return json.shots
}
```

### Correct

```ts
// 对：新品类只提供策略，调用链继续复用。
if (category === 'childrens' && childrensCategory === 'suit') {
  return {
    systemPrompt: buildSuitPlannerSystemPrompt(resultCount, recentActionHints),
    userPrompt: buildSuitPlannerUserPrompt(resultCount, recentActionHints),
    slots: buildSuitPlannerSlots(resultCount),
  }
}
```

```ts
const output = await invokeShotPlanner({
  systemPrompt: plan.systemPrompt,
  userPrompt: plan.userPrompt,
  shotCount: params.resultCount,
  traceId: taskId,
})
```

---

## 8. Implementation Checklist

新增 `childrens/suit` 这类童装二级品类时，按顺序做：

1. 在 `lib/types.ts` 加 `PhotoFissionChildrensCategory` union 和 `PHOTO_FISSION_CHILDRENS_CATEGORIES` 选项
2. 在 `components/workbench/left-panel.tsx` 确保请求体传 `category: 'childrens'` 和正确 `childrensCategory`
3. 新建 `lib/server/prompt-templates/suit-planner-system.ts`
4. 在策略文件里实现 `buildSuitPlannerSystemPrompt(resultCount, recentActionHints?)`、`buildSuitPlannerUserPrompt(resultCount, recentActionHints?)`、`buildSuitPlannerSlots(resultCount)`、`getSuitShotBlueprintForCount(resultCount)`
5. 在 `photo-fission-rule-engine.ts` 添加 `category === 'childrens' && childrensCategory === 'suit'` 分支
6. 在 `photo-fission-service.ts` 的 `buildPhotoFissionShotPlan` 接入童装套装 blueprint 和套装品类约束
7. 确认 `applyShotPlannerOverride` 没有任何按品类分叉的 LLM 调用代码
8. 跑第 6 节验证项

---

## 9. Design Decisions

### 品类知识放 strategy，链路能力放 planner/pipeline

**Context**：photo-fission 未来会继续增加套装、上衣、裤装、外套等品类。每个品类的 prompt 工程差异很大，但 LLM 调用、JSON schema、出图并发和 retry 完全同构。

**Decision**：新增品类只扩展 strategy 文件和 `buildPlannerRulePlan` 路由；不复制 `invokeFissionPromptPlanner`，不新增 pipeline。

**Why**：这样每个品类可以独立调 prompt，同时避免错误分类、timeout、JSON 容错、schema、流式保存和重跑逻辑漂移。
