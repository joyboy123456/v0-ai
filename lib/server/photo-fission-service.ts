import {
  DEFAULT_FASHION_MODEL,
  FASHION_MODELS,
  PHOTO_FISSION_CATEGORIES,
  PHOTO_FISSION_IMAGE_RATIOS,
  PHOTO_FISSION_RESOLUTIONS,
  type FashionModelId,
  type PhotoFissionCategory,
  type PhotoFissionImageRatio,
  type PhotoFissionParams,
  type PhotoFissionResolution,
  type PhotoFissionShot,
  type ResultAsset,
} from '@/lib/types'
import { runGoogleImageEdit } from './google-genai-adapter'
import { logImageEvent } from './log'

const photoFissionCategoryIds = new Set<PhotoFissionCategory>(
  PHOTO_FISSION_CATEGORIES.map((option) => option.id),
)
const photoFissionImageRatioIds = new Set<PhotoFissionImageRatio>(
  PHOTO_FISSION_IMAGE_RATIOS.map((option) => option.id),
)
const photoFissionResolutionIds = new Set<PhotoFissionResolution>(
  PHOTO_FISSION_RESOLUTIONS.map((option) => option.id),
)
const fashionModelIds = new Set<FashionModelId>(
  FASHION_MODELS.map((option) => option.id),
)

const photoFissionCategoryLabelMap = new Map(
  PHOTO_FISSION_CATEGORIES.map((option) => [option.id, option.label]),
)

/**
 * v3（2026-05-18 决议）9 张固定镜头蓝图：受控裂变核心配置。
 * 只变化镜头/距离/姿势/构图，不变化人物身份、服装、场景、光线、风格。
 *
 * label 顺序与 shot_1..shot_9 一一对应，案例库 shotLabels 需保持同序。
 */
const PHOTO_FISSION_SHOT_BLUEPRINT: ReadonlyArray<{
  label: string
  description: string
}> = [
  {
    label: '正面站姿',
    description: '主体正面站立，自然放松姿态，全身或近全身入镜',
  },
  {
    label: '45度斜侧',
    description: '主体 45 度斜侧角度，兼顾正面识别度与侧面立体感',
  },
  {
    label: '侧面站姿',
    description: '主体正侧面站立，展现服装侧身轮廓与版型',
  },
  {
    label: '背面站姿',
    description: '主体背身站立，突出背部廓形、肩线、裙摆或裤型层次',
  },
  {
    label: '远景全景',
    description: '远距离全景构图，主体居中，环境与场景氛围完整入镜',
  },
  {
    label: '半身近景',
    description: '镜头聚焦主体上半身，强化面部状态与上身服装细节',
  },
  {
    label: '坐姿变化',
    description: '主体坐姿（沙发/椅子/台阶等场景内合理座位），松弛自然',
  },
  {
    label: '行走动态',
    description: '主体侧身行走或迈步的动态瞬间，步态轻盈自然，展示服装动感',
  },
  {
    label: '局部细节特写',
    description: '极近距离展示服装关键细节，如领口/袖口/纽扣/面料纹理/图案',
  },
]

/**
 * 品类专属保持要求文案（PRD 第 5.5 节）。
 */
const categoryRequirementMap: Record<PhotoFissionCategory, string> = {
  tops: '突出上衣领口、肩线、袖型与下摆轮廓；下装搭配自然但不抢主体',
  pants: '突出裤型、裤脚、腰线与版型立体感；上身搭配简洁不抢主体',
  skirts: '突出裙摆层次、长度与版型流动感；保持腰线与裙身比例',
  suit: '保持上下装色彩、材质、版型的整体协调统一',
  outerwear: '突出外套廓形、领型、下摆与厚度感；内搭简洁',
  childrens: '保持儿童体型比例、童装版型宽松度与亲和感；避免成人化处理',
}

