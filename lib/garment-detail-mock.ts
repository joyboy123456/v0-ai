/**
 * 高清放大细节图（garment-detail）前端 mock。
 *
 * 「前端界面先行」阶段：不接真实后端，本模块提供
 * 1) 模型版本列表的 mock 下发（PRD FR-6：前端不硬编码模型，走接口形态）；
 * 2) 任务生命周期的纯函数模拟（排队 → 识别分类 → 逐张生成 → 成功/失败），
 *    由 workbench 的定时器驱动 `advanceGarmentDetailMockTask` 推进。
 *
 * 后端接入时：fetchGarmentDetailModels 换成 PRD §6.3 接口，
 * 任务创建/轮询换成 §6.1/§6.2，本模块可整体删除。
 */
import type {
  AssetRecord,
  GarmentDetailCategory,
  GarmentDetailParams,
  GarmentDetailResolution,
  GarmentDetailShot,
  GarmentDetailTier,
  GenerationTask,
  ResultAsset,
  ShotProgress,
  UploadedImage,
} from './types'

export const GARMENT_DETAIL_MOCK_TASK_PREFIX = 'mock-gd-'
/** 与 types.ts FEATURE_WORKFLOWS['garment-detail'] 保持一致（本地 mock 工作流标识） */
const GARMENT_DETAIL_MOCK_WORKFLOW_ID = 'garment_detail_mock_v1'
/**
 * 与 types.ts GARMENT_DETAIL_CATEGORIES 的 label 保持一致。
 * 单独维护是因为 node --test 原生跑 TS 时无法解析无扩展名的运行时 import。
 */
const GARMENT_DETAIL_CATEGORY_LABELS: Record<GarmentDetailCategory, string> = {
  tops: '上装',
  bottoms: '下装',
  dress: '连衣裙',
  accessory: '配饰',
  'shoes-bags': '鞋包',
}

export function isGarmentDetailMockTaskId(taskId: string): boolean {
  return taskId.startsWith(GARMENT_DETAIL_MOCK_TASK_PREFIX)
}

// ---------------------------------------------------------------------------
// 模型版本列表（PRD FR-5 / FR-6，mock §6.3 algorithm.model.version.list）
// ---------------------------------------------------------------------------

export interface GarmentDetailModelOption {
  algorithmModelId: string
  algorithmModelName: string
  tier: GarmentDetailTier
  resolutions: GarmentDetailResolution[]
  recommended: boolean
  defaultSelected: boolean
  description: string
  costLabel: string
  /** 展示用预计耗时（秒），对应 PRD §8 标准版 ≤60s / 专业版 ≤90s */
  estimatedSeconds: number
}

const GARMENT_DETAIL_MODELS: GarmentDetailModelOption[] = [
  {
    algorithmModelId: 'std-v1',
    algorithmModelName: '标准版',
    tier: 'standard',
    resolutions: ['1k'],
    recommended: false,
    defaultSelected: true,
    description: '细节稳定，适合常规放大出图',
    costLabel: '成本低',
    estimatedSeconds: 45,
  },
  {
    algorithmModelId: 'pro-v1',
    algorithmModelName: '专业版',
    tier: 'professional',
    resolutions: ['2k', '4k'],
    recommended: true,
    defaultSelected: false,
    description: '文本控制灵活，适合指定细节/风格',
    costLabel: '成本高',
    estimatedSeconds: 75,
  },
]

/** 模拟服务端动态下发模型版本列表（约 300ms 延迟），后端就绪后替换为真实请求。 */
export async function fetchGarmentDetailModels(): Promise<GarmentDetailModelOption[]> {
  await new Promise((resolve) => setTimeout(resolve, 300))
  return GARMENT_DETAIL_MODELS.map((model) => ({
    ...model,
    resolutions: [...model.resolutions],
  }))
}

// ---------------------------------------------------------------------------
// 细节部位标签（按分类）与输出位规划
// ---------------------------------------------------------------------------

