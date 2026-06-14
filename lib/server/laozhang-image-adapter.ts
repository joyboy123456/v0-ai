/**
 * 老张 AI 图像生成 Adapter。
 *
 * 老张 API 根据模型类型使用不同的接口格式：
 * - Gemini 模型：使用 Google 原生格式（/v1beta/models/{model}:generateContent）
 * - GPT Image 2：使用 OpenAI Images API（/v1/images/generations 和 /v1/images/edits）
 * - SeeDream：使用 OpenAI Images API
 *
 * 支持的模型：
 * - gemini-3.1-flash-image-preview (Nano Banana2): $0.055/张
 * - gemini-3-pro-image-preview (Nano Banana Pro): $0.09/张
 * - gemini-2.5-flash-image (Nano Banana): $0.025/张
 * - gpt-image-2: $0.03/张（默认分组标准线路）
 * - gpt-image-2-vip: $0.03/张（尺寸增强线路，支持 1K/2K/4K）
 * - seedream-4-5-251128 (SeeDream 4.5): $0.045/张
 * - seedream-4-0-250828 (SeeDream 4.0): $0.035/张
 *
 * 模型 ID 映射：
 * - doubao-seedream-4.5 → seedream-4-5-251128 (老张API的SeeDream 4.5)
 * - doubao-seedream-5.0-lite → seedream-4-5-251128 (映射到最新版)
 *
 * 关键：Gemini 模型必须使用 Google adapter（Google 原生格式），
 * GPT/SeeDream 模型使用 OpenAI adapter（OpenAI 格式）。
 */

import type { ResultAsset } from '@/lib/types'
import type { OpenAIEditInput } from './openai-image-adapter'
import type { GoogleEditInput } from './google-genai-adapter'
import { runOpenAIImageEdit } from './openai-image-adapter'
import { runGoogleImageEdit } from './google-genai-adapter'

const LAOZHANG_GOOGLE_BASE_URL = 'https://api.laozhang.ai/v1beta'

/**
 * 模型 ID 映射表：将项目中的模型 ID 映射到老张 API 的模型 ID
 */
const MODEL_ID_MAPPING: Record<string, string> = {
  // 豆包模型映射到老张的 SeeDream
  'doubao-seedream-4.5': 'seedream-4-5-251128',
  'doubao-seedream-5.0-lite': 'seedream-4-5-251128',
  'doubao-seedream-4-5-251128': 'seedream-4-5-251128',
  'doubao-seedream-5-0-260128': 'seedream-4-5-251128',
  // 其他模型保持不变
}

export interface LaozhangEditInput {
  taskId: string
  /** 老张 API Key（sk-xxx 格式） */
  apiKey: string
  model: string
  timeoutMs: number
  prompt: string
  inputImages: string[]
  count: number
  aspectRatio?: string
  imageSize?: string
  traceId?: string
  shotId?: string
  providerId?: string
  rateLimitKey?: string
  maxIpm?: number
  maxRpm?: number
}

/**
 * 通过老张 API 生成图片。
 *
 * 关键：根据模型类型选择正确的 adapter：
 * - Gemini 模型 → runGoogleImageEdit（Google 原生格式，文生图和图生图都走 generateContent 端点）
 * - GPT/SeeDream 模型 → runOpenAIImageEdit（OpenAI Images API 格式）
 */
export async function runLaozhangImageEdit(input: LaozhangEditInput): Promise<ResultAsset[]> {
  // 映射模型 ID
  const originalModel = input.model.trim().toLowerCase()
  const mappedModel = MODEL_ID_MAPPING[originalModel] || input.model

  console.log('[laozhang-adapter] 进入老张 adapter', {
    taskId: input.taskId,
    originalModel,
    mappedModel,
    inputImagesCount: input.inputImages.length,
  })

  // 判断模型类型
  const isGeminiModel = mappedModel.startsWith('gemini-')

  if (isGeminiModel) {
    // Gemini 模型：使用 Google 原生格式（runGoogleImageEdit）
    const googleInput: GoogleEditInput = {
      taskId: input.taskId,
      apiKey: input.apiKey,
      baseUrl: LAOZHANG_GOOGLE_BASE_URL,
      model: mappedModel,
      timeoutMs: input.timeoutMs,
      prompt: input.prompt,
      inputImages: input.inputImages,
      count: input.count,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      traceId: input.traceId,
      shotId: input.shotId,
      providerId: input.providerId,
      rateLimitKey: input.rateLimitKey,
      maxIpm: input.maxIpm,
      maxRpm: input.maxRpm,
    }

    return runGoogleImageEdit(googleInput)
  } else {
    // GPT/SeeDream 模型：使用 OpenAI Images API 格式（runOpenAIImageEdit）
    const baseUrl = 'https://api.laozhang.ai'
    const qiniuInput: OpenAIEditInput = {
      taskId: input.taskId,
      apiKey: input.apiKey,
      baseUrl,
      model: mappedModel,
      timeoutMs: input.timeoutMs,
      prompt: input.prompt,
      inputImages: input.inputImages,
      count: input.count,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      traceId: input.traceId,
      shotId: input.shotId,
      providerId: input.providerId,
      rateLimitKey: input.rateLimitKey,
      maxIpm: input.maxIpm,
      maxRpm: input.maxRpm,
    }

    return runOpenAIImageEdit(qiniuInput)
  }
}


