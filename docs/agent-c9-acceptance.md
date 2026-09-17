# Agent C9 Turn 主循环核心：Codex 审查修复与 Kiro 本地自测

> **Codex 独立验收补记（2026-09-17）**：已独立审核本卡代码及两轮返工，核对 C8 基线和完整 C9 白名单；候选与主目录分别运行 784/784、非增量 TypeScript、14 个 C9 代码文件 ESLint、架构守卫全部通过，验证期间代码 SHA-256 未变化。14 个代码/测试文件及本记录已按字节集成，保留主目录协作边界修订。原记录的“待 Codex 验收”描述 Kiro 交付时点；当前 C9 已通过本地验收。具体证据见 [开发恢复记录](./agent-resume-progress.md)。产品协议接线仍属于 C13，未执行真实供应商或浏览器产品验收。

日期：2026-09-17。执行契约见 [任务拆分 §2.11 与 C9 卡片](./agent-task-breakdown.md)。前置 C8 已由 Codex 独立验收并集成；本页记录的是 **Kiro 在候选副本完成 C9 实现、Codex 审查问题修复和本地自测**，不代表 Codex 已验收 C9。C9 当前状态仍是 **待 Codex 独立核对、复跑与集成**；在 Codex 明确通过前不得启动 C13/C12。

## 目录、角色与操作边界

- Codex 集成基线/主目录是 `/Volumes/DevDisk/Projects/xinman/dianshang/v0-ai`；Codex 可以在该目录核对、保留主目录已修订文档、按白名单集成并独立验收。
- Kiro 本轮唯一可写候选副本是 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source`。Kiro 没有读取或修改主目录；这只是本轮 Kiro 的运行约束，不是对 Codex 或后续主目录任务的全局禁止。
- Kiro 只读了候选副本父目录中的 `baseline-c9.json`、`c9-codex-review-notes.txt` 和 C8 验收/集成证据。没有访问旧 TMP、`.env`、业务 `data/`、`public/` 生产素材或 Git；没有安装依赖、build、访问服务器/测试站，或调用真实 LLM、分类、抠图、生图 API。
- 本轮没有修改 C4、C7、Gateway 核心、旧 Beta、HTTP、React、认证、系统配置或计费；没有创建分支、提交或 push。

## 范围保持不变

C9 仍只交付可注入的纯业务 `AgentTurnRuntime`：B5 上下文进入 B6/A2 分阶段模型请求，planning 经 C11，逐步重算 C2 前沿并通过 C5/C6；只读工具走 `ReadToolRunner`，分类/抠图/取消只走 `GovernedActionPort`，付费 create/retry 只生成真实 C4 冻结 preview 后停止等待批准。

本轮没有接产品 composition root、HTTP/React/Beta service、产品 flag、C13 协议或 C12 UI；没有签发/接收 `ApprovalReceipt`，没有执行付费生成，也没有把 task 终态当成图片发布真值。C8 `ADMITTED` 仍是后续结果可显示的唯一依据。

## Codex 六项审查问题修复

### 1. 可选 `parameters` 真正省略

旧 `#invokeStage` 总是构造 `parameters: input.parameters`。当调用方合法省略该字段时，B6 在应用默认值前会 strict canonicalize 整个输入，显式 `undefined` 因而在模型调用前失败。

修复后只有字段实际存在时才传给 `buildStagedPrompt`；省略时由 B6 生成正常的空参数对象 `{}`。没有放宽 `canonicalize`、B6 输入检查或 A2 `RequestScope`。新增咨询和 AI 单张创建两条真实 Turn→B6→A2 用例，分别重建磁盘请求并核对 `request.parameters === {}`。

### 2. 四类 feature 的 C4 设置精确投影与冻结控制核对

旧 `generationSettings` 对所有功能都写入 `model/imageRatio/resolution/resultCount`，导致真实 pose schema 因额外 `resultCount` 失败，garment-detail schema 因额外 `model/resultCount` 失败。

