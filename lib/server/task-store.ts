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
  runPhotoFissionPipeline,
} from '@/lib/server/photo-fission-service'
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
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

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
const publicGeneratedDir = path.join(workspaceRoot, 'public', 'generated')
const publicAssetDir = path.join(publicGeneratedDir, 'assets')
const publicResultDir = path.join(publicGeneratedDir, 'results')
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

export async function createAsset(input: {
  fileName: string
  fileType: string
  width?: number
  height?: number
  fileUrl?: string
  dataUrl?: string
}) {
  await ensureStoreReady()
  const assetId = createId('asset')
  const persistedFile = input.dataUrl
    ? await persistDataUrl(input.dataUrl, publicAssetDir, assetId, input.fileType)
    : null

  const asset: AssetRecord = {
    assetId,
    userId: defaultUserId,
    projectId: defaultProjectId,
    fileName: input.fileName,
    fileUrl: persistedFile?.url ?? input.fileUrl ?? '/placeholder.jpg',
    fileType: input.fileType,
    dataUrl: persistedFile ? undefined : input.dataUrl,
    width: input.width ?? 1024,
    height: input.height ?? 1365,
    createdAt: new Date().toISOString(),
  }

  store.assets.set(asset.assetId, asset)
  await persistStore()
  return asset
}

export async function getAsset(assetId: string) {
  await ensureStoreReady()
  return store.assets.get(assetId)
}

export async function listTasks() {
  await ensureStoreReady()
  return Array.from(store.tasks.values())
    .map(hydrateTaskInputAssets)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
}

export async function getTask(taskId: string) {
  await ensureStoreReady()
  const task = store.tasks.get(taskId)
  return task ? hydrateTaskInputAssets(task) : undefined
}

