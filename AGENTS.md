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
