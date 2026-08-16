/**
 * 高清放大细节图（garment-detail）服务端核心（PRD §8 参数校验 / §10 Prompt / §11 生成管线）。
 *
 * 组成：
 * - normalizeGarmentDetailParams：服务端参数归一化（不信任客户端的
 *   algorithmModelName / modelTier / referenceImageCount / detailShots /
 *   resultCount / creditsCost / mockRetryCount 等字段，全部重建或剥离）。
 * - buildGarmentDetailShotPlan：细节输出位规划，与前端已验收的
 *   buildGarmentDetailShots（原 lib/garment-detail-mock.ts，已删除；现前端
 *   副本在 lib/garment-detail-api.ts）逐字对齐（PRD §5.3）。
 * - buildGarmentDetailPrompt：PRD §10.2 模板原样落地 + §10.3/§10.4 参考图规则
 *   + §10.5 AI 追加描述观察指令。分辨率绝不出现在 Prompt 里。
 * - runGarmentDetailPipeline：按任务快照 resolvedModelId 固定模型，
 *   provider chain 内 per-shot failover（同模型多渠道，不跨模型切换），
 *   worker-pool 并发（GARMENT_DETAIL_CONCURRENCY，默认 2），逐 shot 流式回调。
 *
 * node --test 兼容性（AGENTS.md 约定）：本模块只允许 import type 级别的
 * 仓库内依赖；运行时依赖（模型注册表 / Provider Pool / Provider Router）
 * 全部经 dependencies 注入，缺省时在函数内懒加载动态 import——
 * 单测注入替身后不会触发动态 import，因此可在 node --test 下直接跑 TS。
 * 需要的类型/常量运行时值在本模块维护本地副本并注明同步来源。
 */

import type {
  GarmentDetailCategory,
  GarmentDetailParams,
  GarmentDetailRatio,
  GarmentDetailResolution,
  GarmentDetailShot,
  GarmentDetailTier,
  ResultAsset,
} from '@/lib/types'
import type { ImageProvider } from './image-provider-pool'
import type { ProviderImageEditInput } from './provider-image-router'

// ---------------------------------------------------------------------------
// 本地常量副本（同步来源见各自注释）
// ---------------------------------------------------------------------------

/** 同步来源：lib/types.ts GARMENT_DETAIL_CATEGORIES。 */
const GARMENT_DETAIL_CATEGORY_IDS: readonly GarmentDetailCategory[] = [
  'tops',
  'bottoms',
  'dress',
  'accessory',
  'shoes-bags',
]

/** 同步来源：lib/types.ts GARMENT_DETAIL_RATIOS。 */
const GARMENT_DETAIL_RATIO_IDS: readonly GarmentDetailRatio[] = ['1:1', '3:4', '4:3']

/** 同步来源：lib/types.ts GARMENT_DETAIL_PROMPT_MAX。 */
const GARMENT_DETAIL_PROMPT_MAX_LENGTH = 103

/** 1 张主图 + 最多 GARMENT_DETAIL_MAX_REFERENCES(3) 张参考图（lib/types.ts）。 */
const GARMENT_DETAIL_MAX_INPUT_ASSETS = 4

/** 同步来源：lib/types.ts GarmentDetailResolution。 */
const GARMENT_DETAIL_RESOLUTION_IDS: readonly GarmentDetailResolution[] = [
  '1k',
  '2k',
  '4k',
]

/**
 * 同步来源：PRD §5.3 表格；前端副本在 lib/garment-detail-api.ts 的
 * DETAIL_PART_LABELS（原 lib/garment-detail-mock.ts，已删除）。
 * 前端任务进度卡的 shotId/label 与本表一一对应，改动必须前后端同步。
 */
const DETAIL_PART_LABELS: Record<GarmentDetailCategory, readonly string[]> = {
  tops: ['领口细节', '袖口细节', '面料纹理'],
  bottoms: ['腰头细节', '走线细节', '面料纹理'],
  dress: ['领口细节', '裙摆细节', '面料纹理'],
  accessory: ['材质特写', '工艺细节', '质感纹理'],
  'shoes-bags': ['五金细节', '走线细节', '材质特写'],
}

/** PRD §6.2：GARMENT_DETAIL_PROMPT_VERSION 默认值。 */
const DEFAULT_PROMPT_TEMPLATE_VERSION = 'garment-detail-v1'

