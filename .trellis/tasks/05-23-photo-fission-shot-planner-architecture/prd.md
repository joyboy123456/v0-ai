# Fission Prompt Planner 底层架构（v5｜brainstorm 终稿）

> 上游任务：`.trellis/tasks/05-23-childrens-dress-sit-pose-rules/`（v4 完成手写叙事 + 硬约束基础设施）
> v5 任务定位：**底层架构改造**，未来所有裂变功能都走这套规则引擎 + LLM 提示词策划器架构。
> 用户原话："这个是一个大改造，这个涉及裂变的底层后续所有的裂变都可以走这套逻辑"
> 2026-05-24 增补目标：童装连衣裙已经验证「LLM 调用规则写提示词给生图模型」这条链路可行，今天要把它抽成 photo-fission / pose-fission / 未来品类都能复用的底座。
> brainstorm 完成时间：2026-05-23

## Goal

把当前的「手写 N 段固定 prompt」模式升级为「**规则策略层 + 通用 LLM Prompt Planner + Feature 编译接入层**」三层架构，让裂变功能真正具备：
1. **每次套图叙事都不同**（同客户裂变 100 次能得到 100 套不同剧本）
2. **N 张图有受控分工**（不是 N 段随机叙事，而是覆盖当前 feature 的业务目标）
3. **商品 / 姿势目标永远是主角**（动作、场景、氛围只是服务目标，不能破坏服装版型、人物身份或姿势模板）
4. **LLM 受限于规则策略**（在规则引擎提供的白名单、红线和 few-shot 内生成导演式自然语言 prompt）

## 2026-05-24 Goal Update：底座范围

本任务不再只理解为「photo-fission 的童装连衣裙 Planner」。童装连衣裙是第一套投产策略，但底层能力必须服务：

* **服装大片裂变 photo-fission**：童装连衣裙先跑通，后续成人上衣、裤装、半身裙、套装、外套等只新增策略提示词与品类规则。
* **姿势裂变 pose-fission**：未来也可以在姿势模板图之前增加 LLM Prompt Planner，让它把「参考人物 + 目标姿势模板 + 商品展示红线」编成更稳的自然语言提示词。
* **未来其它 fission 类功能**：沿用同一个文本 LLM 调用、JSON 解析、schema 校验、日志、fallback 契约。

底座必须做到：通用调用层不懂具体品类；策略层负责 prompt 工程；feature 服务层只负责把策略输出接进现有 pipeline。不能让 `photo-fission-*` 的命名和类型成为未来 pose-fission 复用的障碍。

## 大白话：本任务在做什么

类比拍电视剧：
- 旧版本（v4）= 本小姐手写 N 集固定剧本，每次拍都一样
- 新版本（v5）= 本小姐写「角色卡 + 道具菜单 + 红线手册」，让 AI 当导演每次现编 N 集不同剧本

翻译：
- N 集电视剧 = N 张裂变图
- 角色卡 = **Planner Card / Prompt Card / Pose Card**（由具体策略决定）
- 道具/动作/表情菜单 = **变量池**（场景池 / 角度池 / 动作池 / 景别池 / 表情池 / 互动池，每池 8-12 个选项）
- 红线手册 = **禁忌黑名单**（不能奔跑 / 不能背对 / 不能改颜色 / 不能裁脚等）
- AI 当导演 = **OpenAI 兼容文本 LLM**（调用一次，输出结构化 JSON）
- 现编 N 集剧本 = **N 个 Planner Card**（结构化 JSON）
- 翻拍 = N 段 prompt 拼好 → 给图像 AI 出图

## What I already know

### 用户核心心智（v4 → v5 转变的关键）

| 旧（v1-v4） | 新（v5） |
|---|---|
| 9 张图 = 9 段随机叙事 | 9 张图 = **9 个有分工的镜头角色** |
| 目标 = 套图视觉发散 | 目标 = **商品展示覆盖 + 转化率** |
| 动作 = 越丰富越好 | 动作 = **服务于商品展示，绝不能破坏版型** |

