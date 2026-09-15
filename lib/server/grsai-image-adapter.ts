/**
 * Grsai 图像生成 Adapter（原生 /v1/api/generate 接口）。
 *
 * Grsai 是独立的图像生成服务商，提供统一的 /v1/api/generate 端点，
 * 支持 Nano Banana 全系列模型。接口规范（来自 grsai 官方 Apifox 文档）：
 *
 * - 端点: POST {baseUrl}/v1/api/generate
 * - 鉴权: Authorization: Bearer <API_KEY>
 * - 请求: { model, prompt, images?, aspectRatio?, imageSize?, replyType? }
 * - 响应: { id, status, results: [{url}], progress, error }
 *   - status: running | succeeded | violation | failed
 *
 * 节点：
 * - 海外: https://grsaiapi.com
 * - 国内直连: https://grsai.dakka.com.cn（阿里云国内 ECS 默认走此节点）
 *
 * 支持的模型（按价格从低到高）：
 * - nano-banana-2-lite / nano-banana-fast: ￥0.022~0.044/张（默认 1K）
 * - nano-banana-2: ￥0.06~0.12/张（1K/2K/4K）
 * - nano-banana-pro: ￥0.09~0.18/张（1K/2K/4K）
 * - nano-banana-2-cl / nano-banana-pro-vip / nano-banana-pro-4k-vip 等高阶型号
 * - gpt-image-2.5-sunburst（及 -flare / 普通版）: ￥0.15/张（1K/2K/4K），
 *   注意其 aspectRatio 不接受 '1:1' 等比例字符串，必须像素值（见 resolveGrsaiGptImageAspectRatio）
 *
 * 注意：
 * - 单次请求只生成 1 张图（results 通常单元素），count > 1 时并发循环
 * - images 支持 base64 与 url 链接，可直接透传项目的 data URL / https URL
 * - aspectRatio 支持 auto/1:1/16:9/9:16/4:3/3:4/3:2/2:3/5:4/4:5/21:9
 *   （nano-banana-2 系列额外支持 1:4/4:1/1:8/8:1）
 *
 * 错误分类复用 GoogleImageError 体系，便于 retry / throttle / failover 统一处理。
 */

import type { ResultAsset } from '@/lib/types'
import {
  GoogleImageError,
  callGoogleImageWithRetry,
  parseRetryAfter,
} from './google-image-retry'
import { logImageEvent, type LogContext } from './log'

/** 国内直连节点（阿里云国内 ECS 默认） */
const GRSAI_DEFAULT_BASE_URL = 'https://grsai.dakka.com.cn'
const GRSAI_GENERATE_PATH = '/v1/api/generate'

/**
 * 默认只在标注了 1K/2K/4K 的模型上透传 imageSize。
 * nano-banana-2-lite / nano-banana-fast 官方未标分辨率，传 2K/4K 可能报错，
 * 这里对 lite/fast 只允许 1K，其它值丢弃。
 */
const RESOLUTION_AWARE_MODEL_PATTERNS = ['nano-banana-2', 'nano-banana-pro']

export interface GrsaiEditInput {
  userId: string
  taskId: string
  /** Grsai API Key（sk-xxx 格式） */
  apiKey: string
  /** API base URL（默认国内直连 https://grsai.dakka.com.cn） */
  baseUrl?: string
  model: string
  timeoutMs: number
  prompt: string
  /** 输入图片（data URL 或 https URL 数组）；非空时作为参考图传入 */
  inputImages: string[]
  /** 要生成的图片数量（单次只出 1 张，count > 1 时并发循环） */
  count: number
  /** 可选宽高比（如 "1:1"、"3:4"、"auto"） */
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
  signal?: AbortSignal
  onRetryAttempt?: (attempt: number) => void
}

interface GrsaiResultItem {
  url?: string
}

interface GrsaiGenerateResponse {
  id?: string
  status?: string
  results?: GrsaiResultItem[]
  progress?: number
  error?: string
}

/**
 * 通过 Grsai /v1/api/generate 接口生成图片。
 *
 * inputImages 非空时作为 images 字段传入（图生图 / 参考图模式）；
 * 空数组时走纯文生图。
 *
 * count > 1 时并发循环调用（Grsai 单次只出 1 张）。
 */