/** PRD §11.3：GARMENT_DETAIL_CONCURRENCY 默认值。 */
const DEFAULT_CONCURRENCY = 2

/** demo 模式（IMAGE_API_DEMO=1）占位图池，仿 third-party-image-adapter 的 demoResults。 */
const DEMO_RESULT_URLS = [
  'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=900&h=1200&fit=crop',
  'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=900&h=1200&fit=crop',
  'https://images.unsplash.com/photo-1445205170230-053b83016050?w=900&h=1200&fit=crop',
  'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=900&h=1200&fit=crop',
  'https://images.unsplash.com/photo-1485462537746-965f33f7f6a7?w=900&h=1200&fit=crop',
  'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=900&h=1200&fit=crop',
]

// ---------------------------------------------------------------------------
// 错误类型（PRD §16：{ error, code, retryable }）
// ---------------------------------------------------------------------------

export type GarmentDetailParamsErrorCode =
  | 'INVALID_PARAMS'
  | 'RESOLUTION_UNSUPPORTED'
  | 'MODEL_UNAVAILABLE'

export class GarmentDetailParamsError extends Error {
  code: GarmentDetailParamsErrorCode
  retryable: boolean

  constructor(input: {
    code: GarmentDetailParamsErrorCode
    message: string
    retryable: boolean
  }) {
    super(input.message)
    this.name = 'GarmentDetailParamsError'
    this.code = input.code
    this.retryable = input.retryable
  }
}

function invalidParams(message: string): GarmentDetailParamsError {
  return new GarmentDetailParamsError({
    code: 'INVALID_PARAMS',
    message,
    retryable: false,
  })
}

// ---------------------------------------------------------------------------
// 细节输出位规划（PRD §5.3，与 mock buildGarmentDetailShots 逐字对齐）
// ---------------------------------------------------------------------------

/**
 * 输出数量 = 参考图数量（无参考图时输出 1 张）。
 * shotId 固定 detail_${i+1}；第 N 个 shot 绑定第 N 张参考图；
 * 无参考图时唯一 shot 的 referenceAssetId 为 null。
 */
export function buildGarmentDetailShotPlan(
  category: GarmentDetailCategory,
  referenceAssetIds: string[],
): GarmentDetailShot[] {
  const parts = DETAIL_PART_LABELS[category]
  if (referenceAssetIds.length === 0) {
    return [{ shotId: 'detail_1', label: parts[0], referenceAssetId: null }]
  }
  return referenceAssetIds.map((assetId, index) => ({
    shotId: `detail_${index + 1}`,
    label: parts[index % parts.length],
    referenceAssetId: assetId,
  }))
}

// ---------------------------------------------------------------------------
// Prompt 模板（PRD §10）
// ---------------------------------------------------------------------------

const REFERENCE_RULE_WITH_REFERENCE = `图2仅用于参考局部镜头、构图、光线、景深和背景表现。
不得复制图2中的商品、颜色、材质、Logo、文字、印花、纽扣或五金。
最终商品必须来自图1。`

const REFERENCE_RULE_WITHOUT_REFERENCE =
  '本次没有构图参考图，请根据目标细节部位自行设计克制、真实的电商微距构图。'

const AI_APPEND_OBSERVATION_BLOCK = `【生成前观察】
生成前先观察图1中与目标部位相关的可见事实，包括颜色、结构、面料、走线、Logo、印花、纽扣、拉链和五金。
只使用可以从图1直接观察或合理确认的事实完成细节摄影，不要将猜测当作商品事实。`

/**
 * PRD §10.2 基础模板原样落地，{DETAIL_LABEL} / {REFERENCE_RULE} / {USER_PROMPT}
 * 三处插值；§10.5 开启时在【用户附加要求】前追加观察指令。
 * 优先级：商品事实锁定 > 目标细节部位 > 参考图角色约束 > 用户附加要求 > 摄影与画质表达。
 * 分辨率只通过模型参数 imageSize 传递（§5.4），绝不出现在 Prompt 里。
 */
