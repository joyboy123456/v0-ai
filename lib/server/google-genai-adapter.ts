import type { ResultAsset } from '@/lib/types'
import {
  GoogleImageError,
  callGoogleImageWithRetry,
  parseRetryAfter,
} from './google-image-retry'
import { logImageEvent, type LogContext } from './log'

/**
 * Adapter for Google Gemini's official image API
 * (https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent).
 *
 * Used when IMAGE_API_PROVIDER=google. The endpoint expects a Gemini-native
 * `contents/parts` payload with image references as `inline_data`, and returns
 * generated images as base64 inside `candidates[*].content.parts[*].inline_data`.
 *
 * v4（2026-05-18）：每次 generateContent 由 callGoogleImageWithRetry 包装，含错误分类、
 * 指数退避、Retry-After 尊重、IPM/RPM 节流、401/403 熔断与结构化日志。
 */

const googleApiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiInlineData {
  mimeType?: string
  data?: string
}

interface GeminiPart {
  text?: string
  inlineData?: GeminiInlineData
  inline_data?: GeminiInlineData
  thought?: boolean
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string }
  error?: { message?: string; status?: string }
}

export interface GoogleEditInput {
  taskId: string
  apiKey: string
  model: string
  timeoutMs: number
  prompt: string
  /** Each item is a data URL we collected from the asset store. */
  inputImages: string[]
  /** Number of result images to return. Gemini does not support `n` natively, so we loop. */
  count: number
  /** Optional aspect ratio (e.g. "1:1", "3:4", "16:9"). Only honored by 3.x models. */
  aspectRatio?: string
  /** Optional image size: "512" / "1K" / "2K" / "4K" (must be uppercase K). 2.5 ignores. */
  imageSize?: string
  /**
   * 可选 traceId（覆盖默认）。photo-fission 用 `${taskId}_${shotId}`；ai-fashion-photo 用 `${taskId}`。
   * 不传时默认使用 taskId 作为 traceId。
   */
  traceId?: string
  /** 可选 shotId，仅用于日志透传（photo-fission 单 shot 调用） */
  shotId?: string
}

export async function runGoogleImageEdit(input: GoogleEditInput): Promise<ResultAsset[]> {
  if (!input.apiKey) {
    throw new GoogleImageError({
      category: 'auth_failed',
      message: 'GOOGLE_API_KEY 未配置，无法调用 Google Gemini API',
      retryable: false,
    })
  }

  const traceId = input.traceId ?? input.taskId
  const url = `${googleApiBaseUrl}/models/${encodeURIComponent(input.model)}:generateContent`
  const startedAt = Date.now()
  const results: ResultAsset[] = []

  logImageEvent(
    'gimg.attempt',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'enter',
      model: input.model,
      count: input.count,
      promptLen: input.prompt.length,
      refs: input.inputImages.length,
      aspect: input.aspectRatio,
      size: input.imageSize,
    },
  )

  // Gemini's generateContent returns one candidate per request, so we issue `count` calls in series.
  // 每个 call 由 callGoogleImageWithRetry 包装，独立计算 attempts / backoff / throttle。
  for (let index = 0; index < input.count; index += 1) {
    const callTraceId = input.count > 1 ? `${traceId}_v${index + 1}` : traceId
    const ctx: LogContext = {
      traceId: callTraceId,
      taskId: input.taskId,
      shotId: input.shotId,
    }

    const inline = await callGoogleImageWithRetry(
      async (attempt) => {
        const callStart = Date.now()
        logImageEvent('gimg.attempt', { ...ctx, attempt }, {
          model: input.model,
          promptLen: input.prompt.length,
          refs: input.inputImages.length,
          aspect: input.aspectRatio,
          size: input.imageSize,
        })

        const data = await performSingleCall({
          url,
          apiKey: input.apiKey,
          body: buildRequestBody(input),
          timeoutMs: input.timeoutMs,
        })

        logImageEvent('gimg.success', { ...ctx, attempt }, {
          tookMs: Date.now() - callStart,
        })

        return data
      },
      ctx,
      { apiKey: input.apiKey },
    )

    const mimeType = inline.mimeType ?? 'image/png'
    const dataUrl = `data:${mimeType};base64,${inline.data}`
    const resultIndex = results.length + 1
    results.push({
      assetId: `result_${input.taskId}_${resultIndex}`,
      url: dataUrl,
      downloadUrl: dataUrl,
      width: 0,
      height: 0,
    })
  }

  logImageEvent(
    'gimg.success',
    { traceId, taskId: input.taskId, shotId: input.shotId },
    {
      stage: 'done',
      totalResults: results.length,
      totalTookMs: Date.now() - startedAt,
    },
  )
  return results
}

