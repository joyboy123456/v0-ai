/**
 * 火山引擎豆包 Seedream 图像生成 Adapter。
 *
 * API 文档：https://www.volcengine.com/docs/82379/1666945
 * 支持模型：doubao-seedream-4.5, doubao-seedream-5.0-lite
 *
 * 端点：POST https://ark.cn-beijing.volces.com/api/v3/images/generations
 * 鉴权：Authorization: Bearer <API_KEY>
 *
 * 请求参数：
 * - model: string (必填) - 模型 ID
 * - prompt: string (必填) - 提示词，支持中英文，建议不超过300汉字或600英文单词
 * - image: string | array (可选) - 输入图片 URL 或 Base64，最多 14 张
 * - size: string (可选) - 生成尺寸，支持两种方式：
 *   方式1: "2K" | "4K"（需在 prompt 中描述比例）
 *   方式2: "宽x高" 如 "2848x1600"（16:9 比例的 2K）
 * - sequential_image_generation: "auto" | "disabled" (默认 disabled)
 *   - auto: 组图模式，模型自动判断生成数量
 *   - disabled: 单图模式
 * - sequential_image_generation_options.max_images: 1-15 (组图模式最大图片数)
 * - response_format: "url" | "b64_json" (默认 url)
 * - stream: boolean (默认 false)
 * - watermark: boolean (默认 true)
 * - output_format: "png" | "jpeg" (默认 jpeg，仅 5.0-lite 支持)
 *
 * 模型限制：
 * - Seedream 4.5: IPM 500，分辨率 2560×1440 - 4096×4096，仅 JPEG 输出
 * - Seedream 5.0-lite: IPM 500，分辨率 1280×720 - 4096×4096，支持 PNG/JPEG 输出
 * - 宽高比范围: [1/16, 16]
 * - 参考图数量: 最多 14 张
 * - 输入图+输出图总数: ≤ 15 张
 *
 * 重要：
 * - 不支持 `n` 参数，单图模式需串行调用
 * - 不支持独立的 `aspect_ratio` 参数，需用具体宽高像素值
 * - 5.0-lite 支持输出格式选择（PNG 无损 / JPEG 有损）
 */

import type { ResultAsset } from '@/lib/types'
import {
  GoogleImageError,
  callGoogleImageWithRetry,
  parseRetryAfter,
} from './google-image-retry'
import { logImageEvent, type LogContext } from './log'

const VOLCES_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com'
const VOLCES_DEFAULT_MODEL = 'doubao-seedream-4-5-251128'
const VOLCES_GENERATIONS_PATH = '/api/v3/images/generations'

/**
 * 模型 ID 映射：前端友好名称 → API 实际模型名称
 */
const MODEL_ID_MAP: Record<string, string> = {
  'doubao-seedream-4.5': 'doubao-seedream-4-5-251128',
  'doubao-seedream-5.0-lite': 'doubao-seedream-5-0-260128',
}

/**
 * 规范化模型 ID：将前端友好名称映射到 API 实际模型名称
 */
function normalizeModelId(model: string): string {
  const normalized = model.trim().toLowerCase()
  return MODEL_ID_MAP[normalized] || normalized
}

/**
 * 豆包 Seedream 4.5 支持的比例与分辨率映射。
 *
 * 根据官方文档的推荐宽高像素值：
 * https://www.volcengine.com/docs/82379/1666945
 */
interface VolcesSizeMapping {
  /** 比例，如 "16:9" */
  ratio: string
  /** 2K 分辨率的宽高像素值 */
  size2K: string
  /** 4K 分辨率的宽高像素值 */
  size4K: string
}

/** 比例到宽高像素值的映射表 */
const RATIO_TO_SIZE_MAP: Record<string, VolcesSizeMapping> = {
  '1:1': { ratio: '1:1', size2K: '2048x2048', size4K: '4096x4096' },
  '4:3': { ratio: '4:3', size2K: '2304x1728', size4K: '4704x3520' },
  '3:4': { ratio: '3:4', size2K: '1728x2304', size4K: '3520x4704' },
  '16:9': { ratio: '16:9', size2K: '2848x1600', size4K: '5504x3040' },
  '9:16': { ratio: '9:16', size2K: '1600x2848', size4K: '3040x5504' },
  '3:2': { ratio: '3:2', size2K: '2496x1664', size4K: '4992x3328' },
  '2:3': { ratio: '2:3', size2K: '1664x2496', size4K: '3328x4992' },
  '21:9': { ratio: '21:9', size2K: '3136x1344', size4K: '6240x2656' },
}

