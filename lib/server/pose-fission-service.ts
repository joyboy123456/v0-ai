import {
  DEFAULT_FASHION_MODEL,
  FASHION_MODELS,
  POSE_FISSION_CASES,
  POSE_IMAGE_RATIOS,
  POSE_RESOLUTIONS,
  POSE_TEMPLATES,
  type FashionModelId,
  type PoseFissionCase,
  type PoseFissionParams,
  type PoseImageRatio,
  type PoseResolution,
  type PoseTemplate,
  type ResultAsset,
} from '@/lib/types'
import { runGoogleImageEdit } from './google-genai-adapter'
import { logImageEvent } from './log'

const POSE_FISSION_MIN_TEMPLATES = 1
const POSE_FISSION_MAX_TEMPLATES = 9
const POSE_FISSION_CREDITS_COST = 0 as const

const poseImageRatioIds = new Set<PoseImageRatio>(
  // POSE_IMAGE_RATIOS 仅含 10 个真实比例；'more' 是前端 UI 概念，
  // 已在数组中排除，这里直接 map 出 id 即可。
  POSE_IMAGE_RATIOS.map((option) => option.id),
)
const poseResolutionIds = new Set<PoseResolution>(
  POSE_RESOLUTIONS.map((option) => option.id),
)
const fashionModelIds = new Set<FashionModelId>(
  FASHION_MODELS.map((option) => option.id),
)

export function listPoseFissionCases(): PoseFissionCase[] {
  return POSE_FISSION_CASES
}

export function getPoseFissionCase(caseId: string): PoseFissionCase | null {
  return POSE_FISSION_CASES.find((poseCase) => poseCase.id === caseId) ?? null
}

export function listPoseTemplates(): PoseTemplate[] {
  return POSE_TEMPLATES
}

export function getPoseTemplate(id: string): PoseTemplate | null {
  return POSE_TEMPLATES.find((template) => template.id === id) ?? null
}

export function normalizePoseFissionParams(
  params: unknown,
  inputAssetCount: number,
): PoseFissionParams {
  if (!isRecord(params)) {
    throw new Error('姿势裂变参数格式错误')
  }

  const model = readFashionModel(params.model)
  const poseTemplateIds = readPoseTemplateIds(params.poseTemplateIds)
  const poseTemplateSnapshots = poseTemplateIds.map((id) => {
    const template = getPoseTemplate(id)
    if (!template) {
      throw new Error(`姿势模板不存在：${id}`)
    }
    return template
  })

  const imageRatio = readPoseImageRatio(params.imageRatio)
  const resolution = readPoseResolution(params.resolution)
  const hasFrontDetail = readOptionalBoolean(
    params.hasFrontDetail,
    false,
    '正面细节图参数无效',
  )
  const hasBackDetail = readOptionalBoolean(
    params.hasBackDetail,
    false,
    '背面细节图参数无效',
  )
  const expectedAssetCount = 1 + Number(hasFrontDetail) + Number(hasBackDetail)

  if (inputAssetCount !== expectedAssetCount) {
    throw new Error('姿势裂变素材数量与细节图参数不一致')
  }

  return {
    model,
    poseTemplateIds,
    poseTemplateSnapshots,
    hasFrontDetail,
    hasBackDetail,
    imageRatio,
    resolution,
    resultCount: poseTemplateIds.length,
    creditsCost: POSE_FISSION_CREDITS_COST,
  }
}

/**
 * 构建针对「单个姿势模板」的生图 prompt。
 * pose-fission pipeline 会按 poseTemplateSnapshots 逐个调用，每次传一个 template。
 */
export function buildPoseFissionPrompt(
  params: PoseFissionParams,
  template: PoseTemplate,
): string {
  return [
    '基于上传的服装模特成片进行姿势裂变。',
    '第一张图是需要保持人物、服装和画面质感的主图，后续图片若存在则是产品正面或背面细节参考。',
    `目标姿势：${template.name}。`,
    template.prompt ? `姿势要求：${template.prompt}。` : '',
    params.hasFrontDetail
      ? '已提供产品正面细节图，请保持领口、面料、logo、图案等正面细节一致。'
      : '',
    params.hasBackDetail
      ? '已提供产品背面细节图，请在背面或侧后角度中保持背部结构一致。'
      : '',
    `画面比例：${params.imageRatio}。`,
    `分辨率档位：${params.resolution}。`,
    '要求：保持原图人物身份、脸部特征、发型、身材比例、服装颜色、版型、材质、图案和关键细节；只改变人物姿势和必要构图；生成电商主图质感，背景干净，主体清晰；避免手部畸形、服装扭曲、肢体异常、脸部崩坏、文字乱码和多余人物。',
  ]
    .filter(Boolean)
    .join('\n')
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

function readPoseTemplateIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('请至少选择一个姿势')
  }

  const trimmed: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error('姿势模板 id 必须是字符串')
    }
    const candidate = item.trim()
    if (!candidate) continue
    trimmed.push(candidate)
  }

  // 去重以避免同一 pose 被勾选多次造成重复生成
  const deduped = Array.from(new Set(trimmed))

  if (deduped.length < POSE_FISSION_MIN_TEMPLATES) {
    throw new Error('请至少选择一个姿势')
  }
  if (deduped.length > POSE_FISSION_MAX_TEMPLATES) {
    throw new Error(`一次最多选择 ${POSE_FISSION_MAX_TEMPLATES} 个姿势`)
  }

  return deduped
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

