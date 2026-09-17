## 开发测试站（pm2 yibai-preview，2026-08-15 起）

- **访问入口**：`http://121.40.34.214:3100`（需阿里云安全组放行 TCP 3100）；另有一条备用的 nginx 反代 `/etc/nginx/conf.d/yibai-preview.conf`（`preview.jjwlai.cn:80 → 127.0.0.1:3100`，DNS 就绪后可用）
- **⚠️ 换公网 IP 必改** `next.config.mjs` 的 `allowedDevOrigins`：dev 服务器按 Origin 校验，白名单外的来源请求所有 JS chunk 都 403，页面永远停在「正在加载工作台」SSR 骨架（2026-08-15 实锤：121.40.34.214 未加白名单导致此故障）。改完要 `pm2 restart yibai-preview`
- **进程管理**：`ecosystem.preview.config.cjs`（pm2 名 `yibai-preview`），`next dev` 热更新——代码保存即生效，无需 rebuild；开机自启已随 `pm2 save` 固化
- **与生产完全隔离**：cwd 在 `.preview-runtime/`（data/、public/、logs/ 都在这里），不碰生产 `data/fashion-mvp-store.json`；`STORAGE_MODE=local` 强制测试上传不进 OSS；`NEXT_PREVIEW_DIST_DIR=.next-preview` 让 dev 构建与生产 `.next` 分离
- **账号**：搭建时从生产 `data/users.json` + `invite-codes.json` 复制了一次，登录密码与生产一致；之后两边独立演进
- **容量**：dev 实例较吃内存（上限 3072M）；4C/8G 上生产 + 测试站 + dsh 共存已实测 OK，但测试站上别跑大批量生图
- **收尾注意**：改配置后 `pm2 delete yibai-preview && pm2 start ecosystem.preview.config.cjs`（restart 不更新 env/node_args）；不用了 `pm2 delete yibai-preview && pm2 save`，并同步删 nginx 反代配置

## 测试站验收与生产发布流程（yibai-fission 项目专属）

> 本机 4C/8G 同时跑三套服务：生产 `pm2 yibai-fission`（:3000）、开发测试站 `pm2 yibai-preview`（:3100，next dev 热更新）、DSH 宿主。测试站与生产同仓库同代码，但数据完全隔离。**之后所有新功能统一走：开发 → 测试站验收 → 生产发布**，禁止未经测试站验收直接发生产。

### 1. 开发期间

- 正常改代码；提交后测试站**无需任何操作**——next dev 热更新，代码保存即生效。
- 后端未就绪的功能用「**前端 mock 先行**」模式：纯函数时间轴模拟任务生命周期 + `mock-gd-` 式 taskId 前缀 + 模型列表 mock 下发，范例 `lib/garment-detail-mock.ts`；界面验收通过后再另建任务接真后端。
- 测试站是开发中间态：改到一半的代码用户可能会看到报错，属正常，验收以「当前状态说明」为准。

### 2. 测试站验收（每个功能必做，代替"直接发生产"）

- 入口：`http://121.40.34.214:3100`（安全组 TCP 3100；备选 nginx `preview.jjwlai.cn`），账号 user01 + 生产同款密码。
- 验收清单：功能主流程、参数联动、任务进度/结果渲染、失败与重试路径、移动端（<768px 外壳，hover 操作 `max-md:opacity-100`）、双主题（暗/亮）。
- **体验边界**：测试站已有功能（AI服装大片等）是真实出图、花真实供应商额度；验收时不要大批量生图（额度与服务器资源与生产共享）。
- 验收结论须明确记录：通过 / 需修改项。

### 3. 验收通过 → 生产发布

```bash
pnpm typecheck && pnpm lint && pnpm build   # 必须全绿
pm2 restart yibai-fission                  # 生产立即切到新构建
```

- 发布后验证：生产首页 200 + 页面引用的静态资源全部 200（`curl` 检查 buildId/chunk 一致性）。
- **未通过验收不得发布生产**：build 只允许在准备发布时执行；验收不过就继续在测试站迭代，直到通过。
- 收尾：新约定沉淀到 AGENTS.md（写入时给本流程留指针）。

### 4. 铁律（血泪教训）