export function normalizePhotoFissionParams(
  params: unknown,
  inputAssetCount: number,
): PhotoFissionParams {
  if (!isRecord(params)) {
    throw new Error('服装大片裂变参数格式错误')
  }

  const model = readFashionModel(params.model)
  const category = readPhotoFissionCategory(params.category)
  const hasFrontDetail = readOptionalBoolean(
    params.hasFrontDetail,
    false,
    '服装大片裂变正面细节图参数无效',
  )
  const hasBackDetail = readOptionalBoolean(
    params.hasBackDetail,
    false,
    '服装大片裂变背面细节图参数无效',
  )
  const imageRatio = readPhotoFissionImageRatio(params.imageRatio)
  const resolution = readPhotoFissionResolution(params.resolution)

  const expectedAssetCount =
    1 + (hasFrontDetail ? 1 : 0) + (hasBackDetail ? 1 : 0)
  if (inputAssetCount !== expectedAssetCount) {
    throw new Error('服装大片裂变素材数量与细节图参数不一致')
  }

  const shotPlan = buildPhotoFissionShotPlan({
    category,
    imageRatio,
    resolution,
    hasFrontDetail,
    hasBackDetail,
  })

  // R6 输入预检：每条 shot.prompt 不应超过 30000 字（v3 实测 1400-1500 字，远低于上限，加 guard）
  for (const shot of shotPlan) {
    if (shot.prompt.length > 30000) {
      throw new Error(
        `服装大片裂变 prompt 长度异常（shot=${shot.shotId} 长度=${shot.prompt.length}，上限 30000）`,
      )
    }
  }

  return {
    model,
    category,
    hasFrontDetail,
    hasBackDetail,
    imageRatio,
    resolution,
    shotPlan,
    resultCount: 9,
  }
}

export interface PhotoFissionShotPlanInput {
  category: PhotoFissionCategory
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  hasFrontDetail: boolean
  hasBackDetail: boolean
}

/**
 * 构造固定 9 张 shotPlan。
 *
 * v3（2026-05-18）：每条 shot.prompt 按以下 12 段拼装，强约束 NanoBanana Pro
 * 多镜头一致性的全部 lock 段，翻译成自然语言供 Gemini 3.x 使用：
 *   1. 任务声明（受控裂变）
 *   2. 参考图说明（动态拼接 1/2/3 张）
 *   3. 身份锁 IDENTITY_LOCK
 *   4. 服装锁 WARDROBE_LOCK
 *   5. 场景锁 SCENE_LOCK
 *   6. 光线锁 LIGHTING_LOCK
 *   7. 视觉风格锁 STYLE_LOCK
 *   8. 当前镜头 SHOT（按 label 差异化）
 *   9. 品类专属保持
 *  10. 解剖与手部 ANATOMY
 *  11. 输出参数
 *  12. 禁止项 NEGATIVE
 */
export function buildPhotoFissionShotPlan(
  input: PhotoFissionShotPlanInput,
): PhotoFissionShot[] {
  return PHOTO_FISSION_SHOT_BLUEPRINT.map((blueprint, index) => {
    const shotId = `shot_${index + 1}`
    const order = index + 1
    const prompt = buildShotPrompt({
      label: blueprint.label,
      shotDescription: blueprint.description,
      category: input.category,
      imageRatio: input.imageRatio,
      resolution: input.resolution,
      hasFrontDetail: input.hasFrontDetail,
      hasBackDetail: input.hasBackDetail,
    })

    return {
      shotId,
      label: blueprint.label,
      prompt,
      order,
    }
  })
}

interface BuildShotPromptInput {
  label: string
  shotDescription: string
  category: PhotoFissionCategory
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  hasFrontDetail: boolean
  hasBackDetail: boolean
}

function buildShotPrompt(input: BuildShotPromptInput): string {
  const sections: string[] = [
    buildTaskSection(input.label),
    '',
    buildReferenceImagesSection(input.hasFrontDetail, input.hasBackDetail),
    '',
    buildIdentityLockSection(),
    '',
    buildWardrobeLockSection(),
    '',
    buildSceneLockSection(),
    '',
    buildLightingLockSection(),
    '',
    buildStyleLockSection(),
    '',
    buildShotSection(input.label, input.shotDescription),
    '',
    buildCategoryLockSection(input.category),
    '',
    buildAnatomySection(),
    '',
    buildOutputParamsSection(input.category, input.imageRatio, input.resolution),
    '',
    buildNegativeSection(),
  ]

  return sections.join('\n')
}

