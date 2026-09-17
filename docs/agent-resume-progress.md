# Agent 开发恢复记录

> **GitHub 备份准备（2026-09-17）**：用户授权提交并推送现有主目录到 GitHub。先快进保留远程 main 的两次新提交（到 2c4e530），再保存 24/39 Agent 集成基线及验收文档。E2 编码已暂停，未验收代码仅在 `AgentStaging/dianshang-grok-e2-20260917/source`；不把候选混入已验收提交。模型密钥仅在被忽略的本地环境文件中。未部署服务器。

> **后续兜底复核（2026-09-17）**：用户要求接管前一个 Harness 失败交付的子任务。Codex 主会话亲自补齐 E1 R3～R7 独立审查并重查 R1/R2，无需产品代码返工；主目录 905/905、非增量类型、17 文件 lint、架构及 diff 检查全绿，17 文件哈希与上轮最终记录一致。第二双眼睛复核待办关闭，24/39 不变。完整 policy decision 与落盘记录包含 unsupported 清单，精简端口/事件不携带且未接 UI，已澄清文档。见 [兜底复核记录](./agent-e1-takeover-review.md)。下方“残留复核”措辞是此前时点的历史记录。

> **最新收口（E1，2026-09-17）**：E1 Critic + AcceptancePolicy 已完成 **实现 → 独立核对 → 返工 → 集成** 全程，任务卡计数 23/39 → **24/39**。Kiro 实现自测 895/895；Codex 不采信自述，用 23/39 基线的 116 文件哈希证明 Kiro 暂存副本中 8 个被改文件与基线逐字节相同，据此还原 E1 的精确 diff 逐行核对，发现 7 个问题：R1 瞬时失败污染评审缓存（并会让后续真实评审因指纹冲突被吞）、R2 墙钟 timeout 破坏确定性且不取消底层 sharp、R3 阈值不绑定 policyVersion、R4 grounding 未在 policy 边界强制、R5 空 proposals 可吞掉确定性失败项、R6 颜色/版型/肢体/审美连 check 条目都没有、**R7 C8 发布门被从显式 continue 削弱成隐式不变量**（实测回退后未准入结果会泄漏成画布节点）。返工全部限制在 E1 白名单内并补 10 条回归，主目录最终 **905/905**、非增量 TypeScript、17 文件 ESLint、架构守卫、`git diff --check` 全绿，已按字节集成并留哈希清单。残留一项：返工代码由同一会话完成，建议下一会话做一次 10 文件 diff + 五门禁的小范围复核。细节见 [E1 验收与独立核对](./agent-e1-acceptance.md) 与 [会话交接](./agent-session-handoff.md)。

> **上一轮最终结论（2026-09-17）**：C9、C13、C12 已全部独立验收并集成，首版最短路径 23/39 卡完成。最终候选与主目录 880/880、类型/lint/架构全绿；本地真实客户端组件模拟 API 浏览器验收 19 项通过。以下保留过程记录，旧的“当前/待验收”描述均对应其记录时点；最新交接以 [会话交接](./agent-session-handoff.md) 和任务总表为准。完成证据、截图和各阶段集成前备份已持久保存。

收尾：编码会话与 Playwright 上下文已结束，临时 QA HTTP 服务已关闭。源码副本/备份保留，不含业务数据备份；未提交或发布。最终界面截图另导出至本任务可视化目录的 `agent-delivery/`。

2026-09-17。用户授权沿当前进度继续 C9 → C13 → C12，由 Codex 调度本机 Kiro、Claude Code 和新增 Grok，最终由 Codex 审核。沿用本地开发、无真实产品供应商请求、无 build/服务器/测试站/提交/推送的边界。

## 最新里程碑：C9 已验收并集成

