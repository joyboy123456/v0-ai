# brainstorm: lovart 式用户-Agent 交互（编排）

## Goal

把现有「表单驱动」的生图工作台，改造成 Lovart 式的「对话驱动」创作流：用户在对话里说需求，
agent 澄清、出图，用户选中结果继续改。本任务是编排层，负责定架构接缝、拆子任务、定共享契约。

## 待评审的原始拆分（用户提出）

父任务 `07-28-lovart-user-agent-interaction`（编排，不写主循环）

| 子任务 | 做什么 |
| --- | --- |
| `07-28-lovart-ux-canvas-to-composer` | 画布选中 → Composer 芯片 / 加入对话 |
| `07-28-lovart-ux-followup-iterate` | 出图后「继续改」推荐短语（点击填入、不自动发送） |
| `07-28-lovart-ux-clarification` | 澄清进聊天时间线，不用确认闸门 |

## What I already know（仓库勘察结论，2026-07-28）

现有形态是**表单工作台，不是对话产品**：

* `components/workbench/workbench.tsx`（647 行）持有全部状态，`useState` + prop drilling
  下发给 `left-panel.tsx`（2412 行，功能表单）和 `right-panel.tsx`（3747 行，结果网格）。
* 全仓库 **零** 对话概念：`lib/types.ts`（788 行）没有 message / conversation / turn 类型；
  grep `timeline|conversation|composer|clarif` 只命中 LLM API 的 `role: assistant` 字段。
* **没有状态管理库**（无 zustand/jotai/redux）、**没有 AI SDK**（无 `ai`/`@ai-sdk`）、
  **没有流式传输**（无 SSE/WebSocket 依赖）。
* 「输入框」现状 = `left-panel.tsx` 里的 `<textarea maxLength=800>` + 模型/比例/分辨率/
  提示词模式等一堆受控字段，每个 feature 一套（ai-fashion-photo / photo-fission / pose-fission）。
* 「画布」现状 = 结果网格。已有的多选 `selectedAssets: Map<string, {url, downloadUrl}>`
  （`right-panel.tsx:297`）服务于 `batchSelectMode` 的**批量下载/收藏**，不是创作选区。
* **已存在 remix 回流通道**（与「选中→回到输入端」高度重合，设计中未提及）：
  `handleUseTaskAsFashionReference`（`workbench.tsx:401-426`）→ `FashionRemixRequest`
  （`lib/types.ts:199`）→ `left-panel.tsx:238-272` 的回填 `useEffect`。
  已知缺陷：只读 `task.params`，不消费 `inputAssets` 内容。
* 出图是**异步任务**：`/api/tasks` 轮询，状态 pending/running/completed，
  背后有 `image-work-scheduler`（全局并发/每用户配额/内存降载/队列 200 上限/QUEUE_FULL 503）。
* 出图**真实花钱**：`lib/server/billing/pricing.ts` 0.005~0.09 USD/张，有 `balance-service`。
* 持久化是 `store.json` + task-repo，有 OOM 事故史和专门加固（见 `AGENTS.md`）。

## 发现的问题（评审结论）

### P0 地基缺失：三个子任务都悬空

Composer、聊天时间线、agent 主循环、消息类型——**一个都不存在**。父任务声明「不写主循环」，
则三个子任务中任何一个都无法独立交付可验证的用户价值：
「画布选中 → Composer 芯片」的 Composer 不存在；「继续改推荐短语」填入的目标不存在；
「澄清进时间线」的时间线不存在。

### P0 切分维度错误：三刀切在同一根神经上

真正的接缝是**纵向**的（types → store → composer → timeline），三个子任务却按 **UI 功能横切**，
于是都要改 `lib/types.ts`（消息/草稿/芯片类型）、都要改 `workbench.tsx`（状态提升点）、
都要碰同一组新组件。并行开发必然产出三套互不兼容的 message 类型 + 大量冲突。

### P1 「画布」前提在本仓库不成立，工期无法估

Lovart 的画布是无限画布。本仓库只有任务卡片网格 + 批量下载选区。子任务没界定是
(a) 复用现有网格多选（约 1-2 天） 还是 (b) 真做无限画布（约 2-3 周，需引入 canvas 库）。

### P1 忽略了已有的 remix 通道

