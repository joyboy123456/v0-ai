import {
  ELEMENT_REPLACE_TYPES,
  PRODUCT_CATEGORIES,
  type BackgroundReplaceParams,
  type FeatureType,
  type PhotoFissionParams,
  type PoseFissionParams,
  type ResultAsset,
  type TaskParams,
  type AiFashionPhotoParams,
} from '@/lib/types'
import {
  buildAiFashionPhotoPrompt,
  createAiFashionPhotoReferenceSheet,
} from './ai-fashion-photo-service'
import {
  buildPoseFissionPrompt,
  createPoseFissionReferenceSheet,
  getPoseFissionDemoUrls,
} from './pose-fission-service'

type RunnableFeature = FeatureType

interface ThirdPartyWorkflowInput {
  taskId: string
  featureType: RunnableFeature
  workflowId: string
  inputImages: string[]
  params: TaskParams
}

interface RaycastImageItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

interface RaycastImageResponse {
  data?: RaycastImageItem[]
  error?: {
    message?: string
  }
}

const raycastBaseUrl = process.env.IMAGE_API_BASE_URL ?? 'http://127.0.0.1:11436/v1'
const raycastApiKey = process.env.IMAGE_API_KEY
const raycastImageModel = process.env.IMAGE_API_MODEL ?? 'gpt-image-2'
const raycastTimeoutMs = Number(process.env.IMAGE_API_TIMEOUT_MS ?? 120000)
const demoMode = process.env.IMAGE_API_DEMO === '1'

const demoResults: Record<RunnableFeature, string[]> = {
  'ai-fashion-photo': [
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1475180098004-ca77a66827be?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=900&h=1200&fit=crop',
  ],
  'element-replace': [
    'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=900&h=1200&fit=crop',
  ],
  'photo-fission': [
    'https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1495385794356-15371f348c31?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1506629905607-d9d297d20b6b?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1513094735237-8f2714d57c13?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1532453288672-3a27e9be9efd?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=900&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1520975954732-35dd22299614?w=900&h=1200&fit=crop',
  ],
  'pose-fission': getPoseFissionDemoUrls(),
}

export async function runThirdPartyWorkflow(
  input: ThirdPartyWorkflowInput,
): Promise<ResultAsset[]> {
  if (!input.inputImages.length) {
    throw new Error('缺少可用于图生图的输入图片')
  }

  if (input.featureType === 'ai-fashion-photo' && input.inputImages.length < 1) {
    throw new Error('AI服装大片需要至少上传一张参考图')
  }

  if (input.featureType === 'element-replace' && input.inputImages.length < 2) {
    throw new Error('元素替换需要同时上传原图和替换元素')
  }

  if (input.featureType === 'pose-fission' && input.inputImages.length < 1) {
    throw new Error('姿势裂变需要上传主图')
  }

  if (demoMode) {
    return runDemoWorkflow(input)
  }

  return runRaycastImageEdits(input)
}

async function runRaycastImageEdits(input: ThirdPartyWorkflowInput) {
  await assertRaycastProxyReady()

  const prompt = buildPrompt(input.featureType, input.params)
  const count = getGenerateCount(input.params)
  const batches = splitCount(count, 4)
  const results: ResultAsset[] = []

  for (const batchSize of batches) {
    const response = await fetchWithTimeout(`${raycastBaseUrl}/images/edits`, {
      method: 'POST',
      headers: getRaycastHeaders(),
      body: JSON.stringify({
        model: raycastImageModel,
        prompt,
        image: getInputImagePayload(input),
        n: batchSize,
        response_format: 'url',
      }),
    }, raycastTimeoutMs)

    const data = (await readJsonResponse(response)) as RaycastImageResponse

    if (!response.ok) {
      throw new Error(data.error?.message ?? `Raycast 生图 API 调用失败：${response.status}`)
    }

    if (!data.data?.length) {
      throw new Error('Raycast 生图 API 未返回结果图片')
    }

    for (const item of data.data) {
      const url = item.url ?? toDataUrl(item.b64_json)
      if (!url) continue

      const index = results.length + 1
      results.push({
        assetId: `result_${input.taskId}_${index}`,
        url,
        downloadUrl: url,
        width: 900,
        height: 1200,
      })
    }
  }

  if (!results.length) {
    throw new Error('Raycast 生图 API 返回为空')
  }

  return results
}

async function assertRaycastProxyReady() {
  if (process.env.IMAGE_API_SKIP_HEALTHCHECK === '1') return

  const healthUrl = new URL('/health', raycastBaseUrl).toString()
  let response: Response

  try {
    response = await fetchWithTimeout(healthUrl, {}, 5000)
  } catch (error) {
    throw new Error(
      `Raycast Local Proxy 不可用，请确认代理已启动：${error instanceof Error ? error.message : '连接失败'}`,
    )
  }

  if (!response.ok) {
    throw new Error(`Raycast Local Proxy 健康检查失败：${response.status}`)
  }
}

