/**
 * 根据 provider.type 路由到对应的 adapter 执行单次生图。
 *
 * 统一入口，避免 photo-fission / pose-fission / third-party-adapter
 * 各自维护 if/switch 判断。当新增供应商时只需在此处加一个 case。
 */

import type { ResultAsset } from '@/lib/types'
import { runGoogleImageEdit } from './google-genai-adapter'
import { resolveImageSize } from './image-size-policy'
import { tripProviderCircuit, type ImageProvider } from './image-provider-pool'
import { GoogleImageError } from './google-image-retry'
import { runQiniuImageEdit } from './qiniu-image-adapter'
import { runJimengImageEdit } from './jimeng-image-adapter'
import { runVolcesImageEdit } from './volces-image-adapter'

export interface ProviderImageEditInput {
  taskId: string
  provider: ImageProvider
  /** 降级 apiKey（provider.apiKey 为空时使用） */
  fallbackApiKey?: string
  model: string
  prompt: string
  inputImages: string[]
  count: number
  aspectRatio?: string
  imageSize?: string
  traceId?: string
  shotId?: string
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

  try {
    switch (provider.type) {
      case 'qiniu':
        return await runQiniuImageEdit({
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
          count: input.count,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          traceId: input.traceId,
          shotId: input.shotId,
          providerId: provider.id,
          maxIpm: provider.maxIpm,
          maxRpm: provider.maxRpm,
        })
    }
  } catch (error) {
    if (error instanceof GoogleImageError && error.category === 'auth_failed') {
      tripProviderCircuit(provider.id)
    }
    throw error
  }
}
