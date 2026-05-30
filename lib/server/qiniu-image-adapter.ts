/**
 * 七牛云 AI 大模型推理 — 图像生成 Adapter。
 *
 * 七牛云 OpenAI 兼容接口：
 * - Base URL: https://api.qnaigc.com
 * - 文生图端点: POST /v1/images/generations
 * - 图生图端点: POST /v1/images/edits
 * - 鉴权: Authorization: Bearer <API_KEY>
 * - Gemini: { model, prompt, image?, image_config? }
 * - GPT: { model: "openai/gpt-image-*", prompt, image?, size?, quality? }
 * - 响应: { data: [{ b64_json }], output_format, usage }
 *
 * 注意：
 * - 不支持 `n` 参数，每次调用只生成 1 张，count > 1 时串行循环
 * - 本项目只允许七牛侧 gemini-* 与 openai/gpt-image-* 图像模型
 * - image_config.aspect_ratio 支持 1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 4:5 / 5:4 / 9:16 / 16:9 / 21:9
 * - image_config.image_size 支持 1K / 2K / 4K
 * - 默认模型: gemini-3.0-pro-image-preview
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

const QINIU_DEFAULT_BASE_URL = 'https://api.qnaigc.com'
const QINIU_DEFAULT_MODEL = 'gemini-3.0-pro-image-preview'
const QINIU_GENERATIONS_PATH = '/v1/images/generations'
const QINIU_EDITS_PATH = '/v1/images/edits'

type QiniuModelFamily = 'gemini' | 'gpt'

interface ResolvedQiniuModel {
  id: string
  family: QiniuModelFamily
}

export interface QiniuEditInput {
  taskId: string
  apiKey: string
  /** 七牛云 API base URL（默认 https://api.qnaigc.com） */
  baseUrl?: string
  model: string
  timeoutMs: number
  prompt: string
  /** 输入图片（data URL 数组）；非空时自动进入图生图模式 */
  inputImages: string[]
  /** 要生成的图片数量（七牛云不支持 n 参数，会串行调用） */
  count: number
  /** 可选宽高比（如 "1:1"、"3:4"） */
  aspectRatio?: string
  /** 可选图片尺寸（如 "1K"、"2K"、"4K"） */
  imageSize?: string
  traceId?: string
  shotId?: string
  /** provider 唯一标识，用于令牌桶隔离 */
  providerId?: string
  /** 该 provider 的 IPM 上限 */
  maxIpm?: number
  /** 该 provider 的 RPM 上限 */
  maxRpm?: number
}

interface QiniuImageItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

interface QiniuImageResponse {
  created?: number
  data?: QiniuImageItem[]
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
 * 通过七牛云 images 接口生成图片。
 *
 * inputImages 非空时自动作为 image 字段传入（图生图模式）；
 * 空数组时走纯文生图。
 *
 * count > 1 时串行循环调用（七牛云不支持批量 n 参数）。
 */
export async function runQiniuImageEdit(input: QiniuEditInput): Promise<ResultAsset[]> {
  if (!input.apiKey) {
    throw new GoogleImageError({
      category: 'auth_failed',
      message: '七牛云 API Key 未配置',
      retryable: false,
    })
  }

  const baseUrl = (input.baseUrl || QINIU_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const resolvedModel = resolveQiniuModel(input.model || QINIU_DEFAULT_MODEL)
  const model = resolvedModel.id
  const endpointPath =
    input.inputImages.length > 0 ? QINIU_EDITS_PATH : QINIU_GENERATIONS_PATH
  const traceId = input.traceId ?? input.taskId
  const startedAt = Date.now()
  const results: ResultAsset[] = []

  logImageEvent(
    'gimg.attempt',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'enter',
      adapter: 'qiniu',
      model,
      modelFamily: resolvedModel.family,
      count: input.count,
      promptLen: input.prompt.length,
      refs: input.inputImages.length,
      aspect: input.aspectRatio,
      size: input.imageSize,
    },
  )

  // 串行循环：七牛云不支持 n 参数
  for (let i = 0; i < input.count; i++) {
    const iterTraceId = input.count > 1 ? `${traceId}_v${i + 1}` : traceId
    const ctx: LogContext = {
      traceId: iterTraceId,
      taskId: input.taskId,
      shotId: input.shotId,
    }

    const data = await callGoogleImageWithRetry(
      async (attempt) => {
        const callStart = Date.now()
        logImageEvent('gimg.attempt', { ...ctx, attempt }, {
          adapter: 'qiniu',
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
            body: JSON.stringify(buildQiniuRequestBody(input, resolvedModel)),
          },
          input.timeoutMs,
        )

        const data = (await readJsonResponse(response)) as QiniuImageResponse
        if (!response.ok) {
          throw buildQiniuHttpError(response, data)
        }

        if (!data.data?.length) {
          throw new GoogleImageError({
            category: 'empty_output',
            message: '七牛云 API 未返回结果图片',
            retryable: true,
          })
        }

        const usage = data.usage
        logImageEvent('gimg.success', { ...ctx, attempt }, {
          adapter: 'qiniu',
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
        maxIpm: input.maxIpm,
        maxRpm: input.maxRpm,
      },
      {
        // 七牛云中转：server_error(502/503) / rate_limit(429) 第一次失败就交给上层
        // pool 切到下一个 provider，避免在同一个抽风渠道里重试 4 次浪费 30s+
        perCategoryMaxAttempts: {
          server_error: 1,
          rate_limit: 1,
        },
      },
    )

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
      message: '七牛云 API 返回为空',
      retryable: true,
    })
  }

  logImageEvent(
    'gimg.success',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'done',
      adapter: 'qiniu',
      totalResults: results.length,
      totalTookMs: Date.now() - startedAt,
    },
  )

