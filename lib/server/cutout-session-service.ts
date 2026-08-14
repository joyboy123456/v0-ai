import { createHash } from 'node:crypto'

import sharp from 'sharp'

import {
  AliyunCutoutProviderError,
  CLOTH_CLASSES,
  downloadCutoutResult,
  maskPngToGrayscaleAlphaPng,
  prepareAliyunCutoutInput,
  readAliyunCutoutConfig,
  readSourceCanvasDimensions,
  refineMask,
  segmentBody,
  segmentClothByClass,
  segmentCommonImage,
  segmentHair,
  segmentSkin,
  uploadViapiTemporaryInput,
  type AliyunCutoutConfig,
  type PreparedAliyunCutoutInput,
  type SegmentClothByClassResult,
} from '@/lib/server/aliyun-cutout-adapter'
import { readAssetImageBuffer } from '@/lib/server/asset-cutout-service'
import { createAsset, getAsset } from '@/lib/server/task-store'
import type {
  AssetRecord,
  ClothCategory,
  CutoutCategory,
  CutoutScene,
} from '@/lib/types'

/** 未完成会话保留时长：60 分钟（PRD §30），到期惰性清扫。 */
export const CUTOUT_SESSION_TTL_MS = 60 * 60 * 1000

const CUTOUT_SESSION_DERIVATION_VERSION = 'v1'
const CUTOUT_EXPORT_DERIVATION_VERSION = 'v1'
const MAX_SOURCE_PIXELS = 80_000_000
/** 前景判定阈值：alpha/灰度值高于该值视为保留像素（与现有抠图口径一致）。 */
const FOREGROUND_THRESHOLD = 8

export type CutoutSessionErrorCode =
  | 'session_not_found'
  | 'session_expired'
  | 'category_not_found'
  | 'empty_mask'
  | 'invalid_mask'
  | 'prepare_failed'
  | 'refine_failed'
  | 'asset_not_found'
  | 'source_unreadable'
  | 'source_too_large'
  | 'unsupported_image'
  | 'no_subject'
  | 'provider_not_configured'
  | 'provider_auth_failed'
  | 'provider_busy'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_provider_result'
  | 'asset_store_failed'

export class CutoutSessionError extends Error {
  code: CutoutSessionErrorCode
  status: number
  advice: string
  retryable: boolean
  requestId?: string
  cause?: unknown

  constructor(input: {
    code: CutoutSessionErrorCode
    status: number
    message: string
    advice: string
    retryable: boolean
    requestId?: string
    cause?: unknown
  }) {
    super(input.message)
    this.name = 'CutoutSessionError'
    this.code = input.code
    this.status = input.status
    this.advice = input.advice
    this.retryable = input.retryable
    this.requestId = input.requestId
    this.cause = input.cause
  }
}

export interface CutoutSessionRecord {
  sessionId: string
  userId: string
  sourceAssetId: string
  sourceFileName: string
  scene: CutoutScene
  /** prepared 图 URL（viapi 临时桶），仅供服务端 RefineMask 等使用，勿直接给前端。 */
  preparedImageUrl: string
  /** prepared 图字节（JPEG），经同源 API 输出给浏览器，避免直连 viapi 临时桶 403。 */
  preparedBuffer: Buffer
  preparedWidth: number
  preparedHeight: number
  originalWidth: number
  originalHeight: number
  /** 原图字节（导出合成透明 PNG 用；会话 TTL 内驻留内存）。 */
  sourceBuffer: Buffer
  categoryMasks: Map<CutoutCategory, Buffer>
  categoryMeta: Map<CutoutCategory, CutoutCategoryMeta>
  createdAt: number
  expiresAt: number
}

export interface CutoutCategoryMeta {
  width: number
  height: number
  requestId?: string
}

export interface CutoutSessionCategoryDto {
  category: CutoutCategory
  width: number
  height: number
}

export interface CutoutSessionDto {
  sessionId: string
  scene: CutoutScene
  imageUrl: string
  imageWidth: number
  imageHeight: number
  originalWidth: number
  originalHeight: number
  scale: number
  categories: CutoutSessionCategoryDto[]
  createdAt: string
}

export interface CutoutExportAssetDto {
  assetId: string
  url: string
  fileName: string
  fileType: 'image/png'
  width: number
  height: number
  sourceAssetId: string
}

export interface CutoutExportMaskDto {
  assetId: string
  url: string
  width: number
  height: number
}

