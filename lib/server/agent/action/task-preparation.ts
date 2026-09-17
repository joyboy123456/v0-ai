import { z } from 'zod'
import { AGENT_BUDGET, PREVIEW_TTL_MS } from '@/lib/agent/budget'
import {
  assetDigest,
  canonicalize,
  digest,
  paramsDigest,
  requestDigest,
  type PreviewArtifact,
  type RetryPreviewArtifact,
} from '@/lib/agent/contracts'
import type { AgentToolMeta, JsonValue } from '@/lib/agent/types'
import {
  SELECTABLE_FASHION_MODELS,
  type AssetRecord,
  type FeatureType,
  type GenerationTask,
  type TaskParams,
} from '@/lib/types'
import type {
  AssetQueryPort,
  PreparationContext,
  TaskPreparationPort,
  TaskQueryPort,
  UntrustedTaskProposal,
} from '../ports'

export const TASK_PREPARATION_POLICY_VERSION = 'agent-task-preparation-v1'
export const MULTIPLE_RESULTS_BLOCKER = 'decision_gate:multiple_results_not_enabled'
export const POSE_PROMPT_NOT_SUPPORTED_BLOCKER = 'decision_gate:pose_prompt_not_supported'

const SELECTABLE_GRSAI_MODEL_IDS = new Set<string>(
  SELECTABLE_FASHION_MODELS
    .filter((model) => model.provider === 'grsai')
    .map((model) => model.id),
)
const USER_GOAL_NOTICE_PREFIX = '用户目标：'
const PREVIEW_ONLY_NOTICE = '该动作仅生成冻结预览，仍需用户确认后才能提交。'
const POSE_PROMPT_LIMITATION_NOTICE = '姿势裂变的自由提示词覆盖尚未接入任务参数，当前不能执行该用户要求；只能使用已绑定的姿势与设置。'

/** 非细节图功能尚未在 TaskParams 中保存模板版本，C4 用代码版本作为冻结快照。 */
export const FEATURE_PROMPT_TEMPLATE_VERSIONS = Object.freeze({
  'ai-fashion-photo': 'ai-fashion-photo-v1',
  'photo-fission': 'photo-fission-v1',
  'pose-fission': 'pose-fission-v1',
  'garment-detail': 'garment-detail-v1',
} satisfies Record<FeatureType, string>)

const TOOL_FEATURE = Object.freeze({
  'fashion_photo.create': 'ai-fashion-photo',
  'photo_fission.create': 'photo-fission',
  'pose_fission.create': 'pose-fission',
  'garment_detail.create': 'garment-detail',
} satisfies Record<string, FeatureType>)

function featureForTool(toolName: string): FeatureType | undefined {
  if (!Object.hasOwn(TOOL_FEATURE, toolName)) return undefined
  return TOOL_FEATURE[toolName as keyof typeof TOOL_FEATURE]
}

const promptOnlySchema = () => z.object({
  prompt: z.string().trim().min(1).max(8_000),
}).strict()

function createToolMeta(
  name: keyof typeof TOOL_FEATURE,
  featureType: FeatureType,
  description: string,
  whenToUse: string,
  whenNotToUse: string[],
): AgentToolMeta {
  return Object.freeze({
    name,
    featureType,
    description,
    whenToUse,
    whenNotToUse: Object.freeze([...whenNotToUse]) as unknown as string[],
    inputSchema: promptOnlySchema(),
    readOnly: false,
    costClass: 'paid_generation',
    sideEffectClass: 'external_irreversible',
    approvalPolicy: 'preview_confirmation',
    requiresFreshState: true,
    quotaPerTurn: 1,
    rollbackCapability: 'irreversible_after_submit',
  })
}

export const fashionPhotoCreateToolMetadata = createToolMeta(
  'fashion_photo.create',
  'ai-fashion-photo',
  '构建 AI 服装大片的服务端冻结预览，不提交生图任务。',
  '用户已选好参考素材并要求生成单张或多张服装商拍图时使用。',
  ['仅咨询流程时不要使用。', '素材尚未选定时不要使用。'],
)

export const photoFissionCreateToolMetadata = createToolMeta(
  'photo_fission.create',
  'photo-fission',
  '构建服装大片裂变的服务端冻结预览，不提交生图任务。',
  '用户要从服装主图生成固定镜头套图时使用。',
  ['仅更换一个姿势时不要使用。', '素材或童装品类设置缺失时不要使用。'],
)

export const poseFissionCreateToolMetadata = createToolMeta(
  'pose_fission.create',
  'pose-fission',
  '构建姿势裂变的服务端冻结预览，不提交生图任务。',
  '用户已从服务端姿势库选定姿势并要求保持服装生成时使用。',
  ['没有选定姿势时不要使用。', '需要整套固定镜头规划时不要使用。'],
)

export const garmentDetailCreateToolMetadata = createToolMeta(
  'garment_detail.create',
  'garment-detail',
  '构建服装高清细节图的服务端冻结预览，不提交生图任务。',
  '用户要生成领口、面料或工艺等商品局部细节图时使用。',
  ['仅放大查看原图时不要使用。', '没有服装主图时不要使用。'],
)

/** 重试目标完全由服务端绑定；模型参数必须是严格空对象。 */
export const retryShotsToolMetadata: AgentToolMeta = Object.freeze({
  name: 'task.retry_shots',
  description: '为服务端已绑定的失败镜头构建冻结重试预览，不提交生图任务。',
  whenToUse: '用户明确要求重试当前任务中已由服务端确认失败的镜头时使用。',
  whenNotToUse: Object.freeze([
    '模型不能选择 taskId 或 shotIds。',
    '镜头尚未确认失败时不要使用。',
  ]) as unknown as string[],
  inputSchema: z.object({}).strict(),
  readOnly: false,
  costClass: 'paid_generation',
  sideEffectClass: 'external_irreversible',
  approvalPolicy: 'preview_confirmation',
  requiresFreshState: true,
  quotaPerTurn: 1,
  rollbackCapability: 'irreversible_after_submit',
})

/** C1 可直接注册的四个 create 工具元数据；每项 inputSchema 都是 strict ZodObject。 */
export const CREATE_TASK_TOOL_METADATA: readonly AgentToolMeta[] = Object.freeze([
  fashionPhotoCreateToolMetadata,
  photoFissionCreateToolMetadata,
  poseFissionCreateToolMetadata,
  garmentDetailCreateToolMetadata,
])
export const createTaskToolMetadata = CREATE_TASK_TOOL_METADATA

/** C5 可注册的全部付费生成准备动作；重试不携带模型可写控制参数。 */
export const TASK_PREPARATION_TOOL_METADATA: readonly AgentToolMeta[] = Object.freeze([
  ...CREATE_TASK_TOOL_METADATA,
  retryShotsToolMetadata,
])
export const taskPreparationToolMetadata = TASK_PREPARATION_TOOL_METADATA

