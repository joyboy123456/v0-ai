# Agent 改造会话交接

## 当前状态

2026-09-17：正式完成并经 Codex 独立核对、主目录集成的基线为 **24 / 39 张任务卡**：A0＋P0＋P1（B1/B2/B5/B6）＋P2（C1～C13）＋P4 的 **E1**。过程见 [开发恢复记录](./agent-resume-progress.md)。

E1「Critic + AcceptancePolicy」本轮已关闭：Kiro 完成 shadow-only 实现（自测 895/895）→ Codex 用 23/39 基线哈希还原**精确 diff** 独立核对，发现 7 个问题 → 在 E1 白名单内返工并补 10 条回归 → 主目录最终 **905/905**、非增量 TypeScript、17 文件 ESLint、架构守卫、`git diff --check` 全绿，已按字节集成并留哈希清单。完整契约、文件白名单、限制与返工明细见 [E1 验收与独立核对](./agent-e1-acceptance.md)。

**计数口径**：24/39 已正式登记。2026-09-17 后续 Codex 主会话已补齐返工代码的第二次独立复核：R3～R7 未发现需返工项，并重查 R1/R2 和邻接链路；主目录五项检查重跑全绿（905/905），17 文件检查前后哈希与上轮最终记录一致。详见 [失败交付兜底与独立复核](./agent-e1-takeover-review.md)。

| 阶段 | 实现与返工 | 当前验收状态 | 范围 |
| --- | --- | --- | --- |
| C9 主循环 | Kiro（gpt-5.6-sol / max） | Codex 独立通过：784/784 | 14 个代码/测试文件＋验收记录 |
| C13 产品协议接线 | Kiro（gpt-5.6-sol / max） | Codex 独立通过：859/859 | 20 个代码/测试文件＋验收记录 |
| C12 计划卡与工具轨迹 | 本机 Grok | Codex 独立通过：880/880；Chromium 19 项 | 11 个 UI/展示测试文件＋验收记录 |
| E1 Critic + AcceptancePolicy | Kiro 实现；Codex 核对并返工 R1～R7 | **已集成：905/905，五道门禁全绿** | shadow-only 后端、C8 receipt、确定性检查与测试（16 文件） |

### E1 核对中最值得记住的一条

E1 原始实现把 C8 的发布门从显式 `continue` 削弱成隐式不变量：基线是
`if (decision.resultAdmission !== 'ADMITTED' || relatedV1.resultAdmission !== 'ADMITTED') continue`，
E1 只保留了 `relatedV1` 那一半的 `continue`。账本仍为 `ADMITTED` 而本轮 decision 为 `PENDING`/`UNKNOWN` 时会落进发布循环，
安全性退化为「非准入 decision 不带 views」这一隐式假设。895 个测试抓不到它（构造不出该输入），
实测回退后新回归立刻失败并把未准入结果泄漏成画布节点。**结论：改动 C8 相关代码时，不要把显式门禁替换成对上游数据形状的假设。**

## E1 实现边界（返工后）

- E1 只消费真实 C8 `ADMITTED` decision 的服务端冻结投影。候选绑定 user/session/message/task/action/actionKind/requestDigest/approvalDigest/C8 evidence ref/result digest 与当前 AssetRecord。
- Critic 只报带 `check + evidence` 的 grounded issue；grounding 在 `parseCritique` 边界强制（不合法 fail closed），裸分、缺 evidence、未知/未失败 check、severity/code 升级、证据错配、低置信、重复 issue 均 dropped 留痕。外部 proposals 只能追加，不能顶掉确定性 issue。
- 确定性检查：图像可解码性、EXIF 后尺寸一致性、短边分辨率、极端比例、可见内容、空白边、边缘裁切。**没有墙钟 timeout**——结论不得由负载决定。
- 八项显式 `unsupported`：文字/OCR、水印、模糊、颜色保真、版型/轮廓、肢体、审美、多模态。`SHADOW_PASS` 只代表「已支持的确定性检查全通过」，完整 policy decision 与落盘评审记录保存 `unsupportedCheckIds` 与 `unsupported_checks_present`（精简返回值与事件不携带该清单，尚未接 UI），**不得读成质量通过**。
- 质量轴独立为 `UNREVIEWED / SHADOW_PASS / SHADOW_WOULD_WARN / SHADOW_WOULD_BLOCK`。没有 hard mode、前端质量闸或 C8 状态消费者。
- 评审 identity = `assetDigest + reviewerVersion(e1-deterministic-v2) + policyVersion(e1-shadow-policy-v2)`；阈值与检查集合由版本唯一决定，没有能改变结论却不进 identity 的参数。签名 URL 轮换不重算；新资产版本或 reviewer/policy 版本必须重评。
- artifact 带 `outcomeKind`：`deterministic` 才是计算缓存；`transient_unavailable`（读图失败等）只留痕、不命中缓存、可被后续确定性结论取代。**瞬时抖动不会把一张图永久钉成未评审。**
- 每个 C8 action/evidence/result-window 强写独立 receipt，`reviewRef` 含该 C8 绑定；retry 留独立痕迹。
- E1 运行在 ActionLedger 与 user-file 锁释放后的下一 event loop。评审悬挂、读图/存储/事件失败或进程退出不会延迟、隐藏、解禁、重试或重生 C8 结果；代价是 shadow 可能漏采样。
- E1 没有 TaskCommand、Vendor、Gateway、billing、退款或自动重试能力。`critique.issued` 只在服务端事件名单，未进客户端 `/api/events` 白名单。

