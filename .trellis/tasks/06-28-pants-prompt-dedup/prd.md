# 裤子裂变提示词去重与差异化优化

## Goal

裤子品类 10 张裂变图中出现两张高度相似甚至返回原图的问题。根因是最终发给图像模型的 prompt 中"与主图一致"类约束重复 5 次/张，淹没了唯一的差异信号（姿势）；同方向多张的【本张镜头】段在清洗后几乎相同；toe-point 等姿势的 mustShow/mustNotLookLike 跨方向完全一致。需要优化 prompt 组装逻辑，确保每张图的 prompt 都有明确且不重复的差异化指令。

## What I already know

- `buildCompactPantsShotPrompt` 是裤子最终 prompt 组装函数（`photo-fission-service.ts:673-748`）
- "画面边界、相机距离、主体大小与主图一致"在【任务】【参考图】【商品与构图锁定】【本张镜头】段重复出现
- `removePantsPoseTextFromPlannerPrompt` 清洗后，同方向多张的【本张镜头】段只剩模板句
- `inferPantsPoseVisibility` 对 toe-point 等动作族返回跨方向相同的 mustShow/mustNotLookLike
- Google 官方建议：direct and concise、positive framing、lead with critical、don't dilute focus
- 裤子是唯一用自然语言【】段落而非 JSON 格式的品类，保持当前格式不变

## Requirements

1. **去重构图锁定**：构图锁定信息（画面边界、相机距离、主体大小、上边缘对齐、上衣范围）只在【商品与构图锁定】段出现一次，不在【任务】【参考图】【本张镜头】段重复
2. **移除跨镜头引用**：最终发给生图模型的 prompt 中不得出现"同批""同一批""其它镜头""与同批其它镜头形成差异"等跨镜头引用文本。生图模型每次只看到 1 个 prompt，无法感知其它 9 张图。差异必须靠 prompt 文本本身的不同来实现（不同姿势指令、不同角度数值、不同参考图子集），而不是告诉模型"别和其它图重复"
3. **强化姿势差异前置**：【唯一指定姿势】段的差异信号不被前置的模板文本淹没，减少【任务】段的模板化重复文本
4. **差异化【本张镜头】段**：同方向多张的【本张镜头】段必须包含角度差异描述（如"微右约5°"vs"微左约5°"），不依赖 Planner 输出（因为 Planner 输出会被清洗）
5. **姿势 mustShow 按方向区分**：toe-point 等动作族的 mustShow/mustNotLookLike 需要按 front/left/right/back 方向区分，不能跨方向完全相同
6. **负面转正向**：【禁止】段改为正向描述为主，减少纯负面指令
7. **DeepSeek 参与姿势选择与去重**：把姿势库（已传入）告诉 DeepSeek，让它在输出中为每个 shotId 选择一张姿势卡 id。DeepSeek 一次看 10 个 shotId，能从文本语义层面判断动作是否重复（如"脚尖点地"正面和背面视觉相似），不需要后端做 visualFamily 字符串匹配去重。后端只校验 poseCardId 存在性和方向合法性，不校验动作族重复
8. **保持后端兜底机制**：抽卡算法保留，作为 DeepSeek 选择不合法时的兜底

## Acceptance Criteria

- [ ] 10 张图中任意两张的最终 prompt 文本差异率 > 30%（不只是姿势段不同）
- [ ] "与主图一致"类约束在每张 prompt 中最多出现 2 次（【商品与构图锁定】段 1 次 + 【禁止】段正向表述 1 次）
- [ ] 最终 prompt 中不出现"同批""同一批""其它镜头"等跨镜头引用文本
- [ ] 同方向多张（如 3 张正面）的【本张镜头】段文本各不相同，包含角度差异
- [ ] toe-point 动作族在正面/背面/侧面方向的 mustShow 文本不同
- [ ] DeepSeek 输出包含 poseCardId 字段，后端校验 poseCardId 存在性和方向合法性，不合法时回退算法抽卡
- [ ] 10 张图分配的姿势卡无语义重复（由 DeepSeek 语义判断，不由后端字符串匹配）
- [ ] lint / type-check 通过
- [ ] 现有姿势卡校验、兜底逻辑不被破坏

