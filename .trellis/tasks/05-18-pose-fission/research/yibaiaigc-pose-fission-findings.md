# 参考站点 yibaiaigc.com 姿势裂变逆向发现

> 来源：`research/yibaiaigc/全部功能逆向分析.md` 第四章「姿势裂变 (ai-posture-virality)」
> 资料类型：参考站点 API requestParam 逆向（非本项目代码）
> 写入时间：2026-05-18，brainstorm 后期

## 1. 参考站点路由与字段命名

```json
POST .../ai-posture-virality
{
  "postures": [
    { "postureLibId": 6 },
    { "postureLibId": 11 }
  ],
  "files": [
    { "width": 2747, "height": 4096, "url": "...", "type": "image" }
  ],
  "aspectRatio": "2:3",
  "model": "PRO",
  "resolution": "2k"
}
```

固定生成 **7 张**（参考站点）；本小姐 PRD 设计 1-9 多选自由度。

## 2. 与本小姐 PRD 对齐情况

| 维度 | 参考站点 | 本小姐 PRD | 对齐结论 |
|---|---|---|---|
| 路由命名 | `ai-posture-virality` | `pose-fission` | 已有 featureType，**不动** |
| 多选传参 | `postures: [{postureLibId}]` | `poseTemplateIds: string[]` + `poseTemplateSnapshots` | **设计一致**（结构更扁平） |
| 姿势模板 ID 类型 | `number`（6, 11） | `string`（'template-stand-1'） | **本小姐用 string 更可读** |
| 输入图 | `files: [{width,height,url,type}]` | `inputAssetIds: string[]` + AssetRecord 已有 width/height/fileUrl | **本小姐 AssetRecord 已对齐** |
| 模型字段 | `model: "PRO"` | `model: FashionModelId`（gemini-3-pro-image-preview） | **本小姐模型 ID 更精确**，UI label「旗舰版」 |
| 比例 | `aspectRatio: "2:3"` | `imageRatio: PoseImageRatio`（10 个含 9:16） | **本小姐覆盖更全** |
| 分辨率 | `resolution: "2k"` | `resolution: PoseResolution`（1k/2k/4k） | **一致** |
| **prompt** | **无（"完全依赖姿势库 ID"）** | `PoseTemplate.prompt: string` 在后端拼装 | **设计差异——见 §3** |
| 生成数量 | 固定 7 | 1-9 多选 | **本小姐更灵活** |

## 3. 关键设计差异：为什么我们必须保留 prompt 字段

参考站点：用 `postureLibId` 触发后端预存模板 → 后端有自己的图像生成专用 API（可能是闭源 SaaS），姿势库就是 server 端配置，前端只需传 ID。

本小姐项目：直接调 Google Gemini Image API → Gemini 是通用多模态模型，需要**显式 text prompt** 指示目标姿势。

**结论**：
- 数据结构对齐参考站点（多选数组）
- **prompt 必须保留**在 `PoseTemplate` 上（不传给前端用户编辑，只传给后端拼装 finalPrompt）
- `PoseFissionParams.poseTemplateSnapshots` 冗余存 prompt 是必需的（任务执行时 Gemini 调用要用）

## 4. 对 PR2 后端 pipeline 的启发

参考站点把姿势库做成"无 prompt 黑盒"是更安全的产品形态。但我们 MVP 不到那一步——MVP 阶段：
- `POSE_TEMPLATES` 是常量（不入库），prompt 字段写死
- 后端 `runPoseFissionPipeline` 对每个 template 拼装 finalPrompt：`base prompt + template.prompt + 服装/质感保持要求`
- 不向前端泄漏 prompt 内容（前端只显示 name + imageUrl）

## 5. 对 prompt 内容的启发

参考资料库 5525 条服装大片提示词全部是「服装大片」场景，与姿势裂变无关。
但 prompt 工程通用经验可借鉴：
- "穿着这个服装" 占位符模式
- 姿态描述放在「人物描述」和「服装描述」之间
- gemini3pro / seedream 双模型支持的命名规范

## 6. 不可借鉴的部分

- 参考站点的姿势库 ID 是数字 6/11 等，**含义未公开**，无法直接复用
- 参考站点的 5525 条服装大片提示词与姿势裂变功能无关
- 121M 资料仓库（`research/yibaiaigc/`）已加入 .gitignore，**不入版本控制**，仅供 implement 阶段离线参考

## 7. PR1 / PR2 是否需要因此调整

**不需要调整 PRD 的 11 个决策**。所有发现都验证了本小姐 PRD 的设计方向：
- 多选数组结构 ✅ 对齐
- 模型选择 ✅ 对齐
- 比例/分辨率 ✅ 对齐
- prompt 字段保留 ✅ 技术必要

PR1 / PR2 按 PRD 推进即可。
