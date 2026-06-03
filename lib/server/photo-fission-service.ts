import {
  DEFAULT_FASHION_MODEL,
  PHOTO_FISSION_CHILDRENS_CATEGORIES,
  FASHION_MODELS,
  SELECTABLE_FASHION_MODELS,
  PHOTO_FISSION_CATEGORIES,
  PHOTO_FISSION_IMAGE_RATIOS,
  PHOTO_FISSION_RESOLUTIONS,
  type FashionModelId,
  type PhotoFissionCategory,
  type PhotoFissionChildrensCategory,
  type PhotoFissionImageRatio,
  type PhotoFissionParams,
  type PhotoFissionResolution,
  type PhotoFissionResultCount,
  type PhotoFissionShot,
  type ResultAsset,
} from '@/lib/types'
import {
  dispatchItemsForModel,
  getAvailableProvidersForModel,
  getFailoverProviderForModel,
  getNoAvailableProviderMessage,
  type ImageProvider,
} from './image-provider-pool'
import { logImageEvent } from './log'
import {
  getChildrensCategoryAngleControl,
  getChildrensCategoryNegativeAddon,
  getChildrensCategoryOutdoorScene,
  getChildrensCategoryShotBlueprint,
  getChildrensCategoryShotBlueprintForCount,
  getChildrensCategoryStyleAnchor,
} from './prompt-templates/childrens-dress'
import {
  getSuitShotBlueprintForCount,
  SUIT_ACTION_CONTROL,
  SUIT_CATEGORY_REQUIREMENT,
  SUIT_NEGATIVE_ADDON,
  SUIT_OUTDOOR_SCENE,
  SUIT_STYLE_ANCHOR,
} from './prompt-templates/suit-planner-system'
import { appendFlatDetailReferenceLock } from './fission-flat-detail-lock'
import { applyManualFaceMask } from './manual-face-mask'
import { buildPlannerRulePlan } from './photo-fission-rule-engine'
import {
  invokeShotPlanner,
  ShotPlannerError,
} from './photo-fission-shot-planner'
import { runImageEditViaProvider } from './provider-image-router'

const photoFissionCategoryIds = new Set<PhotoFissionCategory>(
  PHOTO_FISSION_CATEGORIES.map((option) => option.id),
)
const photoFissionChildrensCategoryIds = new Set<PhotoFissionChildrensCategory>(
  PHOTO_FISSION_CHILDRENS_CATEGORIES.map((option) => option.id),
)
const photoFissionImageRatioIds = new Set<PhotoFissionImageRatio>(
  PHOTO_FISSION_IMAGE_RATIOS.map((option) => option.id),
)
const photoFissionResolutionIds = new Set<PhotoFissionResolution>(
  PHOTO_FISSION_RESOLUTIONS.map((option) => option.id),
)
const fashionModelIds = new Set<FashionModelId>(
  SELECTABLE_FASHION_MODELS.map((option) => option.id),
)

const photoFissionCategoryLabelMap = new Map(
  PHOTO_FISSION_CATEGORIES.map((option) => [option.id, option.label]),
)
const photoFissionChildrensCategoryLabelMap = new Map(
  PHOTO_FISSION_CHILDRENS_CATEGORIES.map((option) => [option.id, option.label]),
)

const SUIT_ACTION_HISTORY_GENERATIONS = 3
const DRESS_ACTION_HISTORY_GENERATIONS = 3
const recentSuitActionHistoryByKey = new Map<string, string[][]>()
const recentDressActionHistoryByKey = new Map<string, string[][]>()
const DEFAULT_PHOTO_FISSION_CONCURRENCY = 3

function buildFaceIdSimilarityGuard(faceIdImageIndex: number): string {
  return [
    `人像小卡相似度是脸部最高优先级：输出人物第一眼必须能被识别为图${faceIdImageIndex}人像小卡里的同一张脸，而不是只保留性别、年龄、肤色或大概气质。`,
    `不要生成通用 AI 脸、网红脸、娃娃脸、过度美颜脸、成人化脸或“更漂亮但不像图${faceIdImageIndex}”的脸；不要把图1原脸和图${faceIdImageIndex}混合成第三张陌生脸。`,
    `即使是远景或动作镜头，也要保持图${faceIdImageIndex}的脸型骨架、眼鼻嘴眉比例、下颌线、颧骨和面部立体关系；脸部必须清晰自然，不能糊脸、低清、塑料皮或过度磨皮。`,
  ].join('\n')
}

type PlannerPromptCard = {
  role: string
  imagePrompt: string
}

const SUIT_LEG_VARIATION_FALLBACKS = [
  '脚步设计为一前一后轻错开，前脚脚尖轻点地面，膝盖自然放松',
  '一只脚向侧前方小幅伸出，脚尖微微外点，后脚稳定承重',
  '双腿在脚踝附近轻微交叉，鞋子和裤脚完整可见',
  '前脚脚尖微微翘起，后脚落地承重，身体重心自然偏向一侧',
  '呈轻微走姿，前脚刚落地，后脚脚跟轻抬',
  '一脚向后半步，脚尖轻向外，双膝自然放松',
  '一脚斜向前点地，另一脚支撑，裤脚线条清楚',
  '双脚距离自然错开，身体重心落在一侧，腿部线条更有层次',
  '一脚脚跟轻轻抬起，脚尖仍贴地，动作小幅真实',
  '前后脚形成小角度站位，裤长、裤脚和鞋型完整露出',
] as const

const SUIT_BACK_LEG_VARIATION =
  '背面展示时一脚向后半步或脚尖轻向外，双膝放松，头部顺着身体方向，不回眸也不回头看镜头'

const SUIT_FACE_QUALITY_GUARD =
  '表情优先参考童装电商模特的自然笑容：元气轻露齿笑必须牙齿完整、自然、数量正常，乖巧闭嘴浅笑要嘴角柔和、眼神清亮；单眨眼允许但必须自然可爱，一只眼自然完整轻闭、另一只眼清亮睁开，眼周放松不挤眉，脸型五官不变，禁止半闭眼、失败 wink 和大小眼。不确定牙齿状态时优先闭嘴浅笑、轻抿笑或小惊喜口型，绝不能生成缺牙、乱牙、黑洞牙、多牙、歪嘴或僵硬假笑。'

const DRESS_POSE_FACE_QUALITY_GUARD =
  '连衣裙姿势与表情补充要求：不管生成几张图，都不能出现手插兜、双手一起比 OK、一批图多张重复 OK、反关节、脖子过度扭转或不符合正常人的姿势；单手自然 OK 可以少量出现但不能遮挡服装，头部转动只保留自然生理范围内的小幅角度。若图1主图里已有手拿小包、单肩包、草帽、眼镜、咖啡杯 / 饮品杯、花束或发饰，必须作为原始穿搭搭配低存在感保留，可移到身体侧边、手部低位或画面边缘避免遮挡连衣裙，但不能让这些参考图已有配饰消失。若露齿，牙齿必须完整自然、数量正常、排列整齐好看；不确定时优先闭嘴浅笑、轻抿笑或小惊喜口型。'

const SUIT_LEG_CUE_PATTERN =
  /脚尖|脚跟|前脚|后脚|一脚|单脚|双腿[^。；，,]*交叉|脚踝|轻微走姿|错开|点地|微翘|承重|半步|脚[^。；，,]*外/

/**
 * 一级品类专属保持要求文案（PRD 第 5.5 节）。
 */
const categoryRequirementMap: Record<PhotoFissionCategory, string> = {
  childrens: '保持儿童体型比例、童装版型宽松度与亲和感；避免成人化处理',
}

const childrensCategoryRequirementMap: Record<
  PhotoFissionChildrensCategory,
  string
> = {
  dress:
    '童装连衣裙品类规则：这是一张可直接用于淘宝/天猫上架的童装连衣裙商品图，连衣裙是画面第一主体；保持连衣裙结构，有明确上身与裙身连接关系，裙长、腰线、裙摆弧度、下摆层次、自然蓬度和整体廓形清楚可见，不能生成成裤装、瑜伽裤、紧身裤或贴腿包裹的下装。动作常量：正面全身站立、三分之二站姿、轻拉裙摆、轻提裙摆、坐姿铺开裙摆；动作轻柔克制，只服务商品展示。人物手臂、头发、腿脚、道具和任何参考图已有配饰都不能遮挡连衣裙主体，不能挡住领口、腰线、版型结构、裙摆弧度、下摆层次和面料细节；图1已有手拿小包、单肩包、草帽、眼镜、咖啡杯 / 饮品杯、花束或发饰时，作为原始穿搭搭配保留并放低存在感，不能凭空消失。表情常量：自然甜美、可爱亲切、看镜头浅笑，避免夸张表演。',
  suit: SUIT_CATEGORY_REQUIREMENT,
}

