# brainstorm: Cloudflare backend foundation

## Goal

为当前 Next.js AI 服装裂变工具搭建一个**最小可用的多用户后端**，让 5 名客户能从公网访问、登录、生成自己的图片并保存到对象存储——目标是**给客户做产品试用 / 体验测试**，验证商业可行性，**月成本控制在 0 元**。

## Stage Definition（关键）

> ⚠️ **本任务的定位是"MVP 给客户试用"，不是"全量迁移到 Cloudflare 生态"**。
> 砍掉一切非必要复杂度。设计原则：**能用即可，可扩展但不预设扩展**。

## Background

- 这是 `05-19-firebase-backend-foundation`（planning，未启动）的替代方案。
- 用户对 Firebase 的 Blaze 计费 + 国内访问体验有顾虑；最终接受 Cloudflare 的"绑卡但免费"模式。
- 用户没有备案过的国内域名 → 七牛云 Kodo 不可用（30 天测试域名陷阱）→ R2 的 `pub-xxx.r2.dev` 免备案公共域名成为决定性优势。
- 用户已自有 trellics 内网穿透（杭州中转），公网入口已具备 → 不需要再用 Vercel/Pages 提供公网访问。
- Mac mini 作为运行节点，但通过 stateless 设计避免成为单点。

## Architecture (locked)

```
[5 个客户的浏览器（公网）]
   ↓ HTTPS
   ↓
[trellics 杭州中转 / 内网穿透]
   ↓
[Mac mini (macOS arm64)]
   └─ pnpm start - Next.js 16 App Router
      ├─ R2 via S3-compatible API (aws4fetch / @aws-sdk/client-s3)
      ├─ D1 via HTTPS REST API
      └─ KV via HTTPS REST API
            ↓
      [Cloudflare 边缘网络]
```

**Mac mini 是 stateless workhorse**：所有数据（图片 / metadata / session）都外置到 Cloudflare，本机不持久化任何用户数据。这意味着：
- Mac mini 断电重启不丢数据
- 未来可无缝迁移到云服务器
- 不需要在 Mac mini 上装数据库/缓存中间件

## What I already know

### 已确定的技术选型

- **存储**：Cloudflare R2（已开通，公共域名 `https://pub-c58e7a0926c3427c81de37c4ba7d17be.r2.dev`，bucket `sujie`，APAC region 亚太节点）
- **数据库**：Cloudflare D1（HTTPS REST API 调用，免费 5GB）
- **会话**：Cloudflare KV（HTTPS REST API 调用，免费 1GB）
- **运行节点**：Mac mini 本机 `pnpm start`，通过 trellics 暴露
- **AI 推理**：保留现有 Google Gemini API + 七牛云 AI 推理（`api.qnaigc.com`）
- **认证**：用户名 + 密码（bcrypt），httpOnly cookie + KV session

### 已收集到的凭证（在 `.env.local`，不入仓库）

```
CLOUDFLARE_ACCOUNT_ID = 13f2dfed5a2c8d03d7b6fd4a061d9f95
R2_ACCESS_KEY_ID = f4f234cf4acccf061bb4c1bebb37cc29
R2_SECRET_ACCESS_KEY = (saved)
R2_ENDPOINT = https://13f2dfed5a2c8d03d7b6fd4a061d9f95.r2.cloudflarestorage.com
R2_BUCKET = sujie
R2_PUBLIC_URL = https://pub-c58e7a0926c3427c81de37c4ba7d17be.r2.dev
```

wrangler 走 OAuth（凭证在 `~/.wrangler/config/default.toml`），D1 / KV 待 PR1 创建。

⚠️ **关键 chore**：`.env.local` 中的 `CLOUDFLARE_API_TOKEN` 已注释掉，因为 wrangler 4.x 会自动读 `.env.local` 中的 token 并优先覆盖 OAuth。应用端调用 Cloudflare REST API（D1/KV）应使用更专用的 token。

待获取（PR1 执行后）：
- `D1_DATABASE_ID`
- `D1_DATABASE_NAME` = `yibai-fission-db`
- `KV_NAMESPACE_ID`

### 当前项目现状