**一句话总结（用户原话）：服装是主角，动作只是让画面不呆**。

### 6 条电商成功图规律（用户提炼，作为规则引擎红线）

1. **视角**：正面 / 三分之二正面 / 轻微侧身为主；几乎不要纯侧面或背面
2. **动作**：低幅度（轻走 / 抬手 / 叉腰 / 提包 / 比耶 / 撩发）；**禁止高强度**（奔跑 / 跳跃 / 旋转 / 大幅蹲坐）
3. **服装展示**：上衣正面 / 领口 / 袖长 / 衣摆 / 裙长 / 裙摆层次都要看清
4. **版型**：衣服自然垂坠，不被动作改变
5. **构图**：人物完整、头脚不裁、商品占比高、背景干净
6. **氛围**：有情绪有场景但**不抢商品信息**

> v4 的"草地奔跑 / 转身裙摆飞起 / 蹲身互动"全部命中禁忌清单，是 v5 必须淘汰的反面教材。

### v4 已落地基础设施（作为 v5 fallback）

* `lib/server/prompt-templates/childrens-dress.ts` 已实现：9 段叙事 + 外景常量 + 椅子规则 + STYLE_ANCHOR
* `lib/server/photo-fission-service.ts` 已实现：`buildShotPrompt` 12 段拼装链路、`shotIndex` 透传、外景白名单注入
* 七牛云图像 API 适配器 `qiniu-image-adapter.ts`（OpenAI 兼容协议、baseURL `https://api.qnaigc.com`）已可用
* 文本 LLM 走独立的 `TEXT_LLM_*` 配置；默认值是自建 OpenAI 兼容中转 `https://elysiver.h-e.top` + `qwen3.6-plus`，必要时可复用 `IMAGE_PROVIDERS` 里的 qiniu provider apiKey 作为历史兼容

### 概念厘清（用户纠正）

> 用户原话："我们这个不是走的 agent 路线，只是给裂变功能加了一个 LLM 推理模型，相当于是给了她一个脑子"

**这不是 Agent**（没有循环 / 工具调用 / 多步规划），而是**「LLM Planner + Workflow」**：
- 单轮 LLM 调用（input → 结构化 JSON output）
- 工程师写死稳定 DAG 流程
- 不上 LangChain / Agno（杀鸡用牛刀）
- 直接朴素 fetch + Zod schema 校验即可；本任务已经落地为 `lib/server/fission-prompt-planner.ts`

## Decisions (resolved at brainstorm｜13 项)

### D1 — task 拓扑（已确认）

✅ v4 commit 锁死 → 关闭 sit-pose-rules 任务 → 新建本 v5 任务专项做架构升级。

### D2 — 任务拆分（已确认）

✅ v5 拆 3 个 Phase 串行：
- **Phase 1**：规则引擎 + Shot Card schema 设计（**本轮 MVP**）
- **Phase 2**：LLM 镜头策划器接入 + Prompt 编译器（**本轮 MVP**）
- **Phase 3**：图片质检器 + 自动重试（**不做，永远不做**）

**Phase 3 不做的理由（用户原话）**：
> "生成后的图，有人工去审核就好，我们只要提升成功率，这样就能提高效率了"

### D3 — 初始品类范围（已被 D19 升级）

最初 v5 只做童装连衣裙一个品类。2026-05-24 用户明确升级目标：童装连衣裙是第一套投产策略，但本任务必须把 LLM Planner 调用层抽成所有 fission 类功能可复用的底座。

### D4 — 质检层（已确认）

✅ 不做图片质检器。靠"规则引擎硬约束 + LLM 选受控变量"已能避免大部分翻车；剩余翻车交人工审核。

### D5 — 文本 LLM 配置（已确认）

✅ 使用 OpenAI 兼容文本 LLM，通过 `TEXT_LLM_BASE_URL` / `TEXT_LLM_API_KEY` / `TEXT_LLM_MODEL` / `TEXT_LLM_TIMEOUT_MS` 配置。默认走自建中转 `https://elysiver.h-e.top` + `qwen3.6-plus`；如 `TEXT_LLM_API_KEY` 留空，可历史兼容复用 `IMAGE_PROVIDERS` 中第一个 qiniu provider 的 apiKey。

