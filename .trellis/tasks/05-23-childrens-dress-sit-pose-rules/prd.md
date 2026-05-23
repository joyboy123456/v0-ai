# 童装连衣裙 9 shot 完全随机化 + 外景场景二分（v3 终稿）

> 上游任务：`.trellis/tasks/05-23-photo-fission-category-prompts/`（童装连衣裙模板基线已落地）
> v1 → v2 → v3 演化：v1 只盯坐姿椅子；v2 扩到 9 shot 多样化 + 外景二分；v3 用户最终敲定"角度也完全随机，不要写死骨架，唯一固定的是场景比例 + 椅子规则"。

## Goal

把童装连衣裙 9 shot 模板从"每个 shot 写死角度+姿势+表情"重构为**"角度/姿势/表情/手势完全随机变化"**模式，唯一固定三件事：
1. **场景二分**：9 张图中 **2 张**走蓝天白云草地外景常量，**7 张**沿用参考图原背景
2. **坐姿椅子规则**：9 张图里有 **1 张坐姿** 必须用**白色金属折叠椅 + 单手提裙单手自然**
3. **邻家小姑娘气质锚点**：邻家小妹自然童趣、看镜头甜笑、禁止超模摆拍感

其它一切（角度、姿势、表情、手势、构图、机位）**全部交给模型随机发挥**，让 9 张图真正呈现"套图多样性"，而不是"套模板"。

## What I already know

* 当前模板 `lib/server/prompt-templates/childrens-dress.ts` 第 29-75 行 `CHILDRENS_DRESS_SHOT_BLUEPRINT` 每个 shot 写死了角度（正面/微侧 15°/左侧 60°/背面/右侧 30° 等）+ 姿势 + 手势 + 表情，这是用户最不满意的"套模版"根源
* 用户原话："也不是，固定姿势，就是随机，但是变化要大，每个图的表情和动作不一样"
* 用户最终原话："不用写死什么角度，镜头角度，这玩意就是完全随机，只是场景固定就行了，并且我们九张图里只有两张这个草地的"
* 用户已提供完整外景 JSON 预设，本小姐已沉到 `research/outdoor-grassland-scene-preset.md`
* 坐姿椅子细节（v1 决策保留）：白色金属折叠椅 + X 形椅脚 + 带靠背 + 椅腿可见 + 单手提裙 + 单手自然搭膝/垂体侧
* prompt 拼装链路：`buildPhotoFissionShotPlan → buildShotPrompt → buildShotSection`，本任务需要轻改 `photo-fission-service.ts` 注入"该 shot 是否外景"的判定
* dev server 跑在端口 3000（PID 84141，工作目录 `~/xinman/dianshang/v0-ai`），改完需手动重启
* 端口 3003 是 Gemini Antigravity worktree（前端主题预览用），与本任务无关

## Decisions (resolved)

### D1 — 角度/姿势/表情完全随机（用户最终敲定）

✅ **不再写死每个 shot 的角度**。所有 9 个 shot 共享同一份"随机变化锚点"，由模型在每张图自由选择角度、姿势、表情、手势、构图组合，目标是 9 张图任意两两之间差异显著。

### D2 — 场景二分（用户已确认）

✅ 9 张图 = **2 张外景（蓝天白云草地）** + **7 张原背景**。外景常量措辞照抄 `research/outdoor-grassland-scene-preset.md` 的中文模板。

### D3 — 外景由哪 2 个 shot 承担

✅ 简单实现：**最后 2 个 shot（shot_8、shot_9）固定走外景**，前 7 个 shot 走原背景。理由：
- 角度都随机了，无所谓哪个 shot 是哪个角度，按 index 切分最简单
- shot_7 坐姿椅子 shot 保留在前 7 位，不会被外景"污染"
- 实现上 `OUTDOOR_SHOT_INDICES = [7, 8]`（0-indexed），逻辑清晰

### D4 — 坐姿 shot 仍然固定一张（v1 决策保留 + 强化）

✅ 9 张图中**固定第 7 张**是坐姿 shot，必须使用白色金属折叠椅 + 单手提裙单手自然。其余 8 张完全随机（含外景的 2 张也是随机姿势）。

### D5 — 椅子规格（v1 决策保留）

✅ 白色金属折叠椅 + X 形椅脚 + 带靠背 + 椅腿在画面中完整可见。术语从"金属透明椅子"统一改为"白色金属折叠椅"。

### D6 — 坐姿手与裙互动（v1 决策保留）

✅ 一手手指轻提裙摆一侧（自然展示面料垂感与裙摆廓形）+ 另一手自然搭膝盖或垂放体侧。自然主动展示 ≠ 用力拽拉。

## Requirements

### 模板文件改动 `lib/server/prompt-templates/childrens-dress.ts`