function buildTaskSection(label: string): string {
  return [
    `本次任务：基于参考图生成同一服装、同一模特、同一场景下的【${label}】单张镜头。`,
    '要求受控裂变——只变化镜头角度/景别/姿势/构图，**不变化人物身份、服装、场景、光线、风格**。',
    '**单张完整图片输出，不要拼成多宫格 grid 布局**。',
  ].join('\n')
}

function buildReferenceImagesSection(
  hasFrontDetail: boolean,
  hasBackDetail: boolean,
): string {
  const lines: string[] = [
    '【参考图说明】',
    '- 图1：主图（用户已满意的服装大片，作为身份、服装、场景、光线的主参考）',
  ]
  let nextIndex = 2
  if (hasFrontDetail) {
    lines.push(`- 图${nextIndex}：产品正面细节补充（如已上传）`)
    nextIndex += 1
  }
  if (hasBackDetail) {
    lines.push(`- 图${nextIndex}：产品背面细节补充（如已上传）`)
  }
  return lines.join('\n')
}

function buildIdentityLockSection(): string {
  return [
    '【身份锁 IDENTITY_LOCK】',
    '严格保持主图中模特的：脸型、五官比例、骨架结构、眼睛大小与间距、唇形、下颌线、眉形、肤色、发型、发色、年龄感。',
    '**绝对不要换脸**。**禁止美颜化处理**。**禁止对称化五官调整**。**禁止改变模特身份特征**。',
    '模特应当看起来与主图中是同一个真实的人，face identity 与主图一致。',
  ].join('\n')
}

function buildWardrobeLockSection(): string {
  return [
    '【服装锁 WARDROBE_LOCK】',
    '严格保留主图中的服装款式、颜色、版型、材质、图案、Logo、纽扣、口袋、领口、袖口、裤脚等所有细节。',
    '不要改变服装颜色，不要新增或删除任何图案，不要把服装变成其他款式或材质。',
  ].join('\n')
}

function buildSceneLockSection(): string {
  return [
    '【场景锁 SCENE_LOCK】',
    '严格保留主图中的背景、道具、墙面、地板、家具、灯具、植物等所有场景物件与陈设。',
    '不要把场景换成其他环境。镜头可以拉近或拉远，但所处的房间/空间与主图一致。',
  ].join('\n')
}

function buildLightingLockSection(): string {
  return [
    '【光线锁 LIGHTING_LOCK】',
    '严格保留主图的光源方向、光线强度、色温、阴影走向、高光分布。',
    '画面亮度对比与主图一致。',
    '不要把柔光变硬光，不要把白天变夜晚，不要改变光线色温。',
  ].join('\n')
}

function buildStyleLockSection(): string {
  return [
    '【视觉风格锁 STYLE_LOCK】',
    '严格保留主图的摄影质感、调色风格、锐度、整体氛围。',
    '保持时尚大片或电商商拍质感。',
    '**禁止变成卡通/插画/油画/水彩/手绘/动漫风格**。',
    '**禁止过度滤镜、过度美颜、过度饱和**。',
  ].join('\n')
}

function buildShotSection(label: string, shotDescription: string): string {
  return ['【当前镜头 SHOT】', `${label}：${shotDescription}`].join('\n')
}

function buildCategoryLockSection(category: PhotoFissionCategory): string {
  return [
    '【品类专属保持要求】',
    categoryRequirementMap[category],
  ].join('\n')
}

function buildAnatomySection(): string {
  return [
    '【解剖与手部 ANATOMY】',
    '手指数量正确（每只手 5 指），手腕、肘部、肩部、颈部、膝盖姿态自然真实。',
    '**禁止多余手指、缺失手指、扭曲手腕、错位关节、断裂肢体、不对称肩线**。',
    '人体比例正确，**禁止人体畸形**。',
  ].join('\n')
}