export interface CutoutExportResult {
  asset: CutoutExportAssetDto
  mask: CutoutExportMaskDto
  boundingBox: { x: number; y: number; width: number; height: number }
}

export interface CutoutSessionDependencies {
  getAssetById: (assetId: string) => Promise<AssetRecord | undefined>
  readSourceAsset: (asset: AssetRecord) => Promise<Buffer>
  readCanvasDimensions: (
    sourceBuffer: Buffer,
  ) => Promise<{ width: number; height: number }>
  prepareInput: (input: {
    sourceBuffer: Buffer
    originalWidth: number
    originalHeight: number
  }) => Promise<PreparedAliyunCutoutInput>
  readConfig: () => AliyunCutoutConfig
  uploadInput: (
    input: PreparedAliyunCutoutInput,
    config: AliyunCutoutConfig,
  ) => Promise<string>
  segmentClothByClass: (
    imageUrl: string,
    config: AliyunCutoutConfig,
    classes: readonly ClothCategory[],
  ) => Promise<SegmentClothByClassResult>
  segmentSkinImage: (
    imageUrl: string,
    config: AliyunCutoutConfig,
  ) => Promise<SegmentationResult>
  segmentHairImage: (
    imageUrl: string,
    config: AliyunCutoutConfig,
  ) => Promise<SegmentationResult>
  segmentBodyImage: (
    imageUrl: string,
    config: AliyunCutoutConfig,
  ) => Promise<SegmentationResult>
  segmentCommonImage: (
    imageUrl: string,
    config: AliyunCutoutConfig,
  ) => Promise<SegmentationResult>
  downloadResult: (url: string, timeoutMs: number) => Promise<Buffer>
  maskToGrayscaleAlphaPng: (pngBuffer: Buffer) => Promise<Buffer>
  refineMaskImage: (
    imageUrl: string,
    maskImageUrl: string,
    config: AliyunCutoutConfig,
  ) => Promise<SegmentationResult>
  persistAsset: typeof createAsset
  now: () => number
}

export interface SegmentationResult {
  imageUrl: string
  requestId: string
}

const defaultDependencies: CutoutSessionDependencies = {
  getAssetById: getAsset,
  readSourceAsset: readAssetImageBuffer,
  readCanvasDimensions: readSourceCanvasDimensions,
  prepareInput: prepareAliyunCutoutInput,
  readConfig: readAliyunCutoutConfig,
  uploadInput: uploadViapiTemporaryInput,
  segmentClothByClass,
  segmentSkinImage: segmentSkin,
  segmentHairImage: segmentHair,
  segmentBodyImage: segmentBody,
  segmentCommonImage,
  downloadResult: downloadCutoutResult,
  maskToGrayscaleAlphaPng: maskPngToGrayscaleAlphaPng,
  refineMaskImage: refineMask,
  persistAsset: createAsset,
  now: () => Date.now(),
}

const globalCutoutSessionState = globalThis as typeof globalThis & {
  fashionCutoutSessions?: Map<string, CutoutSessionRecord>
  fashionCutoutSessionCreates?: Map<string, Promise<CutoutSessionDto>>
}
const sessionRegistry =
  globalCutoutSessionState.fashionCutoutSessions ??
  new Map<string, CutoutSessionRecord>()
globalCutoutSessionState.fashionCutoutSessions = sessionRegistry
const sessionCreateInFlight =
  globalCutoutSessionState.fashionCutoutSessionCreates ??
  new Map<string, Promise<CutoutSessionDto>>()
globalCutoutSessionState.fashionCutoutSessionCreates = sessionCreateInFlight

/**
 * 会话幂等 id：由 userId + assetId + scene 稳定派生，
 * 同用户同图复用未过期会话，避免重复调用上游扣费。
 */
export function deriveCutoutSessionId(
  userId: string,
  assetId: string,
  scene: CutoutScene,
): string {
  const digest = createHash('sha256')
    .update(
      `${CUTOUT_SESSION_DERIVATION_VERSION}\0${userId.trim()}\0${assetId.trim()}\0${scene}`,
    )
    .digest('hex')
    .slice(0, 24)
  return `cutout_session_${digest}`
}

/**
 * 导出资产稳定 id：hash 输入含 sessionId + finalMask 内容摘要，
 * 同一用户同一最终蒙版重复导出幂等复用。
 */
export function deriveCutoutExportAssetId(
  prefix: 'cutout_png' | 'cutout_mask',
  sessionId: string,
  finalMaskDigest: string,
): string {
  const digest = createHash('sha256')
    .update(
      `${CUTOUT_EXPORT_DERIVATION_VERSION}\0${sessionId}\0${finalMaskDigest}\0${prefix}`,
    )
    .digest('hex')
    .slice(0, 24)
  return `${prefix}_${digest}`
}