### D6 — LLM 框架选型（本小姐推荐）

✅ **不用 agent 框架**（LangChain / Agno 都过度设计）。本任务采用原生 `fetch` + Zod schema 校验，集中封装在 `lib/server/fission-prompt-planner.ts`，避免不同 feature 复制 LLM 调用、JSON 解析和超时逻辑。

### D7 — Phase 拆分实施方式（brainstorm Q1 确认）

✅ **一个大 PRD 一鼓作气**，不拆 P1/P2 子任务。Phase 1+2 在同一个 task 里串行实现，统一 commit。

### D8 — 取消「搭配图」固定角色（brainstorm Q2a 确认）

✅ 不做搭配图。
- **用户原话**："不用做搭配图，用户既然上传了这个图片，他要用服装大片裂变，那么这个图片就默认他已经搭配过了。"
- **影响**：硬约束"画面中只允许出现参考图明确包含的元素"继续生效，禁止凭空生成鞋袜/包包/帽子。

### D9 — 沿用 v4「2 张外景蓝天草地」（brainstorm Q2b 确认）

✅ 9 张图中数量固定 **2 张外景**（蓝天白云草地，沿用 v4 已落地的 `CHILDRENS_DRESS_OUTDOOR_SCENE` 常量），但外景位置不固定，由 Planner 或 fallback 抽卡动态分配。

### D10 — 保留 v4 坐姿（白色金属折叠椅）作为可选商品展示卡（brainstorm Q2c 确认）

✅ 坐姿（白色金属折叠椅）保留为参考 / 棚拍基调卡池中的可选商品展示卡，沿用 v4 的椅子规格 + 单手提裙单手自然规则；它不是每批必出，不再绑定固定 shotId。

### D11 — 去掉「轻走路姿态」给外景让位（brainstorm Q3 确认）

✅ 取消固定模板里的"轻走路姿态"必出角色，改为卡池中的"轻微迈步动态 / 外景蓝天草地轻微迈步"可选卡。若抽中，必须写成重心稳定、脚尖轻点、裙摆只轻微日常摆动的商品展示动作。
- **理由**：大幅走路最容易翻车（裙摆飞起 / 脚步不稳），但克制的轻微迈步仍可作为测流量素材。

### D12 — 变量菜单中粒度（brainstorm Q4 确认）

✅ 每个变量菜单（场景池 / 角度池 / 动作池 / 景别池 / 表情池 / 互动池）列 **8-12 个选项**。
- **粗（3-5）**：约束最强但 9 张图必然重复
- **中（8-12）**：平衡发散与可控（**选定**）
- **细（15+）**：发散最大但本小姐写菜单累且 LLM prompt 变长

### D13 — MVP 走"盲选"，不接视觉分析（brainstorm Q5 确认）

✅ MVP 阶段，LLM 导演**不**先调用视觉模型分析用户上传的参考图，盲选 9 个 Shot Card。
- **理由**：硬约束 IDENTITY + WARDROBE 已强制延续参考图，图像模型自然会看图；MVP 先求跑通；视觉分析可放下一版升级。

## Decisions (Design Refinement｜2026-05-24 增补｜5 项)

### D14 — 模特年龄作为工作室常量固定 6-7 岁

✅ 工作室目前内部使用，模特固定 6-7 岁中国小女孩，**不需要前端表单选项**，年龄段直接作为常量写死在系统提示词里。
- **理由**：工作室内部场景，模特实际就是 6-7 岁；省去前端表单 + user prompt 注入年龄的设计开销；如未来对外开放可在系统提示词里把 "6-7 岁左右" 改成 user prompt 占位符。

### D15 — 每个品类一份独立精细化系统提示词

