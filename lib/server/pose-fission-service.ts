import {
  POSE_CASES,
  POSE_IMAGE_RATIOS,
  POSE_RESOLUTIONS,
  type PoseCase,
  type PoseFissionParams,
  type PoseImageRatio,
  type PoseResolution,
} from '@/lib/types'

const poseFissionResultCount = 6
const poseFissionCreditsCost = 35

const poseImageRatioIds = new Set<PoseImageRatio>(
  POSE_IMAGE_RATIOS.map((option) => option.id),
)
const poseResolutionIds = new Set<PoseResolution>(
  POSE_RESOLUTIONS.map((option) => option.id),
)

export function listPoseCases(): PoseCase[] {
  return POSE_CASES
}

export function getPoseCase(caseId: string) {
  return POSE_CASES.find((poseCase) => poseCase.id === caseId) ?? null
}

export function getPoseFissionDemoUrls() {
  return POSE_CASES.map((poseCase) => poseCase.imageUrl)
}

export function normalizePoseFissionParams(
  params: unknown,
  inputAssetCount: number,
): PoseFissionParams {
  if (!isRecord(params)) {
    throw new Error('姿势裂变参数格式错误')
  }

  const poseCaseId = readString(params.poseCaseId, '请选择姿势案例')
  const poseCase = getPoseCase(poseCaseId)
  if (!poseCase) {
    throw new Error('姿势案例不存在')
  }

  const imageRatio = readPoseImageRatio(params.imageRatio)
  const resolution = readPoseResolution(params.resolution)
  const hasFrontDetail = readOptionalBoolean(params.hasFrontDetail, false, '正面细节图参数无效')
  const hasBackDetail = readOptionalBoolean(params.hasBackDetail, false, '背面细节图参数无效')
  const expectedAssetCount = 1 + Number(hasFrontDetail) + Number(hasBackDetail)

  if (inputAssetCount !== expectedAssetCount) {
    throw new Error('姿势裂变素材数量与细节图参数不一致')
  }

  return {
    version: 'advanced',
    poseCaseId: poseCase.id,
    poseName: poseCase.name,
    posePrompt: poseCase.prompt,
    hasFrontDetail,
    hasBackDetail,
    imageRatio,
    resolution,
    resultCount: poseFissionResultCount,
    creditsCost: poseFissionCreditsCost,
  }
}

export function buildPoseFissionPrompt(params: PoseFissionParams) {
  return [
    '基于上传的服装模特成片进行姿势裂变。',
    '第一张图是需要保持人物、服装和画面质感的主图，后续图片若存在则是产品正面或背面细节参考。',
    `目标姿势：${params.poseName}。`,
    params.posePrompt ? `姿势要求：${params.posePrompt}。` : '',
    params.hasFrontDetail ? '已提供产品正面细节图，请保持领口、面料、logo、图案等正面细节一致。' : '',
    params.hasBackDetail ? '已提供产品背面细节图，请在背面或侧后角度中保持背部结构一致。' : '',
    `画面比例：${params.imageRatio}。`,
    `分辨率档位：${params.resolution}。`,
    '要求：保持原图人物身份、脸部特征、发型、身材比例、服装颜色、版型、材质、图案和关键细节；只改变人物姿势和必要构图；生成电商主图质感，背景干净，主体清晰；避免手部畸形、服装扭曲、肢体异常、脸部崩坏、文字乱码和多余人物。',
  ].join('\n')
}

export function createPoseFissionReferenceSheet(
  images: string[],
  params: PoseFissionParams,
) {
  const [mainImage, ...detailImages] = images
  let detailIndex = 0
  const frontDetailImage = params.hasFrontDetail ? detailImages[detailIndex++] : undefined
  const backDetailImage = params.hasBackDetail ? detailImages[detailIndex] : undefined

  const detailCells = [
    frontDetailImage
      ? `<image href="${escapeXml(frontDetailImage)}" x="1080" y="120" width="440" height="300" preserveAspectRatio="xMidYMid meet"/>`
      : '<rect x="1080" y="120" width="440" height="300" rx="16" fill="#f3f3f3"/>',
    backDetailImage
      ? `<image href="${escapeXml(backDetailImage)}" x="1080" y="520" width="440" height="300" preserveAspectRatio="xMidYMid meet"/>`
      : '<rect x="1080" y="520" width="440" height="300" rx="16" fill="#f3f3f3"/>',
  ]

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">',
    '<rect width="1600" height="900" fill="#ffffff"/>',
    '<text x="520" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#111111">姿势裂变主图</text>',
    '<text x="1300" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#111111">产品细节参考</text>',
    `<image href="${escapeXml(mainImage)}" x="80" y="100" width="880" height="740" preserveAspectRatio="xMidYMid meet"/>`,
    ...detailCells,
    '<text x="1300" y="460" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#333333">正面细节</text>',
    '<text x="1300" y="860" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#333333">背面细节</text>',
    '<line x1="1010" y1="80" x2="1010" y2="860" stroke="#dddddd" stroke-width="4"/>',
    '</svg>',
  ].join('')

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function readPoseImageRatio(value: unknown): PoseImageRatio {
  if (typeof value === 'string' && poseImageRatioIds.has(value as PoseImageRatio)) {
    return value as PoseImageRatio
  }

  throw new Error('姿势裂变图片比例无效')
}

function readPoseResolution(value: unknown): PoseResolution {
  if (typeof value === 'string' && poseResolutionIds.has(value as PoseResolution)) {
    return value as PoseResolution
  }

  throw new Error('姿势裂变分辨率无效')
}

function readOptionalBoolean(value: unknown, fallback: boolean, errorMessage: string) {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value

  throw new Error(errorMessage)
}

function readString(value: unknown, errorMessage: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  throw new Error(errorMessage)
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