export function buildGarmentDetailPrompt(
  shot: GarmentDetailShot,
  params: Pick<
    GarmentDetailParams,
    'userPrompt' | 'aiAppendDescription'
  >,
  hasReference: boolean,
): string {
  const referenceRule = hasReference
    ? REFERENCE_RULE_WITH_REFERENCE
    : REFERENCE_RULE_WITHOUT_REFERENCE
  const userPrompt = params.userPrompt.trim() || '无'

  return [
    '你正在执行电商商品细节摄影生成任务。',
    '',
    '【任务】',
    '根据图1中的商品，生成一张全新的高清局部细节商业摄影图。',
    '这不是简单裁剪、普通插值放大，也不是重新设计商品。',
    `目标细节部位：${shot.label}。`,
    '',
    '【图片角色】',
    '图1是唯一的商品事实来源。',
    referenceRule,
    '',
    '【必须保持】',
    '1. 保持图1商品原有的颜色、颜色分布和明暗关系。',
    '2. 保持商品原有的版型、轮廓、结构、比例和部件位置。',
    '3. 保持图1中可见的面料类型及其真实特征。',
    '4. 保持纽扣、拉链、五金、口袋、走线和装饰件的数量与位置。',
    '5. 保持图1中可见的Logo、文字、印花、刺绣和图案。',
    '6. 只增强原图能够支持的细节；原图没有提供证据的纹理必须克制处理，不得凭空编造新的织法、文字、Logo或装饰。',
    '',
    '【允许变化】',
    '允许改变镜头距离、局部构图、背景、商业布光、景深、合理摆放方式和轻微自然褶皱，但这些变化不能改变商品本身。',
    '',
    '【画面要求】',
    '生成一张完整、连续、真实的电商局部细节摄影图。',
    '使用专业棚拍级柔和光线、自然微阴影、真实材质质感、克制景深。',
    '细节主体清楚，画面干净，适合电商详情页使用。',
    '',
    '【禁止】',
    '禁止拼贴、对比布局、分屏、说明文字、尺寸标注、边框、水印和额外Logo。',
    '禁止新增或删除纽扣、拉链、五金、口袋、走线、文字、印花和装饰。',
    '禁止改变商品颜色、镜像商品或把商品替换成另一款。',
    '禁止出现无关人物、手、衣架或人体模型，除非图1商品结构必须依赖它们展示。',
    '',
    ...(params.aiAppendDescription ? [AI_APPEND_OBSERVATION_BLOCK, ''] : []),
    '【用户附加要求】',
    userPrompt,
    '',
    '只输出一张图片。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 参数归一化（PRD §8 / §9）
// ---------------------------------------------------------------------------

/** 模型解析结果（与 garment-detail-model-registry.resolveGarmentDetailModel 的返回结构一致）。 */
export interface GarmentDetailModelResolutionLike {
  definition: {
    algorithmModelId: string
    algorithmModelName: string
    tier: GarmentDetailTier
    resolutions: readonly GarmentDetailResolution[]
  }
  resolvedModelId: string
}

export interface GarmentDetailNormalizeDependencies {
  /**
   * 按业务别名解析真实上游模型（校验别名合法 + 候选链首个可用）。
   * 缺省时懒加载 ./garment-detail-model-registry（生产路径）；
   * 单测注入替身，不触发动态 import。
   */
  resolveModel?: (
    algorithmModelId: string,
  ) => GarmentDetailModelResolutionLike | Promise<GarmentDetailModelResolutionLike>
}

async function defaultResolveModel(
  algorithmModelId: string,
): Promise<GarmentDetailModelResolutionLike> {
  const registry = await import('./garment-detail-model-registry')
  return registry.resolveGarmentDetailModel(algorithmModelId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readInputAssetIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalidParams('素材列表格式错误')
  }
  const assetIds = value.map((item) =>
    typeof item === 'string' ? item.trim() : '',
  )
  if (assetIds.some((assetId) => !assetId)) {
    throw invalidParams('素材列表包含无效的 assetId')
  }
  if (assetIds.length < 1 || assetIds.length > GARMENT_DETAIL_MAX_INPUT_ASSETS) {
    throw invalidParams(
      `素材数量需为 1～${GARMENT_DETAIL_MAX_INPUT_ASSETS} 张（1 张服装主图 + 最多 3 张参考图）`,
    )
  }
  if (new Set(assetIds).size !== assetIds.length) {
    throw invalidParams('素材不可重复上传同一张图片')
  }
  return assetIds
}

function readCategory(value: unknown): GarmentDetailCategory {
  if (
    typeof value === 'string' &&
    (GARMENT_DETAIL_CATEGORY_IDS as readonly string[]).includes(value)
  ) {
    return value as GarmentDetailCategory
  }
  throw invalidParams('商品分类无效，仅支持 上装/下装/连衣裙/配饰/鞋包')
}

function readImageRatio(value: unknown): GarmentDetailRatio {
  if (
    typeof value === 'string' &&
    (GARMENT_DETAIL_RATIO_IDS as readonly string[]).includes(value)
  ) {
    return value as GarmentDetailRatio
  }
  throw invalidParams('图片比例无效，仅支持 1:1 / 3:4 / 4:3')
}

function readResolutionTier(value: unknown): GarmentDetailResolution {
  if (
    typeof value === 'string' &&
    (GARMENT_DETAIL_RESOLUTION_IDS as readonly string[]).includes(value)
  ) {
    return value as GarmentDetailResolution
  }
  throw invalidParams('分辨率无效，仅支持 1K / 2K / 4K')
}

function readAlgorithmModelId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw invalidParams('缺少模型档位（algorithmModelId）')
}

function readUserPrompt(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw invalidParams('自定义提示词格式错误')
  }
  const trimmed = value.trim()
  // 按 Unicode 字符数计算（不按 UTF-8 字节数），超出直接拒绝，不静默截断。
  if ([...trimmed].length > GARMENT_DETAIL_PROMPT_MAX_LENGTH) {
    throw invalidParams(
      `自定义提示词最多 ${GARMENT_DETAIL_PROMPT_MAX_LENGTH} 字，请精简后再提交`,
    )
  }
  return trimmed
}

