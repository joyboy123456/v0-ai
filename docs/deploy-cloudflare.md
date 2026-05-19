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
| PR5 ✅ | 端到端验证（user01 / user02 隔离）+ PM2 守护 | 见 §11 ~ §14 |

---

## 11. 客户压测前的最后 4 步（推荐睡醒后顺序执行）

> 由 PR5 收尾。前 4 个 PR 已经把代码改造完了，本节是「打开开关 → 验证 → 对外开放」的最后清单。
> 全程预计 15 分钟。

### Step 1: 生成 Cloudflare D1+KV API Token（5 分钟）

应用端调 D1 / KV 走 REST API，需要一个与 wrangler OAuth 解耦的专用 token。
**强烈推荐用 Custom token**（只给最小必要权限），不要用「Edit Cloudflare Workers」模板（权限过大）。

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点 **Create Token** → **Get started**（Custom token）
3. 起名 `yibai-fission-d1-kv`
4. **Permissions** 加两行：
   - `Account` → `D1` → `Edit`
   - `Account` → `Workers KV Storage` → `Edit`
5. **Account Resources**：选择 `Include` → 你的账号
6. **TTL**：建议留空（不过期）；如果你坚持设有效期，请在 .env.local 里加一条到期日提醒
7. 点 **Continue to summary** → **Create Token** → 复制 `cfat_xxxx` 形式的 token

⚠️ token 只显示一次，复制后立刻贴到 .env.local；遗失只能重新生成。

### Step 2: 写入 `.env.local` 并切到 cloud 模式

在 `.env.local` 修改/确认两行：

```
CLOUDFLARE_D1_KV_TOKEN=<刚才复制的 cfat_xxxx>
STORAGE_MODE=cloud
```

⚠️ 同一文件中的 `CLOUDFLARE_API_TOKEN`（如果存在）应保持**注释**或留空。
原因详见 §2 前置要求 —— wrangler 4.x 会优先读 `.env.local` 中的 token 覆盖 OAuth，导致 wrangler 命令失败。

### Step 3: 启动服务

```bash
# 进入项目根目录（Mac mini 实际路径请用 pwd 确认）
cd ~/xinman/dianshang/v0-ai

# 安装依赖（如果 node_modules 已存在可省）
pnpm install

# 编译生产版本（约 1-2 分钟）
pnpm build

# 创建 PM2 日志目录
mkdir -p logs

# 通过 PM2 启动
pm2 start ecosystem.config.cjs

# 保存当前进程列表，重启时 PM2 会自动恢复
pm2 save

# 设置开机自启（macOS launchd），按提示复制输出中的 sudo 命令并执行
pm2 startup
```

启动完成后可用 `pm2 status` 查看状态、`pm2 logs yibai-fission` 跟踪日志。

> 如果 ecosystem.config.cjs 里的 `cwd` 与 Mac mini 实际路径不一致，
> 编辑该文件把 `cwd` 改成真实路径再 `pm2 start`。

### Step 4: 5 分钟端到端验证

下面 6 条 curl 全部复制粘贴执行，任何一条结果不符合「期望」就停下来排查。

```bash
# 1) Health check —— 整个系统是否活着
curl -s http://localhost:3000/api/health | jq
# 期望: { ok: true, storageMode: 'cloud', services: { d1: 'ok', kv: 'ok', r2: 'ok' }, ... }
# 如果 d1/kv/r2 任一显示 'error: ...'：
#   - error: CONFIG_MISSING ... → .env.local 缺 env，对照 §5
#   - error: HTTP 401/403 → CLOUDFLARE_D1_KV_TOKEN 权限不对，回 Step 1 重发
#   - error: NETWORK_ERROR → Mac mini 网络/出口/防火墙问题

# 2) 用 user01 登录并拿 cookie
curl -s -c /tmp/cookies-u1.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user01","password":"123456"}' | jq
# 期望: { ok: true, user: { id: '...', username: 'user01', displayName: '测试账号 01' } }
# 如果返回 401 INVALID_CREDENTIALS：D1 中没有 user01，回 §4 跑 seed
# 如果返回 500 CONFIG_ERROR：CLOUDFLARE_D1_KV_TOKEN 没配或权限不够

# 3) 用刚拿到的 cookie 查当前用户
curl -s -b /tmp/cookies-u1.txt http://localhost:3000/api/auth/me | jq
# 期望: { ok: true, user: { id: '...', username: 'user01', ... } }

# 4) 列出当前用户任务（fresh start 应该为空）
curl -s -b /tmp/cookies-u1.txt http://localhost:3000/api/tasks | jq
# 期望: [] 或 { tasks: [] }（fresh start 后没有任务历史）

# 5) 验证未登录被拒（不带 cookie）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks
# 期望: 401

# 6) 切到 user02 并验证看不到 user01 的任何任务
curl -s -c /tmp/cookies-u2.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user02","password":"123456"}' | jq
curl -s -b /tmp/cookies-u2.txt http://localhost:3000/api/tasks | jq
# 期望: 列表为空（user02 也是 fresh）
# 之后浏览器打开 https://<trellics 域名>/login，分别用 user01 / user02 跑生图，
# 互相看不到对方任务即视为数据隔离生效。
```

