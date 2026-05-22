# External Image API Reliability

> **一句话契约**：所有调用 Google Gemini Image API（以及未来接入的七牛云 / 其他中转商）的代码路径，**必须**经过统一 wrapper `callGoogleImageWithRetry`，**禁止**裸 fetch、**禁止**用 `message.includes(...)` 判错。

---

## 1. Scope / Trigger

**触发条件（任一即必读本 spec）**：

- 新增任何「调用 Google Gemini Image API」的代码路径
- 修改 `lib/server/google-genai-adapter.ts` / `google-image-retry.ts` / `google-image-throttle.ts` / `log.ts`
- 调任何 *返回图像* 的外部 SaaS API（哪怕不是 Google），都应该参照本契约抽象一份
- 调整重试策略、限流配额、错误分类、日志事件命名
- 修改任何以 `GOOGLE_IMAGE_*` 为前缀的环境变量

**为什么是 code-spec 不是 guide**：本契约包含 *具体签名*（`GoogleImageError` class）、*跨层契约*（adapter ⇄ wrapper ⇄ throttle ⇄ logger ⇄ env）、*错误矩阵*（10 个 category）、*Wrong-vs-Correct* 对照——全是可执行的硬约束。

---

## 2. Signatures

### 2.1 wrapper 主入口

`lib/server/google-image-retry.ts:251`

```ts
export async function callGoogleImageWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  context: LogContext,                            // { traceId, taskId, shotId? }
  acquireOptions: { apiKey: string; signal?: AbortSignal },
  options?: RetryOptions,
): Promise<T>
```

`fn` 应在内部完成「fetch + 解析 + 抛 `GoogleImageError`」三件事，非 `GoogleImageError` 异常会被 `classifyUnknownError` 兜底成 `network / unknown`。

### 2.2 结构化错误

`lib/server/google-image-retry.ts:16-73`

```ts
export type GoogleImageErrorCategory =
  | 'network' | 'rate_limit' | 'server_error'
  | 'safety_block' | 'image_safety' | 'prohibited'
  | 'empty_output' | 'bad_request' | 'auth_failed' | 'unknown'

export class GoogleImageError extends Error {
  category: GoogleImageErrorCategory
  retryable: boolean              // 由 category 决定默认值，可覆盖
  httpStatus?: number
  retryAfterSeconds?: number      // 从 Retry-After header 解析
  finishReason?: string           // candidates[0].finishReason
  blockReason?: string            // promptFeedback.blockReason
}
```

### 2.3 限流闸口

`lib/server/google-image-throttle.ts`

```ts
export interface AcquireOptions {
  apiKey: string
  signal?: AbortSignal
  onWait?: (waitMs: number, reason: 'ipm' | 'rpm') => void
  providerId?: string      // 多渠道时用于令牌桶与 auth 熔断隔离
  maxIpm?: number          // provider 级 IPM；不传回退 GOOGLE_IMAGE_IPM
  maxRpm?: number          // provider 级 RPM；不传回退 GOOGLE_IMAGE_RPM
}

export async function acquireGoogleImageSlot(opts: AcquireOptions): Promise<void>
```

### 2.3.1 多渠道 provider

`lib/server/image-provider-pool.ts`

```ts
export type ImageProviderType = 'google' | 'qiniu'

export interface ImageProvider {
  id: string
  type: ImageProviderType
  apiKey: string
  baseUrl?: string
  model?: string
  maxIpm: number
  maxRpm: number
  weight: number
  enabled: boolean
  timeoutMs: number
}

export function pickNextProvider(): ImageProvider | null
export function dispatchItems<T>(items: T[]): Map<string, { provider: ImageProvider; items: T[] }>
export function getFailoverProvider(excludeProviderIds: string[]): ImageProvider | null
export function getAvailableProvidersForModel(model?: string): ImageProvider[]
export function dispatchItemsForModel<T>(items: T[], model?: string): Map<string, { provider: ImageProvider; items: T[] }>
export function getFailoverProviderForModel(excludeProviderIds: string[], model?: string): ImageProvider | null
```

### 2.4 日志事件

`lib/server/log.ts`

