# garment-detail 后端接入 — 技术设计备忘

> 配套 PRD：本目录 prd.md（v1.0）。本文件记录实施期的关键技术判断。

## 现状勘察结论（主会话亲自核对）

### 已有可复用件（已验证签名/行为）

- `lib/types.ts`
  - `ResultAsset` 已含 `label / shotId / finalPrompt / metadata / thumbnailUrl` — PRD §13 无需改类型，只需 pipeline 填充。
  - `ShotProgressStatus = prompting|generating|retrying|success|failed|cancelled`，与 mock 前端渲染兼容。
  - `FEATURE_WORKFLOWS['garment-detail']` 当前为 `garment_detail_mock_v1`，需改 `garment_detail_v1`。
  - `GarmentDetailParams` 已含全部前端字段 + `mockRetryCount`（后端接入后删除/忽略）。
- `lib/server/task-store.ts`
  - `createTask` → `normalizeTaskParams()` 按 featureType 分发；garment-detail 目前直接 return params（未归一化）。
  - `runTask` 流式持久化开关 `useStreamingPersist = isPhotoFission || isPoseFission`（L963）；pose-fission 走 task-store 内直连 pipeline 分支（L979-993），garment-detail 应照此模式新增 `isGarmentDetail` 直连分支，**不进 runThirdPartyWorkflow**（PRD §20.3 要求显式分流，避免落入 BackgroundReplace 分支）。
  - `persistOneResult(taskId, result, ownerUserId)` 已实现「下载→sharp→OSS→缩略图→AssetRecord→task.results 增量更新」，persistSemaphore 控并发（默认 4，`RESULT_PERSIST_CONCURRENCY`）。
  - `resolveTaskCompletion` 需加 garment-detail 分支（按 `params.detailShots.length` / `resultCount` 判 partial）。
  - `buildInitialShotProgress` 需加 garment-detail 分支（按归一化后的 detailShots 建 `detail_1..N`，初始 `prompting`）。
  - `taskTargetsGeminiFamily` 需按 `params.resolvedModelId` 判断（gemini-*/nano-banana-* 走 URL 透传）。
  - `retryPhotoFissionShots`（L1722）是 retry 模板：ownership 伪装 404、状态门禁 partial/failed、planned ids 校验、已成功 shot 拒绝、流式合并、resolveTaskCompletion 收尾。新增 `retryGarmentDetailShots` 同构。
- `lib/server/task-recovery.ts`
  - `getPlannedUnitIds` 只认 photo-fission（shotPlan）/ pose-fission（poses）；需加 garment-detail → `params.detailShots[].shotId`。
  - 幂等键 `executionKey = taskId:recovery:N:ids` 已通用，无需改。
- `lib/server/image-provider-pool.ts`
  - `getAvailableProvidersForModel(model)` 已存在 — 注册表「档位是否有可用上游」直接用它。
  - 模型族判断：`isGrsaiImageModel`（nano-banana-*）、`isQiniuImageModel`/`isLaozhangImageModel`（gpt-image-*）、`isGoogleImageModel`（gemini-*）。
- `app/api/tasks/route.ts` POST 已做 featureType 校验 + `estimateTaskUnits`；garment-detail 走 `resultCount` 分支即可，但归一化在 createTask 内完成，估算应在归一化后或由 normalize 保证 resultCount 正确。
- `app/api/tasks/[taskId]/retry-shots/route.ts` 目前只调 `retryPhotoFissionShots`；需按 task.featureType 分发到 `retryGarmentDetailShots`。

### Mock 契约（后端必须逐字对齐）

`lib/garment-detail-mock.ts` `buildGarmentDetailShots(category, referenceAssetIds)`：

- 无参考图 → `[{ shotId: 'detail_1', label: parts[0], referenceAssetId: null }]`
- 有参考图 → 每张参考图一个 shot：`shotId = detail_${i+1}`，`label = parts[i % 3]`，`referenceAssetId = 该参考图`
- parts 表与 PRD §5.3 一致：tops=[领口细节,袖口细节,面料纹理] bottoms=[腰头细节,走线细节,面料纹理] dress=[领口细节,裙摆细节,面料纹理] accessory=[材质特写,工艺细节,质感纹理] shoes-bags=[五金细节,走线细节,材质特写]

服务端 normalize 必须用同一张表重新生成 detailShots（不信任客户端）。