现按 feature 精确投影：

| 功能 | 写入 C4 settings 的服务端控制 | 不伪造/不写入 |
| --- | --- | --- |
| `ai-fashion-photo` | `model/imageRatio/resolution/resultCount` | — |
| `photo-fission` | `model/imageRatio/resolution/resultCount` | — |
| `pose-fission` | `model/imageRatio/resolution` | `resultCount` 由真实 pose 列表派生 |
| `garment-detail` | `imageRatio/resolution` | 模型由 `algorithmModelId` 解析，数量由参考图派生，不写 `model/resultCount` |

C4 `prepare` 和 `validatePrepared` 完成后，Turn 还会核对 preview 的 `toolName/featureType/resolvedModelId/estimatedResultCount` 与 C6 冻结 proposal 以及可信 route model 一致；不一致统一 fail closed，不把工件返回为可批准 preview。

新增四类真实 normalizer 的 Turn→preview 矩阵：

- AI 服装单张：1 张、无 blocker；
- photo-fission 两张：只返回 preview，保留 `decision_gate:multiple_results_not_enabled`；
- pose 单姿势：保留自由提示词目标及 `decision_gate:pose_prompt_not_supported`；
- garment-detail `pro-v1`：经注入的确定性服务端模型解析依赖进入真实 normalizer，两张参考图派生 2 个 `detailShots`，冻结专业档位和真实 resolved model，并保留多张 blocker。

另有 pose 数量不一致、garment resolved model 不一致负例。测试中的模型解析器是本地确定性依赖，不访问 provider registry 或真实渠道；生产代码未新增、硬编码或伪造模型映射。

### 3. 诚实 cutout 风险元数据与真实 C10→C2→C5/C6 正例

候选旧实现为绕过 C2 过滤，曾把 `cutout.prepare` 改标成 `external_reversible/local_polling_only`，这会错误暗示已发生的供应商请求可撤销。

修复后元数据恢复为：

- `costClass=vendor_api`
- `sideEffectClass=external_irreversible`
- `approvalPolicy=explicit_user_intent`
- `rollbackCapability=irreversible_after_submit`
- `requiresFreshState=true`

C10 v1 的 route 风险轴仍使用既有 `write_reversible` 粗粒度值；C2 没有泛化允许外部不可逆工具，而是只对同时满足上述完整 metadata、工具名 `cutout.prepare`，以及 C10 的 `intent=edit/costClass=vendor_api/lane=structured_decision/humanGate=none` 组合做窄放行。既有 allowlist、purpose、evidence/mechanical readiness、blocker、配额、C5/C6 和真实意图绑定仍在后续逐层收紧。

新增测试直接使用真实 `routeAgentRequest`、真实 `GOVERNED_TOOL_METADATA` 和真实 `selectToolFrontier`；完整 Turn 再经过 C11、C5/C6、当前 session/owner/assetDigest/intent 绑定后，mock `GovernedActionPort` 恰好收到一次 `cutout_prepare`。回放不再次调用模型或 Gateway。其他外部不可逆工具没有获得通用放行。

### 4. governed 来源只复用共享契约

Codex 笔记记录了 `user_text`/`user_prompt` 漂移风险。实际候选 C8 基线的 `lib/agent/provenance.ts` SHA-256 为 `c25067c7c683ec8a86c716a5be30bfd6ca3e9539ebbf5d1dae9950ededb3b94c`，与 `baseline-c9.json` 完全一致；该共享版本当前使用 `user_text`。本轮没有擅自改共享持久化标签。

`governed-tool-actions.ts` 已删除自建六值 Zod enum，改为对 `origins` 每个 `{field, origin}` 调用共享 `isFieldOriginAllowed`。真实 classify/cutout/cancel 提案测试逐字段核对共享准入，并用静态回归防止 C9 再维护第二套来源词表。因此未来共享契约若按正式迁移方案改名，C9 不再需要同步手改本地枚举。

