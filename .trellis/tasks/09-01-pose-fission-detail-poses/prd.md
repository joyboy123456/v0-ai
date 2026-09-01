# 姿势裂变详情页显示参考姿势

## 背景

姿势裂变生成时，用户从姿势库选择 1–9 个姿势；任务参数 `params.poses` 已持久化 `{id, url, name, bodyPart}`。详情页 `GenerationDetailDialog` 只渲染 `task.inputAssets`（主图 + 可选正/背面细节），不展示姿势库姿势。事后无法回看当时用了哪个姿势。

## 目标

- 姿势裂变详情页展示本次使用的姿势库姿势缩略图（来自已持久化的 `params.poses`，不依赖姿势库是否仍存在该条目）。
- 查看某张结果时，高亮该结果对应的姿势（`result.shotId === pose.id`）。
- 点击姿势可放大预览。
- 服装参考图改用角色标签（主图 / 正面细节 / 背面细节），避免与姿势混淆。
- 元信息补充姿势数量。
- 姿势裂变无用户提示词：有 `finalPrompt` 时展示；没有则隐藏「无提示词记录」空态。

## 非目标

- 不把姿势图写入 `inputAssetIds`（会破坏 `normalizePoseFissionParams` 的素材数量契约）。
- 不改生成链路、Prompt、Provider 调度。
- 不做「做同款」带回姿势。
- 不修复 7 月重建任务（params 已丢失）的姿势回看。

## 实现要点

- 只读 `task.params.poses` 与 `task.inputAssets`。
- 抽 helper + node:test，避免把标签规则散落在 3k 行的 `right-panel.tsx`。
- 旧任务缺 `poses` 时显示「旧任务没有姿势详情记录」。

## 验收标准

- 新姿势裂变任务详情能看到当时所选姿势图和名称。
- 多姿势任务中，当前预览结果对应的姿势有「当前」标识。
- 服装参考图仍显示，且标签为角色名而非「图1/图2/图3」。
- 非姿势裂变详情页行为不变。
- 现有任务无需回填即可回看（只要 params.poses 还在）。