export async function runGrsaiImageEdit(input: GrsaiEditInput): Promise<ResultAsset[]> {
  if (!input.apiKey) {
    throw new GoogleImageError({
      category: 'auth_failed',
      message: 'Grsai API Key 未配置',
      retryable: false,
    })
  }

  const baseUrl = (input.baseUrl || GRSAI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = input.model.trim()
  const endpoint = `${baseUrl}${GRSAI_GENERATE_PATH}`

  const traceId = input.traceId ?? input.taskId
  const startedAt = Date.now()
  const results: ResultAsset[] = []

  console.log('[grsai-adapter] 请求配置', {
    taskId: input.taskId,
    model,
    baseUrl,
    fullUrl: endpoint,
    hasInputImages: input.inputImages.length > 0,
  })

  logImageEvent(
    'gimg.attempt',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'enter',
      adapter: 'grsai',
      model,
      count: input.count,
      promptLen: input.prompt.length,
      refs: input.inputImages.length,
      aspect: input.aspectRatio,
      size: input.imageSize,
    },
  )

  // 并发生成：单次请求只出 1 张，count > 1 时并发循环
  const generateTasks = Array.from({ length: input.count }, (_, i) => {
    const iterTraceId = input.count > 1 ? `${traceId}_v${i + 1}` : traceId
    const ctx: LogContext = {
      traceId: iterTraceId,
      taskId: input.taskId,
      shotId: input.shotId,
    }

    return callGoogleImageWithRetry(
      async (attempt, attemptSignal) => {
        const callStart = Date.now()
        logImageEvent('gimg.attempt', { ...ctx, attempt }, {
          adapter: 'grsai',
          model,
          iteration: i + 1,
          providerId: input.providerId,
        })

        const response = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify(buildGrsaiRequestBody(input, model)),
          },
          input.timeoutMs,
          attemptSignal,
        )

        const data = (await readJsonResponse(response)) as GrsaiGenerateResponse
        if (!response.ok) {
          throw buildGrsaiHttpError(response, data)
        }

        // Grsai 业务状态码：status 字段判断成功/违规/失败
        const status = (data.status ?? '').toLowerCase()
        if (status === 'violation') {
          throw new GoogleImageError({
            category: 'safety_block',
            message: `Grsai 内容违规（violation）：${data.error ?? '输入或输出触发审核'}`,
            retryable: false,
          })
        }
        if (status === 'failed') {
          throw new GoogleImageError({
            category: 'server_error',
            message: `Grsai 生成失败（failed）：${data.error ?? '未知错误'}`,
            retryable: true,
          })
        }
        if (status !== 'succeeded') {
          // running / 未知状态：replyType=json 时不应出现，兜底当 empty_output
          throw new GoogleImageError({
            category: 'empty_output',
            message: `Grsai 返回未成功状态（${status || 'unknown'}）：${data.error ?? ''}`,
            retryable: true,
          })
        }

        const urls = (data.results ?? [])
          .map((item) => item.url)
          .filter((url): url is string => Boolean(url))
        if (urls.length === 0) {
          throw new GoogleImageError({
            category: 'empty_output',
            message: 'Grsai API 未返回结果图片 URL',
            retryable: true,
          })
        }

        logImageEvent('gimg.success', { ...ctx, attempt }, {
          adapter: 'grsai',
          tookMs: Date.now() - callStart,
          items: urls.length,
          providerId: input.providerId,
        })

        return urls
      },
      ctx,
      {
        apiKey: input.apiKey,
        providerId: input.providerId,
        rateLimitKey: input.rateLimitKey,
        maxIpm: input.maxIpm,
        maxRpm: input.maxRpm,
        signal: input.signal,
        onRetryAttempt: input.onRetryAttempt,
        scheduler: {
          userId: input.userId,
          taskId: input.taskId,
          providerId: input.providerId ?? input.apiKey,
          resolution: input.imageSize,
        },
      },
      {
        // Grsai 中转：server_error / rate_limit 第一次失败就交给上层 pool
        // 切到下一个 provider，避免在同一个抽风渠道里重试浪费 30s+
        perCategoryMaxAttempts: {
          server_error: 1,
          rate_limit: 1,
        },
      },
    )
  })

  // 等待所有任务并发完成
  const allUrls = await Promise.all(generateTasks)

  // 收集所有结果
  for (const urls of allUrls) {
    for (const url of urls) {
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
      message: 'Grsai API 返回为空',
      retryable: true,
    })
  }

  logImageEvent(
    'gimg.success',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'done',
      adapter: 'grsai',
      totalResults: results.length,
      totalTookMs: Date.now() - startedAt,
    },
  )

  return results
}

/**
 * 构造 Grsai /v1/api/generate 请求体。
 *
 * imageSize 只在支持分辨率的模型上透传：
 * - nano-banana-2-lite / nano-banana-fast 官方未标 1K/2K/4K，传高分辨率可能报错
 * - 其它 nano-banana-2 / nano-banana-pro 系列正常透传
 */
function buildGrsaiRequestBody(
  input: GrsaiEditInput,
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    // json 同步等待结果，避免引入异步轮询复杂度
    replyType: 'json',
  }

  if (input.inputImages.length > 0) {
    body.images = input.inputImages
  }

  if (input.aspectRatio) {
    const ratio = resolveGrsaiGptImageAspectRatio(model, input.aspectRatio, input.imageSize)
    if (ratio) {
      body.aspectRatio = ratio
    }
  }

  if (input.imageSize) {
    const sanitized = sanitizeImageSize(model, input.imageSize)
    if (sanitized) {
      body.imageSize = sanitized
    }
  }

  return body
}