* **重写 `CHILDRENS_DRESS_SHOT_BLUEPRINT`**：从 9 个独立写死的 shot 改成"统一随机锚点 + 坐姿例外 + 外景例外"
  - shot_1 ~ shot_6：description 都走"角度/姿势/表情完全随机"通用措辞（label 改成 `随机姿态 1` ~ `随机姿态 6`）
  - shot_7：坐姿 shot（白色金属折叠椅 + 单手提裙单手自然，沿用 v1 设计）
  - shot_8、shot_9：外景 shot（拼接蓝天草地常量 + 角度姿势仍随机）
* **新增 `CHILDRENS_DRESS_OUTDOOR_SCENE`** 中文常量（措辞抄 `research/outdoor-grassland-scene-preset.md`）
* **新增 `CHILDRENS_DRESS_OUTDOOR_SHOT_INDICES = [7, 8]`** 0-indexed 白名单
* **新增「随机变化锚点」`CHILDRENS_DRESS_VARIETY_ANCHOR`**：注入 STYLE 段，告诉模型"9 张图任意两张之间角度/姿势/表情必须显著不同"
* **改 `CHILDRENS_DRESS_STYLE_ANCHOR`**：加坐姿场景例外（手与裙互动放宽，非坐姿场景保持轻柔）
* **改 `CHILDRENS_DRESS_ANGLE_CONTROL`**：椅子术语统一为"白色金属折叠椅"，删除"必须包含 9 类固定角度"措辞，改为"9 张图角度必须差异化、禁止雷同"
* **改 `CHILDRENS_DRESS_NEGATIVE_ADDON`**：加外景相关负面词（仅 2 张外景 shot 拼接时附加，或简单粗暴全模板加也无害）
* **新增 getter** `getChildrensCategoryOutdoorScene` + `getChildrensCategoryOutdoorShotIndices` + `getChildrensCategoryVarietyAnchor`

### Service 文件改动 `lib/server/photo-fission-service.ts`

* `buildShotPrompt` 路径加判定：若当前 shot index 命中 `OUTDOOR_SHOT_INDICES`，则把外景常量拼到 SCENE 段（或 STYLE 段开头，看哪个 section 最合适）
* 不破坏 shot.prompt.length 上限、shotId 命名一致性、worker pool 调度、targetShotIds 子集重跑路径

## Acceptance Criteria

* [ ] 9 shot 中 shot_1 ~ shot_6 description 走"角度/姿势/表情完全随机"通用措辞，**不再写死角度数值**
* [ ] shot_7 包含白色金属折叠椅完整规格 + 单手提裙单手自然 + 邻家小姑娘气质
* [ ] shot_8、shot_9 prompt 拼接了完整外景常量（蓝天白云草地）
* [ ] shot_1 ~ shot_7 prompt **不出现**"蓝天 / 草地 / 户外公园"字样（保持原背景）
* [ ] `CHILDRENS_DRESS_ANGLE_CONTROL` 椅子术语统一为"白色金属折叠椅"
* [ ] `CHILDRENS_DRESS_STYLE_ANCHOR` 坐姿例外说明完整
* [ ] 端到端走查：选「童装 / 连衣裙」生成 9 张图，肉眼校验：
  - 7 张内景（参考图背景）+ 2 张外景（蓝天草地）
  - 1 张是坐姿（白色金属折叠椅 + 模特用手与裙互动）
  - 任意两张图角度/姿势/表情显著不同
  - 整体邻家小姑娘活泼气质
* [ ] `pnpm tsc --noEmit` 通过
* [ ] 不破坏其它品类（女装/男装/童装其它二级品类）模板

## Definition of Done

* TypeScript 编译通过
* 端到端走查通过（dev server 重启后 + 用户肉眼确认）
* 不破坏 worker pool / streaming pipeline / targetShotIds 重跑路径

## Out of Scope

* 不开放其它童装二级品类（套装、卫衣等）
* 不新增外景参考图上传槽位（纯 prompt 描述）
* 不在代码层做"随机抽取"逻辑（变化交给模型在随机锚点指导下自选）
* 不动其它品类（女装/男装）的模板
* 不沉淀新 spec（措辞细化 + 局部 service 改动；如实现时发现要动 spec 再说）

## Technical Notes

* 改动文件：
  - `lib/server/prompt-templates/childrens-dress.ts`（主战场）
  - `lib/server/photo-fission-service.ts`（注入外景常量判定）
* 外景常量原始 JSON 沉淀：`research/outdoor-grassland-scene-preset.md`
* 上游任务的 brainstorm 已确立 prompt 12 段拼装顺序与变量/常量分离原则，本任务沿用
* dev server 跑在端口 3000（PID 84141），改完手动重启
* 不需要 trellis-research 子代理（纯措辞细化 + 轻量 service 改动，无技术选型）

## Research References

* [`research/outdoor-grassland-scene-preset.md`](research/outdoor-grassland-scene-preset.md) — 用户提供的完整蓝天草地场景 JSON 预设，已转中文 prompt 模板供直接抄用
