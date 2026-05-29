/**
 * 阿里云 OSS 客户端。
 *
 * 对标 r2-client.ts，暴露最小 API（put / get / delete）。
 * 业务层通过 storage-adapter.ts 调用，不要直接 import。
 *
 * ECS 同区域走内网 endpoint（免费 + 极快），
 * 公网访问走 Bucket 公共读 URL（Gbps 级 CDN 带宽）。
 */

import OSS from 'ali-oss'

export class OssError extends Error {
  code: string
  httpStatus?: number
  constructor(init: { code: string; message: string; httpStatus?: number; cause?: unknown }) {
    super(init.message)
    this.name = 'OssError'
    this.code = init.code
    this.httpStatus = init.httpStatus
  }
}

export interface OssEnv {
  region: string
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  /** 内网 endpoint（ECS 同区域用） */
  internalEndpoint: string
  /** 公网访问 URL（浏览器加载图片用） */
  publicUrl: string
}

function readOssEnv(): OssEnv {
  const region = process.env.OSS_REGION?.trim() || 'oss-cn-hangzhou'
  return {
    region,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID?.trim() || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET?.trim() || '',
    bucket: process.env.OSS_BUCKET?.trim() || '',
    internalEndpoint: process.env.OSS_INTERNAL_ENDPOINT?.trim() || `${region}-internal.aliyuncs.com`,
    publicUrl: (process.env.OSS_PUBLIC_URL?.trim() || '').replace(/\/$/, ''),
  }
}

export function assertOssConfigured(): void {
  const env = readOssEnv()
  const missing: string[] = []
  if (!env.accessKeyId) missing.push('OSS_ACCESS_KEY_ID')
  if (!env.accessKeySecret) missing.push('OSS_ACCESS_KEY_SECRET')
  if (!env.bucket) missing.push('OSS_BUCKET')
  if (!env.publicUrl) missing.push('OSS_PUBLIC_URL')
  if (missing.length > 0) {
    throw new OssError({
      code: 'CONFIG_MISSING',
      message: `OSS 调用前缺少 env：${missing.join(', ')}`,
    })
  }
}

let cachedClient: OSS | null = null

function getClient(): OSS {
  if (cachedClient) return cachedClient
  assertOssConfigured()
  const env = readOssEnv()
  // 优先用内网 endpoint（同区域免费 + 快）
  const endpoint = env.internalEndpoint || `${env.region}-internal.aliyuncs.com`
  cachedClient = new OSS({
    region: env.region,
    accessKeyId: env.accessKeyId,
    accessKeySecret: env.accessKeySecret,
    bucket: env.bucket,
    endpoint,
    // 内网 endpoint 用 http 即可（更快、免 TLS 开销）
    secure: !endpoint.includes('-internal'),
    // 增加超时时间：默认 60 秒太短，网络不稳定时容易超时
    timeout: 300000, // 5 分钟
  })
  return cachedClient
}

export function __resetOssClientForTests(): void {
  cachedClient = null
}

export interface OssPutInput {
  key: string
  body: Buffer | Uint8Array | ArrayBuffer | string
  contentType?: string
  cacheControl?: string
}

export interface OssPutResult {
  key: string
  publicUrl: string
  bytes: number
}

export async function ossPut(input: OssPutInput): Promise<OssPutResult> {
  const client = getClient()
  const normalizedKey = input.key.replace(/^\//, '')

  let body: Buffer
  if (typeof input.body === 'string') {
    body = Buffer.from(input.body, 'utf-8')
  } else if (input.body instanceof ArrayBuffer) {
    body = Buffer.from(input.body)
  } else {
    body = Buffer.from(input.body as Uint8Array)
  }

  const options: Record<string, unknown> = {
    mime: input.contentType || 'application/octet-stream',
  }
  if (input.cacheControl) {
    options.headers = { 'Cache-Control': input.cacheControl }
  }

  try {
    await client.put(normalizedKey, body, options)
  } catch (cause: unknown) {
    const err = cause as { code?: string; status?: number; message?: string }
    throw new OssError({
      code: err.code || 'PUT_FAILED',
      message: `OSS PUT 失败（key=${normalizedKey}）：${err.message || String(cause)}`,
      httpStatus: err.status,
      cause,
    })
  }

  const env = readOssEnv()
  return {
    key: normalizedKey,
    publicUrl: `${env.publicUrl}/${normalizedKey}`,
    bytes: body.byteLength,
  }
}

export async function ossGet(
  key: string,
): Promise<{ body: ArrayBuffer; contentType?: string }> {
  const client = getClient()
  const normalizedKey = key.replace(/^\//, '')

  try {
    const result = await client.get(normalizedKey)
    return {
      body: result.content as ArrayBuffer,
      contentType: result.res?.headers?.['content-type'] ?? undefined,
    }
  } catch (cause: unknown) {
    const err = cause as { code?: string; status?: number; message?: string }
    if (err.code === 'NoSuchKey') {
      throw new OssError({ code: 'NOT_FOUND', message: `OSS 对象不存在：${normalizedKey}`, httpStatus: 404 })
    }
    throw new OssError({
      code: err.code || 'GET_FAILED',
      message: `OSS GET 失败（key=${normalizedKey}）：${err.message || String(cause)}`,
      httpStatus: err.status,
      cause,
    })
  }
}

export async function ossDelete(key: string): Promise<void> {
  const client = getClient()
  const normalizedKey = key.replace(/^\//, '')

  try {
    await client.delete(normalizedKey)
  } catch (cause: unknown) {
    const err = cause as { code?: string; status?: number; message?: string }
    // OSS delete 不存在的 key 不报错，忽略即可
    if (err.code === 'NoSuchKey') return
    throw new OssError({
      code: err.code || 'DELETE_FAILED',
      message: `OSS DELETE 失败（key=${normalizedKey}）：${err.message || String(cause)}`,
      httpStatus: err.status,
      cause,
    })
  }
}

export function buildOssPublicUrl(key: string): string {
  const env = readOssEnv()
  const normalizedKey = key.replace(/^\//, '')
  return `${env.publicUrl}/${normalizedKey}`
}
