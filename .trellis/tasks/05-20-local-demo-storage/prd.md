# brainstorm: 本地演示模式与本地图片存储

## Goal

把当前客户演示环境优先收敛到本地模式：线上 `cloud` 版本保留，客户演示时通过 `STORAGE_MODE=local` 使用内网登录、本地任务元数据、本地图片文件存储与本地高速展示，先保证功能稳定和演示丝滑，再继续推进多用户云端化。

## What I already know

* 用户希望先回退到本地模式，暂缓多用户云端化，线上版本不删除。
* 图片资源暂时不走 R2，上传图与生成图都存储在本地文件夹。
* 本地仍需要登录，走内网访问，不允许匿名绕过。
* 代码已有 `STORAGE_MODE=local | cloud` 双轨，`local` 默认不调 Cloudflare。
* 当前 local 图片固定落在 `public/generated/**`，浏览器直接访问 `/generated/**`。
* 现有 local 登录使用 `user01 / 123456` mock 账号。

## Assumptions

* 本次不做 git rollback / reset，只做可切换的本地演示模式增强。
* 外部图片生成 API 仍按现有 provider 配置执行；本次只调整生成结果的持久化与展示路径。
* 本地图片目录需要可配置，默认仍兼容 `public/generated`，以免破坏已有开发体验。

## Requirements

* `STORAGE_MODE=cloud` 路径保持现状，继续使用 R2 / D1 / KV。
* `STORAGE_MODE=local` 下：
  * 默认 `LOCAL_AUTH_MODE=super-admin`，内网访问无需账号密码，所有请求视为本地超管 `user01`。
  * 如需保留账号登录，可切换 `LOCAL_AUTH_MODE=password`，仍走 `/login` 与 `requireUser`。
  * 上传图、生成图写入可配置的本地目录。
  * 返回给前端的 URL 是本应用自身的本地路径，避免浏览器远程拉 R2。
  * 服务端回读参考图时能处理新的本地 URL。
* `.env.example` 与部署文档说明如何切换本地演示模式。

## Acceptance Criteria

* [x] 默认 `STORAGE_MODE=local` 不需要 Cloudflare env 也能启动并登录。
* [x] 默认 `LOCAL_AUTH_MODE=super-admin` 时，本地内网访问无需账号密码。
* [x] local 超管能看到旧本地历史任务（缺失 `userId` / `demo_user` / 旧 cloud 用户记录），不再因用户隔离隐藏案例库数据。
* [x] local 模式上传图返回本地 URL，生成结果也返回本地 URL。
* [x] 配置本地图片目录后，文件实际写入该目录，而不是 R2。
* [x] 前端展示图片通过本应用路由读取，路径稳定且可被服务端回读。
* [x] `STORAGE_MODE=cloud` 的 R2 public URL 逻辑不变。
* [x] typecheck 覆盖本次改动；lint 因项目缺少 `eslint` 依赖暂不可跑。

## Definition of Done

* 代码遵守 `storage-adapter` 统一入口，不在业务层直接读写 R2。
* 多用户安全契约不放松：local 模式仍需有效 session。
* 文档同步 env key 与本地回滚说明。
* 质量检查完成，记录未覆盖风险。

## Out of Scope

* 不删除 Cloudflare / R2 / D1 / KV 线上实现。
* 不做多用户云端数据迁移或 R2 历史图片同步。
* 不改外部 AI provider 选型、并发、重试策略。
* 不执行 git commit / push。

## Technical Notes

* 相关代码：
  * `lib/server/storage-mode.ts`
  * `lib/server/storage/storage-adapter.ts`
  * `lib/server/task-store.ts`
  * `middleware.ts`
  * `app/api/assets/upload/route.ts`
* 相关 spec：
  * `.trellis/spec/backend/cloudflare-integration.md`
  * `.trellis/spec/backend/multi-user-data-isolation.md`
  * `.trellis/spec/backend/streaming-fission-pipeline.md`
  * `.trellis/spec/guides/cross-layer-thinking-guide.md`
  * `.trellis/spec/guides/code-reuse-thinking-guide.md`
