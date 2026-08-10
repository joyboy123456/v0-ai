import { createHash } from 'node:crypto'

import {
  AliyunCutoutProviderError,
  runAliyunCommonCutout,
  type AliyunCutoutResult,
} from '@/lib/server/aliyun-cutout-adapter'
import { downloadSafeRemoteImage } from '@/lib/server/safe-remote-image'
import {
  getLocalImageForPublicUrl,
  getStorageAdapter,
} from '@/lib/server/storage'
import { createAsset, getAsset } from '@/lib/server/task-store'
import type { AssetRecord } from '@/lib/types'

const MAX_CUTOUT_SOURCE_BYTES = 40_000_000
const CUTOUT_DERIVATION_VERSION = 'v1'

const globalCutoutState = globalThis as typeof globalThis & {
  fashionMvpCutoutInFlight?: Map<string, Promise<CutoutAssetServiceResult>>
}
const inFlightCutouts =
  globalCutoutState.fashionMvpCutoutInFlight ??
  new Map<string, Promise<CutoutAssetServiceResult>>()
globalCutoutState.fashionMvpCutoutInFlight = inFlightCutouts

export type AssetCutoutErrorCode =
  | 'asset_not_found'
  | 'source_too_large'
  | 'source_unreadable'
  | 'unsupported_image'
  | 'no_subject'
  | 'provider_not_configured'
  | 'provider_auth_failed'
  | 'provider_busy'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_provider_result'
  | 'asset_store_failed'

export class AssetCutoutError extends Error {
  code: AssetCutoutErrorCode
  status: number
  advice: string
  retryable: boolean
  requestId?: string
  cause?: unknown

  constructor(input: {
    code: AssetCutoutErrorCode
    status: number
    message: string
    advice: string
    retryable: boolean
    requestId?: string
    cause?: unknown
  }) {
    super(input.message)
    this.name = 'AssetCutoutError'
    this.code = input.code
    this.status = input.status
    this.advice = input.advice
    this.retryable = input.retryable
    this.requestId = input.requestId
    this.cause = input.cause
  }
}

export interface CutoutAssetServiceResult {
  asset: AssetRecord
  sourceAssetId: string
  providerRequestId?: string
}

export interface AssetCutoutDependencies {
  getAssetById: (assetId: string) => Promise<AssetRecord | undefined>
  readSourceAsset: (asset: AssetRecord) => Promise<Buffer>
  runCutoutProvider: (input: {
    sourceBuffer: Buffer
  }) => Promise<AliyunCutoutResult>
  persistAsset: typeof createAsset
}

const defaultDependencies: AssetCutoutDependencies = {
  getAssetById: getAsset,
  readSourceAsset: readAssetImageBuffer,
  runCutoutProvider: runAliyunCommonCutout,
  persistAsset: createAsset,
}

export async function cutoutAssetForUser(
  assetId: string,
  userId: string,
  dependencies: AssetCutoutDependencies = defaultDependencies,
): Promise<CutoutAssetServiceResult> {
  const normalizedAssetId = assetId.trim()
  const normalizedUserId = userId.trim()
  if (!normalizedAssetId || !normalizedUserId) {
    throw assetNotFoundError()
  }

  const sourceAsset = await dependencies.getAssetById(normalizedAssetId)
  if (!sourceAsset || sourceAsset.userId !== normalizedUserId) {
    throw assetNotFoundError()
  }

  const derivedAssetId = createCutoutDerivedAssetId(
    normalizedUserId,
    normalizedAssetId,
  )
  const existingAsset = await dependencies.getAssetById(derivedAssetId)
  if (existingAsset?.userId === normalizedUserId) {
    return { asset: existingAsset, sourceAssetId: normalizedAssetId }
  }
  if (existingAsset) {
    throw new AssetCutoutError({
      code: 'asset_store_failed',
      status: 500,
      message: '派生资产标识冲突，请稍后重试',
      advice: '请稍后重试；如果持续失败，请联系管理员检查资产存储',
      retryable: true,
    })
  }

  const executionKey = `${normalizedUserId}:${normalizedAssetId}`
  const active = inFlightCutouts.get(executionKey)
  if (active) return active

  const execution = executeCutout({
    sourceAsset,
    derivedAssetId,
    userId: normalizedUserId,
    dependencies,
  })
  inFlightCutouts.set(executionKey, execution)
  try {
    return await execution
  } finally {
    if (inFlightCutouts.get(executionKey) === execution) {
      inFlightCutouts.delete(executionKey)
    }
  }
}

