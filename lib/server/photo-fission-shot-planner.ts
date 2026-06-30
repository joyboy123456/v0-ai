/**
 * photo-fission 专属 LLM Shot Planner 包装层。
 *
 * 通用文本 LLM 调用、JSON 解析和错误分类在 `fission-prompt-planner.ts`；
 * 本文件只声明 photo-fission 的 shot card 输出契约，避免未来
 * pose-fission / 其它裂变功能复制 fetch + schema 校验逻辑。
 *
 * 支持 resultCount ∈ {2, 4, 9, 10}，schema 按 shotCount 动态校验。
 */

import { z } from 'zod'

import type {
  PhotoFissionResultCount,
  PhotoFissionShotCard,
  PhotoFissionShotPlannerOutput,
  PantsMainHandVisibility,
  StructuredImagePrompt,
} from '@/lib/types'
import {
  FissionPromptPlannerError,
  invokeFissionPromptPlanner,
  type FissionPromptPlannerErrorStage,
} from './fission-prompt-planner'

const VALID_SHOT_COUNTS = new Set<number>([2, 4, 9, 10])
const PANTS_VIEW_SEQUENCE_BY_COUNT: Record<number, readonly string[]> = {
  2: ['front', 'side'],
  4: ['front', 'left', 'right', 'back'],
  9: ['back', 'front', 'front', 'front', 'left', 'left', 'left', 'right', 'right'],
  10: ['back', 'front', 'front', 'front', 'left', 'left', 'left', 'right', 'right', 'right'],
}
const PANTS_ANGLE_SEQUENCE_BY_COUNT: Record<number, readonly string[]> = {
  2: ['front +/-15deg', 'side 45-75deg'],
  4: ['front +/-15deg', 'left 45-75deg', 'right 45-75deg', 'back +/-15deg'],
  9: [
    'back +/-15deg',
    'front 0deg',
    'front left <=15deg',
    'front right <=15deg',
    'left 30deg',
    'left 60deg',
    'left 90deg',
    'right 45-75deg',
    'right 75-95deg',
  ],
  10: [
    'back +/-15deg',
    'front 0deg',
    'front left <=15deg',
    'front right <=15deg',
    'left 30deg',
    'left 60deg',
    'left 90deg',
    'right 15-45deg',
    'right 45-75deg',
    'right 75-95deg',
  ],
}
const PANTS_HAND_TOKEN_PATTERN =
  /\b(?:hand|hands|arm|arms|palm|palms|finger|fingers|wrist|wrists|elbow|elbows|forearm|forearms)\b|手部|手臂|手掌|手指|手腕|手肘|前臂|双手|单手|一手|另一手|两只手/i
const PANTS_FULL_BODY_TOKEN_PATTERN =
  /\b(?:full[-\s]?body|upper body|head|face|portrait)\b|全身|完整身体|完整人像|上半身|头部|脸部|五官|头像/i
const PANTS_DANGEROUS_VISIBLE_HAND_PATTERN =
  /both\s+(?:hands|arms)\s+(?:down|hanging|straight|relaxed|natural)|hands?\s+(?:naturally\s+)?(?:at|by)\s+(?:the\s+)?sides?|arms?\s+(?:naturally\s+)?(?:at|by)\s+(?:the\s+)?sides?|hands?\s+behind|arms?\s+behind|hidden\s+hands?|hands?\s+hidden|low[-\s]?level\s+hands?|hands?\s+below\s+waistband|hands?\s+on\s+thigh|palms?\s+against\s+(?:pants|thigh|seam)|fingers?\s+along\s+(?:side\s+)?seam|双手(?:自然)?(?:下垂|垂落|摆放|放在身体两侧|藏|隐藏|背在身后|放在身后)|双臂(?:自然)?(?:下垂|垂落|藏|隐藏|置于身后)|手(?:掌|臂).*裤缝|裤缝.*手(?:掌|臂)|手掌.*大腿外侧|大腿外侧.*手掌|低位手|身后.*手|隐藏.*手/i

