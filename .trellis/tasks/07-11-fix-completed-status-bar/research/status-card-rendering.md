# 状态卡渲染边界

## 现状

`components/workbench/right-panel.tsx` 的普通结果面板在存在 `visibleTask` 时无条件渲染 `TaskStatusCard`。任务成功后数据仍作为 `activeTask` 保留，因此卡片永久显示为“生成完成 / 进度 100%”。

## 仓库内一致性

同文件的历史记录实时任务区域通过 `showHistoryLiveTask` 仅展示 `pending` / `running` 任务。终态任务留在历史结果列表中，不再占用实时状态区域。

## 修复结论

普通结果面板应保留 `visibleTask` 以继续驱动结果图片交互，仅对状态卡增加展示条件。完整成功且已有结果时隐藏；其他状态继续显示，以保留进度、错误和重试信息。