✅ 不做"通用 Planner + 品类参数注入"模式，而是**每个品类对应一份独立的系统提示词文件**。本任务专注落地童装连衣裙这一份。
- **落地路径**：`lib/server/prompt-templates/childrens-dress-planner-system.ts`
- **未来扩展**：女装大衣对应 `womens-coat-planner-system.ts`、男装西装对应 `mens-suit-planner-system.ts`，各自独立、互不污染。
- **理由**：每个品类的"镜头分布 / 气质锚点 / 红线 / few-shot 范例"差异巨大，强行抽象通用模板会让系统提示词变成万金油，导演效果反而下降。

### D16 — Planner 不看图（D13 强化版）

✅ Planner 完全不接收图像 input，**纯文本 LLM 调用**（OpenAI 兼容 `/v1/chat/completions`，无 `image_url` 字段）。
- **理由**：① 出图模型 NanoBanana / GPT Image 2 自带视觉能力，由它读取参考图识别服装与人物视觉细节，Planner 重复识别是浪费；② 纯文本 LLM 调用更快更便宜；③ 当前 Planner 底座只约束 OpenAI 兼容文本接口，不绑定多模态能力。
- **关键约束**：Planner 必须知道自己不看图，**不能编造任何具体视觉细节**（颜色、印花、扣件、蝴蝶结、蕾丝、珍珠扣、网纱、具体材质名称等），只允许写泛化表达（这套连衣裙 / 裙身轮廓 / 裙摆垂感 / 领口线条 / 胸前结构 / 面料质感 / 裙身细节）。

### D17 — 衣百风格人物+服装双锚点句式

✅ 每段提示词中用**自然语言锚定参考图**，推荐句式：

> 「她仍是参考图里那个小女孩，身着这套连衣裙。」

- **职责**：一句话完成两个锁定 — 锁定参考图人物身份 + 锁定参考图服装。
- **理由**：仅用「她身着这套连衣裙」可能太弱（出图模型可能理解成"某套类似的连衣裙"，不强绑定参考图）。加"她仍是参考图里那个小女孩"强化人物锚点；同时保持衣百风格的自然语言叙事，不写"保持颜色不变 / 保持款式不变"等工程化指令。
- **依据**：衣百 yibaiaigc 3977 条 gemini3pro 案例分析（`research/yibaiaigc-prompt-engineering.md` 第二、三章），显式锁定话术（"保持脸部 / 服装不变"）命中数 0。

### D18 — 5 大投产稳定性补丁（用户审稿后增补）

✅ 本次设计审稿后必须落地的 5 个补丁，已写入系统提示词草稿：

1. **参考图使用规则**（强 Planner 不编造视觉细节）：
   - 白名单：这套连衣裙 / 裙身轮廓 / 裙摆垂感 / 领口线条 / 胸前结构 / 面料质感 / 裙身细节 / 下摆层次
   - 黑名单：粉色碎花 / 泡泡袖 / 蝴蝶结 / 蕾丝边 / 珍珠扣 / 网纱 / 具体颜色 / 具体材质名称
2. **裁切规则**（按抽到的卡片类型拆分，不按固定 shotId）：
   - 全身 / 近全身商品卡：人物完整入镜，不裁头不裁脚，人物占画面高度约 82%-88%
   - 半身 / 局部详情卡：允许局部裁切，但必须服务商品细节展示，不能变成纯人像写真
   - 坐姿卡：只有抽到坐姿时才写椅子或草地坐姿，裙摆、腿部、脚部关系完整清楚
3. **动作红线转正向描述**：系统规则里仍可有红线（禁奔跑/跳跃/旋转），但**最终 prompt 不输出 negative 列表**，统一转成正向视觉语言（"身体重心稳定 / 裙摆顺着站姿自然垂落 / 动作轻柔克制"）。
4. **坐姿卡椅子描述衣百化导演口吻**：保留椅子完整规格（白色金属折叠椅、X 形椅腿、椅腿完整露出），但措辞改成导演叙事而非硬约束（"在柔光下带着干净的哑光质感"等）。坐姿卡不再绑定固定 shotId。
5. **结构化输出格式锁定**：LLM 输出 JSON `{ shotId, role, imagePrompt }`，后端仅把 `imagePrompt` 字段的纯自然语言传给出图模型；前两个字段供后端调度 / 日志 / 重跑使用。