```ts
export type ImageEvent =
  | 'gimg.attempt'   // 进入 fetch 前
  | 'gimg.success'   // 成功返回
  | 'gimg.fail'      // 最终失败
  | 'gimg.retry'     // 即将重试
  | 'gimg.throttle'  // 令牌桶 sleep

export interface LogContext {
  traceId: string
  taskId: string
  shotId?: string
  attempt?: number
}
```

### 2.5 失败镜头重跑 API

`app/api/tasks/[taskId]/retry-shots/route.ts`

```
POST /api/tasks/:taskId/retry-shots
Body: { shotIds: string[] }
Response 200: { task: GenerationTask }
Response 400/404: { error: string }
```

---

## 3. Contracts

### 3.1 调用链契约（cross-layer 数据流）

```
HTTP Route (app/api/**)
   ↓
task-store.runTask / retryPhotoFissionShots
   ↓
third-party-image-adapter.runGoogleProviderEdits / photo-fission-service.runPhotoFissionPipeline
   ↓
provider-image-router.runImageEditViaProvider
   ↓
google-genai-adapter.runGoogleImageEdit / qiniu-image-adapter.runQiniuImageEdit
   ↓
callGoogleImageWithRetry(fn=performSingleCall, context, { apiKey, providerId, maxIpm, maxRpm })
       ├─ 1. isAuthBlocked(providerId || apiKey) 检查（401/403 熔断快路径）
       ├─ 2. for attempt in attempts:
       │      ├─ acquireGoogleImageSlot(apiKey, providerId, maxIpm, maxRpm) ← 必在 fetch 之前
       │      ├─ logImageEvent('gimg.attempt', ctx)
       │      ├─ await fn(attempt) → fetch provider
       │      ├─ 解析 response 抛 GoogleImageError
       │      └─ 分类 → 决定 retryable / 等待 / 熔断
       └─ 3. 成功 → 返回 T；失败 → throw GoogleImageError
```

**绝对禁止**：
- 在 wrapper 之外直接 `fetch(googleEndpoint)`
- 新增 provider adapter 时绕开 `callGoogleImageWithRetry` 自己写 retry / throttle
- 在 wrapper 之外做 `acquireGoogleImageSlot`（必须由 wrapper 在每次 attempt 内调用）
- 在 wrapper 之外用 `console.log/warn` 打 provider 调用相关日志（必须走 `logImageEvent`）

### 3.2 traceId 命名

| 场景 | 格式 | 例 |
|---|---|---|
| 单图任务（ai-fashion-photo） | `${taskId}` | `task_1747523900123_abc` |
| 多 shot 任务（photo-fission） | `${taskId}_${shotId}` | `task_xx_shot_3` |
| 多次输出循环（count > 1） | `${taskId}_v${index}` | `task_xx_v2` |

**禁止**：临时拼 `${Date.now()}_${random}`、用纯 shotId、跨层重新命名。

### 3.3 环境变量（必须以 `GOOGLE_IMAGE_*` 前缀）

| key | 默认 | 含义 |
|---|---|---|
| `GOOGLE_IMAGE_MODEL` | `gemini-3.1-flash-image-preview` | 模型 ID |
| `GOOGLE_IMAGE_TIMEOUT_MS` | `600000` | 单次 fetch 超时（建议 ≥ 480000） |
| `GOOGLE_IMAGE_IPM` | `10` | 每分钟最多发起的 image 请求数 |
| `GOOGLE_IMAGE_RPM` | `150` | 每分钟最多发起的请求数 |
| `GOOGLE_IMAGE_RETRY_ATTEMPTS` | `4` | 含首次的总尝试上限 |
| `GOOGLE_IMAGE_RETRY_BASE_DELAY_MS` | `1000` | 指数退避基数 |
| `GOOGLE_IMAGE_RETRY_MAX_DELAY_MS` | `60000` | 退避上限 |

每次新增 env 必须 **同步更新 `.env.example` 并加中文注释说明 tier 推荐值**。

### 3.3.1 `IMAGE_PROVIDERS` 多渠道配置

`IMAGE_PROVIDERS` 是可选 JSON 数组；不配置时自动回退到 `GOOGLE_API_KEY` 单渠道。

