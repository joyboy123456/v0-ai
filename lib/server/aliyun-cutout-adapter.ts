import { createHmac, randomUUID } from 'node:crypto'

import OSS from 'ali-oss'
import sharp from 'sharp'

import { proxyFetch } from '@/lib/server/proxy-fetch'
import { downloadSafeRemoteImage } from '@/lib/server/safe-remote-image'

export const ALIYUN_CUTOUT_MAX_INPUT_BYTES = 3_000_000
export const ALIYUN_CUTOUT_MAX_EDGE = 1999
export const ALIYUN_CUTOUT_MIN_EDGE = 33

const ALIYUN_IMAGESEG_VERSION = '2019-12-30'
const ALIYUN_VIAPI_UTILS_VERSION = '2020-04-01'
const ALIYUN_REGION_ID = 'cn-shanghai'
const DEFAULT_IMAGESEG_ENDPOINT = 'https://imageseg.cn-shanghai.aliyuncs.com'
const DEFAULT_VIAPI_UTILS_ENDPOINT = 'https://viapiutils.cn-shanghai.aliyuncs.com'
const VIAPI_TEMP_OSS_ENDPOINT = 'https://oss-cn-shanghai.aliyuncs.com'
const VIAPI_TEMP_BUCKET = 'viapi-customer-temp'
const MAX_SOURCE_PIXELS = 80_000_000
const MAX_RESULT_BYTES = 80_000_000
const DEFAULT_TIMEOUT_MS = 60_000
const JPEG_QUALITIES = [90, 82, 74, 66, 58, 50, 42]

export type AliyunCutoutErrorCategory =
  | 'config'
  | 'auth'
  | 'invalid_input'
  | 'no_subject'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'invalid_result'

export class AliyunCutoutProviderError extends Error {
  category: AliyunCutoutErrorCategory
  retryable: boolean
  httpStatus?: number
  upstreamCode?: string
  requestId?: string
  cause?: unknown

  constructor(input: {
    category: AliyunCutoutErrorCategory
    message: string
    retryable: boolean
    httpStatus?: number
    upstreamCode?: string
    requestId?: string
    cause?: unknown
  }) {
    super(input.message)
    this.name = 'AliyunCutoutProviderError'
    this.category = input.category
    this.retryable = input.retryable
    this.httpStatus = input.httpStatus
    this.upstreamCode = input.upstreamCode
    this.requestId = input.requestId
    this.cause = input.cause
  }
}

export interface PreparedAliyunCutoutInput {
  buffer: Buffer
  width: number
  height: number
  originalWidth: number
  originalHeight: number
}

export interface AliyunCutoutResult {
  pngBuffer: Buffer
  requestId: string
  operation: 'SegmentCommonImage'
  outputWidth: number
  outputHeight: number
  inputWidth: number
  inputHeight: number
  inputBytes: number
  durationMs: number
}

interface AliyunCutoutConfig {
  accessKeyId: string
  accessKeySecret: string
  imagesegEndpoint: string
  viapiUtilsEndpoint: string
  timeoutMs: number
}

interface AliyunRpcRequest {
  endpoint: string
  action: string
  version: string
  accessKeyId: string
  accessKeySecret: string
  parameters?: Record<string, string>
  timeoutMs: number
  fetchImpl?: typeof fetch
  now?: Date
  nonce?: string
}

interface AliyunRpcResponse {
  payload: Record<string, unknown>
  requestId?: string
}

interface AliyunCutoutDependencies {
  uploadPreparedInput?: (
    input: PreparedAliyunCutoutInput,
    config: AliyunCutoutConfig,
  ) => Promise<string>
  segmentImage?: (
    imageUrl: string,
    config: AliyunCutoutConfig,
  ) => Promise<{ imageUrl: string; requestId: string }>
  downloadResult?: (url: string, timeoutMs: number) => Promise<Buffer>
}

