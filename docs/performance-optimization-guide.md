# 5 人并发生图容量指南

## 当前容量模型

- 生产机为 4 vCPU / 8GB RAM，Next.js 使用 PM2 单实例 `fork` 运行。
- 上游只有“老张”一个渠道，但配置了 6 个逻辑 Provider 入口。老张未对本项目设定并发上限，但这 6 个入口不能当作 6 个独立上游或 6 倍配额。
- `store.json` 由单进程持久化，未迁移数据库前禁止开启 PM2 cluster 或多实例。

## 生产起步参数

```env
IMAGE_GLOBAL_CONCURRENCY=12
IMAGE_PER_USER_CONCURRENCY=3
IMAGE_PER_PROVIDER_CONCURRENCY=2
IMAGE_QUEUE_MAX_PENDING=200
PHOTO_FISSION_CONCURRENCY=4
POSE_FISSION_CONCURRENCY=2
```

这组参数的含义是：全站最多同时执行 12 个生图单元，每个用户最多占 3 个，每个老张逻辑入口最多占 2 个。大片和姿势裂变的内层 worker 仍必须经过全局调度器，不会把 5 个用户放大成 50 个在途请求。

调度器每 2 秒采样内存：

| 进程 RSS / 系统内存 | 动态上限 | 行为 |
| --- | ---: | --- |
| RSS < 2.2GB | 12 | 正常调度 |
| RSS 2.2–2.8GB | 8 | 限流 |
| RSS 2.8–3.2GB | 4 | 暂停新 4K 单元 |
| RSS > 3.2GB 或可用内存 < 1.5GB | 0 | 内存保护，只等待在途单元结束 |

## 进程与网关保护

- PM2 使用 `--max-old-space-size=2560`，RSS 达到 `3072M` 时重启，`kill_timeout=15000`，并显式发送 `SIGTERM`。
- Nginx `worker_connections` 设为 4096，`client_max_body_size` 设为 8MB，与应用的 7.5MB 单图上限对齐。
- `/api/tasks` 和姿势重试路由保留 600 秒超时；普通 API 使用 60 秒，页面请求使用 120 秒。
- watchdog 只在 Web 进程无响应时立即自愈。OSS 或 Provider 异常只告警，不通过重启掩盖上游故障。
- watchdog 用 OOM 日志签名去重；RSS 连续 3 分钟超过 3GB 时，会先查 `/api/health/capacity`，只在无在途生图时优雅重启。容量接口需管理员鉴权，如需 watchdog 自动访问，通过 `WATCHDOG_CAPACITY_COOKIE` 注入管理员 Cookie，不要写进仓库。
- `backup-store.sh` 每小时备份后会立即解析 JSON，失败时保留坏副本并以非零状态退出；磁盘达到 75% 只告警，达到 85% 才清理最老备份。每天 00 点会再次验证最新备份后再上传 OSS。
- Swap 仅用于吸收突发内存压力，建议 `vm.swappiness=10`。部署时先用 `sysctl vm.swappiness` 检查；确认变更窗口后再由运维执行 `sudo sysctl -w vm.swappiness=10`，并在 `/etc/sysctl.d/99-yibai-memory.conf` 写入 `vm.swappiness=10` 后运行 `sudo sysctl --system`。应用部署脚本不会自动修改系统参数。

## 观测与调参

管理员可访问 `GET /api/health/capacity` 查看全局在途数、排队数、活跃用户、动态并发上限、RSS 和各逻辑 Provider 槽位。服务端同时每分钟输出一条 `[image-capacity]` 脱敏结构化日志，只包含并发、队列、内存和 Provider 聚合数据，不包含 prompt、图片 URL、素材 ID 或密钥。生产首次上线按以下顺序验收：

1. 先用 2 个用户混合提交单张、大片和姿势任务。
2. 扩大到 5 个用户，确认全局在途不超过 12、每用户不超过 3、每逻辑入口不超过 2。
3. 连续观察至少 2 小时，确认无 OOM、无意外 PM2 重启，峰值 RSS 低于 3.2GB，系统可用内存高于 1.5GB。
4. 只有在上述指标稳定至少一天后，才可将全局并发从 12 提到 14，再独立观察一天。

如果 CPU 长时间超过 75%、RSS 持续超过 2.8GB，或 5 人高峰时首张启动 P95 超过 30 秒，优先升级到 8C16G，不要继续在 4C8G 上硬抬并发。
