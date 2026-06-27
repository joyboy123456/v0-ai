/**
 * 根据 provider.type 路由到对应的 adapter 执行单次生图。
 *
 * 统一入口，避免 photo-fission / pose-fission / third-party-adapter
 * 各自维护 if/switch 判断。当新增供应商时只需在此处加一个 case。
 */

import type { ResultAsset } from '@/lib/types'
import { runGoogleImageEdit } from './google-genai-adapter'
import { resolveImageSize } from './image-size-policy'
import {
  getProviderRateLimitKey,
  tripProviderCircuit,
  type ImageProvider,
} from './image-provider-pool'
import { GoogleImageError } from './google-image-retry'
import { runOpenAIImageEdit } from './openai-image-adapter'
import { runJimengImageEdit } from './jimeng-image-adapter'
import { runVolcesImageEdit } from './volces-image-adapter'
import { runLaozhangImageEdit } from './laozhang-image-adapter'

export interface ProviderImageEditInput {
  taskId: string
  provider: ImageProvider
  /** 降级 apiKey（provider.apiKey 为空时使用） */
  fallbackApiKey?: string
  model: string
  prompt: string
  inputImages: string[]
  /** 与 inputImages 一一对应；Gemini 请求会把标签紧邻放在对应图片前。 */
  inputImageLabels?: string[]
  count: number
  aspectRatio?: string
  imageSize?: string
  traceId?: string
  shotId?: string
  signal?: AbortSignal
  onRetryAttempt?: (attempt: number) => void
}

/**
 * 根据 provider.type 路由到 google / qiniu adapter。
 * 返回 ResultAsset[]（与 runGoogleImageEdit 签名一致）。
 */
export async function runImageEditViaProvider(
  input: ProviderImageEditInput,
): Promise<ResultAsset[]> {
  const { provider } = input
  const apiKey = provider.apiKey || input.fallbackApiKey || ''
  const timeoutMs = provider.timeoutMs || 600000
  const resolvedSize = resolveImageSize(input.aspectRatio, input.imageSize)
  const rateLimitKey = getProviderRateLimitKey(provider)

  try {
    switch (provider.type) {
      case 'laozhang':
        return await runLaozhangImageEdit({
          taskId: input.taskId,
          apiKey,
          model: input.model || provider.model || '',
          timeoutMs,
          prompt: input.prompt,
          inputImages: input.inputImages,
          inputImageLabels: input.inputImageLabels,
          count: input.count,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          traceId: input.traceId,
          shotId: input.shotId,
          providerId: provider.id,
          rateLimitKey,
          maxIpm: provider.maxIpm,
          maxRpm: provider.maxRpm,
          signal: input.signal,
          onRetryAttempt: input.onRetryAttempt,
        })

      case 'openai':
        return await runOpenAIImageEdit({
          taskId: input.taskId,
          apiKey,
          baseUrl: provider.baseUrl,
          model: input.model || provider.model || '',
          timeoutMs,
          prompt: input.prompt,
          inputImages: input.inputImages,
          count: input.count,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          traceId: input.traceId,
          shotId: input.shotId,
          providerId: provider.id,
          rateLimitKey,
          maxIpm: provider.maxIpm,
          maxRpm: provider.maxRpm,
        })

      case 'jimeng':
        return await runJimengImageEdit({
          taskId: input.taskId,
          apiKey,
          model: input.model || provider.model || '',
          timeoutMs,
          prompt: input.prompt,
          inputImages: input.inputImages,
          count: input.count,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          resolvedSize,
          traceId: input.traceId,
          shotId: input.shotId,
          providerId: provider.id,
          rateLimitKey,
          maxIpm: provider.maxIpm,
          maxRpm: provider.maxRpm,
        })

      case 'volces': {
        // 豆包 Seedream 4.5/5.0-lite 使用 "宽x高" 格式的 size 参数。
        // 必须将 aspectRatio（如 "16:9"）与 resolution（如 "4K"）组合为正确的像素尺寸，
        // 否则 normalizeSizeParam 会把 "4K" 当作 1:1 → 4096x4096，导致所有比例都出正方形。
        const volcesModel = input.model || provider.model || ''
        const volcesResolvedSize =
          volcesModel.includes('5.0-lite') || volcesModel.includes('5-0-260128')
            ? resolvedSize
            : resolveImageSize(
                input.aspectRatio,
                resolvedSize.resolution === '4K' ? '4K' : '2K',
              )
        // 尝试 PNG 无损输出：5.0-lite 官方支持；4.5 文档不支持但尝试传入，
        // 若 API 忽略则不影响，若接受则获得高质量输出。
        const volcesOutputFormat = 'png' as const
        return await runVolcesImageEdit({
          taskId: input.taskId,
          apiKey,
          baseUrl: provider.baseUrl,
          model: volcesModel,
          timeoutMs,
          prompt: input.prompt,
          inputImages: input.inputImages,
          count: input.count,
          size: volcesResolvedSize.size,
          outputFormat: volcesOutputFormat,
          resolvedSize: volcesResolvedSize,
          traceId: input.traceId,
          shotId: input.shotId,
          providerId: provider.id,
          rateLimitKey,
          maxIpm: provider.maxIpm,
          maxRpm: provider.maxRpm,
        })
      }

      case 'google':
      default:
        return await runGoogleImageEdit({
          taskId: input.taskId,
          apiKey,
          model: input.model || provider.model || '',
          timeoutMs,
          prompt: input.prompt,
          inputImages: input.inputImages,
          inputImageLabels: input.inputImageLabels,
          count: input.count,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          traceId: input.traceId,
          shotId: input.shotId,
          providerId: provider.id,
          rateLimitKey,
          maxIpm: provider.maxIpm,
          maxRpm: provider.maxRpm,
          signal: input.signal,
          onRetryAttempt: input.onRetryAttempt,
        })
    }
  } catch (error) {
    if (error instanceof GoogleImageError && error.category === 'auth_failed') {
      tripProviderCircuit(provider.id)
    }
    throw withUpstreamErrorContext(error, provider)
  }
}