- Next.js 16 App Router 项目。
- `app/api/**` 共 7+ 路由依赖 `lib/server/task-store.ts`。
- `lib/server/task-store.ts` 使用进程内 Map + `data/fashion-mvp-store.json` 持久化。
- 上传 / 生成图片落到 `public/generated/**`。
- 异步生图任务靠 `void runTask(taskId)`。
- 现有 spec 必须保留：`spec/backend/external-image-api-reliability.md`、`spec/backend/streaming-fission-pipeline.md`。

### 用户的关键场景

- **规模**：5 人客户压测（先验证产品价值，不是技术压测）
- **网络**：客户都在中国大陆，通过 trellics 杭州中转访问
- **使用强度估算**：每人每天 ~20 张图 × 平均 1MB ≈ 100MB/天（30 天 ~3GB）
- **AI 推理时长**：单图 10-30 秒，多图/2K/4K 最坏 5-8 分钟

## Decisions (ADR-lite)

### D1: 渐进式 MVP 而非全栈迁移

- **Context**: 用户最初想"全家桶"，但全 Cloudflare Pages 化需要 Edge Runtime 重写，工作量 2-3 周。
- **Decision**: 只接入 R2/D1/KV 作为远程存储后端，前端继续以 Node.js 跑在 Mac mini。
- **Consequences**: 现有 `task-store.ts` / `streaming-fission-pipeline` 契约保留；未来要做全栈迁移需要二次重构（可接受）。

### D2: Mac mini stateless workhorse

- **Context**: Mac mini 24/7 在家有断电风险，但用户已自备。
- **Decision**: Mac mini 只做"运行项目"，所有状态外置到 Cloudflare，本机不持久化数据。
- **Consequences**: 任何时候 Mac mini 重启都不丢数据；未来可无缝迁移到云服务器。

### D3: 用户名 + 密码认证（极简）

- **Context**: 客户压测阶段，不要让客户填邮箱、不要邮件验证。
- **Decision**: 用户名 + 密码（`user01 / 123456` 极简风格），bcrypt + httpOnly cookie + KV session。5 个账号由本小姐写 D1 seed 脚本预置。
- **Consequences**: 客户体验最低摩擦；未来要扩到真实邮箱注册需要加表字段（可接受）。

### D4: 图片全部 30 天自动清理（不做"收藏"）

- **Context**: 10GB R2 免费额度 vs 5 人 × 3GB/月 = 永久则 3 个月爆。
- **Decision**: R2 Lifecycle Rule 设置「30 天后删除所有对象」，0 代码。客户需要保留的图自己右键保存到本地。
- **Consequences**: 容量永远在 30% 以内；未来要做「收藏」功能可以在 D1 加 `favorites` 表 + 拷贝到 `/saved/` 路径（YAGNI，本任务不做）。

### D5: 完全私有的数据隔离

- **Context**: 客户互相不该看到对方的图。
- **Decision**: 所有 R2 路径前缀 `users/{userId}/...`；所有 D1 查询带 `WHERE user_id = ?`；后端 API 中间件强制校验 session。
- **Consequences**: 简单可靠；未来要做"分享给团队"功能可以加 `visibility` 字段（YAGNI，本任务不做）。

### D6: Fresh start，不迁移历史数据

- **Context**: `data/fashion-mvp-store.json` 和 `public/generated/**` 是开发期 demo 数据，没有用户身份信息。
- **Decision**: 不写迁移脚本。客户压测开始时 D1 是空表（只有 5 个 seed 账号），R2 是空 bucket。
- **Consequences**: 部署节奏更快；本地开发不影响（继续可写本地 JSON 走老路径，由 `STORAGE_MODE=local|cloud` env 切换）。

## Requirements

### 核心功能

