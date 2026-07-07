import {
  DEFAULT_FASHION_MODEL,
  POSE_IMAGE_RATIOS,
  POSE_RESOLUTIONS,
  SELECTABLE_FASHION_MODELS,
  type FashionModelId,
  type PoseFissionParams,
  type PoseImageRatio,
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
import { runImageEditViaProvider } from './provider-image-router'
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
    imageRatio,
    resolution,
    resultCount: poses.length,
    creditsCost: POSE_FISSION_CREDITS_COST,
  }
}

/**
 * 构建针对「单个姿势」的生图 prompt。
 * pose-fission pipeline 会按 poses 逐个调用，每次传一个姿势参考图。
 */
export function buildPoseFissionPrompt(
  params: PoseFissionParams,
  pose: { id: string; url: string; name: string },
): string {
  const detailOrder: string[] = []
  if (params.hasFrontDetail) {
    detailOrder.push('第二张是服装正面细节图')
  }
  if (params.hasBackDetail) {
    detailOrder.push(
      params.hasFrontDetail
        ? '第三张是服装背面细节图'
        : '第二张是服装背面细节图',
    )
  }

  const totalImageCount =
    2 + (params.hasFrontDetail ? 1 : 0) + (params.hasBackDetail ? 1 : 0)

  return [
    `这里有${totalImageCount}张图片。第一张永远是主图${detailOrder.length ? `，${detailOrder.join('，')}` : ''}，最后一张永远是姿势参考图。`,
    '',
    '任务：只改变第一张图中人物的姿势和动作，让她摆出与最后一张姿势参考图完全一致的身体姿态、四肢角度、身体朝向、手部动作和头部朝向。',
    '',
    '严格保持第一张图不变：人物的面部长相、五官、发型发色、身材比例和肤色；身上服装的款式、颜色、版型、面料材质、图案印花和所有细节；整体光线风格与背景保持一致或干净简洁。',
    '',
    params.hasFrontDetail || params.hasBackDetail
      ? '中间出现的服装细节图只用于锁定服装的图案、主色、面料材质和细节，绝对不要从这些细节图学习姿势、动作、人物身份、脸或背景，也不要改变第一张图人物的穿着。'
      : '最后一张图只用来参考"姿势"这一件事。绝对不要复制姿势参考图里的人物长相、脸、发型、服装、配饰、背景或道具，也不要改变第一张图人物的穿着。',
    '',
    '姿势只从最后一张姿势参考图学习，绝对不要从任何服装细节图学习姿势或动作。',
    '',
    '输出：电商主图级画质，人物主体清晰、姿态自然协调；避免手指畸形、多指/少指、肢体扭曲错位、服装变形、脸部崩坏、文字乱码和多余的人或物。',
    '',
    `当前姿势：${pose.name}。`,
  ].join('\n')
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

function readPoses(value: unknown): { id: string; url: string; name: string }[] {
  if (!Array.isArray(value)) {
    throw new Error('请至少选择一个姿势')
  }

  const trimmed: { id: string; url: string; name: string }[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error('姿势数据格式错误')
    }
    const id = readTrimmedString(item.id)
    const url = readTrimmedString(item.url)
    const name = readTrimmedString(item.name)
    if (!id || !url || !name) {
      throw new Error('姿势数据无效')
    }
    if (seen.has(id)) continue
    seen.add(id)
    trimmed.push({ id, url, name })
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

function readPoseDetailFlag(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }
  if (typeof value === 'boolean') {
    return value
  }
  throw new Error('姿势裂变细节图标记无效')
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
  taskId: string
  /** 顺序：[主图]。姿势图会在内部按 pose.url 逐个解析。 */
  inputImages: string[]
  params: PoseFissionParams
  apiKey: string
  timeoutMs: number
  /** 单 pose 成功后立刻回调；用于流式持久化已成功的图。 */
  onShotResult?: (result: ResultAsset) => Promise<void>
  /** 失败 pose 重跑入口。只跑这些 pose.id；不传或空数组时跑全部 pose。 */
  targetPoseIds?: string[]
}

interface PoseRunResult {
  pose: { id: string; url: string; name: string }
  result?: ResultAsset
  error?: string
  errorCategory?: string
  providerId?: string
}

/**
 * 逐姿势调度 provider adapter。每个 pose 单独调用一次 runImageEditViaProvider，
 * inputImages（主图 + 姿势图）按顺序传给底层。
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
        taskId,
        provider,
        poses: groupPoses,
        params,
        inputImages: options.inputImages,
        apiKey: provider.apiKey || options.apiKey,
        aspectRatio,
        imageSize,
        onShotResult: options.onShotResult,
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
        ): entry is { result: PoseRunResult; pose: { id: string; url: string; name: string } } =>
          Boolean(entry.result?.error && !entry.result.result),
      )

    if (failedPoses.length > 0) {
      const failoverGroups = new Map<
        string,
        { provider: ImageProvider; poses: { id: string; url: string; name: string }[] }
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
              taskId,
              provider,
              poses,
              params,
              inputImages: options.inputImages,
              apiKey: provider.apiKey,
              aspectRatio,
              imageSize,
              onShotResult: options.onShotResult,
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
  taskId: string
  provider: ImageProvider
  poses: { id: string; url: string; name: string }[]
  params: PoseFissionParams
  inputImages: string[]
  apiKey: string
  aspectRatio: string | undefined
  imageSize: string
  onShotResult?: (result: ResultAsset) => Promise<void>
  poseIndexMap: Map<string, number>
  allPoseResults: PoseRunResult[]
}

async function runPoseGroup(options: RunPoseGroupOptions): Promise<void> {
  const {
    taskId,
    provider,
    poses: groupPoses,
    params,
    inputImages,
    apiKey,
    aspectRatio,
    imageSize,
    onShotResult,
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

      const pose = groupPoses[currentIndex]
      const globalIndex = poseIndexMap.get(pose.id)
      if (globalIndex === undefined) continue

      const prompt = buildPoseFissionPrompt(params, pose)

      try {
        const poseReferenceImage = await resolvePoseReferenceToDataUrl(pose.url)
        const single = await runImageEditViaProvider({
          taskId,
          provider,
          fallbackApiKey: apiKey,
          model: params.model,
          prompt,
          inputImages: [...inputImages, poseReferenceImage],
          count: 1,
          aspectRatio,
          imageSize,
          traceId: `${taskId}_${pose.id}`,
          shotId: pose.id,
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
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(poseUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'YibaiFission/1.0',
        },
      })
      if (!response.ok) {
        throw new Error(`姿势参考图下载失败：HTTP ${response.status}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      const mimeType = normalizeImageMime(response.headers.get('content-type')) ?? 'image/png'
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } finally {
      clearTimeout(timeoutId)
    }
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