### 5. cutout completion 合法同源路径、凭据保护与真实仓储回放

本轮开始时，父笔记所述“所有 `/` 开头字符串都被 local-path 正则拒绝”的实现已不在当前候选源码：A2 completion 对自由文本值不做首斜杠误杀，仍按受控字段名拒绝凭据、CoT、原始错误和 `path/filePath/*Path` 等私密系统字段。

本轮补上此前缺失的完整证明：真实 Turn 完成 cutout 后，将 `/api/cutout-sessions/cutout_1/image` 写入真实 `AgentEventStore` completion；新 `AgentEventStore`/Runtime 从磁盘重放同一 URL，且模型/Gateway 总调用数保持一次。该测试不是 completion mock。

Turn 的 cutout 结果投影同时收紧为无 query/fragment 的精确同源路径 `/api/cutout-sessions/<同一编码 sessionId>/image`。带 `?token=...` 的返回在 Gateway 已开始后进入 `action_verification_required`，敏感值不进入 toolResults 或 completion。A2 原有 apiKey/Authorization/rawError/CoT/filePath 拒绝和普通业务文本提及 `/tmp`、Windows 路径、Bearer 的正例均由完整回归保留。

### 6. 主回复改为业务语言且不发布未准入图片

`safeResultSummary`、可信任务状态、规划拒绝、缺有效确认、调用前状态不明和调用后 UNKNOWN 等固定回复已移除 `C8`、`Gateway`、受治理网关、确定性验证器、幂等键、意图凭证、服务端前沿等内部实现名。主回复改为“方案预览待确认”“图片结果完成安全检查后显示”“为避免重复处理不会再次提交”等业务表达；taskId 留在结构化轨迹/结果，不在固定状态主回复中展开。

测试对所有已有 `assertRecorded` Turn 结果统一检查主回复/问题不含内部词。pending/running 仍覆盖模型声称“已生成/可下载”的话术；UNKNOWN 仍不重提；任何 task status 都不会自行发布图片 URL。

## Codex 后续复核新增两项修复

Codex 在辅助只读审查后亲自复现了以下两项缺口；Kiro 只在当前候选副本按窄范围测试先行修复，没有采纳“已有 pending 任务应放开抠图”等未授权建议，既有 C10 `task_in_progress` 策略保持不变。

### 7. 非 garment 抠图在 Gateway 前拒绝

真实 C7 当前只支持 `garment`，但 C9 binder 原 `cutoutSceneSchema` 仍接受 `person/product`，导致不支持场景进入 Gateway 后才失败并被误呈现为 `action_verification_required`。

修复后 binder 使用 `z.literal('garment')`。`person/product` 在 scene 解析阶段、任何 Session/Asset 查询和 `GovernedActionPort.execute` 之前以 `invalid_input` 拒绝；Turn 映射为 `tool_execution_failed + status=stopped`，而不是“调用状态待核实”。真实 C10→C2→C5/C6 Turn 测试核对 `garment` 恰好一次 mock Gateway，`person/product` 各零调用。C7 原有拒绝逻辑未改。

### 8. 父目录别名共用物理 turn lock 身份

`AgentEventStore` constructor 的 `path.resolve` 只规范化词法路径；当 `real/store` 与父目录 symlink `alias/store` 指向同一物理目录时，旧 `withTurnLock` 使用两个字符串作为不同 key，完整 Turn 可以并发执行两次。

修复后 `withTurnLock` 在进入共享锁前，先单独通过既有 `guarded(() => safeDirectory([]))` 完成根目录创建、`lstat` 安全检查和 `realpath` 解析，再用物理根与 user/session/turn scope 组成锁 key。业务 callback 留在 `guarded` 外，因此其原始异常传播语义不变；直接把 store 根本身设为 symlink 仍被 `lstat` 拒绝为 `UNSAFE_PATH`。

