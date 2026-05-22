# Cloudflare 全家桶集成契约（R2 + D1 + KV）

> **executable contract**：把 Next.js 应用接到 Cloudflare R2 / D1 / KV 作为远程存储后端的工程契约。
> 适用 5 人内测 ~ 中等规模的多用户应用。**不**适用于全 Edge Runtime 重写场景。

---

## 1. 适用场景

- 现有 Node.js Next.js 项目要把"本地文件 / 本地 JSON / 本地 SQLite"迁移到 Cloudflare 远程存储
- 部署节点是普通服务器（VPS / Mac mini / 云主机），通过 HTTP 调 Cloudflare REST API
- 目标月成本 0 元（5 人规模都在免费额度 10% 以内）

**不**适用：
- 应用本身要部署到 Cloudflare Pages / Workers（那是 Edge Runtime 重写场景，本 spec 不覆盖）
- 单用户单进程的 demo（YAGNI，直接用 SQLite 文件即可）

---

## 2. 整体架构

```
[App 业务代码]
   ↓
[lib/server/storage/storage-adapter.ts]  ← 业务层入口，按 STORAGE_MODE 切换
   ├─ local: lib/server/storage/task-repo.local.ts + 本地图片目录（默认 public/generated/**）
   └─ cloud: lib/server/storage/task-repo.d1.ts + R2
              ↓
   [lib/server/cloudflare/{d1,kv,shared}-client.ts]  ← 远程 REST API 客户端
   [lib/server/storage/r2-client.ts]                 ← R2 S3 兼容客户端
              ↓
   [Cloudflare 边缘网络]
```

**核心原则**：
- 业务代码**永远**调 `getStorageAdapter()` / `getTaskRepo()`，**永远不**直接调 r2-client / d1-client
- adapter 内部用 `isLocal()` / `isCloud()` 分流
- local 模式 = 开发兜底（不依赖 Cloudflare 网络），cloud 模式 = 生产

参考实现：`lib/server/storage/storage-adapter.ts:1`、`lib/server/storage/task-repo.ts:1`

---

## 3. Contracts

### 3.1 客户端模块 signature

**D1 REST client**（`lib/server/cloudflare/d1-client.ts:1`）

```typescript
export async function executeD1Query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<{ results: T[]; meta: D1QueryMeta }>
```

**KV REST client**（`lib/server/cloudflare/kv-client.ts:1`）

```typescript
export async function kvGet(key: string): Promise<string | null>
export async function kvPut(key: string, value: string, ttlSeconds?: number): Promise<void>
export async function kvDelete(key: string): Promise<void>
```

**R2 S3 client**（`lib/server/storage/r2-client.ts:1`，使用 `aws4fetch`）

```typescript
export async function r2Put(input: R2PutInput): Promise<R2PutResult>
export async function r2Get(key: string): Promise<{ body: ArrayBuffer; contentType?: string }>
export async function r2Delete(key: string): Promise<void>
export async function r2Head(key: string): Promise<{ exists: boolean; bytes?: number; contentType?: string }>
```

### 3.2 STORAGE_MODE 语义

| 取值 | 含义 |
|---|---|
| `local`（默认）| 沿用本地文件 + 本地 JSON 持久化路径，不调任何 Cloudflare API |
| `cloud` | 所有读写走 R2 + D1 + KV 远程 API |

参考：`lib/server/storage-mode.ts:1`

### 3.2.1 Local 图片根目录

`local` 模式默认继续写 `public/generated/**` 并返回 `/generated/**`，保持历史开发体验。
如果需要客户内网演示或把生成图片放到仓库外，设置：

```bash
LOCAL_IMAGE_ROOT=/Users/<you>/yibai-local-images
```

此时上传图 / 生成图写入 `{LOCAL_IMAGE_ROOT}/{bucket}/...`，浏览器通过
`/local-assets/**` 由应用 Node route 读取；业务代码仍只能通过
`getStorageAdapter()` 写入，不得直接拼本地文件路径。

### 3.3 Environment

所有 env key 必须同步 `.env.example`：

```bash
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_KV_TOKEN=          # 应用端 token，需 D1:Edit + KV:Edit 权限
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=<your-bucket>
R2_PUBLIC_URL=https://pub-<hash>.r2.dev
D1_DATABASE_ID=
D1_DATABASE_NAME=
KV_NAMESPACE_ID=
STORAGE_MODE=local               # 或 cloud
LOCAL_AUTH_MODE=super-admin      # local 模式默认内网超管；password 则保留账号登录
LOCAL_SUPER_ADMIN_USERNAME=user01
LOCAL_IMAGE_ROOT=                # local 模式可选；留空默认 public/generated
```

---

## 4. ⚠️ 关键 trap：wrangler `.env.local` 覆盖 OAuth

**症状**：跑了 `wrangler login` 成功了，但 `wrangler d1 list` 报 401 / "Authentication error"。

