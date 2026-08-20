import {
  DEFAULT_FASHION_MODEL,
  POSE_IMAGE_RATIOS,
  POSE_RESOLUTIONS,
  SELECTABLE_FASHION_MODELS,
  type FashionModelId,
  type PoseFissionParams,
  type PoseBodyPart,
  type PoseImageRatio,
  type PoseMainArmVisibility,
  type PoseResolution,
  type ResultAsset,
} from '@/lib/types'
import {
  dispatchItemsForModel,
  getAvailableProvidersForModel,
  getFailoverProviderForModel,
  getNoAvailableProviderMessage,
  isGoogleImageModel,
  type ImageProvider,
} from './image-provider-pool'
import { GoogleImageError } from './google-image-retry'
import { logImageEvent } from './log'
import {
  buildPoseFissionProviderInputs,
  buildPoseFissionPrompt,
} from './pose-fission-prompt'
import { runImageEditViaProvider } from './provider-image-router'
import {
  downloadSafeRemoteImage,
  MAX_INPUT_IMAGE_BYTES,
} from './safe-remote-image'
import { getLocalImageForPublicUrl } from './storage/storage-adapter'

const POSE_FISSION_MIN_TEMPLATES = 1
const POSE_FISSION_MAX_TEMPLATES = 9
const POSE_FISSION_CREDITS_COST = 0 as const

const poseImageRatioIds = new Set<PoseImageRatio>(
  POSE_IMAGE_RATIOS.map((option) => option.id),
)
const poseResolutionIds = new Set<PoseResolution>(
  POSE_RESOLUTIONS.map((option) => option.id),
)
const fashionModelIds = new Set<FashionModelId>(
  SELECTABLE_FASHION_MODELS.map((option) => option.id),
)

type PoseFissionPose = {
  id: string
  url: string
  name: string
  bodyPart: PoseBodyPart
}

export function normalizePoseFissionParams(
  params: unknown,
  inputAssetCount: number,
): PoseFissionParams {
  if (!isRecord(params)) {
    throw new Error('姿势裂变参数格式错误')
  }

  const model = readFashionModel(params.model)
  const poses = readPoses(params.poses)
  const hasFrontDetail = readPoseDetailFlag(params.hasFrontDetail)
  const hasBackDetail = readPoseDetailFlag(params.hasBackDetail)
  const lowerBodyMainArmVisibility = readPoseMainArmVisibility(
    params.lowerBodyMainArmVisibility,
  )
  const imageRatio = readPoseImageRatio(params.imageRatio)
  const resolution = readPoseResolution(params.resolution)

  const expectedInputAssetCount =
    1 + (hasFrontDetail ? 1 : 0) + (hasBackDetail ? 1 : 0)
  if (inputAssetCount !== expectedInputAssetCount) {
    throw new Error('姿势裂变输入素材数量与参数不一致')
  }

  return {
    model,
    poses,
    hasFrontDetail,
    hasBackDetail,
    lowerBodyMainArmVisibility,
    imageRatio,
    resolution,
    resultCount: poses.length,
    creditsCost: POSE_FISSION_CREDITS_COST,
  }
}

function readFashionModel(value: unknown): FashionModelId {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_FASHION_MODEL
  }
  if (typeof value === 'string' && fashionModelIds.has(value as FashionModelId)) {
    return value as FashionModelId
  }
  throw new Error('姿势裂变模型无效')
}

function readPoses(value: unknown): PoseFissionPose[] {
  if (!Array.isArray(value)) {
    throw new Error('请至少选择一个姿势')
  }

  const trimmed: PoseFissionPose[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error('姿势数据格式错误')
    }
    const id = readTrimmedString(item.id)
    const url = readTrimmedString(item.url)
    const name = readTrimmedString(item.name)
    const bodyPart = readPoseBodyPart(item.bodyPart)
    if (!id || !url || !name) {
      throw new Error('姿势数据无效')
    }
    if (seen.has(id)) continue
    seen.add(id)
    trimmed.push({ id, url, name, bodyPart })
  }

  if (trimmed.length < POSE_FISSION_MIN_TEMPLATES) {
    throw new Error('请至少选择一个姿势')
  }
  if (trimmed.length > POSE_FISSION_MAX_TEMPLATES) {
    throw new Error(`一次最多选择 ${POSE_FISSION_MAX_TEMPLATES} 个姿势`)
  }

  return trimmed
}

