# B6 / C7 / C11 本地验收

日期：2026-09-17。执行契约见 [任务拆分 §2.11](./agent-task-breakdown.md)，上一批见 [B5/C3/C4 验收](./agent-b5-c3-c4-acceptance.md)。本轮继续只在本地开发，没有启用新主循环、同步服务器、运行生产 build、提交或发布。

## 交付

### B6 分阶段 Prompt

- `reasoning/staged-prompts.ts` 的 `buildStagedPrompt` 组装理解、规划、工具结果三个阶段，各自有独立 `promptVersion`。
- 静态系统指令与动态 JSON 数据分离，完整保留 B5 的 P0，不因长度裁剪目标、约束、任务状态或失败证据。历史 system 消息、图片文字、观察 notes 和工具文本不提升为系统指令。
- 观察保留来源并标为弱信号；未知或未检测不能当作不存在。不再声称完全没有视觉能力，也不将观察当作已验证事实。
- 输出为 A2 `ModelRequestSnapshot`，由后续主循环通过 `recordThenInvoke` 先强写、重建再调模型；本模块自身无模型调用。测试覆盖真实临时 EventStore 请求重放。

### C7 Gateway PRE / TOOL

- `FileTaskPreparationArtifactStore` 提供原子写入、文件/引用摘要检查和当前预览版本查询。重启后可重放已保存工件；新版本使旧版本批准失效。损坏、缺失主文件但有写入证据均拒绝，不回退空账。
- `ApprovalStore.issueApproval` 只接 `proposalId/version/paramsDigest`，从当前认证作用域和服务端工件签发回执；`issueIntent()` 只读取组合根注入的当前真实用户意图。模型提供的 receipt 或 consent 不能获得授权。
- `createGovernanceGateway` 重查认证身份、会话成员、素材归属/摘要、冻结工件、模型/模板/参数、全部 blocker、单张限制、日次数、全局活动/未知任务、队列及内容策略。钩子异常或修改状态均失败关闭，检查后再次核对执行输入。
- 生成沿用 `agent-beta:${sessionId}:${messageId}` 及原 `getIdempotentTaskId` 算法。重试绑定原任务与 attempt；同身份不同完整请求摘要冲突。真实调用前强写 `STARTING/POSSIBLE`，成功提交后写 `SUBMITTED/CONFIRMED`；调用后的不确定异常保留 `UNKNOWN/POSSIBLE`，重复确认不重提。
- 分类、服装抠图、取消和重试都有动作适配。分类每轮最多 2 次，抠图最多 1 次；已完成的供应商结果持久化用于重放。分类失败返回 fallback/null，不伪造确定分类。抠图地址只输出同源代理；当前仅支持 garment scene。
- `task-adapter.ts` 只消费经过准备验证的工件，重查当前功能/模型和执行器支持的模板；历史模板证据仅取原参数或 `agentExecution`，不用当前模板常量补造历史。
- `task-store` 抽出私有 `createNormalizedTask`，旧表单仍先 normalize；Agent 的新 `createPreparedTask/retryPreparedShots` 保留原参数、模型、seed、分镜与选中镜头，落盘后才调度。`cancelPreparedTask` 强写取消状态。
- `GenerationTask.agentExecution` 持久化冻结执行身份。photo-fission 的服务端 `preparedPlan` 路径跳过 Planner；旧表单缺省行为不变。旧恢复器忽略 Agent 中断任务，旧重试/变体入口拒绝绕开治理链。
- 没有新增金额预估、积分账、预扣、换算、退款或 billing 依赖。原 `creditsCost/creditsUsed` 仅兼容保留。

### C11 结构化计划与确定性验证

- `validators.ts` 严格解析 AgentPlanDraft，封闭 validator registry，重算所有模型 status。重复/复合命题、缺失/循环依赖、失效证据与控制来源均拒绝；failed 沿依赖传播。
- 冻结预览检查完整请求与引用摘要、参数、素材、身份、有效期和 blocker；即使模型省略 verify claim，也不能隐藏服务器预览的阻断项。
- `plan-adapter.ts` 仅在显式 `legacy_v0` 模式做旧 schema 适配，同时返回必须记录的 telemetry；结构化解析失败不会静默回退。适配后的旧计划仍需重新验证。
- 验证结果始终 `authorization: 'not_granted'`；计划通过不代表用户批准或可以提交。不保存模型思维链。

