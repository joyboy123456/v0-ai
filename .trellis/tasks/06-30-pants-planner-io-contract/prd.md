# 裤子分镜导演输入输出标准

## 背景

裤子品类最终成图质量主要由分镜导演输出给生图模型的 prompt 控制。现有裤子链路使用通用 `imagePrompt` 八字段结构，无法明确表达“LLM 自己写最终提示词 + 后端校验元数据”的契约，也难以稳定校验无手/有手模式、角度顺序和姿势去重。

## 目标

- 保留 LLM 分镜导演的起草、自检、重写去重流程。
- 裤子任务改为输出 `finalPrompt + 元数据`，`finalPrompt` 是可直接送入生图模型的最终提示词。
- 后端只定义输入输出标准并校验，不接管创意提示词写作。

## 验收标准

- 裤子 Planner 输出包含 `shotId / role / view / angle / poseCardId / finalPrompt / selfCheck`。
- 10 张顺序固定为 1 背、3 正、3 左、3 右，并使用标准 angle token。
- 无手模式正向 prompt 不写手部词，不补全身/头脸；负向 prompt 包含 no hands/no arms 类约束。
- 有手模式正向 prompt 必须有明确手部造型，禁止双手下垂、自然摆放、贴裤缝等危险动作。
- 后端校验 poseCardId、视觉动作族、腿型轮廓、左右镜像不重复。
