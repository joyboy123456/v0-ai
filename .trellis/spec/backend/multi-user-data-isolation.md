# 多用户数据隔离契约（cookie session → API → DB/Storage）

> **executable contract**：多用户系统中"用户 A 看不到用户 B 数据"的工程契约。
> 漏一个 API 不接 `requireUser`，等于全盘破功。

---

## 1. 适用场景

任何需要"按用户隔离"的 multi-tenant API：5 人内测 ~ 中等规模 SaaS。

不适用：
- 完全公开 / 无身份的 API（图床、CDN）
- 单用户单租户 demo（YAGNI）

---

## 2. 跨层数据流（**必背**）

```
[浏览器]
   └─ cookie: session_id=<uuid>
      ↓
[middleware.ts]  ← Edge Runtime
   ├─ 读 cookie.session_id
   ├─ 调 KV (cloud) / 跳过 (local) 验证 session 有效
   └─ 注入 request header: x-user-id=<uuid>
      ↓
[API 路由 app/api/**]
   ├─ const user = await requireUser(request)  ← 必须！
   ├─ if (user instanceof NextResponse) return user  ← 401 短路
   └─ 业务逻辑用 user.id / user.userId
      ↓
[service / task-store]
   └─ 必须接受 userId 形参，向下透传
      ↓
[repository (task-repo / user-repo)]
   ├─ D1: WHERE user_id = ?  ← 永远带 user_id 过滤
   └─ R2: key 必须以 users/{userId}/ 开头
```

---

## 3. Contracts

### 3.1 `requireUser` signature

参考 `lib/server/auth/require-user.ts:1`：

```typescript
export async function requireUser(
  request: NextRequest
): Promise<{ userId: string; user: User } | NextResponse>
```

返回 `NextResponse` 时**必须**作为 401 直接 return（不要继续业务）。

调用模板（**所有受保护 API 第一行**）：

```typescript
export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId, user } = userResult
  // ... 业务
}
```

### 3.2 数据库查询契约

任何**业务表**查询必须按 user_id 过滤：

```sql
-- Good
SELECT * FROM tasks WHERE user_id = ? AND id = ?
SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC

-- Bad
SELECT * FROM tasks WHERE id = ?       -- 跨用户可见
SELECT * FROM tasks                    -- 全表暴露
```

参考实现：`lib/server/storage/task-repo.d1.ts:1`、`lib/server/storage/task-repo.local.ts:1`

### 3.3 对象存储 key 契约

R2 / 任何对象存储的 key 必须以 `users/{userId}/` 开头：

```typescript
// Good
const key = `users/${userId}/${bucket}/${filename}`
//        e.g. users/4ea5530b-7dd5-45ed-8a71-e59df9bbe99d/generated/abc.png

// Bad
const key = `${bucket}/${filename}`   // 跨用户可见
const key = `${userId}-${filename}`   // 不可读、不可用 prefix lifecycle
```

参考：`lib/server/storage/storage-adapter.ts:1`

### 3.4 Session 存储契约

- session value 必须包含 `userId` + `expiresAt`
- 存到 KV 时 ttl 与 expiresAt 一致
- cookie 必须 `httpOnly + secure(prod) + sameSite=lax`
- 30 天 maxAge

参考 `lib/server/auth/session.ts:1`、`app/api/auth/login/route.ts:1`

### 3.5 Local mode fallback 契约（开发友好）

- Local 模式下 middleware 与 server in-memory Map 跨进程不通，无法 enforce session
- `requireUser` **可以** fallback 到一个 mock user（推荐 user01）方便本地联调
- **Cloud 模式严禁 fallback**——必须严格返回 null / 401
- Fallback 触发时打 `console.warn('[auth] local-mode anonymous fallback to ...')`

参考 `lib/server/auth/require-user.ts:1`

---

## 4. Wrong vs Correct

### Wrong: API 漏调 requireUser
```typescript
// app/api/tasks/route.ts
export async function GET() {
  const tasks = await listTasks()   // ❌ 没传 userId，返回全部
  return Response.json(tasks)
}
```
**Correct**：
```typescript
export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult
  const tasks = await listTasks({ userId })   // ✅
  return Response.json(tasks)
}
```

### Wrong: service 接受 userId 但 repo 忘了过滤
```typescript
// task-store.ts
export function listTasks({ userId }: { userId: string }) {
  return repo.listAllTasks()   // ❌ 拿到 userId 但没用
}
```
**Correct**：
```typescript
export function listTasks({ userId }: { userId: string }) {
  return repo.listTasksByUser(userId)   // ✅
}
```

### Wrong: 资源 ownership 不校验
```typescript
// app/api/tasks/[taskId]/route.ts
export async function GET(_, { params }) {
  return Response.json(await getTask(params.taskId))   // ❌ 任何 user 都能拿任何 task
}
```
**Correct**：
```typescript
export async function GET(request: NextRequest, { params }) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult
  const task = await getTask(params.taskId, { userId })   // ✅ 不匹配返回 null
  if (!task) return new Response(null, { status: 404 })
  return Response.json(task)
}
```

### Wrong: R2 key 不带 userId
```typescript
const key = `uploads/${filename}`   // ❌
```
**Correct**：
```typescript
const key = `users/${userId}/uploads/${filename}`   // ✅
```

---

## 5. Self-check 清单（每次写新 API 时跑一遍）

- [ ] 第一行调了 `requireUser(request)` 吗？
- [ ] 401 短路 `if (userResult instanceof NextResponse) return userResult` 写了吗？
- [ ] 任何 DB 查询都带 `user_id = ?` 吗？
- [ ] 任何 R2 key 都以 `users/{userId}/` 开头吗？
- [ ] 资源 ownership 校验做了吗（用 `getX(id, { userId })`）？
- [ ] 404 vs 403 的边界清晰吗（找不到 / 不属于你 → 都返回 404，不要泄露存在性）？

---

## 6. 引用

- 鉴权工具：`lib/server/auth/require-user.ts:1`
- middleware：`middleware.ts:1`
- 受保护 API 接入参考：
  - `app/api/tasks/route.ts:17` (GET) + `:27` (POST)
  - `app/api/tasks/[taskId]/route.ts:14`
  - `app/api/tasks/[taskId]/download/route.ts:15`
  - `app/api/assets/upload/route.ts:22`
- 仓储层：`lib/server/storage/task-repo.local.ts:1`、`task-repo.d1.ts:1`
- 存储适配器：`lib/server/storage/storage-adapter.ts:1`
- 任务原文：`.trellis/tasks/05-19-cloudflare-backend-foundation/prd.md`

---

**语言**：中文为主，关键 API / 类型名 / env key 保留英文，代码块用真实项目代码。
