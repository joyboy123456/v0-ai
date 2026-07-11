# 实现结果

- 新增 `PoseMainArmVisibility` 与 `PoseFissionParams.lowerBodyMainArmVisibility`。
- 姿势裂变表单在选中下半身姿势时显示主图手臂裁切开关，默认 `hidden`。
- 服务端标准化缺失字段为 `hidden`，兼容历史任务与失败姿势重跑。
- 逐姿势 Prompt 已按 full/upper/lower 重构，并加入主图背景、构图、重心联动和姿势相关道具规则。
- 下半身 `hidden` 锁定主图上边界并禁止手臂及手部道具；`visible` 由姿势图控制手是否出现、数量、位置和动作。
- 按真实图片顺序向 Gemini/老张 Gemini 传入 `inputImageLabels`，其他 Provider 请求协议不变。

## 验证

- `pnpm exec eslint components/workbench/left-panel.tsx lib/server/pose-fission-service.ts lib/types.ts`：通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；存在既有 Turbopack NFT 警告。
- `git diff --check`：通过。
- 全仓 `pnpm lint` 被既有 `scripts/rebuild-tasks-from-oss.mjs:187` 语法损坏阻断，本次未修改该文件。
- 本地浏览器到达登录页；未使用账号凭据，登录后的交互验收未执行。
