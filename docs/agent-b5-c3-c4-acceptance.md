# B5 / C3 / C4 并发开发与统一验收

2026-09-17。本批继续本地开发，执行契约见 [任务拆分 §2.11](./agent-task-breakdown.md#211-a0-评审冻结记录2026-09-16)。**B5、C3、C4 已完成本地统一验收**。

## 分工与隔离

| 执行者 | 任务 | 工作范围 |
| --- | --- | --- |
| Claude Code / qwen3.8-max | B5 上下文分诊及测试 | 独立源码副本的 context-triage 文件 |
| kiro-cli / 已确认默认 gpt-5.6-sol | C4 生成与重试预览 | 独立源码副本的 preparation 文件 |
| 内置子 Agent | C3 查询工具与冷数据鉴权 | 主目录独占 read-tool-runner 文件及只读端口 |
| 主 Agent | 接口协调、独立审查、集成、验收 | 共享 handle 契约、seed 注入、独立测试、文档 |

外部副本只包含源码、指定设计文档和只读依赖链接，不包含 .env、业务 data、生产素材或 Git。按文件摘要核对基线与白名单后集成。主 Agent 增加的服务端 seed 接口同步到副本时另存基线更新记录。无分支、提交、构建或发布操作。

## 验收重点

- B5：50 节点、100 消息下仍完整保留当前目标、约束、任务状态及失败证据；P3 仅包含有用户/会话范围的 handle。
- C3：strict 输入、跨用户与跨会话同 404、资源当前归属重查、观察摘要与有效期校验；分类不进入免费 runner。
- C4：四种功能均可准备冻结预览；同 proposal/version 重放摘要稳定；拒绝参数篡改、素材变化和模型静默切换；重试绑定原任务、失败镜头及轮次。
- 真实生图请求为 0；只记录结果张数及风险，不新增计费或供应商金额预估。

## 主审记录

- 基线完整回归 357 / 357 通过，全项目类型检查通过。
- 裤装原归一化每次随机抽 seed；新增仅服务端可注入的第四参数，固定后分镜与参数摘要一致，旧表单保持原行为。两项独立测试已通过。
- B5 首稿自建 JSON 校验存在 getter、稀疏数组和隐藏属性遗漏；任务状态扩展属性可能进入 P0。Claude 修复轮返回指定 qwen3.8-max 不可用，主 Agent 接手复用共享 canonical 校验、按白名单重建状态；13 项定向及独立测试通过，未替换外部 CLI 模型。
- C3 已通过 44 项测试。asset handle 必须携带摘要；任务与素材返回 ID 都要匹配请求；观察缓存先完整验证再投影，损坏/过期返回 null，取数中途撤销成员关系或转属也会拒绝。分类动作只绑定，不执行。
- C4 首稿自身 15 项测试通过后，独立测试仍发现资产/任务返回 ID、动态模型白名单、蒙版位置和历史模板证据缺口，已由 Kiro 修复。主审又补齐旧裤装重试兼容：有完整原分镜及真实模板证据时，允许原参数缺 seed，不补造历史字段；C4 最终 30 项定向与独立测试通过。CLI 自报通过不替代独立验收。
- 主目录集成前检查外部副本文件白名单及目标摘要；B5 仅两文件、C4 仅三文件变化，无越界修改或删除。Kiro 最终退出后再次核对源码摘要，与集成时一致。
- 全项目类型检查发现 C3 测试两处联合类型未充分收窄，主 Agent 改为按 observation 判别字段断言后通过。

## 最终检查

| 检查 | 结果 |
| --- | --- |
| `pnpm run test:agent` | **450 / 450 通过**，0 失败、0 跳过；原基线 357 项 |
| B5 定向与独立验收 | 13 项通过 |
| C3 定向验收 | 44 项通过 |
| C4 定向与独立验收 | 30 项通过 |
| 裤装 seed 兼容性 | 2 项通过 |
| 跨模块联调 | 4 项通过，含 P3 再鉴权、观察失效、C5 分流及路由到预览 |
| `pnpm exec tsc --noEmit --incremental false` | 全项目通过 |
| 本批 14 个实现/测试文件 ESLint | 通过 |
| 架构检查 / `git diff --check` | 通过 |
| 应用内真实视觉/生图请求 | 0；全部使用本地参数与模拟查询依赖 |

本地日志：`/tmp/agent-b5-c3-c4-final-tests.log`、`/tmp/agent-b5-c3-c4-final-typecheck.log`、`/tmp/agent-b5-c3-c4-final-lint.log`。CLI 副本、原始日志与摘要清单保留在 `/var/folders/bx/36wkb52d7tj7yjvhf4nq7nr40000gn/T/agent-b5-c3-c4-xqfy7obu`，原始 CLI 日志不作为用户交接正文。

## 本批接口与后续边界

- B5：`buildContextSnapshot` 提供 P0/P1/P2/P3、逐项分诊与预算统计。P0 不裁剪，超预算显式标记；P2 采用确定性截断；token 数是估算值。B6 负责后续分阶段 prompt 组装。
- C3：`ReadToolRunner.runAdmitted` 消费 C5 准入结果；`resolveContextHandle` 只读取已授权资源及缓存；`bindClassificationAction` 冻结受治理分类载荷。QueryPort 的实际仓储 adapter 由后续 composition root 注入。
- C4：`createTaskPreparation` 支持 `prepare/validatePrepared/prepareRetry/validateRetry`，只产生服务端冻结工件；`createLocalPreparationNormalizers` 复用四种现有归一化逻辑。默认预览存储仅覆盖当前进程；C7 必须提供持久化工件存储、真实准备后提交和审批校验，不能据此宣称进程重启重放已验收。
- 多结果预览带 `decision_gate:multiple_results_not_enabled`；姿势裂变因现有 TaskParams 没有自由提示词字段，保留用户目标并带 `decision_gate:pose_prompt_not_supported`。后者是新 Agent 预览的明确限制，未改变现有姿势表单。C7 不得忽略这些 blocker；若接入自由提示词，需另完成参数与实际 prompt 链路验证后才能解除。
- 裂变用户要求进入每个冻结 `shotPlan.prompt`。生成工件的风险说明保留用户目标，并参与完整 requestDigest；修改目标必须生成新版本。
- 老任务缺少真实模板版本凭证时拒绝准备重试，不用当前常量伪造历史。受信任的 `taskControls` 必须从服务端存储证据读取，不能由模型或客户端提供。
- 旧裤装任务已有完整原分镜但缺 seed 时可在证据齐备后准备重试；C7 执行适配仍须避开旧 `runPhotoFissionPipeline` 里的 Planner 重写路径，否则不满足冻结参数执行契约。
- 本批未启用新 Agent 主循环、未修改表单或调用真实图片供应商。C7/C9/C13 仍分别负责治理执行、内核运行时和产品协议接线。