- Kiro 首轮修复从 39/76 红灯到 780/780 全量；Claude/Grok 辅助审查分别提出目录别名锁及非 garment 抠图问题，Codex 复核后交回 Kiro。两项回归由 86/90 红灯到 90/90，全量 784/784。
- Claude 首轮发生工具调用解析错误，Grok 达到工具轮次上限；二者均在禁用工具后正常交回有限范围结论。辅助报告未直接当作验收结论；Grok 建议放开在途任务期间抠图未采纳，保留既有策略。
- Codex 独立检查省略参数、四类真实 C4 适配/冻结控制、精确 cutout 前沿、来源契约、完成记录与父目录别名锁；确认非 garment 在网关前拒绝。独立候选及主目录验证均为 784/784，非增量 TypeScript、14 个 C9 文件 ESLint、架构守卫通过；两次验证期间代码摘要无变化。
- 已按白名单集成 14 个代码/测试文件和 C9 验收文档；主目录既有文档修订保留，C8/旧 Beta/HTTP/React 代码没有本轮越界修改。累计 21 张卡完成本地验收。下一步 C13，C12 仍待 C13 通过。
- 原始结果：本轮运行目录内 `c9-final-verification.json`、`c9-main-verification.json` 及对应 tests/types/lint/architecture 日志；`c9-integration.json` 记录每文件前后 SHA-256，`main-before-c9/` 保留被覆盖文件的旧内容。无 Git 提交或生产发布。

## 当前推进：C12 已派发，C13 已验收

C12 已交给本机 Grok。独立候选 `/private/tmp/dianshang-agent-resume-BZRSor/grok-c12-source`，384 个文件基线保存在 `baseline-c12.json`；已有依赖完整复制并验证 next/tsx/zod/react/typescript/Tailwind 均解析到该副本内部。任务书 `grok-c12-prompt.txt`，日志 `grok-c12.jsonl`，禁止修改服务端和既有审批/准入规则。主目录当前仍是 C13 已验收版本；C12 交付必须由 Codex 独立测试、浏览器检查、核对后端摘要不变后才能集成。

C12 首版 Grok 自测 877/877、类型/lint/架构通过。Codex 实际浏览器检查发现：有效预览闲置跨过 TTL 后按钮仍可确认；另有步骤完成时态、UNKNOWN 抠图重做提示、retry 比例/分辨率真值及浅色小标签对比度问题。已启动同一 Grok 会话返工，日志 `grok-c12-review.jsonl`，任务书 `grok-c12-review-prompt.txt`。C12 尚未验收、未集成。

C13 完成证据也已复制到持久目录 `.../resume-20260917-BZRSor`：12 份日志/报告/清单、最终浏览器截图与 `main-before-c13/`。C12 未验收材料不混入该完成证据。

**本段最新结论：C13 已验收并集成，当前接续 C12。** 最后 B-retry 补丁为同一保护逻辑的原任务 ID 收集；7 项回归 0/7→7/7，邻接 16/16。Codex 独立运行候选与主目录各 859/859、非增量 TypeScript、lint、架构检查，检查期间代码 SHA-256 未变化。20 个代码/测试文件与验收文档已按字节集成，清单 `c13-integration.json`、备份 `main-before-c13/`；最终浏览器 `c13-final-browser-report.json` 记录 7 项模拟 API 实际组件回归，无页面错误，含编辑只预览、版本确认、三种准入状态、390px 暗色无横向溢出。当前累计 22 张任务卡完成本地验收。

进一步进度：A–E 首轮返工已经 Kiro 自测及 Codex 独立全套复跑 852/852、类型/lint/架构通过。Codex 又用真实 Repo/Service 复现 B 的 retry 原任务 ID 变体：缺账时 `plan.task` 被清除，原 ID 只留在 `resultAdmission.taskId`，hydrate 未收集该 ID，非标准历史节点仍返回 URL。当前正在同一 Kiro 会话做最后窄修复，日志 `kiro-c13-finalfix.jsonl`、任务书 `kiro-c13-finalfix-prompt.txt`；仍未验收、未集成 C13。代码基线检查脚本为 `verify.mjs`，C13 安全集成脚本 `integrate-c13.mjs` 必须等 `c13-final-verification.json` 全绿后才能执行。C12 任务草案与复制脚本已准备，但未执行、未派发。

