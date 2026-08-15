<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 开发测试站（pm2 yibai-preview，2026-08-15 起）

- **访问入口**：`http://121.40.34.214:3100`（需阿里云安全组放行 TCP 3100）；另有一条备用的 nginx 反代 `/etc/nginx/conf.d/yibai-preview.conf`（`preview.jjwlai.cn:80 → 127.0.0.1:3100`，DNS 就绪后可用）
- **进程管理**：`ecosystem.preview.config.cjs`（pm2 名 `yibai-preview`），`next dev` 热更新——代码保存即生效，无需 rebuild；开机自启已随 `pm2 save` 固化
- **与生产完全隔离**：cwd 在 `.preview-runtime/`（data/、public/、logs/ 都在这里），不碰生产 `data/fashion-mvp-store.json`；`STORAGE_MODE=local` 强制测试上传不进 OSS；`NEXT_PREVIEW_DIST_DIR=.next-preview` 让 dev 构建与生产 `.next` 分离
- **账号**：搭建时从生产 `data/users.json` + `invite-codes.json` 复制了一次，登录密码与生产一致；之后两边独立演进
- **容量**：dev 实例较吃内存（上限 3072M）；4C/8G 上生产 + 测试站 + dsh 共存已实测 OK，但测试站上别跑大批量生图
- **收尾注意**：改配置后 `pm2 delete yibai-preview && pm2 start ecosystem.preview.config.cjs`（restart 不更新 env/node_args）；不用了 `pm2 delete yibai-preview && pm2 save`，并同步删 nginx 反代配置

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



## 高清放大细节图（garment-detail）约定（2026-08-15，前端界面先行）

- 第四功能 feature id `garment-detail`，当前为**纯前端 mock**：不接 `/api/tasks`，任务由 `lib/garment-detail-mock.ts` 的纯函数时间轴（`createGarmentDetailMockTask` / `advanceGarmentDetailMockTask` / `retryGarmentDetailMockTask` / `cancelGarmentDetailMockTask`）本地推进，workbench 600ms tick 驱动
- **mock 任务 taskId 前缀 `mock-gd-`**：workbench 的 loadTask 轮询、取消、单张删除都要按此前缀走本地分支；loadTasks 合并时 mock 任务必须保留（服务端没有）
- 模型版本列表走 `fetchGarmentDetailModels()` mock 下发（FR-6 形态），前端不硬编码档位；后端就绪后整体替换为 PRD §6 接口并删除 mock 模块
- 演示失败路径：提示词含「失败」→ 审核拒绝（AUDIT_REJECTED）；重试后走成功路径（params.mockRetryCount）
- 结果预览用 `garment-detail-compare.tsx`：滚轮/按钮缩放 + 拖拽平移 + 原图对比双窗格；局部定位框留待后端接入
- **node --test 原生跑 TS 的坑**：被测模块对 `./types` 只能 `import type`（运行时 import 必须带 `.ts` 扩展名，否则 ERR_MODULE_NOT_FOUND）；类型/常量的运行时副本在 mock 模块内本地维护并注释同步来源
