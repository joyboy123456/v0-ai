# brainstorm: laozhangapi 计费体系

## Goal

为图像生成功能建立计费体系，让用户能在界面上看到：老张 API 账户实时余额、今日生成了多少张图、每张图花费多少钱、今日花费总额。当前所有图像生成走老张 API（7 个 sk-xxx key 轮询池，共享同一账户余额），需要掌握成本消耗情况。

## What I already know

### 来自用户需求
- 想看到老张 API 实时金额（账户余额）
- 想看到今天生成了多少张图
- 想看到一张图花费了多少钱
- 想看到今天生成了几张图（与"多少张"语义一致，即当日生成数量）

### 来自代码库探索
- 所有图像生成统一走 `runImageEditViaProvider`（`lib/server/provider-image-router.ts`），这是理想的计费 hook 点
- 7 个 laozhang provider 配置在 `.env.local` 的 `IMAGE_PROVIDERS` 中，type 为 `laozhang`，权重各 20
- 模型单价已在 `laozhang-image-adapter.ts` 注释和文档中明确：
  - `gemini-3.1-flash-image-preview` (Nano Banana2): $0.055/张
  - `gemini-3-pro-image-preview` (Nano Banana Pro): $0.09/张
  - `gemini-2.5-flash-image` (Nano Banana): $0.025/张
  - `gpt-image-2` / `gpt-image-2-vip`: $0.03/张
  - `seedream-4-5-251128` (SeeDream 4.5): $0.045/张
  - `seedream-4-0-250828` (SeeDream 4.0): $0.035/张
- 现有持久化：`data/` 目录用 JSON 文件（fashion-mvp-store.json, saved-poses.json），`migrations/` 有 SQLite D1 schema（users/tasks/assets 表，无计费表）
- 现有日志：`lib/server/log.ts` 的 `logImageEvent` 输出 JSON-line 到 stdout/stderr
- 现有健康检查路由：`/api/health/providers` 返回 provider 健康状态（可作为新路由的参考模式）

### 来自调研（[research/laozhang-balance-api.md](research/laozhang-balance-api.md)）
- **余额查询接口存在**：`GET https://api.laozhang.ai/api/user/self`
- 认证用 **AccessToken**（系统令牌，不是 sk-xxx key），直接放 `Authorization` Header，不带 `Bearer`
- 响应 gzip 压缩，需 `--compressed`（Node fetch 自动解压）
- 返回字段：`data.quota`（剩余额度）、`data.used_quota`（已用额度）、`data.request_count`（请求次数）
- 换算：`500,000 额度 = 1 USD`
- **关键限制**：7 个 sk-xxx key 共享同一账户余额，无法按 key 区分消耗
- 不兼容 OpenAI `/v1/dashboard/billing/*`，用自有 `/api/user/self` 管理接口
- AccessToken 获取：登录 https://api.laozhang.ai/account/profile → 系统令牌 → 密码验证 → 复制（只显示一次）

## Assumptions

- 计费数据本地持久化（JSON 文件，跟随 saved-pose-store.ts 模式），不依赖外部数据库
- "今天"指自然日（0 点至今），非滚动 24 小时
- 单张图成本按模型固定单价计算（已知单价表，经老张账户级 ModelFixedPrice 校准）
- 实时余额查询已接入（用户提供 AccessToken 后实现，走 /api/user/self，带 30s 缓存）

## Open Questions

- （已解决）实时余额暂不做，先做本地计费累计
- （已解决）展示方式：侧边栏入口 + Dialog 弹窗，跟随 cleanup-dialog 模式

## Requirements

- [x] 记录每次图像生成调用的计费事件（模型、张数、单价、金额、时间、provider、taskId）
- [x] 统计今日生成图片总数
- [x] 统计今日花费总额（按模型单价 × 张数累计）
- [x] 展示各模型的单价（$/张）和今日消耗明细
- [x] 侧边栏加"计费统计"入口按钮，点击弹出 Dialog 展示数据
- [x] 查询并展示老张 API 账户实时余额（剩余/已用 USD、累计请求次数、账户分组）