const DETAIL_PART_LABELS: Record<GarmentDetailCategory, string[]> = {
  tops: ['领口细节', '袖口细节', '面料纹理'],
  bottoms: ['腰头细节', '走线细节', '面料纹理'],
  dress: ['领口细节', '裙摆细节', '面料纹理'],
  accessory: ['材质特写', '工艺细节', '质感纹理'],
  'shoes-bags': ['五金细节', '走线细节', '材质特写'],
}

/**
 * PRD FR-14：输出数量 = 参考图数量（无参考图时输出 1 张）。
 * 每个输出位对应一个细节部位标签，按分类循环取。
 */
export function buildGarmentDetailShots(
  category: GarmentDetailCategory,
  referenceAssetIds: (string | null)[],
): GarmentDetailShot[] {
  const parts = DETAIL_PART_LABELS[category]
  if (referenceAssetIds.length === 0) {
    return [{ shotId: 'detail_1', label: parts[0], referenceAssetId: null }]
  }
  return referenceAssetIds.map((assetId, index) => ({
    shotId: `detail_${index + 1}`,
    label: parts[index % parts.length],
    referenceAssetId: assetId,
  }))
}

// ---------------------------------------------------------------------------
// 任务生命周期模拟
// ---------------------------------------------------------------------------

/** 演示用结果图池（public/cases 下现有素材，仅作占位） */
const DEMO_RESULT_IMAGES = [
  '/cases/photo-fission-kid-white-tee-shot-1.jpg',
  '/cases/photo-fission-kid-white-tee-shot-2.jpg',
  '/cases/photo-fission-kid-white-tee-shot-3.jpg',
  '/cases/photo-fission-kid-white-tee-shot-4.jpg',
  '/cases/photo-fission-kid-white-tee-shot-5.jpg',
  '/cases/photo-fission-kid-white-tee-shot-6.jpg',
  '/cases/photo-fission-kid-white-tee-shot-7.jpg',
  '/cases/photo-fission-kid-white-tee-shot-8.jpg',
  '/cases/photo-fission-kid-white-tee-shot-9.jpg',
]

/** mock 时间轴（相对 createdAt 的毫秒偏移） */
const QUEUE_MS = 1_500
const CLASSIFY_MS = 3_500
const PLAN_MS = 5_500
const PER_SHOT_MS = 3_500

/** 演示失败触发词：提示词包含「失败」时模拟审核拒绝（FR-17 可读错误 + 重试入口） */
const MOCK_FAIL_KEYWORD = '失败'
const MOCK_FAIL_ERROR =
  '内容审核未通过（mock 错误码 AUDIT_REJECTED）：请调整提示词或参考图后重试'

function ratioSize(
  ratio: GarmentDetailParams['imageRatio'],
  resolution: GarmentDetailResolution,
): { width: number; height: number } {
  const base = resolution === '1k' ? 1024 : resolution === '2k' ? 2048 : 4096
  if (ratio === '3:4') return { width: Math.round(base * 0.75), height: base }
  if (ratio === '4:3') return { width: base, height: Math.round(base * 0.75) }
  return { width: base, height: base }
}

function categoryLabel(category: GarmentDetailCategory): string {
  return GARMENT_DETAIL_CATEGORY_LABELS[category] ?? category
}

function isMockFailureTask(params: GarmentDetailParams): boolean {
  // 重试过（mockRetryCount > 0）的任务走成功路径，模拟「重试后恢复」。
  return (
    !params.mockRetryCount && params.userPrompt.includes(MOCK_FAIL_KEYWORD)
  )
}

export interface GarmentDetailMockInput {
  params: GarmentDetailParams
  mainImage: UploadedImage
  referenceImages: UploadedImage[]
}

function toMockAssetRecord(
  image: UploadedImage,
  createdAt: string,
): AssetRecord {
  return {
    assetId: image.assetId,
    userId: 'demo_user',
    projectId: 'garment-detail-mock',
    fileName: image.name,
    fileUrl: image.preview,
    fileType: 'image',
    width: image.width,
    height: image.height,
    createdAt,
    taskId: null,
  }
}

