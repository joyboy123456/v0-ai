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
import {
  dispatchItemsForModel,
  getAvailableProvidersForModel,
  getFailoverProviderForModel,
  getNoAvailableProviderMessage,
  isGoogleImageModel,
  type ImageProvider,
} from './image-provider-pool'
import { logImageEvent } from './log'
import { runImageEditViaProvider } from './provider-image-router'

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
 * 多镜头一致性的全部 lock 段，翻译成自然语言供 Gemini 3.x 使用。
 *
 * v4（2026-05-19 prompt-upgrade）：按友商 5525 条 gemini3pro 案例语料重写
 * 所有 section 文案，从「硬命令式」转向「参考图1锚定式」（见 PRD D1-D5）。
 * section 内部话术变化，外部装配顺序与函数签名保持稳定：
 *   1. 任务声明（受控裂变 + 构图三件套 D2）
 *   2. 参考图说明（动态拼接 1/2/3 张）
 *   3. 人物呈现 IDENTITY（隐式锚定 D1）
 *   4. 服装呈现 WARDROBE（"这套服装"占位 D1）
 *   5. 场景呈现 SCENE
 *   6. 光线呈现 LIGHTING
 *   7. 画面质感 STYLE（电影前缀按场景按需注入 D3）
 *   8. 当前镜头 SHOT（按 label 差异化）
 *   9. 品类呈现重点
 *  10. 人体解剖 ANATOMY
 *  11. 输出参数
 *  12. 关键约束（精简 negative D4）
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
  const orientation = getCompositionOrientation(input.imageRatio)
  const sections: string[] = [
    buildTaskSection(input.label, orientation),
    '',
    buildReferenceImagesSection(input.hasFrontDetail, input.hasBackDetail),
    '',
    buildIdentityLockSection(),
    '',
    buildWardrobeLockSection(),
    '',
    buildSceneLockSection(orientation),
    '',
    buildLightingLockSection(),
    '',
    buildStyleLockSection(input.shotDescription),
    '',
    buildShotSection(input.label, input.shotDescription),
    '',
    buildCategoryLockSection(input.category),
    '',
    buildAnatomySection(),
    '',
    buildOutputParamsSection(input.category, input.imageRatio, input.resolution, orientation),
    '',
    buildNegativeSection(),
  ]

  return sections.join('\n')
}

/**
 * 把图片比例字符串映射为中文自然语言构图词。
 * 友商手册第四节：模型对「竖幅构图 / 横幅构图 / 方图」比对原始数字比例敏感得多。
 */
function getCompositionOrientation(imageRatio: PhotoFissionImageRatio): string {
  switch (imageRatio) {
    case '3:4':
    case '2:3':
    case '9:16':
    case '4:5':
      return '竖幅构图'
    case '4:3':
    case '3:2':
    case '16:9':
    case '5:4':
    case '21:9':
      return '横幅构图'
    case '1:1':
    default:
      return '方图构图'
  }
}

/**
 * 判断当前 shot 是否适合在 Style section 注入电影前缀。
 * D3：电影前缀（Arricam / IMAX 等）在友商案例里只在 1.5%-2.3% 命中，
 * 且多集中在户外 / 海边 / 古典建筑等需要拉满质感的外景。
 * 当前 9 个 shotDescription 都是棚拍/室内语境的姿势/景别描述，默认不注入电影前缀，
 * 避免对棚拍主图引入不必要的镜头痕迹；shotDescription 若改写为带外景关键词则会自动启用。
 */
function shouldUseCinematicPrefix(shotDescription: string): boolean {
  return /户外|街拍|海边|海岸|海滩|帆船|古典建筑|欧洲街角|罗马|沿河/.test(
    shotDescription,
  )
}