function readPoseImageRatio(value: unknown): PoseImageRatio {
  if (typeof value === 'string' && poseImageRatioIds.has(value as PoseImageRatio)) {
    return value as PoseImageRatio
  }

  throw new Error('姿势裂变图片比例无效')
}

function readPoseResolution(value: unknown): PoseResolution {
  if (typeof value === 'string' && poseResolutionIds.has(value as PoseResolution)) {
    return value as PoseResolution
  }

  throw new Error('姿势裂变分辨率无效')
}

function readPoseBodyPart(value: unknown): PoseBodyPart {
  if (value === 'upper' || value === 'lower') {
    return value
  }
  return 'full'
}

function readPoseDetailFlag(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }
  if (typeof value === 'boolean') {
    return value
  }
  throw new Error('姿势裂变细节图标记无效')
}

function readPoseMainArmVisibility(value: unknown): PoseMainArmVisibility {
  if (value === undefined || value === null || value === '') {
    return 'hidden'
  }
  if (value === 'hidden' || value === 'visible') {
    return value
  }
  throw new Error('姿势裂变主图手臂裁切状态无效')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export interface RunPoseFissionPipelineOptions {
  userId: string
  taskId: string
  /** 顺序：[主图, 可选正面细节, 可选背面细节]。姿势图会在内部插入主图之后。 */
  inputImages: string[]
  params: PoseFissionParams
  apiKey: string
  timeoutMs: number
  signal?: AbortSignal
  /** 单 pose 成功后立刻回调；用于流式持久化已成功的图。 */
  onShotResult?: (result: ResultAsset) => Promise<void>
  /** 失败 pose 重跑入口。只跑这些 pose.id；不传或空数组时跑全部 pose。 */
  targetPoseIds?: string[]
}

interface PoseRunResult {
  pose: PoseFissionPose
  result?: ResultAsset
  error?: string
  errorCategory?: string
  providerId?: string
}

/**
 * 逐姿势调度 provider adapter。每个 pose 单独调用一次 runImageEditViaProvider，
 * Provider inputImages 固定按主图、姿势图、可选正面细节、可选背面细节传给底层。
 */
export async function runPoseFissionPipeline(
  options: RunPoseFissionPipelineOptions,
): Promise<ResultAsset[]> {
  const { params, taskId } = options
  if (!options.inputImages.length) {
    throw new Error('姿势裂变缺少参考图')
  }

  const targetSet =
    options.targetPoseIds && options.targetPoseIds.length > 0
      ? new Set(options.targetPoseIds)
      : null
  const poses = targetSet
    ? params.poses.filter((pose) => targetSet.has(pose.id))
    : params.poses

  if (!poses.length) {
    throw new Error('姿势裂变 targetPoseIds 与 poses 不匹配')
  }

  const aspectRatio = params.imageRatio === 'more' ? undefined : params.imageRatio
  const imageSize = params.resolution.toUpperCase()

  const availableProviders = getAvailableProvidersForModel(params.model)
  if (!availableProviders.length && !isGoogleImageModel(params.model)) {
    throw new Error(getNoAvailableProviderMessage(params.model))
  }

  const useMultiProvider = availableProviders.length > 1

  if (useMultiProvider) {
    logImageEvent(
      'pool.dispatch',
      { traceId: taskId, taskId },
      {
        stage: 'pose-fission',
        providers: availableProviders.map((p) => p.id),
        poseCount: poses.length,
      },
    )
  }

  const groups = useMultiProvider
    ? dispatchItemsForModel(poses, params.model)
    : new Map([
        [
          availableProviders[0]?.id ?? 'fallback',
          {
            provider: availableProviders[0] ?? {
              id: 'fallback',
              type: 'google' as const,
              apiKey: options.apiKey,
              model: params.model,
              maxIpm: 10,
              maxRpm: 150,
              weight: 1,
              enabled: true,
              timeoutMs: options.timeoutMs,
            },
            items: poses,
          },
        ],
      ])

  const allPoseResults: PoseRunResult[] = new Array(poses.length)
  const poseIndexMap = new Map(poses.map((pose, index) => [pose.id, index]))

  const groupPromises = Array.from(groups.values()).map(
    ({ provider, items: groupPoses }) => {
      return runPoseGroup({
        userId: options.userId,
        taskId,
        provider,
        poses: groupPoses,
        params,
        inputImages: options.inputImages,
        apiKey: provider.apiKey || options.apiKey,
        aspectRatio,
        imageSize,
        onShotResult: options.onShotResult,
        signal: options.signal,
        poseIndexMap,
        allPoseResults,
      })
    },
  )

  await Promise.all(groupPromises)

  if (useMultiProvider) {
    const failedPoses = allPoseResults
      .map((result, index) => ({ result, pose: poses[index] }))
      .filter(
        (
          entry,
        ): entry is { result: PoseRunResult; pose: PoseFissionPose } =>
          Boolean(entry.result?.error && !entry.result.result),
      )

    if (failedPoses.length > 0) {
      const failoverGroups = new Map<
        string,
        { provider: ImageProvider; poses: PoseFissionPose[] }
      >()

      for (const { result, pose } of failedPoses) {
        const excludeProviderIds = result.providerId ? [result.providerId] : []
        const failoverProvider = getFailoverProviderForModel(
          excludeProviderIds,
          params.model,
        )
        if (!failoverProvider) continue

        const group = failoverGroups.get(failoverProvider.id) ?? {
          provider: failoverProvider,
          poses: [],
        }
        group.poses.push(pose)
        failoverGroups.set(failoverProvider.id, group)
      }

      if (failoverGroups.size > 0) {
        logImageEvent(
          'pool.failover',
          { traceId: taskId, taskId },
          {
            failedCount: failedPoses.length,
            rerunCount: Array.from(failoverGroups.values()).reduce(
              (sum, group) => sum + group.poses.length,
              0,
            ),
            failoverProviders: Array.from(failoverGroups.keys()),
          },
        )

        await Promise.all(
          Array.from(failoverGroups.values()).map(({ provider, poses }) =>
            runPoseGroup({
              userId: options.userId,
              taskId,
              provider,
              poses,
              params,
              inputImages: options.inputImages,
              apiKey: provider.apiKey,
              aspectRatio,
              imageSize,
              onShotResult: options.onShotResult,
              signal: options.signal,
              poseIndexMap,
              allPoseResults,
            }),
          ),
        )
      }
    }
  }

  const successResults = allPoseResults
    .filter((entry): entry is PoseRunResult & { result: ResultAsset } => Boolean(entry?.result))
    .map((entry) => entry.result)

  if (!successResults.length) {
    const firstError = allPoseResults.find((entry) => entry?.error)?.error
    throw new Error(
      firstError ? `姿势裂变全部姿势失败：${firstError}` : '姿势裂变全部姿势失败',
    )
  }

  return successResults
}

interface RunPoseGroupOptions {
  userId: string
  taskId: string
  provider: ImageProvider
  poses: PoseFissionPose[]
  params: PoseFissionParams
  inputImages: string[]
  apiKey: string
  aspectRatio: string | undefined
  imageSize: string
  onShotResult?: (result: ResultAsset) => Promise<void>
  signal?: AbortSignal
  poseIndexMap: Map<string, number>
  allPoseResults: PoseRunResult[]
}

async function runPoseGroup(options: RunPoseGroupOptions): Promise<void> {
  const {
    taskId,
    userId,
    provider,
    poses: groupPoses,
    params,
    inputImages,
    apiKey,
    aspectRatio,
    imageSize,
    onShotResult,
    signal,
    poseIndexMap,
    allPoseResults,
  } = options

  const concurrencyRaw = Number(process.env.POSE_FISSION_CONCURRENCY ?? 2)
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw >= 1
      ? Math.min(Math.floor(concurrencyRaw), groupPoses.length)
      : Math.min(2, groupPoses.length)

  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= groupPoses.length) return
      if (signal?.aborted) return

      const pose = groupPoses[currentIndex]
      const globalIndex = poseIndexMap.get(pose.id)
      if (globalIndex === undefined) continue

      const prompt = buildPoseFissionPrompt(params, pose)

      try {
        const poseReferenceImage = await resolvePoseReferenceToDataUrl(pose.url)
        const providerInputs = buildPoseFissionProviderInputs(
          params,
          inputImages,
          poseReferenceImage,
        )
        const single = await runImageEditViaProvider({
          userId,
          taskId,
          provider,
          fallbackApiKey: apiKey,
          model: params.model,
          prompt,
          inputImages: providerInputs.inputImages,
          inputImageLabels: providerInputs.inputImageLabels,
          count: 1,
          aspectRatio,
          imageSize,
          traceId: `${taskId}_${pose.id}`,
          shotId: pose.id,
          signal,
        })

        const first = single[0]
        if (!first) {
          allPoseResults[globalIndex] = {
            pose,
            error: '该姿势未返回图片',
            providerId: provider.id,
          }
          continue
        }

        const enriched: ResultAsset = {
          ...first,
          assetId: `result_${taskId}_${pose.id}`,
          label: pose.name,
          shotId: pose.id,
          finalPrompt: prompt,
        }

        allPoseResults[globalIndex] = {
          pose,
          result: enriched,
          providerId: provider.id,
        }

        if (onShotResult) {
          try {
            await onShotResult(enriched)
          } catch (persistError) {
            const message =
              persistError instanceof Error ? persistError.message : '未知错误'
            logImageEvent(
              'gimg.fail',
              {
                traceId: `${taskId}_${pose.id}`,
                taskId,
                shotId: pose.id,
              },
              { stage: 'persist', reason: message, providerId: provider.id },
            )
            allPoseResults[globalIndex] = {
              pose,
              error: `流式持久化失败：${message}`,
              providerId: provider.id,
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        const errorCategory = error instanceof GoogleImageError ? error.category : undefined
        allPoseResults[globalIndex] = {
          pose,
          error: message,
          errorCategory,
          providerId: provider.id,
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
}

async function resolvePoseReferenceToDataUrl(poseUrl: string): Promise<string> {
  if (poseUrl.startsWith('data:')) return poseUrl

  if (poseUrl.startsWith('http://') || poseUrl.startsWith('https://')) {
    const downloaded = await downloadSafeRemoteImage(poseUrl, {
      maxBytes: MAX_INPUT_IMAGE_BYTES,
    })
    const mimeType = normalizeImageMime(downloaded.contentType) ?? 'image/png'
    return `data:${mimeType};base64,${downloaded.buffer.toString('base64')}`
  }

  if (poseUrl.startsWith('/')) {
    const image = await getLocalImageForPublicUrl(poseUrl)
    if (!image) {
      throw new Error(`姿势参考图无法读取：${poseUrl}`)
    }
    const buffer = Buffer.from(image.body)
    const mimeType = normalizeImageMime(image.contentType) ?? 'image/png'
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  }

  throw new Error(`姿势参考图 URL 不支持：${poseUrl}`)
}

function normalizeImageMime(contentType: string | null | undefined): string | null {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase()
  if (!mime?.startsWith('image/')) return null
  if (mime === 'image/jpg') return 'image/jpeg'
  return mime
}
