# 合并 STORAGE_MODE 与 IMAGE_API_DEMO 为统一开发模式

## Goal

将项目中的两套独立开发/演示开关（`STORAGE_MODE` 和 `IMAGE_API_DEMO`）合并为一个统一模式，
减少配置复杂度，让开发者只需关心一个开关即可切换完整开发环境。

## What I already know

- `STORAGE_MODE=local|cloud` 控制存储、认证、会话、任务仓库的双轨切换，影响 8+ 文件
- `IMAGE_API_DEMO=0|1` 仅影响 `lib/server/third-party-image-adapter.ts`，控制是否调 AI 生图
- 两者目前完全独立，可组合出 4 种状态（local+真实API、local+demo、cloud+真实API、cloud+demo）
- 用户实际使用中只有两种场景：开发调试（local + 不调API）和生产（cloud + 调API）

## Assumptions (temporary)

- `STORAGE_MODE=local` 时，开发者通常也不想花钱调 AI API，应该自动走 demo
- `STORAGE_MODE=cloud` 时，永远走真实 API 路径，不需要 demo 模式
- 合并后 `IMAGE_API_DEMO` 环境变量可以废弃

## Open Questions

- 是否还需要在 local 模式下偶尔调真实 API 的能力？（如调试 prompt 效果）

## Requirements (evolving)

- 保留 `STORAGE_MODE` 作为唯一模式开关（local / cloud）
- `STORAGE_MODE=local` 时自动启用 demo 图片（不调 AI），无需额外配置
- `STORAGE_MODE=cloud` 时强制走真实 AI API，忽略任何 demo 设置
- 废弃 `IMAGE_API_DEMO` 环境变量，从 `.env.example` 中移除
- 更新 `third-party-image-adapter.ts` 中的 demo 判断逻辑

## Acceptance Criteria (evolving)

- [ ] `STORAGE_MODE=local` 时图片生成自动返回 demo 占位图
- [ ] `STORAGE_MODE=cloud` 时图片生成始终走真实 API
- [ ] `IMAGE_API_DEMO` 环境变量不再被任何代码引用
- [ ] `.env.example` 中移除 `IMAGE_API_DEMO` 相关说明
- [ ] 现有 `STORAGE_MODE` 的其他功能（存储、认证、会话）不受影响

## Definition of Done

- Lint / typecheck 通过
- `.env.example` 更新
- 无残留的 `IMAGE_API_DEMO` 引用

## Out of Scope (explicit)

- 不改变 `STORAGE_MODE` 的 local/cloud 双轨实现逻辑
- 不改变 demo 图片的具体内容（demoResults 数据）

## Technical Notes

- 受影响文件：
  - `lib/server/third-party-image-adapter.ts` — 主要改动点，demoMode 判断需改为读 storage-mode
  - `lib/server/storage-mode.ts` — 可新增 `isDemo()` 便利函数
  - `.env.example` — 移除 IMAGE_API_DEMO
- `STORAGE_MODE` 的现有消费者（storage-adapter, task-repo, auth/*, health）不需要改动
