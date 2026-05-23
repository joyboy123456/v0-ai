# brainstorm: 服装大片品类提示词模板化（v2 终稿）

> v2 修订时间：2026-05-23（基于客户「连衣裙.rtf」标准答案 + 3 张参考图灵感重写）
> v1 由 codex 创建，仅完成「品类参数链路」的搭架（lib/types.ts + 二级下拉 UI + 117 字 category section），但 shot 描述未按品类切换、反向提示未按品类强化，导致「变化不大」。

## Goal

把「服装大片裂变」从泛服装占位下拉，升级为服务童装客户内部使用的品类提示词模板入口：用户按现有流程上传主图（必填）、正面细节图（可选）、背面细节图（可选）后，系统根据所选童装品类自动接入**一整套 9 shot 专属 prompt 模板**（角度规则 + 动作骨架 + 表情神态 + 反向提示），让童装商拍生成结果接近客户已调好的「邻家小女孩自然童趣 + 商业转化」气质。

核心价值是替代客户「复制提示词模板 → 手动改品类描述 → 粘贴大模型」的重复劳动，同时**修复当前 9 shot 全 45° 雷同**的问题。本任务只调整服装大片裂变的品类与对应 9 shot prompt 模板，不新增参考图角色、不做独立 prompt 编译器。

## What I already know

* 现有 `photo-fission` 是固定 9 镜头蓝图（`PHOTO_FISSION_SHOT_BLUEPRINT` @ `lib/server/photo-fission-service.ts:57-97`），品类仅影响一段简短的「品类呈现重点」。
* 现有 9 个 shot 蓝图描述偏成人模板（招手 / 侧身行走 / 回头背影 / 45° 斜侧 / 局部细节），角度雷同且不适配童装气质。
* codex v1 已完成：`PHOTO_FISSION_CHILDRENS_CATEGORIES = [{ id: 'dress', label: '连衣裙' }]`、`childrensCategoryRequirementMap` 与 `buildCategoryLockSection` 注入路径、二级下拉 UI。
* codex v1 没做：9 shot description 未按品类切换、`buildNegativeSection` 没收 `childrensCategory` 参数、`buildCategoryLockSection:409` 把"本功能面向童装商拍"写死污染非童装品类、117 字长文案关键词被稀释。
* 客户标准答案：「连衣裙.rtf」中含 9 张图的镜头 / 动作 / 表情 / 场景完整模板，但**场景 / 发型 / 服装款式属于参考图变量**，**动作 / 表情 / 角度规则属于常量**。
* 3 张参考图揭示客户审美：**"邻家小女孩自然童趣"** > 摆拍超模感；**手指轻搭裙边/轻提**优于用力拉裙摆；**自然抿嘴看镜头**优于咧嘴大笑或闭眼夸张。

## Product Decisions

* 一级品类沿用现有入口（`上衣 / 裤子 / 裙子 / 套装 / 外套 / 童装`），二级品类只在 `童装` 下出现。
* 二级品类第一版命名保留 `dress` / 「连衣裙」（不改为 skirt），未来可继续扩展套装等。
* 品类模板区分**变量**与**常量**：场景 / 发型 / 服装款式 / 服装颜色 / 服装材质 / 道具 → 全部交给上传参考图与模型识别；prompt 只沉淀**角度规则 + 动作骨架 + 表情神态 + 灵性气质锚点 + 反向提示**。
* 9 个 shot 角度必须差异化，**不允许全部 45° 侧面**（当前裂变最大的问题）。
* 9 个 shot 里**只允许 1 个坐姿** shot，该 shot 唯一固定道具 = **金属透明椅子**。
* 反向提示词写成**通用规则**而非道具枚举：禁止生成参考图未提供的道具（包包/帽子/配饰/装饰物），不限品牌或具体物品名称。
* 儿童 + 内衣/内裤类需安全降级（不生成儿童穿着内衣/内裤的人像大片），本任务先不开放该二级品类。

## Final Design（v2 终稿｜核心）

### 1. 二级品类命名

```ts
// lib/types.ts（保持 codex v1 不动）
export const PHOTO_FISSION_CHILDRENS_CATEGORIES = [
  { id: 'dress', label: '连衣裙' },
] satisfies { id: PhotoFissionChildrensCategory; label: string }[]
```

### 2. 9 shot 角度 + 动作 + 表情骨架

> 场景 / 发型 / 服装款式 / 道具 = 变量（留给参考图）；下表均为 prompt 模板常量。

