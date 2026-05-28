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
import {
  getAvailableProvidersForModel,
  getNoAvailableProviderMessage,
  type ImageProvider,
} from './image-provider-pool'
import { logImageEvent } from './log'
import { runPhotoFissionPipeline } from './photo-fission-service'
import { runImageEditViaProvider } from './provider-image-router'

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

const demoMode = process.env.IMAGE_API_DEMO === '1'

// 默认主链路：全部走 Provider Pool（七牛优先、即梦/Google 按模型兼容兜底）。
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

  return runGoogleProviderEdits(input)
}

async function runGoogleProviderEdits(input: ThirdPartyWorkflowInput) {
  const prompt = buildPrompt(input.featureType, input.params)
  const count = getGenerateCount(input.params)
  const { aspectRatio, imageSize } = extractGoogleImageOptions(input.params)
  // AI 服装大片支持按任务覆盖模型；其他模块走 env 默认。
  const taskModel =
    input.featureType === 'ai-fashion-photo'
      ? (input.params as AiFashionPhotoParams).model
      : undefined

  // v6：单图/元素类任务固定走「七牛优先，Google 官方兜底」。
  // fission 类任务仍由各自 pipeline 做多 provider 分发和 per-shot failover。
  const modelToUse = taskModel ?? googleImageModel
  const providerChain = buildSingleImageProviderChain(modelToUse)
  if (!providerChain.length) {
    throw new Error(getNoAvailableProviderMessage(modelToUse))
  }

  logImageEvent(
    'pool.dispatch',
    { traceId: input.taskId, taskId: input.taskId },
    {
      stage: input.featureType,
      strategy: 'qiniu-first-google-fallback',
      providers: providerChain.map((item) => item.id),
    },
  )

  let lastError: unknown
  for (let index = 0; index < providerChain.length; index += 1) {
    const candidate = providerChain[index]
    try {
      return await runImageEditViaProvider({
        taskId: input.taskId,
        provider: candidate,
        fallbackApiKey: googleApiKey,
        model: modelToUse,
        prompt,
        inputImages: input.inputImages,
        count,
        aspectRatio,
        imageSize,
        traceId: input.taskId,
      })
    } catch (error) {
      lastError = error
      const nextProvider = providerChain[index + 1]
      if (nextProvider) {
        logImageEvent(
          'pool.failover',
          { traceId: input.taskId, taskId: input.taskId },
          {
            failedProviderId: candidate.id,
            failoverProviderId: nextProvider.id,
            reason: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('所有生图渠道均调用失败')
}

function buildSingleImageProviderChain(model: string): ImageProvider[] {
  const providers = getAvailableProvidersForModel(model)
  const qiniuProviders = providers.filter((item) => item.type === 'qiniu')
  const googleProviders = providers.filter((item) => item.type === 'google')
  return [...qiniuProviders, ...googleProviders]
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

function getLabel<T extends string>(
  options: readonly { id: T; label: string }[],
  id: T,
) {
  return options.find((option) => option.id === id)?.label ?? id
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