### D19 — 通用 Fission Prompt Planner 底座（2026-05-24 用户增补）

✅ 把文本 LLM 调用层从 `photo-fission-shot-planner.ts` 抽成通用 `lib/server/fission-prompt-planner.ts`。

职责边界：
- 通用底座只负责：文本 LLM 调用、超时、鉴权、HTTP 错误、OpenAI 响应解析、JSON 容错解析、Zod schema 校验、统一错误阶段。
- 具体 feature 负责：systemPrompt、userPrompt、输出 schema、fallback 链路和结果如何写回当前 pipeline。
- photo-fission 继续保留 `photo-fission-shot-planner.ts` 作为兼容包装，只声明当前 9 张 shot card schema。
- pose-fission 本轮不强行接入 Planner，因为还没有姿势裂变专属策略词；后续接入时直接复用 `invokeFissionPromptPlanner`。

验收重点：以后新增成人上衣、裤装、姿势裂变 Planner 时，禁止复制一套 fetch + JSON parse + timeout + schema 校验代码。

### D20 — 童装连衣裙九张图改为受控抽卡裂变（2026-05-24 用户增补）

✅ 童装连衣裙不再是固定 9 个角色顺序，而是每批动态组合：
- 7 张参考 / 棚拍基调上架素材
- 2 张蓝天白云草地外景补充素材

两张外景位置不固定到 shot_8 / shot_9；坐姿、背后三分之二、局部细节都是卡池中的可选变化，不是每批必出。所有卡都必须保持电商货架感：商品主体优先、背景低存在感、人物占比充足、服装版型展示清楚、方便美工裁切排版上架。

## 童装连衣裙当前策略（2026-05-24 最新）

童装连衣裙是第一套投产策略，但不代表底座只服务童装连衣裙。

当前策略：
- `shot_1` ~ `shot_9` 是稳定编号，只用于调度、日志、重跑和结果追踪。
- role / scene / imagePrompt 由 Planner 或 fallback 抽卡蓝图动态写回。
- 每批 9 张必须包含 7 张参考 / 棚拍基调素材 + 2 张蓝天白云草地外景素材。
- 外景素材位置随机，不固定到最后两张。
- 九张图的动作、手势、景别、卖点必须显著不同，服务卖货和测流量。
- 生成结果必须像淘宝 / 天猫可直接上架的童装连衣裙商品图素材，而不是生活方式写真。

## Architecture（最终）

```
用户上传商品图（必选 1 张主图 + 可选正/背面细节图）
   ↓
[normalize 参数]
   ↓
[Strategy Layer] 策略层
   - photo-fission 当前路径: lib/server/photo-fission-rule-engine.ts + prompt-templates/*
   - 输入: feature/category/subcategory
   - 输出: systemPrompt + userPrompt + 输出 schema 所需的稳定 id
   ↓
[Generic LLM Prompt Planner] 通用文本 LLM Planner（lib/server/fission-prompt-planner.ts）
   - 输入: systemPrompt + userPrompt + outputSchema
   - LLM 调用: OpenAI 兼容文本 LLM（单轮）
   - 输出: feature 自己 schema 约束后的 Planner Cards
   - 失败: 抛 FissionPromptPlannerError，由 feature 自己 fallback
   ↓
[Feature Wrapper] Feature 包装层
   - photo-fission: lib/server/photo-fission-shot-planner.ts 声明 9-card schema
   - pose-fission: 后续新增 pose 专属 wrapper 或直接调用通用底座
   ↓
[Prompt Write-back / Compiler] 写回或编译
   - photo-fission: Planner 成功时直接用 imagePrompt 覆盖 shot.prompt；失败时走 fallback prompt
   - pose-fission: 后续可在 buildPoseFissionPrompt 前后接入 Planner 结果
   ↓
[Worker Pool] 9 张图并行生成（沿用现有 worker pool / failover / streaming，不动）
   ↓
输出 9 张电商大片（人工审核挑选）
```

### 三层职责分工

