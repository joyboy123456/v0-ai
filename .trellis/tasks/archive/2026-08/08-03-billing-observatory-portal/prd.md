# 修复计费观测台被侧边栏约束成条状

## 问题

侧边栏点击「计费统计」后，计费观测台（余额查询 + 消费统计页）只渲染成左侧约 260px 宽的竖条，内容被挤压裁切（见 docs/billing-observatory-1.png），而不是设计的全屏页面。

## 根因

- `components/workbench/feature-sidebar.tsx` 的 `<aside>` 带有 `backdrop-blur-md`（backdrop-filter）。
- CSS 规范：祖先带 `transform` / `filter` / `backdrop-filter` 时，`position: fixed` 后代相对该祖先定位，而非视口。
- `BillingObservatory` 的 `fixed inset-0` 覆盖层渲染在 `<aside>` 内部（`BillingDialog` 挂在 sidebar 里），因此被约束在侧边栏矩形内。
- 同 sidebar 内的 `CleanupDialog` / `InviteCodesDialog` 用 shadcn `Dialog`（默认 portal 到 body），不受影响。

## 需求

1. `BillingObservatory` 覆盖层通过 `createPortal` 挂载到 `document.body`，脱离侧边栏 containing block，恢复全屏。
2. SSR 安全：Next.js 服务端渲染时无 `document`，需 mounted 守卫（`useEffect` 后置位），避免 hydration 报错。
3. 组件 props 接口（`open` / `onOpenChange`）与 `BillingDialog` 薄包装保持不变，侧边栏无需改动。
4. 修复后打开「计费统计」应全屏展示：范围 tabs、Hero 大数字、双渠道余额卡、老张/Grsai 分区均正常铺开。

## 非目标

- 不改余额/账单数据接口与视觉设计。
- 不动 `feature-sidebar.tsx` 的布局（portal 方案下无需动）。

## 验收

- 打开计费统计为全屏覆盖层，关闭/Esc 正常。
- `pnpm lint` / `pnpm type-check`（或 tsc）通过。
