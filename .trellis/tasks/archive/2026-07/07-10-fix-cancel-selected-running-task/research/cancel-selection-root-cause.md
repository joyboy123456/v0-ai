# 取消入口根因核对

- `Workbench` 创建任务后会将 `activeTaskId` 设置为新任务；点击历史卡片也会更新该值。
- `RightPanel` 在历史 Tab 中将 `visibleTask` 固定为 `currentFeatureTasks[0]`，忽略属于当前功能的 `activeTask`。
- `currentFeatureTasks` 来自后端按创建时间倒序的任务列表，因此 `[0]` 总是最新任务。
- 只有 `visibleTask` 会渲染 `LiveTaskProgressPanel` 和携带 `onCancelTask` 的 `TaskStatusCard`。
- 普通历史卡没有取消入口。
- 后端 `cancelTask(taskId)` 使用按 taskId 保存的 `AbortController`，可以独立取消任意受支持的运行中服装裂变任务。
- 最小修复是在历史页选择 `visibleTask` 时，优先采用 feature 与当前页面一致的 `activeTask`，否则回退到最新任务。
