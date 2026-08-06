# 计费统计独立页面 /billing

## 背景

旧「计费观测台」是渲染在侧边栏内部的 `fixed inset-0` 覆盖层。侧边栏 `<aside>` 带
`backdrop-blur-md`，按 CSS 规范成为 fixed 后代的 containing block，"全屏"页面被锁死在
260px 侧栏内（docs/billing-observatory-1.png），内容挤压裁切；叠加巨型渐变 Hero 数字、
极光玻璃拟态、9-11px 微字号，用户反馈「太死、看不清楚、不直观」。

前身任务 `08-03-billing-observatory-portal`（createPortal 修复）随本任务取代归档。

## 方案

独立路由 `/billing`，布局参考 Refero 研究（Exa usage 页为主、Cursor usage 页为辅），
用户已选定「合并总览」方向：

- 页头：← 返回工作台 / 标题 / 范围切换（今日·近7天·近30天）/ 刷新
- KPI 卡 ×4：范围内总花费、总调用次数、日均花费、峰值日（深色实心数字，无渐变无 count-up）
- 余额卡 ×2：老张 API（上游直连）/ Grsai（积分制），实白卡
- 全宽「按天花费」堆叠柱状图（recharts）：老张(琥珀 #F59E0B) + Grsai(青 #0D9488)
  按天堆叠，hover tooltip 分渠道明细，点柱子下钻/再点取消
- 下钻明细表（选中日出现）：两渠道合并按时间倒序，列 = 时间/渠道/模型/来源/Tokens/耗时/费用；
  老张分页「加载更多」，grsai 无 tokens/耗时显示 "—"
- 按模型汇总 ×2 卡：模型行 + 占比条 + 金额/次数
- 视觉：实白卡 + 1px 边框 + shadow-card，Ice Blue 令牌；渠道色仅作图表系列与小徽章；
  拒绝极光背景/渐变 Hero/玻璃叠层/微字号

## 实施

- 新增 `app/billing/page.tsx`（metadata + 渲染）
- 新增 `components/billing/`：`billing-page.tsx`（编排 + auth 守卫复刻 workbench 模式 +
  5 个 billing API 拉取）、`shared.ts`（类型/常量/格式化）、`kpi-cards.tsx`、
  `spend-chart.tsx`（recharts 堆叠图）、`call-log-table.tsx`（合并明细表）、
  `model-summary.tsx`、`balance-cards.tsx`
- `feature-sidebar.tsx`：计费统计 → `router.push('/billing')`，移除 BillingDialog
- 删除 `components/workbench/billing-dialog.tsx` 与 `components/workbench/billing/` 整目录
- API 零改动（复用 balance / laozhang/daily / laozhang/call-logs / summary / events）

## 验收

- [x] `/billing` 独立页面，三个范围切换正常，点柱下钻/取消正常
- [x] 侧边栏入口跳转、返回工作台链接、未登录 → /login
- [x] `pnpm lint` 0 error / `pnpm typecheck` 通过
- [x] `pnpm build` 通过
- [x] 截图对照（今日/近30天 + mock 数据近30天 + 8-04 下钻明细，见 docs/billing-page-*.png）
