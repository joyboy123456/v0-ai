# Agent C8 post-submit / result-admission 本地自测

> **状态补记（2026-09-17）**：C8 随后已由 Codex 独立验收并集成主项目。当前核对 19/19 集成文件摘要、C9 开工基线及原始 698/698 主目录测试日志均相符；下文“待 Codex 再次验收”保留为当时 Kiro 自测阶段记录。本次没有重新运行测试，证据与工作区角色见 [工作区边界](./agent-workspace-boundary.md)。当前待审核的是候选副本中的 C9。

日期：2026-09-17。执行契约见 [任务拆分 §2.11 与 C8 卡片](./agent-task-breakdown.md)，前置批次见 [B6/C7/C11 验收](./agent-b6-c7-c11-acceptance.md)。Codex 第一轮独立运行当时的 671/671 测试后提出四条真实路径，第二轮核对首轮修复后又补充一个历史 attempt 并发完成正例，随后指出真实 photo-fission normalizer 可选 `undefined` 在 result-admission 快照中的最后一处兼容问题；Kiro 均已按审查原文完成测试先行修复和统一自测。本记录只表示 **Kiro 已修复并完成本地自测**，当前仍待 Codex 再次独立核对，不能写成 Codex 已验收。C8 再验收通过前不启动 C9/C13/C12。

## 范围与未做事项

本轮只实现 C8 的同步 post-submit、异步 result-admission、必要的重试执行历史、Gateway/Beta 刷新接线、测试与开发文档。没有实现 C9 主循环、C13 完整 HTTP/客户端协议或 C12 UI；没有改四个既有表单、幂等 taskId 算法、认证、供应商选择或积分体系。

