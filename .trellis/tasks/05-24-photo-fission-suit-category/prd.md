# brainstorm: 服装大片新增套装品类

## Goal

给「服装大片裂变」童装新增二级品类「套装」，让用户能在 photo-fission 表单的童装品类里选择套装，并复用现有 LLM Shot Planner、动态 resultCount、worker pool、流式持久化与 retry 链路生成 2 / 4 / 9 / 10 张商品图。

## What I Already Know

* 用户点名的接入规范是 `.trellis/spec/backend/photo-fission-category-extension.md`。
* 用户提供的套装资料位于 `套装.rtf`，用作套装人物动作、表情、肢体互动和不遮挡规则参考；白色棚拍、裤长、鞋包、花束、发型等属于样片变量，实际生成必须保持上传图一致。
* 当前代码已有 `childrens/dress` 路径、动态 `PhotoFissionResultCount = 2 | 4 | 9 | 10`、通用 `invokeShotPlanner`、规则引擎分发、service fallback blueprint。
* 当前 `components/workbench/left-panel.tsx` 暂时硬编码 `category: "childrens"`，需要恢复一级品类 state 和下拉。

## Requirements

* 在 `lib/types.ts` 中加入 `PhotoFissionChildrensCategory = 'dress' | 'suit'`，并在 `PHOTO_FISSION_CHILDRENS_CATEGORIES` 暴露「套装」选项。
* 前端 photo-fission 表单保持一级品类为「童装」，童装二级品类支持选择「连衣裙」或「套装」。
* 请求体中套装必须传 `category: 'childrens'` 与 `childrensCategory: 'suit'`。
* 新增套装 strategy 文件，提供 system prompt、user prompt、slots、fallback blueprint，支持 2 / 4 / 9 / 10。
* `photo-fission-rule-engine.ts` 只做路由接入，不复制文本 LLM fetch / JSON parse / schema。
* `photo-fission-service.ts` normalize / fallback shotPlan 能识别 suit 并使用套装 blueprint 与品类约束。
* 套装 prompt 必须体现 RTF 资料里的动作/表情规律：成套关系清楚、姿态俏皮但克制、鞋包花束等仅在原图已有时保留且不能遮挡卖点；背景、服装、人物、发型、裤长、鞋包道具和光线都保持上传图一致。
* 套装作为童装二级品类时，9/10 张裂变要和连衣裙保持同一摄影导演逻辑：包含 2 张晴朗夏日蓝天绿草地真实外景补充图，外景不出现白云；外景动作服务套装卖点，不照搬连衣裙的提裙/铺裙动作。
* 套装动作必须显著差异化，OK/比耶等手势不能批量重复；每张图 role 和 imagePrompt 都要体现不同主导动作。
* 套装 9 张分镜必须像连衣裙一样做强差异化：角度覆盖正面、微侧、左侧、右侧、侧后/背面、半身细节、下半身裤脚鞋型和外景；姿势/表情随机但每张不同，可包含插兜感、叉腰、点地、交叉腿、元气调皮、帅气冷酷、左看右看、低头抬头、闭眼微风、嘟嘴比耶、单眨眼、扶帽檐等商品摆拍动作；任何动作、包包或配饰都不能遮挡服装细节和卖点。
* 当前只针对童装套装：套装姿势要手、腿、脚配合起来动，不能只有手势变化；可按参考图实际情况条件化使用指印花、轻捏衣角、扶帽檐、戴/扶外套帽子、看向侧边包包、脚尖点地、单脚微翘、轻微走姿、加油/打招呼等小幅动作。外景蓝天草地图禁止背面、纯背影和侧后回看。面部要求真人皮肤纹理、清晰眼神光、自然聚焦、眨眼和嘴角微动等微表情，动作要有真实重心、惯性、衣服褶皱和头发动态，避免塑料皮肤、机械表情或漂浮肢体。
* 套装姿势细化：侧面图不要指向衣服图案，指印花/图案只在正面或接近正面展示时偶尔出现且最多 1 张；展示背面时只展示背部轮廓，不回眸、不回头看镜头；外景姿势不能只用挥手/打招呼，需要从脚尖点地、轻扶发顶、轻微走姿、双手背后、手心轻抬等自然姿势里随机变化。表情要元气可爱、俏皮自然，避免呲牙大笑、挤眉弄眼、皱鼻、夸张张嘴，也不要把单眨眼、露齿笑、嘟嘴和比耶叠在同一张里。
* 套装动作库不能只限于用户已列举动作：LLM 可随机生成同类自然小动作和微表情，但必须服务商品展示且不遮挡套装。新增可抽卡动作包含单眨眼轻戳脸颊、轻轻嘟嘴/自然比耶、微微惊喜、正面手搭额头/头顶附近眺望、单手撩发开心自然轻露齿、反着比耶且另一手自然下垂、参考图有鸭舌帽时可反戴或扶帽、参考图有外套帽子时可戴帽、参考图有口袋时可插兜 1-2 张。外景姿势继续扩充，不能只出现抬手动作。
* 外套细节展示：如果参考图包含外套，9/10 张中要有几张外套开合状态变化，例如拉上拉链/扣上扣子的闭合展示、敞开一点点、手轻轻打开一边外套、完全敞开外套；如果外套有拉链，可以手轻轻把拉链往下拉一点点；如果衣服或外套有独特设计感扣子，可以在不遮挡印花和扣子细节的情况下手指扣子、扣上扣子或敞开几颗扣子。没有外套/拉链/扣子时不能凭空新增。
* 最新修正：外套/拉链/扣子属于高风险结构动作，Planner 不看图时不能在最终 imagePrompt 里输出“如果/没有时改为”等条件句；不确定时优先使用轻捏衣角、手停腰侧、脚尖点地等不会改变服装结构的动作。裤长必须严格跟随参考图，原图短裤就保持短裤，原图长裤就保持长裤，不能被“套装”规则改写。外景需要真实草地和柔和户外散射光，避免假草皮、过饱和荧光绿、重复贴图、硬阳光和总是低头看脚尖的重复姿势。
* 最新修正：套装动作表情要根据参考图服装调性生成。运动风使用轻运动商品摆拍，休闲套装使用松弛慵懒动作，可爱童趣套装使用元气活力表情，甜酷/中性套装使用冷酷浅笑、侧身廓形和插兜感。参考图已有道具时可做低遮挡童趣互动，参考图没有道具时不能新增。
* 最新修正：重复点击生图时需要跨次动作冷却。最近几次生成中过于高频的动作/表情族，例如嘟嘴比耶、OK、挥手、低头看脚尖、插兜等，在下一轮要显著降低出现频率，等待 3-4 次后再自然回流。
* 最新修正：人物脸部、五官、嘴型、牙齿状态和年龄感必须贴近参考图；避免缺牙、乱牙、黑洞牙、夸张露齿、僵硬假笑和导致人物不像参考图的表情。每次 9/10 张生成必须包含 2 张外景和 1 张背面展示；背面展示不回眸、不回头，外景不使用背面。

