import {
  ELEMENT_REPLACE_TYPES,
  type BackgroundReplaceParams,
  type FeatureType,
  type PhotoFissionParams,
  type ResultAsset,
  type TaskParams,
  type AiFashionPhotoParams,
} from '@/lib/types'
import {
  buildAiFashionPhotoPrompt,
} from './ai-fashion-photo-service'
import { runGoogleImageEdit } from './google-genai-adapter'
import { runPhotoFissionPipeline } from './photo-fission-service'

type RunnableFeature = FeatureType

interface ThirdPartyWorkflowInput {
  taskId: string
  featureType: RunnableFeature
  workflowId: string
  inputImages: string[]
  params: TaskParams
  /** 单 shot 成功后立刻回调（photo-fission 流式持久化使用，可选；其他 feature 不消费此字段） */
  onShotResult?: (result: ResultAsset) => Promise<void>
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

// 默认主链路：Google Gemini 3 系列（项目稳定生产路径）。
// 切回 Raycast 本地代理时设 IMAGE_API_PROVIDER=raycast。
const provider = (process.env.IMAGE_API_PROVIDER ?? 'google').toLowerCase()
const googleApiKey = process.env.GOOGLE_API_KEY ?? ''
const googleImageModel = process.env.GOOGLE_IMAGE_MODEL ?? 'gemini-3.1-flash-image-preview'
// 3 系列 + 2K/4K + 多图最坏情况下单图响应可达 5-8 分钟，默认 600s 留足缓冲。
// 任何短于 480s 的配置都极可能在 2K 以上画质 + 多图场景下超时。
const googleImageTimeoutMs = Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000)

const demoResults: Partial<Record<RunnableFeature, string[]>> = {
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
  // pose-fission 走 task-store 内的 runPoseFissionPipeline 直连分支，
  // 不再经过 runThirdPartyWorkflow（也不消费此 demoResults['pose-fission']）。
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

  if (input.featureType === 'photo-fission') {
    const count = input.inputImages.length
    if (count < 1 || count > 3) {
      throw new Error('服装大片裂变最多上传 1 张主图 + 正面/背面细节图共 3 张')
    }
  }

  // pose-fission 不再经过 runThirdPartyWorkflow：task-store 直接调
  // runPoseFissionPipeline 走流式持久化。这里仅在意外调用时给出明确报错。
  if (input.featureType === 'pose-fission') {
    throw new Error(
      'pose-fission 已迁移至 task-store 内的 runPoseFissionPipeline 直连路径，不应进入 runThirdPartyWorkflow',
    )
  }

  if (demoMode) {
    return runDemoWorkflow(input)
  }

  if (input.featureType === 'photo-fission') {
    return runPhotoFissionPipeline({
      taskId: input.taskId,
      inputImages: input.inputImages,
      params: input.params as PhotoFissionParams,
      apiKey: googleApiKey,
      timeoutMs: googleImageTimeoutMs,
      onShotResult: input.onShotResult,
    })
  }

  if (provider === 'google') {
    return runGoogleProviderEdits(input)
  }

  return runRaycastImageEdits(input)
}

async function runGoogleProviderEdits(input: ThirdPartyWorkflowInput) {
  const prompt = buildPrompt(input.featureType, input.params)
  const count = getGenerateCount(input.params)
  const { aspectRatio, imageSize } = extractGoogleImageOptions(input.params)
  // AI 服装大片支持按任务覆盖模型；其他模块走 env 默认。
  // 旧任务可能没有 model 字段，readFashionModel 已在 normalize 阶段降级到 DEFAULT_FASHION_MODEL，
  // 这里再做一次降级是为了兼容其他 featureType 走 Google 时直接落到 env。
  const taskModel =
    input.featureType === 'ai-fashion-photo'
      ? (input.params as AiFashionPhotoParams).model
      : undefined
  const modelToUse = taskModel ?? googleImageModel

  return runGoogleImageEdit({
    taskId: input.taskId,
    apiKey: googleApiKey,
    model: modelToUse,
    timeoutMs: googleImageTimeoutMs,
    prompt,
    inputImages: input.inputImages,
    count,
    aspectRatio,
    imageSize,
    // ai-fashion-photo 等单批次走 google：traceId 默认等于 taskId；
    // count > 1 时 adapter 内部会自动派生 ${taskId}_v${n}。
    traceId: input.taskId,
  })
}