function readOptionalBoolean(
  value: unknown,
  fallback: boolean,
  errorMessage: string,
): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value

  throw new Error(errorMessage)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface RunPoseFissionPipelineOptions {
  taskId: string
  /** 顺序：[主图, 可选正面细节, 可选背面细节]。1-3 张 dataURL/http URL */
  inputImages: string[]
  params: PoseFissionParams
  apiKey: string
  timeoutMs: number
  /**
   * 单 pose 成功后立刻回调；用于流式持久化已成功的图，防止整个 pipeline 卡死时丢失数据。
   * 可选：未传时 pipeline 行为退化为 Promise.all 全部 settle 后返回 results。
   */
  onShotResult?: (result: ResultAsset) => Promise<void>
  /**
   * 失败 pose 重跑入口。传入时 pipeline 只跑 poseTemplateSnapshots 中
   * template.id ∈ targetTemplateIds 的子集；不传或空数组时跑全部 pose。
   */
  targetTemplateIds?: string[]
}

interface PoseRunResult {
  template: PoseTemplate
  result?: ResultAsset
  error?: string
}

/**
 * 逐姿势模板调度 Google adapter。每个 template 单独调用一次 runGoogleImageEdit，
 * inputImages（主图 + 可选正面 + 可选背面）按顺序传给底层。
 *
 * 重试与错误分类由 runGoogleImageEdit 内部的 callGoogleImageWithRetry 统一负责；
 * 本函数只负责并发调度 + 失败容忍 + 流式持久化（参照 photo-fission 范式）。
 *
 * 失败容忍：单 pose 失败时继续后续 pose，全部失败时抛错让 runTask 标记为 failed。
 *
 * 流式持久化：若调用方传入 onShotResult，每个 pose 拿到 ResultAsset 后立刻 await
 * 回调完成持久化（写盘 + 更新 store），再继续下一个 pose。
 *
 * targetTemplateIds：当传入非空数组时，只跑这些 template.id（用于 retry）。
 *
 * 并发：默认 2（POSE_FISSION_CONCURRENCY env 可覆盖），与 photo-fission 同步保守，
 * 避免触发 Google 单 key IPM。Google 节流由 callGoogleImageWithRetry 内部 acquire 统一负责。
 */
export async function runPoseFissionPipeline(
  options: RunPoseFissionPipelineOptions,
): Promise<ResultAsset[]> {
  const { params, taskId } = options
  const fullSnapshots = params.poseTemplateSnapshots ?? []
  if (!fullSnapshots.length) {
    throw new Error('姿势裂变缺少姿势模板快照')
  }

  if (!options.inputImages.length) {
    throw new Error('姿势裂变缺少参考图')
  }

  const targetSet =
    options.targetTemplateIds && options.targetTemplateIds.length > 0
      ? new Set(options.targetTemplateIds)
      : null
  const templates = targetSet
    ? fullSnapshots.filter((template) => targetSet.has(template.id))
    : fullSnapshots

  if (!templates.length) {
    throw new Error('姿势裂变 targetTemplateIds 与 poseTemplateSnapshots 不匹配')
  }

  const concurrencyRaw = Number(process.env.POSE_FISSION_CONCURRENCY ?? 2)
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw >= 1
      ? Math.min(Math.floor(concurrencyRaw), templates.length)
      : Math.min(2, templates.length)

  const aspectRatio = params.imageRatio === 'more' ? undefined : params.imageRatio
  const imageSize = params.resolution.toUpperCase()

  const poseResults: PoseRunResult[] = new Array(templates.length)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= templates.length) return

      const template = templates[currentIndex]
      const prompt = buildPoseFissionPrompt(params, template)

      try {
        const single = await runGoogleImageEdit({
          taskId,
          apiKey: options.apiKey,
          model: params.model,
          timeoutMs: options.timeoutMs,
          prompt,
          inputImages: options.inputImages,
          count: 1,
          aspectRatio,
          imageSize,
          traceId: `${taskId}_${template.id}`,
          shotId: template.id,
        })

        const first = single[0]
        if (!first) {
          poseResults[currentIndex] = {
            template,
            error: '该姿势未返回图片',
          }
          continue
        }

        const enriched: ResultAsset = {
          ...first,
          assetId: `result_${taskId}_${template.id}`,
          label: template.name,
          shotId: template.id,
          finalPrompt: prompt,
        }

        poseResults[currentIndex] = {
          template,
          result: enriched,
        }

        if (options.onShotResult) {
          try {
            await options.onShotResult(enriched)
          } catch (persistError) {
            const message =
              persistError instanceof Error ? persistError.message : '未知错误'
            logImageEvent(
              'gimg.fail',
              {
                traceId: `${taskId}_${template.id}`,
                taskId,
                shotId: template.id,
              },
              { stage: 'persist', reason: message },
            )
            poseResults[currentIndex] = {
              template,
              error: `流式持久化失败：${message}`,
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        // wrapper 已经在 gimg.fail 里打过结构化日志，这里仅记录 pose 级 result 供上层 partial 判定
        poseResults[currentIndex] = {
          template,
          error: message,
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  const successResults = poseResults
    .filter(
      (entry): entry is PoseRunResult & { result: ResultAsset } =>
        Boolean(entry?.result),
    )
    .map((entry) => entry.result)

  if (!successResults.length) {
    const firstError = poseResults.find((entry) => entry?.error)?.error
    throw new Error(
      firstError
        ? `姿势裂变全部姿势失败：${firstError}`
        : '姿势裂变全部姿势失败',
    )
  }

  return successResults
}