export type TaskPreparationErrorCode =
  | 'invalid_proposal'
  | 'invalid_context'
  | 'unsupported_tool'
  | 'proposal_conflict'
  | 'preview_expired'
  | 'artifact_not_found'
  | 'artifact_tampered'
  | 'asset_not_found'
  | 'asset_forbidden'
  | 'asset_changed'
  | 'feature_unavailable'
  | 'model_unavailable'
  | 'invalid_settings'
  | 'task_not_found'
  | 'task_owner_missing'
  | 'task_forbidden'
  | 'retry_not_supported'
  | 'retry_shot_unknown'
  | 'retry_shot_not_failed'
  | 'retry_state_changed'
  | 'storage_failure'
  | 'dependency_failure'

export class TaskPreparationError extends Error {
  constructor(readonly code: TaskPreparationErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'TaskPreparationError'
  }
}

/** 单个功能的适配器只做现有参数归一化，不得持有任务创建或图片供应商能力。 */
export interface FeaturePreparationNormalizer {
  normalize(input: {
    featureType: FeatureType
    prompt: string
    settings: JsonValue
    inputAssetIds: readonly string[]
    normalizationSeed: string
    userId: string
  }): Promise<PreparedFeatureNormalization>
}

/** 归一化结果同时冻结真实模型、模板和输出位数量。 */
export interface PreparedFeatureNormalization {
  normalizedParams: TaskParams
  resolvedModelId: string
  promptTemplateVersion: string
  estimatedResultCount: number
}

export type TaskPreparationNormalizers = Readonly<Record<FeatureType, FeaturePreparationNormalizer>>

/** 可用性端口只回答当前真值；校验旧预览时不得返回替代模型。 */
export interface TaskPreparationAvailabilityPort {
  isFeatureAvailable(featureType: FeatureType): Promise<boolean>
  isModelAvailable(featureType: FeatureType, resolvedModelId: string): Promise<boolean>
}

/** 重试输入来自已鉴权的服务端选择；attempt 始终从当前任务镜头状态推导。 */
export interface RetryPreparationInput {
  taskId: string
  shotIds: readonly string[]
}

/** 可选解析器只能读取原任务的冻结控制字段，不能按当前可用性切换模型。 */
export interface TaskFrozenControlResolver {
  resolve(task: GenerationTask): Promise<{
    resolvedModelId: string
    promptTemplateVersion: string
  }>
}

export type StoredArtifactKind = 'generate' | 'retry_shots'

/** 存储引用把完整动作摘要与准备输入、原素材和可选任务状态绑定。 */
export interface StoredPreparationReference {
  schemaVersion: 1
  key: string
  kind: StoredArtifactKind
  inputDigest: string
  requestDigest: string
  referenceDigest: string
  inputAssetIds: string[]
  sourceTaskId: string | null
  sourceTaskStateDigest: string | null
  artifact: PreviewArtifact | RetryPreviewArtifact
}

/** saveIfAbsent 必须原子地返回已存在或新保存的不可变引用，禁止覆盖。 */
export interface TaskPreparationArtifactStorePort {
  get(key: string): Promise<StoredPreparationReference | undefined>
  saveIfAbsent(reference: StoredPreparationReference): Promise<StoredPreparationReference>
}

/** 仅保证当前进程内重放；不宣称重启后持久化。 */
export class InMemoryTaskPreparationArtifactStore implements TaskPreparationArtifactStorePort {
  readonly #references = new Map<string, StoredPreparationReference>()

  async get(key: string): Promise<StoredPreparationReference | undefined> {
    const reference = this.#references.get(key)
    return reference ? immutableCopy(reference) : undefined
  }

  async saveIfAbsent(reference: StoredPreparationReference): Promise<StoredPreparationReference> {
    const current = this.#references.get(reference.key)
    if (current) return immutableCopy(current)
    const saved = immutableCopy(reference)
    this.#references.set(reference.key, saved)
    return immutableCopy(saved)
  }
}

export interface TaskPreparationDependencies {
  assets: AssetQueryPort
  tasks: TaskQueryPort
  normalizers: TaskPreparationNormalizers
  availability: TaskPreparationAvailabilityPort
  store?: TaskPreparationArtifactStorePort
  taskControls?: TaskFrozenControlResolver
  now?: () => Date
  policyVersion?: string
}

/** 现有端口的扩展只增加 dry-run 重试预览，不包含任何任务提交结果。 */
export interface TaskPreparationWithRetryPort extends TaskPreparationPort {
  prepareRetry(input: RetryPreparationInput, context: PreparationContext): Promise<RetryPreviewArtifact>
  validateRetry(preview: RetryPreviewArtifact): Promise<void>
}

const identifierSchema = z.string().trim().min(1).max(256)
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const featureSchema = z.enum([
  'ai-fashion-photo',
  'photo-fission',
  'pose-fission',
  'garment-detail',
])
const identifierListSchema = z.array(identifierSchema).max(32)
  .refine((items) => new Set(items).size === items.length, '标识不可重复')
const nonEmptyIdentifierListSchema = z.array(identifierSchema).min(1).max(32)
  .refine((items) => new Set(items).size === items.length, '标识不可重复')
const stringListSchema = z.array(z.string().min(1).max(8_512)).max(32)
  .refine((items) => new Set(items).size === items.length, '列表项不可重复')

const contextSchema = z.object({
  userId: identifierSchema,
  sessionId: identifierSchema,
  messageId: identifierSchema,
  proposalId: identifierSchema,
  version: z.number().int().positive().safe(),
  selectedAssetIds: identifierListSchema,
  settings: z.unknown(),
}).strict()

const proposalSchema = z.object({
  toolName: z.string().min(1).max(100),
  args: z.unknown(),
}).strict()

const retryInputSchema = z.object({
  taskId: identifierSchema,
  shotIds: nonEmptyIdentifierListSchema,
}).strict()

const previewArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  proposalId: identifierSchema,
  version: z.number().int().positive().safe(),
  userId: identifierSchema,
  sessionId: identifierSchema,
  messageId: identifierSchema,
  toolName: z.string().min(1).max(100),
  featureType: featureSchema,
  normalizedParams: z.unknown(),
  inputAssetIds: nonEmptyIdentifierListSchema,
  assetDigests: z.array(digestSchema).min(1).max(32),
  paramsDigest: digestSchema,
  policyVersion: z.string().min(1).max(128),
  estimatedResultCount: z.number().int().positive().safe(),
  normalizationSeed: digestSchema,
  resolvedModelId: z.string().trim().min(1).max(256),
  promptTemplateVersion: z.string().trim().min(1).max(256),
  blockers: stringListSchema,
  riskNotices: stringListSchema,
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
}).strict()

const retryArtifactSchema = previewArtifactSchema.omit({
  normalizedParams: true,
  inputAssetIds: true,
  normalizationSeed: true,
}).extend({
  toolName: z.literal('task.retry_shots'),
  taskId: identifierSchema,
  shotIds: nonEmptyIdentifierListSchema,
  attempt: z.number().int().positive().safe(),
}).strict()