function withUpstreamErrorContext(error: unknown, provider: ImageProvider): unknown {
  if (!(error instanceof GoogleImageError)) return error
  if (error.message.startsWith('上游模型返回')) return error

  const statusText = error.httpStatus ? `${error.httpStatus}` : error.category
  const advice = getUpstreamAdvice(error)
  const message = [
    `上游模型返回 ${statusText}（${provider.id}）：${error.message}`,
    advice ? `建议：${advice}` : '',
  ]
    .filter(Boolean)
    .join('。')

  return new GoogleImageError({
    category: error.category,
    message,
    retryable: error.retryable,
    httpStatus: error.httpStatus,
    retryAfterSeconds: error.retryAfterSeconds,
    finishReason: error.finishReason,
    blockReason: error.blockReason,
    cause: error,
  })
}

function getUpstreamAdvice(error: GoogleImageError): string {
  switch (error.category) {
    case 'rate_limit':
      return '上游限流，请稍后重试，或切换到可用额度更充足的模型供应商'
    case 'server_error':
      return '上游服务暂不可用，请稍后重试'
    case 'payload_too_large':
      return '上游认为图片或参考图组合过大，可减少参考图数量或降低图片尺寸后重试'
    case 'auth_failed':
      return '请检查该模型供应商的 API Key、余额或权限配置'
    case 'bad_request':
      return '请检查参考图格式、数量和提示词内容是否符合该模型供应商要求'
    case 'network':
      return '请稍后重试；如果持续失败，请检查服务器到上游的网络连接'
    case 'safety_block':
    case 'image_safety':
    case 'prohibited':
      return '请调整参考图或提示词，避免触发上游安全策略'
    case 'empty_output':
      return '上游未返回图片，可重试或换一个模型供应商'
    case 'api_error':
    case 'unknown':
    default:
      return '请稍后重试；如果持续失败，请查看服务日志中的上游原始错误'
  }
}
