# VOZEB-PRO 本地评估说明

来源：https://github.com/csyqlz/VOZEB-PRO

固定版本：`3573154a12bab922c132df0159787cbe430eee17`。

许可：Business Source License 1.1，完整上游文本见本目录 `LICENSE`。项目主体的 MIT 声明不覆盖这里标注的上游代码及其改编部分。

本次最小 Beta 的代码移植范围：

- `lib/agent-beta/canvas-geometry.ts` 的屏幕坐标换算，改编自 `web/src/app/(user)/canvas/utils/canvas-surface-geometry.ts` 的 `worldFromScreen`。改动包括独立类型、缩放边界校验与容器相对坐标接口。
- Agent 采用上游的“会话 → 结构化计划 → 任务执行 → 结果节点”分层设计；本项目只适配服饰单图生成，未整包引入上游账号、数据库、计费、视频或音频系统。

当前未取得商业集成授权，仅进行本地开发、测试和评估。Beta 的生产环境门禁始终关闭。任何后续商业集成或发布需先解决适用授权，不能仅修改开关绕过此边界。
