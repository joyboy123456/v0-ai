/**
 * Cloudflare R2 S3-compatible 客户端。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR3 引入。仅暴露**最小** API（put / get / head / delete），
 * 业务层不应该直接 import 这个模块，而是通过 `storage-adapter.ts` 屏蔽 local vs cloud。
 *
 * 设计要点（参考 `prd.md §「Cloudflare 库选型」`）：
 * - 用 `aws4fetch` 做 SigV4 签名，体积 4KB，没有 Node 依赖，未来切 Edge Runtime 不用换。
 * - `service: 's3'` + `region: 'auto'`（R2 必须用 auto；其他 region 值会签名失败）。
 * - 错误统一抛 `R2Error`（继承 `CloudflareError` 风格），保持与 d1-client / kv-client 一致。
 * - 不带重试。R2 失败让上层业务（task-store / storage-adapter）决定怎么处理。
 *   image-retry / google-image-throttle 那套是给 Gemini Image 用的，R2 不复用。
 */

import { AwsClient } from 'aws4fetch'

import {
  CloudflareError,
  type CloudflareErrorCode,
  mapHttpStatusToCode,
} from '@/lib/server/cloudflare/shared'

export type R2ErrorCode = CloudflareErrorCode

export class R2Error extends CloudflareError {
  constructor(init: {
    code: R2ErrorCode
    message: string
    httpStatus?: number
    cause?: unknown
  }) {
    super(init)
    this.name = 'R2Error'
  }
}

export interface R2Env {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
  publicUrl: string
}

function readR2Env(): R2Env {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim() || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim() || '',
    endpoint: (process.env.R2_ENDPOINT?.trim() || '').replace(/\/$/, ''),
    bucket: process.env.R2_BUCKET?.trim() || '',
    publicUrl: (process.env.R2_PUBLIC_URL?.trim() || '').replace(/\/$/, ''),
  }
}

/**
 * cloud 模式调用 R2 之前用这个守卫。env 不全直接抛出，避免让 aws4fetch
 * 拿到空字符串 endpoint 产生晦涩的签名错误。
 */
