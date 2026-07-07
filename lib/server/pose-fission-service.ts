import {
  DEFAULT_FASHION_MODEL,
  POSE_IMAGE_RATIOS,
  POSE_RESOLUTIONS,
  SELECTABLE_FASHION_MODELS,
  type FashionModelId,
  type PoseFissionParams,
  type PoseBodyPart,
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
  pose: PoseFissionPose,
): string {
  const totalImageCount =
    2 + (params.hasFrontDetail ? 1 : 0) + (params.hasBackDetail ? 1 : 0)

  return [
    getPoseFissionEditInstruction(pose.bodyPart),
    '',
    `本次共 ${totalImageCount} 张图，按输入顺序：`,
    '- 第 1 张 = 主图（一致性来源）：保持人物脸型五官、发型发色、身材比例、肤色，以及服装款式/颜色/版型/面料材质/图案印花完全一致；光线与背景保持原样或干净简洁。',
    ...(params.hasFrontDetail
      ? [
          '- 第 2 张 = 服装正面细节图（服装高保真参考）：据此精确还原服装正面的图案、主色与材质，只提供服装信息，不提供姿势/动作/人物/背景。',
        ]
      : []),
    ...(params.hasBackDetail
      ? [
          params.hasFrontDetail
            ? '- 第 3 张 = 服装背面细节图（服装高保真参考）：据此精确还原服装背面设计与细节，同样只提供服装信息。'
            : '- 第 2 张 = 服装背面细节图（服装高保真参考）：据此精确还原服装背面设计与细节，同样只提供服装信息。',
        ]
      : []),
    `- 第 ${totalImageCount} 张（最后一张）= 姿势参考图（仅姿势来源）：${getPoseFissionPoseReferenceNote(pose.bodyPart)}`,
    '',
    '输出：电商主图级画质，主体清晰、姿态自然协调、身体比例真实，双手结构自然、手指数量正确、服装贴合形变合理；画面干净整洁，只保留主图中的这一位人物。',
    '',
    `当前姿势：${pose.name}。`,
  ].join('\n')
}

function getPoseFissionEditInstruction(bodyPart: PoseBodyPart): string {
  switch (bodyPart) {
    case 'full':
      return '编辑第一张主图：只将主图中人物的姿势与动作，替换为最后一张姿势参考图中的整体身体姿态、四肢角度、身体朝向、手部动作与头部朝向；人物长相与服装保持主图不变。'
    case 'upper':
      return '编辑第一张主图：只改变人物的上半身——上身姿态、肩、双臂、手部动作与头部朝向，按最后一张姿势参考图摆放；下半身（腿部姿势、站/坐位置、脚的位置与朝向）与人物长相、服装严格保持主图不变。'
    case 'lower':
      return '编辑第一张主图：只改变人物的下半身——腿部姿势、站姿/步态、髋部与脚的朝向和位置，按最后一张姿势参考图摆放；上半身（头、脸、肩、双臂、手部动作、上身朝向）与人物长相、服装严格保持主图不变。'
    default:
      throw new Error('姿势裂变姿势分类无效')
  }
}

function getPoseFissionPoseReferenceNote(
  bodyPart: PoseBodyPart,
): string {
  switch (bodyPart) {
    case 'full':
      return '只借用其姿态、动作与肢体朝向；人物长相、服装、配饰、背景、道具一律以主图为准。'
    case 'upper':
      return '只借上半身姿态，即使它是全身图也不改动下半身；人物长相、服装、配饰、背景、道具一律以主图为准。'
    case 'lower':
      return '只借下半身姿态，即使它是全身图也不改动上半身；人物长相、服装、配饰、背景、道具一律以主图为准。'
    default:
      throw new Error('姿势裂变姿势分类无效')
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
  pose: PoseFissionPose
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
  poses: PoseFissionPose[]
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