1. `pnpm build` 会用当前工作区覆盖生产 `.next`——**只允许在准备发布时 build**。临时 build 后生产必须 `pm2 restart yibai-fission`，否则线上进程与磁盘构建不一致、静态资源 500。
2. 数据隔离靠 cwd：测试站 cwd=`.preview-runtime/`（独立 data/、public/、日志）。绝不手动在生产与测试站之间拷贝 `data/` 下文件（搭建时的一次性账号复制除外）。
3. 换公网 IP 必改 `next.config.mjs` 的 `allowedDevOrigins` 并 `pm2 restart yibai-preview`，否则测试站所有 JS chunk 403、页面永远停在「正在加载工作台」SSR 骨架。
4. 改测试站 pm2 配置后 `pm2 delete yibai-preview && pm2 start ecosystem.preview.config.cjs`（restart 不更新 env/node_args）。
5. dev 与生产共用源码，生产 `next-env.d.ts` / `tsconfig.json` 的 distDir 引用会被 dev 改写，提交前 `git checkout` 还原。

## 运维信息（2026-07-06 OOM 事故后加固）

### 服务器配置
- 阿里云 ECS 4vCPU / 8GB RAM / 40GB 磁盘
- pm2 管理 Next.js 生产进程，开机自启已配置（`pm2 startup` + `pm2 save`）

### 关键防护机制
- **store.json 原子写入**：`writeStoreFile` 先写 `.tmp-write` 再 `rename`，进程死在中途不破坏原文件
- **损坏自恢复**：`loadPersistedStore` 解析失败时保留现场到 `.corrupt-<ts>` 并自动加载最近备份
- **每小时备份**：cron `0 * * * *` 调 `scripts/backup-store.sh`，本地留 48 份 + 凌晨上传 OSS
- **看门狗**：cron `* * * * *` 调 `scripts/linux-watchdog.sh`，健康检查失败自动重启
- **日志轮转**：pm2-logrotate 10MB/30份/压缩
- **优雅停机**：SIGTERM 钩子等 `persistChain` 写盘完成再退出（kill_timeout=10s）

### OSS 配置注意
- **不要重新启用 `yibai/results/` 的 Lifecycle 3 天删除规则**（原 `scripts/setup-oss-lifecycle.mjs`）：
  OSS Lifecycle 不支持按业务 favorited 字段过滤，会无差别删除所有生成图（含已收藏）。
  如需自动清理，用程序化方式调 `/api/cleanup`（支持按 favorited 过滤）。
- OSS bucket 未开版本控制，删除即永久丢失，无回收站

### pm2 配置
- `ecosystem.config.cjs`：max_memory_restart=4096M, --max-old-space-size=3584, kill_timeout=10000
- 改配置后需 `pm2 delete yibai-fission && pm2 start ecosystem.config.cjs`（restart 不更新 node_args）

### 已知限制
- 7月 205 个 task 是从 OSS + pm2 日志重建的，**提示词/inputAssets 已丢失**（只有图）
- 5/29-6/22 的 task 和图永久丢失（无备份 + OSS Lifecycle 已删）
- createTask 现已记录完整 params 到日志，下次事故可从日志恢复提示词

## 前端约定（2026-08 移动端 + 暗色主题改造后）

- **双主题**：class 式暗色（`next-themes`，默认跟随系统，localStorage 持久化）。暗色只覆盖 `app/globals.css` 的 `:root` 设计 token（`.dark { ... }` 块），语义 token 经 `@theme inline` 自动级联
- **写样式必须用语义 token**（bg-card / bg-background / text-foreground / text-muted-foreground / bg-secondary / border-border / text-primary-foreground 等），禁止新增 `bg-white`、`text-slate-*` 这类硬编码亮色；图片预览舞台的深色 `bg-[#111315]` / `bg-[#101010]` 是两主题共用的有意设计，保留
- **移动端断点 768px**：`hooks/use-mobile.ts` 的 `useIsMobile()` 或 Tailwind `max-md:`/`md:`。Workbench 在 `workbench.tsx` 按 isMobile 分两套外壳（桌面三栏 / 移动 MobileShell），状态全复用
- **hover 才显示的操作必须补 `max-md:opacity-100`**（触屏无 hover）
- 生产构建会改写 `next-env.d.ts` / `tsconfig.json` 的 distDir 引用；用非默认 distDir 验证构建后记得 `git checkout` 还原