/** 阿里云 POP 签名要求的 RFC3986 编码，encodeURIComponent 默认不会编码 !'()*。 */
export function aliyunPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function buildAliyunRpcSignature(input: {
  method: 'GET' | 'POST'
  parameters: Record<string, string>
  accessKeySecret: string
}): {
  canonicalQuery: string
  stringToSign: string
  signature: string
  signedQuery: string
} {
  const canonicalQuery = Object.entries(input.parameters)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, value]) =>
        `${aliyunPercentEncode(key)}=${aliyunPercentEncode(value)}`,
    )
    .join('&')
  const stringToSign = [
    input.method,
    aliyunPercentEncode('/'),
    aliyunPercentEncode(canonicalQuery),
  ].join('&')
  const signature = createHmac('sha1', `${input.accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64')

  return {
    canonicalQuery,
    stringToSign,
    signature,
    signedQuery: `${canonicalQuery}&Signature=${aliyunPercentEncode(signature)}`,
  }
}

export function buildViapiTempObjectName(
  accessKeyId: string,
  nonce: string = randomUUID(),
): string {
  return `${accessKeyId}/${nonce}-cutout-input.jpg`
}

export function buildSegmentCommonImageParameters(
  imageUrl: string,
): Record<string, string> {
  // 默认返回保持尺寸的四通道 PNG；禁止传 ReturnForm=crop，避免改变画布。
  return { ImageURL: imageUrl }
}

export async function callAliyunRpc(
  input: AliyunRpcRequest,
): Promise<AliyunRpcResponse> {
  const endpoint = normalizeHttpsEndpoint(input.endpoint)
  const timestamp = (input.now ?? new Date())
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
  const parameters: Record<string, string> = {
    AccessKeyId: input.accessKeyId,
    Action: input.action,
    Format: 'JSON',
    RegionId: ALIYUN_REGION_ID,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: input.nonce ?? randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: timestamp,
    Version: input.version,
    ...input.parameters,
  }
  delete parameters.Signature

  const { signedQuery } = buildAliyunRpcSignature({
    method: 'POST',
    parameters,
    accessKeySecret: input.accessKeySecret,
  })
  const url = `${endpoint}/?${signedQuery}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)

  let response: Response
  try {
    response = await (input.fetchImpl ?? proxyFetch)(url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (error) {
    const timedOut = controller.signal.aborted || isAbortError(error)
    throw new AliyunCutoutProviderError({
      category: timedOut ? 'timeout' : 'network',
      message: timedOut ? '阿里云抠图请求超时' : '无法连接阿里云抠图服务',
      retryable: true,
      cause: error,
    })
  } finally {
    clearTimeout(timeout)
  }

  const payload = await readJsonObject(response)
  const requestId = readString(payload.RequestId)
  const upstreamCode = readString(payload.Code)
  if (!response.ok || upstreamCode) {
    throw createRpcResponseError({
      status: response.status,
      code: upstreamCode,
      message: readString(payload.Message),
      requestId,
    })
  }

  return { payload, requestId }
}

export async function prepareAliyunCutoutInput(input: {
  sourceBuffer: Buffer
  originalWidth: number
  originalHeight: number
}): Promise<PreparedAliyunCutoutInput> {
  const originalWidth = readCanvasDimension(input.originalWidth)
  const originalHeight = readCanvasDimension(input.originalHeight)
  if (
    originalWidth < ALIYUN_CUTOUT_MIN_EDGE ||
    originalHeight < ALIYUN_CUTOUT_MIN_EDGE
  ) {
    throw new AliyunCutoutProviderError({
      category: 'invalid_input',
      message: '图片尺寸过小，宽高都需要大于 32 像素',
      retryable: false,
    })
  }

  let scale = Math.min(
    1,
    ALIYUN_CUTOUT_MAX_EDGE / originalWidth,
    ALIYUN_CUTOUT_MAX_EDGE / originalHeight,
  )

  try {
    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      const width = Math.max(1, Math.floor(originalWidth * scale))
      const height = Math.max(1, Math.floor(originalHeight * scale))
      if (
        width < ALIYUN_CUTOUT_MIN_EDGE ||
        height < ALIYUN_CUTOUT_MIN_EDGE
      ) {
        throw new AliyunCutoutProviderError({
          category: 'invalid_input',
          message: '图片比例过于狭长，无法满足抠图服务的尺寸要求',
          retryable: false,
        })
      }

      const normalized = await sharp(input.sourceBuffer, {
        failOn: 'error',
        limitInputPixels: MAX_SOURCE_PIXELS,
      })
        .rotate()
        .resize(width, height, { fit: 'fill' })
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true })

      let smallestBuffer: Buffer | null = null
      for (const quality of JPEG_QUALITIES) {
        const candidate = await sharp(normalized.data, {
          raw: normalized.info,
        })
          .jpeg({ quality, chromaSubsampling: '4:4:4' })
          .toBuffer()
        smallestBuffer = candidate
        if (candidate.byteLength <= ALIYUN_CUTOUT_MAX_INPUT_BYTES) {
          return {
            buffer: candidate,
            width,
            height,
            originalWidth,
            originalHeight,
          }
        }
      }

      if (!smallestBuffer) break
      const nextScale =
        scale *
        Math.min(
          0.9,
          Math.sqrt(
            (ALIYUN_CUTOUT_MAX_INPUT_BYTES * 0.94) /
              smallestBuffer.byteLength,
          ),
        )
      if (!Number.isFinite(nextScale) || nextScale >= scale) break
      scale = nextScale
    }
  } catch (error) {
    if (error instanceof AliyunCutoutProviderError) throw error
    throw new AliyunCutoutProviderError({
      category: 'invalid_input',
      message: '原图无法解析或尺寸过大，请换一张有效图片后重试',
      retryable: false,
      cause: error,
    })
  }

  throw new AliyunCutoutProviderError({
    category: 'invalid_input',
    message: '图片预处理后仍超过 3 MB，请换一张内容更简单的图片后重试',
    retryable: false,
  })
}