export function assertR2Configured(): void {
  const env = readR2Env()
  const missing: string[] = []
  if (!env.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID')
  if (!env.accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!env.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY')
  if (!env.endpoint) missing.push('R2_ENDPOINT')
  if (!env.bucket) missing.push('R2_BUCKET')
  if (!env.publicUrl) missing.push('R2_PUBLIC_URL')
  if (missing.length > 0) {
    throw new R2Error({
      code: 'CONFIG_MISSING',
      message: `R2 调用前缺少 env：${missing.join(', ')}`,
    })
  }
}

let cachedClient: { client: AwsClient; env: R2Env } | null = null

function getClient(): { client: AwsClient; env: R2Env } {
  if (cachedClient) return cachedClient
  assertR2Configured()
  const env = readR2Env()
  const client = new AwsClient({
    accessKeyId: env.accessKeyId,
    secretAccessKey: env.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
  cachedClient = { client, env }
  return cachedClient
}

/**
 * 仅用于测试：清掉 cache，强制下次重新读 env。生产代码不要调用。
 */
export function __resetR2ClientForTests(): void {
  cachedClient = null
}

function buildObjectUrl(key: string): { url: string; publicUrl: string } {
  const { env } = getClient()
  // key 不允许以 / 开头；统一去前导 /
  const normalizedKey = key.replace(/^\//, '')
  return {
    url: `${env.endpoint}/${env.bucket}/${normalizedKey}`,
    publicUrl: `${env.publicUrl}/${normalizedKey}`,
  }
}

function byteLengthOf(
  body: Buffer | Uint8Array | ArrayBuffer | Blob | string,
): number {
  if (typeof body === 'string') {
    return Buffer.byteLength(body, 'utf8')
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return body.size
  }
  // Buffer / Uint8Array
  return (body as Uint8Array).byteLength
}

/**
 * 把 R2PutInput.body 规范化为 fetch 能正确推断 Content-Length 的形态。
 *
 * 为什么需要这一步：
 * - Cloudflare R2 的 S3 兼容 API 强制要求 `Content-Length`，**不接受**
 *   `Transfer-Encoding: chunked`。未设置 Content-Length 直接报
 *   HTTP 411 `MissingContentLength`。
 * - Node.js 18+ 的 undici fetch 在 body 类型「不够明确」时会走 chunked
 *   encoding（例如把 Buffer 当成 stream-like）。把 body 统一成 Uint8Array /
 *   Blob 后，undici 才会自动加上 Content-Length。
 * - 同时我们在 r2Put headers 里也显式带 `Content-Length`，让 aws4fetch 把
 *   它算入 SigV4 签名，双保险。
 */
function normalizeR2Body(
  body: Buffer | Uint8Array | ArrayBuffer | Blob | string,
): Uint8Array | Blob {
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return body
  }
  if (body instanceof Uint8Array) {
    // Buffer 是 Uint8Array 的子类，这一分支已覆盖 Buffer
    return body
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body)
  }
  // 类型上已穷尽；兜底抛错让上层立刻发现非法 body 类型，避免静默走 chunked
  throw new R2Error({
    code: 'BAD_REQUEST',
    message: `R2 PUT body 类型不支持：${Object.prototype.toString.call(body)}`,
  })
}

export interface R2PutInput {
  /** R2 object key（不要以 / 开头，例如 `users/abc/uploads/xxx.png`） */
  key: string
  body: Buffer | Uint8Array | ArrayBuffer | Blob | string
  contentType?: string
  cacheControl?: string
}

export interface R2PutResult {
  key: string
  publicUrl: string
  bytes: number
}

export async function r2Put(input: R2PutInput): Promise<R2PutResult> {
  const { client } = getClient()
  const { url, publicUrl } = buildObjectUrl(input.key)
  const bytes = byteLengthOf(input.body)
  const normalizedBody = normalizeR2Body(input.body)

  // 关键：R2 强制要求 Content-Length 且不支持 chunked transfer encoding。
  // 显式声明 Content-Length 让 aws4fetch SigV4 签名包含它，同时让 undici
  // 走定长 body 路径，规避 HTTP 411 MissingContentLength。
  const headers: Record<string, string> = {
    'Content-Type': input.contentType ?? 'application/octet-stream',
    'Content-Length': String(bytes),
  }
  if (input.cacheControl) headers['Cache-Control'] = input.cacheControl

  let response: Response
  try {
    response = await client.fetch(url, {
      method: 'PUT',
      headers,
      body: normalizedBody as BodyInit,
    })
  } catch (cause) {
    throw new R2Error({
      code: 'NETWORK_ERROR',
      message: `R2 PUT 网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new R2Error({
      code: mapHttpStatusToCode(response.status),
      message: `R2 PUT 失败 HTTP ${response.status}（key=${input.key}）：${text.slice(0, 300)}`,
      httpStatus: response.status,
    })
  }

  return {
    key: input.key.replace(/^\//, ''),
    publicUrl,
    bytes,
  }
}

export async function r2Get(
  key: string,
): Promise<{ body: ArrayBuffer; contentType?: string }> {
  const { client } = getClient()
  const { url } = buildObjectUrl(key)

  let response: Response
  try {
    response = await client.fetch(url, { method: 'GET' })
  } catch (cause) {
    throw new R2Error({
      code: 'NETWORK_ERROR',
      message: `R2 GET 网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  if (response.status === 404) {
    throw new R2Error({
      code: 'NOT_FOUND',
      message: `R2 对象不存在：${key}`,
      httpStatus: 404,
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new R2Error({
      code: mapHttpStatusToCode(response.status),
      message: `R2 GET 失败 HTTP ${response.status}（key=${key}）：${text.slice(0, 300)}`,
      httpStatus: response.status,
    })
  }

  const body = await response.arrayBuffer()
  return {
    body,
    contentType: response.headers.get('content-type') ?? undefined,
  }
}

export async function r2Head(
  key: string,
): Promise<{ exists: boolean; bytes?: number; contentType?: string }> {
  const { client } = getClient()
  const { url } = buildObjectUrl(key)

  let response: Response
  try {
    response = await client.fetch(url, { method: 'HEAD' })
  } catch (cause) {
    throw new R2Error({
      code: 'NETWORK_ERROR',
      message: `R2 HEAD 网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  if (response.status === 404) {
    return { exists: false }
  }
  if (!response.ok) {
    throw new R2Error({
      code: mapHttpStatusToCode(response.status),
      message: `R2 HEAD 失败 HTTP ${response.status}（key=${key}）`,
      httpStatus: response.status,
    })
  }

  const bytesRaw = response.headers.get('content-length')
  return {
    exists: true,
    bytes: bytesRaw ? Number(bytesRaw) : undefined,
    contentType: response.headers.get('content-type') ?? undefined,
  }
}

export async function r2Delete(key: string): Promise<void> {
  const { client } = getClient()
  const { url } = buildObjectUrl(key)

  let response: Response
  try {
    response = await client.fetch(url, { method: 'DELETE' })
  } catch (cause) {
    throw new R2Error({
      code: 'NETWORK_ERROR',
      message: `R2 DELETE 网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  // S3 DELETE 对不存在的 key 也返回 204，所以不需要单独 404 处理
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => '')
    throw new R2Error({
      code: mapHttpStatusToCode(response.status),
      message: `R2 DELETE 失败 HTTP ${response.status}（key=${key}）：${text.slice(0, 300)}`,
      httpStatus: response.status,
    })
  }
}

/**
 * 拼接 R2 公共 URL（业务侧偶尔需要从 key 反推 URL）。
 */
export function buildR2PublicUrl(key: string): string {
  const { env } = getClient()
  const normalizedKey = key.replace(/^\//, '')
  return `${env.publicUrl}/${normalizedKey}`
}