### 模型注册表设计

- `lib/server/garment-detail-model-registry.ts`：
  - 静态描述 std-v1 / pro-v1（名称、tier、resolutions、文案、估时，对齐 mock 的 `GARMENT_DETAIL_MODELS` 响应形态）。
  - 候选模型顺序从 `GARMENT_DETAIL_STANDARD_MODELS` / `GARMENT_DETAIL_PRO_MODELS` 读，缺省用 PRD §6.2 默认值。
  - `resolveGarmentDetailModel(algorithmModelId)` → 按候选顺序取第一个 `getAvailableProvidersForModel(m).length > 0` 的模型；都没有 → 抛 MODEL_UNAVAILABLE。
  - `listAvailableGarmentDetailModels()` → /api/garment-detail/models 的数据源。
- `GARMENT_DETAIL_BACKEND_ENABLED=0` 时：/api/tasks 拒绝 garment-detail（前端仍有 mock 兜底）；models 接口可返回但前端不用。阶段二打开。

### 分类器设计

- `lib/server/garment-detail-classifier.ts`：assetId → 所有权校验（404 语义）→ 取图（OSS key 认证下载/安全下载器，复用 task-store 的解析思路，注意不要把 base64 写日志）→ 阿里云 SegmentCloth 7 类一次请求 → 按 PRD §7.2 映射表归类 → 超时（`GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS`，默认 15000）/任何异常 → fallback 响应（status:'fallback', needsConfirmation:true）。
- dress 判定：tops + skirt 同时出现且区域连续（MVP 可简化为 tops+skirt 同时命中即建议 dress，置信度取较低者，标注 needsConfirmation）。

### 生成管线设计

- `lib/server/garment-detail-service.ts` `runGarmentDetailPipeline()`：
  - 从 task 快照读 `resolvedModelId`（normalize 时固定），provider chain = `getRotatedProvidersForModel(resolvedModelId)`，逐 provider failover（同模型多渠道），**不跨模型切换**。
  - 并发 = `GARMENT_DETAIL_CONCURRENCY`（默认 2）的简单 worker-pool，每 shot：`runImageEditViaProvider({ model: resolvedModelId, count: 1, inputImages: [main, (ref)], aspectRatio, imageSize: resolution.toUpperCase() })`。
  - 每 shot 成功 → onShotResult 流式持久化（task-store 侧复用 persistOneResult）。
  - finalPrompt 写入 ResultAsset；metadata 按 PRD §13 填全。
  - demo 模式（IMAGE_API_DEMO=1）：在 service 内返回占位图（参考 runDemoWorkflow），保留统一演示能力。
  - `targetShotIds` 过滤用于重试/恢复；`signal` 贯穿取消。

### Prompt 模板

- PRD §10.2 模板原样落地为 `lib/server/garment-detail-service.ts` 内常量（或 prompt-templates 目录），`{DETAIL_LABEL}` / `{REFERENCE_RULE}` / `{USER_PROMPT}` 三处插值；`GARMENT_DETAIL_PROMPT_VERSION` 默认 `garment-detail-v1` 写入 params.promptTemplateVersion。
- userPrompt 为空时【用户附加要求】段写「无」。

### 前端去 Mock 要点（PRD §21）

- `fetchGarmentDetailModels()` → `GET /api/garment-detail/models`（前端 api client 替换实现，保留返回类型）。
- 主图上传完成 → `POST /api/garment-detail/classify`，fallback 时保持表单可用。
- workbench 删除 `mock-gd-` 全部分支（创建/tick/轮询跳过/取消/删除/重试），garment-detail 走统一 `/api/tasks` 提交；`getInputAssetDescriptors()` 补 garment-detail 分支（主图 + 非空参考图按序）。
- `lib/garment-detail-mock.ts` 与测试在后端上线后删除（或保留 buildGarmentDetailShots 纯函数到共享位置？——后端 registry/service 自带一份，前端如仍需本地预览 shots 可从 types 派生；决策：删除 mock 模块，shots 由服务端归一化后下发，前端进度卡直接读 task.shotProgress）。

### 环境变量（.env.local 需补）

