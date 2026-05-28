/**
 * 根据 provider.type 路由到对应的 adapter 执行单次生图。
 *
 * 统一入口，避免 photo-fission / pose-fission / third-party-adapter
 * 各自维护 if/switch 判断。当新增供应商时只需在此处加一个 case。
 */

import type { ResultAsset } from '@/lib/types'
import { runGoogleImageEdit } from './google-genai-adapter'
import { tripProviderCircuit, type ImageProvider } from './image-provider-pool'
import { GoogleImageError } from './google-image-retry'
import { runQiniuImageEdit } from './qiniu-image-adapter'
import { runJimengImageEdit } from './jimeng-image-adapter'

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
          traceId: input.traceId,
          shotId: input.shotId,
          providerId: provider.id,
          maxIpm: provider.maxIpm,
          maxRpm: provider.maxRpm,
        })

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
