# Google 生图稳定性 · Failure Mode 清单与现有覆盖度

> 一句话：Gemini 图像 API 至少 12 类失败，本项目目前只对其中 5 类做了有效处理，且大多通过中文字符串匹配识别；IMAGE_SAFETY / 空 inline_data / 502 / 504 / 网络 reset 都没有显式分类。

## 1. 失败模式矩阵

| # | 失败模式 | 触发条件 | Google 返回长什么样 | 是否可重试 | 本项目当前覆盖 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | 网络超时 | 网络抖动 / 上行参考图大 / 模型 thinking 长 | `AbortError`（client 主动断） | ✅ 是（一次重试有效率高） | 部分：photo-fission 重试 1 次；ai-fashion-photo 不重试 | 无指数退避，无 jitter |
| F2 | TCP/TLS 错误 | DNS 失败、连接 reset、`UND_ERR_*`、`ECONNRESET` | fetch throw `TypeError: fetch failed` 带 cause | ✅ 是 | 部分：photo-fission 通过 `und_err` / `fetch failed` 字符串匹配重试 | 字符串匹配脆弱；ai-fashion-photo 不重试 |
| F3 | HTTP 429 RESOURCE_EXHAUSTED | 触碰 RPM / IPM / RPD / TPM 任一限额 | `{ "error": { "code": 429, "status": "RESOURCE_EXHAUSTED" } }` | ✅ 是，但需更长退避 | 部分：photo-fission 匹配 `调用失败：429` 重试，1.5s 后立刻再试 | 1.5s 太短（IPM rolling 60s），未读 `Retry-After` header |
| F4 | HTTP 500 INTERNAL | Google 侧偶发 | `{ "error": { "code": 500, "status": "INTERNAL" } }` | ✅ 是 | 部分：photo-fission 匹配 | 无指数退避 |
| F5 | HTTP 502 / 504 网关 | 上游代理 / 区域路由抖动 | 同上 | ✅ 是 | 部分：photo-fission 匹配 502/504 | 同上 |
| F6 | HTTP 503 UNAVAILABLE | 模型过载（preview 模型常见） | `{ "error": { "code": 503, "status": "UNAVAILABLE" } }` | ✅ 是 | 部分：photo-fission 匹配 503 | 无；建议降级到备份模型 |
| F7 | HTTP 400 INVALID_ARGUMENT | prompt 过长 / 参考图 mime 不对 / 参考图字节超 10MB | `{ "error": { "code": 400 } }` | ❌ 否 | ❌ ai-fashion-photo / photo-fission 都会立即 throw（正确） | 缺一致的错误码归类 |
| F8 | HTTP 403 PERMISSION_DENIED | API key 过期 / 区域不允许 / billing 关闭 | `{ "error": { "code": 403 } }` | ❌ 否 | ❌ 没有专门处理，吞进通用失败 | 应该熔断，所有后续请求 fast-fail |
| F9 | promptFeedback.blockReason = SAFETY / PROHIBITED_CONTENT / RECITATION | prompt 被前置审核拒 | `{ "promptFeedback": { "blockReason": "SAFETY" } }` | ⚠️ 部分（SAFETY 偶尔 transient，PROHIBITED/RECITATION 永久） | 一刀切 throw 不重试 | 应允许「最多 1 次自动重试 + 可选 prompt 改写」 |
| F10 | candidates[0].finishReason = IMAGE_SAFETY | 输入图 + prompt 撞 image safety（图片侧审核） | `candidates[0]` 存在，但 `finishReason: "IMAGE_SAFETY"`，无 inlineData | ⚠️ 部分 | 一刀切 throw 不重试 | 同上；尤其参考图换一张就能过的高频场景 |
| F11 | finishReason = STOP 但 parts 没有 image | 模型 thinking 抖动 / 偶发空响应（已知 issue #1406） | candidates 存在，parts 里只有 thought / text | ✅ 是 | ❌ 直接 throw `Google Gemini 未返回图片` 永远不重试 | 这是最值得加重试的高发模式之一 |
| F12 | finishReason = MAX_TOKENS / RECITATION / LANGUAGE | 输出被截断 / 撞引用库 | candidates 存在，无 image | 视情况 | ❌ 直接归到 `未返回图片` 永远不重试 | 应区分 |

## 2. 项目当前覆盖度（按场景）