/**
 * 按模型能力过滤 imageSize。
 * - lite / fast 型号只允许 1K（官方未标更高分辨率）
 * - 其它型号正常透传 1K/2K/4K
 */
function sanitizeImageSize(model: string, imageSize: string): string | null {
  const normalized = imageSize.trim().toUpperCase()
  const lowerModel = model.toLowerCase()
  const isResolutionAware = RESOLUTION_AWARE_MODEL_PATTERNS.some((pattern) =>
    lowerModel.includes(pattern),
  )
  // nano-banana-2-lite 命中 nano-banana-2 模式，但它是 lite 版本，需单独排除
  const isLite = lowerModel.includes('lite') || lowerModel.includes('fast')

  if (isLite) {
    // lite/fast 仅支持 1K
    return normalized === '1K' ? '1K' : null
  }
  if (isResolutionAware) {
    if (normalized === '1K' || normalized === '2K' || normalized === '4K') {
      return normalized
    }
  }
  // 其它未知型号：保守透传，让上游决定
  return normalized || null
}

/**
 * gpt-image-2.5 系列在 Grsai 统一接口上不支持 '1:1' 等比例字符串，
 * aspectRatio 必须传像素值（WxH），实测约束（与 OpenAI 官方一致）：
 * 宽高均为 16 的倍数、长边 <= 3840、总像素 ∈ [655360, 8294400]。
 * 下表按「比例 × 分辨率档」映射到满足约束的标准像素值。
 */
const GPT_IMAGE_PIXEL_SIZE_TABLE: Record<string, Record<'1K' | '2K' | '4K', string>> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
  '3:2': { '1K': '1536x1024', '2K': '2048x1360', '4K': '3520x2336' },
  '2:3': { '1K': '1024x1536', '2K': '1360x2048', '4K': '2336x3520' },
  '3:4': { '1K': '768x1024', '2K': '1536x2048', '4K': '2480x3312' },
  '4:3': { '1K': '1024x768', '2K': '2048x1536', '4K': '3312x2480' },
}

/**
 * 为 gpt-image-2.5 系列把比例字符串转成上游要求的像素值；
 * 其它模型、未指定比例（如 'more' 场景）或已是像素值时原样透传。
 */
export function resolveGrsaiGptImageAspectRatio(
  model: string,
  aspectRatio: string | undefined,
  imageSize: string | undefined,
): string | undefined {
  if (!aspectRatio) return aspectRatio
  const trimmed = aspectRatio.trim()
  if (/^\d+x\d+$/i.test(trimmed)) return trimmed.toLowerCase()
  if (!model.trim().toLowerCase().startsWith('gpt-image-2.5')) return aspectRatio

  const size = (imageSize ?? '').trim().toUpperCase()
  const tier: '1K' | '2K' | '4K' = size === '1K' || size === '4K' ? size : '2K'
  const row =
    GPT_IMAGE_PIXEL_SIZE_TABLE[trimmed.toLowerCase()] ?? GPT_IMAGE_PIXEL_SIZE_TABLE['1:1']
  return row[tier]
}

function buildGrsaiHttpError(
  response: Response,
  data: GrsaiGenerateResponse,
): GoogleImageError {
  const status = response.status
  const upstreamMessage = data.error ?? `HTTP ${status}`
  const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))

  if (status === 401 || status === 403) {
    return new GoogleImageError({
      category: 'auth_failed',
      message: `Grsai API 凭证异常（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryable: false,
    })
  }

  if (status === 429) {
    return new GoogleImageError({
      category: 'rate_limit',
      message: `Grsai API 限流（429）：${upstreamMessage}`,
      httpStatus: status,
      retryAfterSeconds,
      retryable: true,
    })
  }

  if (status >= 500 && status < 600) {
    return new GoogleImageError({
      category: 'server_error',
      message: `Grsai API 服务端错误（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryAfterSeconds,
      retryable: true,
    })
  }

  if (status === 400) {
    return new GoogleImageError({
      category: 'bad_request',
      message: `Grsai API 请求参数错误（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryable: false,
    })
  }

  return new GoogleImageError({
    category: 'bad_request',
    message: `Grsai API 调用失败（${status}）：${upstreamMessage}`,
    httpStatus: status,
    retryable: false,
  })
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
    ) {
      if (signal?.aborted) {
        throw new GoogleImageError({
          category: 'network',
          message: 'Grsai API 调用已取消',
          retryable: false,
          cause: error,
        })
      }
      const seconds = Math.round(timeoutMs / 1000)
      throw new GoogleImageError({
        category: 'network',
        message: `Grsai API 调用超时（${seconds}s 未返回）`,
        retryable: true,
        cause: error,
      })
    }

    throw new GoogleImageError({
      category: 'network',
      message: `Grsai API 网络请求失败：${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
      cause: error,
    })
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}