上述 6 条全部符合期望 → 可对外开放给客户。

---

## 12. 在 Cloudflare 控制台验证数据真的写到云端

跑过一次完整的生图任务（前端操作）之后：

1. 打开 https://dash.cloudflare.com → R2 → `sujie` bucket → Objects
2. 应该看到形如下面的对象 key：
   ```
   users/<user01-uuid>/uploads/...png
   users/<user01-uuid>/generated/...png
   ```
3. 进入 D1 → `yibai-fission-db` → Console，执行：
   ```sql
   SELECT
     username,
     (SELECT COUNT(*) FROM tasks WHERE tasks.user_id = users.id) AS task_count,
     (SELECT COUNT(*) FROM assets WHERE assets.user_id = users.id) AS asset_count
   FROM users
   ORDER BY username;
   ```
4. 切到 user02 跑一个新任务 → 回 D1 Console 再查一次：
   - user01 / user02 的 `task_count` 都应 `>= 1`
   - 各自的 `asset_count` 互不重叠
5. 在 D1 Console 再验证一次「user01 看不到 user02 的任务」：
   ```sql
   SELECT id, type, status FROM tasks WHERE user_id = '<user01-uuid>';
   ```
   返回的 id 全部应该是 user01 自己创建的，不会混入 user02 的任务。

以上都成立 → 数据隔离 + R2/D1 双写成功，可正式对外开放。

---

## 13. 紧急回滚到 local 模式

如果 cloud 模式发现 bug 想暂时回到本地模式（不影响 Mac mini 服务连续性）：

1. 编辑 `.env.local`：
   ```
   STORAGE_MODE=cloud   →   STORAGE_MODE=local
   ```
2. 重启 PM2：
   ```bash
   pm2 restart yibai-fission
   ```
3. 此时：
   - 任务记录写回 `data/fashion-mvp-store.json`
   - 上传图 / 生成图写回 `public/generated/**`
   - middleware 的 cloud session 校验自动放行（PR2 已知 trade-off，仅本地兜底）
4. 已在 cloud 写过的任务/图片**不会丢**，仍存在 R2/D1；修复后切回 `STORAGE_MODE=cloud` 立刻可见。

⚠️ 注意：在 cloud ↔ local 之间反复切换会让用户的「任务历史视图」不一致（cloud 的看不到 local 的，反之亦然）。
切换最好限定在「迁移期一次」，不要日常反复切。

---

## 14. trellics 内网穿透接入

杭州中转 + Mac mini 内网穿透由用户自己保管，不入仓库。

常见拓扑：

```
5 个客户的浏览器
    ↓ HTTPS (https://<your-trellics-domain>)
trellics 杭州中转
    ↓ HTTP/HTTPS 转发
Mac mini  127.0.0.1:3000
    ↓
Next.js (pm2 start ecosystem.config.cjs)
```

trellics client 配置要点：

- 本地监听目标：`127.0.0.1:3000`（与 `ecosystem.config.cjs` 中 `PORT=3000` 对齐）
- 公网入口：trellics 控制台提供的固定域名（HTTPS 已签证书）
- 保持 long-lived connection：生图任务长达 5-8 分钟，trellics 端别配过短的 idle timeout
- 5 个客户拿到统一 URL 即可访问；不需要给每个客户单独配置

具体 trellics client 启动命令 / token / 配置文件，本仓库不提供，由用户自己保管。