```
GARMENT_DETAIL_BACKEND_ENABLED=1
GARMENT_DETAIL_STANDARD_MODELS=nano-banana-2-lite,gemini-3.1-flash-image-preview
GARMENT_DETAIL_PRO_MODELS=nano-banana-pro,gemini-3-pro-image-preview,gpt-image-2
GARMENT_DETAIL_CONCURRENCY=2
GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS=15000
GARMENT_DETAIL_PROMPT_VERSION=garment-detail-v1
```

### 测试

- node --test 原生 TS：被测模块间运行时 import 必须带 `.ts` 扩展名 + `@ts-expect-error`；对 `./types` 只能 `import type`。
- 新增 `garment-detail-service.test.ts`（normalize/shot 规划/prompt 构建）与 `garment-detail-classifier.test.ts`（映射表 + fallback）。
- 命令：`node --test lib/server/garment-detail-service.test.ts` 等；全量 `pnpm typecheck && pnpm lint`。

---

## 测试站联调验收记录（2026-08-16，http://121.40.34.214:3100）

联调账号：`gdtest01` / `gdtest02`（邀请码 GDTEST26/27 直接写入 `.preview-runtime/data/invite-codes.json`，注意邀请码仓储有一次性内存缓存，直改文件需 `pm2 restart yibai-preview`）。

| 验收项 | 结果 |
| --- | --- |
| GET /api/garment-detail/models 未登录 | ✅ 401 |
| models 返回 std-v1(1k) + pro-v1(2k/4k) | ✅ 与 PRD §7.1 一致 |
| classify 纯色图 | ✅ fallback 200 不阻塞 |
| classify 真实白T | ✅ ok + candidates + requestId（2~3s） |
| classify 不存在/越权 assetId | ✅ 404 ASSET_NOT_FOUND |
| 伪造字段提交（refCount=99/credits=999/fake shot） | ✅ 服务端全部重建覆盖 |
| std-v1 1k 无参考图 | ✅ 1 张 1024×1024，nano-banana-2-lite，~5s |
| pro-v1 2k + 2 参考图 | ✅ 2 张 1792×2400，逐 shot 绑各自参考图，同任务模型固定 nano-banana-pro，缩略图生成，流式进度 72→83→100 |
| 生成图目检 | ✅ 白T领口特写，颜色/走线保持，无凭空 Logo |
| pro-v1 + 1k | ✅ 400 RESOLUTION_UNSUPPORTED |
| 非法分类 | ✅ 400 INVALID_PARAMS |
| 越权素材创建 | ✅ 400 不存在语义 |
| 取消运行中 4K 任务 | ✅ cancelled，shot 标 cancelled，0 结果保留 |
| 单张结果删除 | ✅ 删后任务保留、results 同步 |
| success/cancelled 任务 retry | ✅ 拒绝「仅 partial / failed 可重跑」 |
| 跨用户读任务 / classify 他人素材 | ✅ 均 404 |
| 单元测试 | ✅ 59/59（service 24 + classifier 12 + 回归 23） |
| tsc / eslint（变更文件） | ✅ 0 error |

### 联调中发现并修复的问题

1. **分类面积测量失真（严重）**：SegmentCloth 按类返回 1 通道灰度 mask（无 alpha），原实现 `ensureAlpha()` 读 alpha 通道恒 255 → 全类别 score=1。已改为 `toColourspace('b-w')` 灰度阈值测量，并把 score 归一化为「命中面积份额」（0~1，对齐 PRD 置信度语义）。
2. **dress 误建议**：白T 会同时命中 tops+skirt，原实现必置顶 dress。加「skirt 面积 ≥ tops×0.4」门限近似 PRD 的「区域连续」。
3. **全仓 `pnpm lint` 红是既有环境问题**：38 errors 全部来自 `.claude/worktrees/*` 与 `.next-preview/*` 垃圾目录（非本次改动文件；stash 基线 lib/+app/ 0 error）。建议后续把这些目录加进 eslint ignore（未在本任务处理）。
4. 既有 rot（非本次引入）：`aliyun-cutout-adapter.test.ts` 等 3 个老测试因 `@/lib` 别名在裸 node --test 下本就跑不了。

### 未覆盖 / 后续

- 真实 partial + retry-shots 合并路径只做了门禁冒烟（无法低成本制造单 shot 失败），逻辑由单测覆盖。
- 5 类样本 × 多模型冒烟矩阵（PRD §22.3）留待测试站体验验收时人工过。
- 生产发布待用户确认：`pnpm build && pm2 restart yibai-fission`（铁律：只允许准备发布时 build）。
