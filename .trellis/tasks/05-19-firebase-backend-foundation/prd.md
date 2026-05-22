# brainstorm: Firebase backend foundation

## Goal

为当前 Next.js AI 图片工作台引入 Firebase 作为后端底座，优先解决用户登录认证、图片存储、任务/素材元数据持久化和部署路径，让项目从本地 demo 状态逐步迁移到可上线的多用户应用。

## What I already know

- 用户希望尝试 Firebase，目标是尽量减少自建后端，覆盖登录认证和图片存储。
- 用户现在明确希望第一阶段先实现：部署在一个服务器里、用户能登录、每个人都有自己的独立空间。
- 用户有 Google Pro / Google AI Pro 会员，但该会员不是 Firebase 计费方案本身。
- 当前项目是 Next.js 16 App Router 应用。
- 当前上传入口是 `app/api/assets/upload/route.ts`，后端通过 `lib/server/task-store.ts` 的 `createAsset()` 记录素材。
- 当前数据存储是本地内存 Map + `data/fashion-mvp-store.json`，图片写到 `public/generated/**`。
- 当前 `app/api/**` 不只是通用后端，还包含 AI 生图任务编排、外部 provider 调用、重试、限流、失败恢复和下载结果等业务逻辑。

## Assumptions (temporary)

- MVP 先做 Firebase Auth + 服务端会话 + 本地持久化数据按 `uid` 隔离；Storage / Firestore 迁移作为第二阶段。
- 默认先使用 Google 登录，不做匿名登录，避免匿名用户空间和正式账号合并带来的迁移复杂度。
- 为了使用 Cloud Storage for Firebase 和 App Hosting，需要接受 Blaze 计费计划，但可以先控制在免费额度和小流量测试范围内。
- 初期仍保留 Next.js API routes，由服务端校验 Firebase ID token 并执行业务逻辑。

## Research References

- [`research/firebase-backend-options.md`](research/firebase-backend-options.md) — Firebase 能接管认证/存储/托管/数据底座，但现有 AI 任务编排仍需保留服务端逻辑。

## Open Questions

- 服务器部署目标尚未锁定：自有 VPS / Docker / Firebase App Hosting / Vercel 均可，但第一阶段代码应保持普通 Node.js Next 部署兼容。

## Requirements (evolving)

- 添加 Firebase 项目配置的环境变量模板，不把真实密钥写入仓库。
- 前端提供 Google 登录/退出状态，未登录时不进入工作台。
- 登录后建立服务端会话 cookie，现有 fetch 调用无需逐个手动拼 Authorization header。
- 后端 API 对需要用户数据的请求读取并校验 Firebase session cookie。
- 上传图片和生成结果第一阶段仍可落在服务器本地磁盘，但路径/记录必须按 `uid` 隔离，避免用户互相看到数据。
- 任务列表、任务详情、重跑、删除结果等接口必须按 `uid` 校验归属。
- 素材、任务、结果元数据未来可迁移到 Firestore；第一阶段先保持本地 JSON，按 `userId` 过滤。
- 生成任务继续使用现有服务端 pipeline，不把外部 AI provider key 暴露给浏览器。
- Firebase Security Rules 按 `uid` 约束用户读写。
- 部署方案优先评估 Firebase App Hosting；必要时保留 Vercel/其他托管兼容性。

## Acceptance Criteria (evolving)

- [ ] 用户可以使用 Firebase Google 登录并看到自己的会话状态。
- [ ] 未登录用户无法读取或创建个人任务数据。
- [ ] 服务端 API 基于 Firebase session cookie 识别当前用户。
- [ ] 上传素材、生成结果、任务列表、任务详情、删除/重跑操作按 Firebase `uid` 隔离。
- [ ] Firebase env、rules、部署说明记录在项目文档中。
- [ ] Lint / typecheck 通过。

## Definition of Done (team quality bar)

- Tests added/updated where behavior is risky.
- Lint / typecheck / CI green.
- Docs/notes updated if behavior changes.
- Rollout/rollback considered if risky.

## Out of Scope (explicit)

- 不在第一阶段删除所有 `app/api/**` 路由。
- 不在第一阶段强制迁移到 Firestore / Cloud Storage；先把登录和用户隔离跑通。
- 不把 Google/Qiniu/OpenAI 等外部生图 API key 放到前端。
- 不默认启用付费生产流量或大规模用户开放。
- 不在用户明确确认前执行 `firebase deploy`、绑定计费或修改远端生产资源。

## Technical Notes

- `app/api/assets/upload/route.ts` 当前有图片大小和 MIME 校验，迁移 Storage 时应保留这层校验。
- `lib/server/task-store.ts` 当前的 `void runTask(taskId)` 是请求触发的后台任务模式，部署到 App Hosting/Cloud Run 前需要评估生命周期可靠性。
- Firebase Storage 适合图片对象，Firestore 适合任务和素材元数据；Auth token 用于 API 和 Rules 的 `uid` 隔离。
- App Hosting 适配 Next.js，但需要 Firebase/Google Cloud 计费与 GitHub/CLI 配置。