function buildOutputParamsSection(
  category: PhotoFissionCategory,
  imageRatio: PhotoFissionImageRatio,
  resolution: PhotoFissionResolution,
): string {
  const categoryLabel = photoFissionCategoryLabelMap.get(category) ?? category
  return [
    '【输出参数】',
    `画面比例：${imageRatio}；分辨率档位：${resolution}；品类：${categoryLabel}。`,
    '**单张完整图片输出**。',
  ].join('\n')
}

function buildNegativeSection(): string {
  return [
    '【禁止项 NEGATIVE】',
    '不要生成：text、watermark、logo、品牌标识、文字、印章；',
    '不要生成：extra fingers、missing fingers、distorted anatomy、extra limbs、wrong face、face morphing；',
    '不要生成：cartoon、anime、illustration、oil painting、watercolor、sketch、3D render、plastic skin；',
    '不要生成：blurry、low resolution、过度美颜、明显 AI 感；',
    '不要生成：multiple panels、grid layout、collage、split-screen、photo wall（**强调输出单张图片，不要多宫格拼接**）；',
    '不要生成：extra people（额外的人物或脸）；',
    '**不要换脸**、**不要换服装颜色**、**不要换场景**、**不要换光线风格**。',
  ].join('\n')
}

export interface RunPhotoFissionPipelineOptions {
  taskId: string
  inputImages: string[]
  params: PhotoFissionParams
  apiKey: string
  timeoutMs: number
  /**
   * 单 shot 成功后立刻回调；用于流式持久化已成功的图，防止整个 pipeline 卡死时丢失数据。
   * 可选：未传时 pipeline 行为完全向后兼容（仅在 Promise.all 全部 settle 后返回 results）。
   */
  onShotResult?: (result: ResultAsset) => Promise<void>
  /**
   * v4 R5：失败镜头重跑入口。传入时 pipeline 只跑 shotPlan 中 shotId ∈ targetShotIds 的子集。
   * 不传或空数组时 pipeline 跑完整 shotPlan（向后兼容）。
   */
  targetShotIds?: string[]
}

interface ShotRunResult {
  shot: PhotoFissionShot
  result?: ResultAsset
  error?: string
}

/**
 * 逐 shot 调度 Google adapter。每个 shot 单独调用一次 runGoogleImageEdit，
 * inputImages（主图 + 可选正面 + 可选背面）按顺序传给底层，对应 prompt 的「图1/图2/图3」。
 *
 * 重试与错误分类由 runGoogleImageEdit 内部的 callGoogleImageWithRetry 统一负责（v4 R1 + R2）；
 * 本函数只负责并发调度 + 失败容忍 + 流式持久化。
 *
 * 失败容忍：单 shot 失败时继续后续 shot，全部失败时抛错让 runTask 标记为 failed。
 *
 * 流式持久化：若调用方传入 onShotResult 回调，每个 shot 拿到 ResultAsset 后立刻 await 回调
 * 完成持久化（写磁盘 + 更新 store），然后再继续下一个 shot。即使后续 shot 卡死整个 pipeline，
 * 已成功并通过回调持久化的图也不会丢失。
 *
 * targetShotIds：当传入非空数组时，pipeline 仅跑这些 shotId（用于 R5 重跑失败镜头）。
 */
