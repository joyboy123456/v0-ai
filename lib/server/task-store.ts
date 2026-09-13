import { runThirdPartyWorkflow } from '@/lib/server/third-party-image-adapter'
import {
  normalizeAiFashionPhotoParams,
} from '@/lib/server/ai-fashion-photo-service'
import {
  normalizePoseFissionParams,
  runPoseFissionPipeline,
} from '@/lib/server/pose-fission-service'
import {
  normalizePhotoFissionParams,
  runPhotoFissionFaceRefine,
  runPhotoFissionPipeline,
} from '@/lib/server/photo-fission-service'
import { isLocalSuperAdminEnabled } from '@/lib/server/auth/local-auth-mode'
import { cancelScheduledTask } from '@/lib/server/image-work-scheduler'
import {
  decideInterruptedTaskRecovery,
  shouldStartInterruptedTaskRecovery,
} from '@/lib/server/task-recovery'
import {
  downloadSafeRemoteImage,
  MAX_GENERATED_IMAGE_BYTES,
  MAX_INPUT_IMAGE_BYTES,
} from '@/lib/server/safe-remote-image'
import {
  getLocalImageForPublicUrl,
  getStorageAdapter,
  getTaskRepo,
  type AssetRow,
  type TaskRow,
} from '@/lib/server/storage'
import {
  DEFAULT_FASHION_MODEL,
  FEATURE_WORKFLOWS,
  type AiFashionPhotoParams,
  type AssetRecord,
  type FeatureType,
  type GenerationTask,
  type PhotoFissionParams,
  type PoseFissionParams,
  type ResultAsset,
  type ShotProgress,
  type ShotProgressStatus,
  type TaskParams,
} from '@/lib/types'
import { mkdir, readFile, writeFile, rename, readdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { logImageEvent, type LogContext } from '@/lib/server/log'

const globalStore = globalThis as typeof globalThis & {
  fashionMvpStore?: {
    assets: Map<string, AssetRecord>
    tasks: Map<string, GenerationTask>
  }
  fashionMvpTaskControllers?: Map<string, AbortController>
  fashionMvpRecoveryExecutionKeys?: Set<string>
  fashionMvpRecoveryStarted?: boolean
  fashionMvpIdempotentCreations?: Map<string, Promise<GenerationTask>>
}

const store = globalStore.fashionMvpStore ?? {
  assets: new Map<string, AssetRecord>(),
  tasks: new Map<string, GenerationTask>(),
}

globalStore.fashionMvpStore = store
const runningTaskControllers =
  globalStore.fashionMvpTaskControllers ?? new Map<string, AbortController>()
globalStore.fashionMvpTaskControllers = runningTaskControllers
const activeRecoveryExecutionKeys =
  globalStore.fashionMvpRecoveryExecutionKeys ?? new Set<string>()
globalStore.fashionMvpRecoveryExecutionKeys = activeRecoveryExecutionKeys
const idempotentCreations = globalStore.fashionMvpIdempotentCreations ?? new Map<string, Promise<GenerationTask>>()
globalStore.fashionMvpIdempotentCreations = idempotentCreations

const defaultUserId = 'demo_user'
const defaultProjectId = 'demo_project'
const workspaceRoot = process.cwd()
const dataDir = path.join(workspaceRoot, 'data')
const storeFilePath = path.join(dataDir, 'fashion-mvp-store.json')
// PR3：原 publicGeneratedDir / publicAssetDir / publicResultDir 物理路径已下沉到
// storage-adapter（local 实现），本文件不再直写 `public/generated/**`。
let storeLoaded = false
const storeReady = loadPersistedStore().finally(() => {
  storeLoaded = true
})

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getCredits(params: TaskParams) {
  if ('creditsCost' in params) return params.creditsCost
  if ('generateCount' in params) return params.generateCount
  // photo-fission（PRD v2）不计费，无 creditsCost / generateCount 字段。
  return 0
}

// -----------------------------------------------------------------------------
// PR3：storage 适配层接入点
// -----------------------------------------------------------------------------
//
// 本节函数把 task-store 内部读写「图片字节流」/「Row 元数据」的能力，
// 收口到 `lib/server/storage` 抽象。改造原则（参考任务说明）：
// 1. 对外签名不变，所有 import task-store 的文件无需修改。
// 2. 流式持久化 / 单失败容忍 / 子集重跑（streaming-fission-pipeline.md）
//    在 local 模式下行为完全等价：底层 Map 仍是 `globalThis.fashionMvpStore`
//    （local 模式 repo 共享同一份 Map）。
// 3. 不引入新依赖，aws4fetch 已在 PR1 装好。
//
// 关于「shadow write」：local 模式 `getTaskRepo()` 返回的 repo 直接读写
// `globalThis.fashionMvpStore`，所以 `repo.insertTask` 等于 `store.tasks.set`。
// 不会双写，只是把写入入口收口在一个地方。

const storage = () => getStorageAdapter()
const taskRepo = () => getTaskRepo()

function shouldBypassOwnership(userId: string | undefined): boolean {
  return Boolean(userId?.trim()) && isLocalSuperAdminEnabled()
}

function buildTaskRow(task: GenerationTask): TaskRow {
  const createdMs = parseTimestampMs(task.createdAt) ?? Date.now()
  const updatedMs = parseTimestampMs(task.finishedAt) ?? createdMs
  return {
    id: task.taskId,
    // PR4：task.userId 在 createTask 时由调用方（API 路由）通过 requireUser 传入并落到 task 实体；
    // 历史数据（PR3 之前）可能没填，回退到第一张输入资产或默认 demo_user。
    userId: task.userId ?? task.inputAssets?.[0]?.userId ?? defaultUserId,
    type: task.featureType,
    status: task.status,
    payloadJson: JSON.stringify({
      featureType: task.featureType,
      workflowId: task.workflowId,
      inputAssetIds: task.inputAssetIds,
      params: task.params,
      progress: task.progress,
      message: task.message,
      shotProgress: task.shotProgress,
      errorMessage: task.errorMessage,
      creditsUsed: task.creditsUsed,
      userId: task.userId,
      recoveryAttempts: task.recoveryAttempts,
      lastRecoveredAt: task.lastRecoveredAt,
      recoveryExecutionKey: task.recoveryExecutionKey,
    }),
    resultJson: JSON.stringify({
      resultAssetIds: task.resultAssetIds,
      results: task.results,
      finishedAt: task.finishedAt,
    }),
    createdAt: createdMs,
    updatedAt: updatedMs,
  }
}

function buildAssetRow(
  asset: AssetRecord,
  options?: {
    kind?: AssetRow['kind']
    taskId?: string | null
    bytes?: number | null
  },
): AssetRow {
  const createdMs = parseTimestampMs(asset.createdAt) ?? Date.now()
  const kind =
    options?.kind ?? (asset.fileUrl?.includes('/results/') ? 'generated' : 'upload')
  return {
    id: asset.assetId,
    userId: asset.userId || defaultUserId,
    taskId: options?.taskId ?? asset.taskId ?? null,
    kind,
    r2Key: asset.fileUrl ?? '',
    publicUrl: asset.fileUrl ?? null,
    mime: asset.fileType ?? null,
    bytes: options?.bytes ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    createdAt: createdMs,
    favorited: asset.favorited ?? false,
  }
}

function parseTimestampMs(iso: string | undefined): number | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? time : null
}

/**
 * 通过 storage-adapter 写一张「上传图 / 资产图」。
 * local 模式落本地图片目录；cloud 模式落 R2 `users/{userId}/assets/`。
 *
 * 与原 `persistDataUrl(publicAssetDir, ...)` 等价，但把扩展名推断 + 文件名拼接 +
 * 落盘路径计算全部收口在 adapter；调用方只需要 dataUrl + 标识符。
 */
async function storeAssetFromDataUrl(
  dataUrl: string,
  assetId: string,
  mimeTypeHint: string,
  userId: string,
): Promise<{ url: string; mime: string; bytes: number }> {
  // G-fix: 不再静默返回 null。OSS 上传失败时直接抛错，让上传接口返回 500，
  // 拒绝把 base64 dataUrl 留在 store.json 里（否则 JSON.stringify 内存膨胀 → OOM）。
  const extension = getExtension(mimeTypeHint || 'image/png')
  const filename = `${assetId}.${extension}`
  const result = await storage().putImageFromDataUrl({
    userId: userId === defaultUserId ? null : userId, // local 兼容旧路径
    bucket: 'assets',
    filename,
    dataUrl,
  })
  return { url: result.publicUrl, mime: result.mime, bytes: result.bytes }
}

async function storeAssetFromBuffer(
  body: Buffer | Uint8Array,
  assetId: string,
  mimeType: string,
  userId: string,
): Promise<{ url: string; mime: string; bytes: number }> {
  const extension = getExtension(mimeType || 'image/png')
  const result = await storage().putImage({
    userId: userId === defaultUserId ? null : userId,
    bucket: 'assets',
    filename: `${assetId}.${extension}`,
    body,
    contentType: mimeType,
  })
  return { url: result.publicUrl, mime: mimeType, bytes: result.bytes }
}

/**
 * 通过 storage-adapter 写一张「生成结果图」。
 * 替代原 `persistResultImage`，保持「dataURL 直存 / HTTP URL 拉回再存」两种入口。
 */
async function storeResultFromResultAsset(
  result: ResultAsset,
  userId: string,
  logCtx?: { taskId: string; traceId: string; shotId?: string },
): Promise<{ url: string; bytes?: number; mimeType: string; width?: number; height?: number; thumbnailUrl?: string }> {
  const startedAt = Date.now()
  const stages: Record<string, number> = {}

  if (result.url.startsWith('data:')) {
    const mimeType = extractDataUrlMime(result.url) ?? 'image/png'
    const t0 = Date.now()
    const persisted = await storage().putImageFromDataUrl({
      userId: userId === defaultUserId ? null : userId,
      bucket: 'results',
      filename: `${result.assetId}.${getExtension(mimeType)}`,
      dataUrl: result.url,
    })
    stages.putOriginal = Date.now() - t0
    const t1 = Date.now()
    const dimensions = await readImageDimensionsFromBuffer(
      Buffer.from(result.url.split(',')[1] ?? '', 'base64'),
    )
    stages.readMeta = Date.now() - t1
    // 生成缩略图
    const t2 = Date.now()
    const thumbnailUrl = await generateAndUploadThumbnail(
      Buffer.from(result.url.split(',')[1] ?? '', 'base64'),
      result.assetId,
      userId,
    )
    stages.thumbnail = Date.now() - t2
    logPersistDone(logCtx, startedAt, stages, 'data')
    return { url: persisted.publicUrl, bytes: persisted.bytes, mimeType, ...dimensions, thumbnailUrl }
  }

  if (!result.url.startsWith('http')) {
    throw new Error(`生成图归档失败：URL 协议不支持（${result.url}）`)
  }

  const t0 = Date.now()
  const downloaded = await downloadSafeRemoteImage(result.url, {
    maxBytes: MAX_GENERATED_IMAGE_BYTES,
  })
  const buffer = downloaded.buffer
  stages.download = Date.now() - t0
  const t1 = Date.now()
  const imageMetadata = await readImageMetadataFromBuffer(buffer)
  stages.readMeta = Date.now() - t1
  const mimeType =
    imageMetadata.mimeType ??
    normalizeImageMime(downloaded.contentType) ??
    'image/png'
  const t2 = Date.now()
  const persisted = await storage().putImage({
    userId: userId === defaultUserId ? null : userId,
    bucket: 'results',
    filename: `${result.assetId}.${getExtension(mimeType)}`,
    body: buffer,
    contentType: mimeType,
  })
  stages.putOriginal = Date.now() - t2
  // 生成缩略图
  const t3 = Date.now()
  const thumbnailUrl = await generateAndUploadThumbnail(buffer, result.assetId, userId)
  stages.thumbnail = Date.now() - t3
  logPersistDone(logCtx, startedAt, stages, 'http')
  return {
    url: persisted.publicUrl,
    bytes: persisted.bytes,
    mimeType,
    width: imageMetadata.width,
    height: imageMetadata.height,
    thumbnailUrl,
  }
}