## 服饰智能分层（智能抠图编辑器）约定（2026-08-15）

- **交互式抠图编辑器以新组件为准**：`components/workbench/cutout-editor-dialog.tsx`（双画布 + 交互式选区）+ `components/workbench/cutout-region-worker.ts`（Web Worker 连通区域拆分）；旧 `image-editor-dialog.tsx` 已删除
- **后端会话服务** `lib/server/cutout-session-service.ts`：会话 60 分钟 TTL 内存态；prepare 一次 `SegmentCloth` 调 7 类（响应 `Data.Elements[].ClassUrl` 按类别返回 URL，别只取合并的 ImageURL）+ skin/hair/body/common 辅助；单类别失败降级跳过、全部失败才报 prepare_failed
- **阿里交互式分割已下架**（InteractiveScribbleSegmentation / InteractiveFullSegmentation，2025-10-14，实测 InvalidAction.NotFound），不要再尝试接入；「点哪选哪」用「类别分割 + 前端连通区域」实现，涂抹/擦除/反选纯前端 Canvas，不吃 GPU
- **sharp 灰度坑**：`raw()` 输出 1 通道灰度必须先 `toColourspace('b-w')`，否则会被转成 3 通道
- **viapi 临时桶（viapi-customer-temp）对浏览器匿名访问 403**，prepared 图必须经 `/api/cutout-sessions/{id}/image` 同源输出，不要把 `preparedImageUrl` 直接给前端
- 抠图/分层不扣费（credits 只在生成任务上）；埋点走 `POST /api/events`（14 个事件白名单，keepalive + 结构化日志）



## 高清放大细节图（garment-detail）约定（2026-08-16 后端真实链路接入）

- 第四功能 feature id `garment-detail`，**已接真实后端**（`lib/garment-detail-mock.ts` 及 `mock-gd-*` 前缀逻辑已全部删除）。前端 API 客户端在 `lib/garment-detail-api.ts`（models/classify/buildGarmentDetailShots）
- **后端三件套**：`lib/server/garment-detail-model-registry.ts`（std-v1/pro-v1 档位 → env 候选模型链，取第一个有可用渠道者并固定 `resolvedModelId` 到任务快照，同任务初次/重试/恢复不跨模型切换）、`garment-detail-classifier.ts`（SegmentCloth 7 类 → 5 业务分类）、`garment-detail-service.ts`（normalize/prompt/worker-pool 管线）
- **SegmentCloth 分类置信度是推导的**：上游只返回 1 通道灰度 mask PNG（无 alpha），按前景像素面积占比归一化为 0~1 score；**绝不能 ensureAlpha 读 alpha（恒 255）**，且 sharp raw() 前必须 `toColourspace('b-w')`；tops+skirt 同命中且 skirt≥tops×0.4 才建议 dress（近似「区域连续」）
- **分类故障不阻塞生成**：超时（`GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS`）/异常/fallback 合并图统一返回 `status:'fallback'` 200，前端提示手动确认
- **shot 规划契约**（前后端逐字一致）：labels 五类表、`detail_${i+1}` 命名、每 shot 只绑自己那张参考图、0 参考图出 1 张；服务端 normalize 重建，不信任客户端
- 任务链路复用现有体系：useStreamingPersist + persistOneResult、retry-shots 按 featureType 分流（`retryGarmentDetailShots`）、task-recovery 认 `detailShots[].shotId`；`GARMENT_DETAIL_BACKEND_ENABLED=0` 时 /api/tasks 拒绝该 feature
- 结果预览用 `garment-detail-compare.tsx`：滚轮/按钮缩放 + 拖拽平移 + 原图对比双窗格（读 `task.inputAssets[0].fileUrl`）
- **node --test 原生跑 TS 的坑**：被测模块对 `./types` 只能 `import type`（运行时 import 必须带 `.ts` 扩展名，否则 ERR_MODULE_NOT_FOUND）；含 `@/lib` 运行时 import 的模块在裸 node --test 下不可跑，新服务端模块应保持「import type + 依赖注入 + 懒加载动态 import」