/** 创建 mock 任务（初始为排队态，后续由 advance 推进）。 */
export function createGarmentDetailMockTask(
  input: GarmentDetailMockInput,
  nowMs = Date.now(),
): GenerationTask {
  const { params, mainImage, referenceImages } = input
  const createdAt = new Date(nowMs).toISOString()
  const taskId = `${GARMENT_DETAIL_MOCK_TASK_PREFIX}${nowMs.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const shots = params.detailShots

  return {
    taskId,
    userId: 'demo_user',
    featureType: 'garment-detail',
    workflowId: GARMENT_DETAIL_MOCK_WORKFLOW_ID,
    inputAssetIds: [mainImage.assetId, ...referenceImages.map((image) => image.assetId)],
    inputAssets: [
      toMockAssetRecord(mainImage, createdAt),
      ...referenceImages.map((image) => toMockAssetRecord(image, createdAt)),
    ],
    params,
    status: 'pending',
    progress: 0,
    message: '排队中，正在等待生图通道',
    resultAssetIds: [],
    results: [],
    shotProgress: shots.map((shot) => ({
      shotId: shot.shotId,
      label: shot.label,
      status: 'prompting',
      message: '等待开始',
    })),
    schedulerState: 'queued',
    queuePosition: 1,
    createdAt,
    creditsUsed: params.creditsCost,
  }
}

function buildMockResult(
  task: GenerationTask,
  shot: GarmentDetailShot,
  index: number,
  params: GarmentDetailParams,
): ResultAsset {
  const { width, height } = ratioSize(params.imageRatio, params.resolution)
  const url = DEMO_RESULT_IMAGES[index % DEMO_RESULT_IMAGES.length]
  return {
    assetId: `${task.taskId}-result-${shot.shotId}`,
    url,
    downloadUrl: url,
    width,
    height,
    kind: 'generated',
    label: shot.label,
    shotId: shot.shotId,
    metadata: { mock: true },
  }
}

/**
 * 纯函数推进 mock 任务：由调用方定时器以当前时间驱动。
 * 终态（success/failed/cancelled/partial）任务原样返回。
 */
export function advanceGarmentDetailMockTask(
  task: GenerationTask,
  nowMs = Date.now(),
): GenerationTask {
  if (task.featureType !== 'garment-detail') return task
  if (
    task.status === 'success' ||
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    task.status === 'partial'
  ) {
    return task
  }

  const params = task.params as GarmentDetailParams
  const shots = params.detailShots
  const createdMs = new Date(task.createdAt).getTime()
  const elapsed = Math.max(0, nowMs - createdMs)

  if (elapsed < QUEUE_MS) return task

  if (elapsed < CLASSIFY_MS) {
    return {
      ...task,
      status: 'running',
      schedulerState: 'active',
      queuePosition: undefined,
      progress: 12,
      message: '正在抠图并识别服装类型…',
    }
  }

  if (elapsed < PLAN_MS) {
    return {
      ...task,
      status: 'running',
      schedulerState: 'active',
      queuePosition: undefined,
      progress: 28,
      message: `分类完成：${categoryLabel(params.category)}，正在规划细节部位…`,
      shotProgress: shots.map((shot) => ({
        shotId: shot.shotId,
        label: shot.label,
        status: 'prompting' as const,
        message: '提示词拼装中',
      })),
    }
  }

  if (isMockFailureTask(params)) {
    // 失败演示：进入生成后立刻被审核拦截，无可读结果。
    return {
      ...task,
      status: 'failed',
      schedulerState: undefined,
      progress: 0,
      message: '生成失败',
      errorMessage: MOCK_FAIL_ERROR,
      finishedAt: new Date(createdMs + PLAN_MS).toISOString(),
      shotProgress: shots.map((shot) => ({
        shotId: shot.shotId,
        label: shot.label,
        status: 'failed' as const,
        message: '审核未通过',
      })),
    }
  }

  const completedCount = Math.min(
    shots.length,
    Math.floor((elapsed - PLAN_MS) / PER_SHOT_MS),
  )
  const results = shots
    .slice(0, completedCount)
    .map((shot, index) => buildMockResult(task, shot, index, params))

  if (completedCount >= shots.length) {
    const finishedAt = new Date(createdMs + PLAN_MS + shots.length * PER_SHOT_MS)
    return {
      ...task,
      status: 'success',
      schedulerState: undefined,
      progress: 100,
      message: '生成成功',
      results,
      resultAssetIds: results.map((result) => result.assetId),
      finishedAt: finishedAt.toISOString(),
      shotProgress: shots.map((shot) => ({
        shotId: shot.shotId,
        label: shot.label,
        status: 'success' as const,
        message: '已生成',
      })),
    }
  }

  const shotProgress: ShotProgress[] = shots.map((shot, index) => {
    if (index < completedCount) {
      return {
        shotId: shot.shotId,
        label: shot.label,
        status: 'success',
        message: '已生成',
      }
    }
    if (index === completedCount) {
      return {
        shotId: shot.shotId,
        label: shot.label,
        status: 'generating',
        message: '细节图生成中…',
      }
    }
    return {
      shotId: shot.shotId,
      label: shot.label,
      status: 'prompting',
      message: '排队等待',
    }
  })

  return {
    ...task,
    status: 'running',
    schedulerState: 'active',
    queuePosition: undefined,
    progress: Math.min(
      95,
      30 + Math.round((65 * completedCount) / Math.max(1, shots.length)),
    ),
    message: `正在生成细节图 ${completedCount + 1}/${shots.length}…`,
    results,
    resultAssetIds: results.map((result) => result.assetId),
    shotProgress,
  }
}

/** 失败任务重试：重置时间轴并标记 mockRetryCount，模拟链路走成功路径。 */
export function retryGarmentDetailMockTask(
  task: GenerationTask,
  nowMs = Date.now(),
): GenerationTask {
  const params = task.params as GarmentDetailParams
  const nextParams: GarmentDetailParams = {
    ...params,
    mockRetryCount: (params.mockRetryCount ?? 0) + 1,
  }
  const createdAt = new Date(nowMs).toISOString()
  return {
    ...task,
    params: nextParams,
    status: 'pending',
    progress: 0,
    message: '排队中，正在等待生图通道',
    errorMessage: undefined,
    results: [],
    resultAssetIds: [],
    finishedAt: undefined,
    schedulerState: 'queued',
    queuePosition: 1,
    createdAt,
    shotProgress: nextParams.detailShots.map((shot) => ({
      shotId: shot.shotId,
      label: shot.label,
      status: 'prompting' as const,
      message: '等待开始',
    })),
  }
}

/** 本地取消：保留已生成结果，未完成的输出位标记为已取消。 */
export function cancelGarmentDetailMockTask(
  task: GenerationTask,
  nowMs = Date.now(),
): GenerationTask {
  const params = task.params as GarmentDetailParams
  const succeededShotIds = new Set(
    task.results.map((result) => result.shotId).filter(Boolean),
  )
  return {
    ...task,
    status: 'cancelled',
    schedulerState: undefined,
    queuePosition: undefined,
    message: task.results.length > 0 ? '已取消，保留已生成图片' : '已取消',
    finishedAt: new Date(nowMs).toISOString(),
    shotProgress: params.detailShots.map((shot) => {
      if (succeededShotIds.has(shot.shotId)) {
        return {
          shotId: shot.shotId,
          label: shot.label,
          status: 'success' as const,
          message: '已生成',
        }
      }
      return {
        shotId: shot.shotId,
        label: shot.label,
        status: 'cancelled' as const,
        message: '已取消',
      }
    }),
  }
}