最新：C13 首版 Kiro 自测 831/831、定向 102/102、类型与架构通过，但 Codex 尚不验收。主 Agent 独立浏览器检查前端候选 7 项通过（合成 API/图片）；另独立复现上传资产 `dataUrl: undefined` 的 canonical 失败、缺账本的 v1 历史节点返回 URL、响应体延迟超过 transport timeout 仍成功。点击版本身份与预览过期/恢复也已列入审查。已恢复同一 Kiro 会话按五组意见返工，任务书为本轮运行目录 `kiro-c13-review-prompt.txt`，详细取证 `c13-review-notes.txt`，当前运行日志 `kiro-c13-review.jsonl`。C13 未集成，C12 未派发。

C9 候选及主目录独立验收完成后，已正式启动 Kiro 的 C13 编码会话（本轮运行目录 `kiro-c13-prompt.txt`、`kiro-c13.jsonl`、`kiro-c13-process.json`）。基线为 `baseline-c13.json` 的 369 个文件，分别记录候选与主目录摘要；C9 已验收代码不可回退。目标为新主循环到 Beta 消息、编辑重新预览、明确版本确认、C7 提交、C8 刷新/安全视图、最小客户端协议全链路。C12 尚未派发。

前端前置指南已通过 Modern Web Guidance search/retrieve 获取 accessibility/forms，重点保留原生语义控件、IME 输入、异步请求版本隔离、轮询清理、状态播报、触屏与暗亮主题。C13 不提前重做视觉设计，不拓宽当前 C6 功能特有参数域。

### C9 分工记录

- Kiro：C9 真实参数适配、抠图风险语义、来源契约复用、回放回归及业务文案修复；主执行 effort=max，使用原隔离源码。
- Claude Code：A2 完成记录、锁和回放的辅助只读审查。
- Grok：工具绑定、风险前沿及动作身份的辅助只读审查。
- Codex：独立代码审查、实际测试、基线/白名单核对和集成；并核对后续 C13 的接口依赖。辅助审查不替代最终验收。

## 前置核对记录（已由上方最新里程碑更新）

- C8 已独立验收并集成；19 个集成文件和 363 个 C9 基线文件已在前一轮核对。
- 本轮 Codex 独立运行修复前 C9 候选，`node scripts/test-agent.mjs` 766/766 通过，0 失败、0 跳过。
- 两处真实遗漏已交 Kiro：`parameters` 省略时 B6 收到显式 undefined；统一 generationSettings 与 pose/garment-detail 的真实 strict schema 不兼容。
- 旧笔记的来源标签判断已过期：当前共享 `FieldOrigin` 确实为 `user_text`，不应改成 `user_prompt`。Kiro 应复用共享契约、补防漂移验证。
- 同源 API 路径过滤已有局部修复，待补真实 completion 回放；抠图元数据被改成 external_reversible 的语义仍需纠正。
- Claude 首次调用因变长参数未分隔报 MCP 配置错误；加参数分隔后已进入读取审查。Grok 与 Kiro 均已实际启动。

## 恢复入口

- 候选：`/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source`。
- C9 完成证据已另存持久目录：`/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/resume-20260917-BZRSor`，包含 11 份独立验收日志/清单与 `main-before-c9/`。当前 C13 尚未验收，不包含在该完成证据范围内。
- 本轮调度、任务书、只读快照与运行日志：`/private/tmp/dianshang-agent-resume-BZRSor`。该目录是临时运行材料，不能作为唯一永久交付位置；阶段结束应将验收结论及必要证据摘要写回主项目文档。
- `dispatch.mjs`、各 `*-prompt.txt` 保存实际派发范围；`*-process.json`、`*-exit.json` 和 `*.jsonl` 记录运行状态。读取结果时只提取助手公开文本/工具状态，不转抄内部思考过程。
- C9 已验收并集成；C13/C12 后续状态以上方里程碑及新记录为准。主目录文档中的当前边界修订必须在后续集成时保留。