## Definition of Done

- lint / typecheck 绿
- 现有 test 不被破坏
- prompt 组装逻辑改动有日志可追踪

## Out of Scope

- 不改 JSON 格式（保持当前【】自然语言段落格式）
- 不改姿势卡库本身（`PANTS_POSE_LIBRARY` 的 card 定义）
- 不改抽卡算法（`buildPantsAssignedPosePlan`）
- 不改 Planner 失败回退逻辑

## Technical Approach

### 改动文件

1. **`lib/server/photo-fission-service.ts`** — `buildCompactPantsShotPrompt` + `applyShotPlannerOverride`
   - 去重：【任务】段移除"画面边界、相机距离..."重复文本
   - 去重：【参考图】段移除"画面边界、相机距离..."重复文本
   - 去重：【本张镜头】段移除"画面边界、相机距离..."模板句
   - 移除跨镜头引用：`buildPantsAngleInstruction` 移除"与同批其它镜头形成可见角度差"
   - 强化：【本张镜头】段注入角度差异描述（只保留角度数值本身）
   - 正向化：【禁止】段改为正向描述
   - `applyShotPlannerOverride`：解析 DeepSeek 输出的 poseCardId，校验合法性，不合法回退算法抽卡

2. **`lib/server/prompt-templates/pants-planner-system.ts`** — `buildPantsPlannerSystemPrompt` + blueprint descriptions + `buildPantsPlannerUserPrompt`
   - blueprint descriptions 移除"与同批其它镜头形成可见角度差"
   - system prompt 改为让 DeepSeek 从姿势库选姿势卡 id：明确去重约束（同视觉动作族全批最多 1 次、不得选语义相似姿势）、输出格式加 poseCardId 字段
   - 确保 system prompt 是纯文本指令，用"图1""图2"编号描述参考图角色（DeepSeek 是纯文本模型）

3. **`lib/server/prompt-templates/pants-pose-library.ts`** — `inferPantsPoseVisibility`
   - toe-point/knee-bend/walking 等动作族的 mustShow 按 view 区分
   - 正面/背面/侧面方向的差异点描述不同

4. **`lib/server/photo-fission-shot-planner.ts`** — `ShotCardSchema`
   - schema 加 poseCardId 可选字段
   - 校验 poseCardId 存在于姿势库

### 不改动

- `buildPantsAssignedPosePlan`（抽卡算法，保留作为兜底）
- `PANTS_POSE_LIBRARY`（姿势卡定义）
- `removePantsPoseTextFromPlannerPrompt`（清洗逻辑）

## Decision (ADR-lite)

**Context**: 裤子 10 张裂变出现相似图和原图复制，排查发现 prompt 重复严重、差异信号被稀释

**Decision**: 三层优化——①DeepSeek 参与姿势选择，利用其语义理解做全局动作去重；②Planner system prompt 强化差异化指令让 LLM 写出真正不同的 10 段描述；③最终 prompt 组装层去重并移除跨镜头引用，让差异信号不被模板噪声稀释。后端抽卡算法保留作为兜底。

**Consequences**: 改动范围可控，不影响 LLM 导演的输入端；如果后续 Planner 输出质量提升，去重后的 prompt 结构仍然适用

## Technical Notes

- 官方 Gemini 3 指南：direct and concise、positive framing、lead with critical、don't dilute focus
- 裤子 prompt 结构：【任务】→【唯一指定姿势】→【参考图】→【商品与构图锁定】→【本张镜头】→【禁止】→【输出参数】
- 姿势注入：`buildPantsAssignedPoseInstruction` 生成自然语言指令，注入到【唯一指定姿势】段
- 角度指令：`buildPantsAngleInstruction` 已有角度差异逻辑，可复用到【本张镜头】段