## Acceptance Criteria

- [x] 界面显示今日生成图片总数
- [x] 界面显示今日花费总额（USD）
- [x] 界面显示各模型的单价（$/张）和今日消耗明细
- [x] 计费记录不影响生图性能（异步写入，失败静默）
- [x] 侧边栏"计费统计"按钮点击后弹出 Dialog 展示数据
- [x] 界面显示老张 API 账户实时余额（剩余 USD、已用 USD、累计请求次数）

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope (explicit)

- ~~实时余额查询（需 AccessToken，后续迭代）~~ → 已实现（2026-07-08，用户提供 AccessToken）
- 按 sk-xxx key 维度的分 key 计费（老张 API 不支持，7 key 共享余额）
- 用户级计费/配额限制（当前是单团队/单账户视角）
- 历史趋势图表/月度报表（MVP 先做今日数据）
- 自动充值/余额告警阈值触发动作（先展示，告警后续迭代）

## Research References

- [`research/laozhang-balance-api.md`](research/laozhang-balance-api.md) — 余额查询接口 `/api/user/self` 存在，但需 AccessToken；7 key 共享账户余额无法按 key 区分

## Technical Notes

### 实现方案（3 个文件 + 1 个 hook 点）

1. **计费常量表** `lib/server/billing/pricing.ts`
   - 导出 `MODEL_UNIT_PRICE_USD` 映射表（从 laozhang-image-adapter.ts 注释提取）
   - 提供 `getUnitPriceUsd(model)` 函数，未知模型返回默认价

2. **计费事件存储** `lib/server/billing/billing-store.ts`
   - 跟随 `saved-pose-store.ts` 模式：进程内 Map + `data/billing-events.jsonl` 持久化
   - `appendBillingEvent(event)`：异步追加到 jsonl（失败静默，不影响生图）
   - `getTodayBilling()`：返回今日统计（总数、总额、按模型分组明细）
   - 数据结构：`{ id, ts, model, count, unitPriceUsd, totalUsd, providerId, taskId }`

3. **计费 hook 点** `lib/server/provider-image-router.ts`
   - 在 `runImageEditViaProvider` 成功返回后，调用 `appendBillingEvent`
   - 记录：model、count（ResultAsset.length）、provider.id、taskId、单价、总额

4. **API 路由** `app/api/billing/today/route.ts`
   - GET 返回今日统计 JSON，跟随 `/api/health/providers/route.ts` 模式

5. **前端** `components/workbench/billing-dialog.tsx` + 侧边栏入口
   - 跟随 `cleanup-dialog.tsx` 模式：Dialog 弹窗展示今日数据
   - `feature-sidebar.tsx` 在"清理生成图"按钮上方加"计费统计"按钮（DollarSign 图标）
   - 展示：账户实时余额（剩余/已用 USD、累计请求、分组）+ 今日生成数、今日花费 USD、各模型单价表 + 今日消耗明细

6. **账户余额查询** `lib/server/billing/balance-service.ts`（2026-07-08 新增）
   - 走老张 `GET /api/user/self`，Authorization Header 放 `LAOZHANG_ACCESS_TOKEN`（不带 Bearer）
   - 换算：500,000 额度 = 1 USD
   - 进程内缓存 30s，避免频繁打管理接口；支持 `?force=1` 强制刷新
   - 返回 `modelFixedPrices`（账户级实时单价表），可用于校准本地 pricing

### 关键约束
- 计费写入异步且静默失败，绝不阻塞或中断生图主流程
- jsonl 追加写入，appendBillingEvent 内部 try/catch 包裹
- "今天"按服务器本地时区自然日 0 点计算
- 模型 ID 映射：doubao-seedream-* 经 MODEL_ID_MAPPING 转换后计价，需用原始 model 查单价表，未命中时尝试 mapped model