const storedReferenceSchema = z.object({
  schemaVersion: z.literal(1),
  key: z.string().min(1).max(2_048),
  kind: z.enum(['generate', 'retry_shots']),
  inputDigest: digestSchema,
  requestDigest: digestSchema,
  referenceDigest: digestSchema,
  inputAssetIds: nonEmptyIdentifierListSchema,
  sourceTaskId: identifierSchema.nullable(),
  sourceTaskStateDigest: digestSchema.nullable(),
  artifact: z.unknown(),
}).strict()

function preparationError(code: TaskPreparationErrorCode, message: string): TaskPreparationError {
  return new TaskPreparationError(code, message)
}

function parsePlain<T>(schema: z.ZodType<T>, value: unknown, code: TaskPreparationErrorCode, message: string): T {
  try {
    // 先 canonical 再交给 Zod，避免 getter、原型或隐藏字段参与解析。
    const plain = JSON.parse(canonicalize(value)) as unknown
    return schema.parse(plain)
  } catch (error) {
    if (error instanceof TaskPreparationError) throw error
    throw preparationError(code, message)
  }
}

function clonePlain(value: unknown, path = 'value'): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'object') throw new TypeError(`${path} 不是可冻结的 JSON 数据`)

  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} 只能是普通对象或数组`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError(`${path} 不接受 symbol 字段`)
  if (array) {
    const dataKeys = keys.filter((key) => key !== 'length') as string[]
    if (dataKeys.length !== value.length || dataKeys.some((key, index) => key !== String(index))) {
      throw new TypeError(`${path} 不接受稀疏数组或额外字段`)
    }
    return dataKeys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
        throw new TypeError(`${path}.${key} 不是有效数组项`)
      }
      return clonePlain(descriptor.value, `${path}.${key}`)
    })
  }

  const output: Record<string, unknown> = Object.create(null)
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${path}.${key} 不是普通数据字段`)
    }
    // 现有 normalizer 会显式返回部分 undefined 可选字段；冻结前统一移除。
    if (descriptor.value !== undefined) output[key] = clonePlain(descriptor.value, `${path}.${key}`)
  }
  return output
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(clonePlain(value) as T)
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw preparationError('artifact_tampered', message)
  }
  return value as Record<string, unknown>
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allow = new Set(allowed)
  if (Object.keys(record).some((key) => !allow.has(key))) {
    throw preparationError('artifact_tampered', '归一化参数包含所属功能未声明的字段')
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function readPhotoDetailCount(
  record: Record<string, unknown>,
  enabledKey: 'hasFrontDetail' | 'hasSideDetail' | 'hasBackDetail',
  countKey: 'frontDetailCount' | 'sideDetailCount' | 'backDetailCount',
  max: number,
  optionalEnabled = false,
): number {
  const rawEnabled = record[enabledKey]
  const enabled = rawEnabled === undefined && optionalEnabled ? false : rawEnabled
  if (typeof enabled !== 'boolean') {
    throw preparationError('artifact_tampered', '服装大片裂变细节素材开关无效')
  }
  const rawCount = record[countKey]
  const count = rawCount === undefined ? (enabled ? 1 : 0) : rawCount
  if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > max
    || enabled !== ((count as number) > 0)) {
    throw preparationError('artifact_tampered', '服装大片裂变细节素材数量无效')
  }
  return count as number
}

function assertPhotoAssetLayout(
  record: Record<string, unknown>,
  inputAssetIds: readonly string[],
): void {
  const isPants = record.childrensCategory === 'pants'
  const frontCount = readPhotoDetailCount(
    record,
    'hasFrontDetail',
    'frontDetailCount',
    isPants ? 2 : 1,
  )
  const sideCount = readPhotoDetailCount(
    record,
    'hasSideDetail',
    'sideDetailCount',
    isPants ? 2 : 0,
    true,
  )
  const backCount = readPhotoDetailCount(
    record,
    'hasBackDetail',
    'backDetailCount',
    isPants ? 2 : 1,
  )
  const faceModel = record.faceIdModelId
  const faceMask = record.faceMaskAssetId
  const faceModelActive = nonEmptyString(faceModel)
  const faceMaskActive = nonEmptyString(faceMask)
  if (faceModel !== undefined && faceModel !== null && !faceModelActive) {
    throw preparationError('artifact_tampered', '服装大片裂变五官模型标识无效')
  }
  if (faceMask !== undefined && faceMask !== null && !faceMaskActive) {
    throw preparationError('artifact_tampered', '服装大片裂变五官蒙版标识无效')
  }
  if (faceModelActive !== faceMaskActive || (isPants && faceModelActive)) {
    throw preparationError('artifact_tampered', '服装大片裂变五官模型与蒙版绑定无效')
  }

  const expectedAssetCount = 1 + frontCount + sideCount + backCount + (faceModelActive ? 1 : 0)
  if (inputAssetIds.length !== expectedAssetCount) {
    throw preparationError('artifact_tampered', '服装大片裂变素材顺序或数量无效')
  }
  if (faceMaskActive && inputAssetIds[inputAssetIds.length - 1] !== faceMask) {
    throw preparationError('artifact_tampered', '五官蒙版必须是主图及全部细节图之后的最后一个绑定素材')
  }
}

interface InspectedParams {
  estimatedResultCount: number
  resolvedModelId: string
  embeddedTemplateVersion?: string
}

