import { z } from 'zod'
import { canonicalize } from '@/lib/agent/contracts'
import { assertFieldOrigin, type FieldOrigin, type GovernedField } from '@/lib/agent/provenance'
import type { AgentToolMeta } from '@/lib/agent/types'
import { DEFAULT_FASHION_MODEL, FASHION_IMAGE_RATIOS, FASHION_RESOLUTIONS, SELECTABLE_FASHION_MODELS } from '@/lib/types'
import type { FashionImageRatio, FashionModelId, FashionResolution, FeatureType } from '@/lib/types'

type SelectionOrigin = Extract<FieldOrigin, 'user_selection' | 'system_policy'>

/** 仅由通过认证、范围和归属校验的服务端会话组装；不可从模型 JSON 反序列化。 */
export interface ServerSelection<T> {
  value: T
  origin: SelectionOrigin
}

/** 来源标签表达服务端已验证的输入通道，不充当资产归属或批准凭据。 */
export interface ServerBindingContext {
  userId: string
  sessionId: string
  messageId: string
  idempotencyKey: string
  assetIds?: ServerSelection<readonly string[]>
  taskId?: ServerSelection<string>
  shotIds?: ServerSelection<readonly string[]>
  generation?: {
    model?: ServerSelection<FashionModelId>
    imageRatio?: ServerSelection<Exclude<FashionImageRatio, 'more'>>
    resolution?: ServerSelection<FashionResolution>
    resultCount?: ServerSelection<number>
  }
}

interface BoundBase {
  readonly toolName: string
  readonly prompt?: string
  readonly userId: string
  readonly sessionId: string
  readonly messageId: string
  readonly idempotencyKey: string
  readonly assetIds: readonly string[]
  readonly taskId?: string
  readonly shotIds?: readonly string[]
  readonly origins: Readonly<Partial<Record<GovernedField, FieldOrigin>>>
}

/** 输出是独立冻结快照；没有执行权限，不能直接用作 PreviewArtifact 或 ApprovalReceipt。 */
export type BoundToolProposal = BoundBase & (
  | { readonly kind: 'generation'; readonly featureType: FeatureType; readonly model: FashionModelId
    readonly imageRatio: Exclude<FashionImageRatio, 'more'>; readonly resolution: FashionResolution; readonly resultCount: number }
  | { readonly kind: 'utility' }
)

export class ProvenanceBindingError extends Error {
  constructor(readonly code: 'provenance_violation' | 'tool_hallucination', message: string) {
    super(`${code}: ${message}`)
    this.name = 'ProvenanceBindingError'
  }
}

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const ids = z.array(identifier).refine((items) => new Set(items).size === items.length, '标识不能重复')
const selectionSchema = z.object({ value: z.unknown(), origin: z.string() }).strict()
const proposalSchema = z.object({
  toolName: z.string().min(1).max(100).regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/),
  prompt: z.string().trim().min(1).max(8000).optional(),
}).strict()
const contextSchema = z.object({
  userId: identifier, sessionId: identifier, messageId: identifier,
  idempotencyKey: z.string().trim().min(1).max(512),
  assetIds: selectionSchema.optional(), taskId: selectionSchema.optional(), shotIds: selectionSchema.optional(),
  generation: z.object({
    model: selectionSchema.optional(), imageRatio: selectionSchema.optional(),
    resolution: selectionSchema.optional(), resultCount: selectionSchema.optional(),
  }).strict().optional(),
}).strict()

function parsePlain<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    // canonical 拒绝 getter、隐藏属性、原型对象和 undefined；不会先执行输入行为。
    return schema.parse(JSON.parse(canonicalize(input)))
  } catch {
    throw new ProvenanceBindingError('provenance_violation', '仅接受符合契约的普通数据，模型只能提供 toolName 和 prompt')
  }
}

/**
 * 模型提案只控制工具名和提示词。字段来源复用 A1 矩阵，控制参数取可信上下文。
 * 工具 schema、前沿、审批、素材新鲜度分别由后续 Dispatch / Preparation / Gateway 负责。
 */