function buildTaskSection(label: string, orientation: string): string {
  return [
    `本次任务：生成同一个人、同一套服装、同一场景的【${label}】单张镜头。`,
    `画面是一张写实风格的电商服装大片摄影作品，采用${orientation}，主体人物（参考第一张主图的同一个人，身材比例、肤色与发型保持一致）位于画面中央，以"三分法"构图原则布局。`,
    '受控裂变：只调整镜头角度、景别、姿势与构图；保持人物身份、这套服装、原场景与光线统一。',
    '输出单张完整图片，不要多宫格拼接。',
  ].join('\n')
}

function buildReferenceImagesSection(
  hasFrontDetail: boolean,
  hasBackDetail: boolean,
): string {
  const lines: string[] = [
    '【参考图说明】',
    '- 图1：主图基准（这套服装与这位模特的视觉锚点，承载身份、服装、场景、光线的全部细节）',
  ]
  let nextIndex = 2
  if (hasFrontDetail) {
    lines.push(
      `- 图${nextIndex}：这套服装的正面细节参考（领口、扣件、logo、图案以此为准）`,
    )
    nextIndex += 1
  }
  if (hasBackDetail) {
    lines.push(
      `- 图${nextIndex}：这套服装的背面细节参考（背部剪裁、印花、肩线以此为准）`,
    )
  }
  return lines.join('\n')
}

function buildIdentityLockSection(): string {
  return [
    '【人物呈现 IDENTITY】',
    '画面中的人物是图1里的同一个人，身材比例、发型、发色、肤色与年龄感与图1保持一致；面部特征延续图1，神情自然、状态放松。',
  ].join('\n')
}

function buildWardrobeLockSection(): string {
  return [
    '【服装呈现 WARDROBE】',
    '人物穿着这套服装（图1为主图基准），完整延续这套服装的颜色、版型、材质、图案、logo、纽扣、口袋、领口、袖口与下摆细节。',
    '衣物纹理、面料质感、印花与配饰清晰可见，不增加、不减少、不替换任何服装元素。',
  ].join('\n')
}

function buildSceneLockSection(orientation: string): string {
  return [
    '【场景呈现 SCENE】',
    `背景延续图1的房间/空间与陈设（墙面、地板、家具、灯具、植物、道具均与图1一致），整体画面保持${orientation}下的电商主图调性，主体清晰突出。`,
    '镜头可以拉近或拉远以适配新景别，但所处空间与图1是同一处。',
  ].join('\n')
}

function buildLightingLockSection(): string {
  return [
    '【光线呈现 LIGHTING】',
    '光线为柔和均匀的自然光，沿用图1的光源方向、色温、阴影走向与高光分布；无强烈硬阴影，光线统一、画面亮度通透。',
  ].join('\n')
}

function buildStyleLockSection(shotDescription: string): string {
  const cinematicPrefix = shouldUseCinematicPrefix(shotDescription)
    ? 'Arricam LT, Cooke Panchro, 50mm, f1.4。'
    : ''
  return [
    '【画面质感 STYLE】',
    `${cinematicPrefix}写实风格摄影，色彩饱和度适中，细节丰富，衣物纹理与面料质感清晰可见，具有电影感的逼真渲染效果，整体氛围接近时尚杂志的经典大片风格。`,
  ].join('\n')
}

function buildShotSection(label: string, shotDescription: string): string {
  return [
    '【当前镜头 SHOT】',
    `${label}（采用对应景别的平视构图）：${shotDescription}。`,
  ].join('\n')
}

function buildCategoryLockSection(category: PhotoFissionCategory): string {
  return ['【品类呈现重点】', categoryRequirementMap[category]].join('\n')
}

function buildAnatomySection(): string {
  return [
    '【人体解剖 ANATOMY】',
    '手指数量正确（每只手 5 指），手腕、肘部、肩部、颈部、膝盖姿态自然真实，人体比例与图1一致。',
  ].join('\n')
}

function buildOutputParamsSection(
  category: PhotoFissionCategory,
  imageRatio: PhotoFissionImageRatio,
  resolution: PhotoFissionResolution,
  orientation: string,
): string {
  const categoryLabel = photoFissionCategoryLabelMap.get(category) ?? category
  return [
    '【输出参数】',
    `画面比例：${imageRatio}（${orientation}）；分辨率档位：${resolution}；品类：${categoryLabel}。`,
    '输出单张完整图片。',
  ].join('\n')
}