  return results
}

function resolveQiniuModel(model: string): ResolvedQiniuModel {
  const normalized = model.trim()
  const lower = normalized.toLowerCase()

  if (lower.startsWith('gemini-')) {
    return { id: normalized, family: 'gemini' }
  }

  if (lower.startsWith('openai/gpt-image-')) {
    return { id: normalized, family: 'gpt' }
  }

  if (lower.startsWith('gpt-image-')) {
    return { id: `openai/${normalized}`, family: 'gpt' }
  }

  throw new GoogleImageError({
    category: 'bad_request',
    message: `七牛云生图仅允许 gemini-* 或 openai/gpt-image-* 模型，当前模型：${model}`,
    retryable: false,
  })
}

function buildQiniuRequestBody(
  input: QiniuEditInput,
  model: ResolvedQiniuModel,
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
    requestBody.size = resolveQiniuGptSize(input.aspectRatio, input.imageSize)
    requestBody.quality = resolveQiniuGptQuality(input.imageSize)
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

function resolveQiniuGptQuality(imageSize: string | undefined): string {
  switch ((imageSize ?? '').toUpperCase()) {
    case '4K':
      return 'high'
    case '2K':
      return 'medium'
    default:
      return 'low'
  }
}

function resolveQiniuGptSize(
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

function buildQiniuHttpError(
  response: Response,
  data: QiniuImageResponse,
): GoogleImageError {
  const status = response.status
  const upstreamMessage = data.error?.message ?? `HTTP ${status}`
  const errorCode = data.error?.code
  const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))

  if (status === 401 || status === 403 || errorCode === 'invalid_api_key') {
    return new GoogleImageError({
      category: 'auth_failed',
      message: `七牛云 API 凭证异常（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryable: false,
    })
  }

  if (status === 429) {
    return new GoogleImageError({
      category: 'rate_limit',
      message: `七牛云 API 限流（429）：${upstreamMessage}`,
      httpStatus: status,
      retryAfterSeconds,
      retryable: true,
    })
  }

  if (status >= 500 && status < 600) {
    return new GoogleImageError({
      category: 'server_error',
      message: `七牛云 API 服务端错误（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryAfterSeconds,
      retryable: true,
    })
  }

  if (status === 400 || errorCode === 'invalid_parameters') {
    return new GoogleImageError({
      category: 'bad_request',
      message: `七牛云 API 请求参数错误（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryable: false,
    })
  }

  return new GoogleImageError({
    category: 'bad_request',
    message: `七牛云 API 调用失败（${status}）：${upstreamMessage}`,
    httpStatus: status,
    retryable: false,
  })
}

function toDataUrl(b64Json?: string, outputFormat?: string): string | null {
  if (!b64Json) return null
  if (b64Json.startsWith('data:')) return b64Json
  const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mimeType};base64,${b64Json}`
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
        message: `七牛云 API 调用超时（${seconds}s 未返回）`,
        retryable: true,
        cause: error,
      })
    }

    throw new GoogleImageError({
      category: 'network',
      message: `七牛云 API 网络请求失败：${error instanceof Error ? error.message : String(error)}`,
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