## 运行与发布边界

- `AGENT_RUNTIME_V1_ENABLED` 仍默认关闭；本轮没有修改用户配置或启用真实流量。
- 当前 Beta 仍以单张 AI 服装生图、受治理查询/分类/garment 抠图/取消及有证据的失败镜头重试为主。单任务单张批准、Grsai-only、多张与姿势自由提示词 blocker 保持。
- C9 每轮模型调用上限仍为 3；UNKNOWN/QUARANTINED 不重提，已有 v1 不回落 legacy，只有本次 C8 安全视图可上画布。
- 同进程锁不等于跨进程锁；保持单写进程。E1 review store 和后台调度也不承诺跨进程 exactly-once。
- 本轮未运行 Next build、测试站、服务器、真实 LLM/分类/抠图/生图/供应商请求、Git 分支/提交/push 或生产发布。发布继续遵循 `AGENTS.md` 的测试站验收流程。

## 工作区与证据

- 主项目：`/Volumes/DevDisk/Projects/xinman/dianshang/v0-ai`。当前包含已核对并集成的 24/39 代码（E1 在内）；用户已授权本轮将该基线提交到 GitHub main，具体提交以 Git 历史为准。E2 候选留在隔离副本，未计入该基线。
- 旧 Kiro 副本 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source` 只到 C13（其 8 个 E1 相关文件恰好等于 23/39 基线，可用于还原 E1 的精确 diff），Grok 副本只承载 C12；**不得用旧副本整目录覆盖主工作区**。
- C9/C13/C12 持久证据在 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/resume-20260917-BZRSor`。
- E1 证据在 `/Volumes/DevDisk/AgentStaging/dianshang-codex-e1-20260917/`：核对报告 `e1-codex-review-round1.md`、精确 diff（`e1-exact-diff-*.patch`）、两轮四类门禁日志、`pre/post-hashes.json`、集成清单 `e1-rework-integration.json`，以及带 git 基线的返工候选副本 `candidate/`（基线 `9be7cb1`、返工 `3f18843`）。
- 用户原有未提交/未跟踪文件必须保留；核对只能按 E1 验收页中的文件白名单逐文件审查。

证据入口：

- [E1 验收与独立核对](./agent-e1-acceptance.md)
- [C9 验收](./agent-c9-acceptance.md)
- [C13 验收](./agent-c13-acceptance.md)
- [C12 验收](./agent-c12-acceptance.md)
- [实施手册与任务卡](./agent-task-breakdown.md)
- [工作区边界](./agent-workspace-boundary.md)

## 当前续接

2026-09-17 用户授权以 Grok 为主继续开发；本地 GPT 模型配置已移除，E2 VisualFeedback 已冻结并派发 Grok 隔离副本，范围见 [E2 任务书](./agent-e2-task.md)。尚未验收或集成，计数保持 24/39。用户随后要求优先备份 GitHub，编码已暂停；续接见任务书及 staging 的 progress.md/codex-review-in-progress.md。下方 E2 领取前提已由本次授权与任务书满足，其余卡不自动开放。

## 新会话下一步

### E1 返工复核已完成

本轮由主会话直接补齐，具体判断、实际命令和持久日志见 [兜底复核记录](./agent-e1-takeover-review.md)。不需要因旧子会话交付失败再次重复派发；后续产品开发仍按下方授权和依赖推进。

### 灰度与 hard mode（仍未获批）

- 不要直接启用 hard mode。硬拦截需单独批准真实 shadow 灰度、至少一周人工标签、误杀率 ≤1%，并先定义指标分母、漏采样与写失败语义、回滚开关。
- **额外前置**：review 表目前无 TTL/裁剪/容量上限，且治理表每次事务整文件重写＋另写 `.bak`。灰度前必须先定容量与裁剪策略（参考 2026-07-06 OOM 事故教训）。

### 之后的卡

- 下一张本地编码卡的自然候选是 **E2 VisualFeedback**（显式依赖 C12，消费 E1 issues/note/locked facts），但必须先由用户/Codex 重新冻结任务书、文件白名单和失败语义；不要自动开始。
- B3/B4 仍受 Q3 多模态渠道决策阻塞；D1～D6 受 Q1-B 阻塞，D5 另受 Q2；E3/E5 虽有部分依赖满足，也应按用户优先级逐卡领取；P5 仍等待真实线上数据。