## 生图渠道停用约定（2026-09-16）

- 老张渠道已停用：供应商池按 type、id、laozhang.ai 域名拦截，候选路由及直接请求入口均禁止使用，旧任务重试也不得绕过。
- 默认服装生图模型为 Grsai `nano-banana-2`；Agent 仅允许 Grsai 模型。旧 Gemini 方案须重新规划，不自动改写已提交任务的模型。
- 发布仍遵循上方「测试站验收与生产发布流程」。

## Agent A0/P0 本地开发约定（2026-09-16）

- 实施契约以 `docs/agent-task-breakdown.md` §2.11 为准；进度和本地验收记录在 `docs/agent-p0-acceptance.md`。
- 用户明确要求先在本地开发、集成与测试；本阶段不操作测试站、不同步服务器代码、不 build 或发布生产。后续发布仍须遵循上方测试站验收流程。
- 生图积分由现有 access 供应商链路按实际扣除；Agent 不新增计费系统、金额预估、预扣、换算、退款或 billing 查询依赖。旧任务 `creditsCost/creditsUsed` 只是既有元数据，不能冒充供应商实扣。
- ActionLedger 是执行去重/审批/任务状态记录，不是积分账。旧记录不得补造审批凭证；任务状态未知不得自动重提。
- B1 观察缓存已经本地验收，进度见 `docs/agent-p1-acceptance.md`：命中也必须校验当前素材归属；key 绑定 assetDigest/observerVersion，24h 到期，损坏返回 null 不回退备份。同进程合并计算，不承诺跨进程只算一次；B2 真实分类仍须等待 C7。

## Agent 工作区边界修订（2026-09-17，覆盖下方历史批次的“当前/后续”措辞）

- 正式完成并经 Codex 独立核对/集成的基线为 **24/39**（新增 E1 Critic + AcceptancePolicy，shadow-only）。E1 由 Kiro 实现（自测 895/895），Codex 用基线哈希还原精确 diff 独立核对后发现 7 个问题并在白名单内返工，最终主目录 905/905、非增量 TypeScript、17 文件 lint、架构检查、`git diff --check` 全绿。当前状态与下一步以 `docs/agent-session-handoff.md` 为准，E1 细节见 `docs/agent-e1-acceptance.md`，过程见 `docs/agent-resume-progress.md`。
- E1 只消费真实 C8 ADMITTED receipt，质量轴不改 C8；后台 best-effort shadow 不阻塞响应，不自动重生/重试/退款。`SHADOW_PASS` 只代表「已支持的确定性检查全通过」，八项 unsupported（含颜色/版型/肢体/审美）保存在完整 policy decision 与落盘评审记录中（精简返回值/事件尚不携带清单，未接 UI），不得读成质量通过。hard mode 必须等待单独灰度批准、一周人工标签、误杀率 ≤1%，并先定 review 表容量与裁剪策略（该表目前无 TTL/上限且整文件重写）。2026-09-17 后续 Codex 主会话已补齐 E1 返工独立复核，五项检查重跑全绿，见 `docs/agent-e1-takeover-review.md`；用户随后已授权以 Grok 为主继续开发，E2 已冻结任务书并派发隔离 Grok CLI，见 `docs/agent-e2-task.md`；尚未验收/集成，不增加计数。
- Codex 负责调度、接口/文件白名单、独立代码审查、验收工具与记录、返工及集成；产品实现交本机 kiro-cli / Claude Code / Grok。本轮 Kiro 编码 C9/C13，Grok 编码 C12，Claude/Grok 参与辅助审查；辅助结论必须由 Codex 复核。
- 编码 CLI 使用各自独立可写副本；Codex 可跨主项目、副本及审计材料核对。“不得访问原项目”仅约束隔离编码 CLI，不禁止 Codex 按白名单集成。主项目是已验收集成基线，副本是对应阶段交付。
- Kiro 副本 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source` 截至 C13；Grok C12 副本 `/private/tmp/dianshang-agent-resume-BZRSor/grok-c12-source`。两者不应再被混称唯一最新工作区。
- 持久证据在 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/resume-20260917-BZRSor`，含独立日志、摘要、集成前备份与截图。具体集成与并发保护见 [工作区边界](docs/agent-workspace-boundary.md)。
- `AGENT_RUNTIME_V1_ENABLED` 默认关闭；本轮未改用户配置启用真实调用，未运行 Next 生产构建、测试站、服务器、Git 分支/提交/push 或生产发布。真实供应商/样本业务验收另行安排。
- 单任务单张、Grsai-only、UNKNOWN 不重提、v1 不回落 legacy、仅本次 C8 安全结果可上画布继续生效。C9 模型预算仍为 3；多模态、多步/多图付费及后续 P3～P5 不因本轮完成而自动开放。