- [ ] 引入 Cloudflare SDK：R2 用 `aws4fetch`（轻量、无 Node 依赖）或 `@aws-sdk/client-s3`；D1/KV 用 `fetch` + Cloudflare REST API。
- [ ] 添加 `.env.example` 占位（已完成）+ `.env.local` 真实凭证（已完成，gitignored）。
- [ ] 用 wrangler CLI 创建 D1 数据库 `yibai-fission-db` 和 KV 命名空间 `yibai-session`。
- [ ] D1 schema：`users` 表 + `tasks` 表 + `assets` 表（具体字段见 Technical Notes）。
- [ ] D1 seed 脚本：插入 5 个测试账号（`user01-user05`，密码 bcrypt 后存入）。
- [ ] 登录页 `/login`：用户名 + 密码表单，POST 到 `/api/auth/login`。
- [ ] `/api/auth/login` / `/api/auth/logout` / `/api/auth/me` 三个端点。
- [ ] 后端中间件：未登录请求返回 401；登录请求把 `userId` 注入到 request context。
- [ ] R2 Lifecycle Rule：30 天自动清理（在 Cloudflare 控制台配置）。
- [ ] `lib/server/storage-adapter.ts`：抽象图片读写，按 `STORAGE_MODE` 切换本地 / R2。
- [ ] `lib/server/task-store.ts` 改造：按 `STORAGE_MODE` 切换本地 JSON / D1。
- [ ] 7 个现有 API 路由（`app/api/tasks/**` + `app/api/assets/upload/route.ts` 等）增加 `userId` 鉴权和过滤。

### 兼容性要求

- [ ] 现有 `external-image-api-reliability.md` 契约不变（错误分类 / 重试 / 限流 / 日志）。
- [ ] 现有 `streaming-fission-pipeline.md` 契约不变（流式持久化 / 子镜头重跑 / 单失败容忍）。
- [ ] 本地开发模式（`STORAGE_MODE=local`）继续可跑，所有现有测试通过。

## Acceptance Criteria

- [ ] `wrangler whoami` 显示已登录。
- [ ] D1 数据库 `yibai-fission-db` 创建成功，`wrangler d1 execute` 查询 `users` 表返回 5 行。
- [ ] R2 bucket `yibai-fission` 已开启 30 天 Lifecycle Rule。
- [ ] 浏览器访问 `/login`，输入 `user01 / 123456` 能成功登录并跳转到 `/`。
- [ ] 未登录访问 `/api/tasks` 返回 401。
- [ ] 登录后上传一张图，R2 控制台能看到 `users/{userId}/uploads/...` 路径。
- [ ] 跑一次 photo-fission，生成结果落到 `users/{userId}/generated/...`，且能在前端正常预览。
- [ ] 切换到 `user02` 登录，看不到 `user01` 的任何任务/图片。
- [ ] Mac mini 重启后，所有用户登录/任务历史/图片**完全不丢**。
- [ ] Lint / typecheck / CI 通过。

## Definition of Done

- Tests added/updated for auth middleware 和 storage-adapter 关键路径。
- Lint / typecheck / CI green.
- `.env.example` 同步所有新增 env key。
- 部署文档：把 wrangler 命令、D1 migration、seed 脚本、Lifecycle 配置步骤写到 `docs/deploy-cloudflare.md`。
- Rollback：env 切回 `STORAGE_MODE=local` 即恢复本地模式。

## Out of Scope (explicit)

- 不做 Edge Runtime 重写（保持 Node.js 部署）
- 不做用户注册流程 / 密码找回 / 邮件验证
- 不做「收藏」/ 永久保留功能（YAGNI）
- 不做用户间分享 / 协作 / 评论功能
- 不迁移现有 `data/fashion-mvp-store.json` 和 `public/generated/**` 历史数据（fresh start）
- 不做配额管理 / 计费 / 订阅
- 不做生产级压测和扩容设计
- 不在 user 明确确认前执行 `wrangler deploy` 到生产环境
- 不把 Cloudflare/Google/Qiniu API key 暴露给浏览器

## Implementation Plan (small PRs)

### PR1: 基础设施搭建（不动业务代码）
- Cloudflare 资源创建：`wrangler login` → 创建 D1 / KV → R2 Lifecycle Rule
- 安装依赖：`aws4fetch`（或 `@aws-sdk/client-s3`）、`bcryptjs`
- D1 schema migration + seed 5 个测试账号
- `.env.example` 完善
- `docs/deploy-cloudflare.md` 部署文档

### PR2: 认证层
- `/login` 页面
- `/api/auth/login` / `logout` / `me` 路由
- `lib/server/auth.ts`：bcrypt 验证 + KV session 读写
- `middleware.ts`：未登录 401 / 登录后注入 `userId`