/**
 * 服务端参数归一化（PRD §8）。
 *
 * - 素材 1～4 张、禁止重复 assetId（素材存在性与所有权由 createTask 统一校验）；
 * - category / imageRatio 枚举校验；resolution 与模型档位匹配（不匹配抛
 *   RESOLUTION_UNSUPPORTED，不静默降级）；
 * - algorithmModelId 经模型注册表解析出 resolvedModelId（候选链无可用渠道时
 *   注册表抛 code='MODEL_UNAVAILABLE' 的错误）；
 * - userPrompt trim + ≤103 Unicode 字符，超出拒绝；
 * - 服务端重建 referenceImageCount / detailShots / resultCount / creditsCost=0，
 *   剥离 mockRetryCount 等客户端伪造字段，写入 promptTemplateVersion。
 */
export async function normalizeGarmentDetailParams(
  params: unknown,
  inputAssetIds: unknown,
  dependencies: GarmentDetailNormalizeDependencies = {},
): Promise<GarmentDetailParams> {
  if (!isRecord(params)) {
    throw invalidParams('高清放大细节图参数格式错误')
  }

  const assetIds = readInputAssetIds(inputAssetIds)
  const category = readCategory(params.category)
  const imageRatio = readImageRatio(params.imageRatio)
  const resolutionTier = readResolutionTier(params.resolution)
  const userPrompt = readUserPrompt(params.userPrompt)
  const aiAppendDescription = params.aiAppendDescription === true

  const resolveModel = dependencies.resolveModel ?? defaultResolveModel
  const { definition, resolvedModelId } = await resolveModel(
    readAlgorithmModelId(params.algorithmModelId),
  )

  if (!definition.resolutions.includes(resolutionTier)) {
    throw new GarmentDetailParamsError({
      code: 'RESOLUTION_UNSUPPORTED',
      message: `${definition.algorithmModelName}当前不支持 ${resolutionTier.toUpperCase()} 分辨率`,
      retryable: false,
    })
  }

  const referenceAssetIds = assetIds.slice(1)
  const detailShots = buildGarmentDetailShotPlan(category, referenceAssetIds)

  const normalized: GarmentDetailParams = {
    category,
    algorithmModelId: definition.algorithmModelId,
    algorithmModelName: definition.algorithmModelName,
    modelTier: definition.tier,
    resolvedModelId,
    resolution: resolutionTier,
    imageRatio,
    userPrompt,
    aiAppendDescription,
    referenceImageCount: referenceAssetIds.length,
    detailShots,
    resultCount: detailShots.length,
    creditsCost: 0,
    promptTemplateVersion:
      process.env.GARMENT_DETAIL_PROMPT_VERSION?.trim() ||
      DEFAULT_PROMPT_TEMPLATE_VERSION,
  }

  try {
    console.log(
      JSON.stringify({
        evt: 'garment_detail.normalize',
        category: normalized.category,
        algorithmModelId: normalized.algorithmModelId,
        resolvedModelId: normalized.resolvedModelId,
        resolution: normalized.resolution,
        referenceCount: normalized.referenceImageCount,
        shotCount: detailShots.length,
        promptTemplateVersion: normalized.promptTemplateVersion,
      }),
    )
  } catch {
    // 日志失败忽略
  }

  return normalized
}