| 场景 | AI 服装大片 | photo-fission |
| --- | --- | --- |
| 网络抖动 (F1, F2) | ❌ 0 次重试 | ⚠️ 1 次线性退避重试 |
| 限流 429 (F3) | ❌ 0 次重试 | ⚠️ 1 次 1.5s 重试（< IPM 60s 窗口） |
| 5xx (F4-F6) | ❌ 0 次重试 | ⚠️ 1 次 1.5s 重试 |
| Safety / blockReason (F9) | ❌ 直接 fail | ❌ 直接 fail |
| IMAGE_SAFETY (F10) | ❌ 直接 fail | ❌ 直接 fail |
| 空 inlineData (F11) | ❌ 直接 fail | ❌ 直接 fail（**高频**） |
| 错误的 400/403 (F7, F8) | ✅ 直接 fail（正确） | ✅ 直接 fail（正确） |
| 局部成功 | ❌ 整批废，串行 loop 中断 | ✅ partial 状态 + 流式持久化 |

## 3. 关键定量数据

> 来自调研中的 Google 官方 + 第三方监控（见 stability-google-best-practices.md 引用）。

- **Gemini 3 Pro Image** 错误分布（社区抽样）：
  - HTTP 503 model overloaded：**~45%**（preview 阶段最常见）
  - HTTP 429 quota exceeded：**~30%**
  - 404 / 400 / 配置类：~20%
  - 500 INTERNAL：~5%
- **Tier 限额**（截至 2026-02）：
  - Free：10 RPM / 100 RPD / **2 IPM**（image-per-minute）
  - Tier 1：150 RPM / 1000 RPD / **10 IPM**
  - Tier 2：1000 RPM / 10000 RPD / **50 IPM**
  - **关键**：photo-fission 9 张 + concurrency=3 + 用户连点 2 次 → 瞬间 18 RPM、6 IPM 同时打出去，Free / Tier 1 必爆 IPM。
- **空 inlineData (F11)** 在多用户并发场景下出现率：社区 issue #1406 实测「偶发但非 0」，无重试时直接拉低成功率 5-10%。

## 4. 单点失败放大效应

| 设计点 | 当前行为 | 影响 |
| --- | --- | --- |
| ai-fashion-photo 单次失败 | 整批 throw，串行 loop 已生成图丢弃 | 用户视角"全失败"，但实际可能 1 张已成功被丢 |
| photo-fission worker 池抢同一 nextIndex | 无 IPM-aware 节流 | 9 shot × concurrency=3 集中打 IPM 限额 |
| 重试间隔 1500 × attempt 线性 | 429 时第 2 次仍在 IPM 窗口 | 429 -> 重试 -> 429 -> fail |
| 错误识别用字符串 | 一次 message 文案改写就会失效 | 工程稳定性高度依赖人类记忆 |

## 5. 推荐处理矩阵（**对实施 spec 友好**）

> 这一节直接喂给 implement 阶段做映射，每条 = 一个分支。

| Error Category | 识别信号 | 重试策略 | UI 文案 |
| --- | --- | --- | --- |
| `network` | fetch throw / AbortError / `UND_ERR_` | 指数退避 1s→2s→4s + jitter，最多 3 次 | "网络不稳定，正在重试…" |
| `rate_limit` | HTTP 429 或 status=RESOURCE_EXHAUSTED | 退避 max(`Retry-After`, 30s) + jitter，最多 2 次 | "上游限流，已自动等候并重试…" |
| `server_error` | HTTP 500/502/503/504 | 指数退避 2s→4s→8s + jitter，最多 3 次 | "Google 服务波动，正在重试…" |
| `safety_block` | promptFeedback.blockReason ∈ {SAFETY, OTHER} | 最多 1 次重试（jitter）+ 可选「安全化 prompt」降级 | "上游审核未通过，请尝试更改描述" |
| `image_safety` | finishReason = IMAGE_SAFETY | 最多 1 次重试（jitter） | 同上 |
| `prohibited` | blockReason = PROHIBITED_CONTENT / RECITATION | **不重试** | "提示词触发上游禁止内容规则" |
| `empty_output` | finishReason = STOP 且无 inlineData | 重试 2 次（**最关键**，命中已知 issue #1406） | "上游返回为空，正在重试…" |
| `bad_request` | HTTP 400 | **不重试** | 抛具体原因（图过大、prompt 过长） |
| `auth_failed` | HTTP 401/403 | **不重试，熔断** | "API 凭证异常，请联系管理员" |
| `unknown` | 其他 | 重试 1 次 | "生成失败，请重试" |

## 6. 一句话总结

> photo-fission 比 ai-fashion-photo 多了一道弱重试，但两条链路对 **F9 (Safety) / F10 (IMAGE_SAFETY) / F11 (Empty inlineData)** 都是裸奔；F11 还是社区 issue #1406 公认的高频偶发问题，没有任何重试相当于把 5-10% 的成功率白送。