/** 支持的分辨率类型 */
type VolcesResolution = '2K' | '4K'

export interface VolcesEditInput {
  taskId: string
  apiKey: string
  /** 火山引擎 API base URL（默认 https://ark.cn-beijing.volces.com） */
  baseUrl?: string
  model: string
  timeoutMs: number
  prompt: string
  /** 输入图片（data URL 数组）；非空时自动进入图生图模式 */
  inputImages: string[]
  /** 要生成的图片数量（豆包不支持 n 参数，需串行调用） */
  count: number
  /**
   * 图片尺寸参数
   * - 如果传 "2K" 或 "4K"，会使用默认 1:1 比例
   * - 如果传比例（如 "16:9"），会自动选择 2K 分辨率的对应宽高值
   * - 如果传 "宽x高"（如 "2848x1600"），直接使用该值
   */
  size?: string
  /** 是否带水印（默认 true） */
  watermark?: boolean
  /**
   * 输出格式（仅 5.0-lite 支持）
   * - "png": 无损输出，文件较大
   * - "jpeg": 有损压缩，文件较小
   * - 不传时默认为 jpeg
   */
  outputFormat?: 'png' | 'jpeg'
  traceId?: string
  shotId?: string
  /** provider 唯一标识，用于令牌桶隔离 */
  providerId?: string
  /** 该 provider 的 IPM 上限（豆包 Seedream 4.5 默认 500） */
  maxIpm?: number
  /** 该 provider 的 RPM 上限 */
  maxRpm?: number
}

interface VolcesImageItem {
  url?: string
  b64_json?: string
  /** 仅组图模式有此字段 */
  size?: string
}

interface VolcesImageResponse {
  created?: number
  data?: VolcesImageItem[]
  usage?: {
    generated_images?: number
    output_tokens?: number
    total_tokens?: number
  }
}

/**
 * 将用户输入的 size 参数转换为豆包 API 支持的格式。
 *
 * 输入可以是：
 * - "2K" / "4K" → 返回默认 1:1 的宽高值
 * - "16:9" / "9:16" 等比例 → 返回 2K 分辨率的对应宽高值
 * - "2848x1600" 等具体宽高 → 直接返回
 */
function normalizeSizeParam(size: string | undefined): string {
  if (!size) return '2048x2048' // 默认 2K 1:1

  const trimmed = size.trim().toUpperCase()

  // 方式1：分辨率 "2K" / "4K"，使用默认 1:1 比例
  if (trimmed === '2K') return '2048x2048'
  if (trimmed === '4K') return '4096x4096'

  // 方式2：已经是 "宽x高" 格式，直接返回
  if (/^\d+X\d+$/.test(trimmed)) {
    return trimmed.toLowerCase().replace('X', 'x')
  }

  // 方式3：比例格式（如 "16:9"），转换为 2K 分辨率的宽高值
  const mapping = RATIO_TO_SIZE_MAP[trimmed.replace('：', ':')]
  if (mapping) {
    return mapping.size2K
  }

  // 无法识别，返回默认值
  return '2048x2048'
}

/**
 * 根据比例和分辨率生成宽高像素值。
 */
function getSizeByRatioAndResolution(
  ratio: string | undefined,
  resolution: VolcesResolution,
): string {
  if (!ratio) {
    return resolution === '4K' ? '4096x4096' : '2048x2048'
  }

  const normalizedRatio = ratio.replace('：', ':')
  const mapping = RATIO_TO_SIZE_MAP[normalizedRatio]
  if (!mapping) {
    return resolution === '4K' ? '4096x4096' : '2048x2048'
  }

  return resolution === '4K' ? mapping.size4K : mapping.size2K
}