export async function runPhotoFissionPipeline(
  options: RunPhotoFissionPipelineOptions,
): Promise<ResultAsset[]> {
  const { params, taskId } = options
  const fullPlan = params.shotPlan ?? []
  if (!fullPlan.length) {
    throw new Error('服装大片裂变缺少镜头计划')
  }

  if (!options.inputImages.length) {
    throw new Error('服装大片裂变缺少参考图')
  }

  // 过滤目标 shot：targetShotIds 非空时只跑子集
  const targetSet =
    options.targetShotIds && options.targetShotIds.length > 0
      ? new Set(options.targetShotIds)
      : null
  const shotPlan = targetSet
    ? fullPlan.filter((shot) => targetSet.has(shot.shotId))
    : fullPlan

  if (!shotPlan.length) {
    throw new Error('服装大片裂变 targetShotIds 与 shotPlan 不匹配')
  }

  const concurrencyRaw = Number(process.env.PHOTO_FISSION_CONCURRENCY ?? 3)
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw >= 1
      ? Math.min(Math.floor(concurrencyRaw), shotPlan.length)
      : Math.min(3, shotPlan.length)

  const aspectRatio = params.imageRatio
  const imageSize = params.resolution.toUpperCase()

  const shotResults: ShotRunResult[] = new Array(shotPlan.length)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= shotPlan.length) return

      const shot = shotPlan[currentIndex]
      try {
        const single = await runGoogleImageEdit({
          taskId,
          apiKey: options.apiKey,
          model: params.model,
          timeoutMs: options.timeoutMs,
          prompt: shot.prompt,
          inputImages: options.inputImages,
          count: 1,
          aspectRatio,
          imageSize,
          traceId: `${taskId}_${shot.shotId}`,
          shotId: shot.shotId,
        })

        const first = single[0]
        if (!first) {
          shotResults[currentIndex] = {
            shot,
            error: '该镜头未返回图片',
          }
          continue
        }

        const enriched: ResultAsset = {
          ...first,
          assetId: `result_${taskId}_${shot.shotId}`,
          label: shot.label,
          shotId: shot.shotId,
          finalPrompt: shot.prompt,
        }

        shotResults[currentIndex] = {
          shot,
          result: enriched,
        }

        // 流式持久化：先 await 回调把这张图写盘 + 更新 store，再启动下一个 shot。
        // 若回调本身抛错，按单 shot 失败处理，pipeline 继续。
        if (options.onShotResult) {
          try {
            await options.onShotResult(enriched)
          } catch (persistError) {
            const message =
              persistError instanceof Error ? persistError.message : '未知错误'
            logImageEvent(
              'gimg.fail',
              { traceId: `${taskId}_${shot.shotId}`, taskId, shotId: shot.shotId },
              { stage: 'persist', reason: message },
            )
            shotResults[currentIndex] = {
              shot,
              error: `流式持久化失败：${message}`,
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        // wrapper 已经在 gimg.fail 里打过结构化日志，这里仅记录 shot 级 result 供上层 partial 判定
        shotResults[currentIndex] = {
          shot,
          error: message,
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  const successResults = shotResults
    .filter(
      (entry): entry is ShotRunResult & { result: ResultAsset } =>
        Boolean(entry?.result),
    )
    .map((entry) => entry.result)

  if (!successResults.length) {
    const firstError = shotResults.find((entry) => entry?.error)?.error
    throw new Error(
      firstError
        ? `服装大片裂变全部镜头失败：${firstError}`
        : '服装大片裂变全部镜头失败',
    )
  }

  return successResults
}

function readFashionModel(value: unknown): FashionModelId {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_FASHION_MODEL
  }
  if (typeof value === 'string' && fashionModelIds.has(value as FashionModelId)) {
    return value as FashionModelId
  }
  throw new Error('服装大片裂变模型无效')
}

function readPhotoFissionCategory(value: unknown): PhotoFissionCategory {
  if (value === undefined || value === null || value === '') {
    return 'childrens'
  }
  if (
    typeof value === 'string' &&
    photoFissionCategoryIds.has(value as PhotoFissionCategory)
  ) {
    return value as PhotoFissionCategory
  }
  throw new Error('服装大片裂变服装品类无效')
}

function readPhotoFissionImageRatio(value: unknown): PhotoFissionImageRatio {
  if (
    typeof value === 'string' &&
    photoFissionImageRatioIds.has(value as PhotoFissionImageRatio)
  ) {
    return value as PhotoFissionImageRatio
  }
  throw new Error('服装大片裂变图片比例无效')
}

function readPhotoFissionResolution(value: unknown): PhotoFissionResolution {
  if (
    typeof value === 'string' &&
    photoFissionResolutionIds.has(value as PhotoFissionResolution)
  ) {
    return value as PhotoFissionResolution
  }
  throw new Error('服装大片裂变分辨率无效')
}

function readOptionalBoolean(
  value: unknown,
  fallback: boolean,
  errorMessage: string,
) {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  throw new Error(errorMessage)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
