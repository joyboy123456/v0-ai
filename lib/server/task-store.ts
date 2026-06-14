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
import {
  getLocalImageForPublicUrl,
  getStorageAdapter,
  getTaskRepo,
  type AssetRow,
  type TaskRow,
} from '@/lib/server/storage'
import {
  FEATURE_WORKFLOWS,
  type AssetRecord,
  type FeatureType,
  type GenerationTask,
  type PhotoFissionParams,
  type PoseFissionParams,
  type ResultAsset,
  type TaskParams,
} from '@/lib/types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const globalStore = globalThis as typeof globalThis & {
  fashionMvpStore?: {
    assets: Map<string, AssetRecord>
    tasks: Map<string, GenerationTask>
  }
}

const store = globalStore.fashionMvpStore ?? {
  assets: new Map<string, AssetRecord>(),
  tasks: new Map<string, GenerationTask>(),
}

globalStore.fashionMvpStore = store

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
      errorMessage: task.errorMessage,
      creditsUsed: task.creditsUsed,
      userId: task.userId,
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
): Promise<{ url: string; mime: string } | null> {
  const extension = getExtension(mimeTypeHint || 'image/png')
  const filename = `${assetId}.${extension}`
  try {
    const result = await storage().putImageFromDataUrl({
      userId: userId === defaultUserId ? null : userId, // local 兼容旧路径
      bucket: 'assets',
      filename,
      dataUrl,
    })
    return { url: result.publicUrl, mime: result.mime }
  } catch {
    return null
  }
}

/**
 * 通过 storage-adapter 写一张「生成结果图」。
 * 替代原 `persistResultImage`，保持「dataURL 直存 / HTTP URL 拉回再存」两种入口。
 */
