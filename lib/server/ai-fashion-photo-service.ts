import {
  FASHION_IMAGE_RATIOS,
  FASHION_MODELS,
  FASHION_RESOLUTIONS,
  type AiFashionPhotoParams,
  type FashionImageRatio,
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

export function isOfficialFashionModelId(assetId: string) {
  return FASHION_MODELS.some((model) => model.id === assetId)
}

export function getOfficialFashionModelUrl(assetId: string) {
  return FASHION_MODELS.find((model) => model.id === assetId)?.previewUrl ?? null
}

export function normalizeAiFashionPhotoParams(
  params: unknown,
  inputAssetCount: number,
): AiFashionPhotoParams {
  if (!isRecord(params)) {
    throw new Error('AI服装大片参数格式错误')
  }

  const prompt = readString(params.prompt, '请输入提示词')
  const referenceImageCount = readReferenceImageCount(params.referenceImageCount)
  const imageRatio = readFashionImageRatio(params.imageRatio)
  const resolution = readFashionResolution(params.resolution)
  const officialModelId = readOptionalString(params.officialModelId)
  const officialModelName = readOptionalString(params.officialModelName)

  if (referenceImageCount !== inputAssetCount) {
    throw new Error('AI服装大片参考图数量与素材数量不一致')
  }

  if (officialModelId && !FASHION_MODELS.some((model) => model.id === officialModelId)) {
    throw new Error('模特素材不存在')
  }

  return {
    prompt,
    referenceImageCount,
    officialModelId,
    officialModelName,
    imageRatio,
    resolution,
    resultCount: 1,
    creditsCost: fashionPhotoCreditsCost,
  }
}

export function buildAiFashionPhotoPrompt(params: AiFashionPhotoParams) {
  return [
    '你是一名专业服装电商摄影师，请基于上传参考图生成真实高级的AI服装大片。',
    params.officialModelName
      ? `第一张参考图是用户从我的模特库选择的模特素材：${params.officialModelName}。请参考该人物的脸部气质、发型、肤色、身材比例和镜头表现。`
      : '上传图片均为用户参考图，请综合参考画面中的服装、人物、动作、构图和拍摄氛围。',
    params.officialModelName
      ? '除第一张模特素材外，其余参考图只用于参考服装、动作、构图、光线或氛围，不要把其他参考图中的人物脸部错误迁移到最终结果。'
      : '',
    `用户提示词：${params.prompt}。`,
    `画面比例：${params.imageRatio}。`,
    `分辨率档位：${params.resolution}。`,
    '服装要求：严格保留参考图中用户指定服装的款式、颜色、版型、材质、图案、印花、Logo、纽扣、口袋、领口、袖口、裤脚等关键细节；不要改变服装颜色，不要新增或删除图案，不要改变服装结构。',
    '摄影要求：真实摄影质感，高清晰度，柔和自然光线，服装主体清晰，背景干净，构图适合电商主图和详情页展示，画面高级、自然、可信。',
    '禁止项：不要生成文字、水印、错误Logo、畸形手指、异常肢体、扭曲五官、错误服装结构、低清晰度图片、卡通插画或过度美颜效果。',
  ].filter(Boolean).join('\n')
}

export function createAiFashionPhotoReferenceSheet(
  images: string[],
  params: AiFashionPhotoParams,
) {
  const columns = Math.min(5, Math.max(1, images.length))
  const rows = Math.ceil(images.length / columns)
  const cellWidth = 300
  const cellHeight = 360
  const labelHeight = 42
  const gap = 18
  const padding = 36
  const width = columns * cellWidth + (columns - 1) * gap + padding * 2
  const height = rows * (cellHeight + labelHeight) + (rows - 1) * gap + padding * 2

  const cells = images.map((image, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = padding + column * (cellWidth + gap)
    const y = padding + row * (cellHeight + labelHeight + gap)
    const label = getReferenceLabel(index, params)

    return [
      `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight + labelHeight}" rx="12" fill="#ffffff" stroke="#dddddd"/>`,
      `<image href="${escapeXml(image)}" x="${x + 10}" y="${y + 10}" width="${cellWidth - 20}" height="${cellHeight - 20}" preserveAspectRatio="xMidYMid meet"/>`,
      `<text x="${x + cellWidth / 2}" y="${y + cellHeight + 27}" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#111111">${escapeXml(label)}</text>`,
    ].join('')
  })

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#f7f7f7"/>',
    ...cells,
    '</svg>',
  ].join('')

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function getReferenceLabel(index: number, params: AiFashionPhotoParams) {
  if (index === 0 && params.officialModelName) {
    return `我的模特：${params.officialModelName}`
  }

  return `参考图 ${params.officialModelName ? index : index + 1}`
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

function readString(value: unknown, errorMessage: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  throw new Error(errorMessage)
}

function readOptionalString(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