| # | shotId | label | 角度规则 | 动作骨架 | 表情神态 |
|---|--------|-------|----------|----------|----------|
| 1 | shot_1 | 正面全身 | 正面全身平视构图 | 自然站立 + 手指轻搭裙边或轻提裙摆 | 自然抿嘴微笑 + 看向镜头 |
| 2 | shot_2 | 微侧 15° | 约 15° 微侧（不要 45°） | 一手手指轻提裙摆边缘，另一手自然垂放 | 自然甜美 + 看向镜头 |
| 3 | shot_3 | 左侧 60° | 约 60° 大角度左侧（不要 45°） | 自然站立，裙摆自然垂展 | 自然可爱 |
| 4 | shot_4 | 右侧 30° | 约 30° 右侧 | 手指轻提裙摆边缘 + 轻微勾脚自然站立 | 甜美优雅 + 微微看镜头 |
| 5 | shot_5 | 背面全身 | 背面全身平视构图 | 背身站立，裙摆自然垂落 | — |
| 6 | shot_6 | 坐姿（金属透明椅子｜唯一坐姿） | 正面 / 微正面坐姿构图 | **优雅坐在金属透明椅子上**，**双手手指轻提裙摆两侧自然展开**（不抓握不捏紧），双腿并拢自然下垂，脚部自然着地 | **自然甜美 + 看向镜头 + 微抿嘴** + 灵动可爱 |
| 7 | shot_7 | 半坐 / 蹲 | 半坐 / 低坐 / 蹲姿（非椅子，场景自适应） | 双手后撑或自然放置，裙摆自然铺开 | 微抬头闭眼微笑 或 自然甜美 |
| 8 | shot_8 | 正面俏皮 | 正面或微正面 | **一手自然举至眉际 / 眼前**（像不经意小动作，禁止比 OK），另一手自然垂放 | 俏皮可爱 + 自然童趣微笑 + 看向镜头 |
| 9 | shot_9 | 自由互动 | 自由角度 | 开心玩耍 / 转身瞬间，裙摆自然飘扬 | 开心、萌、自然 |

### 3. 灵性气质锚点（全 shot 通用｜注入 style 段）

```
【灵性气质锚点｜童装连衣裙】
- 表现"邻家小女孩"的自然童趣气质，可爱真实有灵性，避免成人化、超模摆拍感
- 至少 5 个 shot 模特眼神看向镜头（建立观看者代入感）
- 表情自然：自然抿嘴微笑 + 眼睛微弯；避免咧嘴大笑、闭眼夸张、撅嘴卖萌过度
- 手势自然轻柔：手指轻搭裙边或轻提裙摆边缘；禁止紧握、用力抓裙、夸张大动作
- 整体像生活抓拍：模特正在自然玩耍 / 站立的瞬间被记录，禁止刻意"摆 pose"超模感
```

### 4. 角度差异化铁律（新增 section｜注入到 shot section 之前）

```
【角度差异化铁律】
- 9 个 shot 必须包含：正面 / 微侧 / 大侧 / 反侧 / 背面 / 坐姿 / 半坐 / 俏皮正面 / 自由互动
- 侧面 shot 角度必须有差异（15° / 30° / 60° 等），禁止所有侧面 shot 都使用 45°
- 坐姿 shot 全任务唯一一个，必须使用金属透明椅子；其他 shot 不得出现椅子
```

### 5. 通用反向提示词（按品类条件叠加｜替换 buildNegativeSection 固定版本）

```
【关键约束 - 通用】
- 不改变这套服装的颜色、版型、材质、图案与 logo；不改变人物的脸部特征与发型
- 保持场景与画面风格一致
- 不要生成：文字、水印、品牌印章、多余人物、多宫格拼接
- 不要变成卡通 / 插画 / 动漫 / 3D 渲染风格

【关键约束 - 童装 / 连衣裙 追加】
- 画面中只允许出现参考图明确包含的服装、模特与道具元素；禁止凭空生成参考图未提供的包包、帽子、配饰、装饰物、额外道具
- 道具如有出现，不得遮挡裙子主体（裙摆与版型必须完整可见）
- 不要把连衣裙生成成裤装、瑜伽裤、紧身裤、贴腿包裹下装；保留裙摆轮廓
- 不要 9 张图全部使用 45° 侧面构图；不同 shot 角度必须差异化
- 不要儿童成人化、性感化表达；保持儿童年龄感与自然童趣
```

### 6. 「品类呈现重点」section 修复

* 删除 `buildCategoryLockSection:409` 写死的 "本功能面向童装商拍..." 兜底语
* 改为只在 `category === 'childrens'` 时才输出儿童气质引导语
* 该 section 中 `childrensCategoryRequirementMap['dress']` 的 117 字长文案**拆分**：
  - 「裙类结构规则」（不能变裤装）→ 进**反向提示词**
  - 「动作常量」→ 进**各 shot description**
  - 「表情常量」→ 进**灵性气质锚点**

## Implementation Plan

### 文件清单

