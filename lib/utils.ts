import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * OSS 图片实时处理 —— 在 URL 后附加 x-oss-process 参数，OSS 服务端实时返回缩略图。
 * 无需生成额外文件，无需后端改动，历史图片也能立即生效。
 */
export function getOssThumbnailUrl(
  url: string | undefined,
  width: number = 400,
): string {
  if (!url) return ''
  if (!url.includes('aliyuncs.com')) return url
  if (url.includes('x-oss-process')) return url
  return `${url}?x-oss-process=image/resize,w_${width}/format,webp/quality,q_80`
}

export type ApiErrorSource =
  | 'client'
  | 'upload_parser'
  | 'image_validation'
  | 'storage'
  | 'proxy_or_transport'
  | 'upstream'

export interface ApiErrorPayload {
  error?: string
  source?: ApiErrorSource
  code?: string
  advice?: string
  upstreamStatus?: number
  provider?: string
}

export class ApiResponseError extends Error {
  payload?: ApiErrorPayload
  status: number

  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message)
    this.name = 'ApiResponseError'
    this.status = status
    this.payload = payload
  }
}

const apiErrorSourceLabels: Record<ApiErrorSource, string> = {
  client: '前端',
  upload_parser: '上传解析服务',
  image_validation: '图片校验服务',
  storage: '存储服务',
  proxy_or_transport: '传输/代理',
  upstream: '上游模型',
}

function formatApiErrorMessage(
  status: number,
  payload: ApiErrorPayload,
  fallbackError: string,
): string {
  const rawError = payload.error?.trim() || `${fallbackError}（HTTP ${status}）`
  const label = payload.source ? apiErrorSourceLabels[payload.source] : ''
  const hasSourcePrefix = label ? rawError.startsWith(label) : false
  const base =
    payload.source === 'upstream' && payload.upstreamStatus && !hasSourcePrefix
      ? `${label}返回 ${payload.upstreamStatus}：${rawError}`
      : label && !hasSourcePrefix
        ? `${label}返回：${rawError}`
        : rawError

  if (!payload.advice?.trim() || base.includes(payload.advice.trim())) {
    return base
  }

  return `${base}。建议：${payload.advice.trim()}`
}

function buildTransportError(
  status: number,
  bodyText: string,
  fallbackError: string,
): ApiResponseError {
  const payload: ApiErrorPayload = {
    source: 'proxy_or_transport',
    code: `http_${status}`,
    error:
      status === 413
        ? '请求体过大，可能被代理、网关或服务运行时拦截'
        : bodyText || `${fallbackError}（HTTP ${status}）`,
    advice:
      status === 413
        ? '请减少单次上传的图片数量，或联系管理员提高代理请求体上限'
        : '请稍后重试；如果持续出现，请检查网络、代理或服务日志',
  }

  return new ApiResponseError(
    formatApiErrorMessage(status, payload, fallbackError),
    status,
    payload,
  )
}

export async function readJsonResponse<T>(
  response: Response,
  fallbackError = '请求失败',
): Promise<T> {
  const text = await response.text()
  const trimmed = text.trim()
  let data: unknown = null

  if (trimmed) {
    try {
      data = JSON.parse(trimmed) as unknown
    } catch {
      if (!response.ok) {
        throw buildTransportError(response.status, trimmed, fallbackError)
      }
      throw new Error('服务器返回格式异常，请稍后重试')
    }
  }

  if (!response.ok) {
    const payload =
      data && typeof data === 'object'
        ? (data as ApiErrorPayload)
        : ({ error: `${fallbackError}（HTTP ${response.status}）` } satisfies ApiErrorPayload)
    throw new ApiResponseError(
      formatApiErrorMessage(response.status, payload, fallbackError),
      response.status,
      payload,
    )
  }

  if (!data) {
    throw new Error('服务器返回为空，请稍后重试')
  }

  return data as T
}