```json
[
  {
    "id": "google-1",
    "type": "google",
    "apiKey": "AIza...",
    "model": "gemini-3.1-flash-image-preview",
    "maxIpm": 10,
    "maxRpm": 150,
    "weight": 1,
    "timeoutMs": 600000
  },
  {
    "id": "qiniu-1",
    "type": "qiniu",
    "apiKey": "your-qiniu-api-key",
    "baseUrl": "https://api.qnaigc.com",
    "model": "gemini-3.0-pro-image-preview",
    "maxIpm": 10,
    "maxRpm": 150,
    "weight": 1,
    "timeoutMs": 600000
  },
  {
    "id": "qiniu-gpt-1",
    "type": "qiniu",
    "apiKey": "your-qiniu-api-key",
    "baseUrl": "https://api.qnaigc.com",
    "model": "openai/gpt-image-2",
    "maxIpm": 10,
    "maxRpm": 150,
    "weight": 1,
    "timeoutMs": 600000
  }
]
```

约束：
- `provider.id` 必须稳定；日志、令牌桶、auth 熔断都依赖它
- `maxIpm/maxRpm` 是单 provider 配额；同一个真实 API key 不要伪装成多个 provider 抬高并发
- 新增 provider type 时只改 `provider-image-router.ts` + 对应 adapter，不要在 photo/pose pipeline 内写 switch
- 七牛 `type: "qiniu"` 当前只允许 `gemini-*` 与 `openai/gpt-image-*` 模型；其他模型即使文档支持，也不要接入本项目
- 前端任务级模型选择优先于 provider 默认模型；`runImageEditViaProvider` 必须把 `input.model` 传给 adapter，不能用 `provider.model` 覆盖用户选择
- 任何 fission / 单图多 provider 调度前必须按模型过滤 provider：`gpt-image-*` / `openai/gpt-image-*` 只能分发给 `qiniu`，不能落到 Google 官方 adapter
- 七牛文生图走 `/v1/images/generations`；只要 `inputImages.length > 0` 就走 `/v1/images/edits`
- 七牛 GPT 图像模型用 `size/quality`；七牛 Gemini 图像模型用 `image_config.aspect_ratio/image_size`

### 3.4 默认重试参数（PRD §15.3 验收基准）

```
attempts        = 4               # 1 原 + 3 重试
baseDelayMs     = 1000
maxDelayMs      = 60000
exponent        = 2               # → 1s, 2s, 4s, 8s（封顶 60s）
jitter          = 0.25            # ±25%

perCategoryMaxAttempts:
  image_safety   = 1   # 失败 1 次即放弃
  safety_block   = 1
  empty_output   = 3   # 1 原 + 2 重试（命中 js-genai issue #1406）
  rate_limit     = 2   # Retry-After 通常较久，重试意义有限
  unknown        = 1   # 不轻易反复重试
```

### 3.5 Retry-After 头部尊重（429 / 503）

`computeRateLimitDelay` 必须取 `max(Retry-After × 1000, 30000) × (1 ± 10% jitter)`。Retry-After 缺失或非法时 fallback 到指数退避。

### 3.6 401/403 provider/key 级熔断

任意一次响应触发 `category === 'auth_failed'` → `authFailureUntilByKey.set(providerId || apiKey, Date.now() + 30_000)`。同一 provider/key 在窗口内 fast-fail；其他 provider 不受影响。窗口过期自动解除，不需要重启进程。

`runImageEditViaProvider` 还必须调用 `tripProviderCircuit(provider.id)`，让 provider pool 在 30s 内不再把新 work item 分配给这个渠道。

---

## 4. Validation & Error Matrix