/**
 * 后处理完成日志：量化 gimg.success 之后的「下载→sharp→OSS 上传→缩略图」
 * 各阶段耗时。这条链路此前是无日志盲区，并发批次端到端变慢时无法定位
 * 是供应商侧还是本地后处理侧的瓶颈。
 */
function logPersistDone(
  logCtx: { taskId: string; traceId: string; shotId?: string } | undefined,
  startedAt: number,
  stages: Record<string, number>,
  source: 'data' | 'http',
): void {
  if (!logCtx) return
  const ctx: LogContext = {
    traceId: logCtx.traceId,
    taskId: logCtx.taskId,
    ...(logCtx.shotId ? { shotId: logCtx.shotId } : {}),
  }
  logImageEvent('gimg.persist', ctx, {
    stage: 'done',
    source,
    tookMs: Date.now() - startedAt,
    ...stages,
  })
}

/**
 * 生成 400px 宽的 WebP 缩略图并上传到 OSS。
 * 缩略图 key 为原图 key 的 _thumb.webp 后缀版本。
 */
async function generateAndUploadThumbnail(
  sourceBuffer: Buffer,
  assetId: string,
  userId: string,
): Promise<string | undefined> {
  try {
    const thumbnailBuffer = await sharp(sourceBuffer)
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()

    const persisted = await storage().putImage({
      userId: userId === defaultUserId ? null : userId,
      bucket: 'results',
      filename: `${assetId}_thumb.webp`,
      body: thumbnailBuffer,
      contentType: 'image/webp',
    })
    return persisted.publicUrl
  } catch (error) {
    console.warn('[thumbnail] 缩略图生成失败，降级使用原图', error)
    return undefined
  }
}

async function readImageDimensionsFromBuffer(
  buffer: Buffer,
): Promise<{ width?: number; height?: number }> {
  const metadata = await readImageMetadataFromBuffer(buffer)
  return { width: metadata.width, height: metadata.height }
}

async function readImageMetadataFromBuffer(
  buffer: Buffer,
): Promise<{ width?: number; height?: number; mimeType?: string }> {
  try {
    const metadata = await sharp(buffer).metadata()
    return {
      width: metadata.width,
      height: metadata.height,
      mimeType: sharpFormatToMime(metadata.format),
    }
  } catch {
    return {}
  }
}

function sharpFormatToMime(format: string | undefined): string | undefined {
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  if (format === 'gif') return 'image/gif'
  return undefined
}

function normalizeImageMime(contentType: string | null): string | null {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase()
  if (!mime?.startsWith('image/')) return null
  if (mime === 'image/jpg') return 'image/jpeg'
  return mime
}

function extractDataUrlMime(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);base64,/)
  return match ? match[1] : null
}

export async function createAsset(input: {
  /** 内部派生资产可传稳定 id，以便重复请求安全复用。普通上传不要传。 */
  assetId?: string
  fileName: string
  fileType: string
  width?: number
  height?: number
  fileUrl?: string
  dataUrl?: string
  /** 服务端处理结果直接以字节流持久化，避免转 base64 放大内存。 */
  body?: Buffer | Uint8Array
  /** PR4：归属用户 id。未传或为空时回退到 defaultUserId（local 兼容旧调用点）。 */
  userId?: string
  /** PR4：关联的 taskId（仅 generated 类资产）。upload 类一般不传。 */
  taskId?: string | null
}) {
  await ensureStoreReady()
  const effectiveUserId =
    input.userId && input.userId.trim() ? input.userId : defaultUserId
  if (input.dataUrl && input.body) {
    throw new Error('createAsset 不能同时传入 dataUrl 和 body')
  }

  const assetId = input.assetId?.trim() || createId('asset')
  if (!/^[A-Za-z0-9_-]+$/.test(assetId)) {
    throw new Error('createAsset 的 assetId 格式无效')
  }

  const existingAsset = store.assets.get(assetId)
  if (existingAsset) {
    if (existingAsset.userId !== effectiveUserId) {
      throw new Error('createAsset 的 assetId 已被其他用户占用')
    }
    return existingAsset
  }

  // PR3：通过 storage-adapter 写图；local 模式落本地图片目录并返回稳定 URL，
  // cloud 模式落 R2。
  // PR4：把 effectiveUserId 透传给 adapter，cloud 模式下 R2 路径前缀
  // `users/{userId}/assets/...` 实现数据隔离。
  // G-fix：storeAssetFromDataUrl 失败时抛错，由上传接口 catch 返回 500。
  // 不再静默把 base64 留在 store.json（OOM 导火索）。
  const persistedFile = input.body
    ? await storeAssetFromBuffer(input.body, assetId, input.fileType, effectiveUserId)
    : input.dataUrl
      ? await storeAssetFromDataUrl(
          input.dataUrl,
          assetId,
          input.fileType,
          effectiveUserId,
        )
      : null

  const asset: AssetRecord = {
    assetId,
    userId: effectiveUserId,
    projectId: defaultProjectId,
    fileName: input.fileName,
    fileUrl: persistedFile?.url ?? input.fileUrl ?? '/placeholder.jpg',
    fileType: input.fileType,
    dataUrl: persistedFile ? undefined : input.dataUrl,
    width: input.width ?? 1024,
    height: input.height ?? 1365,
    createdAt: new Date().toISOString(),
    taskId: input.taskId ?? null,
  }

  store.assets.set(asset.assetId, asset)
  // PR3：shadow write 到 repo。local 模式 repo 共享同一份 Map，等价 no-op；
  // cloud 模式会写入 D1 assets 表。失败不阻塞主流程，仅记录到 stderr。
  try {
    await taskRepo().insertAsset(
      buildAssetRow(asset, {
        kind: 'upload',
        taskId: input.taskId ?? null,
        bytes: persistedFile?.bytes ?? null,
      }),
    )
  } catch (error) {
    console.error('[task-store] insertAsset 失败：', error)
  }
  await persistStore()
  return asset
}

export async function getAsset(assetId: string) {
  await ensureStoreReady()
  return store.assets.get(assetId)
}

/**
 * 列出任务。PR4 起支持按 userId 过滤。
 *
 * - 不传 opts.userId（或传 undefined / 空字符串）：返回全表（兼容历史调用）
 * - 传 opts.userId：仅返回 task.userId === opts.userId 的任务
 *
 * 与 listTasksByUser repo 接口保持同向：local 模式过滤 in-memory map，
 * cloud 模式由 D1 WHERE 子句过滤。
 */
export async function listTasks(opts?: { userId?: string }) {
  await ensureStoreReady()
  const userId = opts?.userId?.trim()
  const bypassOwnership = shouldBypassOwnership(userId)
  return Array.from(store.tasks.values())
    .filter((task) => {
      if (!userId || bypassOwnership) return true
      // 历史任务 task.userId 可能 undefined，过滤时视为 demo_user
      return (task.userId ?? defaultUserId) === userId
    })
    .map(hydrateTaskInputAssets)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
}

/**
 * 获取单个任务。PR4 起支持 ownership 校验。
 *
 * - 不传 opts.userId：返回 task（兼容历史调用 / 内部 service 间互调）
 * - 传 opts.userId：仅在 task.userId === opts.userId 时返回；不匹配返回 undefined
 *   （等价于 task 不存在，由 API 路由统一返回 404，不暴露存在性）
 */
export async function getTask(taskId: string, opts?: { userId?: string }) {
  await ensureStoreReady()
  const task = store.tasks.get(taskId)
  if (!task) return undefined
  const userId = opts?.userId?.trim()
  if (userId && !shouldBypassOwnership(userId)) {
    const ownerId = task.userId ?? defaultUserId
    if (ownerId !== userId) return undefined
  }
  return hydrateTaskInputAssets(task)
}

export async function cancelTask(taskId: string, userId?: string) {
  await ensureStoreReady()
  const task = store.tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }

  const ownerUserId = task.userId ?? defaultUserId
  const requester = userId?.trim()
  if (
    requester &&
    !shouldBypassOwnership(requester) &&
    ownerUserId !== requester
  ) {
    throw new Error('任务不存在')
  }

  if (task.status !== 'pending' && task.status !== 'running') {
    throw new Error('当前任务状态不允许取消')
  }

  cancelScheduledTask(taskId, '任务已手动取消')
  runningTaskControllers.get(taskId)?.abort()
  const resultCount = task.results.length
  const succeededShotIds = new Set(
    task.results
      .map((result) => result.shotId)
      .filter((shotId): shotId is string => Boolean(shotId)),
  )
  updateTask(taskId, {
    status: 'cancelled',
    progress: 100,
    message: `已手动取消，已生成 ${resultCount} 张图`,
    shotProgress: ensureCancellationShotProgress(task).map((item) => {
      if (item.status === 'success' || succeededShotIds.has(item.shotId)) {
        return { ...item, status: 'success', message: '已生成' }
      }
      return { ...item, status: 'cancelled', message: '已取消' }
    }),
    finishedAt: new Date().toISOString(),
  })

  const refreshed = store.tasks.get(taskId)
  return hydrateTaskInputAssets(refreshed ?? task)
}

/** 仅供服务端编排使用；相同用户和确认键始终绑定同一个任务。 */
export function getIdempotentTaskId(userId: string, key: string): string {
  return `task_idem_${createHash('sha256').update(JSON.stringify([userId, key])).digest('hex')}`
}

/** 取消状态不代表上游 HTTP 已结束；Beta 用它等待真实执行释放。 */
export function isTaskExecutionActive(taskId: string): boolean {
  return runningTaskControllers.has(taskId)
}

