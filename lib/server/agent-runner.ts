import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createAsset, createTask, getTask } from '@/lib/server/task-store'
import {
  DEFAULT_FASHION_MODEL,
  POSE_TEMPLATES_DEFAULT_TRIO,
  type AiFashionPhotoParams,
  type FashionImageRatio,
  type FashionModelId,
  type FashionPromptMode,
  type FashionResolution,
  type FeatureType,
  type GenerationTask,
  type PhotoFissionCategory,
  type PhotoFissionImageRatio,
  type PhotoFissionParams,
  type PhotoFissionResolution,
  type PoseFissionParams,
  type PoseImageRatio,
  type PoseResolution,
  type ResultAsset,
  type TaskParams,
} from '@/lib/types'

const MAX_RAW_BYTES = Math.floor(7.5 * 1024 * 1024)
const DEFAULT_USER_ID = 'usr_local_user01'
const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

type CliFeatureType = Extract<
  FeatureType,
  'ai-fashion-photo' | 'photo-fission' | 'pose-fission'
>

export interface AgentRunCommonInput {
  featureType: CliFeatureType
  imagePaths: string[]
  frontDetailPath?: string
  backDetailPath?: string
  outDir?: string
  userId?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface RunAiFashionPhotoInput extends AgentRunCommonInput {
  featureType: 'ai-fashion-photo'
  prompt: string
  promptMode?: FashionPromptMode
  imageRatio?: FashionImageRatio
  resolution?: FashionResolution
  model?: FashionModelId
}

export interface RunPhotoFissionInput extends AgentRunCommonInput {
  featureType: 'photo-fission'
  category?: PhotoFissionCategory
  imageRatio?: PhotoFissionImageRatio
  resolution?: PhotoFissionResolution
  model?: FashionModelId
}

export interface RunPoseFissionInput extends AgentRunCommonInput {
  featureType: 'pose-fission'
  poseTemplateIds?: string[]
  imageRatio?: PoseImageRatio
  resolution?: PoseResolution
  model?: FashionModelId
}

export type AgentRunInput =
  | RunAiFashionPhotoInput
  | RunPhotoFissionInput
  | RunPoseFissionInput

export interface SavedResult {
  assetId: string
  label?: string
  shotId?: string
  url: string
  filePath: string
  finalPrompt?: string
}

export interface AgentRunOutput {
  taskId: string
  status: GenerationTask['status']
  message: string
  outDir: string
  results: SavedResult[]
}

export function getDefaultPoseTemplateIds(): string[] {
  return [...POSE_TEMPLATES_DEFAULT_TRIO]
}

export async function runAgentGeneration(
  input: AgentRunInput,
): Promise<AgentRunOutput> {
  const userId = input.userId?.trim() || DEFAULT_USER_ID
  const inputAssetIds = await createInputAssets(input, userId)
  const params = buildTaskParams(input, inputAssetIds.length)

  const task = await createTask({
    featureType: input.featureType,
    inputAssetIds,
    params,
    userId,
  })

  const finishedTask = await waitForTask(task.taskId, {
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pollIntervalMs: input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    userId,
  })

  if (finishedTask.status === 'failed') {
    throw new Error(finishedTask.errorMessage || finishedTask.message || '生成失败')
  }

  const outputDir =
    input.outDir?.trim() ||
    path.join(process.cwd(), 'outputs', 'fashion-ai', finishedTask.taskId)
  const results = await saveTaskResults(finishedTask.results, outputDir)

  return {
    taskId: finishedTask.taskId,
    status: finishedTask.status,
    message: finishedTask.message,
    outDir: outputDir,
    results,
  }
}

function buildTaskParams(
  input: AgentRunInput,
  inputAssetCount: number,
): TaskParams {
  if (input.featureType === 'ai-fashion-photo') {
    const prompt = input.prompt.trim()
    const params: AiFashionPhotoParams = {
      prompt,
      userPrompt: prompt,
      finalPrompt: prompt,
      promptMode: input.promptMode ?? 'enhanced',
      model: input.model ?? DEFAULT_FASHION_MODEL,
      referenceImageCount: inputAssetCount,
      imageRatio: input.imageRatio ?? '3:4',
      resolution: input.resolution ?? '2k',
      resultCount: 1,
      creditsCost: 35,
    }
    return params
  }

  if (input.featureType === 'photo-fission') {
    const params: PhotoFissionParams = {
      model: input.model ?? DEFAULT_FASHION_MODEL,
      category: input.category ?? 'tops',
      hasFrontDetail: Boolean(input.frontDetailPath),
      hasBackDetail: Boolean(input.backDetailPath),
      imageRatio: input.imageRatio ?? '3:4',
      resolution: input.resolution ?? '2k',
      shotPlan: [],
      resultCount: 9,
    }
    return params
  }

  const poseTemplateIds =
    input.poseTemplateIds && input.poseTemplateIds.length
      ? input.poseTemplateIds
      : getDefaultPoseTemplateIds()
  const params: PoseFissionParams = {
    model: input.model ?? DEFAULT_FASHION_MODEL,
    poseTemplateIds,
    poseTemplateSnapshots: [],
    hasFrontDetail: Boolean(input.frontDetailPath),
    hasBackDetail: Boolean(input.backDetailPath),
    imageRatio: input.imageRatio ?? '3:4',
    resolution: input.resolution ?? '2k',
    resultCount: poseTemplateIds.length,
    creditsCost: 0,
  }
  return params
}

async function createInputAssets(input: AgentRunInput, userId: string) {
  const imagePaths = resolveInputImagePaths(input)
  const assets = await Promise.all(
    imagePaths.map(async (imagePath) => {
      const assetInput = await readImageAssetInput(imagePath)
      const asset = await createAsset({ ...assetInput, userId })
      return asset.assetId
    }),
  )
  return assets
}

function resolveInputImagePaths(input: AgentRunInput): string[] {
  const mainImages = input.imagePaths.filter(Boolean)
  if (!mainImages.length) {
    throw new Error('请至少传入一张 --image 图片')
  }

  if (input.featureType !== 'ai-fashion-photo' && mainImages.length !== 1) {
    throw new Error(`${input.featureType} 只接受一张主图，可用 --front-detail / --back-detail 传细节图`)
  }

  return [
    ...mainImages,
    ...(input.frontDetailPath ? [input.frontDetailPath] : []),
    ...(input.backDetailPath ? [input.backDetailPath] : []),
  ]
}

async function readImageAssetInput(imagePath: string) {
  const absolutePath = path.resolve(imagePath)
  const fileStat = await stat(absolutePath)
  if (!fileStat.isFile()) {
    throw new Error(`不是文件：${absolutePath}`)
  }
  if (fileStat.size <= 0) {
    throw new Error(`图片文件为空：${absolutePath}`)
  }
  if (fileStat.size > MAX_RAW_BYTES) {
    throw new Error(
      `参考图过大，请压缩到 ${(MAX_RAW_BYTES / 1024 / 1024).toFixed(1)}MB 以内：${absolutePath}`,
    )
  }

  const fileType = inferImageMime(absolutePath)
  const buffer = await readFile(absolutePath)
  const dataUrl = `data:${fileType};base64,${buffer.toString('base64')}`

  return {
    fileName: path.basename(absolutePath),
    fileType,
    fileUrl: dataUrl,
    dataUrl,
  }
}

function inferImageMime(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  throw new Error(`仅支持 PNG / JPG / WEBP / GIF 图片格式：${filePath}`)
}

async function waitForTask(
  taskId: string,
  options: { timeoutMs: number; pollIntervalMs: number; userId: string },
) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= options.timeoutMs) {
    const task = await getTask(taskId, { userId: options.userId })
    if (!task) throw new Error(`任务不存在：${taskId}`)
    if (task.status === 'success' || task.status === 'partial' || task.status === 'failed') {
      return task
    }
    await wait(options.pollIntervalMs)
  }
  throw new Error(`等待任务超时：${taskId}`)
}

