# External AI API Thinking Guide

> **Purpose**: 在调任何外部 AI / 图像 / 大模型 API 前，先过一遍这个 checklist。30 秒思考省 3 小时 debug。

---

## When to Use

任一条命中即必读：

- [ ] 新增任何对外部 AI / 图像 / 大模型 API 的调用
- [ ] 修改现有外部 API 调用的重试 / 错误处理 / 限流逻辑
- [ ] 引入新的外部 provider / 中转商
- [ ] 接到「生图偶发失败 / 卡住 / 限流」类 bug

---

## Pre-Code Checklist

### 1. 这个调用是否经过了统一 wrapper？

- [ ] **是 Google 生图** → 必须走 `callGoogleImageWithRetry`（见 [backend/external-image-api-reliability.md](../backend/external-image-api-reliability.md)）
- [ ] **是其他 AI provider** → 第二阶段会有 `ImageProviderAdapter` 抽象；当下若必须先实现，至少要 *参照* 上面契约的 7 要素（错误分类 / 退避 / 限流 / 熔断 / 日志 / traceId / env 命名）

裸 `fetch(externalApi)` 是绝对禁止的。

### 2. 错误分类做了吗？

**Don't**：
```ts
if (message.includes('429')) { /* retry */ }
```
**Do**：
```ts
throw new GoogleImageError({ category: 'rate_limit', httpStatus: 429, ... })
```
理由：字符串匹配会因为任何文案改写而静默失效；前端无法按 category 显示不同 UI。

### 3. 限流和 Retry-After 想过了吗？

- [ ] 进 fetch 前是否过了令牌桶？
- [ ] 429 / 503 是否读了 `Retry-After` header？
- [ ] 退避是否带 jitter？（多客户端同时重试 = thundering herd）

### 4. 失败模式列全了吗？

外部 AI API 通常有 *至少* 10 类失败（参考 [external-image-api-reliability.md §4](../backend/external-image-api-reliability.md#4-validation--error-matrix)）。常被忽略的：

- ❗ `finishReason=STOP` 但没有 image part（"明明没报错却没图"）
- ❗ `IMAGE_SAFETY` vs `PROHIBITED_CONTENT`（前者偶发可重试，后者永久不重试）
- ❗ `auth_failed` 应该 *全局熔断* 而不是每次重试都重新撞墙

### 5. 日志能不能撑住线上排障？

- [ ] traceId 是否贯穿所有层（API → service → adapter → provider）？
- [ ] JSON-line 还是散落 `console.log`？
- [ ] category / httpStatus / finishReason / attempt / delayMs 五个关键字段有没有？

### 6. 用户视角的"失败"出口想过了吗？

- [ ] N 个子任务的 pipeline → 是否支持「只重跑失败的那几个」？
- [ ] 永久性失败 → UI 文案是否准确（不要"网络异常请重试"对应 PROHIBITED）？

### 7. env 命名遵守 provider 前缀了吗？

- ✅ `GOOGLE_IMAGE_*` / `QINIU_IMAGE_*` / `ALIYUN_IMAGE_*`
- ❌ `IMAGE_API_*` / `RETRY_TIMEOUT` / `MAX_QPS`

新 env 必须 *同时* 加到 `.env.example` 并写中文 tier 推荐值。

---

## After-Code Checklist

写完代码之后再过一遍：

- [ ] grep 全仓没有 `message.includes('429'|'500'|'超时'|'fetch failed')` 这种字符串匹配判错
- [ ] 所有 `fetch(externalApi)` 都被 wrapper 包了
- [ ] 所有 `console.log/warn` 都换成了 `logImageEvent`（或对应 logger）
- [ ] partial 失败有重跑入口
- [ ] `.env.example` 与代码读的 env 完全对齐

---

## See Also

- [Backend: External Image API Reliability](../backend/external-image-api-reliability.md) — 可执行契约
- [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) — 跨层数据流思考
- 项目内最完整的实施案例：`.trellis/tasks/05-17-photo-fission/prd.md` §15 + `research/stability-*.md`
