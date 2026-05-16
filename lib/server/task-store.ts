import { runThirdPartyWorkflow } from '@/lib/server/third-party-image-adapter'
import {
  getOfficialFashionModelUrl,
  isOfficialFashionModelId,
  normalizeAiFashionPhotoParams,
} from '@/lib/server/ai-fashion-photo-service'
import { normalizePoseFissionParams } from '@/lib/server/pose-fission-service'
import {
  FEATURE_WORKFLOWS,
  type AssetRecord,
  type FeatureType,
  type GenerationTask,
  type ResultAsset,
  type TaskParams,
} from '@/lib/types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  return 'generateCount' in params ? params.generateCount : 4
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
  return Array.from(store.tasks.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export async function getTask(taskId: string) {
  await ensureStoreReady()
  return store.tasks.get(taskId)
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
    (assetId) => !store.assets.has(assetId) && !isOfficialFashionModelId(assetId),
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

  return params
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

    const inputImages = task.inputAssetIds
      .map((assetId) => {
        const asset = store.assets.get(assetId)
        return asset?.dataUrl ?? asset?.fileUrl ?? getOfficialFashionModelUrl(assetId)
      })
      .filter((image): image is string => Boolean(image))

    const results = await runThirdPartyWorkflow({
      taskId,
      featureType: task.featureType,
      workflowId: task.workflowId,
      inputImages,
      params: task.params,
    })

    const resultAssetIds = await saveResults(results)
    updateTask(taskId, {
      status: 'success',
      progress: 100,
      message: '生成完成',
      results,
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

function updateTask(taskId: string, patch: Partial<GenerationTask>) {
  const task = store.tasks.get(taskId)
  if (!task) return

  store.tasks.set(taskId, {
    ...task,
    ...patch,
  })
  void persistStore()
}

async function saveResults(results: ResultAsset[]) {
  const resultAssetIds: string[] = []

  for (const result of results) {
    const persistedResult = await persistResultImage(result)
    const resultUrl = persistedResult?.url ?? result.url
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
    result.downloadUrl = persistedResult?.url ?? result.downloadUrl
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
  } catch {
    return
  }
}

async function ensureStoreReady() {
  if (!storeLoaded) {
    await storeReady
  }
}

async function persistStore() {
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

async function persistResultImage(result: ResultAsset) {
  if (result.url.startsWith('data:')) {
    return persistDataUrl(result.url, publicResultDir, result.assetId, 'image/png')
  }

  if (!result.url.startsWith('http')) return null

  try {
    const response = await fetch(result.url)
    if (!response.ok) return null

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
  } catch {
    return null
  }
}

function getExtension(mimeType: string) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}
