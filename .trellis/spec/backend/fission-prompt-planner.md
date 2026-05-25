# Fission Prompt Planner

> **一句话契约**：所有 fission 类功能需要「文本 LLM 生成结构化 prompt 计划」时，必须复用 `lib/server/fission-prompt-planner.ts:54` 的 `invokeFissionPromptPlanner`。禁止在 photo-fission、pose-fission 或未来品类里复制 fetch、timeout、JSON 容错解析和 Zod schema 校验。

---

## 1. Scope / Trigger

**触发条件（任一即必读本 spec）**：

- 修改 `lib/server/fission-prompt-planner.ts`
- 修改 `lib/server/photo-fission-shot-planner.ts` 或新增其它 feature 的 Planner wrapper
- 给 photo-fission 新增成人上衣、裤装、半身裙、外套等品类策略
- 给 pose-fission 或未来 fission feature 接入文本 LLM prompt planning
- 调整 `TEXT_LLM_*` 环境变量、OpenAI 兼容响应解析、Planner fallback 行为

**边界**：

- 本 spec 管「文本 LLM 生成 prompt 计划」。
- 生图调用、provider failover、worker pool、partial/retry 仍归 [Streaming Fission Pipeline](./streaming-fission-pipeline.md) 和 [External Image API Reliability](./external-image-api-reliability.md)。
- 品类 prompt 工程归各 strategy 文件，例如 `lib/server/prompt-templates/childrens-dress-planner-system.ts`。

---

## 2. Signatures

### 2.1 通用 Planner 主入口

`lib/server/fission-prompt-planner.ts:20`

```ts
export type FissionPromptPlannerErrorStage =
  | 'config'
  | 'http'
  | 'parse'
  | 'schema'
  | 'timeout'

export interface InvokeFissionPromptPlannerInput<TOutput> {
  systemPrompt: string
  userPrompt: string
  outputSchema: z.ZodType<TOutput>
  traceId?: string
  feature?: string
  plannerName?: string
  temperature?: number
}

export async function invokeFissionPromptPlanner<TOutput>(
  input: InvokeFissionPromptPlannerInput<TOutput>,
): Promise<TOutput>
```

### 2.2 统一错误

`lib/server/fission-prompt-planner.ts:33`

```ts
export class FissionPromptPlannerError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly stage?: FissionPromptPlannerErrorStage,
  )
}
```

caller 必须捕获 `FissionPromptPlannerError` 并回退到当前 feature 的稳定链路。Planner 失败不能让 fission 任务整体失败。

### 2.3 photo-fission 兼容包装

`lib/server/photo-fission-shot-planner.ts:58`

```ts
export interface InvokeShotPlannerInput {
  systemPrompt: string
  userPrompt: string
  traceId?: string
}

export async function invokeShotPlanner(
  input: InvokeShotPlannerInput,
): Promise<PhotoFissionShotPlannerOutput>
```

`ShotPlannerError` 仅用于兼容既有 `photo-fission-service.ts` catch 逻辑。新 feature 应直接捕获 `FissionPromptPlannerError`。

---

## 3. Contracts

### 3.1 数据流

```
Feature Strategy
  - systemPrompt
  - userPrompt
  - outputSchema
  - fallback policy
      ↓
invokeFissionPromptPlanner<TOutput>
  - resolve TEXT_LLM_* env
  - POST /v1/chat/completions
  - extract assistant message content
  - parse loose JSON
  - safeParse(outputSchema)
      ↓
Feature Wrapper / Service
  - success: write prompt cards back into feature pipeline
  - failure: catch FissionPromptPlannerError and use fallback prompts
```

### 3.2 环境变量

| key | 默认 | 含义 |
|---|---|---|
| `TEXT_LLM_BASE_URL` | `https://elysiver.h-e.top` | OpenAI 兼容文本 LLM base URL，不带 `/v1/chat/completions` |
| `TEXT_LLM_API_KEY` | 空 | 推荐显式配置的文本 LLM key |
| `TEXT_LLM_MODEL` | `qwen3.6-plus` | 文本 LLM 模型 |
| `TEXT_LLM_TIMEOUT_MS` | `60000` | 单次 Planner 调用超时 |

`TEXT_LLM_API_KEY` 为空时，底座可历史兼容读取 `IMAGE_PROVIDERS` JSON 中第一个 `type: "qiniu"` provider 的 `apiKey`。生产环境推荐显式配置 `TEXT_LLM_API_KEY`，避免图像 provider 配置变化影响文本 Planner。