async function storeResultFromResultAsset(
  result: ResultAsset,
  userId: string,
): Promise<{ url: string; bytes?: number; mimeType: string; width?: number; height?: number }> {
  if (result.url.startsWith('data:')) {
    const mimeType = extractDataUrlMime(result.url) ?? 'image/png'
    const persisted = await storage().putImageFromDataUrl({
      userId: userId === defaultUserId ? null : userId,
      bucket: 'results',
      filename: `${result.assetId}.${getExtension(mimeType)}`,
      dataUrl: result.url,
    })
    const dimensions = await readImageDimensionsFromBuffer(
      Buffer.from(result.url.split(',')[1] ?? '', 'base64'),
    )
    return { url: persisted.publicUrl, bytes: persisted.bytes, mimeType, ...dimensions }
  }

  if (!result.url.startsWith('http')) {
    throw new Error(`生成图归档失败：URL 协议不支持（${result.url}）`)
  }

  const response = await fetch(result.url)
  if (!response.ok) {
    throw new Error(`生成图归档失败：HTTP ${response.status}（${result.url}）`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const imageMetadata = await readImageMetadataFromBuffer(buffer)
  const mimeType =
    imageMetadata.mimeType ??
    normalizeImageMime(response.headers.get('content-type')) ??
    'image/png'
  const persisted = await storage().putImage({
    userId: userId === defaultUserId ? null : userId,
    bucket: 'results',
    filename: `${result.assetId}.${getExtension(mimeType)}`,
    body: buffer,
    contentType: mimeType,
  })
  return {
    url: persisted.publicUrl,
    bytes: persisted.bytes,
    mimeType,
    width: imageMetadata.width,
    height: imageMetadata.height,
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
  fileName: string
  fileType: string
  width?: number
  height?: number
  fileUrl?: string
  dataUrl?: string
  /** PR4：归属用户 id。未传或为空时回退到 defaultUserId（local 兼容旧调用点）。 */
  userId?: string
  /** PR4：关联的 taskId（仅 generated 类资产）。upload 类一般不传。 */
  taskId?: string | null
}) {
  await ensureStoreReady()
  const assetId = createId('asset')
  const effectiveUserId =
    input.userId && input.userId.trim() ? input.userId : defaultUserId
  // PR3：通过 storage-adapter 写图；local 模式落本地图片目录并返回稳定 URL，
  // cloud 模式落 R2。
  // PR4：把 effectiveUserId 透传给 adapter，cloud 模式下 R2 路径前缀
  // `users/{userId}/assets/...` 实现数据隔离。
  const persistedFile = input.dataUrl
    ? await storeAssetFromDataUrl(input.dataUrl, assetId, input.fileType, effectiveUserId)
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
      buildAssetRow(asset, { kind: 'upload', taskId: input.taskId ?? null }),
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

export async function createTask(input: {
  featureType: FeatureType
  inputAssetIds: string[]
  params: TaskParams
  /** PR4：任务归属用户 id。未传则回退到 defaultUserId（local 兼容旧调用点）。 */
  userId?: string
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

  const missingAsset = input.inputAssetIds.find(
    (assetId) => !store.assets.has(assetId),
  )
  if (missingAsset) {
    throw new Error(`素材不存在：${missingAsset}`)
  }

  validatePhotoFissionFaceMaskAsset(
    input.featureType,
    normalizedParams,
    effectiveUserId,
  )

  const taskId = createId('task')
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
    createdAt: new Date().toISOString(),
    creditsUsed: getCredits(normalizedParams),
  }

  store.tasks.set(taskId, task)
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
  const dataUrl = asset.dataUrl ?? (await resolveAssetToDataUrl(asset))
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

async function runTask(taskId: string) {
  console.log('[task-store] runTask 开始执行:', taskId)
  await storeReady
  const task = store.tasks.get(taskId)
  if (!task) {
    console.log('[task-store] runTask 找不到任务:', taskId)
    return
  }
  console.log('[task-store] runTask 找到任务，状态:', task.status)

  // PR4：task.userId 由 createTask 注入；historical task 没存 userId 时回退到 defaultUserId。
  const ownerUserId = task.userId ?? defaultUserId

  try {
    updateTask(taskId, {
      status: 'running',
      progress: 18,
      message: '正在校验上传素材',
    })

    await wait(500)
    updateTask(taskId, {
      progress: 45,
      message: '正在准备固定工作流参数',
    })

    await wait(500)
    updateTask(taskId, {
      progress: 72,
      message: '正在调用第三方生图 API',
    })

    const inputImages = (
      await Promise.all(
        task.inputAssetIds.map(async (assetId) => {
          const asset = store.assets.get(assetId)
          if (!asset) return null
          if (asset.dataUrl) return asset.dataUrl
          return resolveAssetToDataUrl(asset)
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
          await persistOneResult(taskId, result, ownerUserId)
          persistedResults.push(result)
        }
      : undefined

    let results: ResultAsset[]
    if (isPoseFission) {
      // pose-fission 直接调 runPoseFissionPipeline，跳过 runThirdPartyWorkflow，
      // 避免双重 Google 调用与 demo 路径分叉（demo 模式仍在 runThirdPartyWorkflow 内处理 photo-fission，
      // pose-fission demo 退化为占位 case 输出由后续 PR 处理；此 PR 关注真实生产路径）。
      results = await runPoseFissionPipeline({
        taskId,
        inputImages,
        params: task.params as PoseFissionParams,
        apiKey: process.env.GOOGLE_API_KEY ?? '',
        timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
        onShotResult,
      })
    } else {
      const faceMaskImage = isPhotoFission
        ? await resolvePhotoFissionFaceMaskDataUrl(task.params as PhotoFissionParams)
        : null
      results = await runThirdPartyWorkflow({
        taskId,
        featureType: task.featureType,
        workflowId: task.workflowId,
        inputImages,
        params: task.params,
        faceMaskImage,
        onShotResult,
      })
    }

    // photo-fission / pose-fission：results 已在 onShotResult 内全部持久化，禁止再走 saveResults 重复写盘。
    // 其他 feature：批量持久化生成 resultAssetIds。
    const finalResults = useStreamingPersist ? persistedResults : results
    const resultAssetIds = useStreamingPersist
      ? persistedResults.map((item) => item.assetId)
      : await saveResults(results, taskId, ownerUserId)

    const { status, message } = resolveTaskCompletion(task, finalResults)
    updateTask(taskId, {
      status,
      progress: 100,
      message,
      results: finalResults,
      resultAssetIds,
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    updateTask(taskId, {
      status: 'failed',
      progress: 100,
      message: '生成失败',
      errorMessage: error instanceof Error ? error.message : '未知错误',
      finishedAt: new Date().toISOString(),
    })
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
  // PR3：通过 storage-adapter 写「生成结果图」。local 模式落本地图片目录，
  // cloud 模式落 R2 `users/{userId}/results/`。
  // PR4：把 ownerUserId 透传给 adapter，cloud 模式下 R2 路径按用户隔离。
  const persisted = await storeResultFromResultAsset(result, ownerUserId)
  result.url = persisted.url
  result.downloadUrl = persisted.url
  result.width = persisted.width ?? result.width
  result.height = persisted.height ?? result.height

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
 * 这里根据 shotPlan / poseTemplateIds 计划数量与实际成功结果数量决定 status / message。
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
      params.resultCount ?? params.poseTemplateIds?.length ?? results.length
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
  const resultAssetIds: string[] = []

  for (const result of results) {
    // PR3：通过 storage-adapter 写图。失败抛出由 runTask 外层 catch 接住标 failed。
    // PR4：透传 ownerUserId，cloud 模式 R2 路径按用户隔离。
    const persistedResult = await storeResultFromResultAsset(result, ownerUserId)
    const resultUrl = persistedResult.url
    result.url = resultUrl
    result.downloadUrl = resultUrl
    result.width = persistedResult.width ?? result.width
    result.height = persistedResult.height ?? result.height
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

    reviveStaleRunningTasks()
  } catch {
    return
  }
}

/**
 * C-fix: 进程冷启动时把"卡死"的 pending / running 任务标记为 failed。
 * 判定：任务创建超过 STALE_RUNNING_TIMEOUT_MS 仍未结束，认为是上一次进程崩溃留下的脏数据。
 *
 * 阈值从 15 min 提升到 60 min 的原因：
 * photo-fission 单次任务固定生成 9 张套图，单 shot 最坏耗时约 2 min（Gemini 3 系列 + 多图 + 2K/4K），
 * 并发为 2 时整体最坏耗时约 9 / 2 × 2 ≈ 9 min，叠加冷启动、网络抖动、上游 silent hang 可能逼近 15 min，
 * 触发误判把还在跑的任务标 failed。提到 60 min 留足余量，且 revive 时只改 status 不清空 results 数组，
 * 即使被 revive 标 failed，已通过流式回调持久化的图片依然保留可见。
 */
const STALE_RUNNING_TIMEOUT_MS = 60 * 60 * 1000

function reviveStaleRunningTasks() {
  const now = Date.now()
  let revivedCount = 0

  for (const task of store.tasks.values()) {
    if (task.status !== 'pending' && task.status !== 'running') continue

    const startTime = new Date(task.createdAt).getTime()
    if (Number.isNaN(startTime)) continue
    if (now - startTime < STALE_RUNNING_TIMEOUT_MS) continue

    store.tasks.set(task.taskId, {
      ...task,
      status: 'failed',
      progress: 100,
      message: '生成失败',
      errorMessage: '服务重启时任务未完成（已自动标记为失败，请重新生成）',
      finishedAt: new Date().toISOString(),
    })
    revivedCount += 1
  }

  if (revivedCount > 0) {
    void persistStore()
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

function persistStore(): Promise<void> {
  const next = persistChain
    .catch(() => undefined)
    .then(() => writeStoreFile())
  persistChain = next.catch(() => undefined)
  return next
}

async function writeStoreFile(): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  await writeFile(
    storeFilePath,
    JSON.stringify(
      {
        assets: Array.from(store.assets.values()),
        tasks: Array.from(store.tasks.values()),
      },
      null,
      2,
    ),
    'utf8',
  )
}

/**
 * Convert an asset record into a self-contained data URL the third-party API can consume.
 *
 * The third-party proxy receives the request from the Node server and has no way to fetch
 * relative URLs like `/generated/assets/foo.png` or `/local-assets/assets/foo.png`.
 * So whenever an asset only has a relative fileUrl, we read the file from disk and
 * inline it as a data URL.
 *
 * PR3 注：cloud 模式 `fileUrl` 是 R2 公共 URL（https://pub-xxx.r2.dev/...），
 * 走分支 2（http(s)）直接由 third-party API 远端拉取，本函数无需改动。
 * 仅 local 模式才进入本地 URL 磁盘读取分支。
 */
async function resolveAssetToDataUrl(asset: AssetRecord): Promise<string | null> {
  const { fileUrl, fileType } = asset

  if (!fileUrl) return null
  if (fileUrl.startsWith('data:')) return fileUrl
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl
  }

  if (fileUrl.startsWith('/generated/') || fileUrl.startsWith('/local-assets/')) {
    const image = await getLocalImageForPublicUrl(fileUrl)
    if (!image) return null
    const buffer = Buffer.from(image.body)
    const mimeType = fileType?.startsWith('image/')
      ? fileType
      : (image.contentType ?? `image/${getExtension(fileType ?? 'image/png')}`)
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  }

  return null
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
          return resolveAssetToDataUrl(asset)
        }),
      )
    ).filter((image): image is string => Boolean(image))

    if (!inputImages.length) {
      throw new Error('原任务参考图已丢失，无法重跑')
    }
    const faceMaskImage = await resolvePhotoFissionFaceMaskDataUrl(params)

    await runPhotoFissionPipeline({
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
  const dataUrl = asset.dataUrl ?? (await resolveAssetToDataUrl(asset))
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
        return resolveAssetToDataUrl(asset)
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
 * status ∈ {partial, failed}、templateIds 都在原 poseTemplateIds 中
 * 且当前 results 没有对应 templateId（已成功的不允许重跑）。
 * 然后基于原 inputAssetIds 与原 poseTemplateSnapshots 调
 * runPoseFissionPipeline（targetTemplateIds 过滤），通过 onShotResult 流式持久化合并回原 task。
 *
 * 完成后用合并后的 results 重新 resolveTaskCompletion 更新 status 与 message。
 * 不另起新 task；credits 不再扣（pose-fission D5：MVP 不计费）。
 *
 * 抽象时机说明（PRD §Out of Scope）：
 * 当前 retryPhotoFissionShots 与本函数结构高度相似，
 * 之所以暂不抽象出通用 retryFissionShots(featureType, ...) 是为了：
 * 1. 两个 feature 的「计划单位」字段不同（shotPlan vs poseTemplateSnapshots）
 * 2. pipeline 调用接口不同（targetShotIds vs targetTemplateIds）
 * 3. 错误文案差异（镜头 vs 姿势）
 * 待第三个类似 feature 出现时再抽象，避免过早设计 lowest-common-denominator 契约。
 */
export async function retryPoseFissionShots(
  taskId: string,
  templateIds: string[],
  userId?: string,
): Promise<GenerationTask> {
  await ensureStoreReady()

  const task = store.tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  // PR4：ownership 校验。
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
  if (
    !Array.isArray(params.poseTemplateSnapshots) ||
    !params.poseTemplateSnapshots.length
  ) {
    throw new Error('任务缺少姿势模板快照，无法重跑')
  }

  const plannedTemplateIds = new Set(
    params.poseTemplateSnapshots.map((template) => template.id),
  )
  const alreadySucceededTemplateIds = new Set(
    task.results
      .map((result) => result.shotId)
      .filter((id): id is string => Boolean(id)),
  )

  const uniqueTemplateIds = Array.from(new Set(templateIds))
  if (!uniqueTemplateIds.length) {
    throw new Error('请至少选择一个失败姿势')
  }

  for (const templateId of uniqueTemplateIds) {
    if (!plannedTemplateIds.has(templateId)) {
      throw new Error(`姿势 ${templateId} 不在原任务计划中`)
    }
    if (alreadySucceededTemplateIds.has(templateId)) {
      throw new Error(`姿势 ${templateId} 已成功，无需重跑`)
    }
  }

  // 标记为 running，避免前端轮询误判
  updateTask(taskId, {
    status: 'running',
    progress: 72,
    message: `正在重跑 ${uniqueTemplateIds.length} 个失败姿势`,
  })

  try {
    const inputImages = (
      await Promise.all(
        task.inputAssetIds.map(async (assetId) => {
          const asset = store.assets.get(assetId)
          if (!asset) return null
          if (asset.dataUrl) return asset.dataUrl
          return resolveAssetToDataUrl(asset)
        }),
      )
    ).filter((image): image is string => Boolean(image))

    if (!inputImages.length) {
      throw new Error('原任务参考图已丢失，无法重跑')
    }

    await runPoseFissionPipeline({
      taskId,
      inputImages,
      params,
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
      targetTemplateIds: uniqueTemplateIds,
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
 * 删除单张已生成的 result（用户在「案例库」/瀑布流 hover 操作里点了垃圾桶）。
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

  // 物理文件删除是 best-effort：磁盘/R2 上图缺失也不影响列表正确性。
  // PR3：用 storage-adapter 屏蔽 local（unlink）/ cloud（R2 DELETE）差异。
  if (targetResult?.url) {
    try {
      await storage().deleteImage(targetResult.url)
    } catch {
      // 文件不存在/权限问题/并发删除：忽略
    }
  }

  return true
}