## Agent C8 开发协作约定（2026-09-17，历史批次记录）

- 后续 Agent 开发由 **kiro-cli / Kiro 唯一编码执行**：实现、测试、修复和开发文档均由 Kiro 完成；Codex 主 Agent 只负责基线核对、集成审核和独立验收。C8 验收通过前不得启动 C9/C13/C12。
- 本轮不调用 Claude、Grok 或其他外部编码 CLI。Kiro 可在先固定接口和文件所有权后使用内置子 Agent 并行处理互不冲突的文件；子 Agent 自报完成不能替代主会话复核与实际命令结果。
- 主会话、首版三个子 Agent、Codex 首轮返工两个子 Agent及第二轮并发返工一个子 Agent均使用 `gpt-5.6-sol`；子 Agent 工具本身不提供 `effort` 参数，但用户提供的 root 日志已证明本轮主会话和各子 Agent实际 effort 均为 max。
- 工作仅限不含 `.env`、业务 data、生产素材和 Git 的持久隔离源码副本 `/Volumes/DevDisk/AgentStaging/dianshang-kiro-q56u5x1n/source`；不得访问旧 TMP 或原项目，不绕过 sandbox，不安装依赖，不改认证/系统配置，不创建分支/提交/push，不 build，不访问测试站/服务器或真实 LLM、分类、抠图、生图 API。
- Codex 对既有文件的逐字迁移、既有依赖复制及 tsconfig/components/Zod 环境恢复不是产品变更；`KIRO_ENVIRONMENT_NOTICE.md` 与父目录 baseline/迁移/运行日志不集成。
- C8 当前结果记录在 `docs/agent-c8-acceptance.md`：Codex 首轮四项、第二轮历史 attempt 并发正例及最后可选参数兼容问题均已由 Kiro 测试先行修复；现 result-admission 定向 72/72、统一自测 698/698、TypeScript、4 文件 ESLint 与架构守卫通过，最终状态仍须等待 Codex 再次独立验收。

## Agent B5/C3/C4 本地验收约定（2026-09-17）

- 本批完成后统一回归 450 项通过，记录见 `docs/agent-b5-c3-c4-acceptance.md`；继续只在本地开发，不启用新主循环、不操作测试站、不 build 或发布。后续发布仍遵循上方测试站验收流程。
- P0 上下文不裁剪；P3 只挂定位 handle，不提供授权。asset handle 必须绑定摘要；每次取数重查会话成员与资源归属。分类只能产生 GovernedAction，不进免费 runner。
- `normalizePhotoFissionParams` 第四参 `{ normalizationSeed }` 仅供服务端冻结准备，旧表单继续原有行为。C7 不得直接复用会重跑 Planner 的旧裂变执行入口。
- C4 默认预览存储只保证当前进程内重放；C7 须持久化、审批及执行全部 blocker。多张与姿势自由提示词未接线有明确决策 blocker，不能忽略。
- 历史重试不能用当前模板常量补造证据；有真实模板凭证和完整原分镜的裤装任务可以缺 seed，仍须保持原摘要和计划。所有生成/重试均只允许 Grsai，不自动改写旧模型。

## Agent B6/C7/C11 本地接线约定（2026-09-17）