| 触发条件 | category | retryable | 默认上限 | UI 文案建议 |
|---|---|---|---|---|
| fetch throw / AbortError / `UND_ERR_` / `ECONNRESET` | `network` | ✅ | attempts | 网络不稳定，正在重试… |
| HTTP 429 或 `error.status=RESOURCE_EXHAUSTED` | `rate_limit` | ✅ | 2 | 上游限流，已自动等候并重试… |
| HTTP 500 / 502 / 503 / 504 | `server_error` | ✅ | attempts | Google 服务波动，正在重试… |
| `promptFeedback.blockReason = SAFETY / OTHER` | `safety_block` | ✅ | 1 | 上游审核未通过，请尝试更改描述 |
| `candidates[0].finishReason = IMAGE_SAFETY` | `image_safety` | ✅ | 1 | 同上 |
| `blockReason = PROHIBITED_CONTENT / RECITATION / BLOCKLIST` | `prohibited` | ❌ | — | 提示词触发上游禁止内容规则 |
| `finishReason = STOP` 但无 inlineData | `empty_output` | ✅ | 3 | 上游返回为空，正在重试… |
| HTTP 400 / `INVALID_ARGUMENT` | `bad_request` | ❌ | — | 请求参数有误（已附原因） |
| HTTP 401 / 403 | `auth_failed` | ❌ | — | API 凭证异常，请联系管理员 |
| 其他 | `unknown` | ✅ | 1 | 生成失败，请重试 |

### 4.1 输入预检（在进 wrapper 之前拦截）

| 条件 | HTTP | 文件位置 |
|---|---|---|
| 参考图 base64 解码字节 > 10 MB | **413** | `app/api/assets/upload/route.ts` |
| `finalPrompt` 字符 > 30 000 | **400** | `lib/server/ai-fashion-photo-service.ts:normalizeAiFashionPhotoParams` / `photo-fission-service.ts:normalizePhotoFissionParams` |
| 单次请求参考图数量 > 14 | **400** | normalize 阶段 |

---

## 5. Good / Base / Bad Cases

### Good（happy path）
```
photo-fission 9 张 / concurrency=3 / IPM=10
→ acquire 立即 grant 3 个 slot，3 张并发
→ 完成后 acquire 下一批，无 429
→ 每张：gimg.attempt → fetch 200 → gimg.success
→ task status = success
```

### Base（带 transient 抖动）
```
shot_3 第一次 fetch 抛 ECONNRESET
→ classifyUnknownError → network / retryable
→ gimg.retry (delayMs=1200) → sleep
→ acquire（IPM 剩 5）→ fetch 200 → gimg.success
→ 整任务最终 status = success（仅 shot_3 多花 ~1.2s）
```

### Bad（必须能优雅失败）
```
shot_5 连续 3 次 finishReason=STOP 但无 inlineData
→ wrapper 内 empty_output 计数到 3 触上限
→ throw GoogleImageError(category='empty_output')
→ photo-fission-service 把该 shot 标为 shotResults[i].error
→ task status = partial (8/9)
→ 前端展示「重新生成失败镜头 (1)」按钮，单独重跑 shot_5
```

---

## 6. Tests Required

> 当前项目还没集成 vitest。在引入之前，**最低线**是给纯函数加 `node --test` 风格的 smoke test。下列断言点即便不写代码也必须靠手测覆盖（PRD §15.13 接受标准 #4 / #5 / #6 / #10）。

### 6.1 单元（必加）

- `computeBackoffDelay(attempt, base, exp, max, jitter)`：
  - attempt=1, base=1000, exp=2, max=60000, jitter=0 → exactly 1000
  - attempt=10, base=1000, exp=2, max=60000, jitter=0 → exactly 60000（封顶）
  - jitter=0.25 → 结果落在 `[base*0.75, base*1.25]` 区间
- `parseRetryAfter('45')` → 45；`parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')` → 与当前时间 diff（≥0）；`parseRetryAfter(null)` → undefined
- `computeRateLimitDelay(10)` → ≥ 27000 ms（max(10s, 30s) ± 10%）
- `classifyUnknownError(new Error('fetch failed'))` → `category === 'network'`
- 401/403 熔断：同一 `providerId` 连续两次抛 `auth_failed`，第二次必须在 attempt=1 就 fast-fail（不进 fn）
- 多 provider auth 隔离：`provider-a` 抛 `auth_failed` 后，`provider-b` 仍可进入 fn，不被全局熔断误伤
- 七牛 adapter：HTTP 429 / 503 必须携带 `retryAfterSeconds=parseRetryAfter(header)` 进入 wrapper，触发 `gimg.retry`

### 6.2 集成 / 手测（无法跳过）

