# 计费观测台：周/月视图 + 按天下钻 + Awwwards 级视觉

## Goal

将现有"今日计费"弹窗升级为全屏沉浸式计费观测台：支持今日/近7天/近30天范围切换，按天分布可视化，点击某天下钻看逐条调用明细。分渠道查询——老张走上游实际扣费，Grsai 走本地事件估算。视觉对标 Awwwards/FWA 水准。

## 探测结论（已用 env AccessToken 实测，详见 research/laozhang-usage-api.md）

老张是 new-api 体系，AccessToken 额外可用两个接口：

| 接口 | 能力 | 实测结果 |
|---|---|---|
| `/api/data/self?start_timestamp&end_timestamp` | 按天×按模型聚合（date/modelName/sumQuota/sumUsd） | 一次请求返回整段范围，实际扣费 |
| `/api/log/self?p&start_timestamp&end_timestamp` | 逐条调用流水（时间/模型/实际扣费/token_name 区分 key/tokens/duration） | 支持时间范围+翻页，页大小固定 10 条，无总数 |

- 数据自 7/4 账户创建起全量；按 new-api 惯例标准用户保留约 30 天 → "近30天"为实际上限
- FAQ 里的 `/v1/usage/logs` 实测 404，不采用
- Grsai 无任何历史/日志接口 → 走本地 `billing-events.jsonl`（7/8 起，固定单价估算）
- 本地事件可按 `providerId` 前缀区分渠道（`laozhang-*` / `grsai-*`），数据启动时已全量加载进内存

## 设计概念（Awwwards 级视觉）

**形态**：跳出居中小弹窗 → 全屏沉浸式覆盖层。底层 Ice Blue 渐变 + 细点阵纹理 + 两团缓慢漂移极光光晕（天空蓝×琥珀金），内容浮于玻璃拟态面板之上。

**排版**：范围总花费以 `clamp(4rem,12vw,9rem)` 巨型 tabular-nums 数字做视觉锚点，切换范围时 count-up 动画；微标签 `tracking-[0.2em]` 大写小号字；数据行等宽字体对齐。

**核心交互**：
- 范围切换：分段控件 + framer-motion `layoutId` 弹簧滑动指示丸
- 按天分布：自绘柱状图（不用 recharts），渐变柱体+辉光，弹簧高度动画+逐根 stagger；hover 十字准线+悬浮玻璃 tooltip；点击选中当天
- 下钻：选中天后下方面板弹簧展开（AnimatePresence height auto），逐条调用记录 stagger 滑入——时间/模型/key 徽章/tokens/扣费，老张区底部"加载更多"翻页
- 双渠道分区专属强调色：老张=琥珀金（实际扣费，"上游直连"徽章带呼吸脉冲点），Grsai=青玉色（CNY 本地估算，标注"估算"）
- 顶部实时余额卡重构为玻璃"仪表卡"，刷新时 shimmer 扫过
- 空态/加载态：Lucide 图标 + shimmer 骨架，全程无表情符号，图标统一 Lucide

**动效令牌**：复用 `--ease-out-expo`/`--ease-spring`，framer-motion spring（stiffness≈260/damping≈30），stagger 30-50ms。

## 技术栈

- framer-motion 12（弹簧物理动效）
- lucide-react（图标）
- Tailwind 4 + Ice Blue 主题令牌
- recharts 可用但选择自绘柱状图以获得完全视觉控制

## Requirements

### 后端
- [ ] 新增 `lib/server/billing/laozhang-usage-service.ts`：上游 daily 聚合 + logs 逐条
- [ ] 扩展 `lib/server/billing/billing-store.ts`：范围汇总（byDay）+ 当天事件
- [ ] 新增 4 个 API 路由（均 requireUser + nodejs + force-dynamic）
- [ ] 保留 `/api/billing/today` 不动（向后兼容）

### 前端
- [ ] `components/workbench/billing/` 目录拆分组件
- [ ] `billing-observatory.tsx`：全屏覆盖层骨架 + 极光背景 + 范围 tabs + hero 数字
- [ ] `balance-cards.tsx`：双渠道实时余额仪表卡
- [ ] `daily-chart.tsx`：自绘弹簧柱状图 + tooltip + 选日
- [ ] `channel-section.tsx`：渠道分区容器
- [ ] `call-log-list.tsx`：逐条调用列表 + 加载更多
- [ ] `billing-dialog.tsx` 改为薄入口（保持现有 export 名/props，侧边栏不用动）

## API 设计

| 路由 | 参数 | 返回 |
|---|---|---|
| `GET /api/billing/laozhang/daily` | `range=today\|7d\|30d` | `{ok, range, days:[{date,totalUsd,calls,byModel[]}], summary}` |
| `GET /api/billing/laozhang/logs` | `date=YYYY-MM-DD&p=1` | `{ok, date, items:[{ts,model,keyName,usd,promptTokens,completionTokens,durationSec}], hasMore}` |
| `GET /api/billing/summary` | `range=today\|7d\|30d&channel=grsai` | `{ok, range, channel, summary:{totalCount,totalUsd,totalCalls,byModel[],byDay[]}}` |
| `GET /api/billing/events` | `date=YYYY-MM-DD&channel=grsai` | `{ok, date, channel, items:[BillingEvent]}` |

## 已知边界

- 上游 `/api/data/self` 的 date 为账户时区（UTC）口径，与服务器 UTC+8 日界可能有 ±1 天偏差；逐条日志按本地日界 unix 秒过滤是精确的
- 老张约 30 天保留期；grsai 本地数据仅 7/8 起
- 老张账户余额近空（$0.035，7/21 后无新调用），近期数据主要看 Grsai 区

## Acceptance Criteria

- [ ] 范围 tabs 今日/近7天/近30天切换正常，hero 数字 count-up 动画
- [ ] 老张区展示上游实际扣费的按天柱状图，点击柱体展开当天逐条调用（含 key/tokens/扣费），支持加载更多翻页
- [ ] Grsai 区展示本地估算的按天柱状图，点击展开当天事件
- [ ] 双渠道独立查询，单渠道失败不影响另一个
- [ ] 实时余额卡正常显示（沿用现有 balance 接口）
- [ ] 全屏覆盖层视觉达标：极光背景、玻璃面板、弹簧动效、Lucide 图标、无表情符号
- [ ] lint + typecheck 通过
- [ ] `billing-dialog.tsx` 保持 export 名 `BillingDialog` 和 props `{open, onOpenChange}`

## Out of Scope

- 自定义起止日期选择器（三档预设足够）
- 老张上游数据本地存档（突破 30 天保留期）——后续迭代
- 按月/按年更长范围（上游 30 天限制）
- 余额告警阈值
