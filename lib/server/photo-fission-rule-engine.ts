/**
 * v5 服装大片裂变规则引擎。
 *
 * 职责：
 * 1. 按品类（category + childrensCategory）分发对应的 Planner 系统提示词
 * 2. 提供 N 个稳定 slot metadata（shotId / role 占位 / type / scene）
 * 3. 提供 Planner user prompt 模板
 *
 * 非职责：
 * - 通用文本 LLM 调用（交给 `fission-prompt-planner.ts`）
 * - photo-fission 输出 schema 包装（交给 `photo-fission-shot-planner.ts`）
 * - 失败处理（交给 `photo-fission-service.ts`）
 * - 出图（交给 worker pool / image-provider-pool）
 *
 * v5 决议依据：
 * - D15 每个品类一份独立精细化系统提示词，规则引擎只做路由分发
 * - D16 Planner 不看图，无需视觉前置处理
 * - 当前只保留 childrens-dress 策略；通用 Planner 底座仍可被 pose-fission
 *   或其它 fission 功能复用
 * - 未实现策略返回 undefined，由 caller 作为配置错误处理
 */

import type {
  PhotoFissionCategory,
  PhotoFissionChildrensCategory,
  PhotoFissionResultCount,
} from '@/lib/types'
import {
  buildChildrensDressPlannerSlots,
  buildChildrensDressPlannerUserPrompt,
  getChildrensCategoryPlannerSystemPrompt,
  getChildrensCategoryPlannerSlots,
} from '@/lib/server/prompt-templates/childrens-dress-planner-system'
import {
  buildSuitPlannerSlots,
  buildSuitPlannerSystemPrompt,
  buildSuitPlannerUserPrompt,
} from '@/lib/server/prompt-templates/suit-planner-system'

export interface PlannerSlotMeta {
  shotId: string
  role: string
  type: 'full' | 'partial' | 'dynamic'
  scene: 'indoor' | 'outdoor' | 'dynamic'
}

export interface PlannerRulePlan {
  systemPrompt: string
  userPrompt: string
  slots: ReadonlyArray<PlannerSlotMeta>
}

/**
 * 根据品类构建 Planner 调用所需的完整规则计划。
 *
 * @returns 命中 v5 路径时返回 systemPrompt + userPrompt + slots；
 *          未实现的品类返回 undefined，caller 应回退到稳定 fallback。
 */
export function buildPlannerRulePlan(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
  resultCount: PhotoFissionResultCount = 9,
  recentActionHints: readonly string[] = [],
  hasFaceIdModel?: boolean,
  faceIdImageIndex?: number,
): PlannerRulePlan | undefined {
  if (category === 'childrens' && childrensCategory) {
    if (childrensCategory === 'suit') {
      let systemPrompt = buildSuitPlannerSystemPrompt(resultCount, recentActionHints)
      if (hasFaceIdModel && faceIdImageIndex) {
        systemPrompt += buildFaceIdOverrideSection(faceIdImageIndex)
      }
      return {
        systemPrompt,
        userPrompt: buildSuitPlannerUserPrompt(resultCount, recentActionHints),
        slots: buildSuitPlannerSlots(resultCount),
      }
    }
    let systemPrompt = getChildrensCategoryPlannerSystemPrompt(childrensCategory, resultCount)
    if (!systemPrompt) {
      return undefined
    }
    const slots = getChildrensCategoryPlannerSlots(childrensCategory, resultCount)
    if (!slots) {
      return undefined
    }
    if (hasFaceIdModel && faceIdImageIndex) {
      systemPrompt += buildFaceIdOverrideSection(faceIdImageIndex)
    }
    return {
      systemPrompt,
      userPrompt: buildChildrensDressPlannerUserPrompt(resultCount, recentActionHints),
      slots,
    }
  }
  return undefined
}

/**
 * 五官锁定模式覆盖段：追加在 Planner 系统提示词末尾。
 *
 * 覆盖上方所有关于"脸部延续参考图"的指令——当用户选了人像小卡时，
 * 脸型+五官的唯一来源是人像小卡图，不是主图。
 */
function buildFaceIdOverrideSection(faceIdImageIndex: number): string {
  return `

# 五官脸型锁定模式（最高优先级，覆盖上方所有脸部相关指令）

用户本次上传了人像小卡（最后一张图，即图${faceIdImageIndex}），用于锁定人物的脸型和五官。

**此模式下的核心规则变更（覆盖前面的所有脸部指令）：**

1. 每段 imagePrompt 中，不要写"脸型五官延续参考图"或"人物脸部严格延续参考图"。
   改为写："面部全部特征（脸型+五官）以最后一张人像小卡（图${faceIdImageIndex}）为唯一基准。"

2. "参考图"三个字在脸部/五官/脸型语境下，特指图${faceIdImageIndex}人像小卡，不再指向图1主图。
   但图${faceIdImageIndex}只提供脸部核心特征，不提供帽子、发型、发饰、服装或穿搭。
   图1主图提供穿搭比例、帽子、发型、发饰、发色、头发长度、手持包、服装细节、场景与光线。

3. 不要在 imagePrompt 里写"不改变脸部特征"或"脸部保持一致"等含糊指令——
   必须明确写出"脸型形状、下颌线、颧骨、眼形、鼻型、嘴形、眉形、耳朵形状、面部三庭五眼比例全部以图${faceIdImageIndex}人像小卡为准"。

4. 推荐在每段 imagePrompt 中使用以下锚定句式：
   "TA面部全部特征（脸型+五官）严格以图${faceIdImageIndex}人像小卡为唯一权威参考，表情可自然变化但脸型骨骼结构和五官细节不改变。"

5. 外景镜头也不例外：场景换成蓝天草地时，脸型+五官仍然以图${faceIdImageIndex}人像小卡为准，不能因为换背景就改变脸。

6. 注意：图1主图的脸部核心区已被预处理覆盖，但帽子、发型、发饰、发色、头发长度、手持包和服装穿搭仍然必须从图1读取并保留。
`
}

/**
 * 暴露童装连衣裙的 slot metadata 构建函数。童装连衣裙的 role / scene 是动态抽卡
 * 结果，service 层会以 Planner 输出或 fallback 蓝图写回真实 label。
 */
export { buildChildrensDressPlannerSlots }