async function saveTaskResults(
  results: ResultAsset[],
  outputDir: string,
): Promise<SavedResult[]> {
  await mkdir(outputDir, { recursive: true })
  const saved: SavedResult[] = []

  for (const [index, result] of results.entries()) {
    const extension = inferResultExtension(result.url)
    const filename = `${String(index + 1).padStart(2, '0')}-${sanitizeFileName(result.label || result.shotId || result.assetId)}.${extension}`
    const filePath = path.join(outputDir, filename)
    await writeResultUrl(result.url, filePath)
    saved.push({
      assetId: result.assetId,
      label: result.label,
      shotId: result.shotId,
      url: result.url,
      filePath,
      finalPrompt: result.finalPrompt,
    })
  }

  return saved
}

function inferResultExtension(url: string) {
  const clean = url.split('?')[0] || ''
  const ext = path.extname(clean).replace('.', '').toLowerCase()
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'jpg'
}

async function writeResultUrl(url: string, filePath: string) {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:[^;]+;base64,(.+)$/)
    if (!match) throw new Error('结果 data URL 格式错误')
    await writeFile(filePath, Buffer.from(match[1], 'base64'))
    return
  }

  if (url.startsWith('/')) {
    const sourcePath = path.join(process.cwd(), 'public', url)
    await copyFile(sourcePath, filePath)
    return
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`下载结果失败：HTTP ${response.status} ${url}`)
    }
    await writeFile(filePath, Buffer.from(await response.arrayBuffer()))
    return
  }

  throw new Error(`不支持的结果 URL：${url}`)
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'result'
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