`FashionRemixRequest` 已经是「拿已生成结果回到输入端再来一轮」的现成骨架，
`canvas-to-composer` 和 `followup-iterate` 应当在它上面长，而不是重造一遍。

### P1 「不用确认闸门」与计费冲突

出图按张扣真钱。澄清不设闸门 ⇒ 信息不全时 agent 可能直接出图烧钱。
必须先定：澄清消息是阻塞还是非阻塞？信息不全时 agent 的默认动作是什么（不出图 / 出 1 张试探 / 出全量）？
这条不是纯 UX，与 billing 有交互。

### P1 缺失最难的子任务：消息 ↔ 异步 task 绑定

出图异步且有队列。timeline 里一条 assistant 消息如何绑定 running task、
如何显示排队位置/进度/失败/取消/重试？三个子任务一个都没覆盖。缺它，timeline 只是静态列表。

### P2 会话持久化未定

消息落不落 `store.json`？刷新页面 timeline 还在吗？多用户隔离？
（store.json 有 OOM 事故史，往里加高频写入的对话流需要谨慎。）

### P2 与现有表单模式的关系未定（产品级决策，决定整体架构）

agent 对话是**替换**三个 feature 表单，还是**并存**？并存则表单状态与对话状态双写，
是最大的复杂度来源。这个不定，架构无从落地。

### P2 命名

`lovart-ux-*` 是竞品名而非能力名，3 个月后无人能从名字推断内容；
`user-agent` 与 HTTP User-Agent 撞词。建议按能力命名。

### P3 Trellis 自身的问题（本机）

* `.trellis/spec/` **不存在** → workflow 宣称的核心机制「specs injected」是空的。
  本次要动 3747 行的 `right-panel.tsx`，正是最需要 spec 约束的时机（否则继续往巨型文件堆代码）。
* `.trellis/workspace/` 不存在，session 日志从未落盘。
* 本机 `python3` = 3.6.8，`task.py` / `get_context.py` 需要 3.7+
  （`from __future__ import annotations`）→ **全部脚本无法执行**，任务目录只能手工建。

## 建议的重新拆分（walking skeleton：先纵向打通最薄一条，再横向加厚）

**Task 0（新增，必须先做）`agent-chat-contract` —— 契约与骨架**

* `lib/types.ts` 定义 `AgentMessage` / `AgentTurn` / `ComposerDraft` / `SelectionChip`
* 新目录 `components/workbench/agent/`（**不碰** `right-panel.tsx`）
* timeline 壳 + composer 壳；一个**规则驱动的 mock agent**（不接 LLM）
* 打通最小闭环：用户发消息 → agent 回一条 → 触发一个真 task → 消息绑定 task 状态流转
* 交付后，下面三个才有地基，且可真正并行

**然后三个子任务降为薄层：**

1. `canvas-selection-to-composer` —— 基于已有 `selectedAssets` + remix 通道
2. `followup-suggestions` —— 推荐短语（先硬编码模板，不接 LLM）
3. `clarification-in-timeline` —— 澄清消息渲染 + 非阻塞语义 + 计费保护

**父任务自己要拍的板：** 替换 vs 并存 · 会话持久化方案 · 「画布」范围 · 是否引入状态管理库

## Open Questions

* [Blocking] agent 对话与现有三个 feature 表单的关系：替换 / 并存 / 独立入口？
* [Blocking] 「画布」= 复用现有结果网格多选，还是真做无限画布？
* [Blocking] 澄清消息阻塞还是非阻塞？信息不全时 agent 默认动作？（与计费相关）
* [Preference] 是否接受先插入 Task 0（契约与骨架）再并行三个子任务？
* [Preference] 是否本轮顺手补 `.trellis/spec/` 的 workbench 前端层约定？
* [Preference] 本机 python 3.6 要不要修（装 3.9+），否则 trellis 脚本长期不可用？

## Out of Scope（待确认）

* 本轮不接真 LLM agent 决策（先 mock agent 打通 UX）
* 不做无限画布（除非上面第 2 问选 (b)）

## Technical Notes

已勘察文件：`components/workbench/{workbench,left-panel,right-panel,image-task-card}.tsx`、
`lib/types.ts`、`lib/server/billing/pricing.ts`、`lib/server/image-work-scheduler.ts`、
`package.json`、`.trellis/workflow.md`、`.trellis/tasks/*`