- **空 inlineData**：mock fetch 返回 `{ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }`，断言重试 2 次后 throw，日志看到 2 条 `gimg.retry, category: empty_output`
- **429 + Retry-After:45**：第二次 attempt 真实 sleep ≥ 45_000 ms，可通过 `Date.now()` 差值断言
- **IPM 限流**：构造 concurrency=10 + IPM=2，断言第 3 个请求 acquire 时 sleep ≥ 25_000 ms，日志看到 `gimg.throttle`
- **partial 重跑**：手测「重新生成失败镜头」按钮只跑 errored shot，且合并回原 task.results，不影响已成功 shot

---

## 7. Wrong vs Correct

### 7.1 错误识别

#### ❌ Wrong — 字符串匹配
```ts
if (
  message.includes('调用失败：429') ||
  message.includes('网络请求失败')
) {
  // retry
}
```
**为什么错**：任何一次 message 文案改写都会让重试静默失效；无法区分 429 vs 503；前端拿到一坨中文 message。

#### ✅ Correct — 结构化错误
```ts
try {
  return await runGoogleImageEdit(...)
} catch (error) {
  if (error instanceof GoogleImageError && error.category === 'rate_limit') {
    // wrapper 内部已经处理；外层只需关心是否最终 throw
  }
  throw error
}
```

---

### 7.2 限流闸口位置

#### ❌ Wrong — wrapper 外层 acquire
```ts
await acquireGoogleImageSlot({ apiKey })
return callGoogleImageWithRetry(fn, ctx, { apiKey })
```
**为什么错**：重试时不再 acquire，连续 attempt 仍会撞 IPM；attempt 1 acquire 后等待 30s 重试期间 slot 已经过期但没释放。

#### ✅ Correct — wrapper 内每次 attempt acquire
```ts
// 在 callGoogleImageWithRetry 内部：
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  await acquireGoogleImageSlot({ apiKey, providerId, maxIpm, maxRpm, signal })
  // ...fetch...
}
```

### 7.2.1 多渠道熔断隔离

#### ❌ Wrong — 一个 key 坏掉拖死所有渠道
```ts
let authFailureUntil: number | null = null
if (isAuthBlocked()) throw authFailed
```
**为什么错**：`qiniu-1` 或 `google-1` 凭证异常时会让所有其他 provider 也 fast-fail，高并发多渠道退化成单点故障。

#### ✅ Correct — provider/key 级熔断
```ts
const circuitKey = providerId || apiKey
authFailureUntilByKey.set(circuitKey, Date.now() + 30_000)
```

---

### 7.3 日志