export async function createTask(input: {
  featureType: FeatureType
  inputAssetIds: string[]
  params: TaskParams
  /** PR4：任务归属用户 id。未传则回退到 defaultUserId（local 兼容旧调用点）。 */
  userId?: string
  /** 可选：持久化完成后才启动；旧调用不受影响。不得直接接受客户端自定义键。 */
  idempotencyKey?: string
}) {
  await ensureStoreReady()
  if (!FEATURE_WORKFLOWS[input.featureType]) {
    throw new Error('不支持的功能类型')
  }

  const normalizedParams = normalizeTaskParams(
    input.featureType,
    input.params,
    input.inputAssetIds.length,
    input.inputAssetIds,
  )

  const effectiveUserId =
    input.userId && input.userId.trim() ? input.userId : defaultUserId

  const inaccessibleAsset = input.inputAssetIds.find((assetId) => {
    const asset = store.assets.get(assetId)
    if (!asset) return true
    if (shouldBypassOwnership(effectiveUserId)) return false
    return (asset.userId ?? defaultUserId) !== effectiveUserId
  })
  if (inaccessibleAsset) {
    throw new Error(`素材不存在或无权访问：${inaccessibleAsset}`)
  }

  validatePhotoFissionFaceMaskAsset(
    input.featureType,
    normalizedParams,
    effectiveUserId,
  )

  const taskId = input.idempotencyKey
    ? getIdempotentTaskId(effectiveUserId, input.idempotencyKey)
    : createId('task')
  if (input.idempotencyKey) {
    const existing = store.tasks.get(taskId)
    if (existing) {
      if (
        existing.userId !== effectiveUserId ||
        existing.featureType !== input.featureType ||
        JSON.stringify(existing.inputAssetIds) !== JSON.stringify(input.inputAssetIds) ||
        JSON.stringify(existing.params) !== JSON.stringify(normalizedParams)
      ) {
        throw new Error('幂等确认参数冲突')
      }
      return idempotentCreations.get(taskId) ?? hydrateTaskInputAssets(existing)
    }
  }
  const task: GenerationTask = {
    taskId,
    userId: effectiveUserId,
    featureType: input.featureType,
    workflowId: FEATURE_WORKFLOWS[input.featureType],
    inputAssetIds: input.inputAssetIds,
    params: normalizedParams,
    status: 'pending',
    progress: 0,
    message: '任务已创建，等待生成',
    resultAssetIds: [],
    results: [],
    shotProgress: buildInitialShotProgress(input.featureType, normalizedParams),
    createdAt: new Date().toISOString(),
    creditsUsed: getCredits(normalizedParams),
  }

  store.tasks.set(taskId, task)

  // G-fix: 把完整 params（含 prompt）写入日志，下次 store 损坏时可从日志恢复提示词。
  // 用 try/catch 包裹，日志失败绝不影响任务创建。
  try {
    const logParams = { ...normalizedParams } as Record<string, unknown>
    // 截断超长字段防日志爆炸（prompt 4K+ 已足够恢复）
    const promptVal = logParams.prompt
    if (typeof promptVal === 'string' && promptVal.length > 8000) {
      logParams.prompt = promptVal.slice(0, 8000) + '...<truncated>'
    }
    console.log(
      JSON.stringify({
        evt: 'task.created',
        taskId,
        userId: effectiveUserId,
        featureType: input.featureType,
        inputAssetIds: input.inputAssetIds,
        params: logParams,
      }),
    )
  } catch {
    // 日志失败忽略
  }

  if (input.idempotencyKey) {
    const creation = (async () => {
      try {
        // Beta 必须先落盘，避免刷新/崩溃后再次确认产生重复消费。
        await persistStore()
      } catch (error) {
        store.tasks.delete(taskId)
        throw error
      }
      setTimeout(() => {
        void taskRepo().insertTask(buildTaskRow(task)).catch((error) => {
          console.error('[task-store] insertTask 失败：', error)
        })
        void runTask(taskId)
      }, 0)
      return task
    })()
    idempotentCreations.set(taskId, creation)
    try {
      return await creation
    } finally {
      idempotentCreations.delete(taskId)
    }
  }

  setTimeout(() => {
    // 创建接口必须快速返回；repo shadow write / JSON 落盘 / 后台生成都放到
    // 响应后的 tick，避免拖住前端按钮的“创建任务中”状态。
    void taskRepo().insertTask(buildTaskRow(task)).catch((error) => {
      console.error('[task-store] insertTask 失败：', error)
    })
    void persistStore()
    void runTask(taskId)
  }, 0)

  return task
}

function normalizeTaskParams(
  featureType: FeatureType,
  params: TaskParams,
  inputAssetCount: number,
  inputAssetIds: string[],
): TaskParams {
  if (featureType === 'pose-fission') {
    return normalizePoseFissionParams(params, inputAssetCount)
  }

  if (featureType === 'ai-fashion-photo') {
    return normalizeAiFashionPhotoParams(params, inputAssetCount)
  }

  if (featureType === 'photo-fission') {
    return normalizePhotoFissionParams(params, inputAssetCount, inputAssetIds)
  }

  return params
}

function validatePhotoFissionFaceMaskAsset(
  featureType: FeatureType,
  params: TaskParams,
  userId: string,
) {
  if (featureType !== 'photo-fission') return
  const photoParams = params as PhotoFissionParams
  if (!photoParams.faceIdModelId) return

  const faceMaskAssetId = photoParams.faceMaskAssetId?.trim()
  if (!faceMaskAssetId) {
    throw new Error('请先涂抹主图五官区域')
  }

  const asset = store.assets.get(faceMaskAssetId)
  if (!asset) {
    throw new Error(`人脸 mask 素材不存在：${faceMaskAssetId}`)
  }
  if (
    !shouldBypassOwnership(userId) &&
    (asset.userId ?? defaultUserId) !== userId
  ) {
    throw new Error(`人脸 mask 素材不存在：${faceMaskAssetId}`)
  }
}

function buildInitialShotProgress(
  featureType: FeatureType,
  params: TaskParams,
): ShotProgress[] {
  // 裤子保留逐镜头进度卡；连衣裙/套装只提供任务级取消入口，不建初始进度。
  if (featureType === 'photo-fission') {
    const photoParams = params as PhotoFissionParams
    if (photoParams.childrensCategory !== 'pants') return []
    return buildPhotoFissionShotProgress(photoParams)
  }

  return []
}

function buildPhotoFissionShotProgress(params: PhotoFissionParams): ShotProgress[] {
  const shotPlan = params.shotPlan ?? []
  return shotPlan.map((shot, index) => ({
    shotId: shot.shotId ?? `shot_${index + 1}`,
    label: shot.label || `镜头 ${index + 1}`,
    status: 'prompting',
    message: '正在写提示词...',
  }))
}

function ensureShotProgress(task: GenerationTask): ShotProgress[] {
  if (task.shotProgress?.length) return task.shotProgress
  return buildInitialShotProgress(task.featureType, task.params)
}

function ensureCancellationShotProgress(task: GenerationTask): ShotProgress[] {
  if (task.shotProgress?.length) return task.shotProgress
  if (task.featureType === 'photo-fission') {
    return buildPhotoFissionShotProgress(task.params as PhotoFissionParams)
  }
  return buildInitialShotProgress(task.featureType, task.params)
}

function updateShotProgress(
  taskId: string,
  shotId: string,
  patch: Partial<Omit<ShotProgress, 'shotId'>>,
) {
  const task = store.tasks.get(taskId)
  if (!task) return

  const current = ensureShotProgress(task)
  const found = current.some((item) => item.shotId === shotId)
  const next = found
    ? current.map((item) =>
        item.shotId === shotId ? { ...item, ...patch, shotId } : item,
      )
    : [
        ...current,
        {
          shotId,
          label: patch.label ?? shotId,
          status: patch.status ?? 'generating',
          message: patch.message ?? '正在生图...',
          retryAttempt: patch.retryAttempt,
        },
      ]

  updateTask(taskId, { shotProgress: next })
}

function updateAllShotProgress(
  taskId: string,
  status: ShotProgressStatus,
  message: string,
  targetShotIds?: ReadonlySet<string>,
) {
  const task = store.tasks.get(taskId)
  if (!task) return
  updateTask(taskId, {
    shotProgress: ensureShotProgress(task).map((item) => {
      if (targetShotIds && !targetShotIds.has(item.shotId)) return item
      if (item.status === 'success') return item
      if (!targetShotIds && item.status === 'failed') return item
      return { ...item, status, message }
    }),
  })
}

function markMissingShotProgressFailed(taskId: string, message: string) {
  const task = store.tasks.get(taskId)
  if (!task) return
  const succeeded = new Set(
    task.results
      .map((result) => result.shotId)
      .filter((shotId): shotId is string => Boolean(shotId)),
  )
  updateTask(taskId, {
    shotProgress: ensureShotProgress(task).map((item) => {
      if (item.status === 'success') return item
      if (succeeded.has(item.shotId)) {
        return { ...item, status: 'success', message: '已生成' }
      }
      return { ...item, status: 'failed', message }
    }),
  })
}

function assertTaskNotCancelled(taskId: string, signal?: AbortSignal) {
  const task = store.tasks.get(taskId)
  if (signal?.aborted || task?.status === 'cancelled') {
    throw new Error('任务已手动取消')
  }
}

async function resolvePhotoFissionFaceMaskDataUrl(
  params: PhotoFissionParams,
): Promise<string | null> {
  if (!params.faceIdModelId) return null
  const faceMaskAssetId = params.faceMaskAssetId?.trim()
  if (!faceMaskAssetId) {
    throw new Error('请先涂抹主图五官区域')
  }
  const asset = store.assets.get(faceMaskAssetId)
  if (!asset) {
    throw new Error(`人脸 mask 素材不存在：${faceMaskAssetId}`)
  }
  // photo-fission 固定走 Gemini/laozhang 链路，可放心用 URL 直传。
  const dataUrl = asset.dataUrl ?? (await resolveAssetToDataUrl(asset, { preferUrlPassthrough: true }))
  if (!dataUrl) {
    throw new Error(`人脸 mask 素材无法读取：${faceMaskAssetId}`)
  }
  return dataUrl
}

function hydrateTaskInputAssets(task: GenerationTask): GenerationTask {
  return {
    ...task,
    inputAssets: task.inputAssetIds
      .map((assetId) => store.assets.get(assetId))
      .filter((asset): asset is AssetRecord => Boolean(asset)),
  }
}

interface RunTaskOptions {
  targetUnitIds?: string[]
  recoveryExecutionKey?: string
}

function mergeResultsByAssetId(
  existing: ResultAsset[],
  incoming: ResultAsset[],
): ResultAsset[] {
  const merged = new Map(existing.map((result) => [result.assetId, result]))
  for (const result of incoming) merged.set(result.assetId, result)
  return [...merged.values()]
}