新增或改动 env 时必须同步 `.env.example`。

### 3.3 OpenAI 兼容请求

请求必须是单轮 chat completion：

```ts
{
  model,
  messages: [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ],
  stream: false,
  temperature: input.temperature ?? 0.85,
}
```

禁止在通用底座里读取图片、上传文件、调用工具或执行多轮 agent 循环。Planner 是「一次文本推理」，不是 agent。

### 3.4 JSON 解析

`parseJsonLoose` 必须兼容三类常见输出：

- 直接 JSON：`{"shots":[...]}`
- fenced JSON：```json ... ```
- 前后带解释但中间有最外层 `{...}`

解析后的对象必须交给 caller 传入的 `outputSchema.safeParse`。通用底座不写死 photo-fission 的 9 张数量，也不理解童装、成人装或姿势模板。

### 3.5 Feature fallback

每个 feature wrapper / service 必须定义失败 fallback：

- photo-fission：`lib/server/photo-fission-service.ts:1106` 的 `applyShotPlannerOverride` 捕获错误后保留预构建 fallback `shotPlan`
- pose-fission：未来接入时必须保留原姿势模板 prompt，不允许 Planner 失败导致整个姿势裂变任务失败

---

## 4. Validation & Error Matrix

| 条件 | stage | caller 行为 |
|---|---|---|
| `TEXT_LLM_API_KEY` 为空且无法从 `IMAGE_PROVIDERS` 取到 qiniu key | `config` | 记录 warn，使用 feature fallback |
| fetch 抛网络错误 | `http` | 记录 warn，使用 feature fallback |
| AbortController 超时 | `timeout` | 记录 warn，使用 feature fallback |
| HTTP 非 2xx | `http` | 记录 status/body 摘要，使用 feature fallback |
| response body 不是 JSON | `parse` | 使用 feature fallback |
| assistant message content 缺失 | `parse` | 使用 feature fallback |
| assistant content 无法解析为 JSON | `parse` | 使用 feature fallback |
| Zod schema 校验失败 | `schema` | 使用 feature fallback |

---

## 5. Good / Base / Bad Cases

**Good**：childrens-dress strategy 输出 9 张卡，包含 7 张参考/棚拍基调 + 2 张蓝天白云草地外景，Zod 校验通过，photo-fission service 按 `shotId` 写回 `label` 和 `prompt`。

**Base**：Planner 未配置 key 或 LLM 偶发失败，service 打 `planner.fallback` warn，继续使用 fallback 蓝图生成 9 张图。

**Bad**：新 pose-fission wrapper 自己复制一份 `fetch('/v1/chat/completions')`、自己切 JSON、自己定 timeout。这样错误分类、env、fallback 会漂移，必须改成调用 `invokeFissionPromptPlanner`。

---

## 6. Tests Required

修改本底座或新增 wrapper 后至少验证：

- `npx --no-install tsc --noEmit`
- `git diff --check`
- `npm run lint`（若项目缺 eslint 依赖，记录阻塞原因）

建议的单元断言点（后续补测试时）：

- direct JSON / fenced JSON / 外层解释文本都能解析
- schema 不匹配抛 `FissionPromptPlannerError` 且 `stage === 'schema'`
- AbortError 抛 `stage === 'timeout'`
- 401/403/500 等非 2xx 抛 `stage === 'http'`
- `TEXT_LLM_API_KEY` 为空时能从 qiniu provider apiKey 兼容取 key

---

## 7. Wrong vs Correct

### Wrong

```ts
// pose-fission 新增 Planner 时禁止这样复制一套。
const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages }),
})
const json = JSON.parse(await response.text())
```

### Correct

```ts
const output = await invokeFissionPromptPlanner({
  systemPrompt,
  userPrompt,
  outputSchema: PoseFissionPlannerOutputSchema,
  traceId: taskId,
  feature: 'pose-fission',
  plannerName: 'pose-fission-prompt-planner',
})
```

---

## 8. Design Decisions

### 通用调用层不懂品类

`fission-prompt-planner.ts` 只处理文本 LLM 调用和结构化输出校验，不包含「童装连衣裙」「淘宝货架感」「9 张图」「姿势模板」等业务知识。业务知识只放在 strategy prompt 与 feature wrapper schema 中。

### Planner 失败不是任务失败

Planner 是提升成功率和多样性的增益层，不是 fission pipeline 的唯一数据源。任何 `FissionPromptPlannerError` 都应被 caller 降级处理，保证用户仍能拿到 fallback 生成结果。
