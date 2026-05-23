/**
 * v5 服装大片裂变规则引擎。
 *
 * 职责：
 * 1. 按品类（category + childrensCategory）分发对应的 Planner 系统提示词
 * 2. 提供 9 个 ShotRole 的稳定 metadata（shotId / role 中文 / type / scene）
 * 3. 提供 Planner user prompt 模板
 *
 * 非职责：
 * - LLM 调用（交给 `photo-fission-shot-planner.ts`）
 * - 失败回退到 v4 链路（交给 `photo-fission-service.ts`）
 * - 出图（交给 worker pool / image-provider-pool）
 *
 * v5 决议依据：
 * - D15 每个品类一份独立精细化系统提示词，规则引擎只做路由分发
 * - D16 Planner 不看图，无需视觉前置处理
 * - 当前只支持 childrens-dress，其它品类返回 undefined，由 caller 回退到 v4
 */

import type {
  PhotoFissionCategory,
  PhotoFissionChildrensCategory,
} from '@/lib/types'
import {
  CHILDRENS_DRESS_PLANNER_USER_PROMPT,
  CHILDRENS_DRESS_SHOT_ROLES,
  getChildrensCategoryPlannerSystemPrompt,
  getChildrensCategoryShotRoles,
} from '@/lib/server/prompt-templates/childrens-dress-planner-system'

export interface ShotRoleMeta {
  shotId: string
  role: string
  type: 'full' | 'partial'
  scene: 'indoor' | 'outdoor'
}

export interface PlannerRulePlan {
  systemPrompt: string
  userPrompt: string
  shotRoles: ReadonlyArray<ShotRoleMeta>
}

/**
 * 根据品类构建 Planner 调用所需的完整规则计划。
 *
 * @returns 命中 v5 路径时返回 systemPrompt + userPrompt + shotRoles；
 *          未实现的品类返回 undefined，caller 应回退到 v4 链路。
 */
export function buildPlannerRulePlan(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): PlannerRulePlan | undefined {
  if (category === 'childrens' && childrensCategory) {
    const systemPrompt = getChildrensCategoryPlannerSystemPrompt(childrensCategory)
    const shotRoles = getChildrensCategoryShotRoles(childrensCategory)
    if (!systemPrompt || !shotRoles) {
      return undefined
    }
    return {
      systemPrompt,
      userPrompt: CHILDRENS_DRESS_PLANNER_USER_PROMPT,
      shotRoles,
    }
  }
  return undefined
}

/**
 * 暴露童装连衣裙的 ShotRole metadata，便于 service 层在 LLM 失败回退时
 * 拿到 shotId / role / order 来构建 PhotoFissionShot[]。
 */
export { CHILDRENS_DRESS_SHOT_ROLES }
