# Agent E1 Critic + AcceptancePolicy：Shadow 验收与独立核对记录

日期：2026-09-17。任务契约见 [任务拆分 E1](./agent-task-breakdown.md#e1-critic--acceptancepolicy--l) 与 [Agent 设计](./agent-design.md)。本记录覆盖 **E1 确定性检查、结构化证据、AcceptancePolicy 与 shadow-only 接线** 的实现、Codex 独立核对、返工与集成。它**不是**硬质量闸上线批准。

## 结论

**后续兜底复核已完成（2026-09-17）**：Codex 主会话直接补齐 R3～R7 的独立判断性审查，并重查 R1/R2 及调用边界；未发现需返工项。主目录 905/905、非增量 TypeScript、17 文件 ESLint、架构与 diff 检查再次通过，代码哈希不变。详见 [兜底复核与持久证据](./agent-e1-takeover-review.md)。下文第 10 项保留原交接时点的过程。

**E1 已完成并集成，任务卡计数 23/39 → 24/39。**

流程为三段：Kiro 完成 shadow-only 实现（本地自测 895/895）→ Codex 独立核对，发现 7 个问题（其中 1 个可实证的 C8 发布门削弱）→ 在 E1 白名单内返工并补 10 条回归，最终 **905/905**、非增量 TypeScript、17 文件 ESLint、架构守卫、`git diff --check` 全绿，按字节集成主目录。

- 只消费本次 C8 `ADMITTED` 安全视图的服务端冻结投影；C8 不通过、`UNKNOWN`、`PENDING`、`QUARANTINED`、缺 task、缺 decision、缺专属 C8 proof 均不进入 E1。
- 质量状态独立于 C8：`UNREVIEWED`、`SHADOW_PASS`、`SHADOW_WOULD_WARN`、`SHADOW_WOULD_BLOCK`。没有 hard mode、UI 闸、C8 状态改写或自动重试/重生路径。
- `AGENT_RUNTIME_V1_ENABLED` 未修改，默认关闭；没有实际模型、分类、抠图、生图、测试站、服务器、构建、Git 提交或发布操作。

## 独立核对方法（可复现）

不采信作者自述，而是还原**精确 diff**：

1. 用 `resume-20260917-BZRSor/c12-main-verification.json` 里 23/39 基线的 116 文件 SHA-256 清单，证明 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source` 中那 8 个被改文件与基线**逐字节相同**，即它们就是 E1 改动前的内容。
2. 对这 8 个文件生成 diff（证据：`e1-exact-diff-nonservice.patch`、`e1-exact-diff-service.patch`），逐行核对。
3. 结论：E1 相对基线只改 8 个文件、只新增 8 个 `lib/server/agent/reflection/*`；其余 108 个基线文件字节未变。非 agent 范围的已改文件 mtime 全部早于 E1 会话窗口（13:35–15:16），与本卡无关。

核对到的真实改动量：`result-admission.ts` 6 行、`observability/events.ts` 1 行、`ports.ts` +61、`agent-beta/runtime.ts` +10、`agent-beta/service.ts` +227/−42。**C8 的判定逻辑、状态机与隔离规则在 `result-admission.ts` 中一行未动**，新增的只是 admitted 分支上的 `c8Evidence`。

## 独立核对发现的问题与返工（R1～R7）

| 编号 | 问题 | 定级 | 返工后的行为 |
| --- | --- | --- | --- |
| R1 | 瞬时失败（读图失败、旧版 2s 超时）产出的 `UNREVIEWED` 会写进 store 并成为 `assetDigest+版本` 的缓存命中源；一次抖动永久钉死该资产，且后续真实评审会因 `assertSingleEvaluation` 指纹冲突被 fail closed 吞掉 | high | artifact 新增 `outcomeKind`：`deterministic` 可缓存，`transient_unavailable` 只留痕、不命中 `get`/`getEvaluation`、可被后续确定性结论取代（并删除旧瞬时痕迹）；同一 admission 的瞬时痕迹不重复堆积；旧记录无该字段时按 `deterministic` 读，deterministic 的 receipt 摘要载荷保持旧形状，历史 `reviewRef` 依然有效 |
| R2 | 2 秒**墙钟** timeout 决定 verdict，同字节在不同负载下给出不同结论；且 `withTimeout` 不取消底层 sharp 工作，连资源保护都未达成 | high | 删除该 timeout 与 `DeterministicCriticInput.timeoutMs`；最坏解码代价由 `MAX_SOURCE_BYTES`/`MAX_SOURCE_PIXELS`/`ANALYSIS_SIZE` 与 sharp 错误捕获界定。回归断言同一字节两次检查产出逐字节相同的 critique |
| R3 | `minimumScore` 可独立传入却不绑定 `policyVersion`，同版本不同阈值给出不同结论，缓存 key 失真 | medium | `AcceptancePolicyOptions` 只保留 `policyVersion`；阈值固定为 `E1_MIN_SCORE`，由版本唯一决定 |
| R4 | `parseCritique` 只做 schema parse，`evaluateAcceptancePolicy` 直接信任传入 Critique；构造 schema 合法但不在 `checks` 中的 blocker 即可拿到 `SHADOW_WOULD_BLOCK`（生产路径不可达，属纵深防御缺口） | medium | 新增 `assertGroundedCritique` 并由 `parseCritique` 强制：issue 必须绑定 checks 内同一份 `failed` 检查，且 code/severity 合 `ISSUE_POLICY`、evidence 与绑定 check 一致、置信度不超过绑定 check。不合法 fail closed 抛错 |
| R5 | `createCritique(checks, [])` 可静默吞掉确定性失败项且不进 `droppedIssues` | medium | 确定性候选恒先入列，外部 proposals 只能**追加**；重复项走 `duplicate_issue` 留痕 |
| R6 | 颜色保真、版型/轮廓、肢体、审美**连 check 条目都没有**，receipt 里表现为「没提到」；`SHADOW_PASS` 可被误读成质量通过 | medium | 新增 `color_fidelity`/`silhouette_fidelity`/`body_anatomy`/`aesthetic_quality` 四项显式 `unsupported`（`source: not_configured`）；decision 新增 `unsupportedCheckIds` 并在存在未评审维度时追加 `unsupported_checks_present` reason code |
| R7 | **E1 把 C8 的发布门从显式 `continue` 削弱成隐式不变量**：基线 `if (decision.resultAdmission !== 'ADMITTED' \|\| relatedV1.resultAdmission !== 'ADMITTED') continue` 中，`decision` 那一半被改成只 withdraw 不 continue。账本仍为 `ADMITTED` 而本轮 decision 为 `PENDING`/`UNKNOWN` 时会落进发布循环，安全性退化为依赖「非准入 decision 不带 views」 | medium（已实证） | 恢复原条件与原位置的显式 `continue`（仍执行 E1 候选撤销）。新增回归「账本仍为 ADMITTED 但本次 decision 未准入时，带 views 也不得发布」——**已实测**：回退成 E1 原始实现后该用例失败并泄漏未准入结果为画布节点，修复后通过 |

因检查集合与策略输出语义变化，`E1_REVIEWER_VERSION` → `e1-deterministic-v2`、`E1_POLICY_VERSION` → `e1-shadow-policy-v2`，任何历史缓存都会被强制重评。

### 被明确否决的修法

独立审查曾建议「只要存在 `unsupported` 就判 `UNREVIEWED`」。**否决**：四项（现为八项）unsupported 恒定存在，照此实现后每个样本永远 `UNREVIEWED`，shadow 轴失去全部信息量，一周灰度无从积累。改为保留四态语义、由 decision 显式暴露未评审维度。

## 语义契约（返工后，前后端/消费者以此为准）

- `SHADOW_PASS` 的准确含义是「**已支持的**确定性检查全部通过」，**不等于质量通过**；完整 policy decision/落盘记录的 `unsupportedCheckIds` 与 `unsupported_checks_present` 必须与 disposition 一起读；精简 ResultReviewDecision 和事件目前不携带该清单，E2 展示前须明确取完整证据的契约。
- 评审 identity = `assetDigest + reviewerVersion + policyVersion`；阈值与检查集合由版本唯一决定，不存在能改变结论却不进 identity 的参数。签名 URL 轮换不重算像素；新资产版本或 reviewer/policy 版本必须重评。
- 每个 C8 action/evidence/result-window 强写独立 receipt，`reviewRef` 含该 C8 绑定；retry 留独立痕迹，不覆盖。
- Critic 只报带 `check + evidence` 的 grounded issue；裸分、缺 evidence、未知/未失败 check、severity/code 升级、证据错配、低置信、重复项进 `droppedIssues` 留痕，且无法经 policy 边界生效。
- OCR、文字/水印、模糊、颜色、版型、肢体、审美、多模态一律显式 `unsupported`，不得解释为通过。
- E1 在 ActionLedger 与 user-file 锁全部释放后的下一 event loop 才执行；评审悬挂、读图/存储/事件失败或进程退出不会延迟、隐藏、解禁、重试或重生 C8 结果，代价是 shadow 可能漏采样。
- E1 没有 TaskCommand、Vendor、Gateway、billing、退款或自动重试能力；`critique.issued` 只在服务端 `AGENT_EVENT_NAMES`，**未**进入客户端 `/api/events` 的白名单（后者是 `app/api/events/handler.ts` 的 `CUTOUT_EVENT_NAMES`）。

## 测试与验证

全部使用临时目录、合成 Task/Asset/Session、合成 PNG 和注入端口；真实外部能力调用为 0。

| 检查 | 返工前（作者自测） | 返工后（主目录最终） |
| --- | --- | --- |
| `pnpm run test:agent` | 895/895 | **905/905**，0 failed / 0 skipped |
| `pnpm exec tsc --noEmit --incremental false` | exit 0 | exit 0 |
| 受影响文件 ESLint（17 个输入） | exit 0 | exit 0 |
| `node scripts/check-agent-architecture.mjs` | 通过 | 「Agent 架构检查通过」 |
| `git diff --check` | 通过 | 通过 |
| 核对期间代码摘要变化 | — | `changedDuringVerification: []` |

净新增 10 条回归；新增/更正项如下（R1/R3～R7 有前次回退失败证据，R2 为结构性保证，不宣称其重复执行用例能证伪墙钟超时）：

- 外部 proposals 只能追加，空 proposals 不能吞掉确定性 issue（R5）
- 同一字节重复检查产出逐字节相同 critique（R2）
- 未 grounded 的伪造 issue 在解析边界 fail closed（R4，critic 与 policy 两侧各一条）
- `SHADOW_PASS` 必须同时暴露未评审维度（R6）
- 同 critique 同 policyVersion 必然同结论、阈值不可外部改写（R3）
- 瞬时不可用不得成为计算缓存、后续重评可取代（R1，store 侧）
- 已有确定性结论后瞬时故障不覆盖既有 receipt（R1）
- 旧版本无 `outcomeKind` 的 receipt 按确定性结论读回（R1 向后兼容）
- 读取失败留痕但不污染缓存、恢复后必须重评出确定性结论（R1，端到端；该用例原先断言的正是被污染的旧行为）
- 账本仍为 ADMITTED 但本次 decision 未准入时带 views 也不得发布（R7）

证据目录：`/Volumes/DevDisk/AgentStaging/dianshang-codex-e1-20260917/`，含核对报告 `e1-codex-review-round1.md`、精确 diff、两轮四类日志、`pre/post-hashes.json` 与集成清单 `e1-rework-integration.json`（候选提交 `3f18843`）。

## 文件白名单（核对后的准确版本）

E1 相对 23/39 基线共改动 **16 个代码/测试文件**，返工又改动其中 10 个：

- 新增（8）：`lib/server/agent/reflection/{critic,acceptance-policy,review-store,result-review}.{ts,test.ts}`
- 窄改（8）：`lib/server/agent/ports.ts`、`lib/server/agent/governance/result-admission.{ts,test.ts}`、`lib/server/agent/observability/events.ts`、`lib/server/agent/observability/event-store.test.ts`、`lib/server/agent-beta/{runtime,service,service.test}.ts`
- ESLint 输入是 **17 个**：上述 16 个加未改动的 `lib/server/agent/observability/event-store.ts`（只做校验，不在改动清单内）
- 文档：本记录、`docs/agent-session-handoff.md`、`docs/agent-task-breakdown.md`、`docs/agent-resume-progress.md`、根 `AGENTS.md` 的状态指针
- 未修改认证、计费、供应商路由、任务命令、Gateway、C8 核心安全判定、前端 UI、feature flag、四个既有表单 API 或 package/lockfile

## 已知限制与下一步

1. E1 仍是同进程 best-effort shadow：进程退出、后台异常或存储故障可漏采样，不影响 C8；不是跨进程队列或 exactly-once 承诺。单写进程前提仍有效，review 表的锁不是跨进程互斥。
2. **review 表没有 TTL、裁剪或容量上限**，且 `DurableGovernanceTable` 每次事务都整文件重写并另写 `.bak`。治理层各表皆然（approvals、action ledger、preparation artifacts），但 review 表按「每图每 C8 action 一条 receipt」增长最快。灰度前必须先定容量与裁剪策略（本仓库 2026-07-06 的 OOM 事故正源于整文件写入类问题）。
3. 单次评审的最坏资源成本是显式有界但不小：输入上限 40 MiB / 4000 万像素，sharp 全量解码一张 40 Mpx 图约 160 MB RGBA 另加 libvips 工作内存（分析本身 resize 到 512² 再逐像素扫描）。shadow 的并发度等于并发请求数（单请求内顺序处理），4C/8G 上生产＋测试站＋DSH 共存时须与下条一起纳入容量评估。
4. `assetDigest` 基于 AssetRecord 元数据（不含可轮换 `fileUrl`），依赖「资产不可变」这一业务约定，而非像素哈希。若将来允许原地替换同 id 同尺寸资产的字节，缓存会给出过期结论。
5. `result-review` 端口自身只校验 schema 与当前 AssetRecord，**不回查** result-admission 的 evidence 文件；其安全性依赖「唯一接线是 service 内部 capture」。不得把该端口暴露给不可信调用方。
6. `critique.issued` 使用 review 作用域的合成 `turnId`（`review_<reviewRef 片段>`），并非真实 turn；按 turnId 聚合的审计口径需知情。
7. OCR/水印/模糊/肢体/审美/颜色与版型多模态检查没有实现，八项显式 `unsupported` 不能解读为通过；多模态继续受 B3/Q3 阻塞。
8. 影子至少积累一周、经人工标注证明误杀率 ≤1% 前，禁止开启 hard mode。hard mode 必须另卡审查写失败语义、回滚开关、指标分母、人工标签来源与容量上限。
9. E1 不自动重生、重试供应商、改提示词、退款或更改 C8 `ADMITTED/QUARANTINED`；E2～E5 未开始。
10. **返工复核（原交接时点部分完成；现已由上方后续复核补齐）**：R1～R7 的修复由执行核对的同一会话完成，因此按两条路径补强：
    - **独立复核**（Luna xhigh 只读会话）：R1「瞬时失败隔离」与 R2「移除墙钟 timeout」判 **PASS，无任何等级发现**，并给出行号证据（`get`/`getEvaluation` 只读 deterministic、`record` 对同 admission 的替代与去重、`assertSingleEvaluation` 只约束 deterministic 不产生读取歧义、旧记录缺字段按 deterministic 且历史 `reviewRef` 摘要形状不变；两处 sharp 均设 `limitInputPixels` 与 `failOn:'warning'`、分析尺寸与逐像素循环上限固定，墙钟不再参与 verdict）。该会话在报告 R3～R7 前因传输故障中断（本轮共 6 次子会话交付失败）。
    - **证伪矩阵**（机械可复现，任何人可复跑）：逐条回退修复后对应回归必然失败，见 `e1-falsification-matrix.json`。

      | 修复 | 回退后失败的回归 |
      | --- | --- |
      | R1 | 瞬时不可用不得成为计算缓存（store）／读取失败留痕但不污染缓存（端到端） |
      | R3 | 同 critique 同 policyVersion 必然同结论，阈值不可外部改写 |
      | R4 | 未 grounded 的伪造 issue 在解析边界 fail closed（critic 与 policy 两侧） |
      | R5 | 空 proposals 不能吞掉确定性 issue／dropped 留痕顺序 |
      | R6 | unsupported 清单完整性／`SHADOW_PASS` 必须暴露未评审维度 |
      | R7 | 账本仍 ADMITTED 但本次 decision 未准入时带 views 也不得发布 |

      R2 无法用失败用例证伪（墙钟超时不可确定性触发）：它的保证是结构性的——代码里已不存在墙钟路径，`DeterministicCriticInput.timeoutMs` 已删除，另有「同一字节两次检查产出逐字节相同 critique」的回归兜底。
    - **当时建议，现已完成**：下一会话对 R3～R7 的代码做一次人工判断性复核（不是证伪，而是看修法是否引入新耦合），范围即 `e1-rework-integration.json` 的 10 个文件。此项不阻塞 24/39 计数。
