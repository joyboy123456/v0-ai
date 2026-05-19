/**
 * Cloudflare REST API 客户端共享：错误类型 + env 守卫。
 *
 * 设计要点（PRD §「Cloudflare 库选型」/ §「关键技术风险」）：
 * - 不引重试逻辑（单调用失败让上层 service 决定怎么处理；image-retry 那套是
 *   Google 图像 API 专属的）
 * - 不暴露 axios / undici 等额外依赖，直接 `fetch`
 * - env 校验集中在 `assertCloudflareConfigured`，cloud 模式启动时先 fail-fast
 */

export type CloudflareErrorCode =
  | 'CONFIG_MISSING'
  | 'NETWORK_ERROR'
  | 'AUTH_FAILED'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  | 'UNKNOWN'

export interface CloudflareErrorInit {
  code: CloudflareErrorCode
  message: string
  httpStatus?: number
  cause?: unknown
}

export class CloudflareError extends Error {
  code: CloudflareErrorCode
  httpStatus?: number

  constructor(init: CloudflareErrorInit) {
    super(init.message)
    this.name = 'CloudflareError'
    this.code = init.code
    this.httpStatus = init.httpStatus
    if (init.cause) {
      ;(this as Error & { cause?: unknown }).cause = init.cause
    }
  }
}

export function readCloudflareEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || ''
  const token = process.env.CLOUDFLARE_D1_KV_TOKEN?.trim() || ''
  const d1DatabaseId = process.env.D1_DATABASE_ID?.trim() || ''
  const kvNamespaceId = process.env.KV_NAMESPACE_ID?.trim() || ''
  return { accountId, token, d1DatabaseId, kvNamespaceId }
}

/**
 * 在 cloud 模式下调用 D1 / KV REST API 之前调用。env 不全直接抛出，避免
 * 让 fetch 拿到空字符串 endpoint 产生晦涩 404。
 */
export function assertCloudflareConfigured(scope: 'd1' | 'kv'): void {
  const { accountId, token, d1DatabaseId, kvNamespaceId } = readCloudflareEnv()
  const missing: string[] = []
  if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID')
  if (!token) missing.push('CLOUDFLARE_D1_KV_TOKEN')
  if (scope === 'd1' && !d1DatabaseId) missing.push('D1_DATABASE_ID')
  if (scope === 'kv' && !kvNamespaceId) missing.push('KV_NAMESPACE_ID')
  if (missing.length > 0) {
    throw new CloudflareError({
      code: 'CONFIG_MISSING',
      message: `Cloudflare ${scope} 调用前缺少 env：${missing.join(', ')}`,
    })
  }
}

/**
 * 把 HTTP status 翻译成 CloudflareErrorCode。
 */
export function mapHttpStatusToCode(status: number): CloudflareErrorCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED'
  if (status === 404) return 'NOT_FOUND'
  if (status >= 500) return 'SERVER_ERROR'
  if (status >= 400) return 'BAD_REQUEST'
  return 'UNKNOWN'
}
