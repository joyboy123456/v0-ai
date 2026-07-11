# 修复生成完成状态栏常驻

## Goal

姿势裂变任务成功生成结果后，不再在结果图片区顶部持续显示“生成完成 / 进度 100%”状态卡，减少无效占位。

## Requirements

* 任务处于 `pending` 或 `running` 时继续显示状态卡和进度。
* `success` 且已有生成结果时隐藏状态卡，结果图片继续正常展示。
* `partial`、`failed`、`cancelled` 等非完整成功状态继续显示状态卡，保留错误、取消和失败项重试信息。
* 不改变历史记录、结果图片操作和任务数据持久化逻辑。

## Acceptance Criteria

* [ ] 姿势裂变任务成功并展示结果后，顶部不再出现“生成完成 / 进度 100%”卡片。
* [ ] 任务生成过程中仍能看到状态与进度。
* [ ] 部分成功或失败任务仍能看到状态及可用的重试入口。
* [ ] ESLint 与 TypeScript/Next.js 构建检查通过，或明确记录与本次修改无关的既有问题。

## Definition of Done

* 修改保持局部、无新增依赖。
* 完成静态检查和构建验证。
* 不执行 Git 提交或分支操作。

## Technical Approach

在右侧结果面板为 `TaskStatusCard` 增加明确的展示条件：完整成功且已有结果时不渲染，其余状态维持现状。展示判断提取为语义清晰的局部布尔值，避免把状态组合散落在 JSX 中。

## Decision (ADR-lite)

**Context**：当前 `visibleTask` 存在时状态卡无条件渲染，终态成功后形成永久占位。

**Decision**：只隐藏“成功且已有结果”的状态卡，不使用定时消失，也不清空 `activeTask`。

**Consequences**：结果区更紧凑，同时保留任务对象供图片预览、删除、收藏等操作使用；批量下载可继续通过历史记录批量选择完成。

## Out of Scope

* 不重构任务状态机。
* 不改变历史记录卡片布局。
* 不新增自动清理或删除任务行为。

## Technical Notes

* 根因位于 `components/workbench/right-panel.tsx`：结果面板只判断 `visibleTask`，随后无条件渲染 `TaskStatusCard`。
* 历史记录顶部的实时任务面板已经只在 `pending` / `running` 时展示，可作为一致性参考。