export async function createTask(input: {
  featureType: FeatureType
  inputAssetIds: string[]
  params: TaskParams
}) {
  await ensureStoreReady()
  if (!FEATURE_WORKFLOWS[input.featureType]) {
    throw new Error('不支持的功能类型')
  }

  const normalizedParams = normalizeTaskParams(
    input.featureType,
    input.params,
    input.inputAssetIds.length,
  )

  const missingAsset = input.inputAssetIds.find(
    (assetId) => !store.assets.has(assetId),
  )
  if (missingAsset) {
    throw new Error(`素材不存在：${missingAsset}`)
  }

  const taskId = createId('task')
  const task: GenerationTask = {
    taskId,
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
  void persistStore()
  void runTask(taskId)

  return task
}

function normalizeTaskParams(
  featureType: FeatureType,
  params: TaskParams,
  inputAssetCount: number,
): TaskParams {
  if (featureType === 'pose-fission') {
    return normalizePoseFissionParams(params, inputAssetCount)
  }

  if (featureType === 'ai-fashion-photo') {
    return normalizeAiFashionPhotoParams(params, inputAssetCount)
  }

  if (featureType === 'photo-fission') {
    return normalizePhotoFissionParams(params, inputAssetCount)
  }

  return params
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
  await storeReady
  const task = store.tasks.get(taskId)
  if (!task) return

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
          await persistOneResult(taskId, result)
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
      results = await runThirdPartyWorkflow({
        taskId,
        featureType: task.featureType,
        workflowId: task.workflowId,
        inputImages,
        params: task.params,
        onShotResult,
      })
    }

    // photo-fission / pose-fission：results 已在 onShotResult 内全部持久化，禁止再走 saveResults 重复写盘。
    // 其他 feature：批量持久化生成 resultAssetIds。
    const finalResults = useStreamingPersist ? persistedResults : results
    const resultAssetIds = useStreamingPersist
      ? persistedResults.map((item) => item.assetId)
      : await saveResults(results)

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
 * - 复用 persistResultImage 把图片写入 public/generated/results/
 * - 在 store.assets 中登记对应 AssetRecord
 * - 增量更新 task 的 results / resultAssetIds / progress / message
 *
 * 仅供 photo-fission onShotResult 回调使用。runTask 最终会用 persistedResults 替代
 * pipeline 返回值并跳过 saveResults，避免重复写盘。
 */
async function persistOneResult(taskId: string, result: ResultAsset) {
  const persisted = await persistResultImage(result)
  result.url = persisted.url
  result.downloadUrl = persisted.url

  const asset: AssetRecord = {
    assetId: result.assetId,
    userId: defaultUserId,
    projectId: defaultProjectId,
    fileName: `${result.assetId}.jpg`,
    fileUrl: persisted.url,
    fileType: 'image/jpeg',
    width: result.width,
    height: result.height,
    createdAt: new Date().toISOString(),
  }
  store.assets.set(asset.assetId, asset)

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

  store.tasks.set(taskId, {
    ...task,
    ...patch,
  })
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

async function saveResults(results: ResultAsset[]) {
  const resultAssetIds: string[] = []

  for (const result of results) {
    // B-fix: persistResultImage 失败会抛出，runTask 外层 catch 接住后标记任务 failed
    const persistedResult = await persistResultImage(result)
    const resultUrl = persistedResult.url
    const asset: AssetRecord = {
      assetId: result.assetId,
      userId: defaultUserId,
      projectId: defaultProjectId,
      fileName: `${result.assetId}.jpg`,
      fileUrl: resultUrl,
      fileType: 'image/jpeg',
      width: result.width,
      height: result.height,
      createdAt: new Date().toISOString(),
    }

    store.assets.set(asset.assetId, asset)
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

async function persistDataUrl(dataUrl: string, directory: string, fileId: string, mimeType: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null

  const extension = getExtension(match[1] || mimeType)
  await mkdir(directory, { recursive: true })
  const fileName = `${fileId}.${extension}`
  const absolutePath = path.join(directory, fileName)
  await writeFile(absolutePath, Buffer.from(match[2], 'base64'))

  return {
    url: `/generated/${path.basename(directory)}/${fileName}`,
  }
}

/**
 * Convert an asset record into a self-contained data URL the third-party API can consume.
 *
 * The third-party proxy receives the request from the Node server and has no way to fetch
 * relative URLs like `/generated/assets/foo.png`. So whenever an asset only has a relative
 * fileUrl, we read the file from disk and inline it as a data URL.
 */
async function resolveAssetToDataUrl(asset: AssetRecord): Promise<string | null> {
  const { fileUrl, fileType } = asset

  if (!fileUrl) return null
  if (fileUrl.startsWith('data:')) return fileUrl
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl
  }

  if (fileUrl.startsWith('/generated/')) {
    const absolutePath = path.join(workspaceRoot, 'public', fileUrl.replace(/^\//, ''))
    try {
      const buffer = await readFile(absolutePath)
      const mimeType = fileType?.startsWith('image/') ? fileType : `image/${getExtension(fileType ?? 'image/png')}`
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  }

  return null
}

/**
 * B-fix: 持久化失败时显式抛错，由 runTask 外层 catch 接住将任务标记为 failed，
 * 避免客户拿到上游临时 URL 显示 404。
 */
async function persistResultImage(result: ResultAsset) {
  if (result.url.startsWith('data:')) {
    const persisted = await persistDataUrl(
      result.url,
      publicResultDir,
      result.assetId,
      'image/png',
    )
    if (!persisted) {
      throw new Error(`生成图归档失败：无法解析 dataURL（assetId=${result.assetId}）`)
    }
    return persisted
  }

  if (!result.url.startsWith('http')) {
    throw new Error(`生成图归档失败：URL 协议不支持（${result.url}）`)
  }

  const response = await fetch(result.url)
  if (!response.ok) {
    throw new Error(`生成图归档失败：HTTP ${response.status}（${result.url}）`)
  }

  const mimeType = response.headers.get('content-type') ?? 'image/jpeg'
  const extension = getExtension(mimeType)
  await mkdir(publicResultDir, { recursive: true })
  const fileName = `${result.assetId}.${extension}`
  const absolutePath = path.join(publicResultDir, fileName)
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(absolutePath, buffer)

  return {
    url: `/generated/results/${fileName}`,
  }
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
): Promise<GenerationTask> {
  await ensureStoreReady()

  const task = store.tasks.get(taskId)
  if (!task) {
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

    await runPhotoFissionPipeline({
      taskId,
      inputImages,
      params,
      apiKey: process.env.GOOGLE_API_KEY ?? '',
      timeoutMs: Number(process.env.GOOGLE_IMAGE_TIMEOUT_MS ?? 600000),
      targetShotIds: uniqueShotIds,
      onShotResult: async (result) => {
        await persistOneResult(taskId, result)
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
): Promise<GenerationTask> {
  await ensureStoreReady()

  const task = store.tasks.get(taskId)
  if (!task) {
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
        await persistOneResult(taskId, result)
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
 * - 异步尝试删除 public/generated/results/ 下的物理文件（失败仅记录，不阻塞）
 * - 如果 task 删完后没有任何剩余 result，则同步删除整个 task（避免历史记录里堆积空 task）
 *
 * 返回 true 表示找到了对应 result 并完成删除，false 表示 task / assetId 不匹配。
 */
export async function deleteResultFromTask(
  taskId: string,
  assetId: string,
): Promise<boolean> {
  await ensureStoreReady()

  const task = store.tasks.get(taskId)
  if (!task) return false

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
  } else {
    store.tasks.set(taskId, {
      ...task,
      results: updatedResults,
      resultAssetIds: updatedResultAssetIds,
    })
  }

  store.assets.delete(assetId)
  await persistStore()

  // 物理文件删除是 best-effort：磁盘上图缺失也不影响列表正确性
  if (targetResult?.url && targetResult.url.startsWith('/generated/')) {
    const absolutePath = path.join(
      workspaceRoot,
      'public',
      targetResult.url.replace(/^\//, ''),
    )
    try {
      await unlink(absolutePath)
    } catch {
      // 文件不存在/权限问题/并发删除：忽略
    }
  }

  return true
}