### PR3: 存储抽象层
- `lib/server/storage-adapter.ts`：本地 vs R2 切换
- `lib/server/task-store.ts` 改造：本地 JSON vs D1 切换
- `STORAGE_MODE` env 实现

### PR4: 业务路由接入用户身份
- 7 个 `app/api/tasks/**` + `app/api/assets/upload/route.ts` 加 `userId` 鉴权
- R2 路径全部加 `users/{userId}/` 前缀
- D1 查询全部加 `WHERE user_id = ?`

### PR5: 端到端验证 + 部署文档
- 跑通 user01 / user02 隔离场景
- 完善 `docs/deploy-cloudflare.md`
- Mac mini PM2 守护配置

## Technical Notes

### D1 Schema 草案

```sql
-- users 表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    INTEGER NOT NULL
);

-- tasks 表（替代 task-store 的任务记录）
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL,   -- 'photo-fission' | 'pose-fission' | ...
  status        TEXT NOT NULL,   -- 'queued' | 'running' | 'done' | 'failed' | 'partial'
  payload_json  TEXT,            -- 输入参数 JSON
  result_json   TEXT,            -- 结果摘要 JSON
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_tasks_user_created ON tasks(user_id, created_at DESC);

-- assets 表（替代 createAsset 的资产记录）
CREATE TABLE assets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  task_id       TEXT REFERENCES tasks(id),
  kind          TEXT NOT NULL,   -- 'upload' | 'generated'
  r2_key        TEXT NOT NULL,   -- R2 object key
  public_url    TEXT,
  mime          TEXT,
  bytes         INTEGER,
  width         INTEGER,
  height        INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_assets_user_task ON assets(user_id, task_id);
```

### Cloudflare 库选型

- **R2**：`aws4fetch`（4KB，无 Node 依赖，在 Node 和 Edge 都跑得了）or `@aws-sdk/client-s3`（成熟但 Bundle 大）→ 本小姐倾向 `aws4fetch`。
- **D1 REST API**：`https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query`，纯 fetch + Bearer Token。
- **KV REST API**：`https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key}`，纯 fetch + Bearer Token。

### 关键技术风险

1. **D1 REST API 延迟**：远程 HTTPS 调用 ~50ms，登录鉴权每个请求都查一次会变慢 → 用 KV 存 session（session 写 KV，读快），D1 只在登录/写元数据时调用。
2. **现有 `streaming-fission-pipeline` 在 Node.js 模式下的并发**：原架构是单进程内存 Map，改成 D1 后写并发要小心 → PR3 阶段重点测试。
3. **R2 公共 URL 可被猜测**：`pub-xxx.r2.dev/users/{userId}/uploads/{uuid}.jpg`，但 uuid 不可猜，5 人内测可接受。如果担心，PR4 可以加 R2 presigned URL（增加复杂度）。

### Cloudflare 免费额度健康度（5 人规模）

| 服务 | 免费额度 | 预估月用量 | 余量 |
|---|---|---|---|
| R2 存储 | 10GB | ~3GB（30 天清理后稳定）| ✅ 充裕 |
| R2 Class A 写 | 100 万/月 | <1 万 | ✅ |
| R2 Class B 读 | 1000 万/月 | <10 万 | ✅ |
| D1 存储 | 5GB | <100MB | ✅ |
| D1 读 | 2500 万/天 | <1 万 | ✅ |
| D1 写 | 5 万/天 | <1000 | ✅ |
| KV 读 | 10 万/天 | <500 | ✅ |
| KV 写 | 1000 次/天 | <500 | ✅ |

**结论**：5 人规模下所有服务都在免费额度的 10% 以内，月成本 0 元。

### 现有 spec 必须遵守

- [`spec/backend/external-image-api-reliability.md`](../../spec/backend/external-image-api-reliability.md) — 外部图像 API 错误分类 / 重试 / 限流 / 日志契约
- [`spec/backend/streaming-fission-pipeline.md`](../../spec/backend/streaming-fission-pipeline.md) — 流式裂变编排契约

## Research References

> 待 PR1 启动前由本小姐补充：
> - Cloudflare D1 REST API 用法与 schema 设计
> - aws4fetch vs @aws-sdk/client-s3 对比
> - bcryptjs vs scrypt vs @node-rs/bcrypt 选型