## 并发与独立审查

- 按交接要求实际启动本机 Claude Code / `qwen3.8-max` 与 kiro-cli / `gpt-5.6-sol`，使用不含 .env、data、生产素材和 Git 的隔离源码副本，并记录输入摘要及文件白名单。
- Claude 指定模型约 8 分钟没有返回源码或 stdout，终止后退出 143；诊断包含 `unrecognized_model`，只能确认本次无响应，不能断言模型永久不可用。B6 由内置子 Agent 接手。
- kiro 已列出 gpt-5.6-sol，但默认引擎与显式 V2 两次设置模型均返回 `Method not found`，未产生代码；停止调用，C11 由内置子 Agent 接手。没有更换模型或修改认证。
- B6/C11 集成仅限各自白名单文件，核对主目录并发变更；C7 Gateway 由内置子 Agent 实施，主 Agent 负责真实任务适配、独立测试、集成与文档。
- 主审补修了旧版本批准未失效、生成幂等身份变化、钩子期间状态变化、旧模板不可执行、冻结任务绕过旧恢复/重试、引用摘要和复合命题遗漏等问题。

## 验收记录

验收结论：**本地通过**。

| 检查 | 结果 |
| --- | --- |
| `pnpm run test:agent` | **601 / 601 通过**，0 失败、0 跳过 |
| B6 定向测试 | 14 项通过 |
| C11 定向测试 | 66 项通过 |
| C7 Gateway / 工件 / 审批定向测试 | 47 项通过 |
| C7 真实任务适配与执行边界独立测试 | 24 项通过 |
| 旧任务恢复兼容测试（统一入口之外） | 7 项通过 |
| `pnpm exec tsc --noEmit --incremental false` | 全项目通过 |
| 本轮 21 个实现/测试文件 ESLint | 通过 |
| AST 架构检查 / `git diff --check` | 通过 |

测试使用临时目录、合成记录和注入依赖；执行边界测试运行真实 task-store / pipeline / Local TaskRepo 源码，替换外部能力与数据根，不读取业务数据。应用内真实 LLM、分类/抠图与图片供应商请求为 0；外部编码 CLI 调用不计为产品链路调用。

最终日志：`/tmp/agent-b6-c7-c11-final-tests.log`、`/tmp/agent-b6-c7-c11-final-typecheck.log`、`/tmp/agent-b6-c7-c11-final-lint.log`。

外部 CLI 隔离及摘要审计：B6 位于 `/var/folders/bx/36wkb52d7tj7yjvhf4nq7nr40000gn/T/agent-b6-qwen-gsl8682c/`，C11 位于 `/var/folders/bx/36wkb52d7tj7yjvhf4nq7nr40000gn/T/agent-c11-l0nn4o43/`；原始日志仅保留本地。

## 后续边界

- 这三张任务卡是本地模块验收，不等于完整产品已上线。下一批为 C8 → C9 → C13 → C12；C8 仍须完成提交后及异步结果准入，C13 才接 HTTP/会话/最小客户端协议。
- 本轮没有将新 Gateway 接入旧 Beta 主循环，也没有开放结果上画布；生成提交后账本仍为 `resultAdmission=PENDING`。
- 当前存储锁保证同一 Node 进程内多个实例串行，不保证多进程分布式互斥。部署接线不能据此启动多个写进程。
- 多张和姿势自由提示词 blocker 继续硬拦。photo-fission 新生成最少两张，故在单张批准基线下仅能预览；有完整证据的单失败镜头重试可走受治理链路。
- 抠图底层会话仍为 60 分钟进程内数据。持久化返回引用不意味着重启后恢复了抠图会话；后续 UI/路由须处理失效会话，不能自动再次调用供应商。
- Agent 中断任务保持待核实，不自动调用供应商恢复；人工核实/安全恢复属于后续接线。历史失败任务重试仍须真实模板凭证及新批准。
- 后续发布继续遵循 [AGENTS.md](../AGENTS.md) 的测试站验收与生产发布流程。