interface PerformSingleCallInput {
  url: string
  apiKey: string
  body: unknown
  timeoutMs: number
}

/**
 * 一次 generateContent 调用：发 fetch、读 JSON、按 v4 § 15.4 R2 规则识别错误并抛 GoogleImageError。
 * 成功时返回 inlineData（mimeType + base64 data）。
 *
 * 错误分类映射（PRD §15.4 + research/stability-failure-modes.md §5）：
 * - HTTP 400 / status=INVALID_ARGUMENT → bad_request（不重试）
 * - HTTP 401/403 → auth_failed（不重试 + 熔断）
 * - HTTP 404 → bad_request（不重试，资源不存在）
 * - HTTP 408 → network（可重试）
 * - HTTP 429 / status=RESOURCE_EXHAUSTED → rate_limit（读 Retry-After）
 * - HTTP 500/502/503/504 → server_error
 * - promptFeedback.blockReason = SAFETY/OTHER → safety_block（最多 1 次重试）
 * - promptFeedback.blockReason = PROHIBITED_CONTENT/RECITATION → prohibited（不重试）
 * - finishReason = IMAGE_SAFETY → image_safety（最多 1 次重试）
 * - finishReason = SAFETY/RECITATION/PROHIBITED_CONTENT → 同上分别归类
 * - finishReason = STOP 且无 inline_data → empty_output（最多 2 次重试，命中 issue #1406）
 */
async function performSingleCall(
  input: PerformSingleCallInput,
): Promise<GeminiInlineData> {
  const response = await fetchWithTimeout(
    input.url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify(input.body),
    },
    input.timeoutMs,
  )

  const data = (await readJsonResponse(response)) as GeminiResponse

  if (!response.ok) {
    const status = response.status
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
    const upstreamMessage = data.error?.message ?? `HTTP ${status}`
    const upstreamStatus = data.error?.status

    // 鉴权 / 权限类
    if (status === 401 || status === 403) {
      throw new GoogleImageError({
        category: 'auth_failed',
        message: `Google API 凭证异常（${status}）：${upstreamMessage}`,
        httpStatus: status,
        retryable: false,
      })
    }

    // 限流
    if (status === 429 || upstreamStatus === 'RESOURCE_EXHAUSTED') {
      throw new GoogleImageError({
        category: 'rate_limit',
        message: `Google API 限流（429）：${upstreamMessage}`,
        httpStatus: status,
        retryAfterSeconds: retryAfter,
        retryable: true,
      })
    }

    // 5xx 服务端
    if (status >= 500 && status < 600) {
      throw new GoogleImageError({
        category: 'server_error',
        message: `Google API 服务端错误（${status}）：${upstreamMessage}`,
        httpStatus: status,
        retryAfterSeconds: retryAfter,
        retryable: true,
      })
    }

    // 408 网关超时归 network
    if (status === 408) {
      throw new GoogleImageError({
        category: 'network',
        message: `Google API 请求超时（408）：${upstreamMessage}`,
        httpStatus: status,
        retryable: true,
      })
    }

    // 其他 4xx
    if (status >= 400 && status < 500) {
      throw new GoogleImageError({
        category: 'bad_request',
        message: `Google API 调用失败（${status}）：${upstreamMessage}`,
        httpStatus: status,
        retryable: false,
      })
    }

    // 兜底
    throw new GoogleImageError({
      category: 'unknown',
      message: `Google API 调用失败（${status}）：${upstreamMessage}`,
      httpStatus: status,
      retryable: true,
    })
  }

  // 200：可能有 promptFeedback.blockReason 或 candidates 内空
  const blockReason = data.promptFeedback?.blockReason
  if (blockReason) {
    const blockMessage =
      data.promptFeedback?.blockReasonMessage ?? blockReason
    if (blockReason === 'PROHIBITED_CONTENT' || blockReason === 'RECITATION' || blockReason === 'BLOCKLIST') {
      throw new GoogleImageError({
        category: 'prohibited',
        message: `Google Gemini 拒绝生成（${blockReason}）：${blockMessage}`,
        blockReason,
        retryable: false,
      })
    }
    // SAFETY / OTHER → 可重试
    throw new GoogleImageError({
      category: 'safety_block',
      message: `Google Gemini 安全拦截（${blockReason}）：${blockMessage}`,
      blockReason,
      retryable: true,
    })
  }

  const candidate = data.candidates?.[0]
  const finishReason = candidate?.finishReason
  const inline = extractFinalImage(data)

  // finishReason 不是 STOP 时按类别归类
  if (finishReason && finishReason !== 'STOP') {
    if (finishReason === 'IMAGE_SAFETY') {
      throw new GoogleImageError({
        category: 'image_safety',
        message: 'Google Gemini 图像安全拦截（IMAGE_SAFETY）',
        finishReason,
        retryable: true,
      })
    }
    if (finishReason === 'SAFETY') {
      throw new GoogleImageError({
        category: 'safety_block',
        message: 'Google Gemini 候选被安全过滤（SAFETY）',
        finishReason,
        retryable: true,
      })
    }
    if (finishReason === 'PROHIBITED_CONTENT' || finishReason === 'RECITATION' || finishReason === 'BLOCKLIST') {
      throw new GoogleImageError({
        category: 'prohibited',
        message: `Google Gemini 候选触发禁止规则（${finishReason}）`,
        finishReason,
        retryable: false,
      })
    }
    // MAX_TOKENS / LANGUAGE / OTHER 等：可重试 1 次（unknown）
    throw new GoogleImageError({
      category: 'unknown',
      message: `Google Gemini 未返回图片（finishReason=${finishReason}）`,
      finishReason,
      retryable: true,
    })
  }

  // STOP 但 parts 里没有可用的 image part（issue #1406）
  if (!inline?.data) {
    throw new GoogleImageError({
      category: 'empty_output',
      message: 'Google Gemini 返回 STOP 但未生成 image part',
      finishReason: finishReason ?? 'STOP',
      retryable: true,
    })
  }

  return inline
}