新增真实父目录 alias 测试验证临界区 `maxActive=1`；跨 alias 的两个 Runtime 对同一 turn 一次真实执行、一次 completion 回放，模型和 mock Gateway 各调用一次。该锁仍只承诺同一 Node 进程，不是跨进程分布式锁。

## 测试先行与修复记录

测试全部使用临时目录、合成 Task/Asset/Session、本地真实 normalizer 和模拟模型/Query/GovernedActionPort；不读取业务数据，不调用真实外部服务。

1. **先只改测试运行旧生产实现**：三文件套件共 76 项，**39 通过、37 失败**。失败实际覆盖：省略 `parameters` 的咨询/创建；pose/detail 的真实 C4 链路；诚实 cutout metadata；共享来源校验；内部用户文案；带查询串 cutout URL。AI 单张与 photo 两张真实 C4 正例当时仍通过，证明夹具没有整体失效。合法无查询串 URL 当时已能写入 A2，确认首斜杠误杀属于已局部修复项。
2. **生产修复后首次复跑**：**73/76 通过**。仅余两个子用例因新增测试错误地把 `messageId` spread 进严格 A2 `RequestScope` 而报 `UNSAFE_PATH`；修正测试只传允许字段，没有放宽 schema。
3. **同一套件最终**：**76/76 通过**。
4. **扩展 C9/A2/B6/C10/C2/C4/C5/C6 定向**：10 个测试文件，**274/274 通过**，0 失败、0 跳过。
5. 第一次并行最终检查仅有新增测试的 TypeScript 联合类型推导报 3 个错误；显式声明场景类型和闭包收窄后修复。生产代码没有因此放宽类型或 schema。
6. **Codex 后续两项缺口先只加测试**：event-store/governed/turn 三文件共 90 项，**86 通过、4 失败**。失败为 person/product binder 未拒绝、真实 Turn 错误进入 Gateway、父目录 alias `maxActive=2`、跨 alias Runtime 重复执行并产生 completion `RECORD_CONFLICT`。
7. **两项最小生产修复后同套件**：**90/90 通过**，0 失败、0 跳过；garment 恰好一次，person/product 各零 Gateway，父目录 alias `maxActive=1`，跨 Runtime 模型/Gateway 各一次。

## 最终本地验证

| 检查 | Kiro 最终实际结果 |
| --- | --- |
| 三文件首轮审查回归 | **76 / 76 通过**，0 失败、0 跳过 |
| Codex 后续两项三文件回归 | **90 / 90 通过**，0 失败、0 跳过 |
| 扩展 Turn/A2/B6/router/C2/C4/C5/C6 定向 | **274 / 274 通过**，0 失败、0 跳过 |
| `pnpm run test:agent` | **784 / 784 通过**，0 失败、0 跳过；780 项基线全部保留，新增 4 项 |
| `pnpm exec tsc --noEmit --incremental false` | 通过，退出码 0，无输出 |
| C9 当前 8 个受影响 TypeScript 文件 ESLint | 通过，退出码 0，无输出 |
| `node scripts/check-agent-architecture.mjs` | 通过，退出码 0，输出“Agent 架构检查通过” |
| build / 测试站 / 服务器 / 真实供应商 | 按要求未执行 |

ESLint 文件：

- `lib/server/agent/turn.ts`
- `lib/server/agent/turn.test.ts`
- `lib/server/agent/action/governed-tool-actions.ts`
- `lib/server/agent/action/governed-tool-actions.test.ts`
- `lib/server/agent/action/tool-frontier.ts`
- `lib/server/agent/action/tool-frontier.test.ts`
- `lib/server/agent/observability/event-store.ts`
- `lib/server/agent/observability/event-store.test.ts`

## 本轮变更文件

产品与测试共 8 个文件：