#### ❌ Wrong — 散落的 console
```ts
console.log(`[google-api] task=${taskId} call#${i} status=${status}`)
console.warn(`[photo-fission] task=${taskId} shot=${shotId} 失败：${err.message}`)
```
**为什么错**：无法 grep 跨任务的同一错误类别；缺 traceId / attempt / category 字段；线上 JSON 日志聚合工具无法解析。

#### ✅ Correct — 结构化 JSON-line
```ts
logImageEvent('gimg.fail', { traceId, taskId, shotId, attempt }, {
  category: error.category,
  httpStatus: error.httpStatus,
  finishReason: error.finishReason,
  reason: error.message,
})
```

---

### 7.4 partial 失败的用户出口

#### ❌ Wrong — 让用户全量重跑
photo-fission partial 状态只提示「已生成 X/9 张」，没有重试入口 → 用户被迫从头跑 9 张，已成功的 X 张全部白做。

#### ✅ Correct — 提供 `targetShotIds` 过滤的二次入口
- `runPhotoFissionPipeline(opts: { targetShotIds?: string[] })` 必须支持过滤后再进 worker 池
- 提供 `POST /api/tasks/:taskId/retry-shots { shotIds }`
- 前端在 partial / failed-with-partial-results 显示「重新生成失败镜头 (N)」按钮

凡是「会有 N 个子任务且单个可独立成功」的 pipeline，都应该遵循这条契约。

---

### 7.5 第一阶段不引入 SDK

#### ❌ Wrong — 第一阶段就上 `@google/genai` SDK
理由听起来很合理（"官方维护，自动更新"），但 SDK v1.41 重试只暴露 `attempts` 字段：
- 没有 jitter 配置
- 不读 `Retry-After`
- 不能按 category 分类
- 错误体被包一层 `ApiError`，调试 IMAGE_SAFETY / 空 inlineData 更难

#### ✅ Correct — 第一阶段裸 fetch + 自实现 wrapper
精细化错误分类 + 限流 + 熔断 + 结构化日志，全是 SDK 给不了的。**第二阶段**接入七牛云或其他中转商时，再把 wrapper 抽象成 `ImageProviderAdapter` 接口，按 provider 路由，那时 SDK 也只是众多 provider 之一。

---

## 8. Design Decisions

### 8.1 为什么 `empty_output` 默认重试 2 次

社区 issue [googleapis/python-genai#1406](https://github.com/googleapis/python-genai/issues/1406) 表明 Gemini 2.5 / 3 系列在并发场景下 *偶发* 返回 `finishReason=STOP` 但 `parts` 中没有 inlineData。无重试时此 case 直接拉低成功率 5–10%。重试 2 次基本能消化。再多无收益。

### 8.2 为什么 `safety_block` / `image_safety` 仍然允许重试 1 次

部分 SAFETY 触发是 transient（同 prompt 同图重试就过），但 PROHIBITED_CONTENT / RECITATION 是永久性的——本契约用不同 category 区分：`safety_block` ≠ `prohibited`。

### 8.3 为什么熔断只 30s

401/403 几乎一定是 env 配置问题，但产品同事可能 5 秒内就在改 env、重启服务。30s 既能挡住雪崩，也能在配置修正后自然恢复。无须持久化。

### 8.4 为什么环境变量统一 `GOOGLE_IMAGE_*` 前缀

未来接入七牛云会有 `QINIU_IMAGE_*`、`ALIYUN_IMAGE_*` 等并列前缀；按 `<PROVIDER>_IMAGE_*` 区分能避免歧义，也方便 .env 文件分组。

---

## 9. Common Mistakes

### 9.1 Pipeline 调多 shot 时复用同一个 traceId
**症状**：线上 grep traceId 拉出 9 条日志，但无法区分哪条对应哪个 shot。
**修正**：photo-fission 必须 `${taskId}_${shotId}`，禁止退回 `${taskId}`。

### 9.2 把 `console.warn` 留下来当作"兜底日志"
**症状**：JSON-line 日志和散落 console 同时打，下游聚合系统看两遍重复内容。
**修正**：dev 模式可以让 `logImageEvent` 内部额外 `console.error` 一句人类可读，但 *业务代码不能直接 console*。

### 9.3 重试时不重新 acquire 限流 slot
**症状**：429 重试瞬间又 429。
**修正**：见 7.2，限流必须在 wrapper 内每次 attempt 进入 fetch 前。

### 9.4 新增 env 但忘了同步 `.env.example`
**症状**：新员工拉代码跑不起来，"明明代码里读了 `GOOGLE_IMAGE_NEW_THING`，怎么没人告诉我？"
**修正**：所有 `process.env.GOOGLE_IMAGE_*` 的读取都必须在 `.env.example` 有对应行 + 中文注释。

---

## 10. Future: Provider 抽象（第二阶段预告，本期不做）

接入七牛云 / 其他中转商时，把本契约抽象成：

```ts
interface ImageProviderAdapter {
  name: 'google' | 'qiniu' | 'aliyun' | ...
  generateImage(req: ImageGenRequest): Promise<ImageGenResult>
  // 内部各自实现错误分类映射到统一的 ImageProviderErrorCategory
}
```

`callGoogleImageWithRetry` 退化为 `callImageProviderWithRetry`，wrapper 通用、provider 各自实现 `fetch + 错误分类`。

**不要在第一阶段做**——过早抽象会让错误分类变成 lowest-common-denominator，丢掉 Google 特定的 `IMAGE_SAFETY` / `finishReason` 这些有价值信号。

---

## 11. 参考文档

- 本契约的调研基础：`.trellis/tasks/05-17-photo-fission/research/stability-*.md`
- 任务 PRD（v4 决议）：`.trellis/tasks/05-17-photo-fission/prd.md` §15
- 官方 Gemini 文档：https://ai.google.dev/gemini-api/docs/troubleshooting
- 官方 rate limits：https://ai.google.dev/gemini-api/docs/rate-limits
- SDK 重试源码：https://github.com/googleapis/js-genai/blob/main/src/_api_client.ts