function buildRequestBody(input: GoogleEditInput) {
  const parts: GeminiPart[] = [
    ...input.inputImages.map((dataUrl) => ({
      inline_data: parseDataUrl(dataUrl),
    })),
    { text: input.prompt },
  ]

  const generationConfig: Record<string, unknown> = {}

  // Per the REST schema, output controls live under `generationConfig.imageConfig`
  // (not the SDK-only `response_format`). 2.5 only honors aspectRatio; 3.x honors both.
  // Sending unknown fields is harmless.
  const imageConfig: Record<string, string> = {}
  if (input.aspectRatio) imageConfig.aspectRatio = input.aspectRatio
  if (input.imageSize) imageConfig.imageSize = input.imageSize
  if (Object.keys(imageConfig).length) {
    generationConfig.imageConfig = imageConfig
  }

  return {
    contents: [{ role: 'user', parts }],
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  }
}

function parseDataUrl(dataUrl: string): GeminiInlineData {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new GoogleImageError({
      category: 'bad_request',
      message: '参考图必须为 dataURL 形式（data:<mime>;base64,...）',
      retryable: false,
    })
  }
  return { mimeType: match[1], data: match[2] }
}

/**
 * The Nano Banana Pro / 2 models emit "thought images" (intermediate compositions)
 * before the final result. We must skip parts marked thought=true and pick the last
 * non-thought inline image. Per docs: "the last image in 'thinking' is also the final
 * rendered image" — but if we filter thoughts, the remaining image is the answer.
 */
function extractFinalImage(response: GeminiResponse): GeminiInlineData | null {
  const parts = response.candidates?.[0]?.content?.parts ?? []
  // Walk in reverse so we get the last (final) non-thought image.
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.thought) continue
    const inline = part.inlineData ?? part.inline_data
    if (inline?.data) return inline
  }
  return null
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    // 翻译为带 category 的 GoogleImageError，由 wrapper 决定是否重试
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
    ) {
      const seconds = Math.round(timeoutMs / 1000)
      throw new GoogleImageError({
        category: 'network',
        message: `Google Gemini API 调用超时（${seconds}s 未返回）`,
        retryable: true,
        cause: error,
      })
    }

    if (error instanceof Error) {
      const causeDetails = formatFetchCause(error)
      throw new GoogleImageError({
        category: 'network',
        message: `Google Gemini API 网络请求失败：${error.message}${causeDetails ? `（${causeDetails}）` : ''}`,
        retryable: true,
        cause: error,
      })
    }

    throw new GoogleImageError({
      category: 'network',
      message: `Google Gemini API 网络请求失败：${String(error)}`,
      retryable: true,
      cause: error,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function formatFetchCause(error: Error) {
  const cause = (error as Error & { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return ''

  const record = cause as { code?: unknown; message?: unknown }
  const parts: string[] = []
  if (typeof record.code === 'string' && record.code) {
    parts.push(`cause.code=${record.code}`)
  }
  if (typeof record.message === 'string' && record.message) {
    parts.push(`cause.message=${record.message}`)
  }

  return parts.join('，')
}

async function readJsonResponse(response: Response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}
