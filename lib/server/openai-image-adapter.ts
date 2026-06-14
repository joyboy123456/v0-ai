/**
 * OpenAI Images API 格式通用 Adapter。
 *
 * 本文件实现了 OpenAI Images API 标准接口的封装，可被多个渠道复用：
 * 1. 老张 API OpenAI 兼容接口
 * 2. 老张 API（GPT/SeeDream 模型）
 * 3. 其他任何遵循 OpenAI Images API 格式的服务商
 *
 * 接口规范：
 * - 文生图端点: POST /v1/images/generations
 * - 图生图端点: POST /v1/images/edits
 * - 鉴权: Authorization: Bearer <API_KEY>
 * - 请求格式: { model, prompt, image?, size?, quality?, ... }
 * - 响应格式: { data: [{ b64_json }], output_format, usage }
 *
 * 支持的模型系列：
 * - gemini-* (Gemini 系列，走 Google 格式的老张 API端点)
 * - gpt-image-* / openai/gpt-image-* (GPT Image 系列)
 * - seedream-* / doubao-* (SeeDream 系列)
 *
 * 注意：
 * - 不支持 `n` 参数，每次调用只生成 1 张，count > 1 时串行循环
 * - image_config.aspect_ratio 支持 1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 4:5 / 5:4 / 9:16 / 16:9 / 21:9
 * - image_config.image_size 支持 1K / 2K / 4K
 *
 * 错误分类复用 GoogleImageError 体系，便于 retry / throttle / failover 统一处理。
 */

import type { ResultAsset } from '@/lib/types'
import {
  GoogleImageError,
  callGoogleImageWithRetry,
  parseRetryAfter,
} from './google-image-retry'
import { resolveImageSize } from './image-size-policy'
import { logImageEvent, type LogContext } from './log'

const OPENAI_GEMINI_DEFAULT_BASE_URL = 'https://api.qnaigc.com'
const OPENAI_GPT_DEFAULT_BASE_URL = 'https://openai.openai.com'
const OPENAI_DEFAULT_MODEL = 'gemini-3.0-pro-image-preview'
const GOOGLE_GEMINI_PRO_IMAGE_MODEL = 'gemini-3-pro-image-preview'
const OPENAI_GENERATIONS_PATH = '/v1/images/generations'
const OPENAI_EDITS_PATH = '/v1/images/edits'

type OpenAIModelFamily = 'gemini' | 'gpt'

interface ResolvedOpenAIModel {
  id: string
  family: OpenAIModelFamily
}

export interface OpenAIEditInput {
  taskId: string
  apiKey: string
  /** 老张 API API base URL（默认 https://api.qnaigc.com） */
  baseUrl?: string
  model: string
  timeoutMs: number
  prompt: string
  /** 输入图片（data URL 数组）；非空时自动进入图生图模式 */
  inputImages: string[]
  /** 要生成的图片数量（老张 API不支持 n 参数，会串行调用） */
  count: number
  /** 可选宽高比（如 "1:1"、"3:4"） */
  aspectRatio?: string
  /** 可选图片尺寸（如 "1K"、"2K"、"4K"） */
  imageSize?: string
  traceId?: string
  shotId?: string
  /** provider 唯一标识，用于令牌桶隔离 */
  providerId?: string
  /** 同一 API Key 的多个 provider 共享节流桶 */
  rateLimitKey?: string
  /** 该 provider 的 IPM 上限 */
  maxIpm?: number
  /** 该 provider 的 RPM 上限 */
  maxRpm?: number
}

interface OpenAIImageItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

interface OpenAIImageResponse {
  created?: number
  data?: OpenAIImageItem[]
  output_format?: string
  usage?: {
    total_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
  error?: {
    message?: string
    type?: string
    code?: string
  }
}

/**
 * 通过老张 API images 接口生成图片。
 *
 * inputImages 非空时自动作为 image 字段传入（图生图模式）；
 * 空数组时走纯文生图。
 *
 * count > 1 时串行循环调用（老张 API不支持批量 n 参数）。
 */
export async function runOpenAIImageEdit(input: OpenAIEditInput): Promise<ResultAsset[]> {
  if (!input.apiKey) {
    throw new GoogleImageError({
      category: 'auth_failed',
      message: '老张 API API Key 未配置',
      retryable: false,
    })
  }

  const resolvedModel = resolveOpenAIModel(input.model || OPENAI_DEFAULT_MODEL)
  const baseUrl = (
    input.baseUrl || resolveOpenAIDefaultBaseUrl(resolvedModel)
  ).replace(/\/+$/, '')
  const model = resolvedModel.id

  // SeeDream 模型始终使用 /v1/images/generations 端点
  // 图改图通过 image 参数区分，不使用 /edits 端点
  const isSeedreamModel = model.startsWith('seedream-')
  const endpointPath = isSeedreamModel
    ? OPENAI_GENERATIONS_PATH  // SeeDream: 始终用 generations
    : (input.inputImages.length > 0 ? OPENAI_EDITS_PATH : OPENAI_GENERATIONS_PATH)

  const traceId = input.traceId ?? input.taskId
  const startedAt = Date.now()
  const results: ResultAsset[] = []

  console.log('[openai-adapter] 请求配置', {
    taskId: input.taskId,
    model,
    modelFamily: resolvedModel.family,
    baseUrl,
    fullUrl: `${baseUrl}${endpointPath}`,
    hasInputImages: input.inputImages.length > 0,
  })

  logImageEvent(
    'gimg.attempt',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'enter',
      adapter: 'openai',
      model,
      modelFamily: resolvedModel.family,
      count: input.count,
      promptLen: input.prompt.length,
      refs: input.inputImages.length,
      aspect: input.aspectRatio,
      size: input.imageSize,
    },
  )