async function runTask(taskId: string, options: RunTaskOptions = {}) {
  console.log('[task-store] runTask 开始执行:', taskId)
  await storeReady
  const task = store.tasks.get(taskId)
  if (!task) {
    console.log('[task-store] runTask 找不到任务:', taskId)
    return
  }
  if (task.status !== 'pending' && task.status !== 'running') {
    console.log('[task-store] runTask 跳过终态任务:', taskId, task.status)
    return
  }
  if (
    options.recoveryExecutionKey &&
    task.recoveryExecutionKey !== options.recoveryExecutionKey
  ) {
    console.log('[task-store] runTask 跳过已过期的恢复批次:', taskId)
    return
  }
  console.log('[task-store] runTask 找到任务，状态:', task.status)

  // PR4：task.userId 由 createTask 注入；historical task 没存 userId 时回退到 defaultUserId。
  const ownerUserId = task.userId ?? defaultUserId
  const controller = new AbortController()
  runningTaskControllers.set(taskId, controller)
  const targetUnitIds = options.targetUnitIds?.length
    ? Array.from(new Set(options.targetUnitIds))
    : undefined
  const targetUnitIdSet = targetUnitIds ? new Set(targetUnitIds) : undefined

  try {
    updateTask(taskId, {
      status: 'running',
      progress: 18,
      message: '正在校验上传素材',
      shotProgress: ensureShotProgress(task).map((item) => ({
        ...item,
        ...(targetUnitIdSet && !targetUnitIdSet.has(item.shotId)
          ? {}
          : { status: 'prompting' as const, message: '正在写提示词...' }),
      })),
      finishedAt: undefined,
      errorMessage: undefined,
    })

    await wait(500)
    assertTaskNotCancelled(taskId, controller.signal)
    updateTask(taskId, {
      progress: 45,
      message: '正在准备固定工作流参数',
    })

    await wait(500)
    assertTaskNotCancelled(taskId, controller.signal)
    updateTask(taskId, {
      progress: 72,
      message: '正在调用第三方生图 API',
    })
    updateAllShotProgress(
      taskId,
      'generating',
      '正在生图...',
      targetUnitIdSet,
    )

    const preferUrlPassthrough = taskTargetsGeminiFamily(task)
    const inputImages = (
      await Promise.all(
        task.inputAssetIds.map(async (assetId) => {
          const asset = store.assets.get(assetId)
          if (!asset) return null
          if (asset.dataUrl) return asset.dataUrl
          return resolveAssetToDataUrl(asset, { preferUrlPassthrough })
        }),
      )
    ).filter((image): image is string => Boolean(image))

    const isPhotoFission = task.featureType === 'photo-fission'
    const isPoseFission = task.featureType === 'pose-fission'
    // photo-fission / pose-fission 都走流式持久化：每个 shot/pose 成功立即写盘 + 更新 store，
    // 即使后续 shot 卡死整个 pipeline，已成功的图也不会丢。
    // 其他 feature 保持原 saveResults(results) 批量持久化路径不变。
    const useStreamingPersist = isPhotoFission || isPoseFission

    const persistedResults: ResultAsset[] = []
    const onShotResult = useStreamingPersist
      ? async (result: ResultAsset) => {
          assertTaskNotCancelled(taskId, controller.signal)
          await persistOneResult(taskId, result, ownerUserId)
          persistedResults.push(result)
          updateShotProgress(taskId, result.shotId ?? result.assetId, {
            status: 'success',
            message: '已生成',
          })
        }
      : undefined

    let results: ResultAsset[]
    if (isPoseFission) {
      // pose-fission 直接调 runPoseFissionPipeline，跳过 runThirdPartyWorkflow，
      // 避免双重 Google 调用与 demo 路径分叉（demo 模式仍在 runThirdPartyWorkflow 内处理 photo-fission，
      // pose-fission demo 退化为占位 case 输出由后续 PR 处理；此 PR 关注真实生产路径）。
      results = await runPoseFissionPipeline({
        userId: ownerUserId,
        taskId,
        inputImages,
        params: task.params as PoseFissionParams,
        apiKey: process.env.GOOGLE_API_KEY ?? '',
        timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
        signal: controller.signal,
        onShotResult,
        targetPoseIds: targetUnitIds,
      })
    } else {
      const faceMaskImage = isPhotoFission
        ? await resolvePhotoFissionFaceMaskDataUrl(task.params as PhotoFissionParams)
        : null
      results = await runThirdPartyWorkflow({
        userId: ownerUserId,
        taskId,
        featureType: task.featureType,
        workflowId: task.workflowId,
        inputImages,
        params: task.params,
        faceMaskImage,
        signal: controller.signal,
        onShotProgress: (shotId, message, retryAttempt) => {
          updateShotProgress(taskId, shotId, {
            status: 'retrying',
            message,
            retryAttempt,
          })
        },
        onShotResult,
        targetShotIds: targetUnitIds,
      })
    }
    assertTaskNotCancelled(taskId, controller.signal)

    // photo-fission / pose-fission：results 已在 onShotResult 内全部持久化，禁止再走 saveResults 重复写盘。
    // 其他 feature：批量持久化生成 resultAssetIds。
    const finalResults = useStreamingPersist
      ? mergeResultsByAssetId(
          task.results,
          store.tasks.get(taskId)?.results ?? persistedResults,
        )
      : results
    const resultAssetIds = useStreamingPersist
      ? finalResults.map((item) => item.assetId)
      : await saveResults(results, taskId, ownerUserId)

    const { status, message } = resolveTaskCompletion(task, finalResults)
    const finalShotProgress = ensureShotProgress(store.tasks.get(taskId) ?? task)
      .map((item, index) => {
        const matchingResult = finalResults.find(
          (result) =>
            (result.shotId ?? (index === 0 ? 'result_1' : '')) === item.shotId,
        )
        if (item.status === 'success' || matchingResult) {
          return { ...item, status: 'success' as const, message: '已生成' }
        }
        return { ...item, status: 'failed' as const, message: '重跑失败' }
      })
    updateTask(taskId, {
      status,
      progress: 100,
      message,
      results: finalResults,
      resultAssetIds,
      shotProgress: finalShotProgress,
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    const currentTask = store.tasks.get(taskId)
    if (currentTask?.status === 'cancelled') {
      updateAllShotProgress(taskId, 'cancelled', '已取消')
      return
    }
    const reason = error instanceof Error ? error.message : '未知错误'
    markMissingShotProgressFailed(taskId, '重跑失败')
    const preservedResults = currentTask?.results ?? []
    const completion = currentTask
      ? resolveTaskCompletion(currentTask, preservedResults)
      : null
    updateTask(taskId, {
      status:
        preservedResults.length > 0 && completion
          ? completion.status
          : 'failed',
      progress: 100,
      message:
        preservedResults.length > 0 && completion
          ? completion.message
          : '生成失败',
      errorMessage: reason,
      finishedAt: new Date().toISOString(),
    })
  } finally {
    runningTaskControllers.delete(taskId)
    if (options.recoveryExecutionKey) {
      activeRecoveryExecutionKeys.delete(options.recoveryExecutionKey)
    }
  }
}

/**
 * 流式持久化单张已成功的 ResultAsset：
 * - 复用 storage-adapter 把图片写入本地目录或 R2
 * - 在 store.assets 中登记对应 AssetRecord
 * - 增量更新 task 的 results / resultAssetIds / progress / message
 *
 * 仅供 photo-fission onShotResult 回调使用。runTask 最终会用 persistedResults 替代
 * pipeline 返回值并跳过 saveResults，避免重复写盘。
 */
async function persistOneResult(
  taskId: string,
  result: ResultAsset,
  ownerUserId: string = defaultUserId,
) {
  const existingTask = store.tasks.get(taskId)
  if (existingTask?.results.some((item) => item.assetId === result.assetId)) {
    return
  }
  // PR3：通过 storage-adapter 写「生成结果图」。local 模式落本地图片目录，
  // cloud 模式落 R2 `users/{userId}/results/`。
  // PR4：把 ownerUserId 透传给 adapter，cloud 模式下 R2 路径按用户隔离。
  // 后处理并发信号量：多个 task/shot 同时完成时，限制「下载4K→sharp→OSS」
  // 重 IO+CPU 段的瞬时并发，避免 RSS 峰值触发看门狗；同时量化 waitMs
  // 让信号量排队时间可见。
  const traceId = `${taskId}_${result.shotId ?? result.assetId}`
  const persistLogCtx = { taskId, traceId, shotId: result.shotId }
  const acquireAt = Date.now()
  const persisted = await persistSemaphore.runExclusive(async () => {
    const waitMs = Date.now() - acquireAt
    if (waitMs > 50) {
      logImageEvent('gimg.persist', persistLogCtx, {
        stage: 'acquired',
        waitMs,
      })
    }
    return storeResultFromResultAsset(result, ownerUserId, persistLogCtx)
  })
  result.url = persisted.url
  result.downloadUrl = persisted.url
  result.width = persisted.width ?? result.width
  result.height = persisted.height ?? result.height
  result.thumbnailUrl = persisted.thumbnailUrl

  const asset: AssetRecord = {
    assetId: result.assetId,
    userId: ownerUserId,
    projectId: defaultProjectId,
    fileName: `${result.assetId}.${getExtension(persisted.mimeType)}`,
    fileUrl: persisted.url,
    fileType: persisted.mimeType,
    width: result.width,
    height: result.height,
    createdAt: new Date().toISOString(),
    taskId,
  }
  store.assets.set(asset.assetId, asset)
  try {
    await taskRepo().insertAsset(
      buildAssetRow(asset, {
        kind: 'generated',
        taskId,
        bytes: persisted.bytes ?? null,
      }),
    )
  } catch (error) {
    console.error('[task-store] insertAsset (result) 失败：', error)
  }

  const currentTask = store.tasks.get(taskId)
  if (!currentTask) {
    await persistStore()
    return
  }

  const updatedResults = [...currentTask.results, result]
  const updatedResultAssetIds = [...currentTask.resultAssetIds, asset.assetId]
  const plannedCount =
    (currentTask.params as { resultCount?: number }).resultCount ?? 1
  // 72 是 runTask 调用第三方 API 时设置的起点进度，95 留给最终 status 切换；
  // 每张成功图在 [72, 95] 区间内推进，避免提前显示 100%。
  const progress = Math.min(
    95,
    72 + Math.floor((updatedResults.length / Math.max(1, plannedCount)) * 23),
  )
  updateTask(taskId, {
    results: updatedResults,
    resultAssetIds: updatedResultAssetIds,
    progress,
    message: `已生成 ${updatedResults.length} 张图`,
  })
}

function updateTask(taskId: string, patch: Partial<GenerationTask>) {
  const task = store.tasks.get(taskId)
  if (!task) return

  const next = {
    ...task,
    ...patch,
  }
  store.tasks.set(taskId, next)
  // PR3：shadow write 到 repo。local 模式 repo 共享同一份 Map（已被上面 set 过了），
  // 这里再调一次 repo.updateTask 在 local 模式下是 no-op；cloud 模式真正写 D1。
  try {
    const row = buildTaskRow(next)
    void taskRepo().updateTask(taskId, {
      type: row.type,
      status: row.status,
      payloadJson: row.payloadJson,
      resultJson: row.resultJson,
      updatedAt: row.updatedAt,
    })
  } catch (error) {
    console.error('[task-store] updateTask 失败：', error)
  }
  void persistStore()
}

/**
 * 部分 feature（如 photo-fission / pose-fission）允许 per-shot 失败容忍。
 * 这里根据 shotPlan / poses 计划数量与实际成功结果数量决定 status / message。
 */
function resolveTaskCompletion(task: GenerationTask, results: ResultAsset[]) {
  if (task.featureType === 'photo-fission') {
    const params = task.params as PhotoFissionParams
    const planned = params.resultCount ?? params.shotPlan?.length ?? results.length
    if (planned > 0 && results.length < planned) {
      return {
        status: 'partial' as const,
        message: `已生成 ${results.length}/${planned} 张，部分镜头失败`,
      }
    }
  }

  if (task.featureType === 'pose-fission') {
    const params = task.params as PoseFissionParams
    const planned =
      params.resultCount ?? params.poses?.length ?? results.length
    if (planned > 0 && results.length < planned) {
      return {
        status: 'partial' as const,
        message: `已生成 ${results.length}/${planned} 张，部分姿势失败`,
      }
    }
  }

  return {
    status: 'success' as const,
    message: '生成完成',
  }
}

async function saveResults(
  results: ResultAsset[],
  taskId?: string,
  ownerUserId: string = defaultUserId,
) {
  // 后处理并发：原 for 循环串行 await，N 张图要 N×单张耗时。
  // 改成 Promise.all + persistSemaphore，并发度由信号量控制（默认 4），
  // 保持 resultAssetIds 顺序与原串行一致（map 索引对齐）。
  const persistLogCtx = taskId
    ? { taskId, traceId: taskId }
    : undefined
  const persisted = await Promise.all(
    results.map((result) =>
      persistSemaphore.runExclusive(() =>
        storeResultFromResultAsset(result, ownerUserId, persistLogCtx),
      ),
    ),
  )

  const resultAssetIds: string[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const persistedResult = persisted[i]
    const resultUrl = persistedResult.url
    result.url = resultUrl
    result.downloadUrl = resultUrl
    result.width = persistedResult.width ?? result.width
    result.height = persistedResult.height ?? result.height
    result.thumbnailUrl = persistedResult.thumbnailUrl
    const asset: AssetRecord = {
      assetId: result.assetId,
      userId: ownerUserId,
      projectId: defaultProjectId,
      fileName: `${result.assetId}.${getExtension(persistedResult.mimeType)}`,
      fileUrl: resultUrl,
      fileType: persistedResult.mimeType,
      width: result.width,
      height: result.height,
      createdAt: new Date().toISOString(),
      taskId: taskId ?? null,
    }

    store.assets.set(asset.assetId, asset)
    try {
      await taskRepo().insertAsset(
        buildAssetRow(asset, {
          kind: 'generated',
          taskId: taskId ?? null,
          bytes: persistedResult.bytes ?? null,
        }),
      )
    } catch (error) {
      console.error('[task-store] insertAsset (saveResults) 失败：', error)
    }
    result.url = resultUrl
    result.downloadUrl = resultUrl
    resultAssetIds.push(asset.assetId)
  }

  await persistStore()
  return resultAssetIds
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadPersistedStore() {
  // G-fix: 损坏自恢复。原 catch { return } 会让 store 留空，
  // 若随后触发 persistStore() 会用空数据覆盖磁盘 → 永久丢失。
  // 现在的流程：解析失败 → 损坏文件改名保留现场 → 尝试加载最近备份 → 都失败才留空并报错。
  try {
    const raw = await readFile(storeFilePath, 'utf8')
    const data = JSON.parse(raw) as {
      assets?: AssetRecord[]
      tasks?: GenerationTask[]
    }

    if (Array.isArray(data.assets)) {
      store.assets = new Map(data.assets.map((asset) => [asset.assetId, asset]))
    }

    if (Array.isArray(data.tasks)) {
      store.tasks = new Map(data.tasks.map((task) => [task.taskId, task]))
    }

    await recoverInterruptedTasksOnColdStart()
    return
  } catch (parseError) {
    // 解析失败：把损坏文件改名保留现场，避免被后续 persistStore 覆盖
    const corruptTs = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
    const corruptBackupPath = `${storeFilePath}.corrupt-${corruptTs}`
    console.error(
      `[task-store] store.json 解析失败，正在保留现场到 ${path.basename(corruptBackupPath)} 并尝试加载备份。原因：`,
      parseError,
    )
    try {
      await rename(storeFilePath, corruptBackupPath)
    } catch (renameError) {
      // 原文件可能已不存在，继续尝试备份
      console.error('[task-store] 损坏文件改名失败（可能已不存在）：', renameError)
    }

    // 尝试加载最近的备份文件
    const restored = await tryLoadFromBackup()
    if (restored) {
      console.error(`[task-store] 已从备份恢复 store（assets=${store.assets.size}, tasks=${store.tasks.size}）`)
      await recoverInterruptedTasksOnColdStart()
      return
    }

    // 备份也没有：留空但打明显日志，绝不能静默
    console.error(
      '[task-store] 无可用备份，store 以空状态启动。新数据会写入，但历史数据已丢失。',
    )
  }
}

/**
 * G-fix: 从 data 目录找最近的 .bak-* 备份并加载。
 * 按文件修改时间倒序尝试，找到第一个能成功解析的就加载。
 * 返回 true 表示成功恢复，false 表示无可用备份。
 */
async function tryLoadFromBackup(): Promise<boolean> {
  let files: string[]
  try {
    files = await readdir(dataDir)
  } catch {
    return false
  }
  // 只看 fashion-mvp-store.json.bak-* 备份，按名称时间戳倒序
  const baseName = path.basename(storeFilePath)
  const backupNames = files
    .filter((f) => f.startsWith(`${baseName}.bak-`))
    .sort()
    .reverse()

  for (const name of backupNames.slice(0, 10)) {
    // 最多试 10 个
    const backupPath = path.join(dataDir, name)
    try {
      const raw = await readFile(backupPath, 'utf8')
      const data = JSON.parse(raw) as {
        assets?: AssetRecord[]
        tasks?: GenerationTask[]
      }
      if (Array.isArray(data.assets)) {
        store.assets = new Map(data.assets.map((asset) => [asset.assetId, asset]))
      }
      if (Array.isArray(data.tasks)) {
        store.tasks = new Map(data.tasks.map((task) => [task.taskId, task]))
      }
      console.error(`[task-store] 从备份恢复成功：${name}`)
      return true
    } catch {
      continue // 这个备份也坏了，试下一个
    }
  }
  return false
}

const MAX_TASK_RECOVERY_ATTEMPTS = Math.max(
  0,
  Number.parseInt(process.env.TASK_RECOVERY_MAX_ATTEMPTS ?? '2', 10) || 2,
)

async function recoverInterruptedTasksOnColdStart() {
  if (!shouldStartInterruptedTaskRecovery(
    process.env.NODE_ENV,
    globalStore.fashionMvpRecoveryStarted === true,
  )) {
    return
  }

  // 先占用本进程的冷启动恢复权，避免模块重载或并发初始化重复执行。
  globalStore.fashionMvpRecoveryStarted = true
  await recoverInterruptedTasks()
}

async function recoverInterruptedTasks() {
  const recoveries: Array<{
    taskId: string
    targetUnitIds: string[]
    executionKey: string
  }> = []
  let changed = false
  const recoveredAt = new Date().toISOString()

  for (const task of store.tasks.values()) {
    const decision = decideInterruptedTaskRecovery(
      task,
      MAX_TASK_RECOVERY_ATTEMPTS,
    )
    if (decision.kind === 'ignore') continue

    changed = true
    if (decision.kind === 'complete') {
      store.tasks.set(task.taskId, {
        ...task,
        status: 'success',
        progress: 100,
        message: '生成完成',
        errorMessage: undefined,
        finishedAt: recoveredAt,
      })
      continue
    }
    if (decision.kind === 'fail') {
      store.tasks.set(task.taskId, {
        ...task,
        status: task.results.length > 0 ? 'partial' : 'failed',
        progress: 100,
        message: task.results.length > 0 ? '部分结果已保留，自动恢复已停止' : '生成失败',
        errorMessage: decision.reason,
        finishedAt: recoveredAt,
      })
      continue
    }

    store.tasks.set(task.taskId, {
      ...task,
      status: 'pending',
      message: `服务重启，正在恢复未完成内容（第 ${decision.attempt}/${MAX_TASK_RECOVERY_ATTEMPTS} 次）`,
      recoveryAttempts: decision.attempt,
      lastRecoveredAt: recoveredAt,
      recoveryExecutionKey: decision.executionKey,
      errorMessage: undefined,
      finishedAt: undefined,
    })
    recoveries.push({
      taskId: task.taskId,
      targetUnitIds: decision.targetUnitIds,
      executionKey: decision.executionKey,
    })
  }

  if (changed) await persistStore()
  for (const recovery of recoveries) {
    if (activeRecoveryExecutionKeys.has(recovery.executionKey)) continue
    activeRecoveryExecutionKeys.add(recovery.executionKey)
    setTimeout(() => {
      void runTask(recovery.taskId, {
        targetUnitIds: recovery.targetUnitIds,
        recoveryExecutionKey: recovery.executionKey,
      })
    }, 0)
  }
}

async function ensureStoreReady() {
  if (!storeLoaded) {
    await storeReady
  }
}

/**
 * F-fix: 串行化磁盘写入，避免并发 last-write-wins。
 * 多个调用方可以并发触发 persistStore()，但底层 IO 排队执行，
 * 任何一次写入失败都会被吞掉以避免链路断裂，但下一次写入仍会进行。
 */
let persistChain: Promise<void> = Promise.resolve()

/**
 * 后处理并发信号量。
 *
 * gimg.success 之后的「下载 4K 图 → sharp 读 metadata → 上传 OSS 原图 →
 * sharp 生成缩略图 → 上传 OSS 缩略图」是重 IO + CPU 段，单任务峰值约
 * 80-120MB（4K 像素 buffer + sharp 工作内存）。多个 task / shot 并发完成
 * 时会扎堆，无限制并发会推高 RSS 触发看门狗。
 *
 * 默认 4：4 并发峰值 ~400-600MB，pm2 RSS 升到 ~1.3GB，离看门狗 3GB 阈值
 * 仍留 1.5GB+ 缓冲；CPU 4 核也能容纳 sharp native 线程。
 * 可通过环境变量 RESULT_PERSIST_CONCURRENCY 调整。
 */
const RESULT_PERSIST_CONCURRENCY = Math.max(
  1,
  Number(process.env.RESULT_PERSIST_CONCURRENCY ?? 4) || 4,
)

class Semaphore {
  private available: number
  private readonly waiters: (() => void)[] = []
  constructor(private readonly capacity: number) {
    this.available = capacity
  }
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.available--
  }
  release(): void {
    this.available++
    const next = this.waiters.shift()
    if (next) {
      this.available--
      next()
    }
  }
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

const persistSemaphore = new Semaphore(RESULT_PERSIST_CONCURRENCY)

function persistStore(): Promise<void> {
  const next = persistChain
    .catch(() => undefined)
    .then(() => writeStoreFile())
  persistChain = next.catch(() => undefined)
  return next
}

async function writeStoreFile(): Promise<void> {
  // G-fix: 原子写入。先写到 .tmp 文件，写成功后 rename 覆盖目标。
  // 这样即使进程在写入中途被 OOM Kill / SIGKILL，原 store.json 仍是完整的。
  // rename 在同一文件系统内是原子操作（ext4/xfs 保证）。
  await mkdir(dataDir, { recursive: true })
  const tmpPath = `${storeFilePath}.tmp-write`
  const payload = JSON.stringify(
    {
      assets: Array.from(store.assets.values()),
      tasks: Array.from(store.tasks.values()),
    },
    null,
    2,
  )
  await writeFile(tmpPath, payload, 'utf8')
  await rename(tmpPath, storeFilePath)
}

/**
 * 判断一个任务最终会不会打到 Gemini 系模型（Google 官方 / 老张 laozhang-gemini-*）。
 * photo-fission / pose-fission 固定走 Gemini 链路；ai-fashion-photo 可选模型，
 * 需要看 params.model（未指定时按 DEFAULT_FASHION_MODEL 也是 gemini- 开头处理）。
 */
function taskTargetsGeminiFamily(task: GenerationTask): boolean {
  if (task.featureType === 'photo-fission' || task.featureType === 'pose-fission') {
    return true
  }
  if (task.featureType === 'ai-fashion-photo') {
    const model = (task.params as AiFashionPhotoParams).model ?? DEFAULT_FASHION_MODEL
    return model.startsWith('gemini-')
  }
  return false
}

/**
 * Convert an asset record into a self-contained data URL the third-party API can consume.
 *
 * The third-party proxy receives the request from the Node server and has no way to fetch
 * relative URLs like `/generated/assets/foo.png` or `/local-assets/assets/foo.png`.
 * So whenever an asset only has a relative fileUrl, we read the file from disk and
 * inline it as a data URL.
 *
 * PR3 修正：cloud 模式 `fileUrl` 是 OSS 公共 URL，
 * 需要通过 storage adapter 认证下载后转换为 dataURL（Google Gemini API 需要 base64 inline data）。
 *
 * 2026-07-23：Gemini 系模型（Google 官方 / 老张 laozhang-gemini-*）支持在请求里用
 * `file_data` 直接引用公开图片 URL，上游自己去拉取，不需要我们先下载整张图再转 base64。
 * 这样能显著降低服务器内存/带宽开销，并避免多张大图参考图把请求体撑到几十上百 MB
 * 导致上游 413。当调用方明确目标模型是 Gemini 系时传 `preferUrlPassthrough: true`
 * 直接返回原始 OSS URL；其余场景（OpenAI/Volces 等需要真实字节数据的供应商，或本地
 * 相对路径这类上游根本无法访问的地址）维持原有下载 + base64 行为。
 */
async function resolveAssetToDataUrl(
  asset: AssetRecord,
  options: { preferUrlPassthrough?: boolean } = {},
): Promise<string | null> {
  const { fileUrl, fileType } = asset

  if (!fileUrl) return null
  if (fileUrl.startsWith('data:')) return fileUrl

  // HTTP/HTTPS URL：OSS 模式需要通过 storage adapter 认证下载
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    if (options.preferUrlPassthrough) {
      return fileUrl
    }
    try {
      // 尝试从 OSS publicUrl 提取 key 并通过认证方式下载
      const ossKey = extractOssKeyFromUrl(fileUrl)
      if (ossKey) {
        try {
          const image = await storage().getImage(ossKey)
          if (image) {
            const buffer = Buffer.from(image.body)
            const mimeType = fileType?.startsWith('image/')
              ? fileType
              : (image.contentType ?? `image/${getExtension(fileType ?? 'image/png')}`)
            return `data:${mimeType};base64,${buffer.toString('base64')}`
          }
          console.warn('[task-store] OSS 图片不存在，改用公共 URL 拉取：', fileUrl)
        } catch (ossError) {
          console.warn('[task-store] OSS 图片认证下载失败，改用公共 URL 拉取：', fileUrl, ossError)
        }
      }

      // 非 OSS URL、无法提取 key，或认证下载失败时，使用统一安全下载器。
      // DNS 在实际建连时校验，重定向逐跳复检，响应体超过上限立即中止。
      const downloaded = await downloadSafeRemoteImage(fileUrl, {
        maxBytes: MAX_INPUT_IMAGE_BYTES,
      })
      const buffer = downloaded.buffer

      const mimeType = fileType?.startsWith('image/')
        ? fileType
        : (downloaded.contentType ?? `image/${getExtension(fileType ?? 'image/png')}`)
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch (error) {
      console.warn('[task-store] 解析外部图片 URL 失败，跳过：', fileUrl, error)
      return null
    }
  }

  if (fileUrl.startsWith('/generated/') || fileUrl.startsWith('/local-assets/')) {
    const image = await getLocalImageForPublicUrl(fileUrl)
    if (!image) {
      console.warn('[task-store] 本地图片不存在，跳过：', fileUrl)
      return null
    }
    const buffer = Buffer.from(image.body)
    const mimeType = fileType?.startsWith('image/')
      ? fileType
      : (image.contentType ?? `image/${getExtension(fileType ?? 'image/png')}`)
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  }

  console.warn('[task-store] 未知的图片 URL 格式，跳过：', fileUrl)
  return null
}

/**
 * 从 OSS publicUrl 中提取 object key。
 * OSS publicUrl 格式：`https://bucket.oss-region.aliyuncs.com/yibai/userId/bucket/filename`
 * 提取后：`yibai/userId/bucket/filename`
 */
function extractOssKeyFromUrl(url: string): string | null {
  const ossPublicUrl = process.env.OSS_PUBLIC_URL?.trim()?.replace(/\/$/, '')
  if (!ossPublicUrl) return null
  if (!url.startsWith(ossPublicUrl + '/')) return null
  return url.slice(ossPublicUrl.length + 1)
}

/**
 * 从原图的存储 key 推导缩略图 key。
 * 缩略图命名规则（见 generateAndUploadThumbnail）：`{assetId}.{ext}` → `{assetId}_thumb.webp`。
 * 同时适用于 OSS key（`yibai/uid/results/asset_x.png`）与 local publicUrl
 * （`/local-assets/results/asset_x.png`）。
 */
function deriveThumbnailKey(key: string): string | null {
  // 已经是缩略图则不处理
  if (key.endsWith('_thumb.webp')) return null
  // 去掉最后一段扩展名，加上 _thumb.webp 后缀
  const withoutExt = key.replace(/\.[^./]+$/, '')
  if (withoutExt === key) return null // 没有扩展名，无法推导
  return `${withoutExt}_thumb.webp`
}

function getExtension(mimeType: string) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

/**
 * R5：重跑 photo-fission 失败镜头。
 *
 * 校验 task 存在、属于 photo-fission、status ∈ {partial, failed}、shotIds 都在原 shotPlan 中
 * 且当前 results 没有对应 shotId。然后基于原 inputAssetIds 与原 shotPlan 调
 * runPhotoFissionPipeline（targetShotIds 过滤），通过 onShotResult 流式持久化合并回原 task。
 *
 * 完成后用合并后的 results 重新 resolveTaskCompletion 更新 status 与 message。
 * 不另起新 task；credits 不再扣（photo-fission v2 已不计费）。
 */
export async function retryPhotoFissionShots(
  taskId: string,
  shotIds: string[],
  userId?: string,
): Promise<GenerationTask> {
  await ensureStoreReady()

  const task = store.tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  // PR4：ownership 校验。userId 传了就必须匹配，避免越权重跑别人的任务。
  const ownerUserId = task.userId ?? defaultUserId
  if (
    userId &&
    userId.trim() &&
    !shouldBypassOwnership(userId) &&
    ownerUserId !== userId.trim()
  ) {
    // 与「任务不存在」语义对齐，避免暴露任务存在性给非授权用户
    throw new Error('任务不存在')
  }
  if (task.featureType !== 'photo-fission') {
    throw new Error('仅服装大片裂变支持重跑失败镜头')
  }
  if (task.status !== 'partial' && task.status !== 'failed') {
    throw new Error('当前任务状态不允许重跑（仅 partial / failed 可重跑）')
  }

  const params = task.params as PhotoFissionParams
  if (!Array.isArray(params.shotPlan) || !params.shotPlan.length) {
    throw new Error('任务缺少 shotPlan，无法重跑')
  }

  const plannedShotIds = new Set(params.shotPlan.map((shot) => shot.shotId))
  const alreadySucceededShotIds = new Set(
    task.results
      .map((result) => result.shotId)
      .filter((id): id is string => Boolean(id)),
  )

  const uniqueShotIds = Array.from(new Set(shotIds))
  if (!uniqueShotIds.length) {
    throw new Error('请至少选择一个失败镜头')
  }

  for (const shotId of uniqueShotIds) {
    if (!plannedShotIds.has(shotId)) {
      throw new Error(`镜头 ${shotId} 不在原任务计划中`)
    }
    if (alreadySucceededShotIds.has(shotId)) {
      throw new Error(`镜头 ${shotId} 已成功，无需重跑`)
    }
  }

  // 标记为 running，避免前端轮询误判
  updateTask(taskId, {
    status: 'running',
    progress: 72,
    message: `正在重跑 ${uniqueShotIds.length} 个失败镜头`,
  })

  try {
    const inputImages = (
      await Promise.all(
        task.inputAssetIds.map(async (assetId) => {
          const asset = store.assets.get(assetId)
          if (!asset) return null
          if (asset.dataUrl) return asset.dataUrl
          // photo-fission 固定走 Gemini/laozhang 链路，可放心用 URL 直传。
          return resolveAssetToDataUrl(asset, { preferUrlPassthrough: true })
        }),
      )
    ).filter((image): image is string => Boolean(image))

    if (!inputImages.length) {
      throw new Error('原任务参考图已丢失，无法重跑')
    }
    const faceMaskImage = await resolvePhotoFissionFaceMaskDataUrl(params)

    await runPhotoFissionPipeline({
      userId: ownerUserId,
      taskId,
      inputImages,
      faceMaskImage,
      params,
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
      targetShotIds: uniqueShotIds,
      onShotResult: async (result) => {
        await persistOneResult(taskId, result, ownerUserId)
      },
    })
  } catch (error) {
    // pipeline 全部失败：保留已有 results，标记为 failed/partial（按当前 results 判定）
    const message = error instanceof Error ? error.message : '未知错误'
    const currentTask = store.tasks.get(taskId)
    if (currentTask) {
      const { status, message: resolveMessage } = resolveTaskCompletion(
        currentTask,
        currentTask.results,
      )
      updateTask(taskId, {
        status: currentTask.results.length === 0 ? 'failed' : status,
        progress: 100,
        message:
          currentTask.results.length === 0
            ? '重跑失败镜头全部失败'
            : resolveMessage,
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      })
    }
    throw error
  }

  const finalTask = store.tasks.get(taskId)
  if (!finalTask) {
    throw new Error('任务在重跑后丢失')
  }

  const { status, message } = resolveTaskCompletion(finalTask, finalTask.results)
  updateTask(taskId, {
    status,
    progress: 100,
    message,
    errorMessage: status === 'success' ? undefined : finalTask.errorMessage,
    finishedAt: new Date().toISOString(),
  })

  const refreshed = store.tasks.get(taskId)
  return hydrateTaskInputAssets(refreshed ?? finalTask)
}

export async function regeneratePhotoFissionShot(
  taskId: string,
  shotId: string,
  userId?: string,
): Promise<GenerationTask> {
  await ensureStoreReady()

  const task = assertOwnedPhotoFissionTask(taskId, userId)
  if (task.status === 'pending' || task.status === 'running') {
    throw new Error('当前任务仍在生成中，暂不能重生单张')
  }
  const params = task.params as PhotoFissionParams
  if (!Array.isArray(params.shotPlan) || !params.shotPlan.length) {
    throw new Error('任务缺少 shotPlan，无法重生')
  }
  if (!params.shotPlan.some((shot) => shot.shotId === shotId)) {
    throw new Error(`镜头 ${shotId} 不在原任务计划中`)
  }
  if (!task.results.some((result) => result.shotId === shotId)) {
    throw new Error('仅已成功的图片支持重生这张')
  }

  const ownerUserId = task.userId ?? defaultUserId
  updateTask(taskId, {
    status: 'running',
    progress: 72,
    message: `正在重生 ${shotId}`,
  })

  try {
    const inputImages = await resolveTaskInputImages(task)
    if (!inputImages.length) {
      throw new Error('原任务参考图已丢失，无法重生')
    }
    const faceMaskImage = await resolvePhotoFissionFaceMaskDataUrl(params)
    await runPhotoFissionPipeline({
      userId: ownerUserId,
      taskId,
      inputImages,
      faceMaskImage,
      params,
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
      targetShotIds: [shotId],
      resultAssetIdSuffix: createVariantSuffix('regen'),
      onShotResult: async (result) => {
        await persistOneResult(taskId, result, ownerUserId)
      },
    })
  } catch (error) {
    restoreTaskAfterVariantFailure(taskId, error, '重生这张失败')
    throw error
  }

  return finishPhotoFissionVariantTask(taskId)
}

export async function refinePhotoFissionFace(
  taskId: string,
  assetId: string,
  maskAssetId: string,
  userId?: string,
): Promise<GenerationTask> {
  await ensureStoreReady()

  const task = assertOwnedPhotoFissionTask(taskId, userId)
  if (task.status === 'pending' || task.status === 'running') {
    throw new Error('当前任务仍在生成中，暂不能重修脸')
  }
  const params = task.params as PhotoFissionParams
  if (!params.faceIdModelId) {
    throw new Error('当前任务未选择人像小卡，无法重修脸')
  }

  const sourceResult = task.results.find((item) => item.assetId === assetId)
  if (!sourceResult) {
    throw new Error('要重修的人像结果不存在')
  }
  const sourceAsset = store.assets.get(assetId)
  if (!sourceAsset) {
    throw new Error('要重修的人像结果素材不存在')
  }
  const maskAsset = store.assets.get(maskAssetId)
  if (!maskAsset) {
    throw new Error('人脸重修 mask 素材不存在')
  }

  const ownerUserId = task.userId ?? defaultUserId
  if (
    !shouldBypassOwnership(userId) &&
    (maskAsset.userId ?? defaultUserId) !== ownerUserId
  ) {
    throw new Error('人脸重修 mask 素材不存在')
  }

  const faceIdAssetId = params.faceIdModelId
  const faceIdAsset = store.assets.get(faceIdAssetId)
  if (!faceIdAsset) {
    throw new Error('原任务人像小卡已丢失，无法重修脸')
  }

  updateTask(taskId, {
    status: 'running',
    progress: 72,
    message: `正在重修 ${sourceResult.shotId ?? '当前图片'} 的脸`,
  })

  try {
    const baseImage = await resolveRequiredAssetToDataUrl(sourceAsset, '要重修的结果图')
    const faceIdImage = await resolveRequiredAssetToDataUrl(faceIdAsset, '人像小卡')
    const faceMaskImage = await resolveRequiredAssetToDataUrl(maskAsset, '重修脸 mask')
    const result = await runPhotoFissionFaceRefine({
      userId: ownerUserId,
      taskId,
      params,
      sourceResult,
      baseImage,
      faceIdImage,
      faceMaskImage,
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      resultAssetIdSuffix: createVariantSuffix('face_refine'),
    })
    await persistOneResult(taskId, result, ownerUserId)
  } catch (error) {
    restoreTaskAfterVariantFailure(taskId, error, '重修脸失败')
    throw error
  }

  return finishPhotoFissionVariantTask(taskId)
}

async function resolveRequiredAssetToDataUrl(
  asset: AssetRecord,
  label: string,
): Promise<string> {
  // 重修脸固定走 photo-fission 的 Gemini/laozhang 链路，可放心用 URL 直传。
  const dataUrl = asset.dataUrl ?? (await resolveAssetToDataUrl(asset, { preferUrlPassthrough: true }))
  if (dataUrl) return dataUrl

  throw new Error(
    `重修脸所需素材无法读取：${label}（assetId=${asset.assetId}，url=${asset.fileUrl || '空'}）`,
  )
}

function assertOwnedPhotoFissionTask(
  taskId: string,
  userId?: string,
): GenerationTask {
  const task = store.tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  const ownerUserId = task.userId ?? defaultUserId
  if (
    userId &&
    userId.trim() &&
    !shouldBypassOwnership(userId) &&
    ownerUserId !== userId.trim()
  ) {
    throw new Error('任务不存在')
  }
  if (task.featureType !== 'photo-fission') {
    throw new Error('仅服装大片裂变支持该操作')
  }
  return task
}

async function resolveTaskInputImages(task: GenerationTask): Promise<string[]> {
  return (
    await Promise.all(
      task.inputAssetIds.map(async (assetId) => {
        const asset = store.assets.get(assetId)
        if (!asset) return null
        if (asset.dataUrl) return asset.dataUrl
        // 仅供 photo-fission 变体任务调用（见 assertOwnedPhotoFissionTask 门禁），
        // 固定走 Gemini/laozhang 链路，可放心用 URL 直传。
        return resolveAssetToDataUrl(asset, { preferUrlPassthrough: true })
      }),
    )
  ).filter((image): image is string => Boolean(image))
}

function createVariantSuffix(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function restoreTaskAfterVariantFailure(
  taskId: string,
  error: unknown,
  fallbackMessage: string,
) {
  const task = store.tasks.get(taskId)
  if (!task) return
  const { status, message } = resolveTaskCompletion(task, task.results)
  updateTask(taskId, {
    status,
    progress: 100,
    message: task.results.length ? message : fallbackMessage,
    errorMessage: error instanceof Error ? error.message : String(error),
    finishedAt: new Date().toISOString(),
  })
}

function finishPhotoFissionVariantTask(taskId: string): GenerationTask {
  const task = store.tasks.get(taskId)
  if (!task) {
    throw new Error('任务在操作后丢失')
  }
  const { status, message } = resolveTaskCompletion(task, task.results)
  updateTask(taskId, {
    status,
    progress: 100,
    message,
    errorMessage: status === 'success' ? undefined : task.errorMessage,
    finishedAt: new Date().toISOString(),
  })
  const refreshed = store.tasks.get(taskId)
  return hydrateTaskInputAssets(refreshed ?? task)
}

/**
 * 重跑 pose-fission 失败姿势（PRD D10）。
 *
 * 与 retryPhotoFissionShots 同构：校验 task 存在、属于 pose-fission、
 * status ∈ {partial, failed}、poseIds 都在原 poses 中
 * 且当前 results 没有对应 poseId（已成功的不允许重跑）。
 * 然后基于原 inputAssetIds 与原 poses 调
 * runPoseFissionPipeline（targetPoseIds 过滤），通过 onShotResult 流式持久化
 * 合并回原 task。
 *
 * 完成后用合并后的 results 重新 resolveTaskCompletion 更新 status 与 message。
 * 不另起新 task；credits 不再扣（pose-fission D5：MVP 不计费）。
 *
 * 抽象时机说明（PRD §Out of Scope）：
 * 当前 retryPhotoFissionShots 与本函数结构高度相似，
 * 之所以暂不抽象出通用 retryFissionShots(featureType, ...) 是为了：
 * 1. 两个 feature 的「计划单位」字段不同（shotPlan vs poses）
 * 2. pipeline 调用接口不同（targetShotIds vs targetPoseIds）
 * 3. 错误文案差异（镜头 vs 姿势）
 * 待第三个类似 feature 出现时再抽象，避免过早设计 lowest-common-denominator 契约。
 */
export async function retryPoseFissionShots(
  taskId: string,
  poseIds: string[],
  userId?: string,
): Promise<GenerationTask> {
  await ensureStoreReady()

  const task = store.tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  const ownerUserId = task.userId ?? defaultUserId
  if (
    userId &&
    userId.trim() &&
    !shouldBypassOwnership(userId) &&
    ownerUserId !== userId.trim()
  ) {
    throw new Error('任务不存在')
  }
  if (task.featureType !== 'pose-fission') {
    throw new Error('仅姿势裂变支持重跑失败姿势')
  }
  if (task.status !== 'partial' && task.status !== 'failed') {
    throw new Error('当前任务状态不允许重跑（仅 partial / failed 可重跑）')
  }

  const params = task.params as PoseFissionParams
  if (!Array.isArray(params.poses) || !params.poses.length) {
    throw new Error('任务缺少姿势快照，无法重跑')
  }

  const plannedPoseIds = new Set(params.poses.map((pose) => pose.id))
  const alreadySucceededPoseIds = new Set(
    task.results
      .map((result) => result.shotId)
      .filter((id): id is string => Boolean(id)),
  )

  const uniquePoseIds = Array.from(new Set(poseIds))
  if (!uniquePoseIds.length) {
    throw new Error('请至少选择一个失败姿势')
  }

  for (const poseId of uniquePoseIds) {
    if (!plannedPoseIds.has(poseId)) {
      throw new Error(`姿势 ${poseId} 不在原任务计划中`)
    }
    if (alreadySucceededPoseIds.has(poseId)) {
      throw new Error(`姿势 ${poseId} 已成功，无需重跑`)
    }
  }

  updateTask(taskId, {
    status: 'running',
    progress: 72,
    message: `正在重跑 ${uniquePoseIds.length} 个失败姿势`,
  })

  try {
    const inputImages = (
      await Promise.all(
        task.inputAssetIds.map(async (assetId) => {
          const asset = store.assets.get(assetId)
          if (!asset) return null
          if (asset.dataUrl) return asset.dataUrl
          // pose-fission 固定走 Gemini/laozhang 链路，可放心用 URL 直传。
          return resolveAssetToDataUrl(asset, { preferUrlPassthrough: true })
        }),
      )
    ).filter((image): image is string => Boolean(image))

    if (!inputImages.length) {
      throw new Error('原任务参考图已丢失，无法重跑')
    }

    await runPoseFissionPipeline({
      userId: ownerUserId,
      taskId,
      inputImages,
      params,
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
      targetPoseIds: uniquePoseIds,
      onShotResult: async (result) => {
        await persistOneResult(taskId, result, ownerUserId)
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    const currentTask = store.tasks.get(taskId)
    if (currentTask) {
      const { status, message: resolveMessage } = resolveTaskCompletion(
        currentTask,
        currentTask.results,
      )
      updateTask(taskId, {
        status: currentTask.results.length === 0 ? 'failed' : status,
        progress: 100,
        message:
          currentTask.results.length === 0
            ? '重跑失败姿势全部失败'
            : resolveMessage,
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      })
    }
    throw error
  }

  const finalTask = store.tasks.get(taskId)
  if (!finalTask) {
    throw new Error('任务在重跑后丢失')
  }

  const { status, message } = resolveTaskCompletion(finalTask, finalTask.results)
  updateTask(taskId, {
    status,
    progress: 100,
    message,
    errorMessage: status === 'success' ? undefined : finalTask.errorMessage,
    finishedAt: new Date().toISOString(),
  })

  const refreshed = store.tasks.get(taskId)
  return hydrateTaskInputAssets(refreshed ?? finalTask)
}

/**
 * 设置资产收藏状态。收藏的资产不会被自动清理。
 */
export async function setAssetFavorite(
  assetId: string,
  favorited: boolean,
  userId?: string,
): Promise<boolean> {
  await ensureStoreReady()
  const asset = store.assets.get(assetId)
  if (!asset) return false

  if (
    userId &&
    userId.trim() &&
    !shouldBypassOwnership(userId) &&
    (asset.userId ?? defaultUserId) !== userId.trim()
  ) {
    return false
  }

  const updated = { ...asset, favorited }
  store.assets.set(assetId, updated)
  try {
    await taskRepo().insertAsset(
      buildAssetRow(updated, {
        kind: updated.fileUrl?.includes('/results/') ? 'generated' : 'upload',
      }),
    )
  } catch (error) {
    console.error('[task-store] setAssetFavorite repo sync 失败：', error)
  }
  await persistStore()
  return true
}

/**
 * 批量设置资产收藏状态。
 *
 * 用于历史收藏数据从 localStorage 迁移到服务端：前端首次加载时把本地
 * `fashion_favorites` 里的 assetId 列表一次性同步到后端，避免清理误删
 * 用户已收藏但服务端未记录的老图。
 *
 * - 跳过不存在 / 非本人 / 已是目标状态的资产
 * - 只持久化一次（避免 N 次写盘）
 *
 * @returns { updated: 实际改动的资产数, missing: 未找到/无权的 assetId 列表 }
 */
export async function setAssetsFavoriteBatch(
  assetIds: string[],
  favorited: boolean,
  userId?: string,
): Promise<{ updated: number; missing: string[] }> {
  await ensureStoreReady()
  const trimmedUser = userId?.trim()
  const bypass = userId ? shouldBypassOwnership(userId) : false

  let updated = 0
  const missing: string[] = []

  for (const assetId of assetIds) {
    const asset = store.assets.get(assetId)
    if (!asset) {
      missing.push(assetId)
      continue
    }
    if (
      trimmedUser &&
      !bypass &&
      (asset.userId ?? defaultUserId) !== trimmedUser
    ) {
      missing.push(assetId)
      continue
    }
    if ((asset.favorited ?? false) === favorited) continue

    const next = { ...asset, favorited }
    store.assets.set(assetId, next)
    updated++
    try {
      await taskRepo().insertAsset(
        buildAssetRow(next, {
          kind: next.fileUrl?.includes('/results/') ? 'generated' : 'upload',
        }),
      )
    } catch (error) {
      console.error('[task-store] setAssetsFavoriteBatch repo sync 失败：', error)
    }
  }

  if (updated > 0) {
    await persistStore()
  }

  return { updated, missing }
}

/**
 * 列出该用户全部已收藏资产的 ID。
 *
 * 用于前端初始化账号级收藏状态；所有权规则与按功能查询收藏案例保持一致。
 */
export async function listAllFavoritedAssetIds(
  userId?: string,
): Promise<string[]> {
  await ensureStoreReady()
  const normalizedUserId = userId?.trim()
  const bypassOwnership = shouldBypassOwnership(normalizedUserId)

  const result: AssetRecord[] = []
  for (const asset of store.assets.values()) {
    if (!asset.favorited) continue
    if (
      normalizedUserId &&
      !bypassOwnership &&
      (asset.userId ?? defaultUserId) !== normalizedUserId
    ) {
      continue
    }
    result.push(asset)
  }

  result.sort((a, b) => {
    const aMs = parseTimestampMs(a.createdAt) ?? 0
    const bMs = parseTimestampMs(b.createdAt) ?? 0
    return bMs - aMs
  })

  return result.map((asset) => asset.assetId)
}

/**
 * 按功能类型列出该用户收藏的生成图资产。
 *
 * 筛选条件：
 * - favorited === true（仅收藏的资产）
 * - fileUrl 含 `/results/`（仅生成图，不含用户上传素材）
 * - 通过 asset.taskId 关联到 task.featureType，匹配指定功能
 * - 无 taskId 关联的资产（历史数据）按 ai-fashion-photo 处理（向后兼容）
 *
 * @param featureType 功能类型
 * @param userId 用户 ID（可选，local 模式不校验）
 * @returns 收藏的资产列表（按 createdAt 倒序）
 */
export async function listFavoritedAssetsByFeature(
  featureType: FeatureType,
  userId?: string,
): Promise<AssetRecord[]> {
  await ensureStoreReady()
  const normalizedUserId = userId?.trim()
  const bypassOwnership = shouldBypassOwnership(normalizedUserId)

  const result: AssetRecord[] = []
  for (const asset of store.assets.values()) {
    if (!asset.favorited) continue
    if (!asset.fileUrl?.includes('/results/')) continue
    if (
      normalizedUserId &&
      !bypassOwnership &&
      (asset.userId ?? defaultUserId) !== normalizedUserId
    ) {
      continue
    }

    // 通过 taskId 关联到 task 的 featureType
    let assetFeatureType: FeatureType | undefined
    if (asset.taskId) {
      const task = store.tasks.get(asset.taskId)
      if (task) {
        assetFeatureType = task.featureType
      }
    }

    // 无 taskId 关联的历史数据，默认归到 ai-fashion-photo（向后兼容）
    if (!assetFeatureType) {
      assetFeatureType = 'ai-fashion-photo'
    }

    if (assetFeatureType !== featureType) continue

    result.push(asset)
  }

  // 按 createdAt 倒序排列
  result.sort((a, b) => {
    const aMs = parseTimestampMs(a.createdAt) ?? 0
    const bMs = parseTimestampMs(b.createdAt) ?? 0
    return bMs - aMs
  })

  return result
}

/**
 * 按日期范围查询待清理的生成图资产（只读，不执行删除）。
 *
 * 筛选条件：
 * - fileUrl 含 `/results/`（仅生成图，保留用户上传素材）
 * - createdAt 在 [startMs, endMs) 范围内
 * - favorited !== true（收藏的资产跳过）
 *
 * @param startDate YYYY-MM-DD（本地时间 00:00:00 起）
 * @param endDate   YYYY-MM-DD（本地时间 23:59:59 止）
 * @returns 资产预览列表 + 总数
 */
export async function countAssetsByDateRange(
  startDate: string,
  endDate: string,
  userId: string,
): Promise<{
  total: number
  assets: Array<{
    assetId: string
    fileName: string
    createdAt: string
    fileUrl: string
  }>
}> {
  await ensureStoreReady()
  const startMs = new Date(startDate + 'T00:00:00').getTime()
  const endMs = new Date(endDate + 'T23:59:59.999').getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return { total: 0, assets: [] }
  }

  const matched: Array<{
    assetId: string
    fileName: string
    createdAt: string
    fileUrl: string
  }> = []

  for (const asset of store.assets.values()) {
    if (asset.userId !== userId) continue
    if (asset.favorited) continue
    if (!asset.fileUrl?.includes('/results/')) continue
    const createdMs = parseTimestampMs(asset.createdAt)
    if (createdMs === null) continue
    if (createdMs >= startMs && createdMs <= endMs) {
      matched.push({
        assetId: asset.assetId,
        fileName: asset.fileName,
        createdAt: asset.createdAt,
        fileUrl: asset.fileUrl,
      })
    }
  }

  return { total: matched.length, assets: matched }
}

/**
 * 按日期范围清理生成图资产（手动触发）。
 *
 * 逻辑与原 cleanupExpiredAssets 一致，唯一区别：筛选条件从「超过 maxAgeMs」
 * 改为「createdAt 在 [startMs, endMs] 范围内」。
 *
 * 清理范围：
 * - 仅清理生成图（fileUrl 含 `/results/`），保留用户上传素材
 * - 跳过 favorited === true 的资产
 * - 删除原图 + 缩略图 + store 记录 + repo 记录 + 清空 task
 *
 * @param startDate YYYY-MM-DD（本地时间 00:00:00 起）
 * @param endDate   YYYY-MM-DD（本地时间 23:59:59 止）
 * @returns 清理统计
 */
export async function cleanupAssetsByDateRange(
  startDate: string,
  endDate: string,
  userId: string,
): Promise<{
  deletedAssets: number
  deletedObjects: number
  errors: number
  details: Array<{ assetId: string; key: string; error?: string }>
}> {
  await ensureStoreReady()
  const startMs = new Date(startDate + 'T00:00:00').getTime()
  const endMs = new Date(endDate + 'T23:59:59.999').getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return { deletedAssets: 0, deletedObjects: 0, errors: 0, details: [] }
  }

  const expired: AssetRecord[] = []
  for (const asset of store.assets.values()) {
    if (asset.userId !== userId) continue
    if (asset.favorited) continue
    if (!asset.fileUrl?.includes('/results/')) continue
    const createdMs = parseTimestampMs(asset.createdAt)
    if (createdMs === null) continue
    if (createdMs >= startMs && createdMs <= endMs) {
      expired.push(asset)
    }
  }

  let deletedAssets = 0
  let deletedObjects = 0
  let errors = 0
  const details: Array<{ assetId: string; key: string; error?: string }> = []

  for (const asset of expired) {
    const ossKey = extractOssKeyFromUrl(asset.fileUrl)
    const deleteKey = ossKey ?? asset.fileUrl

    // 删除 OSS/local 物理文件（原图 + 缩略图）
    if (deleteKey && deleteKey !== '/placeholder.jpg') {
      // 1. 原图
      try {
        await storage().deleteImage(deleteKey)
        deletedObjects++
        details.push({ assetId: asset.assetId, key: deleteKey })
      } catch (error) {
        errors++
        details.push({
          assetId: asset.assetId,
          key: deleteKey,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // 2. 缩略图（`{assetId}.{ext}` → `{assetId}_thumb.webp`）
      const thumbnailKey = deriveThumbnailKey(deleteKey)
      if (thumbnailKey) {
        try {
          await storage().deleteImage(thumbnailKey)
          deletedObjects++
          details.push({ assetId: asset.assetId, key: thumbnailKey })
        } catch {
          // 缩略图可能不存在（生成失败时降级用原图），忽略
        }
      }
    }

    // 从 store 移除
    store.assets.delete(asset.assetId)
    deletedAssets++

    // 从 repo 移除
    try {
      await taskRepo().deleteAsset(asset.assetId)
    } catch (error) {
      console.error('[task-store] cleanup deleteAsset 失败：', error)
    }

    // 清理关联 task 中的 resultAssetIds / results 引用
    if (asset.taskId) {
      const task = store.tasks.get(asset.taskId)
      if (task) {
        const updatedResultAssetIds = task.resultAssetIds.filter(
          (id) => id !== asset.assetId,
        )
        const updatedResults = task.results.filter(
          (r) => r.assetId !== asset.assetId,
        )
        if (updatedResults.length === 0 && updatedResultAssetIds.length === 0) {
          store.tasks.delete(asset.taskId)
          try {
            await taskRepo().deleteTask(asset.taskId)
          } catch (error) {
            console.error('[task-store] cleanup deleteTask 失败：', error)
          }
        } else {
          store.tasks.set(asset.taskId, {
            ...task,
            results: updatedResults,
            resultAssetIds: updatedResultAssetIds,
          })
        }
      }
    }
  }

  if (deletedAssets > 0) {
    await persistStore()
  }

  console.log(
    `[task-store] cleanupAssetsByDateRange: 删除 ${deletedAssets} 条资产记录，` +
    `${deletedObjects} 个存储对象，${errors} 个错误`,
  )

  return { deletedAssets, deletedObjects, errors, details }
}

/**
 * 删除单张已生成的 result（用户从图片卡片或详情弹窗触发删除）。
 *
 * - 从对应 task 的 results / resultAssetIds 移除该 assetId
 * - 从 store.assets 移除对应 AssetRecord
 * - 异步尝试删除存储层物理文件（失败仅记录，不阻塞）
 * - 如果 task 删完后没有任何剩余 result，则同步删除整个 task（避免历史记录里堆积空 task）
 *
 * 返回 true 表示找到了对应 result 并完成删除，false 表示 task / assetId 不匹配。
 */
export async function deleteResultFromTask(
  taskId: string,
  assetId: string,
  userId?: string,
): Promise<boolean> {
  await ensureStoreReady()

  const task = store.tasks.get(taskId)
  if (!task) return false

  // PR4：ownership 校验。userId 传了且不匹配，按「未找到」语义返回 false（不暴露存在性）。
  const ownerUserId = task.userId ?? defaultUserId
  if (
    userId &&
    userId.trim() &&
    !shouldBypassOwnership(userId) &&
    ownerUserId !== userId.trim()
  ) {
    return false
  }

  const resultIndex = task.results.findIndex((item) => item.assetId === assetId)
  const inIdsList = task.resultAssetIds.includes(assetId)
  if (resultIndex === -1 && !inIdsList) return false

  const targetResult = resultIndex >= 0 ? task.results[resultIndex] : undefined

  const updatedResults =
    resultIndex >= 0
      ? [
          ...task.results.slice(0, resultIndex),
          ...task.results.slice(resultIndex + 1),
        ]
      : task.results
  const updatedResultAssetIds = task.resultAssetIds.filter(
    (id) => id !== assetId,
  )

  if (updatedResults.length === 0 && updatedResultAssetIds.length === 0) {
    // task 删空了 → 整 task 一起删，避免历史记录留空壳
    store.tasks.delete(taskId)
    try {
      await taskRepo().deleteTask(taskId)
    } catch (error) {
      console.error('[task-store] deleteTask 失败：', error)
    }
  } else {
    store.tasks.set(taskId, {
      ...task,
      results: updatedResults,
      resultAssetIds: updatedResultAssetIds,
    })
  }

  store.assets.delete(assetId)
  try {
    await taskRepo().deleteAsset(assetId)
  } catch (error) {
    console.error('[task-store] deleteAsset 失败：', error)
  }
  await persistStore()

  // 物理文件删除是 best-effort：磁盘/OSS 上图缺失也不影响列表正确性。
  // PR3：用 storage-adapter 屏蔽 local（unlink）/ cloud（OSS DELETE）差异。
  if (targetResult?.url) {
    try {
      // OSS 模式：需要从 publicUrl 提取 key，而不是直接传递完整 URL
      const ossKey = extractOssKeyFromUrl(targetResult.url)
      const deleteKey = ossKey || targetResult.url
      await storage().deleteImage(deleteKey)

      // 同步删除缩略图，避免 OSS 残留 _thumb.webp 孤儿对象
      const thumbnailKey = deriveThumbnailKey(deleteKey)
      if (thumbnailKey) {
        try {
          await storage().deleteImage(thumbnailKey)
        } catch {
          // 缩略图不存在/已删除：忽略
        }
      }
    } catch {
      // 文件不存在/权限问题/并发删除：忽略
    }
  }

  return true
}

// -----------------------------------------------------------------------------
// G-fix: 优雅停机。pm2 restart/stop 会发 SIGTERM，默认 1600ms 后强杀。
// 我们注册钩子等 persistChain 写盘完成再退出，避免 store.json 写一半被截断。
// 配合 ecosystem.config.cjs 的 kill_timeout: 10000，给最多 10s 写盘窗口。
// -----------------------------------------------------------------------------

let shuttingDown = false

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return // 防止重复触发
  shuttingDown = true
  console.log(`[task-store] 收到 ${signal}，等待 store 写盘完成...`)
  try {
    // persistChain 是串行化的：等当前正在写的 + 排队的都写完
    // 加一个兜底超时（8s），避免卡死导致 pm2 强杀
    await Promise.race([
      persistChain,
      new Promise<void>((resolve) => setTimeout(resolve, 8000)),
    ])
    console.log('[task-store] store 写盘完成，安全退出')
  } catch (error) {
    console.error('[task-store] 优雅停机写盘失败：', error)
  }
  // 不主动 process.exit，让 pm2/Node 自然退出
}

if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'))
}
