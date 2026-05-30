/**
 * 即梦 AI 4.6 (Seedream 4.0) 图片生成 Adapter。
 *
 * 火山引擎视觉智能服务，接口特点：
 * - 异步调用：CVSync2AsyncSubmitTask → 轮询 CVSync2AsyncGetResult
 * - V4 签名鉴权：Region=cn-north-1, Service=cv
 * - 图片输入必须是公网 URL（需先上传到 OSS）
 * - 一次调用可能输出多张图
 *
 * 错误分类复用 GoogleImageError 体系，保持与 pool/router 统一处理。
 */

import type { ResultAsset } from '@/lib/types'
import {
  GoogleImageError,
  callGoogleImageWithRetry,
} from './google-image-retry'
import { resolveImageSize, type ResolvedImageSize } from './image-size-policy'
import { logImageEvent, type LogContext } from './log'
import { isLocal } from './storage-mode'
import { ossPut } from './storage/oss-client'

// ---- 常量 ----

const JIMENG_ENDPOINT = 'https://visual.volcengineapi.com'
const JIMENG_REGION = 'cn-north-1'
const JIMENG_SERVICE = 'cv'
const JIMENG_VERSION = '2022-08-31'
const JIMENG_REQ_KEY = 'jimeng_seedream46_cvtob'
const POLL_INTERVAL_MS = 3000
const JIMENG_MAX_PIXELS = 4096 * 4096

// ---- 输入接口 ----

export interface JimengEditInput {
  taskId: string
  apiKey: string            // 即梦用 accessKeyId:secretKey 格式
  baseUrl?: string
  model: string
  timeoutMs: number
  prompt: string
  inputImages: string[]     // data URL 数组，需上传到 OSS 转公网 URL
  count: number
  aspectRatio?: string
  imageSize?: string
  resolvedSize?: ResolvedImageSize
  traceId?: string
  shotId?: string
  providerId?: string
  maxIpm?: number
  maxRpm?: number
}

// ---- 即梦 API 类型 ----

interface JimengSubmitResponse {
  code: number
  data?: { task_id: string }
  message?: string
  request_id?: string
}

interface JimengResultResponse {
  code: number
  data?: {
    binary_data_base64?: string[]
    image_urls?: string[]
    status: string
  }
  message?: string
  request_id?: string
}

// ---- V4 签名 ----

async function hmacSha256(key: Buffer, message: string): Promise<Buffer> {
  const { createHmac } = await import('crypto')
  return createHmac('sha256', key).update(message).digest()
}

async function sha256Hex(data: string): Promise<string> {
  const { createHash } = await import('crypto')
  return createHash('sha256').update(data).digest('hex')
}