function inspectFeatureParams(
  featureType: FeatureType,
  params: unknown,
  inputAssetIds: readonly string[],
  requireNormalizationSeed = true,
): InspectedParams {
  const record = asRecord(params, '归一化参数不是对象')
  if (featureType === 'ai-fashion-photo') {
    assertOnlyKeys(record, [
      'prompt', 'userPrompt', 'finalPrompt', 'promptMode', 'model', 'referenceImageCount',
      'imageRatio', 'resolution', 'resultCount', 'creditsCost',
    ])
    if (!nonEmptyString(record.prompt) || !nonEmptyString(record.userPrompt)
      || !nonEmptyString(record.finalPrompt) || !nonEmptyString(record.model)
      || !['raw', 'enhanced'].includes(String(record.promptMode))
      || !['1:1', '3:2', '2:3', '3:4', '4:3'].includes(String(record.imageRatio))
      || !['2k', '4k'].includes(String(record.resolution))
      || ![1, 2, 4].includes(Number(record.resultCount))
      || record.referenceImageCount !== inputAssetIds.length
      || typeof record.creditsCost !== 'number' || !Number.isFinite(record.creditsCost)) {
      throw preparationError('artifact_tampered', 'AI 服装大片归一化参数无效')
    }
    return { estimatedResultCount: record.resultCount as number, resolvedModelId: record.model }
  }

  if (featureType === 'photo-fission') {
    assertOnlyKeys(record, [
      'model', 'category', 'childrensCategory', 'hasFrontDetail', 'hasSideDetail', 'hasBackDetail',
      'frontDetailCount', 'sideDetailCount', 'backDetailCount', 'pantsMainHandVisibility',
      'pantsPoseDrawSeed', 'plannerReasoningEnabled', 'imageRatio', 'resolution', 'shotPlan',
      'resultCount', 'referenceAssetKey', 'faceIdModelId', 'faceMaskAssetId',
    ])
    const shots = record.shotPlan
    const resultCount = record.resultCount
    if (!nonEmptyString(record.model) || record.category !== 'childrens'
      || !['dress', 'suit', 'pants'].includes(String(record.childrensCategory))
      || ![2, 4, 9, 10].includes(Number(resultCount)) || !Array.isArray(shots)
      || shots.length !== resultCount || !['2k', '4k'].includes(String(record.resolution))) {
      throw preparationError('artifact_tampered', '服装大片裂变归一化参数无效')
    }
    assertPhotoAssetLayout(record, inputAssetIds)
    const ids = new Set<string>()
    shots.forEach((shot, index) => {
      const item = asRecord(shot, '裂变镜头不是对象')
      if (!nonEmptyString(item.shotId) || !nonEmptyString(item.label) || !nonEmptyString(item.prompt)
        || item.order !== index + 1 || ids.has(item.shotId)) {
        throw preparationError('artifact_tampered', '服装大片裂变镜头计划无效')
      }
      ids.add(item.shotId)
    })
    if (requireNormalizationSeed && record.childrensCategory === 'pants' && !nonEmptyString(record.pantsPoseDrawSeed)) {
      throw preparationError('artifact_tampered', '裤装裂变缺少冻结抽卡种子')
    }
    return { estimatedResultCount: resultCount as number, resolvedModelId: record.model }
  }

  if (featureType === 'pose-fission') {
    assertOnlyKeys(record, [
      'model', 'poses', 'hasFrontDetail', 'hasBackDetail', 'lowerBodyMainArmVisibility',
      'imageRatio', 'resolution', 'resultCount', 'creditsCost',
    ])
    const poses = record.poses
    if (!nonEmptyString(record.model) || !Array.isArray(poses) || poses.length < 1 || poses.length > 9
      || record.resultCount !== poses.length || !['2k', '4k'].includes(String(record.resolution))
      || record.creditsCost !== 0) {
      throw preparationError('artifact_tampered', '姿势裂变归一化参数无效')
    }
    const ids = new Set<string>()
    for (const pose of poses) {
      const item = asRecord(pose, '姿势模板不是对象')
      if (!nonEmptyString(item.id) || !nonEmptyString(item.url) || !nonEmptyString(item.name)
        || !['full', 'upper', 'lower'].includes(String(item.bodyPart)) || ids.has(item.id)) {
        throw preparationError('artifact_tampered', '姿势裂变模板无效')
      }
      ids.add(item.id)
    }
    return { estimatedResultCount: poses.length, resolvedModelId: record.model }
  }

  assertOnlyKeys(record, [
    'category', 'algorithmModelId', 'algorithmModelName', 'modelTier', 'resolution', 'imageRatio',
    'userPrompt', 'aiAppendDescription', 'referenceImageCount', 'detailShots', 'resultCount',
    'creditsCost', 'resolvedModelId', 'promptTemplateVersion',
  ])
  const shots = record.detailShots
  if (!['tops', 'bottoms', 'dress', 'accessory', 'shoes-bags'].includes(String(record.category))
    || !nonEmptyString(record.algorithmModelId) || !nonEmptyString(record.algorithmModelName)
    || !['standard', 'professional'].includes(String(record.modelTier))
    || !['1k', '2k', '4k'].includes(String(record.resolution))
    || !['1:1', '3:4', '4:3'].includes(String(record.imageRatio))
    || typeof record.userPrompt !== 'string' || typeof record.aiAppendDescription !== 'boolean'
    || !Array.isArray(shots) || shots.length < 1 || record.resultCount !== shots.length
    || record.referenceImageCount !== inputAssetIds.length - 1 || record.creditsCost !== 0
    || !nonEmptyString(record.resolvedModelId) || !nonEmptyString(record.promptTemplateVersion)) {
    throw preparationError('artifact_tampered', '服装细节图归一化参数无效')
  }
  const expectedReferences = inputAssetIds.slice(1)
  const shotIds = new Set<string>()
  shots.forEach((shot, index) => {
    const item = asRecord(shot, '细节输出位不是对象')
    const expectedReference = expectedReferences.length ? expectedReferences[index] : null
    if (!nonEmptyString(item.shotId) || !nonEmptyString(item.label)
      || item.referenceAssetId !== expectedReference || shotIds.has(item.shotId)) {
      throw preparationError('artifact_tampered', '服装细节图输出位无效')
    }
    shotIds.add(item.shotId)
  })
  return {
    estimatedResultCount: shots.length,
    resolvedModelId: record.resolvedModelId,
    embeddedTemplateVersion: record.promptTemplateVersion,
  }
}

function artifactKey(userId: string, proposalId: string, version: number): string {
  return canonicalize({ userId, proposalId, version })
}

function readNow(now: () => Date): Date {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw preparationError('dependency_failure', '时钟返回了无效时间')
  }
  return value
}

function assertLifetime(artifact: Pick<PreviewArtifact, 'createdAt' | 'expiresAt'>, now: Date): void {
  const createdAt = Date.parse(artifact.createdAt)
  const expiresAt = Date.parse(artifact.expiresAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)
    || expiresAt - createdAt !== PREVIEW_TTL_MS || createdAt > now.getTime()) {
    throw preparationError('artifact_tampered', '预览有效期字段无效')
  }
  if (now.getTime() >= expiresAt) throw preparationError('preview_expired', '预览已过期，请创建新版本')
}