| 层 | 职责 | 谁说了算 |
|---|---|---|
| **策略层** | 定义当前 feature / 品类的系统提示词、变量池、红线和输出格式 | **代码硬编码**（工程师 + 产品） |
| **通用 LLM Planner** | 调文本 LLM、解析 JSON、按 schema 校验、输出结构化结果或抛统一错误 | **共享底座** |
| **Feature 包装层** | 声明输出 schema、决定成功如何写回、失败如何 fallback | **各 feature 服务层** |

### Planner Card schema 当前约定

```typescript
interface FissionPromptCard {
  shotId: string       // 稳定 item id；photo-fission 是 shot_1~shot_9，pose-fission 可用 templateId
  role: string         // UI / 结果 label 可展示的中文角色
  imagePrompt: string  // 直接给出图模型的自然语言 prompt
}
```

### 全局禁忌黑名单（硬约束，编译器层强制注入到 negative）

- 服装颜色不能改 / 款式不能改 / logo 不能变形 / 裙长不能乱变 / 面料结构不能乱变
- 不能奔跑 / 不能跳跃 / 不能大幅旋转
- 不能遮挡上衣正面 / 不能裙摆飞起到看不清长度
- 不能只拍背影或纯侧面
- 人物不能裁脚 / 裁头
- 不能改成卡通 / 插画 / 3D 渲染
- 不能凭空生成参考图未提供的鞋袜/包包/帽子/配饰（D8）

## Requirements

### 代码新增
* `lib/server/fission-prompt-planner.ts`：通用文本 LLM Planner 底座（OpenAI 兼容调用 + timeout + JSON 容错解析 + Zod schema 校验 + 统一错误阶段）
* `lib/server/prompt-templates/childrens-dress-planner-system.ts`：童装连衣裙 Planner 专属系统提示词（D15）—— 包含角色定义 / 参考图使用规则 / 受控抽卡规则 / 裁切规则 / 动作正向规则 / 变量池 / 可选椅子与外景卡描述 / few-shot 范例 / JSON 输出格式
* `lib/server/photo-fission-rule-engine.ts`：规则引擎（按品类返回系统提示词 + 9 个稳定 slot metadata；真实 role / scene 由 Planner 或 fallback 抽卡写回）
* `lib/server/photo-fission-shot-planner.ts`：photo-fission 包装层（声明 9-card schema，调用通用 `invokeFissionPromptPlanner`）
* `lib/types.ts` 新增/调整类型：`FissionPromptCard { shotId, role, imagePrompt }` / `FissionPromptPlannerOutput { shots: FissionPromptCard[] }`，photo-fission 类型作为兼容 alias
* 新增/保留环境变量：`TEXT_LLM_BASE_URL` / `TEXT_LLM_API_KEY` / `TEXT_LLM_MODEL` / `TEXT_LLM_TIMEOUT_MS`

### 代码修改
* `lib/server/photo-fission-service.ts`：
  - `buildPhotoFissionShotPlan` 保持现有 fallback prompt 预构建
  - pipeline 开始前调用 Planner；成功时按 `shotId` 写回 `label` 和 `prompt`
  - LLM 调用失败时降级到规则引擎默认 Shot Card（保证服务可用）
  - 沿用现有 worker pool / shotPlan / streaming 编排不变

### 童装连衣裙规则引擎具体内容
* 受控抽卡：每批 7 张参考 / 棚拍基调素材 + 2 张蓝天白云草地外景素材
* 外景位置不固定；role / scene / prompt 由 Planner 或 fallback 蓝图动态写回
* 每个变量菜单保持中粒度，保证多元化但不失控
* 全局禁忌黑名单完整列表（来自 6 条电商成功规律 + D8 道具禁忌）

### 不做（已确认）
* ❌ 图片质检器（D4）
* ❌ 视觉分析预处理（D13）
* ❌ 前端产品控制项（推荐下一版评估）
* ❌ 本轮不新增成人上衣 / 裤装 / pose-fission 专属策略；只打通底座和童装连衣裙第一套策略
* ❌ 案例缓存 / 重 roll 按钮
* ❌ LangChain / Agno / Python 微服务（D6）
* ❌ 「搭配图」/ 固定必出的「轻走路姿态」角色（D8 / D11）