export async function readSourceCanvasDimensions(
  sourceBuffer: Buffer,
): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(sourceBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_SOURCE_PIXELS,
    }).metadata()
    const rawWidth = metadata.width ?? 0
    const rawHeight = metadata.height ?? 0
    if (rawWidth <= 0 || rawHeight <= 0) {
      throw new Error('图片缺少有效宽高')
    }
    const shouldSwap =
      metadata.orientation !== undefined &&
      metadata.orientation >= 5 &&
      metadata.orientation <= 8
    return shouldSwap
      ? { width: rawHeight, height: rawWidth }
      : { width: rawWidth, height: rawHeight }
  } catch (error) {
    throw new AliyunCutoutProviderError({
      category: 'invalid_input',
      message: '原图无法解析或尺寸过大，请换一张有效图片后重试',
      retryable: false,
      cause: error,
    })
  }
}

export async function restoreCutoutToOriginalCanvas(input: {
  sourceBuffer: Buffer
  providerResultBuffer: Buffer
  originalWidth: number
  originalHeight: number
}): Promise<Buffer> {
  const width = readCanvasDimension(input.originalWidth)
  const height = readCanvasDimension(input.originalHeight)

  try {
    const resultMetadata = await sharp(input.providerResultBuffer).metadata()
    if (!resultMetadata.width || !resultMetadata.height || !resultMetadata.hasAlpha) {
      throw new AliyunCutoutProviderError({
        category: 'invalid_result',
        message: '抠图服务未返回透明 PNG，请重试',
        retryable: true,
      })
    }

    const alpha = await sharp(input.providerResultBuffer)
      .extractChannel('alpha')
      .resize(width, height, { fit: 'fill' })
      .raw()
      .toBuffer()
    let foregroundPixels = 0
    for (const value of alpha) {
      if (value > 8) foregroundPixels += 1
    }
    const minimumForegroundPixels = Math.max(16, Math.floor(width * height * 0.00005))
    if (foregroundPixels < minimumForegroundPixels) {
      throw new AliyunCutoutProviderError({
        category: 'no_subject',
        message: '没有识别到清晰主体，请换一张主体更完整的图片后重试',
        retryable: false,
      })
    }

    const alphaImage = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#ffffff',
      },
    })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()

    const output = await sharp(input.sourceBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_SOURCE_PIXELS,
    })
      .rotate()
      .resize(width, height, { fit: 'fill' })
      .ensureAlpha()
      .composite([{ input: alphaImage, blend: 'dest-in' }])
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer()
    const outputMetadata = await sharp(output).metadata()
    if (
      outputMetadata.width !== width ||
      outputMetadata.height !== height ||
      !outputMetadata.hasAlpha
    ) {
      throw new Error('输出图片画布校验失败')
    }
    return output
  } catch (error) {
    if (error instanceof AliyunCutoutProviderError) throw error
    throw new AliyunCutoutProviderError({
      category: 'invalid_result',
      message: '抠图结果处理失败，请重试',
      retryable: true,
      cause: error,
    })
  }
}

