import {
  DEFAULT_FASHION_MODEL,
  FASHION_IMAGE_RATIOS,
  FASHION_MODELS,
  FASHION_PROMPT_MODES,
  FASHION_RESOLUTIONS,
  type AiFashionPhotoParams,
  type FashionImageRatio,
  type FashionModelId,
  type FashionPromptMode,
  type FashionResolution,
} from '@/lib/types'

const fashionPhotoCreditsCost = 35
const maxFashionReferenceImages = 10

const fashionImageRatioIds = new Set<FashionImageRatio>(
  FASHION_IMAGE_RATIOS.map((option) => option.id),
)
const fashionResolutionIds = new Set<FashionResolution>(
  FASHION_RESOLUTIONS.map((option) => option.id),
)
const fashionPromptModeIds = new Set<FashionPromptMode>(
  FASHION_PROMPT_MODES.map((option) => option.id),
)
const fashionModelIds = new Set<FashionModelId>(
  FASHION_MODELS.map((option) => option.id),
)

export interface ComposeAiFashionPhotoPromptInput {
  userPrompt: string
  promptMode: FashionPromptMode
  referenceImageCount: number
  imageRatio?: FashionImageRatio
  resolution?: FashionResolution
}

/**
 * Pure composer for AI服装大片 prompts.
 *
 * - raw 模式：直接返回 userPrompt，不做任何包裹。
 * - enhanced 模式：保留 userPrompt 主体，仅前后补充服装保持 / 电商摄影 / 禁止项轻量护栏；
 *   不重写、不裁剪、不解释 userPrompt 的语义。
 */
export function composeAiFashionPhotoPrompt(
  input: ComposeAiFashionPhotoPromptInput,
): string {
  const userPrompt = input.userPrompt.trim()

  if (input.promptMode === 'raw') {
    return userPrompt
  }

  const referenceCount = Math.max(0, input.referenceImageCount | 0)
  const hasReferences = referenceCount > 0

  const imageRelation = hasReferences
    ? [
        '【图片关系说明】',
        `- 用户上传了 ${referenceCount} 张参考图，按上传顺序对应"图1 / 图2 / ..."。`,
        '- 产品图是服装来源，需要优先保持服装信息。',
        '- 如果上传了模特图，请参考模特的五官、发型、体型、气质和姿态。',
        '- 如果上传了参考图，参考图仅用于参考构图、动作、场景和氛围，不要复制参考图中的服装。',
      ].join('\n')
    : [
        '【图片关系说明】',
        '- 本次未提供参考图，请基于用户描述合成符合电商商拍要求的服装大片。',
      ].join('\n')

  const sections = [
    '【用户原始要求】',
    userPrompt || '（用户未提供描述，请按下方约束生成符合电商主图标准的服装大片。）',
    '',
    imageRelation,
    '',
    '【服装保持要求】',
    '严格保留产品图中的服装款式、颜色、版型、材质、图案、Logo、纽扣、口袋、领口、袖口、裤脚等关键细节。',
    '不要改变服装颜色。',
    '不要新增或删除服装图案。',
    '不要把服装变成其他款式。',
    '',
    '【电商摄影要求】',
    '生成真实高清服装电商摄影图片。',
    '画面需要适合电商主图、详情页或社媒种草使用。',
    '主体清晰，光线自然，背景干净，服装展示明确。',
  ]

  const meta: string[] = []
  if (input.imageRatio) meta.push(`画面比例：${input.imageRatio}`)
  if (input.resolution) meta.push(`分辨率档位：${input.resolution}`)
  if (meta.length) {
    sections.push('', `【输出参数】\n${meta.join('；')}。`)
  }

  sections.push(
    '',
    '【禁止项】',
    '不要生成文字、水印、品牌标识。',
    '不要生成畸形手指、异常肢体、扭曲五官、错误服装结构。',
    '不要生成低清晰度、卡通、插画、过度美颜或明显 AI 感图片。',
  )

  return sections.join('\n')
}

export function normalizeAiFashionPhotoParams(
  params: unknown,
  inputAssetCount: number,
): AiFashionPhotoParams {
  if (!isRecord(params)) {
    throw new Error('AI服装大片参数格式错误')
  }

  // 兼容两种入参：新格式（userPrompt）和旧格式（prompt）。
  const userPromptRaw = readOptionalString(params.userPrompt) ?? readOptionalString(params.prompt)
  if (!userPromptRaw) {
    throw new Error('请输入提示词')
  }
  const userPrompt = userPromptRaw.trim()

  const promptMode = readPromptMode(params.promptMode)
  const model = readFashionModel(params.model)
  const referenceImageCount = readReferenceImageCount(params.referenceImageCount)
  const imageRatio = readFashionImageRatio(params.imageRatio)
  const resolution = readFashionResolution(params.resolution)

  if (referenceImageCount !== inputAssetCount) {
    throw new Error('AI服装大片参考图数量与素材数量不一致')
  }

  const finalPrompt = composeAiFashionPhotoPrompt({
    userPrompt,
    promptMode,
    referenceImageCount,
    imageRatio,
    resolution,
  })

  // R6 输入预检：finalPrompt 字符长度上限 30000（Google API ~2 万-3 万软上限的安全线）
  if (finalPrompt.length > 30000) {
    throw new Error(
      `AI服装大片提示词过长（${finalPrompt.length} 字，上限 30000），请精简后重试`,
    )
  }

  return {
    prompt: userPrompt,
    userPrompt,
    finalPrompt,
    promptMode,
    model,
    referenceImageCount,
    imageRatio,
    resolution,
    resultCount: 1,
    creditsCost: fashionPhotoCreditsCost,
  }
}

/**
 * 模型实际使用的 prompt。优先使用 normalize 阶段生成的 finalPrompt，
 * 旧任务数据（只有 prompt 字段）则降级返回 prompt，保持向后兼容。
 */
export function buildAiFashionPhotoPrompt(params: AiFashionPhotoParams) {
  if (typeof params.finalPrompt === 'string' && params.finalPrompt.trim()) {
    return params.finalPrompt
  }
  return params.prompt
}

function readFashionImageRatio(value: unknown): FashionImageRatio {
  if (typeof value === 'string' && fashionImageRatioIds.has(value as FashionImageRatio)) {
    return value as FashionImageRatio
  }

  throw new Error('AI服装大片图片比例无效')
}

function readFashionResolution(value: unknown): FashionResolution {
  if (typeof value === 'string' && fashionResolutionIds.has(value as FashionResolution)) {
    return value as FashionResolution
  }

  throw new Error('AI服装大片分辨率无效')
}

function readReferenceImageCount(value: unknown) {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= maxFashionReferenceImages
  ) {
    return value
  }

  throw new Error('AI服装大片参考图数量无效')
}

function readPromptMode(value: unknown): FashionPromptMode {
  if (value === undefined || value === null || value === '') {
    return 'enhanced'
  }
  if (typeof value === 'string' && fashionPromptModeIds.has(value as FashionPromptMode)) {
    return value as FashionPromptMode
  }
  throw new Error('AI服装大片提示词模式无效')
}

/**
 * 旧任务或前端遗漏 model 字段时降级到默认 3.1 稳定版，避免阻塞生成。
 * 显式传入但不在白名单（含已下线的 2.5）→ 直接拒绝，防止脏配置打通。
 */
function readFashionModel(value: unknown): FashionModelId {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_FASHION_MODEL
  }
  if (typeof value === 'string' && fashionModelIds.has(value as FashionModelId)) {
    return value as FashionModelId
  }
  throw new Error('AI服装大片模型无效')
}

function readOptionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