本次最终验收仅在持久隔离副本 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source` 完成，未访问旧 TMP 或原项目。Codex 对既有开发文件的逐字迁移、既有 `node_modules` 复制以及 tsconfig/components/Zod 依赖恢复均属于环境恢复，不是产品变更；`KIRO_ENVIRONMENT_NOTICE.md`、父目录 baseline/迁移清单/运行日志也不属于产品交付，均未集成。没有安装或升级依赖、build、访问测试站/服务器、提交/push，产品链路没有调用真实 LLM、分类、抠图或生图供应商。

## Codex 第一轮独立验收返工

四项缺口均先新增回归、确认旧实现失败，再修改生产代码：

1. **签名 URL 轮换**：旧实现把 `AssetRecord.fileUrl` 放入 admitted `resultDigest`，同资产只换签名即被永久隔离。新摘要 v2 使用共享 `assetDigest` 与有序 asset/shot 绑定，不含 URL；每轮仍校验 URL 安全，返回最新已鉴权 URL。旧实现目标测试实际为 `QUARANTINED`，修复后为 `ADMITTED`。
2. **历史 generate/retry 状态**：补单张 generate 失败空结果 → retry 成功，以及连续两次 retry 的 2/3 条独立 ledger、工件、审批和 post 证据。历史轮使用自身已强写终态和相邻 `priorResultAssetIds` 窗口，不被共享 task 后来的 success 重解释；latest success 缺图、超额、错 shot、错 baseline 仍隔离。C7 联调验证同 task 的 generate/retry 两条 ledger 均 ADMITTED 后结果才可再引用。
3. **Beta retry 发布**：`syncTasks` 不再为 retry 推导 generate key/taskId；按唯一可信 user/session/message/actionKind ledger 取 retry 原 key 与原 taskId，只消费精确匹配的 ADMITTED decision。旧实现测试实际没有新增 retry 图，修复后只发布本轮新 shot，旧图、外部记录和歧义 ledger 均不发布；另有真实 C8 核心 → Beta retry 联调。
4. **所有 session 返回入口**：PATCH、sendMessage、create/get/add/execute/cancel 均在已有 ActionLedger → user file 锁内重新建立本次安全视图后 hydrate，不缓存放行、不重取 ledger。旧实现中 PATCH/sendMessage/并发响应会丢已准入节点；修复后保留，撤销/UNKNOWN/QUARANTINED 即时隐藏。

另新增 Task/Asset 查询对象即时复制、双轮重读与最终 task 复核；测试在 await 间修改 task.results 或已读 Asset owner 时均 fail closed。保留 `taskStatus` 缺失与 `null` 的 canonical 比较修复，未引入 `__c8RequestDigest` 或其他内部字段污染。

## Codex 第二轮并发返工

Codex 复核首轮四项修复后，只追加一个确定性并发缺口：历史 ADMITTED attempt 查询自身结果期间，后续已批准 retry 合法完成、追加新窗口并改变共享 task aggregate status，旧的全任务快照比较会误写永久隔离。

- 测试先行：新增正例在旧实现下 `result-admission` **68/69**，唯一失败原因实际为 `task_snapshot_changed_during_result_admission`。
- 修复：以 `actionAdmissionFacts` 替代全任务快照全等。共同事实绑定 task 归属、feature、input、params 和冻结执行控制；action 事实绑定 matching attempt、自身 candidate asset/shot、相邻下一 `priorResultAssetIds` 边界。只有 latest attempt 绑定共享 status 与顶层 request/key。
- 三轮 Task 查询仍各自执行 `inspectTaskBinding`、`candidateResults`、`validateCandidateScope`，所以整体 results/resultAssetIds 一致唯一、全部 attempt baseline、批准 shot/张数、owner/参数/控制变化仍 fail closed；并未删除整体校验或资源重查。
- 并发完成后旧/新 retry 均保持 `ADMITTED + PASSED_PRE`，各自只返回自身窗口；latest 的缺图、超额、错 shot、错 baseline 及资产转属负例继续隔离。
- Beta 增加真实 `PoseFissionParams`（无 `userPrompt/prompt` 字段）回归，GET、PATCH、sendMessage 均逐字保留原非空 `plan.prompt`；现有生产字符串条件保护无需再改。

## 最后一处可选参数兼容修复

Codex 最后发现 `actionAdmissionFacts.common.params` 若直接保留 `task.params`，真实 dress/suit normalizer 的合法内存态会携带 `pantsMainHandVisibility: undefined`，严格 canonical 在三次任务快照比较时拒绝；同一参数经 JSON 往返会省略该字段，而 A1 已定义二者摘要语义相同。

- `result-admission.ts` 现在只复用共享 `paramsDigestPayload(task.featureType, task.params)` 构造 action 参数事实；没有复制 photo/pose/garment 可选字段清单，也没有使用 `JSON.stringify` 丢弃任意非法字段。
- `contracts.ts` 的 `canonicalize` 未放宽，仍拒绝未声明 `undefined`、函数、非有限数、访问器、非普通对象和稀疏数组；只有 `paramsDigestPayload` 明确声明的可选字段会补 `null`。
- 真实 dress/suit 原始 normalizer 内存态与 JSON 往返态在同一次准入的多轮 task 查询中均保持 `ADMITTED`；真实参数变化、必需 `imageRatio: undefined` 及其他非 JSON 输入仍由共享摘要/strict canonical 拒绝或隔离。
- 持久环境定向复跑为 72/72；无需追加代码或夹具修复，既有历史窗口并发、latest/owner 篡改、URL 轮换和 Beta 返回路径均由后续完整回归保留。

## 接口、状态与时序

- `PostSubmitPort.postSubmit()` 只接收已经过 C7 验证的付费冻结动作、治理 key、预期 taskId、真实 approvalDigest 和命令返回 task。它重查原版本工件、历史审批原件、task identity/owner/feature/params/input 顺序、冻结模型/模板/assetDigests/requestDigest/idempotencyKey 与 attempts。
- Gateway 的付费命令返回后顺序固定为：**C8 证据强写 → ActionLedger 更新/强写 → 返回提交结果**。pending/running 是合法已提交状态，不要求此时存在最终图片。
- post-submit 不匹配写 `BLOCKED_POST_SUBMIT + QUARANTINED`，保留 UNKNOWN/POSSIBLE 债务和证据；不退款、不删除任务/资产、不自动重提。
- `ResultAdmissionPort.admitResults()` 只接当前服务端认证的 userId/sessionId 和调用方已经持有的 `LockedResultAdmissionLedger`。实现只持有 Task/Asset 查询、历史工件/审批读取和 C8 证据仓储，不持有 TaskCommand、provider 或 billing capability，也不自行获取 ActionLedger 锁。
- 结果处理顺序固定为：**当前 Task/Asset 与历史证据核验 → C8 准入/隔离证据强写 → ActionLedger 强写 → 返回安全视图**。任一强写失败均抛错，不发布旧安全结果。

## 持久化与兼容

- 新增 `result-admission-evidence.json`，复用 `DurableGovernanceTable` 的摘要、原子写、目录 fsync、同进程跨实例锁和“缺主文件但有写痕迹”保护。证据只保存治理身份、摘要、真实状态、reason code 和结果 assetId，不保存 URL、prompt、receipt、凭据或无关用户内容。
- `ApprovalEvidenceStore` 只读 `approvals.json` 中真实历史回执，按原 action 与 approvalDigest 核验；不检查当前 latest/30 分钟 TTL，不签发或补造审批。因此提交后即使 preview 过期或产生新版，也仍核验原批准版本。
- 新任务在 `GenerationTask.agentExecution.attempts` 记录 generate/retry 的 actionKind、requestDigest、idempotencyKey、shotIds、attempt 和有序 `priorResultAssetIds`。retry 启动前拒绝损坏、错序或重复的结果基线；旧任务允许没有 attempts，只追加当前真实 retry，不从顶层字段或 `shotProgress.retryAttempt` 补造历史。
- JSON store 与 Local TaskRepo row 保留 attempts；旧顶层 agentExecution 字段继续读写兼容。原生成 key `agent-beta:${sessionId}:${messageId}` 与 `getIdempotentTaskId` 未改变。
- legacy 记录仍走旧读取/同步逻辑且不补造 approval；所有 v1 记录在关闭新提案路径或缺 C8 端口时仍保持保护，不降级读取 `task.results`。

## 结果准入规则

- UNKNOWN/STARTING/VERIFYING、`BLOCKED_POST_SUBMIT`、`BLOCKED_RESULT`、既有 QUARANTINED 均不能仅凭 task success 解禁；任务缺失或查询不可验证保持/转 UNKNOWN，不重提。
- pending/running 的发布结果恒为空。终态要求 `results[].assetId` 与 `resultAssetIds` 有序一致且唯一，并核验批准张数、shot 范围和任务真实状态。
- success 必须有完整批准结果；partial/failed/cancelled 可以发布合法已完成子集，但返回的 taskStatus 保持真实，不能伪称整个任务成功。
- retry 通过 attempts 的相邻 `priorResultAssetIds` 窗口只选择本次批准新增结果；原任务旧成功图不能冒充本轮结果。
- 每个候选结果重新查询当前 AssetRecord，核验 owner/taskId、安全 URL、图片类型、文件名和尺寸。发布 URL/downloadURL/fileName/width/height 只来自该 AssetRecord，忽略供应商 ResultAsset 中的 URL 和尺寸。
- ADMITTED 也在每次轮询重查；合法签名 URL 轮换不改变不可变结果摘要，并返回最新安全 URL。任务/资产删除、转属、URL 变为不安全、尺寸/不可变身份或有序 result/shot 绑定变化后写 `BLOCKED_RESULT + QUARANTINED`，之后不再返回结果。

## Gateway 与 Beta 接线及锁顺序

- `createGovernanceGateway` 将 `PostSubmitPort` 设为必需依赖。C7 的 `withCurrent + STARTING` 线性化、原幂等身份、单张/Grsai-only/模板与 blocker 规则保持不变。
- `AgentBetaRepository.withExecutions` 将当前已持锁的 ledger entries/save 作为窄上下文交给 service；没有第二次获取 ledger。
- `syncTasks` 对 legacy 保持原行为；对 v1 先调用 result admission，pending 不加节点，终态只消费 `ResultAdmissionDecision.results`。hydrate 要求本次安全视图精确匹配 taskId+assetId，并使用其中的安全字段；历史持久化节点不能绕过。
- 实际锁顺序为 **ActionLedger → Beta user file → C8 artifact/approval/evidence**。当前锁与其他治理仓储一样只保证单 Node 进程内跨实例串行，不宣称多进程分布式互斥。
- Beta runtime 仅向准入器注入 `getTask/getAsset` 只读查询及文件型历史证据，不注入 create/cancel/provider。

## 测试覆盖

测试使用临时目录、Map/模拟依赖和合成记录，不读取业务 data、不调用真实供应商。覆盖：post-submit wrong task/owner/feature/params/input/model/template/credential；真实 dress/suit normalizer 原始可选 `undefined` 与 JSON 往返混合查询、真实参数变化及 strict 非 JSON 拒绝；历史审批过期与新版 preview；跨用户；pending/running 无结果；结果错序、重复、超额、wrong shot、unsafe URL、资产 owner/task/尺寸/文件名；合法签名 URL 轮换；generate 失败→retry 成功、连续 retry 及后续 retry 在历史窗口查询期间完成；真实 C8→Beta retry 仅发布新 shot；真实 Pose 参数 GET/PATCH/send prompt 保留；PATCH/sendMessage/addAssets/execute/cancel/GET 安全视图；跨 await Task/Asset 变化；partial/failed/cancelled；unknown/既有隔离不可解禁；任务缺失；证据损坏与强写失败；并发轮询/跨实例；ADMITTED 后资源变化；旧 Beta 兼容及不上画布。

当前已执行：

| 检查 | Kiro 实际结果 |
| --- | --- |
| `node --import tsx --test lib/server/agent/governance/result-admission.test.ts` | **72 / 72 通过**，0 失败；含 dress/suit 两个子用例、历史窗口并发、篡改与 URL 轮换 |
| `pnpm run test:agent` | **698 / 698 通过**，0 失败、0 跳过；此前 695、693、Codex 首轮 671 及更早 601 项均未删减 |
| `pnpm exec tsc --noEmit --incremental false` | 通过，退出码 0，无输出 |
| `pnpm exec eslint lib/server/agent/governance/result-admission.ts lib/server/agent/governance/result-admission.test.ts lib/agent/contracts.ts lib/agent/contracts.test.ts` | 通过，退出码 0，无输出；首轮全部 15 个受影响文件也已通过 |
| `node scripts/check-agent-architecture.mjs` | 通过，退出码 0，输出“Agent 架构检查通过” |
| 第二轮 result-admission + Beta 定向 | **109 / 109 通过** |
| 首轮 C8 core/Gateway/Beta 定向联调 | **143 / 143 通过**，含真实 C8→Beta retry 与 C7 两 ledger 再引用 |
| 测试先行旧实现红灯 | 第二轮并发 68/69（唯一预期失败）；首轮 core 65/68、Beta 34/38 |
| build / 测试站 / 真实供应商 | 按用户要求未执行 |

## 协作与模型记录

本轮由 kiro-cli / Kiro 唯一编码，Codex 只负责独立审核与验收。主会话先固定接口和文件所有权；首版并行派三个互不冲突的内置子 Agent，Codex 第一轮四项返工并行派两个 Kiro 子 Agent，第二轮并发返工由一个 Kiro 子 Agent测试先行完成，主会话均逐文件复核并统一验收。主会话及所有子 Agent 均使用 `gpt-5.6-sol`；子 Agent 工具调用本身没有 `effort` 参数，但用户提供的 root 运行日志已证明本轮主会话和各子 Agent 实际 effort 均为 max。本轮没有调用 Claude、Grok 或其他外部编码 CLI。

## 已知限制与待审核项

- C8 只是安全内核和最窄 Beta 刷新接线；完整 v1 消息/预览/重试协议仍属于后续 C13，不能把当前模块自测当作产品已上线。
- 同进程锁不等于跨进程锁；部署仍须保持单写进程，或在后续设计真正的跨进程事务。
- Task/Asset 查询没有共享仓储事务锁；当前通过入口即时复制、双轮资产读取和多次任务重读对测试覆盖的跨 await 变化 fail closed，并在每次轮询继续重查，但不宣称绝对消除最终重读到证据写入之间的理论 TOCTOU 窗口。
- 未做真实服装样本、浏览器、测试站或供应商验收；本地测试不能证明真实图片质量与外部服务可用性。
- Codex 仍需独立检查：基线未被回退、所有变更在用户白名单内、证据与 ledger 写入顺序、锁无重入、v1 不从 task.results 旁路、旧 key/taskId 算法未改，以及最终统一命令的原始结果。