export function createCutoutDerivedAssetId(
  userId: string,
  sourceAssetId: string,
): string {
  const digest = createHash('sha256')
    .update(
      `${CUTOUT_DERIVATION_VERSION}\0${userId.trim()}\0${sourceAssetId.trim()}`,
    )
    .digest('hex')
    .slice(0, 24)
  return `asset_cutout_${digest}`
}

export async function readAssetImageBuffer(asset: AssetRecord): Promise<Buffer> {
  const inlineSource = asset.dataUrl || asset.fileUrl
  if (inlineSource.startsWith('data:')) {
    const match = inlineSource.match(
      /^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/,
    )
    if (!match) {
      throw sourceUnreadableError('原图 data URL 格式无效')
    }
    return assertSourceSize(Buffer.from(match[1], 'base64'))
  }

  if (
    asset.fileUrl.startsWith('/local-assets/') ||
    asset.fileUrl.startsWith('/generated/')
  ) {
    const stored = await getLocalImageForPublicUrl(asset.fileUrl)
    if (!stored) throw sourceUnreadableError('本地原图文件不存在')
    return assertSourceSize(Buffer.from(stored.body))
  }

  if (
    asset.fileUrl.startsWith('https://') ||
    asset.fileUrl.startsWith('http://')
  ) {
    const ownOssKey = extractOwnOssKey(asset.fileUrl)
    if (ownOssKey) {
      try {
        const stored = await getStorageAdapter().getImage(ownOssKey)
        if (stored) return assertSourceSize(Buffer.from(stored.body))
      } catch (error) {
        console.warn('[asset-cutout] OSS 原图认证读取失败，改用安全公网下载', {
          assetId: asset.assetId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    try {
      const downloaded = await downloadSafeRemoteImage(asset.fileUrl, {
        maxBytes: MAX_CUTOUT_SOURCE_BYTES,
      })
      return assertSourceSize(downloaded.buffer)
    } catch (error) {
      if (
        error instanceof Error &&
        /超过大小上限/.test(error.message)
      ) {
        throw sourceTooLargeError(error)
      }
      throw sourceUnreadableError(
        '原图地址无法安全读取，请重新上传图片后重试',
        error,
      )
    }
  }

  throw sourceUnreadableError('原图地址格式不受支持，请重新上传图片')
}

async function executeCutout(input: {
  sourceAsset: AssetRecord
  derivedAssetId: string
  userId: string
  dependencies: AssetCutoutDependencies
}): Promise<CutoutAssetServiceResult> {
  let sourceBuffer: Buffer
  try {
    sourceBuffer = await input.dependencies.readSourceAsset(input.sourceAsset)
  } catch (error) {
    if (error instanceof AssetCutoutError) throw error
    throw sourceUnreadableError('原图读取失败，请重新上传后重试', error)
  }

  let providerResult: AliyunCutoutResult
  try {
    providerResult = await input.dependencies.runCutoutProvider({
      sourceBuffer,
    })
  } catch (error) {
    if (error instanceof AliyunCutoutProviderError) {
      throw mapProviderError(error)
    }
    throw new AssetCutoutError({
      code: 'provider_unavailable',
      status: 502,
      message: '抠图服务调用失败，请稍后重试',
      advice: '请稍后重试；失败不会扣除权益',
      retryable: true,
      cause: error,
    })
  }

  let asset: AssetRecord
  try {
    asset = await input.dependencies.persistAsset({
      assetId: input.derivedAssetId,
      userId: input.userId,
      fileName: buildCutoutFileName(input.sourceAsset.fileName),
      fileType: 'image/png',
      width: providerResult.outputWidth,
      height: providerResult.outputHeight,
      body: providerResult.pngBuffer,
    })
  } catch (error) {
    throw new AssetCutoutError({
      code: 'asset_store_failed',
      status: 500,
      message: '抠图已完成，但透明 PNG 保存失败',
      advice: '请稍后重试；如果持续失败，请联系管理员检查存储服务',
      retryable: true,
      requestId: providerResult.requestId,
      cause: error,
    })
  }

  return {
    asset,
    sourceAssetId: input.sourceAsset.assetId,
    providerRequestId: providerResult.requestId,
  }
}

function mapProviderError(error: AliyunCutoutProviderError): AssetCutoutError {
  const common = {
    retryable: error.retryable,
    requestId: error.requestId,
    cause: error,
  }
  switch (error.category) {
    case 'config':
      return new AssetCutoutError({
        ...common,
        code: 'provider_not_configured',
        status: 503,
        message: error.message,
        advice: '请联系管理员配置阿里云视觉智能开放平台凭证',
      })
    case 'auth':
      return new AssetCutoutError({
        ...common,
        code: 'provider_auth_failed',
        status: 503,
        message: error.message,
        advice: '请联系管理员检查 AccessKey、余额和 RAM 权限',
      })
    case 'invalid_input':
      return new AssetCutoutError({
        ...common,
        code: 'unsupported_image',
        status: 422,
        message: error.message,
        advice: '请换一张清晰、完整且能正常打开的图片后重试',
      })
    case 'no_subject':
      return new AssetCutoutError({
        ...common,
        code: 'no_subject',
        status: 422,
        message: error.message,
        advice: '请换用主体更清晰、与背景区分更明显的图片',
      })
    case 'rate_limit':
      return new AssetCutoutError({
        ...common,
        code: 'provider_busy',
        status: 503,
        message: error.message,
        advice: '请稍后重试；失败不会扣除权益',
      })
    case 'timeout':
      return new AssetCutoutError({
        ...common,
        code: 'provider_timeout',
        status: 504,
        message: error.message,
        advice: '请检查网络后重试；失败不会扣除权益',
      })
    case 'invalid_result':
      return new AssetCutoutError({
        ...common,
        code: 'invalid_provider_result',
        status: 502,
        message: error.message,
        advice: '请重试；如果多次失败，请换一张图片',
      })
    case 'network':
    case 'server_error':
    default:
      return new AssetCutoutError({
        ...common,
        code: 'provider_unavailable',
        status: 502,
        message: error.message,
        advice: '请稍后重试；失败不会扣除权益',
      })
  }
}

function buildCutoutFileName(sourceFileName: string): string {
  const baseName = sourceFileName
    .replace(/\.[^./\\]+$/, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .trim()
    .slice(0, 120)
  return `${baseName || '图片'}-抠图.png`
}

function extractOwnOssKey(url: string): string | null {
  const publicBase = process.env.OSS_PUBLIC_URL?.trim().replace(/\/$/, '')
  if (!publicBase || !url.startsWith(`${publicBase}/`)) return null
  return url.slice(publicBase.length + 1)
}

function assertSourceSize(buffer: Buffer): Buffer {
  if (buffer.byteLength <= 0) {
    throw sourceUnreadableError('原图文件为空，请重新上传')
  }
  if (buffer.byteLength > MAX_CUTOUT_SOURCE_BYTES) {
    throw sourceTooLargeError()
  }
  return buffer
}

function assetNotFoundError(): AssetCutoutError {
  return new AssetCutoutError({
    code: 'asset_not_found',
    status: 404,
    message: '未找到对应的图片资产或无权操作',
    advice: '请刷新页面后重新选择图片',
    retryable: false,
  })
}

function sourceTooLargeError(cause?: unknown): AssetCutoutError {
  return new AssetCutoutError({
    code: 'source_too_large',
    status: 413,
    message: '原图文件超过 40 MB，无法安全处理',
    advice: '请先导出体积更小的图片后重新上传',
    retryable: false,
    cause,
  })
}

function sourceUnreadableError(message: string, cause?: unknown): AssetCutoutError {
  return new AssetCutoutError({
    code: 'source_unreadable',
    status: 422,
    message,
    advice: '请重新上传一张有效图片后重试',
    retryable: false,
    cause,
  })
}
