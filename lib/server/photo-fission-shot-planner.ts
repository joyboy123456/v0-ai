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
  StructuredImagePrompt,
} from '@/lib/types'
import {
  FissionPromptPlannerError,
  invokeFissionPromptPlanner,
  type FissionPromptPlannerErrorStage,
} from './fission-prompt-planner'

const VALID_SHOT_COUNTS = new Set<number>([2, 4, 9, 10])

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

const ShotCardSchema = z.object({
  shotId: z.string().min(1),
  role: z.string().min(1),
  imagePrompt: z.union([z.string().min(20), StructuredImagePromptSchema]),
}) satisfies z.ZodType<PhotoFissionShotCard>

function buildShotPlannerOutputSchema(shotCount: number) {
  return z.object({
    shots: z.array(ShotCardSchema).length(shotCount),
  })
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

  const outputSchema = buildShotPlannerOutputSchema(shotCount)

  try {
    return await invokeFissionPromptPlanner({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      outputSchema,
      traceId: input.traceId,
      feature: 'photo-fission',
      plannerName: 'photo-fission-shot-planner',
      reasoningEnabled: input.reasoningEnabled,
    })
  } catch (error) {
    if (error instanceof FissionPromptPlannerError) {
      throw new ShotPlannerError(error.message, error.cause, error.stage)
    }
    throw error
  }
}