export async function runAliyunCommonCutout(
  input: {
    sourceBuffer: Buffer
  },
  dependencies: AliyunCutoutDependencies = {},
): Promise<AliyunCutoutResult> {
  const startedAt = Date.now()
  const config = readAliyunCutoutConfig()
  const sourceDimensions = await readSourceCanvasDimensions(input.sourceBuffer)
  const prepared = await prepareAliyunCutoutInput({
    sourceBuffer: input.sourceBuffer,
    originalWidth: sourceDimensions.width,
    originalHeight: sourceDimensions.height,
  })
  const uploadPreparedInput =
    dependencies.uploadPreparedInput ?? uploadViapiTemporaryInput
  const segmentImage = dependencies.segmentImage ?? segmentCommonImage
  const downloadResult = dependencies.downloadResult ?? downloadCutoutResult

  const inputUrl = await uploadPreparedInput(prepared, config)
  const segmented = await segmentImage(inputUrl, config)
  const resultBuffer = await downloadResult(segmented.imageUrl, config.timeoutMs)
  const pngBuffer = await restoreCutoutToOriginalCanvas({
    sourceBuffer: input.sourceBuffer,
    providerResultBuffer: resultBuffer,
    originalWidth: prepared.originalWidth,
    originalHeight: prepared.originalHeight,
  })

  const durationMs = Date.now() - startedAt
  console.info('[asset-cutout] 阿里云抠图完成', {
    requestId: segmented.requestId,
    operation: 'SegmentCommonImage',
    outputWidth: prepared.originalWidth,
    outputHeight: prepared.originalHeight,
    inputWidth: prepared.width,
    inputHeight: prepared.height,
    inputBytes: prepared.buffer.byteLength,
    durationMs,
  })
  return {
    pngBuffer,
    requestId: segmented.requestId,
    operation: 'SegmentCommonImage',
    outputWidth: prepared.originalWidth,
    outputHeight: prepared.originalHeight,
    inputWidth: prepared.width,
    inputHeight: prepared.height,
    inputBytes: prepared.buffer.byteLength,
    durationMs,
  }
}

async function uploadViapiTemporaryInput(
  input: PreparedAliyunCutoutInput,
  config: AliyunCutoutConfig,
): Promise<string> {
  const response = await callAliyunRpc({
    endpoint: config.viapiUtilsEndpoint,
    action: 'GetOssStsToken',
    version: ALIYUN_VIAPI_UTILS_VERSION,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    timeoutMs: config.timeoutMs,
  })
  const data = readObject(response.payload.Data)
  const stsAccessKeyId = readString(data?.AccessKeyId)
  const stsAccessKeySecret = readString(data?.AccessKeySecret)
  const stsToken = readString(data?.SecurityToken)
  if (!stsAccessKeyId || !stsAccessKeySecret || !stsToken) {
    throw new AliyunCutoutProviderError({
      category: 'invalid_result',
      message: '阿里云临时上传凭证无效，请稍后重试',
      retryable: true,
      requestId: response.requestId,
    })
  }

  const objectName = buildViapiTempObjectName(config.accessKeyId)
  try {
    const client = new OSS({
      region: 'oss-cn-shanghai',
      endpoint: VIAPI_TEMP_OSS_ENDPOINT,
      accessKeyId: stsAccessKeyId,
      accessKeySecret: stsAccessKeySecret,
      stsToken,
      bucket: VIAPI_TEMP_BUCKET,
      secure: true,
      timeout: config.timeoutMs,
    })
    await client.put(objectName, input.buffer, { mime: 'image/jpeg' })
  } catch (error) {
    throw new AliyunCutoutProviderError({
      category: 'network',
      message: '抠图输入图片临时上传失败，请重试',
      retryable: true,
      cause: error,
    })
  }

  return `https://${VIAPI_TEMP_BUCKET}.oss-cn-shanghai.aliyuncs.com/${objectName}`
}

async function segmentCommonImage(
  imageUrl: string,
  config: AliyunCutoutConfig,
): Promise<{ imageUrl: string; requestId: string }> {
  const response = await callAliyunRpc({
    endpoint: config.imagesegEndpoint,
    action: 'SegmentCommonImage',
    version: ALIYUN_IMAGESEG_VERSION,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    parameters: buildSegmentCommonImageParameters(imageUrl),
    timeoutMs: config.timeoutMs,
  })
  const data = readObject(response.payload.Data)
  const resultUrl = readString(data?.ImageURL)
  if (!resultUrl || !response.requestId) {
    throw new AliyunCutoutProviderError({
      category: 'invalid_result',
      message: '阿里云抠图服务未返回有效结果，请重试',
      retryable: true,
      requestId: response.requestId,
    })
  }
  return { imageUrl: resultUrl, requestId: response.requestId }
}

async function downloadCutoutResult(
  url: string,
  timeoutMs: number,
): Promise<Buffer> {
  try {
    const downloaded = await downloadSafeRemoteImage(url, {
      maxBytes: MAX_RESULT_BYTES,
      timeoutMs,
      allowedProtocols: ['https:', 'http:'],
    })
    return downloaded.buffer
  } catch (error) {
    throw new AliyunCutoutProviderError({
      category: isAbortError(error) ? 'timeout' : 'network',
      message: isAbortError(error)
        ? '抠图结果下载超时，请重试'
        : '抠图结果下载失败，请重试',
      retryable: true,
      cause: error,
    })
  }
}