export async function createGarmentCutoutSession(
  userId: string,
  assetId: string,
  dependencies: CutoutSessionDependencies = defaultDependencies,
): Promise<CutoutSessionDto> {
  const normalizedUserId = userId.trim()
  const normalizedAssetId = assetId.trim()
  if (!normalizedUserId || !normalizedAssetId) {
    throw assetNotFoundError()
  }

  const sourceAsset = await dependencies.getAssetById(normalizedAssetId)
  if (!sourceAsset || sourceAsset.userId !== normalizedUserId) {
    throw assetNotFoundError()
  }

  const sessionId = deriveCutoutSessionId(
    normalizedUserId,
    normalizedAssetId,
    'garment',
  )
  sweepSessions(dependencies.now())
  const existing = sessionRegistry.get(sessionId)
  if (existing) {
    if (existing.userId !== normalizedUserId) throw sessionNotFoundError()
    if (isExpired(existing, dependencies.now())) {
      sessionRegistry.delete(sessionId)
    } else {
      return toSessionDto(existing)
    }
  }

  const active = sessionCreateInFlight.get(sessionId)
  if (active) return active

  const execution = executeGarmentPrepare({
    sourceAsset,
    sessionId,
    userId: normalizedUserId,
    dependencies,
  })
  sessionCreateInFlight.set(sessionId, execution)
  try {
    return await execution
  } finally {
    if (sessionCreateInFlight.get(sessionId) === execution) {
      sessionCreateInFlight.delete(sessionId)
    }
  }
}