| 文件 | 改动类型 | 备注 |
|------|---------|------|
| `lib/server/prompt-templates/childrens-dress.ts` | **新增** | 9 shot 数据 + 灵性气质锚点 + 角度铁律 + 童装连衣裙反向提示模板 |
| `lib/server/photo-fission-service.ts` | 改造 | `buildPhotoFissionShotPlan` 按 `childrensCategory` 分流；`buildNegativeSection(category, childrensCategory)`；新增 `buildAngleControlSection`；删 `buildCategoryLockSection:409` 写死兜底语 |
| `lib/types.ts` | **不动** | codex v1 已就绪 |
| `components/workbench/left-panel.tsx` | **不动** | codex v1 已接 UI 二级下拉 |

### 函数签名变更

```ts
// 新增
function buildAngleControlSection(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string

// 改造
function buildNegativeSection(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string

// 改造（按品类分流 shot 模板）
export function buildPhotoFissionShotPlan(
  input: PhotoFissionShotPlanInput,
): PhotoFissionShot[]
```

### prompt 12 段拼装顺序（保持稳定，调整 section 内容）

1. 任务声明 ← 不变
2. 参考图说明 ← 不变
3. 人物呈现 IDENTITY ← 不变
4. 服装呈现 WARDROBE ← 不变
5. 场景呈现 SCENE ← 不变
6. 光线呈现 LIGHTING ← 不变
7. 画面质感 STYLE **+ 灵性气质锚点（童装时）** ← 调整
8. **角度差异化铁律（新增）** + 当前镜头 SHOT（按品类专属模板） ← 调整
9. 品类呈现重点（清理污染） ← 调整
10. 人体解剖 ANATOMY ← 不变
11. 输出参数 ← 不变
12. 关键约束（通用 + 童装连衣裙追加） ← 调整

## Acceptance Criteria

* [ ] 只有一级品类选择 `童装` 时，才显示二级童装品类选择框（codex v1 已满足）
* [ ] 选择 `童装 -> 连衣裙` 时，9 个 shot 的 `shot.prompt` 包含**专属的 9 套角度 + 动作 + 表情**，而非通用蓝图
* [ ] 9 个 shot 角度分布满足角度差异化铁律（包含正/微侧/大侧/反侧/背/坐/半坐/俏皮/互动）
* [ ] 9 shot 里恰好 1 个为坐姿且固定为「金属透明椅子」
* [ ] `childrensCategory === 'dress'` 时，`buildNegativeSection` 输出包含「禁止凭空生成参考图未提供的道具 / 不要变裤装 / 不要 45° 雷同 / 不要成人化」
* [ ] `category !== 'childrens'` 时，`buildCategoryLockSection` 不输出儿童气质兜底语（修复 codex v1 污染）
* [ ] 一级品类列表与现有主图 / 正面 / 背面细节图上传流程保持不变
* [ ] 每条 `shot.prompt.length` 不超过 30000（沿用既有 guard）

## Definition of Done

* TypeScript 编译通过（`pnpm tsc --noEmit`）
* ESLint 通过（`pnpm lint`）
* `lib/server/prompt-templates/childrens-dress.ts` 通过单测验证 9 shot 的角度/动作/表情字段非空且互不雷同
* 端到端走查：选择「童装 / 连衣裙」生成 9 张图，肉眼校验角度、动作、表情、坐姿椅子规则
* 不破坏 `streaming-fission-pipeline.md` 编排契约（worker pool + `onShotResult` + `targetShotIds` 子集重跑）

## Out of Scope

* 不在本任务里改模型供应商或并发调度
* 不在本任务里做生产 API 敏感数据调用
* 不新增童模 / 鞋 / 包 / 场景等上传槽位
* 不做独立 prompt 编译器
* 不开放童装内衣 / 内裤二级品类（安全合规先 hold）
* 不实现成人服装泛化的 9 shot 专属模板（套装、上衣等保持现有通用蓝图）

## Technical Notes

* Existing service: `lib/server/photo-fission-service.ts`
* Existing blueprint: `PHOTO_FISSION_SHOT_BLUEPRINT` @ `:57-97`（成人通用蓝图，本任务不删，作为非童装品类的 fallback）
* Existing category injection: `buildCategoryLockSection` @ `:403`、`buildOutputParamsSection` @ `:439`
* Existing negative: `buildNegativeSection` @ `:457`（本任务改造签名 + 内容）
* Existing UI: `components/workbench/left-panel.tsx`（二级下拉已就绪）
* 关联 spec: `.trellis/spec/backend/streaming-fission-pipeline.md`（编排契约不破坏）
* 客户标准答案来源：`/Users/shishenglin1/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_p1g3dzt9dr8y22_ff7f/msg/file/2026-05/连衣裙.rtf`（变量/常量提取见 `extracted-category-prompts.md`）