async function callVolcesOnce(
  input: VolcesEditInput,
  logCtx: LogContext,
): Promise<VolcesImageItem> {
  const baseUrl = input.baseUrl?.replace(/\/+$/, '') || VOLCES_DEFAULT_BASE_URL
  const url = `${baseUrl}${VOLCES_GENERATIONS_PATH}`
  const sizeValue = normalizeSizeParam(input.size)
  const normalizedModel = normalizeModelId(input.model || VOLCES_DEFAULT_MODEL)

  const requestBody: Record<string, unknown> = {
    model: normalizedModel,
    prompt: input.prompt,
    size: sizeValue,
    response_format: 'url',
    stream: false,
    sequential_image_generation: 'disabled',
    watermark: input.watermark !== false,
  }

  // 5.0-lite 支持 output_format 参数（png/jpeg）
  if (normalizedModel === 'doubao-seedream-5-0-260128' && input.outputFormat) {
    requestBody.output_format = input.outputFormat
  }

  // 如果有输入图片，添加到请求体
  if (input.inputImages.length > 0) {
    requestBody.image = input.inputImages.length === 1
      ? input.inputImages[0]
      : input.inputImages
  }

  logImageEvent('volces.request', logCtx, {
    url,
    model: input.model,
    size: sizeValue,
    hasInputImages: input.inputImages.length > 0,
    inputImagesCount: input.inputImages.length,
    watermark: requestBody.watermark,
    outputFormat: requestBody.output_format,
  })

  const response = await callGoogleImageWithRetry(
    async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(input.timeoutMs),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new GoogleImageError({
          category: res.status === 401 || res.status === 403 ? 'auth_failed' : 'api_error',
          httpStatus: res.status,
          message: `火山引擎 API 返回错误 HTTP ${res.status}: ${text.slice(0, 300)}`,
        })
      }

      return res
    },
    logCtx,
    {
      providerId: input.providerId || 'volces',
      maxIpm: input.maxIpm || 500, // 豆包 Seedream 4.5 IPM 默认 500
      maxRpm: input.maxRpm || 150,
      parseRetryAfter,
    },
  )

  const text = await response.text()
  let json: VolcesImageResponse
  try {
    json = JSON.parse(text)
  } catch {
    throw new GoogleImageError({
      category: 'api_error',
      message: `火山引擎 API 返回非 JSON 格式响应: ${text.slice(0, 500)}`,
    })
  }

  if (!json.data || !Array.isArray(json.data) || json.data.length === 0) {
    throw new GoogleImageError({
      category: 'api_error',
      message: `火山引擎 API 返回空数据: ${JSON.stringify(json).slice(0, 300)}`,
    })
  }

  const item = json.data[0]
  if (!item.url && !item.b64_json) {
    throw new GoogleImageError({
      category: 'api_error',
      message: `火山引擎 API 返回的图片项缺少 url 或 b64_json: ${JSON.stringify(item).slice(0, 300)}`,
    })
  }

  logImageEvent('volces.success', logCtx, {
    hasUrl: Boolean(item.url),
    hasB64: Boolean(item.b64_json),
    size: item.size,
    usage: json.usage,
  })

  return item
}

/**
 * 火山引擎豆包 Seedream 生图主入口。
 *
 * 输入：count 张图待生成
 * 输出：ResultAsset[]，长度等于 count
 *
 * 注意：豆包不支持 n 参数，单图模式需串行调用。
 */
export async function runVolcesImageEdit(
  input: VolcesEditInput,
): Promise<ResultAsset[]> {
  const logCtx: LogContext = {
    traceId: input.traceId || 'unknown',
    taskId: input.taskId,
    shotId: input.shotId,
  }

  if (input.count <= 0) {
    return []
  }

  const results: ResultAsset[] = []

  // 豆包不支持 n 参数，需要串行调用
  for (let i = 0; i < input.count; i++) {
    const item = await callVolcesOnce(input, { ...logCtx, attempt: i + 1 })

    const assetId = `${input.taskId}-volces-${Date.now()}-${i}`

    let dataUrl: string
    if (item.url) {
      dataUrl = item.url
    } else if (item.b64_json) {
      const mime = item.b64_json.startsWith('data:') ? item.b64_json : `data:image/jpeg;base64,${item.b64_json}`
      dataUrl = mime
    } else {
      throw new GoogleImageError({
        category: 'api_error',
        message: `火山引擎 API 返回的图片项缺少 url 和 b64_json`,
      })
    }

    results.push({
      assetId,
      url: dataUrl,
      kind: 'generated',
      metadata: {
        provider: 'volces',
        model: input.model,
        size: item.size,
      },
    })
  }

  logImageEvent('volces.batch_complete', logCtx, {
    requested: input.count,
    generated: results.length,
  })

  return results
}