function readAliyunCutoutConfig(): AliyunCutoutConfig {
  const credentials = readAliyunCredentialPair()
  if (!credentials) {
    throw new AliyunCutoutProviderError({
      category: 'config',
      message:
        '抠图服务尚未配置，请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET',
      retryable: false,
    })
  }

  return {
    ...credentials,
    imagesegEndpoint:
      process.env.ALIYUN_VIAPI_IMAGESEG_ENDPOINT?.trim() ||
      DEFAULT_IMAGESEG_ENDPOINT,
    viapiUtilsEndpoint:
      process.env.ALIYUN_VIAPI_UTILS_ENDPOINT?.trim() ||
      DEFAULT_VIAPI_UTILS_ENDPOINT,
    timeoutMs: readPositiveInteger(
      process.env.ALIYUN_CUTOUT_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
  }
}

function readAliyunCredentialPair(): {
  accessKeyId: string
  accessKeySecret: string
} | null {
  const candidates = [
    [
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    ],
    [
      process.env.ALIYUN_VIAPI_ACCESS_KEY_ID,
      process.env.ALIYUN_VIAPI_ACCESS_KEY_SECRET,
    ],
    [process.env.OSS_ACCESS_KEY_ID, process.env.OSS_ACCESS_KEY_SECRET],
  ]
  for (const [rawId, rawSecret] of candidates) {
    const accessKeyId = rawId?.trim()
    const accessKeySecret = rawSecret?.trim()
    if (accessKeyId && accessKeySecret) return { accessKeyId, accessKeySecret }
  }
  return null
}

function normalizeHttpsEndpoint(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    throw new AliyunCutoutProviderError({
      category: 'config',
      message: '阿里云抠图服务 Endpoint 配置无效',
      retryable: false,
    })
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AliyunCutoutProviderError({
      category: 'config',
      message: '阿里云抠图服务 Endpoint 必须是 HTTPS 域名',
      retryable: false,
    })
  }
  return parsed.origin
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    return readObject(value) ?? {}
  } catch (error) {
    throw new AliyunCutoutProviderError({
      category: 'invalid_result',
      message: '阿里云抠图服务返回了无法解析的数据，请重试',
      retryable: true,
      httpStatus: response.status,
      cause: error,
    })
  }
}

function createRpcResponseError(input: {
  status: number
  code?: string
  message?: string
  requestId?: string
}): AliyunCutoutProviderError {
  const code = input.code ?? ''
  const normalizedCode = code.toLowerCase()
  const normalizedMessage = input.message?.toLowerCase() ?? ''
  let category: AliyunCutoutErrorCategory = 'server_error'
  let retryable = true
  let message = '阿里云抠图服务暂时不可用，请稍后重试'

  if (
    input.status === 401 ||
    input.status === 403 ||
    /auth|forbidden|invalidaccesskey|signature|ramrole|permission/.test(
      normalizedCode,
    )
  ) {
    category = 'auth'
    retryable = false
    message = '抠图服务鉴权失败，请联系管理员检查阿里云权限配置'
  } else if (
    input.status === 429 ||
    /throttl|ratelimit|quota|flowcontrol/.test(normalizedCode)
  ) {
    category = 'rate_limit'
    message = '抠图服务当前繁忙，请稍后重试'
  } else if (
    /notfound(face|object|subject)|no.?subject|no.?object/.test(
      `${normalizedCode} ${normalizedMessage}`,
    )
  ) {
    category = 'no_subject'
    retryable = false
    message = '没有识别到清晰主体，请换一张主体更完整的图片后重试'
  } else if (
    /invalid(image|file|parameter)|illegalargument|unsupported|too.?large/.test(
      normalizedCode,
    )
  ) {
    category = 'invalid_input'
    retryable = false
    message = '图片内容或格式不受支持，请换一张有效图片后重试'
  } else if (input.status >= 400 && input.status < 500) {
    category = 'invalid_input'
    retryable = false
    message = '抠图请求参数无效，请换一张图片后重试'
  }

  return new AliyunCutoutProviderError({
    category,
    message,
    retryable,
    httpStatus: input.status,
    upstreamCode: input.code,
    requestId: input.requestId,
  })
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readCanvasDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new AliyunCutoutProviderError({
      category: 'invalid_input',
      message: '原图尺寸无效，无法抠图',
      retryable: false,
    })
  }
  return Math.max(1, Math.round(value))
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      /aborted|timeout|timed out|超时/i.test(error.message))
  )
}