  // 并发生成：提升速度（原先串行 4 个镜头需要 4 分钟，现在并发只需 1 分钟）
  const generateTasks = Array.from({ length: input.count }, (_, i) => {
    const iterTraceId = input.count > 1 ? `${traceId}_v${i + 1}` : traceId
    const ctx: LogContext = {
      traceId: iterTraceId,
      taskId: input.taskId,
      shotId: input.shotId,
    }

    return callGoogleImageWithRetry(
      async (attempt) => {
        const callStart = Date.now()
        logImageEvent('gimg.attempt', { ...ctx, attempt }, {
          adapter: 'openai',
          model,
          modelFamily: resolvedModel.family,
          iteration: i + 1,
          providerId: input.providerId,
        })

        const response = await fetchWithTimeout(
          `${baseUrl}${endpointPath}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify(buildOpenAIRequestBody(input, resolvedModel)),
          },
          input.timeoutMs,
        )

        const data = (await readJsonResponse(response)) as OpenAIImageResponse
        if (!response.ok) {
          throw buildOpenAIHttpError(response, data)
        }

        if (!data.data?.length) {
          throw new GoogleImageError({
            category: 'empty_output',
            message: '老张 API API 未返回结果图片',
            retryable: true,
          })
        }

        const usage = data.usage
        logImageEvent('gimg.success', { ...ctx, attempt }, {
          adapter: 'openai',
          tookMs: Date.now() - callStart,
          items: data.data.length,
          outputFormat: data.output_format,
          endpointPath,
          providerId: input.providerId,
          ...(usage ? {
            totalTokens: usage.total_tokens,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
          } : {}),
        })

        return data
      },
      ctx,
      {
        apiKey: input.apiKey,
        providerId: input.providerId,
        rateLimitKey: input.rateLimitKey,
        maxIpm: input.maxIpm,
        maxRpm: input.maxRpm,
      },
      {
        // 老张 API中转：server_error(502/503) / rate_limit(429) 第一次失败就交给上层
        // pool 切到下一个 provider，避免在同一个抽风渠道里重试 4 次浪费 30s+
        perCategoryMaxAttempts: {
          server_error: 1,
          rate_limit: 1,
        },
      },
    )
  })

  // 等待所有任务并发完成
  const allData = await Promise.all(generateTasks)

  // 收集所有结果
  for (const data of allData) {
    for (const item of data.data ?? []) {
      const url = item.url ?? toDataUrl(item.b64_json, data.output_format)
      if (!url) continue

      const index = results.length + 1
      results.push({
        assetId: `result_${input.taskId}_${index}`,
        url,
        downloadUrl: url,
        width: 0,
        height: 0,
      })
    }
  }

  if (!results.length) {
    throw new GoogleImageError({
      category: 'empty_output',
      message: '老张 API API 返回为空',
      retryable: true,
    })
  }

  logImageEvent(
    'gimg.success',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'done',
      adapter: 'openai',
      totalResults: results.length,
      totalTookMs: Date.now() - startedAt,
    },
  )

  return results
}

function resolveOpenAIModel(model: string): ResolvedOpenAIModel {
  const normalized = model.trim()
  const lower = normalized.toLowerCase()

  console.log('[openai-adapter] resolveOpenAIModel 被调用', {
    model,
    normalized,
    lower,
  })

  if (lower.startsWith('gemini-')) {
    return { id: normalized, family: 'gemini' }
  }

  if (lower.startsWith('openai/gpt-image-')) {
    return { id: normalized, family: 'gpt' }
  }

  if (lower.startsWith('gpt-image-')) {
    return { id: `openai/${normalized}`, family: 'gpt' }
  }

  // 支持 SeeDream 模型（老张 API 会调用此函数）
  if (lower.startsWith('seedream-') || lower.startsWith('doubao-')) {
    console.log('[openai-adapter] SeeDream 模型识别成功')
    return { id: normalized, family: 'gpt' }
  }

  console.error('[openai-adapter] 不支持的模型', { model, lower })
  throw new GoogleImageError({
    category: 'bad_request',
    message: `不支持的图像模型：${model}（支持 gemini-*/gpt-image-*/seedream-*/doubao-*）`,
    retryable: false,
  })
}

function resolveOpenAIDefaultBaseUrl(model: ResolvedOpenAIModel): string {
  return model.family === 'gpt'
    ? OPENAI_GPT_DEFAULT_BASE_URL
    : OPENAI_GEMINI_DEFAULT_BASE_URL
}

function buildOpenAIRequestBody(
  input: OpenAIEditInput,
  model: ResolvedOpenAIModel,
): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model: model.id,
    prompt: input.prompt,
  }

  if (input.inputImages.length > 0) {
    requestBody.image =
      model.family === 'gpt'
        ? input.inputImages
        : input.inputImages.length === 1
          ? input.inputImages[0]
          : input.inputImages
  }

  if (model.family === 'gpt') {
    requestBody.size = resolveOpenAIGptSize(input.aspectRatio, input.imageSize)
    requestBody.quality = resolveOpenAIGptQuality(input.imageSize)
    return requestBody
  }

  const imageConfig: Record<string, string> = {}
  if (input.aspectRatio) {
    imageConfig.aspect_ratio = input.aspectRatio
  }
  if (input.imageSize) {
    imageConfig.image_size = input.imageSize
  }
  if (Object.keys(imageConfig).length > 0) {
    requestBody.image_config = imageConfig
  }

  return requestBody
}

function resolveOpenAIGptQuality(imageSize: string | undefined): string {
  const override = process.env.OPENAI_GPT_IMAGE_QUALITY?.trim().toLowerCase()
  if (
    override === 'low' ||
    override === 'medium' ||
    override === 'high' ||
    override === 'auto'
  ) {
    return override
  }

  switch ((imageSize ?? '').toUpperCase()) {
    case '4K':
      return 'high'
    case '2K':
      return 'medium'
    default:
      return 'low'
  }
}

function resolveOpenAIGptSize(
  aspectRatio: string | undefined,
  imageSize: string | undefined,
): string {
  const size = (imageSize ?? '').toUpperCase()

  if (size === '4K') {
    return resolveImageSize(aspectRatio, '4K').size
  }

  if (size === '3K') {
    return resolveImageSize(aspectRatio, '3K').size
  }

  if (size === '2K') {
    return resolveImageSize(aspectRatio, '2K').size
  }

  return resolveImageSize(aspectRatio, '1K').size
}

function buildOpenAIHttpError(
  response: Response,
  data: OpenAIImageResponse,
): GoogleImageError {
  const status = response.status
  const upstreamMessage = data.error?.message ?? `HTTP ${status}`
  const errorCode = data.error?.code
  const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))

  if (status === 401 || status === 403 || errorCode === 'invalid_api_key') {
    return new GoogleImageError({
      category: 'auth_failed',
      message: `老张 API API 凭证异常（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryable: false,
    })
  }

  if (status === 429) {
    return new GoogleImageError({
      category: 'rate_limit',
      message: `老张 API API 限流（429）：${upstreamMessage}`,
      httpStatus: status,
      retryAfterSeconds,
      retryable: true,
    })
  }

  if (status >= 500 && status < 600) {
    return new GoogleImageError({
      category: 'server_error',
      message: `老张 API API 服务端错误（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryAfterSeconds,
      retryable: true,
    })
  }

  if (status === 400 || errorCode === 'invalid_parameters') {
    return new GoogleImageError({
      category: 'bad_request',
      message: `老张 API API 请求参数错误（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryable: false,
    })
  }

  return new GoogleImageError({
    category: 'bad_request',
    message: `老张 API API 调用失败（${status}）：${upstreamMessage}`,
    httpStatus: status,
    retryable: false,
  })
}

function toDataUrl(b64Json?: string, outputFormat?: string): string | null {
  if (!b64Json) return null
  if (b64Json.startsWith('data:')) return b64Json
  const mimeType = inferImageMimeFromBase64(b64Json) ?? getOpenAIOutputMime(outputFormat)
  return `data:${mimeType};base64,${b64Json}`
}

function getOpenAIOutputMime(outputFormat?: string): string {
  const normalized = outputFormat?.trim().toLowerCase()
  if (normalized === 'jpeg' || normalized === 'jpg') return 'image/jpeg'
  if (normalized === 'webp') return 'image/webp'
  if (normalized === 'png' || !normalized) return 'image/png'
  // 七牛 Gemini 文档标记默认 PNG；未知格式不降级成 JPEG，避免误存原图。
  return 'image/png'
}

function inferImageMimeFromBase64(b64Json: string): string | null {
  try {
    const buffer = Buffer.from(b64Json.slice(0, 64), 'base64')
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png'
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg'
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return 'image/webp'
    }
  } catch {
    return null
  }
  return null
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
    ) {
      const seconds = Math.round(timeoutMs / 1000)
      throw new GoogleImageError({
        category: 'network',
        message: `老张 API API 调用超时（${seconds}s 未返回）`,
        retryable: true,
        cause: error,
      })
    }

    throw new GoogleImageError({
      category: 'network',
      message: `老张 API API 网络请求失败：${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
      cause: error,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}