function buildNegativeSection(): string {
  return [
    '【关键约束】',
    '不改变这套服装的颜色、版型、材质、图案与 logo；不改变人物的脸部特征与发型；保持场景与画面风格一致。',
    '不要生成：文字、水印、品牌印章、多余人物、多宫格拼接，不要变成卡通/插画/动漫/3D 渲染风格。',
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
  providerId?: string
}

/**
 * 逐 shot 调度 provider adapter。每个 shot 单独调用一次 runImageEditViaProvider，
 * inputImages（主图 + 可选正面 + 可选背面）按顺序传给底层，对应 prompt 的「图1/图2/图3」。
 *
 * v5（2026-05-19 多渠道并发）：
 * - 通过 dispatchItems() 将 shotPlan 按加权轮询分配到所有可用 provider
 * - 每个 provider 独立运行 worker 组，各自走独立的 IPM/RPM 令牌桶
 * - 单 provider 全部失败的 shot 会通过 getFailoverProvider() 尝试跨渠道 failover
 * - 向后兼容：只有一个 provider 时行为与 v4 完全一致
 *
 * 重试与错误分类由 provider adapter 内部的 callGoogleImageWithRetry 统一负责（v4 R1 + R2）；
 * 本函数只负责并发调度 + 失败容忍 + 流式持久化 + 跨渠道 failover。
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

  const aspectRatio = params.imageRatio
  const imageSize = params.resolution.toUpperCase()

  // ---- 多渠道分发 ----
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
        stage: 'photo-fission',
        providers: availableProviders.map((p) => p.id),
        shotCount: shotPlan.length,
      },
    )
  }

  // 将 shots 分发到可用 providers
  const groups = useMultiProvider
    ? dispatchItemsForModel(shotPlan, params.model)
    : new Map([[
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
          items: shotPlan,
        },
      ]])

  // 每个 provider 组独立跑一组 workers
  const allShotResults: ShotRunResult[] = new Array(shotPlan.length)
  // 需要维护 shotPlan 索引映射
  const shotIndexMap = new Map(shotPlan.map((shot, idx) => [shot.shotId, idx]))

  const groupPromises = Array.from(groups.values()).map(
    ({ provider, items: groupShots }) => {
      return runShotGroup({
        taskId,
        provider,
        shots: groupShots,
        params,
        inputImages: options.inputImages,
        apiKey: provider.apiKey || options.apiKey,
        aspectRatio,
        imageSize,
        onShotResult: options.onShotResult,
        shotIndexMap,
        allShotResults,
      })
    },
  )

  await Promise.all(groupPromises)

  // ---- 跨渠道 Failover ----
  // 收集失败的 shot，尝试用其他 provider 重跑
  if (useMultiProvider) {
    const failedShots = allShotResults
      .map((result, idx) => ({ result, shot: shotPlan[idx] }))
      .filter(
        (
          entry,
        ): entry is { result: ShotRunResult; shot: PhotoFissionShot } =>
          Boolean(entry.result?.error && !entry.result.result),
      )

    if (failedShots.length > 0) {
      const failoverGroups = new Map<
        string,
        { provider: ImageProvider; shots: PhotoFissionShot[] }
      >()

      for (const { result, shot } of failedShots) {
        const excludeProviderIds = result.providerId ? [result.providerId] : []
        const failoverProvider = getFailoverProviderForModel(
          excludeProviderIds,
          params.model,
        )
        if (!failoverProvider) continue

        const group = failoverGroups.get(failoverProvider.id) ?? {
          provider: failoverProvider,
          shots: [],
        }
        group.shots.push(shot)
        failoverGroups.set(failoverProvider.id, group)
      }

      if (failoverGroups.size > 0) {
        logImageEvent(
          'pool.failover',
          { traceId: taskId, taskId },
          {
            failedCount: failedShots.length,
            rerunCount: Array.from(failoverGroups.values()).reduce(
              (sum, group) => sum + group.shots.length,
              0,
            ),
            failoverProviders: Array.from(failoverGroups.keys()),
          },
        )

        await Promise.all(
          Array.from(failoverGroups.values()).map(({ provider, shots }) =>
            runShotGroup({
              taskId,
              provider,
              shots,
              params,
              inputImages: options.inputImages,
              apiKey: provider.apiKey,
              aspectRatio,
              imageSize,
              onShotResult: options.onShotResult,
              shotIndexMap,
              allShotResults,
            }),
          ),
        )
      }
    }
  }

  const successResults = allShotResults
    .filter(
      (entry): entry is ShotRunResult & { result: ResultAsset } =>
        Boolean(entry?.result),
    )
    .map((entry) => entry.result)

  if (!successResults.length) {
    const firstError = allShotResults.find((entry) => entry?.error)?.error
    throw new Error(
      firstError
        ? `服装大片裂变全部镜头失败：${firstError}`
        : '服装大片裂变全部镜头失败',
    )
  }

  return successResults
}

interface RunShotGroupOptions {
  taskId: string
  provider: ImageProvider
  shots: PhotoFissionShot[]
  params: PhotoFissionParams
  inputImages: string[]
  apiKey: string
  aspectRatio: string
  imageSize: string
  onShotResult?: (result: ResultAsset) => Promise<void>
  shotIndexMap: Map<string, number>
  allShotResults: ShotRunResult[]
}

/**
 * 在单个 provider 内运行一组 shots，内部使用 worker 并发模型。
 * worker 数量按 PHOTO_FISSION_CONCURRENCY 或 shots 数量取较小值。
 */
async function runShotGroup(options: RunShotGroupOptions): Promise<void> {
  const {
    taskId,
    provider,
    shots,
    params,
    inputImages,
    apiKey,
    aspectRatio,
    imageSize,
    onShotResult,
    shotIndexMap,
    allShotResults,
  } = options

  const concurrencyRaw = Number(process.env.PHOTO_FISSION_CONCURRENCY ?? 3)
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw >= 1
      ? Math.min(Math.floor(concurrencyRaw), shots.length)
      : Math.min(3, shots.length)

  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= shots.length) return

      const shot = shots[currentIndex]
      const globalIndex = shotIndexMap.get(shot.shotId)
      if (globalIndex === undefined) continue

      try {
        const single = await runImageEditViaProvider({
          taskId,
          provider,
          fallbackApiKey: apiKey,
          model: params.model,
          prompt: shot.prompt,
          inputImages,
          count: 1,
          aspectRatio,
          imageSize,
          traceId: `${taskId}_${shot.shotId}`,
          shotId: shot.shotId,
        })

        const first = single[0]
        if (!first) {
          allShotResults[globalIndex] = {
            shot,
            error: '该镜头未返回图片',
            providerId: provider.id,
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

        allShotResults[globalIndex] = {
          shot,
          result: enriched,
          providerId: provider.id,
        }

        // 流式持久化：先 await 回调把这张图写盘 + 更新 store，再启动下一个 shot。
        // 若回调本身抛错，按单 shot 失败处理，pipeline 继续。
        if (onShotResult) {
          try {
            await onShotResult(enriched)
          } catch (persistError) {
            const message =
              persistError instanceof Error ? persistError.message : '未知错误'
            logImageEvent(
              'gimg.fail',
              { traceId: `${taskId}_${shot.shotId}`, taskId, shotId: shot.shotId },
              { stage: 'persist', reason: message, providerId: provider.id },
            )
            allShotResults[globalIndex] = {
              shot,
              error: `流式持久化失败：${message}`,
              providerId: provider.id,
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        // wrapper 已经在 gimg.fail 里打过结构化日志，这里仅记录 shot 级 result 供上层 partial 判定
        allShotResults[globalIndex] = {
          shot,
          error: message,
          providerId: provider.id,
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
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