async function executeGarmentPrepare(input: {
  sourceAsset: AssetRecord
  sessionId: string
  userId: string
  dependencies: CutoutSessionDependencies
}): Promise<CutoutSessionDto> {
  const { sourceAsset, sessionId, userId, dependencies } = input
  const startedAt = Date.now()

  let sourceBuffer: Buffer
  try {
    sourceBuffer = await dependencies.readSourceAsset(sourceAsset)
  } catch (error) {
    throw mapSourceReadError(error)
  }

  let config: AliyunCutoutConfig
  try {
    config = dependencies.readConfig()
  } catch (error) {
    throw mapProviderError(error)
  }

  let dimensions: { width: number; height: number }
  try {
    dimensions = await dependencies.readCanvasDimensions(sourceBuffer)
  } catch (error) {
    throw mapProviderError(error)
  }

  let prepared: PreparedAliyunCutoutInput
  try {
    prepared = await dependencies.prepareInput({
      sourceBuffer,
      originalWidth: dimensions.width,
      originalHeight: dimensions.height,
    })
  } catch (error) {
    throw mapProviderError(error)
  }

  let inputUrl: string
  try {
    inputUrl = await dependencies.uploadInput(prepared, config)
  } catch (error) {
    throw mapProviderError(error)
  }

  const categoryMasks = new Map<CutoutCategory, Buffer>()
  const categoryMeta = new Map<CutoutCategory, CutoutCategoryMeta>()

  // 服饰 7 类：一次 SegmentCloth 调用（ClothClass.1..7），失败只跳过不整体失败。
  try {
    const cloth = await dependencies.segmentClothByClass(
      inputUrl,
      config,
      CLOTH_CLASSES,
    )
    for (const category of CLOTH_CLASSES) {
      const url = cloth.classUrls[category]
      if (!url) {
        console.warn('[cutout-session] 类别无分割结果，跳过', {
          category,
          requestId: cloth.requestId,
          fallback: cloth.fallback === true,
        })
        continue
      }
      await prepareCategoryMask({
        category,
        url,
        requestId: cloth.requestId,
        prepared,
        config,
        categoryMasks,
        categoryMeta,
        dependencies,
      })
    }
  } catch (error) {
    console.warn('[cutout-session] SegmentCloth 调用失败，跳过全部服饰类别', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 辅助类别：skin/hair/body/common 各一次调用，单个失败跳过。
  const auxiliary: Array<{
    category: CutoutCategory
    run: (imageUrl: string, config: AliyunCutoutConfig) => Promise<SegmentationResult>
  }> = [
    { category: 'skin', run: dependencies.segmentSkinImage },
    { category: 'hair', run: dependencies.segmentHairImage },
    { category: 'body', run: dependencies.segmentBodyImage },
    { category: 'common', run: dependencies.segmentCommonImage },
  ]
  for (const { category, run } of auxiliary) {
    try {
      const segmented = await run(inputUrl, config)
      await prepareCategoryMask({
        category,
        url: segmented.imageUrl,
        requestId: segmented.requestId,
        prepared,
        config,
        categoryMasks,
        categoryMeta,
        dependencies,
      })
    } catch (error) {
      console.warn('[cutout-session] 辅助类别分割失败，跳过', {
        category,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (categoryMasks.size === 0) {
    throw new CutoutSessionError({
      code: 'prepare_failed',
      status: 502,
      message: '服饰智能分层初始化失败，未识别到任何可用类别',
      advice: '请稍后重试；如果持续失败，请换一张主体更清晰的图片',
      retryable: true,
    })
  }

  const now = dependencies.now()
  const record: CutoutSessionRecord = {
    sessionId,
    userId,
    sourceAssetId: sourceAsset.assetId,
    sourceFileName: sourceAsset.fileName,
    scene: 'garment',
    preparedImageUrl: inputUrl,
    preparedBuffer: prepared.buffer,
    preparedWidth: prepared.width,
    preparedHeight: prepared.height,
    originalWidth: prepared.originalWidth,
    originalHeight: prepared.originalHeight,
    sourceBuffer,
    categoryMasks,
    categoryMeta,
    createdAt: now,
    expiresAt: now + CUTOUT_SESSION_TTL_MS,
  }
  sessionRegistry.set(sessionId, record)
  console.info('[cutout-session] 服饰智能分层会话准备完成', {
    sessionId,
    sourceAssetId: sourceAsset.assetId,
    scene: 'garment',
    preparedWidth: prepared.width,
    preparedHeight: prepared.height,
    originalWidth: prepared.originalWidth,
    originalHeight: prepared.originalHeight,
    categories: [...categoryMasks.keys()],
    durationMs: Date.now() - startedAt,
  })
  return toSessionDto(record)
}

async function prepareCategoryMask(input: {
  category: CutoutCategory
  url: string
  requestId: string
  prepared: PreparedAliyunCutoutInput
  config: AliyunCutoutConfig
  categoryMasks: Map<CutoutCategory, Buffer>
  categoryMeta: Map<CutoutCategory, CutoutCategoryMeta>
  dependencies: CutoutSessionDependencies
}): Promise<void> {
  const {
    category,
    url,
    requestId,
    prepared,
    config,
    categoryMasks,
    categoryMeta,
    dependencies,
  } = input
  const startedAt = Date.now()
  try {
    const downloaded = await dependencies.downloadResult(url, config.timeoutMs)
    const grayscalePng = await dependencies.maskToGrayscaleAlphaPng(downloaded)
    const metadata = await sharp(grayscalePng).metadata()
    categoryMasks.set(category, grayscalePng)
    categoryMeta.set(category, {
      width: metadata.width ?? prepared.width,
      height: metadata.height ?? prepared.height,
      requestId,
    })
    console.info('[cutout-session] 类别 Mask 准备完成', {
      category,
      requestId,
      durationMs: Date.now() - startedAt,
      bytes: grayscalePng.byteLength,
    })
  } catch (error) {
    console.warn('[cutout-session] 类别 Mask 准备失败，跳过', {
      category,
      requestId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** 校验会话归属与过期；过期抛 session_expired（同时惰性清扫）。 */
export function getCutoutSession(
  sessionId: string,
  userId: string,
  dependencies: Pick<CutoutSessionDependencies, 'now'> = defaultDependencies,
): CutoutSessionDto {
  return toSessionDto(requireSession(sessionId, userId, dependencies.now()))
}

/** 返回类别 Mask（prepared 尺寸黑白灰度 PNG）。 */
export async function getCategoryMask(
  sessionId: string,
  userId: string,
  category: CutoutCategory,
  dependencies: CutoutSessionDependencies = defaultDependencies,
): Promise<Buffer> {
  const record = requireSession(sessionId, userId, dependencies.now())
  const mask = record.categoryMasks.get(category)
  if (!mask) {
    throw new CutoutSessionError({
      code: 'category_not_found',
      status: 404,
      message: '该类别在当前会话中不可用（可能未识别到），请换一个类别重试',
      advice: '请点击图片中已识别出的类别，或使用涂抹选区手动补充',
      retryable: false,
    })
  }
  return mask
}

/**
 * 返回 prepared 工作图字节（JPEG），由同源 API 输出给浏览器；
 * viapi 临时桶对匿名 GET 403，浏览器不得直连 preparedImageUrl。
 * 归属/过期语义与 getCutoutSession/getCategoryMask 一致。
 */
export async function getSessionPreparedImage(
  sessionId: string,
  userId: string,
  dependencies: CutoutSessionDependencies = defaultDependencies,
): Promise<{ buffer: Buffer; contentType: string }> {
  const record = requireSession(sessionId, userId, dependencies.now())
  return { buffer: record.preparedBuffer, contentType: 'image/jpeg' }
}

/**
 * 导出：finalMask 为 prepared 尺寸灰度（白=保留），
 * 可传 Buffer 或 dataURL（路由层已把 dataURL 解成 Buffer 传进来）。
 */
export async function exportCutoutSession(
  sessionId: string,
  userId: string,
  finalMaskInput: Buffer | string,
  options: { refine?: boolean } = {},
  dependencies: CutoutSessionDependencies = defaultDependencies,
): Promise<CutoutExportResult> {
  const record = requireSession(sessionId, userId, dependencies.now())
  const startedAt = Date.now()

  const maskBuffer = decodeFinalMask(finalMaskInput)
  const config = dependencies.readConfig()
  const grayscale = await readMaskGrayscale(
    maskBuffer,
    record.preparedWidth,
    record.preparedHeight,
  )
  if (countForeground(grayscale.data) === 0) {
    throw emptyMaskError()
  }

  let finalGrayscale = grayscale.data
  if (options.refine === true) {
    try {
      finalGrayscale = await refineMaskWithAliyun(
        record,
        maskBuffer,
        config,
        dependencies,
      )
      if (countForeground(finalGrayscale) === 0) {
        console.warn('[cutout-session] RefineMask 结果为空，回退未细化蒙版', {
          sessionId,
        })
        finalGrayscale = grayscale.data
      }
    } catch (error) {
      console.warn('[cutout-session] RefineMask 失败，回退未细化蒙版', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const alphaOriginal = await resizeGrayscaleToOriginal(
    finalGrayscale,
    record.preparedWidth,
    record.preparedHeight,
    record.originalWidth,
    record.originalHeight,
  )
  const originalWidth = record.originalWidth
  const originalHeight = record.originalHeight

  let transparentPng: Buffer
  let maskPng: Buffer
  try {
    transparentPng = await composeTransparentPng(
      record.sourceBuffer,
      alphaOriginal,
      originalWidth,
      originalHeight,
    )
    const maskGrayscale = Buffer.alloc(alphaOriginal.byteLength)
    for (let index = 0; index < alphaOriginal.byteLength; index += 1) {
      maskGrayscale[index] = alphaOriginal[index] > FOREGROUND_THRESHOLD ? 255 : 0
    }
    maskPng = await sharp(maskGrayscale, {
      raw: { width: originalWidth, height: originalHeight, channels: 1 },
    })
      .toColourspace('b-w')
      .png()
      .toBuffer()
  } catch (error) {
    throw new CutoutSessionError({
      code: 'invalid_provider_result',
      status: 502,
      message: '透明图层生成失败，当前编辑内容已保留，请重新提交',
      advice: '请重新点击完成导出；失败不会扣除权益',
      retryable: true,
      cause: error,
    })
  }

  // bbox 基于 prepared 尺寸二进制蒙版计算后按比例放大回原图坐标，
  // 避免放大插值在边界产生 1px 软边导致的外接矩形抖动。
  const preparedBBox = computeBoundingBox(
    finalGrayscale,
    record.preparedWidth,
    record.preparedHeight,
  )
  const scaleX = record.originalWidth / record.preparedWidth
  const scaleY = record.originalHeight / record.preparedHeight
  const boundingBox = {
    x: Math.floor(preparedBBox.x * scaleX),
    y: Math.floor(preparedBBox.y * scaleY),
    width: Math.max(1, Math.round(preparedBBox.width * scaleX)),
    height: Math.max(1, Math.round(preparedBBox.height * scaleY)),
  }

  const finalMaskDigest = createHash('sha256').update(finalGrayscale).digest('hex')
  const pngAssetId = deriveCutoutExportAssetId(
    'cutout_png',
    record.sessionId,
    finalMaskDigest,
  )
  const maskAssetId = deriveCutoutExportAssetId(
    'cutout_mask',
    record.sessionId,
    finalMaskDigest,
  )
  const baseName = buildExportBaseName(record.sourceFileName)

  let pngAsset: AssetRecord
  let maskAsset: AssetRecord
  try {
    pngAsset = await dependencies.persistAsset({
      assetId: pngAssetId,
      userId,
      fileName: `${baseName}-服饰分层.png`,
      fileType: 'image/png',
      width: originalWidth,
      height: originalHeight,
      body: transparentPng,
    })
    maskAsset = await dependencies.persistAsset({
      assetId: maskAssetId,
      userId,
      fileName: `${baseName}-服饰分层-mask.png`,
      fileType: 'image/png',
      width: originalWidth,
      height: originalHeight,
      body: maskPng,
    })
  } catch (error) {
    throw new CutoutSessionError({
      code: 'asset_store_failed',
      status: 500,
      message: '抠图结果已生成，但保存失败',
      advice: '请稍后重试；如果持续失败，请联系管理员检查存储服务',
      retryable: true,
      cause: error,
    })
  }

  console.info('[cutout-session] 服饰智能分层导出完成', {
    sessionId,
    sourceAssetId: record.sourceAssetId,
    pngAssetId: pngAsset.assetId,
    maskAssetId: maskAsset.assetId,
    outputWidth: originalWidth,
    outputHeight: originalHeight,
    boundingBox,
    refined: options.refine === true,
    durationMs: Date.now() - startedAt,
  })

  return {
    asset: {
      assetId: pngAsset.assetId,
      url: pngAsset.fileUrl,
      fileName: pngAsset.fileName,
      fileType: 'image/png',
      width: pngAsset.width,
      height: pngAsset.height,
      sourceAssetId: record.sourceAssetId,
    },
    mask: {
      assetId: maskAsset.assetId,
      url: maskAsset.fileUrl,
      width: maskAsset.width,
      height: maskAsset.height,
    },
    boundingBox,
  }
}

/**
 * RefineMask 边缘细化：RefineMask 需要 Mask 是 URL，
 * 先把蒙版临时上传 viapi 临时桶，再调 RefineMask(ImageURL + MaskImageURL)。
 * 失败抛错由调用方捕获回退为未细化蒙版。
 */
async function refineMaskWithAliyun(
  record: CutoutSessionRecord,
  maskPng: Buffer,
  config: AliyunCutoutConfig,
  dependencies: CutoutSessionDependencies,
): Promise<Buffer> {
  const maskInput: PreparedAliyunCutoutInput = {
    buffer: maskPng,
    width: record.preparedWidth,
    height: record.preparedHeight,
    originalWidth: record.preparedWidth,
    originalHeight: record.preparedHeight,
  }
  let maskUrl: string
  try {
    maskUrl = await dependencies.uploadInput(maskInput, config)
  } catch (error) {
    throw mapProviderError(error)
  }
  const refined = await dependencies.refineMaskImage(
    record.preparedImageUrl,
    maskUrl,
    config,
  )
  const downloaded = await dependencies.downloadResult(
    refined.imageUrl,
    config.timeoutMs,
  )
  const refinedGrayPng = await dependencies.maskToGrayscaleAlphaPng(downloaded)
  const metadata = await sharp(refinedGrayPng).metadata()
  const width = metadata.width ?? record.preparedWidth
  const height = metadata.height ?? record.preparedHeight
  let data = metadata.hasAlpha
    ? await sharp(refinedGrayPng).extractChannel('alpha').raw().toBuffer()
    : await sharp(refinedGrayPng).extractChannel('red').raw().toBuffer()
  if (width !== record.preparedWidth || height !== record.preparedHeight) {
    data = await sharp(data, { raw: { width, height, channels: 1 } })
      .toColourspace('b-w')
      .resize(record.preparedWidth, record.preparedHeight, { fit: 'fill' })
      .raw()
      .toBuffer()
  }
  return data
}

function requireSession(
  sessionId: string,
  userId: string,
  now: number,
): CutoutSessionRecord {
  const record = sessionRegistry.get(sessionId)
  if (!record || record.userId !== userId) {
    sweepSessions(now)
    throw sessionNotFoundError()
  }
  if (now > record.expiresAt) {
    sessionRegistry.delete(sessionId)
    throw sessionExpiredError()
  }
  sweepSessions(now)
  return record
}

function sweepSessions(now: number): void {
  for (const [sessionId, record] of sessionRegistry) {
    if (now > record.expiresAt) sessionRegistry.delete(sessionId)
  }
}

function isExpired(record: CutoutSessionRecord, now: number): boolean {
  return now > record.expiresAt
}

function toSessionDto(record: CutoutSessionRecord): CutoutSessionDto {
  const categories: CutoutSessionCategoryDto[] = []
  for (const [category, meta] of record.categoryMeta) {
    categories.push({ category, width: meta.width, height: meta.height })
  }
  return {
    sessionId: record.sessionId,
    scene: record.scene,
    imageUrl: record.preparedImageUrl,
    imageWidth: record.preparedWidth,
    imageHeight: record.preparedHeight,
    originalWidth: record.originalWidth,
    originalHeight: record.originalHeight,
    scale: record.preparedWidth / record.originalWidth,
    categories,
    createdAt: new Date(record.createdAt).toISOString(),
  }
}

function decodeFinalMask(input: Buffer | string): Buffer {
  if (Buffer.isBuffer(input)) {
    if (input.byteLength === 0) throw invalidMaskError()
    return input
  }
  const match = input.match(
    /^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/,
  )
  if (!match) {
    throw invalidMaskError('蒙版数据格式无效，请重新提交')
  }
  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.byteLength === 0) throw invalidMaskError()
  return buffer
}

async function readMaskGrayscale(
  buffer: Buffer,
  expectedWidth: number,
  expectedHeight: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  let gray: Buffer
  let width: number
  let height: number
  try {
    const metadata = await sharp(buffer).metadata()
    width = metadata.width ?? 0
    height = metadata.height ?? 0
    if (width <= 0 || height <= 0) throw new Error('蒙版缺少有效宽高')
    gray = metadata.hasAlpha
      ? await sharp(buffer).extractChannel('alpha').raw().toBuffer()
      : await sharp(buffer).extractChannel('red').raw().toBuffer()
  } catch (error) {
    throw invalidMaskError('蒙版数据无法解析，请重新提交', error)
  }
  if (width !== expectedWidth || height !== expectedHeight) {
    console.warn('[cutout-session] 蒙版尺寸与会话工作图不一致，已重采样', {
      width,
      height,
      expectedWidth,
      expectedHeight,
    })
    gray = await sharp(gray, { raw: { width, height, channels: 1 } })
      .toColourspace('b-w')
      .resize(expectedWidth, expectedHeight, { fit: 'fill' })
      .raw()
      .toBuffer()
  }
  return { data: gray, width: expectedWidth, height: expectedHeight }
}

function countForeground(gray: Buffer): number {
  let count = 0
  for (const value of gray) {
    if (value > FOREGROUND_THRESHOLD) count += 1
  }
  return count
}

async function resizeGrayscaleToOriginal(
  gray: Buffer,
  preparedWidth: number,
  preparedHeight: number,
  originalWidth: number,
  originalHeight: number,
): Promise<Buffer> {
  return sharp(gray, {
    raw: { width: preparedWidth, height: preparedHeight, channels: 1 },
  })
    .toColourspace('b-w')
    .resize(originalWidth, originalHeight, { fit: 'fill' })
    .raw()
    .toBuffer()
}

async function composeTransparentPng(
  sourceBuffer: Buffer,
  alpha: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const alphaImage = await sharp({
    create: { width, height, channels: 3, background: '#ffffff' },
  })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
  return sharp(sourceBuffer, {
    failOn: 'error',
    limitInputPixels: MAX_SOURCE_PIXELS,
  })
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .composite([{ input: alphaImage, blend: 'dest-in' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

function computeBoundingBox(
  alpha: Buffer,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    for (let x = 0; x < width; x += 1) {
      if (alpha[rowOffset + x] > FOREGROUND_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw emptyMaskError()
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function buildExportBaseName(sourceFileName: string): string {
  return sourceFileName
    .replace(/\.[^./\\]+$/, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .trim()
    .slice(0, 120)
}

function mapProviderError(error: unknown): CutoutSessionError {
  if (error instanceof CutoutSessionError) return error
  if (error instanceof AliyunCutoutProviderError) {
    const common = {
      retryable: error.retryable,
      requestId: error.requestId,
      cause: error,
    }
    switch (error.category) {
      case 'config':
        return new CutoutSessionError({
          ...common,
          code: 'provider_not_configured',
          status: 503,
          message: error.message,
          advice: '请联系管理员配置阿里云视觉智能开放平台凭证',
        })
      case 'auth':
        return new CutoutSessionError({
          ...common,
          code: 'provider_auth_failed',
          status: 503,
          message: error.message,
          advice: '请联系管理员检查 AccessKey、余额和 RAM 权限',
        })
      case 'invalid_input':
        return new CutoutSessionError({
          ...common,
          code: 'unsupported_image',
          status: 422,
          message: error.message,
          advice: '请换一张清晰、完整且能正常打开的图片后重试',
        })
      case 'no_subject':
        return new CutoutSessionError({
          ...common,
          code: 'no_subject',
          status: 422,
          message: error.message,
          advice: '请换用主体更清晰、与背景区分更明显的图片',
        })
      case 'rate_limit':
        return new CutoutSessionError({
          ...common,
          code: 'provider_busy',
          status: 503,
          message: error.message,
          advice: '请稍后重试；失败不会扣除权益',
        })
      case 'timeout':
        return new CutoutSessionError({
          ...common,
          code: 'provider_timeout',
          status: 504,
          message: error.message,
          advice: '请检查网络后重试；失败不会扣除权益',
        })
      case 'invalid_result':
        return new CutoutSessionError({
          ...common,
          code: 'invalid_provider_result',
          status: 502,
          message: error.message,
          advice: '请重试；如果多次失败，请换一张图片',
        })
      case 'network':
      case 'server_error':
      default:
        return new CutoutSessionError({
          ...common,
          code: 'provider_unavailable',
          status: 502,
          message: error.message,
          advice: '请稍后重试；失败不会扣除权益',
        })
    }
  }
  return new CutoutSessionError({
    code: 'provider_unavailable',
    status: 502,
    message: '服饰智能分层服务调用失败，请稍后重试',
    advice: '请稍后重试；失败不会扣除权益',
    retryable: true,
    cause: error,
  })
}

function mapSourceReadError(error: unknown): CutoutSessionError {
  if (error instanceof CutoutSessionError) return error
  const code =
    error instanceof Error && /超过大小上限/.test(error.message)
      ? 'source_too_large'
      : 'source_unreadable'
  return new CutoutSessionError({
    code,
    status: code === 'source_too_large' ? 413 : 422,
    message:
      code === 'source_too_large'
        ? '原图文件超过 40 MB，无法安全处理'
        : '原图读取失败，请重新上传后重试',
    advice:
      code === 'source_too_large'
        ? '请先导出体积更小的图片后重新上传'
        : '请重新上传一张有效图片后重试',
    retryable: false,
    cause: error,
  })
}

function assetNotFoundError(): CutoutSessionError {
  return new CutoutSessionError({
    code: 'asset_not_found',
    status: 404,
    message: '未找到对应的图片资产或无权操作',
    advice: '请刷新页面后重新选择图片',
    retryable: false,
  })
}

function sessionNotFoundError(): CutoutSessionError {
  return new CutoutSessionError({
    code: 'session_not_found',
    status: 404,
    message: '未找到对应的抠图会话或无权操作',
    advice: '请刷新页面后重新进入智能抠图',
    retryable: false,
  })
}

function sessionExpiredError(): CutoutSessionError {
  return new CutoutSessionError({
    code: 'session_expired',
    status: 410,
    message: '抠图会话已过期，请重新进入智能抠图',
    advice: '请重新打开编辑器后再试',
    retryable: false,
  })
}

function emptyMaskError(): CutoutSessionError {
  return new CutoutSessionError({
    code: 'empty_mask',
    status: 422,
    message: '当前选区为空，无法导出透明图层',
    advice: '请先点击图片中需要保留的区域，或使用涂抹选区补充后再导出',
    retryable: false,
  })
}

function invalidMaskError(message?: string, cause?: unknown): CutoutSessionError {
  return new CutoutSessionError({
    code: 'invalid_mask',
    status: 422,
    message: message ?? '蒙版数据无效，请重新提交',
    advice: '请重新完成选区后再次导出',
    retryable: false,
    cause,
  })
}

/**
 * 统一错误映射：CutoutSessionError → HTTP 响应体；
 * 未预期错误记日志并回 500 通用错误（对齐现有 cutout 路由的错误格式）。
 */
export function toCutoutSessionErrorBody(error: unknown): {
  status: number
  body: Record<string, unknown>
} {
  if (error instanceof CutoutSessionError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        advice: error.advice,
        retryable: error.retryable,
        ...(error.requestId ? { requestId: error.requestId } : {}),
      },
    }
  }
  console.error('[cutout-session] 未预期的抠图会话错误：', error)
  return {
    status: 500,
    body: {
      error: '智能抠图失败，请稍后重试',
      code: 'cutout_session_failed',
      advice: '请稍后重试；失败不会扣除权益',
      retryable: true,
    },
  }
}