- 本批接口与验收见 `docs/agent-b6-c7-c11-acceptance.md`；继续只在本地开发。后续发布仍指向上方「测试站验收与生产发布流程」。下一批为 C8 → C9 → C13 → C12，新主循环尚未启用。
- B6 `buildStagedPrompt` 输出带阶段版本的 A2 请求快照，必须通过 `recordThenInvoke` 先强写再调用；完整保留 P0，动态图片/工具/历史内容不能升为指令。
- C7 必须使用持久化 `FileTaskPreparationArtifactStore` 和 `ApprovalStore`；`authenticate`/`readAuthenticatedIntent` 由已验证的服务端请求注入，不接受模型自证同意。生成沿用旧 `agent-beta:${sessionId}:${messageId}` 幂等键，不因编辑/切换 feature flag 产生新调用身份。
- 当前预览版本检查与 `STARTING` 强写通过 `withCurrent` 共用工件锁；该 callback 内不得重入工件仓储。STARTING 是接受本次动作的边界，其后编辑不能撤销已接受调用。锁仅保证当前 Node 进程，不是跨进程互斥。
- `GenerationTask.agentExecution` 必须跨 JSON/TaskRepo row 往返保留。Agent 创建/重试用专用 prepared 入口，photo-fission 传服务端 `preparedPlan` 跳过 Planner；旧恢复器不得自动重跑 Agent 中断任务，旧重试/变体入口不得绕开原批准。
- 多张、姿势自由提示词 blocker 继续硬拦；只允许 Grsai 和执行器当前支持的模板版本。真实模板证据来自原任务参数或已保存凭证，不能用当前常量补造旧账。
- C11 验证 `status=passed` 仍为 `authorization:not_granted`；旧 schema 只显式适配并记录返回 telemetry。C8 结果准入未完成前，不把 SUBMITTED/pending 当成功或将结果直接放上画布。
- 抠图当前仅 garment；结果指向同源图片 API。持久化引用不代表恢复了底层 60 分钟内存会话，失效时不得静默重新调用供应商。

## Agent C8 post-submit / result-admission 本地约定（2026-09-17）

- `ControlledTaskGateway` 的付费任务返回后必须先调用 `PostSubmitPort` 强写 C8 证据，再更新 ActionLedger；pending/running 只表示已提交。任务身份、owner、feature、params/input 顺序或冻结执行凭证不符时写 `BLOCKED_POST_SUBMIT + QUARANTINED`，不退款、删除或重提。
- 结果刷新通过 `ResultAdmissionPort`，只读取 Task/Asset、历史冻结工件、真实审批和 C8 证据。锁顺序固定为 **ActionLedger → Beta user file → C8 artifact/approval/evidence**；调用方把已持锁的 ledger context 传入，准入器不得再次获取同一本账锁。
- `actionAdmissionFacts.common.params` 必须复用共享 `paramsDigestPayload(featureType, task.params)`；只归一化 TaskParams 明确声明的可选字段，不复制字段清单、不用 JSON 往返跳过任意非法值，strict canonical 继续拒绝未声明 `undefined` 与非 JSON 输入。
- `GenerationTask.agentExecution.attempts` 只由服务端创建/重试边界追加，记录 actionKind/requestDigest/idempotencyKey/shotIds/attempt/有序 priorResultAssetIds。旧记录允许缺失，不得根据 `shotProgress.retryAttempt` 或当前常量补造历史。历史 attempt 的重复查询只比较自身冻结结果窗口、下一窗口边界和共同执行绑定；后续合法 retry 完成不得因共享 aggregate status/结果追加而误隔离旧窗口。
- Beta 对真实 photo/pose retry 参数不得假定存在 `userPrompt/prompt`；只有当前任务参数提供非空字符串时才覆盖，否则 GET/PATCH/send 保留原 `plan.prompt`。
- pending/running 不发布结果；终态只有 `ADMITTED` 的安全视图可上画布，URL、文件名和尺寸来自本次已鉴权 `AssetRecord`。已 ADMITTED 仍须每次重查；合法签名 URL 轮换继续准入并返回新 URL，资源删除、改属、URL 不安全、尺寸/不可变身份或有序 result/shot 绑定变化后永久隔离。
- legacy 继续读旧写新且不补造批准；v1 UNKNOWN/STARTING/VERIFYING、缺任务和既有隔离不能凭 task success 解禁。C8 未改变单张批准、Grsai-only、多张/姿势自由提示词 blocker 或既有积分边界。
- Kiro 本地自测记录见 `docs/agent-c8-acceptance.md`；仍须 Codex 再次独立核对白名单、基线与验收结果。本轮不启动 C9/C13/C12。
