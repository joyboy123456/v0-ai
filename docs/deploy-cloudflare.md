# Deploy: Cloudflare Backend (R2 + D1 + KV) on Mac mini

> 任务来源：`.trellis/tasks/05-19-cloudflare-backend-foundation/prd.md`
> 阶段：MVP 给客户试用，**月成本目标 0 元**，5 个内测账号。

本文档面向「从零部署到 Mac mini」的工程师，**只覆盖 PR1 产物**（基础设施 + migration + seed），
PR2-PR4 的应用层接入（认证、storage adapter、route 鉴权）等后续 PR 各自补充。

---

## 1. 架构总览

```
[5 个客户的浏览器（公网）]
   ↓ HTTPS
[trellics 杭州中转 / 内网穿透]
   ↓
[Mac mini (macOS arm64)]
   └─ pnpm start  ── Next.js 16 App Router (Node.js runtime)
      ├─ R2  via S3-compatible API（aws4fetch）
      ├─ D1  via HTTPS REST API
      └─ KV  via HTTPS REST API
            ↓
      [Cloudflare 边缘网络]
```

**关键设计原则**：Mac mini 是 stateless workhorse，**所有持久化数据都外置到 Cloudflare**。
本机不存数据库 / 用户上传 / 生成结果（除非 `STORAGE_MODE=local` 走老路径调试）。

---

## 2. 前置要求

1. **Cloudflare 账号已绑卡**
   即使全部走免费额度，R2 / D1 / KV 也强制要求账号是「Workers 付费计划」之外的「免费 + 已绑卡」状态。
2. **wrangler CLI 已通过 OAuth 登录**
   ```bash
   wrangler login          # 浏览器跳转完成 OAuth
   wrangler whoami         # 应显示已登录 + 账号 ID
   ```
   ⚠️ **不要**在项目 `.env.local` 中保留未注释的 `CLOUDFLARE_API_TOKEN`：
   wrangler 4.x 会自动读 `.env.local`，token 会覆盖 OAuth，且通常权限不够导致 D1/KV 命令失败。
   应用端调用 Cloudflare REST API（PR2-PR4）会用一个**单独的** token（`CLOUDFLARE_D1_KV_TOKEN`），与 wrangler CLI 用的 token 解耦。
3. **项目 `.env.local` 已填齐 Cloudflare 凭证**
   参考下文「环境变量清单」一节，未填齐的 key 会让 PR2-PR4 启动时早 fail。
4. **trellics 杭州中转已配好**
   公网入口（trellics → Mac mini 内网端口）超出本文档范围，由用户自己保管。

---

## 3. 资源现状（PR1 已执行）

> 以下命令已由 main agent 在 PR1 执行完毕。这里列出**已发生**的事实，方便复现或在新账号上重做。

### 3.1 D1 数据库

```bash
wrangler d1 create yibai-fission-db
# → database_id = b7003728-393e-435e-ab29-20c801e642c7
```

### 3.2 KV 命名空间

```bash
wrangler kv namespace create yibai-session
# → id = f0aae58609de43dcb38a7a40d362ceb4
```

### 3.3 R2 bucket + 30 天 Lifecycle Rule

- bucket 名：`sujie`（APAC region，已开通公共访问 `https://pub-c58e7a0926c3427c81de37c4ba7d17be.r2.dev`）
- Lifecycle Rule 名：`auto-cleanup-30d`，规则：「30 天后删除所有对象」

控制台路径：**Cloudflare Dashboard → R2 → sujie → Settings → Object lifecycle rules**

> 30 天清理是 D4 决议（PRD）：10GB 免费额度 vs 5 人 × 3GB/月 永久会在第 3 个月爆，自动清理让占用稳定在 ~3GB。

---

## 4. 执行 migration & seed

### 4.1 创建 schema

```bash
wrangler d1 execute yibai-fission-db --remote --file=migrations/0001_init.sql
```

预期输出：3 张表（`users` / `tasks` / `assets`）+ 2 个索引创建成功。

> 注意 `--remote` 标志：D1 默认本地模拟器与生产隔离；不加 `--remote` 改的是本地 SQLite 文件而不是 Cloudflare 上的真表。

### 4.2 生成 seed SQL

```bash
node scripts/seed-d1-users.mjs
```

预期输出：

```
[seed-d1-users] wrote 5 users to <repo>/migrations/0002_seed_users.sql
[seed-d1-users] usernames: user01, user02, user03, user04, user05
[seed-d1-users] password (all): 123456
```

脚本只生成 SQL，**不联网**。每次运行 bcrypt 重新计算（盐随机），所以 git diff 每次都会变；
但 SQL 用 `INSERT OR IGNORE`，已存在的 username 不会被覆盖，可重复运行。

> 这个文件**不要 commit**：每次运行结果不一样且密码 hash 是敏感信息，应加到 `.gitignore`（PR2 改）。