function getRaycastHeaders() {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (raycastApiKey) {
    headers.authorization = `Bearer ${raycastApiKey}`
  }

  return headers
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function readJsonResponse(response: Response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function buildPrompt(featureType: RunnableFeature, params: TaskParams) {
  if (featureType === 'ai-fashion-photo') {
    const aiParams = params as AiFashionPhotoParams
    return buildAiFashionPhotoPrompt(aiParams)
  }

  if (featureType === 'photo-fission') {
    const fissionParams = params as PhotoFissionParams
    const category = getLabel(PRODUCT_CATEGORIES, fissionParams.productCategory)

    return [
      '基于上传服装产品图生成多张电商模特展示图。',
      '第一张图是服装产品主图，后续图片若存在则是产品正面或背面细节参考。',
      `服装品类：${category}。`,
      fissionParams.hasFrontDetail ? '已提供产品正面细节图，请保持领口、面料、logo、图案等细节一致。' : '',
      fissionParams.hasBackDetail ? '已提供产品背面细节图，请在需要背面或侧后角度时保持背部结构一致。' : '',
      `画面比例：${fissionParams.imageRatio}。`,
      '要求：自动生成多张不同模特、不同姿势、不同景别或构图的服装展示图；服装颜色、版型、材质、图案和关键细节尽量保持一致；适合电商主图、详情页和投流素材；避免服装变形、手部畸形、脸部崩坏、文字乱码和背景抢主体。',
    ].join('\n')
  }

  if (featureType === 'pose-fission') {
    return buildPoseFissionPrompt(params as PoseFissionParams)
  }

  const replaceParams = params as BackgroundReplaceParams
  const elementType = getLabel(ELEMENT_REPLACE_TYPES, replaceParams.elementType)

  return [
    '基于上传的两张参考图进行服装大片元素替换。',
    '第一张图是原图，第二张图是替换元素参考。',
    `替换类型：${elementType}。`,
    replaceParams.prompt ? `用户提示词：${replaceParams.prompt}。` : '',
    `画面比例：${replaceParams.imageRatio}。`,
    '要求：只替换用户指定的元素，尽量保留原图中未被替换的主体、服装、人物姿势、构图和光影；替换元素要自然融合；避免无关区域变化、脸部崩坏、身体比例异常和文字乱码。',
  ].join('\n')
}

function getGenerateCount(params: TaskParams) {
  if ('resultCount' in params) return params.resultCount
  return 'generateCount' in params ? params.generateCount : 4
}

function getInputImagePayload(input: ThirdPartyWorkflowInput) {
  if (input.featureType === 'ai-fashion-photo') {
    return createAiFashionPhotoReferenceSheet(
      input.inputImages,
      input.params as AiFashionPhotoParams,
    )
  }

  if (input.featureType === 'element-replace') {
    return createElementReplaceReferenceSheet(input.inputImages[0], input.inputImages[1])
  }

  if (input.featureType === 'photo-fission' && input.inputImages.length > 1) {
    return createPhotoFissionReferenceSheet(input.inputImages)
  }

  if (input.featureType === 'pose-fission' && input.inputImages.length > 1) {
    return createPoseFissionReferenceSheet(
      input.inputImages,
      input.params as PoseFissionParams,
    )
  }

  return input.inputImages[0]
}

function createElementReplaceReferenceSheet(originalImage: string, replacementImage: string) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">',
    '<rect width="1600" height="900" fill="#ffffff"/>',
    '<text x="400" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#111111">原图</text>',
    '<text x="1200" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#111111">替换元素</text>',
    `<image href="${escapeXml(originalImage)}" x="60" y="90" width="680" height="760" preserveAspectRatio="xMidYMid meet"/>`,
    `<image href="${escapeXml(replacementImage)}" x="860" y="90" width="680" height="760" preserveAspectRatio="xMidYMid meet"/>`,
    '<line x1="800" y1="80" x2="800" y2="860" stroke="#dddddd" stroke-width="4"/>',
    '</svg>',
  ].join('')

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function createPhotoFissionReferenceSheet(images: string[]) {
  const [mainImage, frontDetailImage, backDetailImage] = images
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
    '<text x="520" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#111111">服装产品主图</text>',
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

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function splitCount(total: number, maxBatchSize: number) {
  const batches: number[] = []
  let remaining = total

  while (remaining > 0) {
    const size = Math.min(remaining, maxBatchSize)
    batches.push(size)
    remaining -= size
  }

  return batches
}

function getLabel<T extends string>(
  options: readonly { id: T; label: string }[],
  id: T,
) {
  return options.find((option) => option.id === id)?.label ?? id
}

function toDataUrl(b64Json?: string) {
  if (!b64Json) return null
  if (b64Json.startsWith('data:')) return b64Json
  return `data:image/png;base64,${b64Json}`
}

async function runDemoWorkflow(input: ThirdPartyWorkflowInput) {
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const count = getGenerateCount(input.params)
  const urls = demoResults[input.featureType]

  return Array.from({ length: count }, (_, index) => {
    const url = urls[index % urls.length]

    return {
      assetId: `result_${input.taskId}_${index + 1}`,
      url,
      downloadUrl: url,
      width: 900,
      height: 1200,
    }
  })
}