export function bindToolProposal(
  proposal: unknown,
  context: ServerBindingContext,
  lookupTool: (name: string) => AgentToolMeta | undefined,
): BoundToolProposal {
  const input = parsePlain(proposalSchema, proposal)
  const trusted = parsePlain(contextSchema, context)
  const tool = lookupTool(input.toolName)
  if (!tool || tool.name !== input.toolName) {
    throw new ProvenanceBindingError('tool_hallucination', '工具未注册')
  }

  const origins: Partial<Record<GovernedField, FieldOrigin>> = {}
  function mark(field: GovernedField, origin: FieldOrigin): void {
    try { assertFieldOrigin(field, origin) } catch {
      throw new ProvenanceBindingError('provenance_violation', `字段 ${field} 的来源不被允许`)
    }
    origins[field] = origin
  }
  function selected<T>(field: GovernedField, selection: { value?: unknown; origin: string } | undefined,
    schema: z.ZodType<T>, fallback?: T): T {
    mark(field, selection ? selection.origin as FieldOrigin : 'system_policy')
    const result = schema.safeParse(selection ? selection.value : fallback)
    if (!result.success) throw new ProvenanceBindingError('provenance_violation', `字段 ${field} 不符合服务端范围`)
    return result.data
  }

  mark('toolName', 'model_inference')
  mark('userId', 'system_policy')
  mark('idempotencyKey', 'system_policy')
  if (input.prompt !== undefined) mark('prompt', 'model_inference')
  const base = {
    toolName: input.toolName,
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    userId: trusted.userId, sessionId: trusted.sessionId, messageId: trusted.messageId,
    idempotencyKey: trusted.idempotencyKey,
    assetIds: Object.freeze(selected('assetIds', trusted.assetIds, ids, [])),
    ...(trusted.taskId === undefined ? {} : { taskId: selected('taskId', trusted.taskId, identifier) }),
    ...(trusted.shotIds === undefined ? {} : { shotIds: Object.freeze(selected('shotIds', trusted.shotIds, ids)) }),
  }

  // 重试也属于 paid_generation，但参数应由原任务重建，不能套用新的生成设置。
  if (tool.readOnly || tool.costClass !== 'paid_generation' || tool.featureType === undefined) {
    if (trusted.generation !== undefined) {
      throw new ProvenanceBindingError('provenance_violation', '非生成工具不接受生成参数')
    }
    return Object.freeze({ ...base, kind: 'utility', origins: Object.freeze(origins) })
  }

  if (!input.prompt) throw new ProvenanceBindingError('provenance_violation', '生成提案缺少提示词')
  mark('featureType', 'system_policy')
  const settings = trusted.generation
  const model = selected('model', settings?.model, z.string().refine((value) =>
    SELECTABLE_FASHION_MODELS.some((item) => item.id === value && item.provider === 'grsai')), DEFAULT_FASHION_MODEL) as FashionModelId
  const imageRatio = selected('imageRatio', settings?.imageRatio, z.string().refine((value) =>
    value !== 'more' && FASHION_IMAGE_RATIOS.some((item) => item.id === value)), '3:4') as Exclude<FashionImageRatio, 'more'>
  const resolution = selected('resolution', settings?.resolution, z.string().refine((value) =>
    FASHION_RESOLUTIONS.some((item) => item.id === value)), '2k') as FashionResolution
  // 多张可用于后续 dry-run；真实提交张数闸门由 Gateway 执行。
  const resultCount = selected('resultCount', settings?.resultCount, z.number().int().positive().safe(), 1)
  const modelDefinition = SELECTABLE_FASHION_MODELS.find((item) => item.id === model)!
  if (Number.parseInt(resolution, 10) > Number.parseInt(modelDefinition.maxResolutionLabel, 10)) {
    throw new ProvenanceBindingError('provenance_violation', '分辨率超出模型支持范围')
  }
  if (base.assetIds.length > modelDefinition.maxInputImages) {
    throw new ProvenanceBindingError('provenance_violation', '素材数超出模型支持范围')
  }
  return Object.freeze({ ...base, kind: 'generation', featureType: tool.featureType,
    model, imageRatio, resolution, resultCount, origins: Object.freeze(origins) })
}
