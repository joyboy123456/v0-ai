# Agent C12 计划卡与工具轨迹 UI：Grok 本地自测记录

> **Codex 最终独立验收补记**：五项 UI 返工已复核；候选与主目录均 880/880、非增量 TypeScript、ESLint、架构检查通过。11 个 UI/展示测试文件和本记录已集成，后端、协议、全局主题与基线摘要一致。真实工作台组件在本地 Chromium 的模拟 API 验收最终 19 项通过，含闲置跨 TTL 禁确认、Enter/Space 轨迹展开、UNKNOWN/隔离状态、重试参数、390px 暗亮无溢出及确认按钮无遮挡可点击；浏览器无页面错误。下文“待 Codex”仅为 Grok 交付时点。当前 C12 已通过本地验收，未调用真实供应商、未运行 Next 生产构建或发布。持久证据见 [会话交接](./agent-session-handoff.md)。

日期：2026-09-17。执行契约见 [任务拆分 C12 卡片](./agent-task-breakdown.md)。前置 C13 已由 Codex 独立验收并集成。本记录覆盖 C12 初稿及 Codex 浏览器审查后的五项窄范围返工，**Grok 自测待 Codex 复跑**。

## 基线、目录与操作边界

- 唯一可写副本是 `/private/tmp/dianshang-agent-resume-BZRSor/grok-c12-source`。未读取主项目、其他副本、业务 `data/`、`.env`、`public/` 生产素材或 Git。
- 未安装依赖、未 Next build、未提交/推送、未调用真实模型/生图/分类/抠图，未派子 Agent。
- 测试只用合成会话、合成图片节点和合成工具轨迹。只读了父目录 `c12-review-notes.txt`。

## 交付范围

1. **计划卡**按服务器 `AgentBetaPreviewView` 展示功能、真实冻结模型、张数、当前预览版本、参考素材、过期/阻断/风险说明。版本是主信息；校验编号放在可选只读详情，不写「原样回传」等接口机制。不在浏览器计算价格、digest、featureType 或张数。
2. **编辑要求 → 更新预览 → 确认当前版本**。v1 修改提示词后只能先更新预览；确认按钮携带渲染时身份，不自动提交更新版。过期、阻断、非 confirmable、忙碌时不能确认。
3. **到期重渲染**：proposed 预览按 preview identity + `expiresAt` 设置到期 timer，版本变化/卸载会清理。闲置跨过 TTL 后重渲染并禁用确认，不自动重预览/提交，不改 C13 回调身份。
4. **工具轨迹**用中性动作名（检查素材、服装分类、准备方案、取消任务），完成/未通过/待核实只由 status 表达。无 plan 的 assistant 消息也可展示。
5. **抠图**：`verification_required` 只提示核实/GET 刷新，不引导再创建；`rejected` 才提示用户明确再操作。无自动供应商调用。
6. **v1 比例/分辨率**：PreviewView 无这两项真值，卡片不把 `plan.settings` 当冻结参数展示；model/count/assets 仍来自 PreviewView。legacy 仍可显示当前选择。
7. **对比度**：C12 关键 12px 标签文字改用 `text-foreground`，保留蓝色图标/边框/`bg-primary/10`，未改全局主题。

## 文件

- 修改：`components/agent-beta/agent-chat.tsx`、`plan-preview-card.tsx`、`plan-preview-view.ts`、`plan-preview-view.test.ts`、`tool-trace.tsx`、`tool-trace-view.ts`、`tool-trace-view.test.ts`、`agent-beta-workbench.tsx`、`use-agent-beta.ts`、`session-state.ts`、`session-state.test.ts`
- 文档：本文件。

未改 `lib/server`、C9/C7/C8、`lib/agent-beta/types.ts`/`protocol.ts`、全局 CSS、模型目录或四个原表单。

## UI 行为

| 状态 | 可见结果 | 可点操作 |
| --- | --- | --- |
| v1 待确认 | 预览版本、模型、张数、素材、有效期；无未冻结的比例/分辨率 chip | 确认当前版本（绑定渲染身份） |
| 闲置跨过 expiresAt | 过期提示，确认禁用 | 不自动重预览/提交 |
| 已改文字未预览 | 步骤停在「更新预览」 | 只显示更新预览 |
| pending / verifying / quarantined / admitted | 标签互斥 | verifying 只 GET 刷新 |
| 抠图待核实 | 中性「准备服装抠图」+ 待核实 | 只刷新/人工核实，无重做提示 |
| 抠图明确拒绝 | 中性动作名 + 未通过 | 对话里明确再操作，无供应商重试 |
| legacy | 可显示当前选择的比例/分辨率 | 编辑后直接确认 |

## 本地验证

| 检查 | 结果 |
| --- | --- |
| 计划卡/轨迹/C13 protocol 定向 | **33 / 33**（含跨期后禁用、新版本更换期限、中性轨迹名、抠图待核实 vs 拒绝、v1 省略未冻结比例分辨率） |
| `pnpm run test:agent` | **880 / 880** |
| `pnpm exec tsc --noEmit --incremental false` | 通过 |
| 受影响文件 ESLint | 通过 |
| 架构守卫 | 通过 |
| 浏览器 390px/桌面、暗亮主题、闲置 TTL | **Codex 已做过初稿浏览器检查；本轮修复后 Grok 未再跑浏览器。不声称最终视觉验收。** 请 Codex 重跑同一闲置 TTL 场景及标签对比。 |

## 已知限制 / 待 Codex 验收

- 未 Next build、未测试站、未发布。
- 到期 timer 只触发重渲染与禁用确认；服务端 TTL 仍是最终校验。
- 请 Codex 独立复跑闲置 5s TTL、定向/全量 agent 测试、非增量 tsc、ESLint、架构守卫，以及浅色/暗色标签对比。
