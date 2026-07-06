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

