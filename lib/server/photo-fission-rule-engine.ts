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
): PlannerRulePlan | undefined {
  if (category === 'childrens' && childrensCategory) {
    if (childrensCategory === 'suit') {
      return {
        systemPrompt: buildSuitPlannerSystemPrompt(resultCount, recentActionHints),
        userPrompt: buildSuitPlannerUserPrompt(resultCount, recentActionHints),
        slots: buildSuitPlannerSlots(resultCount),
      }
    }
    const systemPrompt = getChildrensCategoryPlannerSystemPrompt(childrensCategory, resultCount)
    const slots = getChildrensCategoryPlannerSlots(childrensCategory, resultCount)
    if (!systemPrompt || !slots) {
      return undefined
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
 * 暴露童装连衣裙的 slot metadata 构建函数。童装连衣裙的 role / scene 是动态抽卡
 * 结果，service 层会以 Planner 输出或 fallback 蓝图写回真实 label。
 */
export { buildChildrensDressPlannerSlots }