// ---------------------------------------------------------------------------
// 生成管线（PRD §11）
// ---------------------------------------------------------------------------

export interface RunGarmentDetailPipelineOptions {
  userId: string
  taskId: string
  /** inputAssetIds[0]：服装主图 assetId（写入结果 metadata.sourceMainAssetId）。 */
  mainAssetId: string
  /** 服装主图内容（dataURL，或 Gemini 系可 URL 透传的公开 URL）。 */
  mainImage: string
  /** assetId → 图片内容；只放已成功解析的参考图，按 shot.referenceAssetId 绑定。 */
  referenceImages: Record<string, string>
  /** 服务端归一化后的任务快照（含 resolvedModelId / promptTemplateVersion）。 */
  params: GarmentDetailParams
  signal?: AbortSignal
  /** 失败重试 / 服务恢复时只跑这些 shotId；不传或空数组时跑全部。 */
  targetShotIds?: string[]
  onShotProgress?: (shotId: string, message: string) => void
  /** 单 shot 成功后立刻回调（task-store 流式持久化）。 */
  onShotResult?: (result: ResultAsset) => Promise<void>
}

export interface GarmentDetailPipelineDependencies {
  /** 同模型多渠道 failover 链（默认 getRotatedProvidersForModel）。 */
  getProviderChain?: (modelId: string) => ImageProvider[]
  /** 单次生图调用（默认 runImageEditViaProvider，内建计费/熔断）。 */
  runImageEdit?: (input: ProviderImageEditInput) => Promise<ResultAsset[]>
}

interface GarmentDetailShotRunResult {
  shot: GarmentDetailShot
  result?: ResultAsset
  error?: string
  errorCategory?: string
  providerId?: string
}

function readErrorCategory(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const category = (error as { category?: unknown }).category
    if (typeof category === 'string') return category
  }
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  return undefined
}

function logGarmentDetailEvent(
  evt: string,
  payload: Record<string, unknown>,
): void {
  try {
    console.log(JSON.stringify({ evt, ...payload }))
  } catch {
    // 日志失败忽略
  }
}

function readConcurrency(shotCount: number): number {
  const raw = Number(process.env.GARMENT_DETAIL_CONCURRENCY ?? DEFAULT_CONCURRENCY)
  const base =
    Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_CONCURRENCY
  return Math.max(1, Math.min(base, shotCount))
}

function enrichGarmentDetailResult(
  first: ResultAsset,
  shot: GarmentDetailShot,
  finalPrompt: string,
  options: RunGarmentDetailPipelineOptions,
): ResultAsset {
  const { params } = options
  return {
    ...first,
    assetId: `result_${options.taskId}_${shot.shotId}`,
    kind: 'generated',
    label: shot.label,
    shotId: shot.shotId,
    finalPrompt,
    metadata: {
      featureType: 'garment-detail',
      sourceMainAssetId: options.mainAssetId,
      referenceAssetId: shot.referenceAssetId,
      category: params.category,
      algorithmModelId: params.algorithmModelId,
      resolvedModelId: params.resolvedModelId,
      modelTier: params.modelTier,
      resolution: params.resolution,
      imageRatio: params.imageRatio,
      aiAppendDescription: params.aiAppendDescription,
      promptTemplateVersion: params.promptTemplateVersion,
    },
  }
}

