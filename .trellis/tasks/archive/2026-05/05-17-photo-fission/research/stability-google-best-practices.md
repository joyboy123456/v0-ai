# Google 生图稳定性 · 官方建议 & SDK 能力

> 一句话：Google 官方 `@google/genai` Node SDK 在 v1.41 (2026-02-09) 之后才加入官方重试支持，默认 `retries: 4`（共 5 次）针对 408/429/5xx，但 **必须 opt-in 才生效**；本项目目前用裸 fetch，没有任何重试，与官方推荐配置差距巨大。

## 1. SDK 重试能力

### 1.1 关键事实

- **SDK 仓库**：`googleapis/js-genai`，包名 `@google/genai`。
- **官方重试首次发布**：[v1.41.0 (2026-02-12)](https://github.com/googleapis/js-genai/releases/tag/v1.41.0)，commit [37d4f2e](https://github.com/googleapis/js-genai/commit/37d4f2e806793d71074eb0b763336b5c7132224b)。
- **底层**：使用 `p-retry`，配置基于 [Cloud Storage retry strategy](https://cloud.google.com/storage/docs/retry-strategy)。
- **默认参数**：
  - `DEFAULT_RETRY_ATTEMPTS = 5`（含首次调用，所以最多 4 次重试）
  - `DEFAULT_RETRY_HTTP_STATUS_CODES = [408, 429, 500, 502, 503, 504]`
  - 注意：**这些是 SDK 默认；只有把 `retryOptions: {}` 显式传入 `httpOptions` 才会启用，否则 SDK 也是单次调用 fast-fail**。

### 1.2 启用方式

```ts
import { GoogleGenAI } from '@google/genai'

const client = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
  httpOptions: {
    retryOptions: { attempts: 4 }, // 含首次共 4 次
    timeout: 600_000,
  },
})
```

引用源码（`src/_api_client.ts`）：
```ts
if (!this.clientOptions.httpOptions || !this.clientOptions.httpOptions.retryOptions) {
  return fetch(url, requestInit) // 不传 retryOptions = 没有重试
}
// ...
return pRetry(runFetch, {
  retries: (retryOptions.attempts ?? DEFAULT_RETRY_ATTEMPTS) - 1,
})
```

### 1.3 SDK 的几个限制（实施时要注意）

- **无 jitter 配置**：v1.41 只暴露 `attempts` 字段，p-retry 默认有指数退避但 SDK 没暴露 `factor / minTimeout / maxTimeout / randomize`，可调粒度小。
- **不读 Retry-After header**：SDK 内部只判断 status code，没有读 `Retry-After` 来确定 429 等待时长。
- **重试基于 `Retryable HTTP Error: ${response.statusText}` throw**：不会保留原 response body，调试上游错误细节略不便。
- **per-request `httpOptions.retryOptions` 不生效**：只能 client 级别设置（DeepWiki/Retry Logic 明确说明）。

## 2. 官方推荐的指数退避配置（Vertex AI 等价口径）

[Vertex AI · Retry strategy](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/retry-strategy)：

```
initial_delay = 1.0s
attempts      = 5
exp_base      = 2
max_delay     = 60s
jitter        = 1   (randomize multiplier)
http_status_codes = [408, 429, 500, 502, 503, 504]
```

退避序列示例（无 jitter）：1s → 2s → 4s → 8s → 16s，最长封顶 60s。

**官方反模式（必须避免）**：
1. 立即重试（无退避）→ 雪崩。
2. 重试 4xx 非 429/408 → 浪费配额、依然失败。
3. 无最大次数 → 客户端死循环。
4. 全部 client 同时重试 → thundering herd（必须 jitter）。

## 3. 错误码 / 错误形状（来自官方）

### 3.1 [Gemini API troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)

| HTTP | status | 含义 | 推荐处理 |
| --- | --- | --- | --- |
| 400 | INVALID_ARGUMENT | prompt/参考图格式错误 | 不重试，前端纠正 |
| 400 | FAILED_PRECONDITION | 区域 / 计费未配置 | 不重试，熔断 |
| 403 | PERMISSION_DENIED | API key / OAuth 失效 | 不重试，告警 |
| 404 | NOT_FOUND | 资源 / 模型 ID 错 | 不重试 |
| 429 | RESOURCE_EXHAUSTED | RPM/TPM/IPM/RPD 任一爆 | 退避 + 重试 |
| 500 | INTERNAL | 服务端异常 / 上下文过长 | 重试或缩短上下文 / 换模型 |
| 503 | UNAVAILABLE | 服务过载 | 重试或换模型 |
| 504 | DEADLINE_EXCEEDED | 服务端超时 | 设置更长 client timeout，重试 |

### 3.2 Block 类返回（不是 HTTP 错）

返回 200，但 `promptFeedback.blockReason` 有值：

| blockReason | 含义 |
| --- | --- |
| `SAFETY` | 命中安全类目 |
| `OTHER` | 命中 ToS / 其他规则（不一定是 safety；2.5 Flash 已知有此误判 - issue #740） |
| `PROHIBITED_CONTENT` | 禁止内容（不可恢复） |
| `RECITATION` | 触发版权 / 引用过滤 |
| `BLOCKLIST` | 命中黑名单 |

### 3.3 finishReason（在 candidates 上）

| finishReason | 含义 | 是否还有可用内容 |
| --- | --- | --- |
| `STOP` | 正常完成 | ✅ 应该有 image |
| `MAX_TOKENS` | 超过 token 上限 | ⚠️ 可能截断 |
| `SAFETY` | 候选被安全过滤 | ❌ |
| `IMAGE_SAFETY` | 图像被安全过滤 | ❌ |
| `RECITATION` | 引用过滤 | ❌ |
| `PROHIBITED_CONTENT` | 内容禁止 | ❌ |
| `BLOCKLIST` | 黑名单 | ❌ |
| `LANGUAGE` | 语言不支持 | ❌ |
| `MALFORMED_FUNCTION_CALL` | 工具调用问题 | ❌（图像场景应该不会出现） |
| `OTHER` / `FINISH_REASON_UNSPECIFIED` | 其他 | ❌ |

[官方已知 bug · python-genai issue #2024](https://github.com/googleapis/python-genai/issues/2024) 提到 IMAGE_SAFETY 在旧 SDK 触发 hang。Node SDK 未直接复现，但说明 IMAGE_SAFETY 是 Google 自己也在迭代的高频错误。

## 4. 限额（Rate Limits）

来源：[Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) + [Nano Banana Pro 429 troubleshooting](https://www.aifreeapi.com/en/posts/nano-banana-pro-429-error)。

| Tier | RPM | TPM (image preview) | RPD | **IPM** | 备注 |
| --- | --- | --- | --- | --- | --- |
| Free | 10 | 1M（3.1 Flash） / 2M（3 Pro） | 100 | **2** | 不能开通商用 |
| Tier 1（启用 billing） | 150 | 1M / 2M | 1000 | **10** | 即时生效 |
| Tier 2（累计 $250 + 30 天） | 1000 | 1M / 2M | 10000 | **50** | — |
| Tier 3（累计 $1000） | 2000+ | 协商 | 协商 | **100+** | — |

**关键洞察**：
- IPM 是 image 模型独有的维度，**比 RPM 更容易先打满**。本项目 9 张 + concurrency 3 + 用户连点 = 18 RPM、6 IPM，free + Tier 1 都会爆。
- 限额按项目计，不按 API key。
- 每日额度（RPD）按 PT 半夜重置；IPM/RPM 是滚动 60s 窗口。
- 2025-12 Google 把 Tier 1 RPD 从 1500 砍到 1000，把 free RPD 从 250 砍到 100，未来还会变。

## 5. 请求层最佳实践

### 5.1 [Nano Banana 2 / 3.1 Flash Image](https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation)（与官方对齐的字段）

- 最多 **14** 张参考图（推荐 10 ref + 4 character）。
- 单张参考图 ≤ **10MB**（项目目前未做尺寸检查，是潜在 400 来源）。
- 支持 jpeg/png/webp。
- aspectRatio / imageSize 在 `generationConfig.imageConfig` 下面（项目已经这样做了，正确）。
- `imageSize` 必须大写 K：`512` / `1K` / `2K` / `4K`（项目已强制 `.toUpperCase()`，正确）。

### 5.2 推荐做、本项目还没做的

| 项 | 推荐 | 项目当前 |
| --- | --- | --- |
| 参考图字节预检 | 在上传 / 提交时拦截 > 10MB / 非白名单 mime | ❌ |
| prompt 长度限制 | gemini 3.x 没有 hard 限，但官方建议 < 30k chars，参考图越多越要短 | ❌ 仅由 normalize 检查存在性 |
| 显式 generationConfig.responseModalities=['IMAGE','TEXT'] | 3.x 默认会，但显式更稳 | ❌ |
| safety_settings 显式放宽（业务前提下） | 把不需要的 HARM_CATEGORY_* 设为 BLOCK_ONLY_HIGH | ❌ |
| 一次只发一张 image，多张走多请求 | 已经在做（count loop） | ✅ |
| 请求级 timeout vs 客户端 timeout 一致 | 600s | ✅ |
| AbortController per attempt | 是 | ✅ |

## 6. 切到 SDK 还是继续裸 fetch？

| 维度 | 继续裸 fetch + 自实现重试 | 切 `@google/genai` v1.41+ |
| --- | --- | --- |
| 可控性 | 100%（jitter / Retry-After / 错误分类自定义） | 中等（仅 attempts 可调） |
| 与官方升级同步 | 需要自己 follow changelog | 自动跟进 |
| 包大小 | 不增 | `@google/genai` ~ 130KB minified |
| 错误体获取 | 直接拿原 JSON | SDK 包了一层 `ApiError`，但仍可访问原 status |
| 切换 Vertex AI / Files API | 自己实现 | SDK 已支持 |

**建议**：第一阶段继续裸 fetch，自实现 `withRetry`，原因：
1. 错误分类比 SDK 默认精细（IMAGE_SAFETY、空 inlineData 这些 SDK 不会重试）。
2. 我们要做 jitter / Retry-After / 熔断 / 指标埋点，SDK 都暴露不了。
3. 改动小，不引入新依赖。

后续接入七牛云中转商时可以再统一抽象。

## 7. 参考链接

- SDK Retry Logic：https://deepwiki.com/googleapis/js-genai/12.4-retry-logic
- HttpOptions interface：https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html
- Vertex AI retry strategy：https://docs.cloud.google.com/vertex-ai/generative-ai/docs/retry-strategy
- Gemini API troubleshooting：https://ai.google.dev/gemini-api/docs/troubleshooting
- Rate limits：https://ai.google.dev/gemini-api/docs/rate-limits
- Nano Banana Pro 429 deep dive：https://www.aifreeapi.com/en/posts/nano-banana-pro-429-error
- Issue #1406 空 inline_data：https://github.com/googleapis/python-genai/issues/1406
- Issue #2024 IMAGE_SAFETY hang：https://github.com/googleapis/python-genai/issues/2024
- Issue #321 Blocked image generation 应否 throw：https://github.com/googleapis/js-genai/issues/321