const StructuredImagePromptSchema = z.object({
  scene: z.string().min(1),
  subject: z.string().min(1),
  pose: z.string().min(1),
  expression: z.string().min(1),
  clothing: z.string().min(1),
  background: z.string().min(1),
  framing: z.string().min(1),
  quality: z.string().min(1),
}) satisfies z.ZodType<StructuredImagePrompt>

type ShotPlannerImagePromptMode = 'any' | 'structured'
  | 'pants-final-prompt'
  | 'pants-action-plan'

interface PantsFinalPromptContract {
  handMode?: PantsMainHandVisibility
}

function buildShotCardSchema(imagePromptMode: ShotPlannerImagePromptMode) {
  if (imagePromptMode === 'pants-final-prompt') {
    return PantsFinalPromptCardSchema
  }
  if (imagePromptMode === 'pants-action-plan') {
    return PantsActionPlanCardSchema
  }
  return z.object({
    shotId: z.string().min(1),
    role: z.string().min(1),
    imagePrompt:
      imagePromptMode === 'structured'
        ? StructuredImagePromptSchema
        : z.union([z.string().min(20), StructuredImagePromptSchema]),
    poseCardId: z.string().optional(),
  }) satisfies z.ZodType<PhotoFissionShotCard>
}

const PantsFinalPromptCardSchema: z.ZodType<
  PhotoFissionShotCard,
  z.ZodTypeDef,
  unknown
> = z.object({
  shotId: z.string().min(1),
  role: z.string().min(1),
  view: z.enum(['front', 'side', 'left', 'right', 'back']),
  angle: z.string().min(1),
  poseCardId: z.string().min(1),
  finalPrompt: z.string().min(80),
  selfCheck: z.string().min(10),
}).transform((card) => ({
  ...card,
  imagePrompt: card.finalPrompt,
}))

const PantsActionPlanCardSchema: z.ZodType<
  PhotoFissionShotCard,
  z.ZodTypeDef,
  unknown
> = z.object({
  shotId: z.string().min(1),
  role: z.string().min(1),
  view: z.enum(['front', 'side', 'left', 'right', 'back']),
  angle: z.string().min(1),
  poseCardId: z.string().min(1),
  actionFamily: z.string().min(2),
  silhouetteKey: z.string().min(2),
  selfCheck: z.string().min(10),
}).transform((card) => ({
  ...card,
  imagePrompt: [
    `poseCardId=${card.poseCardId}`,
    `actionFamily=${card.actionFamily}`,
    `silhouetteKey=${card.silhouetteKey}`,
  ].join('; '),
}))

function buildShotPlannerOutputSchema(
  shotCount: number,
  imagePromptMode: ShotPlannerImagePromptMode,
  pantsContract?: PantsFinalPromptContract,
): z.ZodType<PhotoFissionShotPlannerOutput> {
  if (imagePromptMode === 'pants-final-prompt') {
    return z.object({
      shots: z.array(PantsFinalPromptCardSchema).length(shotCount),
    }).superRefine((output, ctx) => {
      validatePantsFinalPromptContract(output.shots, shotCount, pantsContract, ctx)
    }) as z.ZodType<PhotoFissionShotPlannerOutput>
  }
  if (imagePromptMode === 'pants-action-plan') {
    return z.object({
      shots: z.array(PantsActionPlanCardSchema).length(shotCount),
    }).superRefine((output, ctx) => {
      validatePantsActionPlanContract(output.shots, shotCount, ctx)
    }) as z.ZodType<PhotoFissionShotPlannerOutput>
  }
  return z.object({
    shots: z.array(buildShotCardSchema(imagePromptMode)).length(shotCount),
  }) as z.ZodType<PhotoFissionShotPlannerOutput>
}