- `lib/server/agent/turn.ts`
- `lib/server/agent/turn.test.ts`
- `lib/server/agent/action/governed-tool-actions.ts`
- `lib/server/agent/action/governed-tool-actions.test.ts`
- `lib/server/agent/action/tool-frontier.ts`
- `lib/server/agent/action/tool-frontier.test.ts`
- `lib/server/agent/observability/event-store.ts`
- `lib/server/agent/observability/event-store.test.ts`

另更新本验收记录 `docs/agent-c9-acceptance.md`。没有修改 C4/C7/Gateway/Beta/HTTP/React 或主目录中 Codex 已修订的协作文档。

## 已知限制与未解决项

- C9 仍没有产品入口；本地通过只证明纯业务内核、真实本地 normalizer 接线和安全边界，不证明 C13 协议、C12 UI 或线上流程可用。
- C6 现有 `ServerBindingContext.generation` 仍是此前的通用服装控制域。本轮按审查要求验证共同合法比例与 `2k`、`pro-v1` 路径，没有扩大 photo/pose 的扩展比例集合或 garment `std-v1/1k` 控制类型。若 C13 要暴露这些功能特有选项，应另行把 C6 改为按 feature 判别的服务端控制契约并独立验收；本轮未越界修改 C6/C7。
- C10 v1 route 的风险词表仍是粗粒度 `read_only/draft/write_reversible`；供应商不可逆真值由 tool metadata 精确保存，C2 只对完整 cutout 组合窄放行。Codex 应独立确认该窄放行没有扩大其他工具前沿。
- C9/C7 当前抠图只支持 `garment`；`person/product` 仍是结构预留并在 C9 binder 前置拒绝，不能据此宣称这些场景已可用。
- `withTurnLock` 只保证同一 Node 进程、同一物理目录（包括父目录别名）跨实例串行，不是跨进程分布式锁。C13 必须保持单写进程，或先另卡实现事务/租约。
- 测试使用合成素材和确定性依赖；未做真实服装样本、图片质量、浏览器、测试站、provider 可用性或外部额度验收。
- 未 build。按项目约定，只有准备测试站/生产发布时才能执行 build。

## 待 Codex 独立验收与集成

Codex 需在主目录保留其已修订的 `AGENTS.md`、workspace-boundary、session-handoff、task-breakdown 和 C8 文档，只按本轮白名单集成候选产品/测试文件及本 C9 验收记录；不得用候选副本旧文档覆盖主目录修订。

建议独立核对：

1. 以父目录 `baseline-c9.json` 核对变化白名单与 SHA-256；确认没有 C4/C7/Gateway/Beta/HTTP/React 越界修改。
2. 复现省略 `parameters` 的咨询与 create 请求工件，确认 A2 重建参数为 `{}` 且 strict canonical 未放宽。
3. 独立跑四类 Turn→真实 C4 preview，核对模型、数量、blocker、参考图输出位和 pose 自由提示词限制。
4. 检查 cutout metadata 为外部不可逆，真实 C10/C2 前沿仍只在明确意图下开放；`garment` 恰好一次 Gateway，`person/product` 在查询/Gateway 前以 `tool_execution_failed` 拒绝，且 C10 `task_in_progress` 未放宽。
5. 用真实父目录 symlink alias 复跑 EventStore 临界区与跨 Runtime 单飞；确认物理目录共用锁、直接 store 根 symlink 仍拒绝、业务 callback 异常不被包装。
6. 检查 governed origins 没有第二套枚举，逐字段只调用共享来源准入。
7. 检查合法 cutout URL 可持久化/回放，query/fragment/错 session/cross-origin/凭据字段不能进入 completion。
8. 检查固定主回复不暴露内部实现名，pending/running/unknown/仅任务终态仍不发布图片。
9. 独立复跑定向、`test:agent`、非增量 TypeScript、受影响 ESLint 和架构守卫。

在 Codex 明确验收并集成前，C9 仍不得标记为独立验收通过，也不得启动 C13/C12。
