# E1 返工独立复核与失败交付兜底

日期：2026-09-17。用户要求接管上一个 Harness 未完成交付的子 Agent 任务。本次由 Codex 主会话直接审查，不再依赖子 Agent 返回。

## 结论

**E1 返工的第二次独立复核完成。R3～R7 在本次范围内未发现需返工的问题；同时重读 R1/R2 的实现及邻接链路。24/39 保持不变，不代表新增功能、真实业务验收或灰度批准。**

本次未改产品代码。主目录 17 个验收文件在检查前均与上轮 `e1-final-audit.json` 的最终 SHA-256 一致，检查后仍未变化。五项检查实际重跑：905/905（0 失败、0 跳过）、非增量 TypeScript、17 文件 ESLint、架构守卫、`git diff --check` 全部通过。

## 失败交付的范围还原

- 原始审查报告 `e1-codex-review-round1.md` 记录：Reviewer A 已交付；Reviewer C 中途结论送达但最终报告失败；Reviewer B 失败后部分重跑，其余 C8 接线审查由原 Codex 会话接手。
- `e1-final-audit.json` 记录返工复核只收到 R1/R2 PASS，R3～R7 前传输中断。因此“子会话失败次数”不等于“未完成的功能数量”。现有持久材料不足以独立重建每次 provider 故障根因，本次不宣称修复 Harness/provider。
- 本次补齐明确剩余的 R3～R7 判断性审查，并核对存储、候选捕获、撤销、锁外调度及回归覆盖，避免只采信前次 PASS。

## 审查方法

使用隔离候选仓库的 `9be7cb1..3f18843` 精确返工 diff，逐项阅读集成清单中的 10 个实现/测试文件，并读取主目录对应完整函数及调用点。当前文件哈希与上轮最终记录一致，故审查对象不是旧候选或另一份 worktree。

| 项 | 本次判断与证据 |
| --- | --- |
| R1 瞬时失败隔离 | PASS。`review-store.ts` 的 get/getEvaluation/assertSingleEvaluation 只采纳 deterministic；record 允许确定性结论替代同 admission 的瞬时痕迹，后来的瞬时故障不覆盖已确定的 receipt。`result-review.ts` 的读图异常明确标 transient，读取前后重查资产；端到端恢复回归通过。 |
| R2 去除墙钟裁决 | PASS（结构性）。`critic.ts` 不再按墙钟超时生成 verdict；两处 sharp 均设置像素限制，输入字节上限 40 MiB、像素上限 40 Mpx，分析缩至 512×512 内。没有把重复运行结果一致的测试冒充超时路径证伪；这些限制也不等于已有全局并发内存保护。 |
| R3 阈值与版本 | PASS。`acceptance-policy.ts:38` 选项仅保留版本，实际阈值固定为 E1_MIN_SCORE；强塞 minimumScore 不能改变判定。reviewer/policy 已升 v2，生产 composition root 使用默认配置。版本覆盖仍是受信任服务端能力，不是客户端配置。 |
| R4 grounding 边界 | PASS。`critic.ts:180` 校验 issue 与对应 failed check 的完整绑定、code/severity、evidence 与置信度；`parseCritique` 强制执行，policy 和 store 均经该入口。新增约束没有引入任务执行或外部调用依赖。 |
| R5 确定性 issue 不被替换 | PASS。`critic.ts:221` 先形成确定性候选再追加 proposals，先占用去重键；空数组不能抹掉失败项，重复 proposal 留 dropped 痕迹。检查相应测试断言与真实调用（默认不传 proposals）一致。 |
| R6 未支持维度 | PASS。八项 unsupported 在正常/不可用检查路径均显式存在，完整 AcceptancePolicyDecision 保存排序清单和 reason；SHADOW_PASS 只代表已支持检查通过。精简端口的限制见下节。 |
| R7 发布门 | PASS。`service.ts:531` 同时要求本次 decision 与 ledger 为 ADMITTED，失败撤销候选后显式 continue，位置在捕获评审候选及发布节点循环之前。非准入 decision 即使携带 views 也不会发布的回归通过。 |

额外核对：service 在 ActionLedger/user-file 事务释放、最外层操作成功之后调度 shadow；候选撤销会清除当前 action 的中间投影；shadow 异常被吸收，不改变 C8。现有锁外运行、悬挂不阻塞响应、降级撤销及 C8 绑定相关测试随全套回归通过。

本次阅读了前次六项回退失败矩阵，但**没有再次修改/回退实现来重跑证伪矩阵**；本次实际执行证据是当前实现的五项检查和精确 diff 的独立判断性审查。

## 保留边界与文档澄清

1. `unsupportedCheckIds` / `reasonCodes` 在完整 `AcceptancePolicyDecision` 和落盘 review artifact 中。`ResultReviewDecision` 精简返回值（`ports.ts:196`、`result-review.ts:78`）及 `critique.issued` 事件不携带该清单，当前 service 也不消费该返回值。原文“随 decision 一起下发”不得理解成已向 UI 下发；E2 若展示质量结论，须明确读取完整记录或扩展契约，不能只展示 disposition。
2. review 表无 TTL/容量上限、整文件重写及无全局 shadow 并发上限仍未解决；灰度前需要容量方案。
3. 端口依赖服务端内部 C8 投影，不能接受客户端/模型自造 receipt；资产缓存依赖不可变资产约定；合成 review turnId 与可能漏采样的边界保留。
4. 未启用 flag、hard mode、真实供应商调用，未 build、访问测试站/服务器、创建分支/提交/push。E2～E5 没有开工。

## 本次证据

仓库内持久副本：[检查结果与命令](verification/agent-e1-takeover-20260917/results.json)、[测试日志](verification/agent-e1-takeover-20260917/tests.log)、[检查前哈希](verification/agent-e1-takeover-20260917/baseline.json)、[检查后哈希](verification/agent-e1-takeover-20260917/after.json)。同目录保存 types/lint/architecture/diffcheck 日志。

原始审计入口：`/Volumes/DevDisk/AgentStaging/dianshang-codex-e1-20260917/` 的 `e1-rework-integration.json`、`e1-final-audit.json`、`e1-codex-review-round1.md`、`e1-falsification-matrix.json`。旧证据保持原样。