## Acceptance Criteria

* [x] `FissionPromptCard` / `FissionPromptPlannerOutput` 等通用类型在 `lib/types.ts` 完整定义，photo-fission 保持兼容 alias
* [x] `fission-prompt-planner.ts` 是唯一的文本 LLM 调用 + JSON 解析 + schema 校验底座
* [x] `photo-fission-shot-planner.ts` 只做 photo-fission schema 包装，不复制 fetch / parse / timeout 逻辑
* [x] `photo-fission-rule-engine.ts` 为「童装连衣裙」品类返回 Planner system/user prompt 与稳定 slot metadata
* [x] 童装连衣裙系统提示词包含货架感、受控抽卡、7+2 外景、多动作差异规则
* [x] Zod schema 校验 LLM 输出，违约束自动回退到默认 Shot Card
* [x] LLM 调用失败时降级到规则引擎默认 Shot Card，服务不挂
* [x] 同一参考图跑 9 张图，**任意两张动作显著不同**（不再是只换镜头不换动作）
* [x] 9 张图均符合 6 条电商成功规律（无奔跑/跳跃/背对/裁脚/logo 变形等）
* [x] 9 张图中包含 2 张蓝天白云草地外景，但位置不固定
* [x] `npx --no-install tsc --noEmit` 通过
* [x] `npm run build` 通过（沙箱内 Turbopack 因创建进程/绑定端口受限失败，提升权限后通过）
* [x] `npm run lint` 已执行；当前项目 `package.json` 有 `lint: eslint .`，但 devDependencies 未安装 `eslint`，命令报 `sh: eslint: command not found`

## Definition of Done

* TypeScript 编译通过 + Next.js build 尽力验证
* 通用 Planner 底座有 backend spec 契约，后续 feature 接入有明确路径
* 童装连衣裙仍能走当前 photo-fission pipeline，并保留 fallback
* 客户后续实测验收

## Out of Scope（明确不做）

* 图片质检器 / 自动重试（D4 已敲定，永远不做）
* 视觉分析预处理（D13，下一版评估）
* 前端产品控制项（下一版评估）
* 成人上衣 / 裤装 / pose-fission 专属策略词落地（下一版任务）
* 案例库 / Shot Card 缓存 / 用户手动 reroll 按钮
* LangChain / Agno 等 agent 框架（D6）
* Python 微服务（D6）

## Technical Notes

* **文本 LLM 配置**：当前默认走自建 OpenAI 兼容中转 `https://elysiver.h-e.top` + `qwen3.6-plus`；环境变量统一为 `TEXT_LLM_BASE_URL` / `TEXT_LLM_API_KEY` / `TEXT_LLM_MODEL` / `TEXT_LLM_TIMEOUT_MS`。
* `lib/server/fission-prompt-planner.ts` 是通用底座；新 feature 不允许复制一套文本 LLM 调用代码。
* v4 / fallback 的 `lib/server/prompt-templates/childrens-dress.ts` 仍保留，LLM 失败时服务不挂。
* PRD v5 严格遵守"LLM 受规则策略约束，不自由发挥"——避免重蹈 v4 让模型自由发挥导致跑偏的覆辙。

## Research References

* [上游 v4 任务 PRD](../05-23-childrens-dress-sit-pose-rules/prd.md) — 9 段手写叙事 + 外景常量 + 椅子规则的基础设施
* [衣百 yibaiaigc Prompt 工程经验手册](../05-18-pose-fission/research/yibaiaigc-prompt-engineering.md) — 3977 条 gemini3pro 案例的场景叙事公式（v5 仍参考其"指代锚点 / 标准句式"经验）
* [外景蓝天草地场景预设](../05-23-childrens-dress-sit-pose-rules/research/outdoor-grassland-scene-preset.md) — 用户提供的草地 JSON 预设（v5 作为 Scene 变量池中"外景蓝天草地"常量）