export function normalizePhotoFissionParams(
  params: unknown,
  inputAssetCount: number,
  inputAssetIds: readonly string[] = [],
): PhotoFissionParams {
  if (!isRecord(params)) {
    throw new Error('服装大片裂变参数格式错误')
  }

  const model = readFashionModel(params.model)
  const category = readPhotoFissionCategory(params.category)
  const childrensCategory =
    category === 'childrens'
      ? readPhotoFissionChildrensCategory(params.childrensCategory)
      : undefined
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
  const resultCount = readResultCount(params.resultCount)
  const plannerReasoningEnabled = readOptionalBoolean(
    params.plannerReasoningEnabled,
    false,
    '服装大片裂变推理模式参数无效',
  )

  const faceIdModelId =
    typeof params.faceIdModelId === 'string' && params.faceIdModelId.trim()
      ? params.faceIdModelId.trim()
      : null
  const faceMaskAssetId =
    typeof params.faceMaskAssetId === 'string' && params.faceMaskAssetId.trim()
      ? params.faceMaskAssetId.trim()
      : null
  if (faceIdModelId && !faceMaskAssetId) {
    throw new Error('请先涂抹主图五官区域')
  }

  const expectedAssetCount =
    1 + (hasFrontDetail ? 1 : 0) + (hasBackDetail ? 1 : 0) + (faceIdModelId ? 1 : 0)
  if (inputAssetCount !== expectedAssetCount) {
    throw new Error('服装大片裂变素材数量与细节图参数不一致')
  }

  const shotPlan = buildPhotoFissionShotPlan({
    category,
    childrensCategory,
    imageRatio,
    resolution,
    hasFrontDetail,
    hasBackDetail,
    resultCount,
    hasFaceIdModel: Boolean(faceIdModelId),
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
    childrensCategory,
    hasFrontDetail,
    hasBackDetail,
    imageRatio,
    resolution,
    shotPlan,
    resultCount,
    referenceAssetKey: buildPhotoFissionReferenceAssetKey(inputAssetIds),
    faceIdModelId,
    faceMaskAssetId,
    plannerReasoningEnabled,
  }
}

export interface PhotoFissionShotPlanInput {
  category: PhotoFissionCategory
  childrensCategory?: PhotoFissionChildrensCategory
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  hasFrontDetail: boolean
  hasBackDetail: boolean
  resultCount: PhotoFissionResultCount
  /** Whether a portrait card (face ID model) is selected for facial feature locking */
  hasFaceIdModel: boolean
}

type PhotoFissionShotScene = 'reference' | 'outdoor'

/**
 * 构造 N 张 shotPlan（N = input.resultCount）。
 *
 * 场景分布由 blueprint 的 scene 字段控制：
 * - 2/4 张：全 reference（无外景）
 * - 9 张：7 reference + 2 outdoor（向后兼容）
 * - 10 张：8 reference + 2 outdoor
 *
 * v5 LLM Planner 对 2 / 4 / 9 / 10 张童装连衣裙路径全部启用（见 applyShotPlannerOverride）。
 */
export function buildPhotoFissionShotPlan(
  input: PhotoFissionShotPlanInput,
): PhotoFissionShot[] {
  let activeBlueprint: ReadonlyArray<{
    label: string
    description: string
    scene?: PhotoFissionShotScene
  }> | undefined

  if (input.category === 'childrens') {
    if (!input.childrensCategory) {
      throw new Error('服装大片裂变童装品类无效')
    }
    // 优先使用按数量构建的 blueprint
    if (input.childrensCategory === 'suit') {
      activeBlueprint = getSuitShotBlueprintForCount(input.resultCount)
    } else {
      const countAwareBlueprint = getChildrensCategoryShotBlueprintForCount(
        input.childrensCategory,
        input.resultCount,
      )
      const fallbackBlueprint = getChildrensCategoryShotBlueprint(
        input.childrensCategory,
      )
      activeBlueprint = countAwareBlueprint ?? fallbackBlueprint
    }
  }

  if (!activeBlueprint) {
    throw new Error('服装大片裂变服装品类无效')
  }

  // Face ID image is always the last item in inputImages.
  // Image index = 1(main) + (front?1:0) + (back?1:0) + 1
  const faceIdImageIndex = input.hasFaceIdModel
    ? 1 + (input.hasFrontDetail ? 1 : 0) + (input.hasBackDetail ? 1 : 0) + 1
    : undefined

  return activeBlueprint.map((blueprint, index) => {
    const shotId = `shot_${index + 1}`
    const order = index + 1
    const prompt = buildShotPrompt({
      label: blueprint.label,
      shotDescription: blueprint.description,
      shotIndex: index,
      shotScene: blueprint.scene,
      category: input.category,
      childrensCategory: input.childrensCategory,
      imageRatio: input.imageRatio,
      resolution: input.resolution,
      hasFrontDetail: input.hasFrontDetail,
      hasBackDetail: input.hasBackDetail,
      hasFaceIdModel: input.hasFaceIdModel,
      faceIdImageIndex,
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
  shotIndex: number
  shotScene?: PhotoFissionShotScene
  category: PhotoFissionCategory
  childrensCategory?: PhotoFissionChildrensCategory
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  hasFrontDetail: boolean
  hasBackDetail: boolean
  /** Whether a portrait card is selected for facial feature locking */
  hasFaceIdModel: boolean
  /** 1-based image index of the portrait card in inputImages */
  faceIdImageIndex?: number
}

function buildShotPrompt(input: BuildShotPromptInput): string {
  const orientation = getCompositionOrientation(input.imageRatio)
  const sections: string[] = [
    buildTaskSection({
      label: input.label,
      orientation,
      shotScene: input.shotScene,
      category: input.category,
      childrensCategory: input.childrensCategory,
      hasFaceIdModel: input.hasFaceIdModel,
    }),
    '',
    buildReferenceImagesSection({
      hasFrontDetail: input.hasFrontDetail,
      hasBackDetail: input.hasBackDetail,
      shotScene: input.shotScene,
      category: input.category,
      childrensCategory: input.childrensCategory,
      hasFaceIdModel: input.hasFaceIdModel,
      faceIdImageIndex: input.faceIdImageIndex,
    }),
    '',
    buildIdentityLockSection(input.hasFaceIdModel, input.faceIdImageIndex),
    '',
    buildWardrobeLockSection(),
    '',
    buildSceneLockSection(orientation, input.shotScene, input.category, input.childrensCategory),
    '',
    buildLightingLockSection(input.shotScene, input.category, input.childrensCategory),
    '',
    buildStyleLockSection(
      input.shotDescription,
      input.shotScene,
      input.category,
      input.childrensCategory,
    ),
    '',
    buildAngleControlSection(input.category, input.childrensCategory),
    '',
    buildShotSection(input.label, input.shotDescription),
    '',
    buildCategoryLockSection(input.category, input.childrensCategory),
    '',
    buildAnatomySection(),
    '',
    buildOutputParamsSection(
      input.category,
      input.childrensCategory,
      input.imageRatio,
      input.resolution,
      orientation,
    ),
    '',
    buildNegativeSection(input.category, input.childrensCategory, input.hasFaceIdModel, input.faceIdImageIndex),
  ]

  // 过滤掉条件性 section 返回空字符串的占位（保持 prompt 紧凑）
  return sections.filter((line, index, arr) => {
    if (line !== '') return true
    // 空行只在前后都有非空内容时保留
    const prev = arr[index - 1]
    const next = arr[index + 1]
    return prev !== '' && next !== undefined && next !== ''
  }).join('\n')
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
 * 棚拍/室内 shot 默认不注入电影前缀，避免对主图引入不必要的镜头痕迹；
 * shotDescription 若带外景关键词则会自动启用。
 */
function shouldUseCinematicPrefix(shotDescription: string): boolean {
  return /户外|街拍|海边|海岸|海滩|帆船|古典建筑|欧洲街角|罗马|沿河/.test(
    shotDescription,
  )
}

function buildTaskSection(input: {
  label: string
  orientation: string
  shotScene?: PhotoFissionShotScene
  category: PhotoFissionCategory
  childrensCategory?: PhotoFissionChildrensCategory
  hasFaceIdModel?: boolean
}): string {
  const { label, orientation, shotScene, category, childrensCategory, hasFaceIdModel } = input
  const faceIdNote = hasFaceIdModel ? '；面部全部特征（脸型+五官）以人像小卡为唯一基准，不参照主图' : ''
  if (isSuitChildrensOutdoorShot(category, childrensCategory, shotScene)) {
    return [
      `本次任务：生成同一个人、同一套童装套装的【${label}】单张镜头。`,
      `画面是一张写实风格的童装套装电商外景补充图，采用${orientation}，主体人物（参考第一张主图的同一个人，身材比例、肤色、年龄感与发型保持一致${faceIdNote}）居中或轻微居中，人物和套装是绝对主体。`,
      '受控裂变：保持人物身份与这套上衣裤装套装统一；当前镜头按童装套装抽卡规则使用晴朗夏日蓝天绿草地真实外景，场景不出现白云，动作、构图与留白都服务于商品上架展示。',
      '输出单张完整图片，不要多宫格拼接。',
    ].join('\n')
  }
  if (isDressChildrensOutdoorShot(category, childrensCategory, shotScene)) {
    return [
      `本次任务：生成同一个人、同一套服装的【${label}】单张镜头。`,
      `画面是一张写实风格的童装连衣裙电商外景补充图，采用${orientation}，主体人物（参考第一张主图的同一个小女孩，身材比例、肤色与发型保持一致${faceIdNote}）居中或轻微居中，人物和连衣裙是绝对主体。`,
      '受控裂变：保持人物身份与这套连衣裙统一；当前镜头按童装连衣裙抽卡规则使用无云蓝天草地外景，场景不能出现云，动作、构图与留白都服务于商品上架展示。',
      '输出单张完整图片，不要多宫格拼接。',
    ].join('\n')
  }
  if (category === 'childrens' && childrensCategory === 'dress') {
    return [
      `本次任务：生成同一个小女孩、同一套童装连衣裙的【${label}】单张镜头。`,
      `画面是一张写实风格的童装连衣裙电商上架图，采用${orientation}，主体人物（参考第一张主图的同一个小女孩，身材比例、肤色与发型保持一致${faceIdNote}）居中或轻微居中，人物和连衣裙是绝对主体。`,
      '受控裂变：当前镜头来自童装连衣裙商品展示抽卡池；保持人物身份、这套连衣裙、参考拍摄环境基调与光线统一，动作和构图都服务于卖货与测流量。',
      '输出单张完整图片，不要多宫格拼接。',
    ].join('\n')
  }
  if (isSuitChildrensCategory(category, childrensCategory)) {
    return [
      `本次任务：生成同一个人、同一套套装的【${label}】单张镜头。`,
      `画面是一张写实风格的套装电商上架图，采用${orientation}，主体人物（参考第一张主图的同一个人，身材比例、肤色、年龄感与发型保持一致${faceIdNote}）居中或轻微居中，人物和套装是绝对主体。`,
      '受控裂变：只调整镜头角度、景别、姿势、表情与构图；保持人物身份、上衣与裤装的成套关系、原背景、原光线和原画面风格统一。',
      '输出单张完整图片，不要多宫格拼接。',
    ].join('\n')
  }
  return [
    `本次任务：生成同一个人、同一套服装、同一场景的【${label}】单张镜头。`,
    `画面是一张写实风格的电商服装大片摄影作品，采用${orientation}，主体人物（参考第一张主图的同一个人，身材比例、肤色与发型保持一致${faceIdNote}）位于画面中央，以"三分法"构图原则布局。`,
    '受控裂变：只调整镜头角度、景别、姿势与构图；保持人物身份、这套服装、原场景与光线统一。',
    '输出单张完整图片，不要多宫格拼接。',
  ].join('\n')
}

function buildReferenceImagesSection(input: {
  hasFrontDetail: boolean
  hasBackDetail: boolean
  shotScene?: PhotoFissionShotScene
  category: PhotoFissionCategory
  childrensCategory?: PhotoFissionChildrensCategory
  hasFaceIdModel: boolean
  faceIdImageIndex?: number
}): string {
  const {
    hasFrontDetail,
    hasBackDetail,
    shotScene,
    category,
    childrensCategory,
    hasFaceIdModel,
    faceIdImageIndex,
  } = input
  const isDressOutdoorShot = isDressChildrensOutdoorShot(
    category,
    childrensCategory,
    shotScene,
  )
  const isSuitOutdoorShot = isSuitChildrensOutdoorShot(
    category,
    childrensCategory,
    shotScene,
  )
  // 五官锁定模式：图1不再承载五官/身份，只提供穿搭、发型、场景与光线
  let mainImageLine: string
  if (hasFaceIdModel) {
    mainImageLine = isDressOutdoorShot
      ? '- 图1：主图基准（这套连衣裙的视觉锚点，承载穿搭比例、发型、发饰、服装款式、面料质感与商品细节；五官特征不从此图读取，以人像小卡为准）'
      : isSuitOutdoorShot
        ? '- 图1：主图基准（这套童装套装的视觉锚点，承载穿搭比例、发型、发饰、上衣裤装成套关系、面料质感与商品细节；五官特征不从此图读取，以人像小卡为准）'
        : '- 图1：主图基准（这套服装的视觉锚点，承载穿搭比例、发型、发饰、服装细节、场景与光线；五官特征不从此图读取，以人像小卡为准）'
  } else {
    mainImageLine = isDressOutdoorShot
      ? '- 图1：主图基准（这套连衣裙与这位小女孩的视觉锚点，承载人物身份、服装款式、面料质感与商品细节；当前镜头抽中无云蓝天草地外景卡，场景不能出现云）'
      : isSuitOutdoorShot
        ? '- 图1：主图基准（这套童装套装与这位模特的视觉锚点，承载人物身份、上衣裤装成套关系、面料质感与商品细节；当前镜头抽中晴朗夏日蓝天绿草地真实外景补充卡，场景不出现白云）'
        : '- 图1：主图基准（这套服装与这位模特的视觉锚点，承载身份、服装、场景、光线的全部细节）'
  }
  const lines: string[] = [
    '【参考图说明】',
    mainImageLine,
  ]
  let nextIndex = 2
  if (hasFrontDetail) {
    lines.push(
      `- 图${nextIndex}：这套服装的正面细节参考（颜色、材质、面料质感、领口、扣件、logo、图案、纽扣、口袋细节以此为准）`,
    )
    nextIndex += 1
  }
  if (hasBackDetail) {
    lines.push(
      `- 图${nextIndex}：这套服装的背面细节参考（背部颜色、材质、面料质感、剪裁、印花、肩线、背部扣件以此为准）`,
    )
    nextIndex += 1
  }
  if (hasFaceIdModel) {
    lines.push(
      `- 图${nextIndex}：人像小卡——仅作为脸部核心特征参考（五官细节、脸型轮廓、下颌线、颧骨、面部比例与皮肤质感）。图1仍然提供帽子、发型、发饰、发色、头发长度、穿搭比例、服装细节、手持包和整体拍摄环境；不要用图${nextIndex}替换图1的头发、帽子、发饰或穿搭。`,
    )
  }
  return lines.join('\n')
}

function buildIdentityLockSection(
  hasFaceIdModel: boolean,
  faceIdImageIndex?: number,
): string {
  if (hasFaceIdModel && faceIdImageIndex) {
    return [
      '【人物呈现 IDENTITY — 五官脸型锁定模式】',
      '画面中的人物是图1里的同一个人。身材比例、帽子、发型、发色、发饰、头发长度、手持包、服装穿搭、肤色倾向与年龄感与图1保持一致。',
      `图${faceIdImageIndex}人像小卡只提供脸部核心特征，不提供帽子、发型、发饰、服装或穿搭。面部全部特征必须严格参考图${faceIdImageIndex}，但头发、帽子和发饰仍以图1为准。具体复刻维度：`,
      buildFaceIdSimilarityGuard(faceIdImageIndex),
      `- 脸型：脸的形状（圆脸/方脸/鹅蛋脸/瓜子脸等）、下颌线弧度、颧骨高低、额头宽窄与发际线形状、下巴长短与尖圆、两腮宽窄`,
      `- 五官：眼形（包括双眼皮/单眼皮、眼角方向、眼睛大小与间距）、鼻型（鼻梁高低、鼻头大小、鼻翼宽窄）、嘴形（嘴唇厚薄、嘴角方向、嘴的大小）、眉形（眉毛粗细、弧度、浓淡）、耳朵形状`,
      `- 面部比例：五官在脸上的位置关系（三庭五眼比例）、面部立体感`,
      `- 面部皮肤质感：严格复刻图${faceIdImageIndex}的皮肤质感——脸部毛孔清晰可见、皮肤纹理细腻真实、面部光泽感与高光分布与图${faceIdImageIndex}一致，不添加磨皮或过度柔化效果，保留皮肤的天然肌理和真实感`,
      `- 表情丰富度：表情自然多变且生动，可以展现微笑、开朗、专注、俏皮、好奇、惊喜、温柔等各种自然表情，每种表情都要确保五官细节（眼角弯度、嘴角弧度、眉毛舒展度）与图${faceIdImageIndex}的基础特征一致，但表情本身要自然流畅不僵硬`,
      '脸型骨骼结构和五官细节绝对不能改变，但表情和神态应当丰富自然，避免千篇一律的固定微笑。',
      `绝对规则：脸型、五官、皮肤质感和面部比例全部以图${faceIdImageIndex}为准；帽子、发型、发饰、发色、头发长度、手持包和服装穿搭全部以图1为准。`,
      `【头部穿搭强制锁定】图1如果有帽子（鸭舌帽、渔夫帽、贝雷帽、毛线帽、草帽等任何帽子），必须在生成图中完整保留，包括帽子的款式、颜色、材质、佩戴方式和位置；图1如果有特殊发型（马尾、丸子头、双马尾、编发、发髻等），必须完整保留发型结构、高度和蓬松度；图1如果有发饰（发带、发卡、发箍、蝴蝶结等），必须完整保留发饰的款式、颜色和佩戴位置。绝对不能因为图${faceIdImageIndex}没有这些元素就让它们消失。`,
    ].join('\n')
  }
  return [
    '【人物呈现 IDENTITY】',
    '画面中的人物是图1里的同一个人，身材比例、发型、发色、肤色与年龄感与图1保持一致；面部特征延续图1，神情自然、状态放松。',
    '面部皮肤质感要求：脸部毛孔清晰可见、皮肤纹理细腻真实，不添加磨皮或过度柔化效果，保留皮肤的天然肌理和真实感。表情丰富自然，避免千篇一律。',
  ].join('\n')
}

function buildWardrobeLockSection(): string {
  return [
    '【服装呈现 WARDROBE】',
    '人物穿着这套服装，完整延续这套服装的版型、图案、logo、纽扣、口袋、领口、袖口与下摆细节。',
    '颜色、材质、面料质感的参考优先级：如果有正面/背面细节图，颜色、材质、面料质感以细节图为准；如果没有细节图，才以图1主图为准。',
    '衣物纹理、面料质感、印花与配饰清晰可见，不增加、不减少、不替换任何服装元素。',
    '如果图1主图里已有手拿小包、单肩包、草帽、眼镜、咖啡杯 / 饮品杯、花束、发饰等随身配饰或小道具，必须作为原始穿搭搭配保留，延续参考图中的佩戴/拿取关系；可为避免遮挡服装而放到身体侧边、手部低位或画面边缘，但不能让这些已有配饰消失。',
  ].join('\n')
}

function buildSceneLockSection(
  orientation: string,
  shotScene: PhotoFissionShotScene | undefined,
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string {
  // 童装抽卡命中 outdoor 场景时使用对应品类的外景补充图。
  if (isDressChildrensOutdoorShot(category, childrensCategory, shotScene)) {
    const outdoorScene = getChildrensCategoryOutdoorScene(childrensCategory)
    if (outdoorScene) {
      return outdoorScene
    }
  }
  if (isSuitChildrensOutdoorShot(category, childrensCategory, shotScene)) {
    return SUIT_OUTDOOR_SCENE
  }
  if (category === 'childrens' && childrensCategory === 'dress') {
    return [
      '【场景呈现 SCENE】',
      `背景、环境与图1完全一致，不改变背景内容、色调和材质，光线方向、色温与高光分布与图1保持一致，整体画面保持${orientation}下的童装连衣裙电商上架图调性。`,
      '无论图1是白底棚拍、室内场景、户外草地还是其他环境，都必须与图1保持相同的背景，不能简化、弱化或替换。',
      '背景不能抢走连衣裙主体，不主动新增沙发、绘本、玩具、窗帘、绿植、包包、帽子或其它生活道具；但图1已有的手拿小包、单肩包、草帽、眼镜、咖啡杯 / 饮品杯、花束或发饰要作为低存在感商品搭配保留，不遮挡裙子主体。画面要方便美工裁切、排版和上架使用。',
    ].join('\n')
  }
  if (isSuitChildrensCategory(category, childrensCategory)) {
    return [
      '【场景呈现 SCENE】',
      `背景、环境与图1完全一致，不改变背景内容、色调和材质，光线方向、色温与高光分布与图1保持一致，整体保持${orientation}下干净明确的套装商品图调性。`,
      '无论图1是白底棚拍、室内场景还是其他环境，都必须与图1保持相同的背景，不能简化、弱化或替换。',
      '如果图1已有小包、鞋子、花束等道具，只作为低存在感商品搭配保留；如果图1没有，不主动新增。不要新增复杂家具、街景、人群、文字背景或生活故事场景。',
      '背景不能抢走套装主体，画面要方便美工裁切、排版和上架使用。',
    ].join('\n')
  }
  return [
    '【场景呈现 SCENE】',
    `背景延续图1的房间/空间与陈设（墙面、地板、家具、灯具、植物、道具均与图1一致），整体画面保持${orientation}下的电商主图调性，主体清晰突出。`,
    '镜头可以拉近或拉远以适配新景别，但所处空间与图1是同一处。',
  ].join('\n')
}

function buildLightingLockSection(
  shotScene: PhotoFissionShotScene | undefined,
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string {
  if (isDressChildrensOutdoorShot(category, childrensCategory, shotScene)) {
    return [
      '【光线呈现 LIGHTING】',
      '光线为明亮柔和的户外自然光，均匀打亮小女孩和连衣裙；无云蓝天与草地保持清爽通透，人物面部、裙身细节和脚底接触阴影都清楚自然，无强烈硬阴影。',
    ].join('\n')
  }
  if (isSuitChildrensOutdoorShot(category, childrensCategory, shotScene)) {
    return [
      '【光线呈现 LIGHTING】',
      '光线为柔和自然的户外散射光，均匀打亮模特和童装套装；避免正午硬光、强烈顶光、过锐高反差、过曝皮肤和假亮草地。天空与草地保持真实清爽，人物面部、上衣下摆、裤装轮廓、裤脚、鞋子和脚底接触阴影都清楚自然。',
    ].join('\n')
  }
  if (isSuitChildrensCategory(category, childrensCategory)) {
    return [
      '【光线呈现 LIGHTING】',
      '光线沿用图1的光源方向、色温、阴影走向与高光分布；人物和套装清楚自然，上衣面料、裤装轮廓、裤脚、鞋子和参考图已有道具都保持可见，无新增棚拍光效。',
    ].join('\n')
  }
  return [
    '【光线呈现 LIGHTING】',
    '光线为柔和均匀的自然光，沿用图1的光源方向、色温、阴影走向与高光分布；无强烈硬阴影，光线统一、画面亮度通透。',
  ].join('\n')
}

function isDressChildrensOutdoorShot(
  category: PhotoFissionCategory,
  childrensCategory: PhotoFissionChildrensCategory | undefined,
  shotScene: PhotoFissionShotScene | undefined,
): childrensCategory is PhotoFissionChildrensCategory {
  return category === 'childrens' && childrensCategory === 'dress' && shotScene === 'outdoor'
}

function isSuitChildrensOutdoorShot(
  category: PhotoFissionCategory,
  childrensCategory: PhotoFissionChildrensCategory | undefined,
  shotScene: PhotoFissionShotScene | undefined,
): childrensCategory is 'suit' {
  return category === 'childrens' && childrensCategory === 'suit' && shotScene === 'outdoor'
}

function isSuitChildrensCategory(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): childrensCategory is 'suit' {
  return category === 'childrens' && childrensCategory === 'suit'
}

function isDressChildrensCategory(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): childrensCategory is 'dress' {
  return category === 'childrens' && childrensCategory === 'dress'
}

function buildStyleLockSection(
  shotDescription: string,
  shotScene: PhotoFissionShotScene | undefined,
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string {
  const cinematicPrefix = shouldUseCinematicPrefix(shotDescription)
    ? 'Arricam LT, Cooke Panchro, 50mm, f1.4。'
    : ''
  if (category === 'childrens' && childrensCategory === 'dress') {
    const styleSummary = isDressChildrensOutdoorShot(
      category,
      childrensCategory,
      shotScene,
    )
      ? '专业儿童电商时尚外景摄影，4K 超清质感，自然明亮的户外柔光均匀打亮人物和服装；画面清爽干净，面料质感、商品细节和裙身轮廓清楚，整体像可直接上架的童装连衣裙外景补充素材。'
      : '专业儿童电商时尚摄影，4K 超清质感，影棚柔和柔光，光线均匀打亮人物和服装；画面干净柔和，面料质感、商品细节和裙身轮廓清楚，整体像可直接上架的童装连衣裙商品素材。'
    const lines = [
      '【画面质感 STYLE】',
      styleSummary,
    ]
    const anchor = getChildrensCategoryStyleAnchor(childrensCategory)
    if (anchor) {
      lines.push(anchor)
    }
    return lines.join('\n')
  }
  if (isSuitChildrensCategory(category, childrensCategory)) {
    const styleSummary = isSuitChildrensOutdoorShot(
      category,
      childrensCategory,
      shotScene,
    )
      ? '专业儿童电商套装真实外景摄影，4K 清晰但柔和的质感，自然户外散射光均匀打亮人物和套装；晴朗夏日蓝天和真实绿草地只作为清爽低存在感陪衬，场景不出现白云，草地避免塑料草坪、假草皮、重复贴图和过饱和荧光绿，上衣廓形、下摆、裤长、裤脚、鞋型和成套比例清楚，整体像可直接用于淘宝轮播图或详情页的童装套装外景补充素材。'
      : '专业电商套装摄影，4K 超清质感，背景、光线和画面风格沿用图1；通过姿态和构图突出上衣廓形、裤装轮廓、裤长裤脚、鞋子和成套比例，整体像可直接上架的套装商品素材。'
    return [
      '【画面质感 STYLE】',
      styleSummary,
      SUIT_STYLE_ANCHOR,
    ].join('\n')
  }
  const lines = [
    '【画面质感 STYLE】',
    `${cinematicPrefix}写实风格摄影，色彩饱和度适中，细节丰富，衣物纹理与面料质感清晰可见，具有电影感的逼真渲染效果，整体氛围接近时尚杂志的经典大片风格。`,
  ]
  // 童装二级品类有专属灵性气质锚点时，追加到 STYLE 段尾部
  if (category === 'childrens' && childrensCategory) {
    const anchor = getChildrensCategoryStyleAnchor(childrensCategory)
    if (anchor) {
      lines.push(anchor)
    }
  }
  return lines.join('\n')
}

/**
 * 角度差异化铁律段：只在童装二级品类有专属规则时输出。
 * 用于强制 9 shot 角度分布不雷同，避免当前裂变 9 shot 偏 45° 雷同的痛点。
 */
function buildAngleControlSection(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string {
  if (isSuitChildrensCategory(category, childrensCategory)) {
    return SUIT_ACTION_CONTROL
  }
  if (category !== 'childrens' || !childrensCategory) {
    return ''
  }
  return getChildrensCategoryAngleControl(childrensCategory) ?? ''
}

function buildShotSection(label: string, shotDescription: string): string {
  const isBackShot = /背面|侧后|背后|背部|不露脸/.test(label + shotDescription)
  const backNote = isBackShot
    ? '；头部顺着身体方向自然朝前，不回眸、不回头看镜头，脸部不露出或只露极少侧缘'
    : ''
  return [
    '【当前镜头 SHOT】',
    `${label}（采用对应景别的平视构图）：${shotDescription}${backNote}。`,
  ].join('\n')
}

function buildCategoryLockSection(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string {
  const lines = ['【品类呈现重点】']
  // 当前仅保留童装路径，儿童气质引导语始终输出。
  if (category === 'childrens') {
    lines.push(
      '本功能面向童装商拍，整体保持儿童年龄感、童装亲和感与自然真实的儿童姿态，避免成人化表达。',
    )
  }
  lines.push(categoryRequirementMap[category])
  if (category === 'childrens' && childrensCategory) {
    lines.push(childrensCategoryRequirementMap[childrensCategory])
  }
  // 鞋子保持要求
  lines.push('鞋子要求：图1主图如有鞋子，所有生成图中必须保留同款鞋子，不能赤脚、不能换鞋、不能截断到看不见鞋。')
  return lines.join('\n')
}

function buildPhotoFissionCategoryLabel(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): string {
  const categoryLabel = photoFissionCategoryLabelMap.get(category) ?? category
  if (category !== 'childrens' || !childrensCategory) {
    return categoryLabel
  }
  const childLabel =
    photoFissionChildrensCategoryLabelMap.get(childrensCategory) ??
    childrensCategory
  return `${categoryLabel}/${childLabel}`
}

function buildAnatomySection(): string {
  return [
    '【人体解剖 ANATOMY】',
    '手指数量正确（每只手 5 指），手腕、肘部、肩部、颈部、膝盖姿态自然真实，人体比例与图1一致。',
  ].join('\n')
}

function buildOutputParamsSection(
  category: PhotoFissionCategory,
  childrensCategory: PhotoFissionChildrensCategory | undefined,
  imageRatio: PhotoFissionImageRatio,
  resolution: PhotoFissionResolution,
  orientation: string,
): string {
  const categoryLabel = buildPhotoFissionCategoryLabel(
    category,
    childrensCategory,
  )
  return [
    '【输出参数】',
    `画面比例：${imageRatio}（${orientation}）；分辨率档位：${resolution}；品类：${categoryLabel}。`,
    '输出单张完整图片。',
  ].join('\n')
}

function buildNegativeSection(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
  hasFaceIdModel?: boolean,
  faceIdImageIndex?: number,
): string {
  const faceConstraint = hasFaceIdModel && faceIdImageIndex
    ? `面部核心特征（脸型形状、下颌线、颧骨、五官细节、面部比例）以图${faceIdImageIndex}人像小卡为唯一基准；帽子、发型、发饰、发色、头发长度、手持包和服装穿搭必须从图1主图保留，不可被图${faceIdImageIndex}的人像小卡替换。`
    : '不改变人物的脸部特征与发型；'
  const lines = [
    '【关键约束】',
    `不改变这套服装的颜色、版型、材质、图案与 logo；${faceConstraint}画面场景按当前镜头的 SCENE 段执行并保持风格一致。`,
    '不要生成：文字、水印、品牌印章、多余人物、多宫格拼接，不要变成卡通/插画/动漫/3D 渲染风格。',
  ]
  if (hasFaceIdModel && faceIdImageIndex) {
    lines.push(buildFaceIdSimilarityGuard(faceIdImageIndex))
  }
  // 童装二级品类有专属反向提示词时，追加到通用约束之后
  if (isSuitChildrensCategory(category, childrensCategory)) {
    lines.push(SUIT_NEGATIVE_ADDON)
  } else if (category === 'childrens' && childrensCategory) {
    const addon = getChildrensCategoryNegativeAddon(childrensCategory)
    if (addon) {
      lines.push(addon)
    }
  }
  return lines.join('\n')
}

export interface RunPhotoFissionPipelineOptions {
  taskId: string
  inputImages: string[]
  faceMaskImage?: string | null
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
  /**
   * 追加生成同一 shot 的新版本时使用，避免覆盖原 result asset。
   */
  resultAssetIdSuffix?: string
}

interface ShotRunResult {
  shot: PhotoFissionShot
  result?: ResultAsset
  error?: string
  providerId?: string
}

export interface RunPhotoFissionFaceRefineOptions {
  taskId: string
  params: PhotoFissionParams
  sourceResult: ResultAsset
  baseImage: string
  faceIdImage: string
  faceMaskImage: string
  apiKey: string
  resultAssetIdSuffix: string
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

  // ---- 五官锁定：按用户手动 mask 弱化主图脸部区域 ----
  // 手动 mask 是唯一脸部定位来源；不再自动识别人脸，避免误遮挡发型/发饰/服装。
  let inputImages = options.inputImages
  if (params.faceIdModelId && inputImages.length > 0) {
    if (!options.faceMaskImage) {
      throw new Error('请先涂抹主图五官区域')
    }
    try {
      const maskedMain = await applyManualFaceMask(inputImages[0], options.faceMaskImage)
      inputImages = [maskedMain, ...inputImages.slice(1)]
      logImageEvent(
        'face.blur',
        { traceId: taskId, taskId },
        { stage: 'photo-fission', faceId: params.faceIdModelId, mode: 'manual-mask' },
      )
    } catch (maskError) {
      const reason = maskError instanceof Error ? maskError.message : String(maskError)
      logImageEvent(
        'face.blur-fallback',
        { traceId: taskId, taskId },
        { stage: 'photo-fission', reason, mode: 'manual-mask' },
      )
      throw maskError
    }
  }

  // ---- v5 LLM Planner 接入 ----
  // 在分发到出图模型之前，先调用文本 LLM 镜头策划器（D15-D18）。
  // 当前仅保留童装连衣裙路径；LLM 调用必须成功，否则直接抛错。
  // 让前端显示"生成失败"——我们不再维护成人品类或 v4 兜底链路，避免双服务。
  await applyShotPlannerOverride(fullPlan, params, taskId)

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
  if (!availableProviders.length) {
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
        availableProviders[0].id,
        {
          provider: availableProviders[0],
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
        inputImages,
        resultAssetIdSuffix: options.resultAssetIdSuffix,
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
              inputImages,
              resultAssetIdSuffix: options.resultAssetIdSuffix,
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

  // ---- 五官锁定第二步（已移除换脸，仅靠模糊 + prompt）----
  return successResults
}

export async function runPhotoFissionFaceRefine(
  options: RunPhotoFissionFaceRefineOptions,
): Promise<ResultAsset> {
  if (!options.params.faceIdModelId) {
    throw new Error('当前任务未选择人像小卡，无法重修脸')
  }

  const maskedBase = await applyManualFaceMask(options.baseImage, options.faceMaskImage)
  const prompt = buildFaceRefinePrompt(options.sourceResult)
  const providers = getAvailableProvidersForModel(options.params.model)
  if (!providers.length) {
    throw new Error(getNoAvailableProviderMessage(options.params.model))
  }

  let lastError: unknown
  for (const provider of providers) {
    try {
      const result = await runImageEditViaProvider({
        taskId: options.taskId,
        provider,
        fallbackApiKey: provider.apiKey || options.apiKey,
        model: options.params.model,
        prompt,
        inputImages: [maskedBase, options.faceIdImage],
        count: 1,
        aspectRatio: options.params.imageRatio,
        imageSize: options.params.resolution.toUpperCase(),
        traceId: `${options.taskId}_${options.sourceResult.shotId ?? options.sourceResult.assetId}_face_refine`,
        shotId: options.sourceResult.shotId,
      })
      const first = result[0]
      if (!first) {
        throw new Error('重修脸未返回图片')
      }
      const shotId = options.sourceResult.shotId ?? 'face_refine'
      return {
        ...first,
        assetId: `result_${options.taskId}_${shotId}_${options.resultAssetIdSuffix}`,
        label: options.sourceResult.label,
        shotId: options.sourceResult.shotId,
        finalPrompt: prompt,
        metadata: {
          ...(options.sourceResult.metadata ?? {}),
          variantType: 'face-refine',
          parentAssetId: options.sourceResult.assetId,
        },
      }
    } catch (error) {
      lastError = error
      logImageEvent(
        'pool.failover',
        { traceId: options.taskId, taskId: options.taskId, shotId: options.sourceResult.shotId },
        {
          stage: 'photo-fission-face-refine',
          failedProviderId: provider.id,
          reason: error instanceof Error ? error.message : String(error),
        },
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error('重修脸失败')
}

function buildFaceRefinePrompt(sourceResult: ResultAsset): string {
  return [
    '图1是当前已生成的服装大片结果图，用户已用手动 mask 弱化了需要重修的人脸五官区域；图2是裁剪好的人像小卡。',
    '只重修图1被 mask 影响的人脸区域，把脸部可识别身份严格修成图2人像小卡里的同一张脸，而不是做普通美颜或只让气质更接近。',
    '脸部复刻重点：脸型骨架、下颌线、颧骨、额头宽窄、眼形和眼距、鼻梁鼻头鼻翼、嘴唇厚薄和嘴角、眉形、三庭五眼比例、肤色质感和发色倾向都以图2为准。',
    '图1脸以外的内容必须保持不变：服装、姿势、身体比例、背景、光线、发型轮廓、刘海、头发长度、图1已有配饰和商品展示关系都不要改变。',
    '只允许发色自然贴近图2；不要复制图2的发型、刘海、发长、服装或背景。',
    '图1没有的帽子、发饰、头饰、眼镜、耳饰、手持道具绝对不要新增。',
    '修复后的脸要真实自然，眼睛有清晰眼神光，皮肤保留真实纹理；避免不像图2的通用 AI 脸、网红脸、娃娃脸、过度美颜脸、成人化脸、糊脸、塑料皮、马赛克、圆形修补痕迹、缺牙、多牙、歪嘴和僵硬表情。',
    sourceResult.finalPrompt ? `原图生成提示词参考：${sourceResult.finalPrompt}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

interface RunShotGroupOptions {
  taskId: string
  provider: ImageProvider
  shots: PhotoFissionShot[]
  params: PhotoFissionParams
  inputImages: string[]
  resultAssetIdSuffix?: string
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
 * 默认保留高并发吞吐；如果 provider 限流严重，可通过 env 下调。
 */
async function runShotGroup(options: RunShotGroupOptions): Promise<void> {
  const {
    taskId,
    provider,
    shots,
    params,
    inputImages,
    resultAssetIdSuffix,
    apiKey,
    aspectRatio,
    imageSize,
    onShotResult,
    shotIndexMap,
    allShotResults,
  } = options

  // 按 provider 类型选择默认并发数：即梦/火山引擎 IPM 500 扛得住高并发
  const providerDefaultConcurrency = readProviderDefaultConcurrency(provider)
  const providerConcurrency =
    Number.isFinite(provider.maxConcurrency) && (provider.maxConcurrency ?? 0) >= 1
      ? provider.maxConcurrency
      : providerDefaultConcurrency
  const concurrencyRaw = Number(
    process.env.PHOTO_FISSION_CONCURRENCY ?? providerConcurrency,
  )
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw >= 1
      ? Math.min(Math.floor(concurrencyRaw), shots.length)
      : Math.min(providerConcurrency ?? providerDefaultConcurrency, shots.length)

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
          assetId: `result_${taskId}_${shot.shotId}${
            resultAssetIdSuffix ? `_${resultAssetIdSuffix}` : ''
          }`,
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

function readProviderDefaultConcurrency(provider: ImageProvider): number {
  if (provider.type === 'qiniu') {
    return readPositiveInt(process.env.QINIU_IMAGE_CONCURRENCY, 5)
  }
  if (provider.type === 'jimeng') {
    return readPositiveInt(process.env.JIMENG_IMAGE_CONCURRENCY, 9)
  }
  if (provider.type === 'volces') {
    return readPositiveInt(process.env.VOLCES_IMAGE_CONCURRENCY, 9)
  }
  return DEFAULT_PHOTO_FISSION_CONCURRENCY
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.floor(parsed)
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

function readPhotoFissionChildrensCategory(
  value: unknown,
): PhotoFissionChildrensCategory {
  if (value === undefined || value === null || value === '') {
    return 'dress'
  }
  if (
    typeof value === 'string' &&
    photoFissionChildrensCategoryIds.has(
      value as PhotoFissionChildrensCategory,
    )
  ) {
    return value as PhotoFissionChildrensCategory
  }
  throw new Error('服装大片裂变童装品类无效')
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

const VALID_RESULT_COUNTS = new Set<number>([2, 4, 9, 10])

function readResultCount(value: unknown): PhotoFissionResultCount {
  if (value === undefined || value === null) return 9
  if (typeof value === 'number' && VALID_RESULT_COUNTS.has(value)) {
    return value as PhotoFissionResultCount
  }
  throw new Error('服装大片裂变出图数量无效（合法值：2/4/9/10）')
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

function buildPhotoFissionReferenceAssetKey(inputAssetIds: readonly string[]): string | undefined {
  if (inputAssetIds.length === 0) return undefined
  return inputAssetIds.join('|')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRecentSuitActionHints(params: PhotoFissionParams): string[] {
  if (!isSuitChildrensCategory(params.category, params.childrensCategory)) {
    return []
  }
  const key = buildSuitActionHistoryKey(params)
  const generations = recentSuitActionHistoryByKey.get(key) ?? []
  return [...new Set(generations.flat())]
}

function getRecentDressActionHints(params: PhotoFissionParams): string[] {
  if (!isDressChildrensCategory(params.category, params.childrensCategory)) {
    return []
  }
  const key = buildDressActionHistoryKey(params)
  const generations = recentDressActionHistoryByKey.get(key) ?? []
  return [...new Set(generations.flat())]
}

function rememberSuitActionHints(
  params: PhotoFissionParams,
  shots: ReadonlyArray<{ role: string; imagePrompt: string }>,
): void {
  if (!isSuitChildrensCategory(params.category, params.childrensCategory)) {
    return
  }
  const nextHints = extractSuitActionHints(shots)
  if (nextHints.length === 0) {
    return
  }
  const key = buildSuitActionHistoryKey(params)
  const generations = recentSuitActionHistoryByKey.get(key) ?? []
  const nextGenerations = [...generations, nextHints].slice(-SUIT_ACTION_HISTORY_GENERATIONS)
  recentSuitActionHistoryByKey.set(key, nextGenerations)
}

function rememberDressActionHints(
  params: PhotoFissionParams,
  shots: ReadonlyArray<{ role: string; imagePrompt: string }>,
): void {
  if (!isDressChildrensCategory(params.category, params.childrensCategory)) {
    return
  }
  const nextHints = extractDressActionHints(shots)
  if (nextHints.length === 0) {
    return
  }
  const key = buildDressActionHistoryKey(params)
  const generations = recentDressActionHistoryByKey.get(key) ?? []
  const nextGenerations = [...generations, nextHints].slice(-DRESS_ACTION_HISTORY_GENERATIONS)
  recentDressActionHistoryByKey.set(key, nextGenerations)
}

function buildSuitActionHistoryKey(params: PhotoFissionParams): string {
  return `${params.category}:${params.childrensCategory ?? 'none'}:${params.resultCount ?? 9}`
}

function buildDressActionHistoryKey(params: PhotoFissionParams): string {
  return [
    params.category,
    params.childrensCategory ?? 'none',
    params.resultCount ?? 9,
    params.imageRatio,
    params.referenceAssetKey ?? 'unknown-reference',
  ].join(':')
}

function extractSuitActionHints(
  shots: ReadonlyArray<{ role: string; imagePrompt: string }>,
): string[] {
  const hints = new Set<string>()
  for (const shot of shots) {
    const text = `${shot.role} ${shot.imagePrompt}`
    for (const [pattern, hint] of SUIT_ACTION_HINT_PATTERNS) {
      if (pattern.test(text)) {
        hints.add(hint)
      }
    }
  }
  return [...hints].slice(0, 12)
}

function extractDressActionHints(
  shots: ReadonlyArray<{ role: string; imagePrompt: string }>,
): string[] {
  const hints = new Set<string>()
  for (const shot of shots) {
    const text = `${shot.role} ${shot.imagePrompt}`
    for (const [pattern, hint] of DRESS_ACTION_HINT_PATTERNS) {
      if (pattern.test(text)) {
        hints.add(hint)
      }
    }
  }
  return [...hints].slice(0, 14)
}

const DRESS_ACTION_HINT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/比耶|比\s*V|V\s*字|剪刀手/i, '比耶 / V 字手势'],
  [/托腮|托脸|戳脸颊|脸颊/, '托腮 / 戳脸颊'],
  [/捂嘴|遮嘴/, '单手捂嘴笑'],
  [/挥手|打招呼/, '轻挥手 / 打招呼'],
  [/叉腰|腰侧|胯侧/, '手停腰侧 / 胯侧'],
  [/提裙|轻提|拉起裙摆|展裙|展开裙摆|裙摆.*花/, '提裙 / 展裙'],
  [/低头|垂眸|看裙摆|看脚尖|看向抬起/, '低头看裙摆 / 脚尖'],
  [/闭眼|迎光|微仰|仰头/, '闭眼微仰 / 迎光'],
  [/迈步|走动|行走|前行|脚跟轻抬|脚尖点地|单脚/, '迈步 / 脚尖点地'],
  [/转身|旋转|裙摆扬起/, '小幅转身 / 裙摆扬起'],
  [/回眸|回头/, '回眸 / 回头'],
  [/背手|身后交握/, '背手 / 身后交握'],
  [/撩发|拢发|发丝|耳后/, '轻拢发丝'],
  [/透明小椅子|透明椅|小椅子|地面坐姿|背面站姿|背面展示|侧后方铺裙/, '背面展示变化位'],
  [/金属椅|金属折叠椅|白色金属/, '金属椅坐姿铺裙'],
  [/侧看|看远方|不看镜头|高冷|冷酷/, '不看镜头侧看'],
]

const SUIT_ACTION_HINT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/嘟|比耶|比\s*V|反着比耶|V\s*手势/i, '嘟嘴/比耶'],
  [/OK|ok/i, 'OK 手势'],
  [/单眨眼|眨眼|戳脸颊|脸颊/, '轻戳脸颊/眼睛微弯'],
  [/挥手|打招呼|加油/, '挥手/打招呼'],
  [/插兜|口袋/, '插兜/口袋'],
  [/叉腰|腰侧/, '叉腰/手停腰侧'],
  [/扶发顶|撩发|耳后|头顶/, '撩发/扶发顶'],
  [/脚尖|点地|脚微翘|勾脚/, '脚尖点地/单脚微翘'],
  [/交叉腿|双腿轻交叉|腿.*交叉/, '双腿轻交叉'],
  [/微低头|低头|看向脚尖|看脚尖/, '低头视线'],
  [/闭眼|微风/, '闭眼微风'],
  [/拉链|扣子|外套敞开|打开一边外套|闭合展示/, '外套开合互动'],
  [/微张嘴|小惊喜|惊讶/, '小惊喜/微张嘴'],
  [/迈步|走姿|踮脚|脚跟轻抬/, '迈步/踮脚抓拍'],
  [/道具|包包|花束|帽檐|帽子|鸭舌帽|手提袋|帆布袋|肩带|瑜伽垫|墨镜/, '道具/帽子互动'],
]

function refineSuitPlannerCard(
  card: PlannerPromptCard,
  shotIndex: number,
): PlannerPromptCard {
  const role = sanitizeSuitExpressionText(card.role).trim()
  let imagePrompt = sanitizeSuitExpressionText(card.imagePrompt).trim()
  imagePrompt = sanitizeSuitLegText(imagePrompt)
  imagePrompt = appendSuitLegVariation(imagePrompt, shotIndex)
  imagePrompt = appendSuitFaceQualityGuard(imagePrompt)
  return { role, imagePrompt }
}

function refineDressPlannerCard(card: PlannerPromptCard): PlannerPromptCard {
  const role = sanitizeDressPoseText(card.role).trim()
  const imagePrompt = appendDressPoseFaceQualityGuard(
    sanitizeDressPoseText(card.imagePrompt).trim(),
  )
  return { role, imagePrompt }
}

function sanitizeDressPoseText(text: string): string {
  return text
    .replace(/双手(?:同时|一起)?\s*(?:比|做|摆出)?\s*OK\s*手势/gi, '双手自然轻搭裙摆两侧')
    .replace(/双手(?:同时|一起)?\s*比\s*OK/gi, '双手自然轻搭裙摆两侧')
    .replace(/手插兜/g, '手自然垂落或轻搭裙摆')
    .replace(/插兜/g, '手自然垂落或轻搭裙摆')
    .replace(/双手放进口袋/g, '双手自然垂落或轻触裙摆')
    .replace(/手放进口袋/g, '手自然垂落或轻触裙摆')
    .replace(/蓝天白云草地/g, '无云蓝天草地')
    .replace(/蓝天、白云和草地/g, '无云蓝天和草地')
    .replace(/蓝天、白云、草地/g, '无云蓝天、草地')
}

function appendDressPoseFaceQualityGuard(text: string): string {
  if (/原始穿搭搭配低存在感保留|参考图已有配饰消失|手拿小包、单肩包/.test(text)) return text
  return appendSentence(text, DRESS_POSE_FACE_QUALITY_GUARD)
}

function sanitizeSuitExpressionText(text: string): string {
  return text
    .replace(/半闭合眼睛/g, '双眼自然睁开并微弯')
    .replace(/半闭眼/g, '双眼自然睁开并微弯')
    .replace(/一边眼睛明显变小/g, '眼周放松、脸型五官保持一致')
    .replace(/大小眼/g, '双眼比例自然协调')
    .replace(/失败\s*wink/gi, '自然可爱的单眨眼')
    .replace(/嘴角不对称上扬/g, '嘴角自然轻扬')
    .replace(/嘴角单侧上扬/g, '嘴角自然轻扬')
    .replace(/单侧嘴角明显上扬/g, '嘴角自然轻扬')
    .replace(/单侧嘴角上扬/g, '嘴角自然轻扬')
    .replace(/不对称小弧/g, '自然协调小弧')
    .replace(/不对称弧/g, '自然协调小弧')
    .replace(/不对称微笑/g, '自然浅笑')
    .replace(/不对称笑/g, '自然浅笑')
    .replace(/歪嘴笑/g, '自然轻抿浅笑')
    .replace(/坏笑/g, '自然浅笑')
}

function sanitizeSuitLegText(text: string): string {
  return text
    .replace(/双脚平行站立/g, '双脚一前一后小幅错开')
    .replace(/双脚平行站直/g, '双脚一前一后小幅错开')
    .replace(/双脚并排站直/g, '双脚自然错开站立')
    .replace(/双腿笔直并排/g, '双腿自然放松并形成前后小错位')
    .replace(/双脚并拢/g, '双脚小幅错开')
    .replace(/双脚稳定落地/g, '双脚一前一后小幅错开并稳定落地')
    .replace(/稳定站姿/g, '有脚步变化的稳定站姿')
    .replace(/自然站立/g, '带脚步变化自然站立')
}

function appendSuitLegVariation(text: string, shotIndex: number): string {
  const variation = getSuitLegVariation(text, shotIndex)
  if (text.includes(variation)) return text

  const needsStrongerCue = !SUIT_LEG_CUE_PATTERN.test(text)
  const sentence = needsStrongerCue
    ? `腿脚动作明确为：${variation}。`
    : `本张腿脚变化补充为：${variation}。`
  return appendSentence(text, sentence)
}

function getSuitLegVariation(text: string, shotIndex: number): string {
  if (/背面|背后|侧后/.test(text)) {
    return SUIT_BACK_LEG_VARIATION
  }
  return SUIT_LEG_VARIATION_FALLBACKS[
    shotIndex % SUIT_LEG_VARIATION_FALLBACKS.length
  ]
}

function appendSuitFaceQualityGuard(text: string): string {
  if (/左右嘴角协调|嘴型不歪|僵硬假笑/.test(text)) return text
  return appendSentence(text, SUIT_FACE_QUALITY_GUARD)
}

function appendSentence(text: string, sentence: string): string {
  const trimmed = text.trim()
  if (!trimmed) return sentence
  return /[。！？.!?]$/.test(trimmed)
    ? `${trimmed}${sentence}`
    : `${trimmed}。${sentence}`
}

/**
 * v5 Fission Prompt Planner 接入：在 pipeline 入口对 fullPlan 做商品展示 prompt 覆盖。
 *
 * 流程：
 * 1. 调 rule-engine 拿童装二级品类系统提示词
 * 2. 调用通用文本 LLM Planner（纯文本，单轮 JSON），失败直接抛错
 * 3. 按 shotId 写回 fullPlan[i].prompt
 *
 * 失败策略：
 * - LLM 401 / 403 / 5xx / 超时 / JSON 解析失败 / Schema 校验失败会记录结构化日志
 * - 不中断主链路，保留进入本函数前已经生成好的规则 prompt，避免单次文本 LLM
 *   异常导致整单 0 张失败
 */
async function applyShotPlannerOverride(
  fullPlan: PhotoFissionShot[],
  params: PhotoFissionParams,
  taskId: string,
): Promise<void> {
  const recentActionHints = isSuitChildrensCategory(
    params.category,
    params.childrensCategory,
  )
    ? getRecentSuitActionHints(params)
    : getRecentDressActionHints(params)
  const plan = buildPlannerRulePlan(
    params.category,
    params.childrensCategory,
    params.resultCount,
    recentActionHints,
    Boolean(params.faceIdModelId),
    params.faceIdModelId
      ? 1 + (params.hasFrontDetail ? 1 : 0) + (params.hasBackDetail ? 1 : 0) + 1
      : undefined,
  )
  if (!plan) {
    throw new Error('生成失败：当前服装大片裂变仅支持童装连衣裙和套装')
  }

  const startedAt = Date.now()
  let output: Awaited<ReturnType<typeof invokeShotPlanner>>
  try {
    output = await invokeShotPlanner({
      systemPrompt: plan.systemPrompt,
      userPrompt: plan.userPrompt,
      shotCount: params.resultCount,
      traceId: taskId,
      reasoningEnabled: Boolean(params.plannerReasoningEnabled),
    })
  } catch (error) {
    const stage =
      error instanceof ShotPlannerError ? error.stage ?? 'unknown' : 'unknown'
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      JSON.stringify({
        lvl: 'warn',
        evt: 'planner.fallback',
        ts: new Date().toISOString(),
        traceId: taskId,
        taskId,
        latencyMs: Date.now() - startedAt,
        stage,
        reason: message,
      }),
    )
    return
  }

  // 按 shotId 索引覆盖；任何缺失或越界都跳过单条，不影响其它 shot
  const indexByShotId = new Map<string, number>()
  fullPlan.forEach((shot, idx) => indexByShotId.set(shot.shotId, idx))

  const isSuitTask = isSuitChildrensCategory(
    params.category,
    params.childrensCategory,
  )
  const isDressTask = isDressChildrensCategory(
    params.category,
    params.childrensCategory,
  )
  const rememberedSuitShots: PlannerPromptCard[] = []
  const rememberedDressShots: PlannerPromptCard[] = []
  let overridden = 0
  for (const card of output.shots) {
    const idx = indexByShotId.get(card.shotId)
    if (idx === undefined) continue
    const plannerCard = isSuitTask
      ? refineSuitPlannerCard(card, idx)
      : isDressTask
        ? refineDressPlannerCard(card)
        : card
    let next = appendFlatDetailReferenceLock(
      plannerCard.imagePrompt,
      params,
      `${plannerCard.role} ${plannerCard.imagePrompt}`,
    ).trim()
    if (!next) continue
    // Face ID lock: force-inject identity lock paragraph after planner rewrite
    next = appendFaceIdLock(next, params)
    const nextLabel = plannerCard.role.trim()
    fullPlan[idx] = {
      ...fullPlan[idx],
      label: nextLabel || fullPlan[idx].label,
      prompt: next,
    }
    if (isSuitTask) {
      rememberedSuitShots.push({
        role: nextLabel || fullPlan[idx].label,
        imagePrompt: next,
      })
    }
    if (isDressTask) {
      rememberedDressShots.push({
        role: nextLabel || fullPlan[idx].label,
        imagePrompt: next,
      })
    }
    overridden += 1
  }

  if (overridden === 0) {
    throw new Error(
      `生成失败：LLM 镜头策划器返回的 ${params.resultCount} 段提示词无法匹配到任何 shotId`,
    )
  }
  rememberSuitActionHints(
    params,
    isSuitTask && rememberedSuitShots.length > 0
      ? rememberedSuitShots
      : output.shots,
  )
  rememberDressActionHints(
    params,
    isDressTask && rememberedDressShots.length > 0
      ? rememberedDressShots
      : output.shots,
  )

  // 多样性诊断：检测 planner 输出的重复率并记录日志
  const diversityDiag = diagnosePromptDiversity(fullPlan)
  console.log(
    JSON.stringify({
      lvl: diversityDiag.hasWarning ? 'warn' : 'info',
      evt: 'planner.diversity',
      ts: new Date().toISOString(),
      traceId: taskId,
      taskId,
      ...diversityDiag,
    }),
  )

  // 多样性自动修复：当检测到严重重复时，在后续 shot 追加强制差异化指令
  if (diversityDiag.hasWarning) {
    enforcePromptDiversity(fullPlan, diversityDiag, taskId)
  }

  console.log(
    JSON.stringify({
      lvl: 'info',
      evt: 'planner.success',
      ts: new Date().toISOString(),
      traceId: taskId,
      taskId,
      latencyMs: Date.now() - startedAt,
      overridden,
      total: fullPlan.length,
      reasoningEnabled: Boolean(params.plannerReasoningEnabled),
    }),
  )
}

/**
 * Append face ID identity lock paragraph to a planner-rewritten prompt.
 *
 * Similar to `appendFlatDetailReferenceLock`: the LLM Planner fully rewrites each shot's prompt
 * and may omit the face ID locking instructions. This function force-injects them so that the
 * downstream image model always receives the facial feature anchoring directive.
 *
 * No-op when `params.faceIdModelId` is not set.
 */
function appendFaceIdLock(
  prompt: string,
  params: PhotoFissionParams,
): string {
  if (!params.faceIdModelId) {
    return prompt
  }

  // Compute the 1-based image index for the face ID portrait card
  const faceIdImageIndex =
    1 +
    (params.hasFrontDetail ? 1 : 0) +
    (params.hasBackDetail ? 1 : 0) +
    1

  const imgRef = String(faceIdImageIndex)

  // 移除 planner 可能残留的"延续参考图"脸部指令，避免与锁定指令冲突
  let cleaned = prompt
  cleaned = cleaned.replace(/脸型五官和人物身份延续参考图[。；]/g, '面部全部特征和发色倾向以图' + imgRef + '人像小卡为唯一基准。')
  cleaned = cleaned.replace(/脸型五官延续参考图[。；]/g, '面部全部特征和发色倾向以图' + imgRef + '人像小卡为唯一基准。')
  cleaned = cleaned.replace(/人物脸部必须严格延续参考图[：:][^。；]+[。；]/g, '')
  cleaned = cleaned.replace(/脸部延续参考图[，,][^。；]+[。；]/g, '面部全部特征和发色倾向以图' + imgRef + '人像小卡为唯一基准。')
  cleaned = cleaned.replace(/脸型五官保持一致/g, '脸型五官和发色倾向严格以图' + imgRef + '人像小卡为唯一基准')
  cleaned = cleaned.replace(/面部仍保持参考图一致/g, '面部全部特征和发色倾向严格以图' + imgRef + '人像小卡为唯一基准')
  cleaned = cleaned.replace(/脸部若可见仍保持参考图一致/g, '脸部若可见，全部特征和发色倾向严格以图' + imgRef + '人像小卡为唯一基准')
  cleaned = cleaned.replace(/人物身份保持一致；TA[^。]*穿着[^。]*这套[^。]*。/g, (match) => {
    return match + '面部全部特征（脸型+五官）和发色倾向以图' + imgRef + '人像小卡为唯一基准。'
  })

  // PREPEND：使用 Seedream 官方推荐的多图指令格式
  // 官方文档明确建议："清楚指明不同图像需要编辑/参考的对象及操作"
  // 开头用简洁替换指令，模型对开头指令权重最高
  const prepend = [
    `多图参考分工：图${imgRef}只提供脸部身份和发色倾向（脸型、五官、面部比例、皮肤质感、头发颜色倾向），不提供发型轮廓、刘海、发长、帽子、发饰、服装或穿搭。图1提供脸以外的造型和商品信息：发型轮廓、刘海、头发长度、图1已有配饰、服装穿搭、姿势、场景光线。生成时只把图${imgRef}的脸部核心特征和发色倾向融合到图1人物身上；不要复制图${imgRef}的发型、刘海、发饰或服装。图1没有的帽子、发饰、头饰、眼镜、耳饰、手持道具绝对不要新增。面部必须与图${imgRef}一致：脸型形状、下颌线弧度、颧骨、眼形、鼻型、嘴形、眉形、面部三庭五眼比例和真实皮肤质感都以图${imgRef}为准；表情可以自然变化，但脸型骨骼结构和五官细节不改变。\n\n`,
    `${buildFaceIdSimilarityGuard(faceIdImageIndex)}\n\n`,
  ].join('')

  // APPEND：尾部用替换指令格式再次强调
  const append = [
    `\n\n再次强调多图参考规则：脸部核心特征和发色倾向以图${imgRef}为准，生成结果要像图${imgRef}人像小卡里的同一张脸，不能变成陌生的通用漂亮脸；发型轮廓、刘海、头发长度、图1已有配饰、服装、姿势和背景以图1为准。图${imgRef}不能覆盖图1的发型结构、已有头部配饰或穿搭；图1没有的头饰、发饰、眼镜、耳饰和手持道具不得新增。`,
  ].join('')

  return `${prepend}${cleaned.trim()}${append}`
}

/**
 * 多样性诊断：检测 planner 输出中手势/表情/视线的重复率。
 *
 * 纯诊断+日志，不修改 prompt。重复率过高时输出 warn 级日志，
 * 方便运维观察 planner 质量趋势。
 */
function diagnosePromptDiversity(
  shots: ReadonlyArray<{ prompt: string }>,
): { hasWarning: boolean; gestureDuplication: number; expressionDuplication: number; gazeDuplication: number; topGestures: string[]; topExpressions: string[] } {
  const gesturePatterns: ReadonlyArray<[RegExp, string]> = [
    [/比\s*V|比耶|剪刀手|V\s*字/i, '比V'],
    [/撩发|拢发|别耳后|发丝/i, '撩发别耳后'],
    [/提裙|拉起裙摆|展裙|轻提裙/i, '提裙展裙'],
    [/叉腰|手停腰侧|腰侧/i, '叉腰'],
    [/背手|身后交握|背后交握/i, '背手'],
    [/托腮|托脸|戳脸颊/i, '托腮'],
    [/捂嘴|遮嘴/i, '捂嘴'],
    [/挥手|打招呼/i, '挥手'],
    [/交握身前|身前交握/i, '身前交握'],
    [/扶发顶|扶额/i, '扶发顶'],
    [/插兜|口袋/i, '插兜'],
    [/OK\s*手势|比\s*OK/i, 'OK手势'],
  ]

  const expressionPatterns: ReadonlyArray<[RegExp, string]> = [
    [/浅笑|微笑|小弧|轻扬/i, '浅笑'],
    [/露齿|笑.*牙|牙.*笑/i, '露齿笑'],
    [/嘟嘴|嘟嘟嘴/i, '嘟嘴'],
    [/轻抿|抿嘴|抿唇/i, '轻抿'],
    [/微张嘴|小惊喜/i, '小惊喜'],
    [/闭眼|微仰|迎光/i, '闭眼'],
    [/冷酷|高冷|帅气/i, '冷酷'],
  ]

  const gazePatterns: ReadonlyArray<[RegExp, string]> = [
    [/直视镜头|平视镜头|看向镜头/i, '直视镜头'],
    [/看裙摆|看脚尖|低垂|低头/i, '看下方'],
    [/越过镜头|看右上|看右下|看左上|看左前/i, '看向侧方'],
    [/闭眼|迎光/i, '闭眼'],
    [/看远方|侧看|不看镜头/i, '看远方'],
  ]

  function countPatterns(texts: readonly string[], patterns: ReadonlyArray<[RegExp, string]>): Map<string, number> {
    const counts = new Map<string, number>()
    for (const text of texts) {
      for (const [pattern, label] of patterns) {
        if (pattern.test(text)) {
          counts.set(label, (counts.get(label) ?? 0) + 1)
        }
      }
    }
    return counts
  }

  const prompts = shots.map((s) => s.prompt)
  const gestureCounts = countPatterns(prompts, gesturePatterns)
  const expressionCounts = countPatterns(prompts, expressionPatterns)
  const gazeCounts = countPatterns(prompts, gazePatterns)

  const totalShots = shots.length
  const duplicateThreshold = Math.max(3, Math.ceil(totalShots * 0.45))

  const gestureDuplication = Math.max(...gestureCounts.values(), 0)
  const expressionDuplication = Math.max(...expressionCounts.values(), 0)
  const gazeDuplication = Math.max(...gazeCounts.values(), 0)

  const hasWarning =
    gestureDuplication > duplicateThreshold ||
    expressionDuplication > duplicateThreshold ||
    gazeDuplication > duplicateThreshold

  function getTopN(counts: Map<string, number>, n: number): string[] {
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([label, count]) => `${label}×${count}`)
  }

  return {
    hasWarning,
    gestureDuplication,
    expressionDuplication,
    gazeDuplication,
    topGestures: getTopN(gestureCounts, 5),
    topExpressions: getTopN(expressionCounts, 5),
  }
}

/** 手势替代池：每个重复手势对应一组可用替代 */
const GESTURE_ALTERNATIVES: ReadonlyArray<readonly string[]> = [
  ['双手自然下垂', '单手轻搭腰侧', '一手扶包带一手自然垂'],
  ['撩发别耳后', '轻捏发梢', '手指轻触太阳穴'],
  ['提裙展裙', '轻抚裙摆边缘', '双手展开裙摆'],
  ['叉腰', '单手叉腰另一手轻挥', '双手叉腰微微侧身'],
  ['背手身后', '一手背身后一手轻抬', '双手背后交握微仰头'],
  ['托腮', '单手轻托下巴', '手指轻点脸颊'],
  ['身前交握', '双手轻握身前', '十指交叉自然垂于身前'],
  ['挥手打招呼', '轻举手掌示意', '单手微抬食指指向远方'],
  ['扶发顶', '轻按帽子', '手指轻整理刘海'],
]

const EXPRESSION_ALTERNATIVES: ReadonlyArray<readonly string[]> = [
  ['浅浅抿嘴', '嘴角微微上扬但不出声', '自然放松的面部'],
  ['俏皮嘟嘴', '微微噘嘴', '略带撒娇的嘟嘴'],
  ['温柔浅笑', '含蓄微笑', '嘴角轻扬不带牙齿'],
  ['开朗露齿笑', '灿烂笑容', '自然大笑'],
  ['故作严肃', '微微板脸', '冷艳高傲'],
  ['小惊喜微张嘴', '眼睛微微睁大', '嘴角微张像在说"哇"'],
]

/**
 * 多样性自动修复：当 planner 输出严重重复时，在后续 shot 追加强制差异化指令。
 *
 * 逐 shot 扫描，收集已用的手势/表情，为重复的 shot 追加禁用列表和替代建议。
 * 不需要重新调用 LLM，通过追加指令让图像模型自行选择不同动作。
 */
function enforcePromptDiversity(
  shots: Array<{ prompt: string }>,
  diag: ReturnType<typeof diagnosePromptDiversity>,
  taskId: string,
): void {
  const usedGestures = new Set<string>()
  const usedExpressions = new Set<string>()
  let fixedCount = 0

  // 手势/表情检测 pattern（与 diagnose 共用逻辑）
  const gesturePatterns: ReadonlyArray<[RegExp, string]> = [
    [/比\s*V|比耶|剪刀手|V\s*字/i, '比V'],
    [/撩发|拢发|别耳后|发丝/i, '撩发别耳后'],
    [/提裙|拉起裙摆|展裙|轻提裙/i, '提裙展裙'],
    [/叉腰|手停腰侧|腰侧/i, '叉腰'],
    [/背手|身后交握|背后交握/i, '背手'],
    [/托腮|托脸|戳脸颊/i, '托腮'],
    [/捂嘴|遮嘴/i, '捂嘴'],
    [/挥手|打招呼/i, '挥手'],
    [/交握身前|身前交握/i, '身前交握'],
    [/扶发顶|扶额/i, '扶发顶'],
    [/插兜|口袋/i, '插兜'],
    [/OK\s*手势|比\s*OK/i, 'OK手势'],
    [/自然下垂|手臂垂/i, '手下垂'],
    [/轻搭|轻放/i, '轻搭'],
  ]

  const expressionPatterns: ReadonlyArray<[RegExp, string]> = [
    [/浅笑|微笑|小弧|轻扬/i, '浅笑'],
    [/露齿|笑.*牙|牙.*笑/i, '露齿笑'],
    [/嘟嘴|嘟嘟嘴/i, '嘟嘴'],
    [/轻抿|抿嘴|抿唇/i, '轻抿'],
    [/微张嘴|小惊喜/i, '小惊喜'],
    [/闭眼|微仰|迎光/i, '闭眼'],
    [/冷酷|高冷|帅气/i, '冷酷'],
    [/自然.*表情|放松.*面部/i, '自然表情'],
    [/严肃|板脸/i, '严肃'],
  ]

  function detectPatterns(text: string, patterns: ReadonlyArray<[RegExp, string]>): string[] {
    const found: string[] = []
    for (const [pattern, label] of patterns) {
      if (pattern.test(text)) found.push(label)
    }
    return found
  }

  function pickAlternatives(
    alreadyUsed: Set<string>,
    pool: ReadonlyArray<readonly string[]>,
    count: number,
  ): string[] {
    const candidates: string[] = []
    for (const group of pool) {
      const available = group.filter(g => !alreadyUsed.has(g))
      if (available.length > 0) {
        candidates.push(available[Math.floor(Math.random() * available.length)])
      }
    }
    // 随机打乱后取前 N 个
    return candidates.sort(() => Math.random() - 0.5).slice(0, count)
  }

  for (let i = 0; i < shots.length; i++) {
    const shotGestures = detectPatterns(shots[i].prompt, gesturePatterns)
    const shotExpressions = detectPatterns(shots[i].prompt, expressionPatterns)

    const gestureDup = shotGestures.filter(g => usedGestures.has(g))
    const expressionDup = shotExpressions.filter(e => usedExpressions.has(e))

    // 记录本轮使用的手势/表情
    for (const g of shotGestures) usedGestures.add(g)
    for (const e of shotExpressions) usedExpressions.add(e)

    // 只有第一个 shot（i===0）或没有重复时跳过
    if (i === 0 || (gestureDup.length === 0 && expressionDup.length === 0)) continue

    // 构建强制差异化指令
    const bannedGestures = [...new Set(gestureDup)]
    const bannedExpressions = [...new Set(expressionDup)]
    const altGestures = pickAlternatives(usedGestures, GESTURE_ALTERNATIVES, 2)
    const altExpressions = pickAlternatives(usedExpressions, EXPRESSION_ALTERNATIVES, 2)

    const lines: string[] = ['\n\n【强制差异化】前面镜头已使用的手势/表情与本图重复，必须更改：']
    if (bannedGestures.length > 0) {
      lines.push(`禁止使用的手势：${bannedGestures.join('、')}。`)
      if (altGestures.length > 0) {
        lines.push(`请改用：${altGestures.join('、')}或其他与前面完全不同的手部动作。`)
      }
    }
    if (bannedExpressions.length > 0) {
      lines.push(`禁止使用的表情：${bannedExpressions.join('、')}。`)
      if (altExpressions.length > 0) {
        lines.push(`请改用：${altExpressions.join('、')}或其他与前面完全不同的面部表情。`)
      }
    }
    lines.push('腿部站姿和重心也必须与前面镜头明显不同。')

    shots[i].prompt = shots[i].prompt + lines.join('\n')
    fixedCount += 1
  }

  console.log(
    JSON.stringify({
      lvl: 'info',
      evt: 'planner.diversity.fixed',
      ts: new Date().toISOString(),
      traceId: taskId,
      taskId,
      fixedCount,
    }),
  )
}