**原因**：wrangler 4.x 会**自动读取项目目录的 `.env.local`**。如果里面有 `CLOUDFLARE_API_TOKEN`（哪怕权限不够），wrangler 会**优先用它**而不是 OAuth 凭证。

**解决**：
1. `.env.local` 里**不要放** `CLOUDFLARE_API_TOKEN`（或注释掉）
2. 应用端调 Cloudflare REST API 用专用 token（取名 `CLOUDFLARE_D1_KV_TOKEN`，跟 wrangler 用的隔离）
3. 或者每条 wrangler 命令前置 `env -u CLOUDFLARE_API_TOKEN wrangler ...`

参考：`.env.example` 的 `CLOUDFLARE_D1_KV_TOKEN` 注释。

---

## 5. Error Matrix

`CloudflareError` / `R2Error` 错误码映射（参考 `lib/server/cloudflare/shared.ts:1`）：

| 错误码 | HTTP status | 含义 | retryable |
|---|---|---|---|
| `CONFIG_MISSING` | - | env 未配齐 | 否 |
| `AUTH_FAILED` | 401 / 403 | token 权限不够 | 否 |
| `NOT_FOUND` | 404 | 对象/记录不存在 | 否 |
| `RATE_LIMITED` | 429 | 触发免费额度限流 | 是（指数退避） |
| `SERVER_ERROR` | 5xx | Cloudflare 服务端临时故障 | 是 |
| `NETWORK_ERROR` | - | fetch 抛错（DNS / 超时） | 是 |

错误处理参考 `external-image-api-reliability.md` 的分类风格，但 **Cloudflare 调用本 spec 范围内默认不做重试**——让上层 service 决定是否退避（理由：D1/KV 写入幂等性需要业务保证，KV/R2 读取失败上层通常 fallback）。

---

## 6. Good / Base / Bad case

### ✅ Good case
```typescript
// 业务代码
const adapter = getStorageAdapter()
const result = await adapter.putImage({
  userId,
  bucket: 'uploads',
  filename: 'avatar.png',
  body: buffer,
  contentType: 'image/png',
})
// → local 模式写本地图片目录 uploads/{userId}/avatar.png
// → cloud 模式写 R2 users/{userId}/uploads/avatar.png
// 业务代码无需关心 mode
```

### 🟡 Base case（可工作但不推荐）
```typescript
// 直接 import r2-client，绕开 adapter
import { r2Put } from '@/lib/server/storage/r2-client'
await r2Put({ key: `users/${userId}/uploads/avatar.png`, body: buffer })
// 风险：local 模式下会直接调 R2（绕过开发兜底）；userId 拼接逻辑分散
```

### ❌ Bad case
```typescript
// 业务代码直接 fetch
await fetch(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${KEY}`, {
  method: 'PUT', body: buffer
})
// 问题：①未签 AWS S3 SIGV4 → 403 ②没走 typed error → 错误处理散落 ③绕开守卫，env 缺失时崩在生产
```

---

## 7. Wrong vs Correct

### Wrong: 在 middleware 里调 D1
```typescript
// middleware.ts (Edge runtime)
const user = await executeD1Query('SELECT * FROM users WHERE id = ?', [userId])
```
❌ middleware 跑在 Edge Runtime，**fetch 可以**但 `executeD1Query` 内部如果引入了 Node API（process / fs）会爆。**正确做法**：middleware 只用 fetch 调 KV REST API 验 session，把 user lookup 放到 API 路由（nodejs runtime）里做。

### Wrong: 业务代码用同一个 token 给 wrangler 用
```bash
# .env.local
CLOUDFLARE_API_TOKEN=cfat_xxx   # 期望给应用代码用
```
❌ wrangler 会优先读这个 env，导致 OAuth 失效。**正确做法**：应用代码用 `CLOUDFLARE_D1_KV_TOKEN`，wrangler 走 OAuth（凭证在 `~/.wrangler/config/default.toml`）。

### Wrong: R2 key 不带 userId 前缀
```typescript
await r2Put({ key: `uploads/${filename}`, body: buffer })
```
❌ 所有用户的图都堆在同一个 prefix 下，**无法做用户隔离 / Lifecycle 按用户清理**。**正确做法**：永远 `users/${userId}/{bucket}/{filename}`，参考 `multi-user-data-isolation.md`。

---

## 8. 引用

- 实现起点：`lib/server/storage/storage-adapter.ts:1`、`lib/server/storage/task-repo.ts:1`
- 客户端：`lib/server/cloudflare/*`、`lib/server/storage/r2-client.ts`
- 开关：`lib/server/storage-mode.ts:1`
- env 模板：`.env.example`
- 部署文档：`docs/deploy-cloudflare.md`
- 任务原文：`.trellis/tasks/05-19-cloudflare-backend-foundation/prd.md`

---

**语言**：中文为主，关键 API / 类型名 / env key 保留英文，代码块用真实项目代码。