## Acceptance Criteria

* [ ] `PHOTO_FISSION_CATEGORIES` 只包含「童装」，`PHOTO_FISSION_CHILDRENS_CATEGORIES` 包含「连衣裙」和「套装」。
* [ ] photo-fission 表单在童装品类下可选择「套装」。
* [ ] `buildPhotoFissionShotPlan({ category: 'childrens', childrensCategory: 'suit', resultCount: N })` 对 N = 2 / 4 / 9 / 10 返回 N 个连续 `shot_1..shot_N`。
* [ ] `buildPlannerRulePlan('childrens', 'suit', N)` 对 N = 2 / 4 / 9 / 10 返回非空 plan，且 prompt 含正确数量。
* [ ] 套装策略复用 `invokeShotPlanner` 链路，不新增 pipeline 或文本 LLM 调用。
* [ ] 套装 prompt 强制每段同时描述手部动作与腿脚重心；9/10 张中外景为 2 张晴朗夏日蓝天绿草地真实外景，场景不出现白云，且不使用背面/侧后角度。
* [ ] 套装 9/10 张 fallback blueprint 和 Planner prompt 都保证 2 张外景、1 张背面展示；背面展示不回眸、不回头。
* [ ] 套装 Planner 能接收最近动作/表情族冷却提示，使连续点击时上一轮高频动作在下一轮显著降频。
* [ ] 套装 prompt 包含服装调性自适应、参考图已有道具低遮挡互动、人物脸部/牙齿一致性和自然笑容约束。
* [ ] `npx --no-install tsc --noEmit`、`npm run lint`、`git diff --check` 完成或记录阻塞。

## Technical Approach

按品类扩展 spec 的最小接入法实现：

* 类型/UI：保留 `photoFissionCategory = 'childrens'`，前端在童装二级品类下新增「套装」。
* Strategy：新增 `lib/server/prompt-templates/suit-planner-system.ts`，将品类知识集中在策略文件中。
* Rule Engine：新增 `category === 'childrens' && childrensCategory === 'suit'` 分支，返回套装 system/user prompt 和 slots。
* Service：新增童装套装 blueprint 接入和 `childrensCategoryRequirementMap.suit`，让 fallback shotPlan 与 planner prompt 对齐。

## Out of Scope

* 不新增成人/童装套装的二级分类体系。
* 不新增案例库图片或右侧套装示例。
* 不改通用文本 LLM 底座、图像 provider、worker pool、任务存储与 retry 机制。
* 不提交 git commit / branch。

## Technical Notes

* 规格：`.trellis/spec/backend/photo-fission-category-extension.md`
* 相关实现：`lib/types.ts`、`components/workbench/left-panel.tsx`、`lib/server/photo-fission-rule-engine.ts`、`lib/server/photo-fission-service.ts`
* 参考实现：`lib/server/prompt-templates/childrens-dress.ts`、`lib/server/prompt-templates/childrens-dress-planner-system.ts`
* 用户资料：`套装.rtf`
