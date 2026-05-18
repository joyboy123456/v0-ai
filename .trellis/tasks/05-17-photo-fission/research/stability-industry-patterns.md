# Google 生图稳定性 · 行业容灾模式横向对比

> 一句话：Midjourney/Higgsfield/Photoroom 等头部 AI SaaS 在面对图像 API 不稳定时普遍采用「队列 + 指数退避 + jitter + idempotency + 错误分类 + 流式回调」组合拳；对我们最高 ROI 的三件套是 ①统一 retry wrapper、②错误分类（不重试也不要错杀）、③failed-shot 重试入口。

## 1. 模式横向对比

| 模式 | 代表实现 | 我们需要吗 | 优先级 |
| --- | --- | --- | --- |
| 1. **指数退避 + jitter** | 所有家都做 | ✅ 必需 | P0 |
| 2. **错误分类（transient / permanent / rate_limit）** | Musketeerstech AI 架构博客 / Midjourney 文档 | ✅ 必需 | P0 |
| 3. **Idempotency key** | 几乎所有 SaaS（防双扣 / 防双跑） | ⚠️ 中期 | P2 |
| 4. **作业队列 (Redis / SQS)** | Midjourney / LinkrAPI / Musketeerstech | ❌ 暂不需（单机够用） | P3 |
| 5. **Webhook callback 替代 polling** | TTAPI / midapi.ai 文档 | ❌ 单租户场景没必要 | P3 |
| 6. **Circuit Breaker** | systemdesignhandbook.com / Midjourney | ⚠️ 中期，建议先做 fast-fail | P2 |
| 7. **Graceful degradation（降画质 / 切备用模型）** | Midjourney（Draft mode） | ✅ 单条路径建议有 | P1 |
| 8. **Shadow / dual-write 备用模型** | 高级 | ❌ 第一阶段不上 | P3 |
| 9. **流式持久化（partial success）** | 我们 photo-fission 已经实现 ✅ | ✅ 已有 | done |
| 10. **失败子任务重新触发** | 头部 SaaS 都有 retry-failed-only 入口 | ✅ 强需求 | P1 |
| 11. **Dead-letter / 操作员可见队列** | Midjourney 内部 | ❌ 暂无 | P3 |
| 12. **请求级 traceId 贯穿日志** | OTel / Sentry / Datadog 标配 | ✅ 必需 | P1 |
| 13. **Rate-limit 协调（client-side throttle）** | LinkrAPI 显式限制 3 RPS | ✅ 必需（IPM 紧） | P1 |

## 2. 对我们最适用的三件套

### A. 统一 `withGoogleImageRetry` wrapper（P0）

来源：Vertex AI retry strategy + Musketeerstech 错误分类。

```
最大尝试: 4 次
基础退避: 1s
退避基: 2.0  ( → 1s, 2s, 4s, 8s )
最大退避: 60s
jitter:   ±25% （避免 thundering herd）
仅以下分类重试：network / rate_limit (Retry-After 优先) / server_error / empty_output / image_safety(<=1) / safety_block(<=1)
熔断分类：auth_failed → 后续 30s 内所有请求 fast-fail
```

落地：替换 `photo-fission-service.ts:517 runPhotoFissionShotWithRetry` 与 `google-genai-adapter.ts` 内的 generateContent 调用，让 ai-fashion-photo 和 photo-fission 共用同一个 wrapper。

### B. 失败镜头 / 失败结果的"重新生成"入口（P1）

来源：Midjourney action endpoint（continue from grid）、LinkrAPI batch retry 模式。

- photo-fission 当前 partial 状态只有"已生成 X/9 张"提示，**用户必须把 9 张全部重跑**，credits / 时间双浪费。
- 推荐方案：
  - 后端：新增 `POST /api/tasks/:taskId/retry-shots` 端点，body: `{ shotIds: string[] }`，复用 shotPlan 里的 prompt 与 inputImages，仅重跑指定 shot。
  - 前端：partial 状态卡片下方加「重新生成失败镜头」按钮，自动收集 `shotPlan` 中 errorMessage 非空的项。
- ai-fashion-photo 单图任务可以加「再生成一次」按钮（不耗费输入图重新上传）。

### C. 客户端 IPM-aware 节流（P1）

来源：LinkrAPI「max 3 RPS per hold account」、Midjourney「concurrency limit」。

- 当前 photo-fission concurrency 默认 3，加上用户连点，瞬时 IPM 容易超 6-10。
- 建议引入一个**进程级令牌桶**（per Google API key），默认 IPM=10 / RPM=150（Tier 1），由 env 配置。
- 9 个 shot 由 worker 池→令牌桶→Google，进入第 11 张的请求自动 sleep 到下个窗口，**不再触发 429**。
- 实现 < 50 行（一个 promise 队列 + 时间戳数组）。

## 3. 其他值得借鉴但暂缓的

- **Idempotency key**：Stripe / 头部 SaaS 都用 `Idempotency-Key` 头防双扣。Google API 不支持原生 idempotency key，但我们可以**前端按 (taskId, shotId, attempt) 生成 key**，后端在 `task-store` 里去重，防止用户连点触发重复 task（目前架构里前端按钮 disabled 即可缓解，所以 P2）。
- **Circuit breaker**：Netflix Hystrix 风格。在我们规模下，简化版"403 → 30s 内全局熔断"足够，不需要引入 opossum 这种库。
- **Webhook callback**：Google API 不支持 webhook，全是同步 long-polling-ish。这条不适用。

## 4. 来源

- Midjourney system design 综述：https://grokkingthesystemdesign.com/guides/midjourney-system-design/
- Midjourney 队列 + 退避：https://www.systemdesignhandbook.com/guides/how-midjourney-system-design/
- LinkrAPI batch / 并发：https://linkrapi.com/blog/automate-midjourney-image-generation
- 队列架构 + idempotency：https://musketeerstech.com/for-ai/queue-based-ai-generation-architecture/
- Webhook 设计参考：https://docs.midapi.ai/mj-api/generate-mj-image-callbacks

## 5. 一句话总结

> 我们没必要立刻上 Redis 队列 / Circuit Breaker / Webhook 那一套，但**统一 retry wrapper + IPM 令牌桶 + 失败重试入口**这三样是头部 SaaS 已经验证过的、对单机 Next.js 服务最划算的容灾组合。