### 4.3 写入 5 个测试账号

```bash
wrangler d1 execute yibai-fission-db --remote --file=migrations/0002_seed_users.sql
```

### 4.4 验证

```bash
wrangler d1 execute yibai-fission-db --remote --command="SELECT username, display_name FROM users ORDER BY username"
```

预期：返回 5 行 `user01 ~ user05` + `测试账号 01 ~ 05`。

---

## 5. 环境变量清单（`.env.local`）

完整占位符见 `.env.example`，部署时必须填齐的 Cloudflare 相关 key：

| Key | 来源 | 说明 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard 右下角 / `wrangler whoami` | 应用端调 REST API 用 |
| `CLOUDFLARE_API_TOKEN` | **保持注释或留空** | wrangler 走 OAuth 即可；填了会覆盖 OAuth 导致 D1/KV 失败 |
| `CLOUDFLARE_D1_KV_TOKEN` | Dashboard → My Profile → API Tokens → Create | 权限：D1 Edit + KV Edit，应用端专用 |
| `R2_ACCESS_KEY_ID` | R2 → Manage R2 API Tokens | S3-compatible Access Key |
| `R2_SECRET_ACCESS_KEY` | 同上 | S3-compatible Secret Key（只在创建时显示一次） |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | 用 account id 拼 |
| `R2_BUCKET` | `sujie`（固定） | PR1 已创建 |
| `R2_PUBLIC_URL` | `https://pub-c58e7a0926c3427c81de37c4ba7d17be.r2.dev` | R2 bucket → Settings → Public access |
| `D1_DATABASE_ID` | `b7003728-393e-435e-ab29-20c801e642c7` | PR1 已创建 |
| `D1_DATABASE_NAME` | `yibai-fission-db`（固定） | 同上 |
| `KV_NAMESPACE_ID` | `f0aae58609de43dcb38a7a40d362ceb4` | PR1 已创建 |
| `STORAGE_MODE` | `local` 或 `cloud` | 部署到 Mac mini 服务客户时填 `cloud`；本地开发 `local` |

其余非 Cloudflare 的 env（`GOOGLE_API_KEY` / `IMAGE_PROVIDERS` 等）见 `.env.example` 注释。

---

## 6. Cloudflare 控制台需手动确认的事项

PR1 已自动化的部分都列在 §3，但 R2 Lifecycle Rule 是通过 wrangler 写入的；
**部署前请人工核对一次**，避免规则被误删导致免费额度爆掉：

1. 进入 **R2 → sujie → Settings → Object lifecycle rules**
2. 确认存在名为 `auto-cleanup-30d` 的规则
3. 规则范围：作用于 bucket 内**所有 prefix**
4. 动作：`Delete uploaded objects` after `30` days

如果规则丢失，重新执行：

```bash
wrangler r2 bucket lifecycle add sujie \
  --id auto-cleanup-30d \
  --expire-days 30
```

---

## 7. Mac mini 启动

```bash
pnpm install
pnpm build
pnpm start          # 监听 3000，由 trellics 转发到公网
```

> **PM2 / launchd 守护进程配置**留给 PR5（端到端验证 + 守护）。当前 PR1 阶段手动 `pnpm start` 就够调试 PR2-PR4。

---

## 8. trellics 配置（TODO）

杭州中转 + Mac mini 内网穿透由用户自己保管。本文档不展开细节。

> 关键约束：
> - 客户域名走 HTTPS（Cloudflare 控制台已签发证书）
> - trellics 转发的目标是 Mac mini 的 `127.0.0.1:3000`
> - 保持 long-lived connection 以支持 SSE / 长轮询任务进度

---

## 9. 回滚方案

如果 Cloudflare 链路有问题（D1 抖动 / R2 区域故障 / token 失效），
**临时回退**：

```bash
# .env.local
STORAGE_MODE=local
```

重启 Next.js：

```bash
pnpm start
```

回退后行为：
- 任务记录写回 `data/fashion-mvp-store.json`
- 上传图 / 生成图写回 `public/generated/**`
- 不需要 Cloudflare 凭证就能跑（除了 Google / Qiniu 的图像 API key）

> 这是 D6 决议保证的：fresh start + 双路径并行，切回去随时回到原行为。

---

## 10. 后续 PR 关联

| PR | 范围 | 文档 |
|---|---|---|
| PR1 ✅ | 资源 + migration + seed + 本文档 | 本文 |
| PR2 | `/login` + `/api/auth/**` + `lib/server/auth.ts` + middleware | 待 PR2 补 |
| PR3 | `storage-adapter.ts` + `task-store.ts` 双模式 | 待 PR3 补 |
| PR4 | `app/api/**` 路由接入 `userId` 鉴权 + R2 用户隔离 prefix | 待 PR4 补 |
| PR5 | 端到端验证（user01 / user02 隔离）+ PM2 守护 | 待 PR5 补 |
