# 服装大片裂变 Prompt 工程升级 photo-fission-prompt-upgrade

> 任务路径：`.trellis/tasks/05-19-photo-fission-prompt-upgrade/`
> 创建日期：2026-05-19
> 负责人：@yinxm
> 优先级：P1
> 状态：pending（待你 review 通过后转 in_progress）

---

## 1. Goal（目标）

photo-fission 现有 7 个 lock section（Identity / Wardrobe / Scene / Lighting / Style / Anatomy / Negative）骨架完整，但措辞带有大量"禁止/不要"的硬命令式语言，且使用了显式的"保持脸部/保持身份"——经友商 yibaiaigc 5525 条 gemini3pro 真实案例验证，**这类硬命令对 Gemini 3 Pro Image 反而效果差**。

本任务用研究手册（`research/yibaiaigc-prompt-engineering.md`）萃取出的友商验证过的话术，**外科手术式重写 `lib/server/photo-fission-service.ts` 内的 7 个 lock 函数**，达到：

1. **狠狠锁住人物一致性**——脸、发、骨架不变
2. **狠狠锁住服装一致性**——颜色 / 版型 / 材质 / 图案 / logo 不变
3. **狠狠锁住场景一致性**——主图房间 / 道具 / 光线统一
4. **符合电商主图调性**——构图三件套 / 电影感 / 杂志风
5. **狠狠锁住套图整体调性**——9 张 shot 整体看起来像同一场拍摄

不改 pipeline、不改 UI、不改 API、不改 SHOT_LABELS。**只改 prompt 字符串内容。**

## 2. Scope（变更范围）

### 必改

- `lib/server/photo-fission-service.ts`
  - `buildTaskSection` (~line 244)
  - `buildReferenceImagesSection` (~line 252)
  - `buildIdentityLockSection` (~line 271)
  - `buildWardrobeLockSection` (~line 280)
  - `buildSceneLockSection` (~line 288)
  - `buildLightingLockSection` (~line 296)
  - `buildStyleLockSection` (~line 305)
  - `buildShotSection` (~line 315)
  - `buildCategoryLockSection` (~line 319)
  - `buildAnatomySection` (~line 326)
  - `buildOutputParamsSection` (~line 335)
  - `buildNegativeSection` (~line 348)

### 不改

- ❌ `normalizePhotoFissionParams`、`buildPhotoFissionShotPlan` 等参数处理逻辑
- ❌ `runPhotoFissionPipeline` 流式调度逻辑
- ❌ `lib/types.ts` 内的 `PhotoFissionShot` / `PhotoFissionCategory` 等类型
- ❌ `app/api/photo-fission/**` 任何路由
- ❌ `components/workbench/**` 任何 UI
- ❌ 9 个 SHOT_LABELS 和 shotDescription（这是 shotPlan 输入，不是 lock）

## 3. Decisions（关键决策）

### D1（2026-05-19）：从"硬命令"转向"参考图锚定"

- **Decision**：删除大量"禁止 / 不要 / 绝对不要"措辞，改为"参考图1的同一人 / 这套服装" 的隐式锚定
- **Reason**：研究手册第二节 — 友商 3977 条 gemini3pro 案例里"保持脸部"类显式锁定话术**命中 0 次**，他们用"这套服装/这个服装"(2178 次) 做隐式占位
- **Consequence**：Identity Lock / Wardrobe Lock 显著瘦身

### D2（2026-05-19）：每个 shot 增加"构图三件套"

- **Decision**：在 `buildTaskSection` 或 `buildShotSection` 起始位置注入「{竖幅/横幅/方图}构图 + 三分法/中央 + 平视/仰视全身视角」
- **Reason**：研究手册第四节 — 90% 友商案例开头 50 字内必带构图三件套
- **Consequence**：需读 `imageRatio` 转中文构图词（3:4/2:3/9:16 → 竖幅；4:3/3:2/16:9 → 横幅；1:1 → 方图）

### D3（2026-05-19）：电影前缀按"场景类型"按需注入，而非无差别加

- **Decision**：电影前缀（Arricam LT / IMAX 等）只在户外 / 海边 / 古典建筑类场景注入；棚拍 / 室内不加
- **Reason**：研究手册第五节 — 电影前缀只在 1.5%-2.3% 案例出现，且有明确场景偏好
- **Consequence**：`buildStyleLockSection` 或 `buildLightingLockSection` 需要根据 shotDescription / category 做条件分支

### D4（2026-05-19）：Negative section 从"独立黑名单"转向"嵌入式控制"