async function referenceDigest(reference: Omit<StoredPreparationReference, 'referenceDigest' | 'artifact'>): Promise<string> {
  return digest({
    schemaVersion: 1,
    key: reference.key,
    kind: reference.kind,
    inputDigest: reference.inputDigest,
    requestDigest: reference.requestDigest,
    inputAssetIds: reference.inputAssetIds,
    sourceTaskId: reference.sourceTaskId,
    sourceTaskStateDigest: reference.sourceTaskStateDigest,
  })
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function expectedGenerateBlockers(featureType: FeatureType, resultCount: number): string[] {
  const blockers = resultCount > AGENT_BUDGET.maxResultsPerApproval ? [MULTIPLE_RESULTS_BLOCKER] : []
  if (featureType === 'pose-fission') blockers.push(POSE_PROMPT_NOT_SUPPORTED_BLOCKER)
  return blockers
}

function expectedRetryBlockers(resultCount: number): string[] {
  return resultCount > AGENT_BUDGET.maxResultsPerApproval ? [MULTIPLE_RESULTS_BLOCKER] : []
}

function generationRiskNotices(featureType: FeatureType, prompt: string): string[] {
  const notices = [`${USER_GOAL_NOTICE_PREFIX}${prompt}`, PREVIEW_ONLY_NOTICE]
  if (featureType === 'pose-fission') notices.push(POSE_PROMPT_LIMITATION_NOTICE)
  return notices
}

function hasExpectedGenerationRiskNotices(
  featureType: FeatureType,
  notices: readonly string[],
): boolean {
  const expectedLength = featureType === 'pose-fission' ? 3 : 2
  return notices.length === expectedLength
    && notices[0].startsWith(USER_GOAL_NOTICE_PREFIX)
    && notices[0].slice(USER_GOAL_NOTICE_PREFIX.length).trim().length > 0
    && notices[1] === PREVIEW_ONLY_NOTICE
    && (featureType !== 'pose-fission' || notices[2] === POSE_PROMPT_LIMITATION_NOTICE)
}

async function taskStateDigest(task: GenerationTask, originalParamsDigest: string): Promise<string> {
  const shotProgress = (task.shotProgress ?? []).map((shot) => ({
    shotId: shot.shotId,
    label: shot.label,
    status: shot.status,
    retryAttempt: shot.retryAttempt ?? null,
  }))
  const results = task.results.map((result) => ({
    assetId: result.assetId,
    shotId: result.shotId ?? null,
  }))
  return digest({
    schemaVersion: 1,
    taskId: task.taskId,
    userId: task.userId ?? null,
    featureType: task.featureType,
    inputAssetIds: task.inputAssetIds,
    paramsDigest: originalParamsDigest,
    status: task.status,
    progress: task.progress,
    resultAssetIds: task.resultAssetIds,
    results,
    shotProgress,
    finishedAt: task.finishedAt ?? null,
  })
}

function knownRetryShotIds(task: GenerationTask): string[] {
  const params = asRecord(task.params, '原任务参数无效')
  if (task.featureType === 'photo-fission') {
    if (!Array.isArray(params.shotPlan)) throw preparationError('retry_not_supported', '原任务没有镜头计划')
    return params.shotPlan.map((shot) => {
      const item = asRecord(shot, '原任务镜头无效')
      if (!nonEmptyString(item.shotId)) throw preparationError('retry_not_supported', '原任务镜头缺少标识')
      return item.shotId
    })
  }
  if (task.featureType === 'pose-fission') {
    if (!Array.isArray(params.poses)) throw preparationError('retry_not_supported', '原任务没有姿势计划')
    return params.poses.map((pose) => {
      const item = asRecord(pose, '原任务姿势无效')
      if (!nonEmptyString(item.id)) throw preparationError('retry_not_supported', '原任务姿势缺少标识')
      return item.id
    })
  }
  if (task.featureType === 'garment-detail') {
    if (!Array.isArray(params.detailShots)) throw preparationError('retry_not_supported', '原任务没有细节输出位')
    return params.detailShots.map((shot) => {
      const item = asRecord(shot, '原任务细节输出位无效')
      if (!nonEmptyString(item.shotId)) throw preparationError('retry_not_supported', '原任务细节输出位缺少标识')
      return item.shotId
    })
  }
  throw preparationError('retry_not_supported', '该功能没有可验证的稳定镜头计划')
}

function deriveRetryAttempt(task: GenerationTask, requestedShotIds: readonly string[]): number {
  if (task.status !== 'failed' && task.status !== 'partial') {
    throw preparationError('retry_shot_not_failed', '原任务当前不是失败或部分失败状态')
  }
  const known = knownRetryShotIds(task)
  if (new Set(known).size !== known.length) throw preparationError('retry_not_supported', '原任务镜头标识重复')
  const knownSet = new Set(known)
  const progressById = new Map<string, NonNullable<GenerationTask['shotProgress']>[number]>()
  for (const progress of task.shotProgress ?? []) {
    if (progressById.has(progress.shotId)) throw preparationError('retry_state_changed', '原任务镜头状态重复')
    progressById.set(progress.shotId, progress)
  }

  let highestAttempt = 0
  for (const shotId of requestedShotIds) {
    if (!knownSet.has(shotId)) throw preparationError('retry_shot_unknown', `镜头 ${shotId} 不属于原任务计划`)
    const progress = progressById.get(shotId)
    if (!progress || progress.status !== 'failed'
      || task.results.some((result) => result.shotId === shotId)) {
      throw preparationError('retry_shot_not_failed', `镜头 ${shotId} 当前不是可重试的失败镜头`)
    }
    const attempt = progress.retryAttempt ?? 0
    if (!Number.isSafeInteger(attempt) || attempt < 0) {
      throw preparationError('retry_state_changed', `镜头 ${shotId} 的重试轮次无效`)
    }
    highestAttempt = Math.max(highestAttempt, attempt)
  }
  if (!Number.isSafeInteger(highestAttempt + 1)) throw preparationError('retry_state_changed', '重试轮次超出安全范围')
  return highestAttempt + 1
}

/** 创建稳定准备边界；默认存储只在当前进程内有效，调用方可注入持久化实现。 */
export function createTaskPreparation(dependencies: TaskPreparationDependencies): TaskPreparationWithRetryPort {
  const store = dependencies.store ?? new InMemoryTaskPreparationArtifactStore()
  const now = dependencies.now ?? (() => new Date())
  const policyVersion = dependencies.policyVersion ?? TASK_PREPARATION_POLICY_VERSION
  if (!policyVersion.trim()) throw preparationError('invalid_context', 'policyVersion 不能为空')

  const pending = new Map<string, { inputDigest: string; promise: Promise<PreviewArtifact | RetryPreviewArtifact> }>()

  async function getStored(key: string): Promise<StoredPreparationReference | undefined> {
    let raw: StoredPreparationReference | undefined
    try {
      raw = await store.get(key)
    } catch {
      throw preparationError('storage_failure', '读取预览引用失败')
    }
    return raw ? verifyStoredReference(raw, key) : undefined
  }

  async function verifyStoredReference(raw: unknown, expectedKey: string): Promise<StoredPreparationReference> {
    const reference = parsePlain(
      storedReferenceSchema,
      raw,
      'artifact_tampered',
      '服务端预览引用格式无效',
    ) as StoredPreparationReference
    if (reference.key !== expectedKey) throw preparationError('artifact_tampered', '服务端预览引用键不一致')
    const expectedReferenceDigest = await referenceDigest(reference)
    if (reference.referenceDigest !== expectedReferenceDigest) {
      throw preparationError('artifact_tampered', '服务端预览引用摘要不一致')
    }
    const artifact = reference.kind === 'generate'
      ? parsePlain(previewArtifactSchema, reference.artifact, 'artifact_tampered', '服务端生成预览格式无效') as PreviewArtifact
      : parsePlain(retryArtifactSchema, reference.artifact, 'artifact_tampered', '服务端重试预览格式无效') as RetryPreviewArtifact
    const fullDigest = await requestDigest({
      actionKind: reference.kind,
      payload: artifact,
    } as Parameters<typeof requestDigest>[0])
    if (fullDigest !== reference.requestDigest) {
      throw preparationError('artifact_tampered', '服务端预览完整摘要不一致')
    }
    return immutableCopy({ ...reference, artifact })
  }

  async function saveReference(
    base: Omit<StoredPreparationReference, 'referenceDigest'>,
  ): Promise<StoredPreparationReference> {
    const reference: StoredPreparationReference = {
      ...base,
      referenceDigest: await referenceDigest(base),
    }
    let stored: StoredPreparationReference
    try {
      stored = await store.saveIfAbsent(immutableCopy(reference))
    } catch {
      throw preparationError('storage_failure', '保存预览引用失败，已阻止返回未持久化预览')
    }
    return verifyStoredReference(stored, reference.key)
  }

  async function assertFeatureAvailable(featureType: FeatureType): Promise<void> {
    let available: boolean
    try {
      available = await dependencies.availability.isFeatureAvailable(featureType)
    } catch {
      throw preparationError('dependency_failure', '查询功能可用性失败')
    }
    if (!available) throw preparationError('feature_unavailable', `功能 ${featureType} 当前不可用`)
  }

  async function assertModelAvailable(featureType: FeatureType, modelId: string): Promise<void> {
    // 动态 availability 只能收紧策略，不能放行旧渠道或不可选模型。
    if (!SELECTABLE_GRSAI_MODEL_IDS.has(modelId)) {
      throw preparationError('model_unavailable', `冻结模型 ${modelId} 不属于可选 Grsai 注册表`)
    }
    let available: boolean
    try {
      available = await dependencies.availability.isModelAvailable(featureType, modelId)
    } catch {
      throw preparationError('dependency_failure', '查询模型可用性失败')
    }
    if (!available) throw preparationError('model_unavailable', `冻结模型 ${modelId} 当前不可用，请创建新预览`)
  }

  async function readAssets(userId: string, assetIds: readonly string[]): Promise<{
    assets: AssetRecord[]
    digests: string[]
  }> {
    if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
      throw preparationError('invalid_context', '必须选择不重复的输入素材')
    }
    const assets: AssetRecord[] = []
    for (const assetId of assetIds) {
      let asset: AssetRecord | undefined
      try {
        asset = await dependencies.assets.getAsset(assetId)
      } catch {
        throw preparationError('dependency_failure', `查询素材 ${assetId} 失败`)
      }
      if (!asset) throw preparationError('asset_not_found', `素材 ${assetId} 不存在`)
      if (asset.assetId !== assetId) {
        throw preparationError('asset_not_found', `素材查询返回了不匹配的记录 ${asset.assetId}`)
      }
      if (asset.userId !== userId) throw preparationError('asset_forbidden', `素材 ${assetId} 不属于当前用户`)
      assets.push(asset)
    }
    try {
      return { assets, digests: await Promise.all(assets.map((asset) => assetDigest(asset))) }
    } catch {
      throw preparationError('dependency_failure', '计算素材摘要失败')
    }
  }

  async function validateAssetSnapshot(
    userId: string,
    assetIds: readonly string[],
    expectedDigests: readonly string[],
  ): Promise<void> {
    if (assetIds.length !== expectedDigests.length) throw preparationError('artifact_tampered', '素材与摘要数量不一致')
    const current = await readAssets(userId, assetIds)
    if (!sameStringArray(current.digests, expectedDigests)) {
      throw preparationError('asset_changed', '素材记录已变化，请创建新预览')
    }
  }

  async function validateGeneratedRecord(
    reference: StoredPreparationReference,
    candidate: unknown,
  ): Promise<void> {
    if (reference.kind !== 'generate') throw preparationError('artifact_tampered', '预览类型与服务端引用不一致')
    const preview = parsePlain(previewArtifactSchema, candidate, 'artifact_tampered', '生成预览格式无效') as PreviewArtifact
    const storedPreview = reference.artifact as PreviewArtifact
    if (canonicalize(preview) !== canonicalize(storedPreview)) {
      throw preparationError('artifact_tampered', '生成预览与服务端不可变引用不一致')
    }
    const fullDigest = await requestDigest({ actionKind: 'generate', payload: preview })
    if (fullDigest !== reference.requestDigest) throw preparationError('artifact_tampered', '生成预览完整摘要不一致')
    if (!sameStringArray(preview.inputAssetIds, reference.inputAssetIds)) {
      throw preparationError('artifact_tampered', '生成预览素材引用不一致')
    }
    if (reference.sourceTaskId !== null || reference.sourceTaskStateDigest !== null) {
      throw preparationError('artifact_tampered', '生成预览包含了重试任务引用')
    }
    const mappedFeature = featureForTool(preview.toolName)
    if (!mappedFeature || mappedFeature !== preview.featureType || preview.policyVersion !== policyVersion) {
      throw preparationError('artifact_tampered', '工具、功能或策略版本不一致')
    }
    const inspected = inspectFeatureParams(preview.featureType, preview.normalizedParams, preview.inputAssetIds)
    if (inspected.estimatedResultCount !== preview.estimatedResultCount
      || inspected.resolvedModelId !== preview.resolvedModelId
      || (inspected.embeddedTemplateVersion !== undefined
        && inspected.embeddedTemplateVersion !== preview.promptTemplateVersion)
      || !sameStringArray(
        preview.blockers,
        expectedGenerateBlockers(preview.featureType, preview.estimatedResultCount),
      )
      || !hasExpectedGenerationRiskNotices(preview.featureType, preview.riskNotices)) {
      throw preparationError('artifact_tampered', '冻结模型、模板、输出数量、用户目标或决策阻断不一致')
    }
    const currentParamsDigest = await paramsDigest(preview.featureType, preview.normalizedParams)
    if (currentParamsDigest !== preview.paramsDigest) throw preparationError('artifact_tampered', '归一化参数摘要不一致')
    assertLifetime(preview, readNow(now))
    await validateAssetSnapshot(preview.userId, preview.inputAssetIds, preview.assetDigests)
    await assertFeatureAvailable(preview.featureType)
    await assertModelAvailable(preview.featureType, preview.resolvedModelId)
  }

  async function resolveTaskControls(task: GenerationTask, inspected: InspectedParams): Promise<{
    resolvedModelId: string
    promptTemplateVersion: string
  }> {
    if (!dependencies.taskControls) {
      if (!inspected.embeddedTemplateVersion) {
        throw preparationError('retry_state_changed', '原任务缺少历史冻结模板证据，不能安全重试')
      }
      return {
        resolvedModelId: inspected.resolvedModelId,
        promptTemplateVersion: inspected.embeddedTemplateVersion,
      }
    }
    let controls: { resolvedModelId: string; promptTemplateVersion: string }
    try {
      controls = await dependencies.taskControls.resolve(task)
    } catch {
      throw preparationError('dependency_failure', '读取原任务冻结模型与模板失败')
    }
    if (!nonEmptyString(controls?.resolvedModelId) || !nonEmptyString(controls?.promptTemplateVersion)) {
      throw preparationError('retry_state_changed', '原任务缺少冻结模型或模板版本')
    }
    if (controls.resolvedModelId !== inspected.resolvedModelId) {
      throw preparationError('retry_state_changed', '原任务模型证据与参数不一致')
    }
    if (inspected.embeddedTemplateVersion
      && controls.promptTemplateVersion !== inspected.embeddedTemplateVersion) {
      throw preparationError('retry_state_changed', '原任务内嵌模板版本与冻结控制证据矛盾')
    }
    return immutableCopy({
      resolvedModelId: inspected.resolvedModelId,
      promptTemplateVersion: inspected.embeddedTemplateVersion ?? controls.promptTemplateVersion,
    })
  }

  async function readOwnedTask(taskId: string, userId: string): Promise<GenerationTask> {
    let task: GenerationTask | undefined
    try {
      task = await dependencies.tasks.getTask(taskId)
    } catch {
      throw preparationError('dependency_failure', `查询任务 ${taskId} 失败`)
    }
    if (!task) throw preparationError('task_not_found', `任务 ${taskId} 不存在`)
    if (task.taskId !== taskId) {
      throw preparationError('task_not_found', `任务查询返回了不匹配的记录 ${task.taskId}`)
    }
    if (!task.userId) throw preparationError('task_owner_missing', '原任务缺少 userId，不能安全重试')
    if (task.userId !== userId) throw preparationError('task_forbidden', '原任务不属于当前用户')
    return task
  }

  async function currentRetrySnapshot(
    taskId: string,
    userId: string,
    shotIds: readonly string[],
  ): Promise<{
    task: GenerationTask
    paramsDigest: string
    attempt: number
    assetDigests: string[]
    controls: { resolvedModelId: string; promptTemplateVersion: string }
    stateDigest: string
  }> {
    const task = await readOwnedTask(taskId, userId)
    // 旧任务已有完整分镜即可按原参数重试；不能补造历史 seed，也不重新规划。
    const inspected = inspectFeatureParams(task.featureType, task.params, task.inputAssetIds, false)
    const originalParamsDigest = await paramsDigest(task.featureType, task.params)
    const attempt = deriveRetryAttempt(task, shotIds)
    const controls = await resolveTaskControls(task, inspected)
    if (controls.resolvedModelId !== inspected.resolvedModelId) {
      throw preparationError('retry_state_changed', '原任务模型快照与参数不一致')
    }
    const assets = await readAssets(userId, task.inputAssetIds)
    return {
      task,
      paramsDigest: originalParamsDigest,
      attempt,
      assetDigests: assets.digests,
      controls,
      stateDigest: await taskStateDigest(task, originalParamsDigest),
    }
  }

  async function validateRetryRecord(
    reference: StoredPreparationReference,
    candidate: unknown,
  ): Promise<void> {
    if (reference.kind !== 'retry_shots' || !reference.sourceTaskId || !reference.sourceTaskStateDigest) {
      throw preparationError('artifact_tampered', '重试预览缺少服务端任务引用')
    }
    const preview = parsePlain(retryArtifactSchema, candidate, 'artifact_tampered', '重试预览格式无效') as RetryPreviewArtifact
    const storedPreview = reference.artifact as RetryPreviewArtifact
    if (canonicalize(preview) !== canonicalize(storedPreview)) {
      throw preparationError('artifact_tampered', '重试预览与服务端不可变引用不一致')
    }
    const fullDigest = await requestDigest({ actionKind: 'retry_shots', payload: preview })
    if (fullDigest !== reference.requestDigest || preview.taskId !== reference.sourceTaskId
      || preview.policyVersion !== policyVersion
      || !sameStringArray(preview.blockers, expectedRetryBlockers(preview.estimatedResultCount))) {
      throw preparationError('artifact_tampered', '重试预览完整摘要、任务或决策阻断不一致')
    }
    assertLifetime(preview, readNow(now))
    const current = await currentRetrySnapshot(preview.taskId, preview.userId, preview.shotIds)
    if (current.task.featureType !== preview.featureType
      || current.paramsDigest !== preview.paramsDigest
      || current.attempt !== preview.attempt
      || current.controls.resolvedModelId !== preview.resolvedModelId
      || current.controls.promptTemplateVersion !== preview.promptTemplateVersion
      || current.stateDigest !== reference.sourceTaskStateDigest
      || preview.estimatedResultCount !== preview.shotIds.length
      || !sameStringArray(current.task.inputAssetIds, reference.inputAssetIds)
      || !sameStringArray(current.assetDigests, preview.assetDigests)) {
      throw preparationError('retry_state_changed', '原任务、镜头、参数、素材或轮次已变化，请创建新重试预览')
    }
    await assertFeatureAvailable(preview.featureType)
    await assertModelAvailable(preview.featureType, preview.resolvedModelId)
  }

  async function coalesce<T extends PreviewArtifact | RetryPreviewArtifact>(
    key: string,
    inputDigestValue: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const current = pending.get(key)
    if (current) {
      if (current.inputDigest !== inputDigestValue) {
        throw preparationError('proposal_conflict', '同一 proposal/version 已用于不同输入，请递增版本')
      }
      return immutableCopy(await current.promise) as T
    }
    let promise!: Promise<T>
    promise = work().finally(() => {
      if (pending.get(key)?.promise === promise) pending.delete(key)
    })
    pending.set(key, { inputDigest: inputDigestValue, promise })
    return immutableCopy(await promise)
  }

  async function prepare(input: UntrustedTaskProposal, rawContext: PreparationContext): Promise<PreviewArtifact> {
    const proposal = parsePlain(proposalSchema, input, 'invalid_proposal', '生成提案格式无效')
    const context = parsePlain(contextSchema, rawContext, 'invalid_context', '准备上下文格式无效')
    const featureType = featureForTool(proposal.toolName)
    if (!featureType) throw preparationError('unsupported_tool', `工具 ${proposal.toolName} 未注册为 create 工具`)
    const metadata = CREATE_TASK_TOOL_METADATA.find((tool) => tool.name === proposal.toolName)!
    const args = parsePlain(metadata.inputSchema as z.ZodType<{ prompt: string }>, proposal.args,
      'invalid_proposal', '模型参数只能包含 prompt')
    const normalizedContext = immutableCopy(context) as PreparationContext
    const key = artifactKey(context.userId, context.proposalId, context.version)
    const inputDigestValue = await digest({
      schemaVersion: 1,
      kind: 'generate',
      userId: context.userId,
      sessionId: context.sessionId,
      messageId: context.messageId,
      proposalId: context.proposalId,
      version: context.version,
      toolName: proposal.toolName,
      prompt: args.prompt,
      selectedAssetIds: context.selectedAssetIds,
      settings: context.settings,
    })
    const normalizationSeed = await digest({
      schemaVersion: 1,
      purpose: 'normalization_seed',
      userId: context.userId,
      sessionId: context.sessionId,
      messageId: context.messageId,
      proposalId: context.proposalId,
      version: context.version,
      toolName: proposal.toolName,
      prompt: args.prompt,
    })

    return coalesce(key, inputDigestValue, async () => {
      const replay = await getStored(key)
      if (replay) {
        if (replay.kind !== 'generate' || replay.inputDigest !== inputDigestValue) {
          throw preparationError('proposal_conflict', '同一 proposal/version 已绑定其他输入')
        }
        await validateGeneratedRecord(replay, replay.artifact)
        return replay.artifact as PreviewArtifact
      }

      await assertFeatureAvailable(featureType)
      const assets = await readAssets(context.userId, context.selectedAssetIds)
      const normalizer = dependencies.normalizers[featureType]
      if (!normalizer) throw preparationError('dependency_failure', `缺少 ${featureType} normalizer`)
      let normalized: PreparedFeatureNormalization
      try {
        normalized = await normalizer.normalize({
          featureType,
          prompt: args.prompt,
          settings: normalizedContext.settings,
          inputAssetIds: normalizedContext.selectedAssetIds,
          normalizationSeed,
          userId: normalizedContext.userId,
        })
      } catch (error) {
        if (error instanceof TaskPreparationError) throw error
        const reason = error instanceof Error ? error.message : '未知参数错误'
        throw preparationError('invalid_settings', reason)
      }
      const normalizedParams = immutableCopy(normalized.normalizedParams) as TaskParams
      const inspected = inspectFeatureParams(featureType, normalizedParams, context.selectedAssetIds)
      if (!nonEmptyString(normalized.resolvedModelId) || !nonEmptyString(normalized.promptTemplateVersion)
        || normalized.estimatedResultCount !== inspected.estimatedResultCount
        || normalized.resolvedModelId !== inspected.resolvedModelId
        || (inspected.embeddedTemplateVersion !== undefined
          && normalized.promptTemplateVersion !== inspected.embeddedTemplateVersion)) {
        throw preparationError('invalid_settings', 'normalizer 返回的模型、模板或输出数量与真实参数不一致')
      }
      await assertModelAvailable(featureType, normalized.resolvedModelId)
      const created = readNow(now)
      const preview: PreviewArtifact = immutableCopy({
        schemaVersion: 1,
        proposalId: context.proposalId,
        version: context.version,
        userId: context.userId,
        sessionId: context.sessionId,
        messageId: context.messageId,
        toolName: proposal.toolName,
        featureType,
        normalizedParams,
        inputAssetIds: [...context.selectedAssetIds],
        assetDigests: assets.digests,
        paramsDigest: await paramsDigest(featureType, normalizedParams),
        policyVersion,
        estimatedResultCount: normalized.estimatedResultCount,
        normalizationSeed,
        resolvedModelId: normalized.resolvedModelId,
        promptTemplateVersion: normalized.promptTemplateVersion,
        blockers: expectedGenerateBlockers(featureType, normalized.estimatedResultCount),
        riskNotices: generationRiskNotices(featureType, args.prompt),
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + PREVIEW_TTL_MS).toISOString(),
      })
      const fullDigest = await requestDigest({ actionKind: 'generate', payload: preview })
      const saved = await saveReference({
        schemaVersion: 1,
        key,
        kind: 'generate',
        inputDigest: inputDigestValue,
        requestDigest: fullDigest,
        inputAssetIds: [...context.selectedAssetIds],
        sourceTaskId: null,
        sourceTaskStateDigest: null,
        artifact: preview,
      })
      if (saved.kind !== 'generate' || saved.inputDigest !== inputDigestValue) {
        throw preparationError('proposal_conflict', '并发准备已用不同输入占用 proposal/version')
      }
      await validateGeneratedRecord(saved, saved.artifact)
      return saved.artifact as PreviewArtifact
    })
  }

  async function validatePrepared(candidate: PreviewArtifact): Promise<void> {
    const preview = parsePlain(previewArtifactSchema, candidate, 'artifact_tampered', '生成预览格式无效') as PreviewArtifact
    const key = artifactKey(preview.userId, preview.proposalId, preview.version)
    const reference = await getStored(key)
    if (!reference) throw preparationError('artifact_not_found', '找不到服务端生成预览引用')
    await validateGeneratedRecord(reference, preview)
  }

  async function prepareRetry(rawInput: RetryPreparationInput, rawContext: PreparationContext): Promise<RetryPreviewArtifact> {
    const input = parsePlain(retryInputSchema, rawInput, 'invalid_proposal', '重试选择格式无效')
    const context = parsePlain(contextSchema, rawContext, 'invalid_context', '准备上下文格式无效')
    parsePlain(z.object({}).strict(), context.settings, 'invalid_context', '重试不接受新的生成控制参数')
    const key = artifactKey(context.userId, context.proposalId, context.version)
    const inputDigestValue = await digest({
      schemaVersion: 1,
      kind: 'retry_shots',
      userId: context.userId,
      sessionId: context.sessionId,
      messageId: context.messageId,
      proposalId: context.proposalId,
      version: context.version,
      taskId: input.taskId,
      shotIds: input.shotIds,
    })

    return coalesce(key, inputDigestValue, async () => {
      const replay = await getStored(key)
      if (replay) {
        if (replay.kind !== 'retry_shots' || replay.inputDigest !== inputDigestValue) {
          throw preparationError('proposal_conflict', '同一 proposal/version 已绑定其他动作或镜头')
        }
        await validateRetryRecord(replay, replay.artifact)
        return replay.artifact as RetryPreviewArtifact
      }

      const current = await currentRetrySnapshot(input.taskId, context.userId, input.shotIds)
      await assertFeatureAvailable(current.task.featureType)
      await assertModelAvailable(current.task.featureType, current.controls.resolvedModelId)
      const created = readNow(now)
      const preview: RetryPreviewArtifact = immutableCopy({
        schemaVersion: 1,
        proposalId: context.proposalId,
        version: context.version,
        userId: context.userId,
        sessionId: context.sessionId,
        messageId: context.messageId,
        toolName: 'task.retry_shots',
        featureType: current.task.featureType,
        assetDigests: current.assetDigests,
        paramsDigest: current.paramsDigest,
        policyVersion,
        estimatedResultCount: input.shotIds.length,
        resolvedModelId: current.controls.resolvedModelId,
        promptTemplateVersion: current.controls.promptTemplateVersion,
        blockers: expectedRetryBlockers(input.shotIds.length),
        riskNotices: ['该动作仅生成失败镜头重试预览，仍需重新确认后才能提交。'],
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + PREVIEW_TTL_MS).toISOString(),
        taskId: input.taskId,
        shotIds: [...input.shotIds],
        attempt: current.attempt,
      })
      const fullDigest = await requestDigest({ actionKind: 'retry_shots', payload: preview })
      const saved = await saveReference({
        schemaVersion: 1,
        key,
        kind: 'retry_shots',
        inputDigest: inputDigestValue,
        requestDigest: fullDigest,
        inputAssetIds: [...current.task.inputAssetIds],
        sourceTaskId: input.taskId,
        sourceTaskStateDigest: current.stateDigest,
        artifact: preview,
      })
      if (saved.kind !== 'retry_shots' || saved.inputDigest !== inputDigestValue) {
        throw preparationError('proposal_conflict', '并发准备已用不同动作占用 proposal/version')
      }
      await validateRetryRecord(saved, saved.artifact)
      return saved.artifact as RetryPreviewArtifact
    })
  }

  async function validateRetry(candidate: RetryPreviewArtifact): Promise<void> {
    const preview = parsePlain(retryArtifactSchema, candidate, 'artifact_tampered', '重试预览格式无效') as RetryPreviewArtifact
    const key = artifactKey(preview.userId, preview.proposalId, preview.version)
    const reference = await getStored(key)
    if (!reference) throw preparationError('artifact_not_found', '找不到服务端重试预览引用')
    await validateRetryRecord(reference, preview)
  }

  return Object.freeze({ prepare, validatePrepared, prepareRetry, validateRetry })
}
