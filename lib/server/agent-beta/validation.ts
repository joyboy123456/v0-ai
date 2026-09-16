import { z } from 'zod'
import type { AgentBetaMessageInput, AgentBetaSettings } from '@/lib/agent-beta/types'
import { DEFAULT_FASHION_MODEL, FASHION_IMAGE_RATIOS, FASHION_RESOLUTIONS, SELECTABLE_FASHION_MODELS } from '@/lib/types'

export class AgentBetaError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'AGENT_BETA_INVALID_REQUEST') {
    super(message)
    this.name = 'AgentBetaError'
  }
}

export const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
export const promptText = z.string().trim().min(1).max(8000)
const settingsSchema = z.object({
  model: z.string().default(DEFAULT_FASHION_MODEL).refine((model) => SELECTABLE_FASHION_MODELS.some((item) => item.id === model && item.provider === 'grsai'), '模型无效'),
  imageRatio: z.string().refine((ratio) => ratio !== 'more' && FASHION_IMAGE_RATIOS.some((item) => item.id === ratio), '图片比例无效'),
  resolution: z.string().refine((resolution) => FASHION_RESOLUTIONS.some((item) => item.id === resolution), '分辨率无效'),
  // 规划 LLM 宽松校验：未知/过期 id 由 runtime 回退目录默认项，不拒绝用户请求
  plannerLlm: z.string().max(60).optional(),
}).strict().superRefine((value, context) => {
  const model = SELECTABLE_FASHION_MODELS.find((item) => item.id === value.model)
  if (model && Number.parseInt(value.resolution, 10) > Number.parseInt(model.maxResolutionLabel, 10)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '分辨率超出当前模型支持范围' })
  }
})
export const messageInputSchema = z.object({
  clientMessageId: identifier,
  text: z.string().trim().min(1).max(4000),
  referenceNodeIds: z.array(identifier).max(10).refine((ids) => new Set(ids).size === ids.length, '参考图不能重复'),
  settings: settingsSchema,
}).strict()
export const patchInputSchema = z.object({
  positions: z.array(z.object({ id: identifier, x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict()).max(50).default([]),
  title: z.string().trim().min(1).max(80).optional(),
}).strict()
export const assetsInputSchema = z.object({ assetIds: z.array(identifier).min(1).max(10).refine((ids) => new Set(ids).size === ids.length) }).strict()
export const executeInputSchema = z.object({ messageId: identifier, prompt: promptText.optional() }).strict()
export const cancelInputSchema = z.object({ messageId: identifier }).strict()
export const emptyInputSchema = z.object({}).strict()
export const plannerOutputSchema = z.object({
  kind: z.enum(['clarify', 'plan']),
  content: z.string().trim().min(1).max(4000),
  prompt: z.string().trim().max(8000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'plan' && !value.prompt) context.addIssue({ code: z.ZodIssueCode.custom, message: '生成方案缺少提示词' })
})
export type PlannerOutput = z.infer<typeof plannerOutputSchema>

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new AgentBetaError('请求参数无效：' + parsed.error.issues.map((item) => item.message).slice(0, 3).join('；'))
  return parsed.data
}
export function parseMessageInput(value: unknown): AgentBetaMessageInput {
  return parseInput(messageInputSchema, value) as AgentBetaMessageInput
}
export function validateSettings(value: unknown): AgentBetaSettings {
  return parseInput(settingsSchema, value) as AgentBetaSettings
}