function extractGoogleImageOptions(params: TaskParams) {
  // Map our internal params to Google's response_format.image options.
  // - aspect_ratio: pass through if it's a recognized ratio, drop "more" sentinel.
  // - image_size: convert "1k"/"2k"/"4k" → "1K"/"2K"/"4K" (Google requires uppercase K).
  const record = params as unknown as Record<string, unknown>
  const ratio = typeof record.imageRatio === 'string' ? record.imageRatio : undefined
  const aspectRatio = ratio && ratio !== 'more' ? ratio : undefined

  const resolution = typeof record.resolution === 'string' ? record.resolution : undefined
  const imageSize = resolution ? resolution.toUpperCase() : undefined

  return { aspectRatio, imageSize }
}

async function runRaycastImageEdits(input: ThirdPartyWorkflowInput) {
  await assertRaycastProxyReady()

  const prompt = buildPrompt(input.featureType, input.params)
  const count = getGenerateCount(input.params)
  const batches = splitCount(count, 4)
  const results: ResultAsset[] = []
  const startedAt = Date.now()
  console.log(
    `[image-api] task=${input.taskId} feature=${input.featureType} batches=${JSON.stringify(batches)} promptLen=${prompt.length} baseUrl=${raycastBaseUrl}`,
  )

  for (const batchSize of batches) {
    const batchStart = Date.now()
    const imagePayload = getInputImagePayload(input)
    console.log(
      `[image-api] task=${input.taskId} payload-shape=${describeImagePayload(imagePayload)}`,
    )

    const response = await fetchWithTimeout(`${raycastBaseUrl}/images/edits`, {
      method: 'POST',
      headers: getRaycastHeaders(),
      body: JSON.stringify({
        model: raycastImageModel,
        prompt,
        image: imagePayload,
        n: batchSize,
      }),
    }, raycastTimeoutMs)

    const data = (await readJsonResponse(response)) as RaycastImageResponse
    console.log(
      `[image-api] task=${input.taskId} batch n=${batchSize} status=${response.status} took=${Date.now() - batchStart}ms items=${data.data?.length ?? 0}`,
    )

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

  console.log(
    `[image-api] task=${input.taskId} done totalResults=${results.length} totalTook=${Date.now() - startedAt}ms`,
  )
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

  // pose-fission 已迁移至 runPoseFissionPipeline，不再经过本函数；
  // photo-fission 走 runPhotoFissionPipeline 自带 prompt 构建。

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

function getInputImagePayload(input: ThirdPartyWorkflowInput): string | string[] {
  if (input.featureType === 'ai-fashion-photo') {
    // Per multi-image edits guide v1.1.0, send images as an array directly.
    // The model treats each entry as Image 1 / Image 2 / ... matching the prompt.
    return input.inputImages
  }

  if (input.featureType === 'element-replace') {
    return createElementReplaceReferenceSheet(input.inputImages[0], input.inputImages[1])
  }

  // pose-fission 不进入 runRaycastImageEdits，无需在此处理多图拼板。

  return input.inputImages[0]
}

function describeImagePayload(payload: string | string[]) {
  const summarize = (s: string) => {
    if (s.startsWith('data:')) {
      const head = s.slice(0, 30)
      return `dataURL(len=${s.length}, head="${head}")`
    }
    if (s.startsWith('http://') || s.startsWith('https://')) {
      return `httpURL(len=${s.length}, head="${s.slice(0, 60)}")`
    }
    if (s.startsWith('/')) {
      return `RELATIVE_PATH("${s}")  ⚠ proxy can't fetch this`
    }
    return `unknown(len=${s.length}, head="${s.slice(0, 30)}")`
  }

  if (Array.isArray(payload)) {
    return `array(len=${payload.length}) [${payload.map(summarize).join(', ')}]`
  }
  return summarize(payload)
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
  if (!urls || !urls.length) {
    // pose-fission 不再走 runThirdPartyWorkflow（task-store 内直接调 runPoseFissionPipeline），
    // 其他 feature 若未来移到外部 demo 路径，也需要在 demoResults 中显式登记。
    throw new Error(`Demo 模式下未配置 ${input.featureType} 的占位结果`)
  }

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
