# Agent C13 Beta 产品协议与仓储接线：Kiro 本地验收记录

> **Codex 独立验收补记**：本卡及 A–E、B-retry 返工已独立复核。候选与主目录均 859/859、非增量 TypeScript、ESLint、架构检查全绿，验证期间代码摘要不变；真实工作台组件的模拟 API 浏览器回归 7 项通过、无页面错误。20 个代码/测试文件和本记录已按白名单集成。下文“待 Codex”描述 Kiro 交付时点；当前 C13 已通过本地验收，C12 随后推进。无真实模型/生图调用、未运行 Next 生产构建、未部署。证据入口见 [开发恢复记录](./agent-resume-progress.md)。

日期：2026-09-17。执行契约见 [任务拆分 §2.11 与 C13 卡片](./agent-task-breakdown.md)。前置 C8 已由 Codex 独立验收；C9 也已由 Codex 独立复跑候选/主目录 **784/784**、非增量 TypeScript、14 文件 ESLint 与架构守卫，并按 14 个代码/测试文件及本验收文档原字节集成。本页只记录 **Kiro 在隔离候选副本完成 C13 实现、Codex A–E 审查返工与本地自测**。Codex 在实现期间完成的真实组件浏览器 7 项检查均通过，但其后仍发现 A–E 实际缺口，故不构成最终验收；这些缺口现已测试先行修复，C13 当前仍是 **待 Codex 独立核对、复跑与集成**，未启动 C12。

## 基线、目录与操作边界