function validatePantsActionPlanContract(
  shots: readonly PhotoFissionShotCard[],
  shotCount: number,
  ctx: z.RefinementCtx,
): void {
  const expectedViews = PANTS_VIEW_SEQUENCE_BY_COUNT[shotCount] ?? []
  const expectedAngles = PANTS_ANGLE_SEQUENCE_BY_COUNT[shotCount] ?? []
  const usedPoseCardIds = new Set<string>()

  shots.forEach((shot, index) => {
    const expectedShotId = `shot_${index + 1}`
    if (shot.shotId !== expectedShotId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'shotId'],
        message: `裤子动作计划 shotId 必须按顺序输出：期望 ${expectedShotId}`,
      })
    }

    const expectedView = expectedViews[index]
    if (expectedView && shot.view !== expectedView) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'view'],
        message: `裤子动作计划方向错误：期望 ${expectedView}`,
      })
    }

    const expectedAngle = expectedAngles[index]
    if (expectedAngle && shot.angle !== expectedAngle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'angle'],
        message: `裤子动作计划角度必须使用标准 token：${expectedAngle}`,
      })
    }

    if (shot.poseCardId) {
      if (usedPoseCardIds.has(shot.poseCardId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'poseCardId'],
          message: `裤子动作计划姿势卡重复：${shot.poseCardId}`,
        })
      }
      usedPoseCardIds.add(shot.poseCardId)
      const expectedPrefix = expectedView && expectedView !== 'side'
        ? `${expectedView}-`
        : ''
      if (expectedPrefix && !shot.poseCardId.startsWith(expectedPrefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'poseCardId'],
          message: `裤子动作计划姿势卡方向必须匹配 ${expectedView}`,
        })
      }
    }
  })
}

function validatePantsFinalPromptContract(
  shots: readonly PhotoFissionShotCard[],
  shotCount: number,
  pantsContract: PantsFinalPromptContract | undefined,
  ctx: z.RefinementCtx,
): void {
  const expectedViews = PANTS_VIEW_SEQUENCE_BY_COUNT[shotCount] ?? []
  const expectedAngles = PANTS_ANGLE_SEQUENCE_BY_COUNT[shotCount] ?? []
  const usedPoseCardIds = new Set<string>()
  const handMode = pantsContract?.handMode ?? 'hidden'

  shots.forEach((shot, index) => {
    const expectedShotId = `shot_${index + 1}`
    if (shot.shotId !== expectedShotId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'shotId'],
        message: `裤子分镜 shotId 必须按顺序输出：期望 ${expectedShotId}`,
      })
    }

    const expectedView = expectedViews[index]
    if (expectedView && shot.view !== expectedView) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'view'],
        message: `裤子分镜方向错误：期望 ${expectedView}`,
      })
    }

    const expectedAngle = expectedAngles[index]
    if (expectedAngle && shot.angle !== expectedAngle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'angle'],
        message: `裤子分镜角度必须使用标准 token：${expectedAngle}`,
      })
    }

    if (shot.poseCardId) {
      if (usedPoseCardIds.has(shot.poseCardId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'poseCardId'],
          message: `裤子姿势卡重复：${shot.poseCardId}`,
        })
      }
      usedPoseCardIds.add(shot.poseCardId)
      const expectedPrefix = expectedView && expectedView !== 'side'
        ? `${expectedView}-`
        : ''
      if (expectedPrefix && !shot.poseCardId.startsWith(expectedPrefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'poseCardId'],
          message: `裤子姿势卡方向必须匹配 ${expectedView}`,
        })
      }
    }

    const finalPrompt = shot.finalPrompt ?? ''
    if (!/POSITIVE PROMPT\s*:/i.test(finalPrompt) || !/NEGATIVE PROMPT\s*:/i.test(finalPrompt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'finalPrompt'],
        message: 'finalPrompt 必须包含 POSITIVE PROMPT: 和 NEGATIVE PROMPT: 两段',
      })
    }

    const positivePrompt = extractPositivePrompt(finalPrompt)
    if (handMode === 'hidden') {
      if (PANTS_HAND_TOKEN_PATTERN.test(positivePrompt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'finalPrompt'],
          message: '无手模式 finalPrompt 正向段不得出现手部/手臂相关词',
        })
      }
      if (PANTS_FULL_BODY_TOKEN_PATTERN.test(stripNegatedPantsExclusionPhrases(positivePrompt))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'finalPrompt'],
          message: '无手模式 finalPrompt 正向段不得补全全身、上半身、头脸或完整人像',
        })
      }
      if (!/no\s+(?:visible\s+)?hands?|no\s+arms?|without\s+hands?/i.test(finalPrompt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'finalPrompt'],
          message: '无手模式 finalPrompt 负向段必须包含 no hands / no arms 类约束',
        })
      }
    } else {
      if (!PANTS_HAND_TOKEN_PATTERN.test(positivePrompt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'finalPrompt'],
          message: '有手模式 finalPrompt 正向段必须包含明确手部造型',
        })
      }
      if (PANTS_DANGEROUS_VISIBLE_HAND_PATTERN.test(positivePrompt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'finalPrompt'],
          message: '有手模式禁止双手下垂、自然摆放、贴裤缝或贴大腿外侧',
        })
      }
    }
  })
}