- **Decision**：保留 `buildNegativeSection` 但精简，把核心反向控制（不换脸、不换服装、不换场景）嵌入到 Task Section 的正向表述里
- **Reason**：研究手册第七节 — 友商没有 negative_prompt 字段，反向控制嵌在正向 prompt 中
- **Consequence**：Negative section 缩短 50% 以上，但 Anatomy 防畸形话术保留

### D5（2026-05-19）：保留中文为主，关键技术词保留英文

- **Decision**：摄影/构图/anatomy 类术语（face identity、anatomy、negative space、composition）保留英文，避免翻译损失；其他叙述用中文
- **Reason**：友商 prompt 也是中英混排，gemini3pro 对英文摄影术语响应稳定
- **Consequence**：可读性中等但模型理解准

### D6（2026-05-19）：不写 try/catch 测试，按 prompt-only 单次提交

- **Decision**：本次任务**只改 prompt 字符串**，无逻辑变更，无单测改动需求
- **Reason**：现有 buildShotPrompt 单测（如有）仍应通过；新 prompt 由人工审核 + 后续生产案例验证
- **Consequence**：implement 阶段无需新增 unit test，只需 lint / type-check 通过

## 4. Acceptance Criteria（验收标准）

### 必达

- [ ] `lib/server/photo-fission-service.ts` 内 7 个 lock section 函数已重写
- [ ] `npm run lint` 通过
- [ ] `npm run type-check` / `tsc --noEmit` 通过
- [ ] 现有 photo-fission 测试（如有）通过
- [ ] 重写后的每段 prompt 都能在 `research/yibaiaigc-prompt-engineering.md` 中找到出处
- [ ] `buildShotPrompt` 输出整体字符数控制在 ~800-1200 字（参考友商案例长度）
- [ ] 9 个 shot label / shotDescription / category 仍能正确组合

### 期望（不阻塞 merge）

- [ ] 在 `.trellis/spec/backend/prompt-engineering.md`（如已存在）追加"友商验证过的话术规范"摘要
- [ ] 写一份 before/after 的 sample prompt 对照样本到 `research/sample-prompt-before-after.md`

## 5. Out of Scope（明确不做）

- ❌ 不改 `POSE_TEMPLATES` 或姿势裂变任何文件（另一窗口在做）
- ❌ 不重构 photo-fission pipeline 或并发调度
- ❌ 不动 UI 任何文案 / 表单 / 案例库
- ❌ 不新增模型、不删模型、不改 model id
- ❌ 不接入 negative_prompt API 字段（gemini3pro 无此字段）
- ❌ 不做 A/B 测试基础设施（人工验收即可）

## 6. Implementation Notes（实施建议）

### 推荐顺序

1. 先重写 `buildTaskSection` + `buildReferenceImagesSection`——任务开场白和图片角色说明
2. 再重写 `buildIdentityLockSection` + `buildWardrobeLockSection`——核心锁定
3. 再重写 `buildSceneLockSection` + `buildLightingLockSection` + `buildStyleLockSection`——场景三联
4. 再重写 `buildShotSection` + `buildAnatomySection`——shot 描述 + 解剖
5. 最后重写 `buildOutputParamsSection` + `buildNegativeSection`——参数 + 反向

### 参考研究手册章节对应

| 函数 | 研究手册章节 | 重点参考 |
|------|------------|---------|
| buildTaskSection | 第四节（构图三件套）+ 第二节（隐式锚定） | "这套服装 / 参考图1的同一人" |
| buildIdentityLockSection | 第二节 | 砍掉硬命令，改隐式锚定 |
| buildWardrobeLockSection | 第三节 | "颜色/版型/材质/图案/logo" 标准短语 |
| buildSceneLockSection | 第六节 | 场景骨架模板（5 个典型场景） |
| buildLightingLockSection | 第五节 | 电影前缀按场景按需注入（D3）|
| buildStyleLockSection | 第五节 | 杂志风/8K商业画质 嵌入位置 |
| buildAnatomySection | 第七节 | 防畸形话术嵌入式 |
| buildNegativeSection | 第七节 | 精简 50% |
| buildShotSection | 第四节 + 第六节 | 构图描述位置 |

### 落地模板雏形

研究手册第九节给了 **方案 A / B / C 三套** 可直接复制的 prompt 模板，implement 阶段以 **方案 A（极简对齐）** 为主，必要时混入 B（场景化）的元素。

## 7. References（参考）

- 研究手册：`research/yibaiaigc-prompt-engineering.md`（613 行）
- 原始友商数据：`.trellis/tasks/05-18-pose-fission/research/yibaiaigc/.latest-repo/`（5525 条案例 + API 逆向）
- 原 photo-fission v2 PRD（已 archive）：`.trellis/tasks/archive/2026-05/05-17-photo-fission/prd.md`
- 当前实现：`lib/server/photo-fission-service.ts:214-359`