/** demo 模式（IMAGE_API_DEMO=1）：返回占位图，不触上游（PRD §21.5 统一后端演示模式）。 */
async function runGarmentDetailDemo(
  options: RunGarmentDetailPipelineOptions,
  shots: GarmentDetailShot[],
): Promise<ResultAsset[]> {
  const results: ResultAsset[] = []
  for (const [index, shot] of shots.entries()) {
    if (options.signal?.aborted) throw new Error('任务已取消')
    options.onShotProgress?.(shot.shotId, '正在生成细节图（演示模式）')
    await new Promise((resolve) => setTimeout(resolve, 800))
    if (options.signal?.aborted) throw new Error('任务已取消')
    const url = DEMO_RESULT_URLS[index % DEMO_RESULT_URLS.length]
    const prompt = buildGarmentDetailPrompt(
      shot,
      options.params,
      Boolean(shot.referenceAssetId),
    )
    const result = enrichGarmentDetailResult(
      { assetId: '', url, downloadUrl: url, width: 900, height: 1200 },
      shot,
      prompt,
      options,
    )
    if (options.onShotResult) await options.onShotResult(result)
    results.push(result)
  }
  return results
}

async function runOneGarmentDetailShot(
  options: RunGarmentDetailPipelineOptions,
  shot: GarmentDetailShot,
  context: {
    providerChain: ImageProvider[]
    runImageEdit: (input: ProviderImageEditInput) => Promise<ResultAsset[]>
  },
): Promise<GarmentDetailShotRunResult> {
  const { params, taskId } = options
  const startedAt = Date.now()
  const logBase = {
    taskId,
    shotId: shot.shotId,
    category: params.category,
    algorithmModelId: params.algorithmModelId,
    resolvedModelId: params.resolvedModelId,
    resolution: params.resolution,
    referenceCount: params.referenceImageCount,
  }

  options.onShotProgress?.(shot.shotId, '正在生成细节图')
  logGarmentDetailEvent('garment_detail.shot.start', logBase)

  const hasReference = Boolean(shot.referenceAssetId)
  const referenceImage = shot.referenceAssetId
    ? options.referenceImages[shot.referenceAssetId]
    : undefined
  if (shot.referenceAssetId && !referenceImage) {
    logGarmentDetailEvent('garment_detail.shot.failed', {
      ...logBase,
      durationMs: Date.now() - startedAt,
      errorCategory: 'missing_reference',
    })
    return {
      shot,
      error: '该输出位绑定的参考图已丢失',
      errorCategory: 'missing_reference',
    }
  }

  // 每个输出位只使用：服装主图 + 当前输出位对应的单张参考图（PRD §5.2）。
  const prompt = buildGarmentDetailPrompt(shot, params, hasReference)
  const inputImages = referenceImage
    ? [options.mainImage, referenceImage]
    : [options.mainImage]
  const inputImageLabels = referenceImage
    ? [
        '图1：商品原图（唯一商品事实来源）',
        '图2：局部镜头/构图/光线/景深/背景参考（禁止复制其中商品）',
      ]
    : ['图1：商品原图（唯一商品事实来源）']

  let lastError: unknown
  for (let index = 0; index < context.providerChain.length; index += 1) {
    const provider = context.providerChain[index]
    if (options.signal?.aborted) {
      return { shot, error: '任务已取消', errorCategory: 'cancelled' }
    }
    try {
      const single = await context.runImageEdit({
        userId: options.userId,
        taskId,
        provider,
        fallbackApiKey: provider.apiKey,
        model: params.resolvedModelId ?? '',
        prompt,
        inputImages,
        inputImageLabels,
        count: 1,
        aspectRatio: params.imageRatio,
        imageSize: params.resolution.toUpperCase(),
        traceId: `${taskId}_${shot.shotId}`,
        shotId: shot.shotId,
        signal: options.signal,
      })

      const first = single[0]
      if (!first) {
        // NO_IMAGE_RESULT（PRD §16）：换同模型下一个渠道再试。
        lastError = new Error('上游未返回有效图片')
        continue
      }

      const enriched = enrichGarmentDetailResult(first, shot, prompt, options)
      if (options.onShotResult) {
        try {
          await options.onShotResult(enriched)
        } catch (persistError) {
          const message =
            persistError instanceof Error ? persistError.message : '未知错误'
          logGarmentDetailEvent('garment_detail.shot.failed', {
            ...logBase,
            providerId: provider.id,
            durationMs: Date.now() - startedAt,
            errorCategory: 'persist_failed',
          })
          return {
            shot,
            error: `细节图归档失败：${message}`,
            errorCategory: 'persist_failed',
            providerId: provider.id,
          }
        }
      }

      logGarmentDetailEvent('garment_detail.shot.success', {
        ...logBase,
        providerId: provider.id,
        durationMs: Date.now() - startedAt,
      })
      return { shot, result: enriched, providerId: provider.id }
    } catch (error) {
      lastError = error
      if (options.signal?.aborted) {
        return { shot, error: '任务已取消', errorCategory: 'cancelled' }
      }
      const nextProvider = context.providerChain[index + 1]
      if (nextProvider) {
        logGarmentDetailEvent('garment_detail.shot.failover', {
          ...logBase,
          failedProviderId: provider.id,
          failoverProviderId: nextProvider.id,
          errorCategory: readErrorCategory(error) ?? null,
        })
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : '未知错误'
  logGarmentDetailEvent('garment_detail.shot.failed', {
    ...logBase,
    durationMs: Date.now() - startedAt,
    errorCategory: readErrorCategory(lastError) ?? null,
  })
  return { shot, error: message, errorCategory: readErrorCategory(lastError) }
}

/**
 * garment-detail 生成管线（PRD §11）。
 *
 * - 模型固定 params.resolvedModelId（任务快照），provider chain 内 per-shot
 *   failover（同模型多渠道），不跨模型切换（PRD §6.3.7）；
 * - worker-pool 并发（GARMENT_DETAIL_CONCURRENCY，默认 2），不允许无上限 Promise.all；
 * - 单 shot 失败不中断其他 shot；全部失败时抛聚合错误；
 * - signal 透传取消，每 shot 启动前检查；
 * - IMAGE_API_DEMO=1 时返回占位图，不触上游。
 */
export async function runGarmentDetailPipeline(
  options: RunGarmentDetailPipelineOptions,
  dependencies: GarmentDetailPipelineDependencies = {},
): Promise<ResultAsset[]> {
  const { params, taskId } = options
  if (!options.mainImage) {
    throw new Error('高清放大细节图缺少服装主图')
  }

  const targetSet =
    options.targetShotIds && options.targetShotIds.length > 0
      ? new Set(options.targetShotIds)
      : null
  const shots = targetSet
    ? params.detailShots.filter((shot) => targetSet.has(shot.shotId))
    : params.detailShots
  if (!shots.length) {
    throw new Error('高清放大细节图 targetShotIds 与 detailShots 不匹配')
  }

  if (process.env.IMAGE_API_DEMO === '1') {
    return runGarmentDetailDemo(options, shots)
  }

  const resolvedModelId = params.resolvedModelId?.trim()
  if (!resolvedModelId) {
    throw new Error('任务缺少真实模型快照（resolvedModelId），无法生成细节图')
  }

  const getProviderChain =
    dependencies.getProviderChain ??
    (await import('./image-provider-pool')).getRotatedProvidersForModel
  const runImageEdit =
    dependencies.runImageEdit ??
    (await import('./provider-image-router')).runImageEditViaProvider

  const providerChain = getProviderChain(resolvedModelId)
  if (!providerChain.length) {
    throw new GarmentDetailParamsError({
      code: 'MODEL_UNAVAILABLE',
      message: `没有可用的生图渠道支持模型 ${resolvedModelId}，请稍后重试`,
      retryable: true,
    })
  }

  const concurrency = readConcurrency(shots.length)
  const shotResults: (GarmentDetailShotRunResult | undefined)[] = new Array(
    shots.length,
  )
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= shots.length) return
      if (options.signal?.aborted) return
      shotResults[currentIndex] = await runOneGarmentDetailShot(
        options,
        shots[currentIndex],
        { providerChain, runImageEdit },
      )
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const succeeded = shotResults
    .filter(
      (entry): entry is GarmentDetailShotRunResult & { result: ResultAsset } =>
        Boolean(entry?.result),
    )
    .map((entry) => entry.result)
  const failedCount = shotResults.filter((entry) => entry?.error).length

  if (!succeeded.length) {
    const firstError = shotResults.find((entry) => entry?.error)?.error
    throw new Error(
      firstError ? `高清细节图全部生成失败：${firstError}` : '高清细节图全部生成失败',
    )
  }

  if (failedCount > 0) {
    logGarmentDetailEvent('garment_detail.task.partial', {
      taskId,
      successCount: succeeded.length,
      failedCount,
      resolvedModelId,
    })
  }

  return succeeded
}