async function signV4(
  method: string,
  pathname: string,
  query: Record<string, string>,
  body: string,
  accessKeyId: string,
  secretKey: string,
  region: string,
  service: string,
): Promise<Record<string, string>> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const amzDate = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const dateStamp = amzDate.slice(0, 8)
  const host = 'visual.volcengineapi.com'

  const sortedQuery = Object.keys(query).sort()
  const canonicalQueryString = sortedQuery.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&')
  const payloadHash = await sha256Hex(body)
  const contentType = 'application/json'

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${amzDate}`,
  ].join('\n') + '\n'

  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalRequest = [method, pathname, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/request`
  const stringToSign = ['HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n')

  const kDate = await hmacSha256(Buffer.from(secretKey), dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'request')
  const { createHmac } = await import('crypto')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  return {
    'Authorization': `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    'Host': host,
    'X-Date': amzDate,
    'X-Content-Sha256': payloadHash,
  }
}

// ---- 即梦 API 调用 ----

async function submitTask(
  accessKeyId: string,
  secretKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const query = { Action: 'CVSync2AsyncSubmitTask', Version: JIMENG_VERSION }
  const bodyStr = JSON.stringify(body)
  const headers = await signV4('POST', '/', query, bodyStr, accessKeyId, secretKey, JIMENG_REGION, JIMENG_SERVICE)
  const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(`${JIMENG_ENDPOINT}?${qs}`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    })
    const data: JimengSubmitResponse = await resp.json()
    if (data.code !== 10000 || !data.data?.task_id) {
      throw new GoogleImageError({
        category: data.code === 50412 || data.code === 50413 ? 'bad_request' : (data.code === 50429 || data.code === 50430 ? 'rate_limit' : 'server_error'),
        message: `即梦提交任务失败（code=${data.code}）：${data.message || 'unknown'}`,
        retryable: data.code === 50429 || data.code === 50430,
      })
    }
    return data.data.task_id
  } finally {
    clearTimeout(timer)
  }
}

async function pollResult(
  accessKeyId: string,
  secretKey: string,
  taskId: string,
  timeoutMs: number,
): Promise<{ images: string[] }> {
  const deadline = Date.now() + timeoutMs
  const bodyStr = JSON.stringify({ req_key: JIMENG_REQ_KEY, task_id: taskId })
  const query = { Action: 'CVSync2AsyncGetResult', Version: JIMENG_VERSION }

  while (Date.now() < deadline) {
    const headers = await signV4('POST', '/', query, bodyStr, accessKeyId, secretKey, JIMENG_REGION, JIMENG_SERVICE)
    const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

    const resp = await fetch(`${JIMENG_ENDPOINT}?${qs}`, { method: 'POST', headers, body: bodyStr })
    const data: JimengResultResponse = await resp.json()

    if (data.code !== 10000) {
      if (data.code === 50429 || data.code === 50430) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
        continue
      }
      throw new GoogleImageError({
        category: 'server_error',
        message: `即梦查询任务失败（code=${data.code}）：${data.message || 'unknown'}`,
      })
    }

    const status = data.data?.status
    if (status === 'done') {
      const images: string[] = []
      if (data.data?.image_urls?.length) {
        for (const url of data.data.image_urls) images.push(url)
      }
      if (data.data?.binary_data_base64?.length) {
        for (const b64 of data.data.binary_data_base64) {
          if (b64) images.push(`data:image/png;base64,${b64}`)
        }
      }
      if (!images.length) {
        throw new GoogleImageError({ category: 'empty_output', message: '即梦返回 done 但无图片', retryable: true })
      }
      return { images }
    }

    if (status === 'not_found' || status === 'expired') {
      throw new GoogleImageError({ category: 'bad_request', message: `即梦任务状态：${status}`, retryable: false })
    }

    // in_queue / generating → 继续轮询
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }

  throw new GoogleImageError({ category: 'network', message: `即梦任务超时（${timeoutMs}ms）`, retryable: true })
}

// ---- 图片输入 URL 解析 ----

async function resolveImageUrl(imageUrl: string, key: string): Promise<string> {
  // 已经是 HTTP/HTTPS URL，直接返回
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl
  }

  // 即梦老接口只接受火山服务端可访问的公网 URL。local 模式的本地文件 URL
  // 无法被火山拉取，也不应偷偷上传到 OSS。
  if (isLocal()) {
    throw new GoogleImageError({
      category: 'bad_request',
      message:
        '即梦 Seedream 4.6 图生图需要公网参考图；当前 STORAGE_MODE=local，本地上传图不能传给即梦。请切换到支持 data URL 的模型，或在线上 ECS + OSS 模式下使用即梦。',
      retryable: false,
    })
  }

  // oss 模式：data URL 上传到 OSS 获取公网 URL
  const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new GoogleImageError({
      category: 'bad_request',
      message: '即梦输入图不是有效的 HTTP URL 或 data URL',
      retryable: false,
    })
  }
  const mime = match[1]
  const buffer = Buffer.from(match[2], 'base64')
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  const result = await ossPut({ key: `${key}.${ext}`, body: buffer, contentType: mime })
  return result.publicUrl
}

// ---- 解析 apiKey ----

function parseCredentials(apiKey: string): { accessKeyId: string; secretKey: string } {
  const parts = apiKey.split(':')
  if (parts.length === 2) return { accessKeyId: parts[0], secretKey: parts[1] }
  return { accessKeyId: apiKey, secretKey: process.env.JIMENG_SECRET_KEY || '' }
}

// ---- 主函数 ----

export async function runJimengImageEdit(input: JimengEditInput): Promise<ResultAsset[]> {
  const { accessKeyId, secretKey } = parseCredentials(input.apiKey)
  if (!accessKeyId || !secretKey) {
    throw new GoogleImageError({ category: 'auth_failed', message: '即梦 AccessKey/SecretKey 未配置', retryable: false })
  }

  const traceId = input.traceId ?? input.taskId
  const ctx: LogContext = { traceId, taskId: input.taskId, shotId: input.shotId }
  const resolvedSize =
    input.resolvedSize ?? resolveImageSize(input.aspectRatio, input.imageSize)
  const results: ResultAsset[] = []

  logImageEvent('gimg.attempt', ctx, {
    adapter: 'jimeng', stage: 'enter', model: input.model,
    count: input.count, promptLen: input.prompt.length, refs: input.inputImages.length,
    aspect: resolvedSize.ratio,
    size: resolvedSize.size,
    resolution: resolvedSize.resolution,
  })

  // 上传输入图片到 OSS
  let imageUrls: string[] = []
  if (input.inputImages.length > 0) {
    imageUrls = await Promise.all(
      input.inputImages.map((dataUrl, i) =>
        resolveImageUrl(dataUrl, `jimeng-input/${input.taskId}/${i}`)
      )
    )
  }

  // 串行调用（即梦一次可能返回多张，但为了控制 count 用 force_single）
  for (let i = 0; i < input.count; i++) {
    const iterTraceId = input.count > 1 ? `${traceId}_v${i + 1}` : traceId

    const result = await callGoogleImageWithRetry(
      async () => {
        const callStart = Date.now()
        const requestBody: Record<string, unknown> = {
          req_key: JIMENG_REQ_KEY,
          prompt: input.prompt,
          force_single: true,
          size: Math.min(resolvedSize.pixels, JIMENG_MAX_PIXELS),
          width: resolvedSize.width,
          height: resolvedSize.height,
          return_url: true,
        }
        if (imageUrls.length > 0) requestBody.image_urls = imageUrls

        logImageEvent('gimg.attempt', { ...ctx, traceId: iterTraceId }, {
          adapter: 'jimeng',
          iteration: i + 1,
          providerId: input.providerId,
          size: resolvedSize.size,
          width: resolvedSize.width,
          height: resolvedSize.height,
        })

        const taskId = await submitTask(accessKeyId, secretKey, requestBody, input.timeoutMs)
        const { images } = await pollResult(accessKeyId, secretKey, taskId, input.timeoutMs - (Date.now() - callStart))

        logImageEvent('gimg.success', { ...ctx, traceId: iterTraceId }, {
          adapter: 'jimeng', tookMs: Date.now() - callStart, items: images.length, providerId: input.providerId,
        })

        return images
      },
      { ...ctx, traceId: iterTraceId },
      {
        apiKey: input.apiKey,
        providerId: input.providerId,
        maxIpm: input.maxIpm,
        maxRpm: input.maxRpm,
      },
      {
        attempts: 3,
        perCategoryMaxAttempts: { server_error: 1, rate_limit: 3 },
      },
    )

    for (let j = 0; j < result.length; j++) {
      const imageUrl = result[j]
      const idx = results.length
      results.push({
        assetId: `result_${input.taskId}_${idx}`,
        url: imageUrl,
        downloadUrl: imageUrl,
        width: 0,
        height: 0,
        shotId: input.shotId,
        metadata: {
          provider: 'jimeng',
          model: input.model,
          requestedSize: resolvedSize.size,
          requestedResolution: resolvedSize.resolution,
          requestedRatio: resolvedSize.ratio,
        },
      })
    }
  }

  return results
}