- Kiro 唯一可写副本是 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source`；没有读取或修改 Codex 主项目。
- 只读了 `/private/tmp/dianshang-agent-resume-BZRSor/` 中获准的 `c9-final-verification.json`、`c9-main-verification.json`、`c9-integration.json`、`baseline-c13.json` 和后续 `c13-review-notes.txt`，未跟随其中 `main`、`mainFiles`、fixture 或日志路径访问其他目录。
- 开工前只用 `baseline-c13.sourceFiles` 核对当前候选，**369/369 SHA-256 全匹配**；本卡没有使用 C8 前 baseline，也没有把 `mainFiles` 当候选基线。
- 未访问 `.env`、业务 `data/`、`public/` 素材、Git、服务器或测试站；未安装依赖、未 build、未提交/push/建分支，未修改认证、系统配置、四个既有表单 API 或计费体系。
- 测试只用临时目录、合成 Task/Asset/Session、注入模型 transport/任务命令/供应商动作；真实 LLM、分类、抠图、生图调用均为 **0**。

## 交付范围

C13 已把既有 Beta 产品入口接到真实 C9/C4/C7/C8 模块，而不是只新增未使用模块：

1. `POST .../messages` 在双门禁通过时构造并强持久可信 `AgentTurnInput`，运行真实 C9 多轮模型/只读工具；付费动作只返回真实 C4 冻结预览。
2. `POST .../preview` 是独立 repreview：只用服务端原工件重新 prepare/validate，递增版本，不签发批准、不调用 Gateway。
3. `POST .../execute` 的 v1 分支只接收当前 `messageId/proposalId/previewVersion/previewDigest`；服务端取完整工件、签发真实 ApprovalStore 回执，再交 C7 Gateway。
4. Gateway 返回 pending 后先有 C8 post-submit 证据；所有 session 返回继续经 `syncTasks → ResultAdmission → hydrate`，只有 C8 `ADMITTED` 安全结果才加入画布。
5. 真实失败镜头 retry 仍由消息进入 C9，再走 C4 `prepareRetry`、重新批准、C7 和 C8 attempt 窗口；没有新增可绕过治理的 retry 路由。
6. 分类、服装抠图、取消由当前认证请求文本/按钮确定目标，服务端签发真实 `UserIntentReceipt`；模型布尔值、body 中的 intent/approval/status 均无效。

没有实现 C12 视觉完善、P3 多步计划、跨进程租约、金额估算或新的功能表单。

## 公开协议

- `AgentBetaPlan.protocol` 明确区分 `legacy | agent-runtime-v1`。旧持久记录允许缺字段；新 v1 方案始终写标记，flag 关闭也不会降级已有 v1。
- `AgentBetaPreviewView` 只包含 proposal/version、服务端 request digest 引用、功能、真实冻结模型、真实张数、当前会话素材摘要、blocker/risk notice、有效期与 `confirmable`。完整 `normalizedParams`、assetDigests、Approval/Intent、A2 请求、budget/requestIds 均不下发。
- `toolTrace` 只保留 step/tool/status/target/reason 安全投影，不包含参数、callId、原始异常或供应商响应。
- `resultAdmission` 分离 `not_submitted/pending/verifying/admitted/quarantined` 与 task status；另带本 action 的 C8 安全结果数量。`ADMITTED` 但结果数为 0（如取消/失败无完成子图）不会在 UI 声称“图片已加入画布”。
- 客户端通过纯 helper 原样复制服务端 preview identity，不计算摘要；v1 prompt 改动时只能先 repreview，只有服务器返回新版本且 prompt 一致后才能 confirm。

## 门禁与兼容

- `BETA_AGENT_ENABLED` 和既有用户访问规则仍是 HTTP 总门禁；总门禁失败时不会读取 body 或加载业务 service。
- `AGENT_RUNTIME_V1_ENABLED` 默认关闭且只有字符串 `true` 开启，只决定**尚无冻结 turn 的新提案**走 C9 还是 legacy。
- 已有 v1 turn、preview、ActionLedger 和 task 在新 flag 关闭后仍走原 v1 repreview/confirm/cancel/read/result-admission；不会改走 legacy execute 或直接读取 task results。
- 同一会话可安全混合 legacy/v1 消息。原生成 key 仍为 `agent-beta:${sessionId}:${messageId}`，生产 `getIdempotentTaskId` 未改；retry 使用 C7 既有 key。
- 当前 Beta UI 只真实表达单张 AI 服装生图的现有 Grsai 模型、共同比例与 2K/4K。garment detail 的 std-v1/1k、姿势选择、扩展比例或其他缺少业务参数的要求会明确澄清/拒绝，不静默映射模型；有真实历史凭证的单失败镜头 retry 可执行。

## 持久化、幂等与恢复

- 新增 `v1-turns.json`，强写 user/session/clientMessage/message/turn 身份、请求 fingerprint、完整无凭据 `AgentTurnInput`、C9 同算法 inputDigest、createdAt 与 recordDigest。
- 仓储复用治理表的原子写、目录 fsync、同进程跨实例锁及“主文件缺失但有写痕迹”保护；损坏 JSON、表摘要、record/input 摘要、身份移植或 transport credential 均 fail closed，不从 `.bak` 自动回退空记录。
- assistant messageId、turnId、proposalId 由认证 user/session/clientMessage 确定性派生。同 clientMessageId 跨 service/repository 并发只运行一个 C9；completion 已写但会话写回丢失时，新实例从同 inputDigest 回放，模型调用不增加。
- C9/A2 业务时钟固定为持久 turn 的 `createdAt`，使进程在 request 工件与 completion 之间退出后仍能逐字重建 identity evidence 和 ModelRequestSnapshot；Gateway 的审批/意图 TTL 仍使用真实当前时钟。
- repreview 工件已写但 user-file 指针未写回时，GET 在锁外读取最新工件，再按账本保护更新 proposed 指针；已经越过 C7 STARTING 的旧版本不会被晚到编辑撤销。

## 组合根、身份与锁

`lib/server/agent-beta/runtime.ts` 现在注入：

- 持久 `FileTaskPreparationArtifactStore` 与真实四功能 normalizer/availability；
- 每请求 `ApprovalStore`、`createGovernanceGateway`，以及 C7 已批准的 `createLiveTaskAdapter/createLiveVendorActionAdapter`；
- 共享 ActionLedger、C8 post-submit/result-admission/evidence；
- C9 `ToolRegistry/AgentTurnRuntime`、A2 `AgentEventStore`、v1 turn 仓储、本地 B1/B2 确定性观察；
- 独立 `AgentModelAdapter` 与 request-scoped QueryPort。

`authenticate/readAuthenticatedIntent/getSession` 都由每次调用的不可变 `{userId,sessionId,messageId}` 闭包构造，没有全局 `currentUser` 或共享可变认证态。service 在进入 C9/Gateway 前不持 ActionLedger/user-file 锁；Gateway 自己取锁，返回后 service 才重新同步。结果路径锁序保持 **ActionLedger → Beta user file → C8 artifact/approval/evidence**，准入器使用调用方传入的窄 ledger context，不重取同账锁。

Beta 会话仓储按 C8 约定继续保留被撤销结果节点的坐标记录，只在 hydrate 隐藏。service 把刚完成的 C8 安全视图 `visibleNodeIds` 作为非 HTTP、服务端窄上下文交给 C9；triage、P3 task handles、`session.list_nodes` 和同轮 Gateway 查询均看不到 UNKNOWN/QUARANTINED 隐藏节点。ADMITTED 结果可作为新参考；删除、转属或隔离后在模型调用前拒绝。

当前锁仍只保证单一 Node 进程内跨实例串行。C13 沿用项目当前单写进程部署前提；若未来多进程写同目录，必须先另卡实现跨进程事务/租约，不能把现有锁宣称为分布式锁。

## 模型 adapter

- v1 不包装 `invokeFissionPromptPlanner`；`AgentModelAdapter` 直接消费 A2 `recordThenInvoke` 重建的 `ModelRequestSnapshot`。
- OpenAI body 保留 snapshot 的 model/messages/parameters；参数不能覆盖 model/messages。Anthropic 只做协议必需的 system 提升及 `max_tokens` 默认，保留其余内容。
- 每次 invoke 在前置通过后恰好一次 fetch，无自动重试、无 schema 修复第二调用。OpenAI/Anthropic 凭据、endpoint 和 headers 只在 adapter 内；业务结果只返回 assistant 文本中的严格 JSON，不回写 CoT、provider envelope、headers、key、URL 或 raw error。
- 复用 `AGENT_LLM_*`、`AGENT_LLM_ANTHROPIC_*`、`TEXT_LLM_*` 和既有 `IMAGE_PROVIDERS` qiniu 文本 key 回退；OpenAI 只配 key/model 时与旧 planner 一样使用 DeepSeek 默认 base URL。

## 最小前端适配

- v1 编辑显示“更新预览”，不会串联 execute；确认按钮只在当前 prompt 与服务端预览一致、无 blocker 且 `confirmable` 时启用。legacy 编辑确认保持旧协议。
- 保留原生 button/label、中文 IME Enter 防误发和 busy 防重击；新增操作在移动触控可见，只使用现有语义色 token。
- hook 为请求创建 AbortController；用户/会话切换和卸载时 abort 并推进 epoch，响应还需通过 epoch/revision 检查，旧请求不能覆盖新会话。
- poll timer 卸载清理；pending/verifying 和无 plan 的 governed verification 只触发 GET 刷新，从不存在自动 execute/submit 分支。
- task success/partial 本身不显示“已加入画布”；只有 C8 `ADMITTED` 且安全结果数大于 0 才显示该文案。

## Codex A–E 独立审查返工

Codex 只读审查与真实组件取证后提出五项缺口；本轮按固定文件所有权测试先行修复，没有扩大审计或修改 C7/C8/C9 核心：

- **A 真实上传**：旧实现对完整 `AssetRecord` 做 strict canonical，正常内存对象自有 `dataUrl: undefined` 会在观察前失败。新增两态真实消息→C4 回归；旧实现 memory 态失败、JSON 落盘态通过。修复后 CurrentNode 仅投影 node/asset/task 身份与共享 `assetDigest`，不传 dataUrl、源凭据或无关 metadata；没有放宽 canonical 或用 JSON stringify 吞值。
- **B v1 缺账**：旧实现中 `plan.protocol=v1` 但缺 paid ledger 会落入 legacy task/results，同确定 taskId 成功任务和非标准 `historic_node` 可把 plan 改 submitted 并输出 URL。新增 GET/PATCH/send/无 v1 端口/confirm 回归。修复后 v1 协议身份在 legacy 分支前硬保护；确定 task、历史 node/asset.taskId、既有提交状态或查询不可核实时映射 `verifying + confirmable=false`，hydrate 对所有 v1 task 身份只接受本轮 C8 view；confirm 在任何 Gateway 前无锁核对账/task/asset。Codex 复核后又发现 retry 的原 taskId 不等于派生 generate taskId，且 sync 删除 `plan.task` 后仅留在 `resultAdmission.taskId`；新增 node 自带原 taskId、node 无 taskId但 AssetRecord.taskId 带原身份的 GET/PATCH/send+execute 回归。旧实现 6 个子场景均泄漏（父测试 0/7），现将 `resultAdmission.taskId` 同样加入 hydrate 保护后 7/7；真正有 ledger 且 C8 ADMITTED 的 retry 仍只显示本 attempt 安全结果。全新、无任务且 `not_submitted` 的合法 v1 preview 仍可确认，真实 legacy 保持原行为。
- **C 点击版本与 UNKNOWN**：旧 PlanCard 没有把渲染时 identity 传给 hook，hook 会从 `sessionRef` 重算最新版本；`proposed+verifying` 也能构造确认。现在点击携带原 `AgentBetaPreviewIdentity`，hook 与当前 proposal/version/digest 逐字段比较，一致才原样发送；同 message/prompt 的旧卡不能升级 latest。只有 `proposed + confirmable + not_submitted` 可确认，pending/verifying/admitted/quarantined/缺状态均禁确认，UI 状态优先安全核验并只 GET 刷新。
- **D body 超时**：旧 adapter 在 headers 返回后清 timer，注入 60ms body/10ms timeout 时约 62ms 错误成功。现在一个 timer/AbortController 覆盖 fetch、完整 body JSON、assistant JSON 解析；body abort 稳定 `MODEL_ABORTED`，fetch 仍恰好一次，无重试或 raw error。新增用例约 10ms 通过。Anthropic `max_tokens=4096` 已由 production `plannerSelection` 在 A2 前写入 snapshot，未重复修改该契约。
- **E 恢复与过期**：GET 原有锁外 repair 保留，并扩展至 PATCH/add/send/repreview/execute/cancel。安全 PreviewView 用 strict canonical 比较，能发现同版本同摘要的实时 `confirmable` 到期；apply 允许该实时更新，拒绝同版本异摘要及更低版本覆盖。v2 工件/user-file v1 窗口的 GET/PATCH/send、三条同版本 TTL 到期和较高并发版本不降级均有回归；`refreshPreview` 始终在 user-file 锁外。

测试先行实际证据：A/B/E 新增 18 项在旧实现为 **3 通过、15 失败**，修复后 **18/18**；C 旧实现 **4/6**（两项预期失败），修复后 protocol+session 定向 **12/12**；D 旧实现 **13/14**，修复后 **14/14**；B-retry 旧实现 **0/7**，一行身份保护修复后 **7/7**，与 generate 缺账及三条真实 retry 邻接合并 **16/16**。A–E 与首版 C13/C8/Beta 合并定向为 **123/123**。返工后首次全量为 **851/852**，唯一失败是既有 legacy `Promise.allSettled` 测试错误假定固定 contender 获胜；测试改为重试实际 rejected contender，连续 5 次定向通过，加入 B-retry 后完整 **859/859** 通过，未改产品并发语义。

C9 共享上限仍是每 turn 最多 3 次模型调用；本卡只验证在该预算内的 understanding→planning→tool_result 与多工具单次规划，不宣称无限循环或无人确认的自适应任务。

## 本地验证

全部使用本地临时目录和注入外部能力：

| 检查 | Kiro 实际结果 |
| --- | --- |
| C13 协议/仓储/adapter/HTTP/前端状态/真实组合/旧 Beta+C8 定向聚合 | **123 / 123 通过**，0 失败、0 跳过 |
| 真实 C13 组合子集 | 消息→C9 多轮只读；C4 preview/edit v2/stale 拒绝；Approval/C7 pending；C8 ADMITTED/URL 轮换/画布；retry 新窗口；分类/抠图/取消 intent；UNKNOWN；删除/转属/篡改；重启/并发/STARTING 竞态均通过 |
| `pnpm run test:agent` | **859 / 859 通过**，0 失败、0 跳过；C9 的 784 项基线全部保留 |
| `pnpm exec tsc --noEmit --incremental false` | 通过，退出码 0，无输出 |
| 20 个受影响代码/测试文件 ESLint | 通过，退出码 0，无输出 |
| `node scripts/check-agent-architecture.mjs` | 通过，输出“Agent 架构检查通过” |
| build / 浏览器 / 测试站 / 服务器 / 真实外部能力 | 按要求未执行；真实调用数 0 |

实现期间架构守卫曾准确拦截 runtime 直接加载分类/抠图写能力；已改为 C7 live adapter 后全绿，没有修改或放宽守卫。真实 photo TaskParams 的合法可选 `undefined` 也曾暴露整任务 canonical 问题；修复为只冻结 C9 所需任务身份/状态/模型/失败镜头投影，没有放宽 strict canonical。

## 代码与测试变更白名单

基于 `baseline-c13.sourceFiles`，当前 C13 代码/测试变更共 20 个文件：

- 修改：`lib/agent-beta/types.ts`
- 新增：`lib/agent-beta/protocol.ts`、`lib/agent-beta/protocol.test.ts`
- 修改：`lib/server/agent-beta/runtime.ts`、`service.ts`、`service.test.ts`、`validation.ts`
- 新增：`lib/server/agent-beta/v1-bridge.ts`、`v1-service.ts`、`v1-turn-repository.ts`、`v1-turn-repository.test.ts`、`v1-integration.test.ts`、`model-adapter.ts`、`model-adapter.test.ts`、`validation.test.ts`
- 新增：`app/api/beta/agent/sessions/[id]/preview/route.ts`
- 修改：`components/agent-beta/use-agent-beta.ts`、`session-state.ts`、`session-state.test.ts`、`agent-chat.tsx`

另更新本验收记录、C9 验收状态、session handoff、task breakdown 与 `AGENTS.md`。没有修改 Gateway/C9 核心、四个表单、计费、认证或架构守卫。

## 已知限制

- `AGENT_RUNTIME_V1_ENABLED` 仍默认关闭；本地测试通过不表示已开启产品流量。
- 多张执行、姿势自由提示词、garment 专属 std-v1/1k 与扩展比例仍按原 blocker/当前 UI 表达能力硬拦；没有扩大 C6 通用控制域。
- 抠图仅 garment；持久化 cutout session 引用不恢复底层 60 分钟内存会话，过期/重启后不得静默再调供应商。
- 同进程锁不是跨进程锁；启用 v1 时必须保持单写进程。
- 未做真实样本质量、provider 可用性、浏览器、测试站或生产验收；未 build。
- C12 计划卡/轨迹视觉完善尚未开始，本卡 UI 只做安全可用的最小协议接线。

## 待 Codex 独立验收

Codex 应以 `baseline-c13.json` 的 `sourceFiles` 核对候选变化，以 `mainFiles` 保护主目录并保留其 workspace-boundary/协作文档修订；不要用候选旧文档覆盖主目录。建议独立复核：

1. 新 flag/legacy/v1 混合及已有 v1 在 flag 关闭后的 confirm/cancel/read/admission。
2. `messages → C9/B6/A2 → C4 → preview → repreview v2 → stale confirm → Approval/C7 → pending → C8 ADMITTED → canvas` 真实组合，外部端口只替换能力。
3. 同 clientMessageId、completion 后会话写回丢失、跨 service/repository/store、UNKNOWN 与 STARTING edit/confirm 竞态的调用次数。
4. HTTP strict body 与 `agentBetaResponse → requireAgentBetaUser` 身份 scope；body 中 userId/approval/status/budget/origin 必须拒绝。
5. PreviewView 不含完整工件；C8 visibleNodeIds、ADMITTED 复用、隐藏节点/转属/删除/参数篡改与 URL 轮换；缺账 retry 必须同时保护 `resultAdmission.taskId` 中的原任务身份，覆盖 node.taskId/asset.taskId 两态。
6. A2→OpenAI/Anthropic 实际 body、每次一次 fetch、凭据/CoT/raw error 隔离和 qiniu 历史回退。
7. 独立复跑定向、**859 项** `test:agent`、非增量 TypeScript、20 文件 ESLint 与架构守卫。

C13 只有在 Codex 明确验收并集成后才能标记为独立验收通过；本记录不擅自启动 C12。