function extractPositivePrompt(finalPrompt: string): string {
  const match = finalPrompt.match(
    /POSITIVE PROMPT\s*:\s*([\s\S]*?)(?:NEGATIVE PROMPT\s*:|$)/i,
  )
  return (match?.[1] ?? finalPrompt).trim()
}

function stripNegatedPantsExclusionPhrases(text: string): string {
  return text
    .replace(/\b(?:no|without|exclude|excluding|not showing|not include|does not include|do not include)\s+(?:any\s+)?(?:full[-\s]?body|upper body|head|face|portrait)s?\b/gi, ' ')
    .replace(/\b(?:full[-\s]?body|upper body|head|face|portrait)s?\s+(?:not visible|not shown|excluded|absent)\b/gi, ' ')
    .replace(/(?:不要|不出现|不展示|不包含|无|没有)(?:任何)?(?:全身|完整身体|完整人像|上半身|头部|脸部|五官|头像)/g, ' ')
    .replace(/(?:全身|完整身体|完整人像|上半身|头部|脸部|五官|头像)(?:不出现|不展示|不可见|排除)/g, ' ')
}

export interface InvokeShotPlannerInput {
  systemPrompt: string
  userPrompt: string
  /** 输出 shot 数量，合法值 2/4/9/10 */
  shotCount: PhotoFissionResultCount
  /** 可选的 traceId，仅用于日志追踪 */
  traceId?: string
  /** 开启 DeepSeek thinking mode，提升分镜推理质量但会增加耗时 */
  reasoningEnabled?: boolean
  /** 裤子等结构化链路可强制拒绝 string imagePrompt，避免成功落回旧 TEXT */
  imagePromptMode?: ShotPlannerImagePromptMode
  /** 裤子最终提示词输出契约，用于 Schema 阶段校验手部模式和 shot 顺序。 */
  pantsFinalPromptContract?: PantsFinalPromptContract
  /** 可选：schema 校验失败后再让 LLM 重写一次 */
  retryOnSchemaFailure?: boolean
}

/**
 * @deprecated 仅保持 photo-fission service 的既有 catch 逻辑兼容；
 * 新 feature 应直接捕获 `FissionPromptPlannerError`。
 */
export class ShotPlannerError extends FissionPromptPlannerError {
  constructor(
    message: string,
    cause?: unknown,
    stage?: FissionPromptPlannerErrorStage,
  ) {
    super(message, cause, stage)
    this.name = 'ShotPlannerError'
  }
}

/**
 * 调用通用 Fission Prompt Planner，生成指定数量的 ShotCard。
 *
 * @throws ShotPlannerError caller 应捕获并回退到 feature 自己的稳定链路
 */
export async function invokeShotPlanner(
  input: InvokeShotPlannerInput,
): Promise<PhotoFissionShotPlannerOutput> {
  const shotCount = input.shotCount
  if (!VALID_SHOT_COUNTS.has(shotCount)) {
    throw new Error(`invokeShotPlanner: 不支持的 shotCount=${shotCount}`)
  }

  const outputSchema = buildShotPlannerOutputSchema(
    shotCount,
    input.imagePromptMode ?? 'any',
    input.pantsFinalPromptContract,
  )

  try {
    return await invokeFissionPromptPlanner({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      outputSchema,
      traceId: input.traceId,
      feature: 'photo-fission',
      plannerName: 'photo-fission-shot-planner',
      reasoningEnabled: input.reasoningEnabled,
      retryOnSchemaFailure: input.retryOnSchemaFailure,
    })
  } catch (error) {
    if (error instanceof FissionPromptPlannerError) {
      throw new ShotPlannerError(error.message, error.cause, error.stage)
    }
    throw error
  }
}
