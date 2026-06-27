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
  type PantsMainHandVisibility,
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
import { GoogleImageError } from './google-image-retry'
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
import {
  getPantsAssignedPoseForShot,
  getPantsShotBlueprintForCount,
  PANTS_CATEGORY_REQUIREMENT,
} from './prompt-templates/pants-planner-system'
import {
  buildPantsAssignedPoseInstruction,
  getPantsPoseCardById,
  getPantsPoseDirectionRule,
  PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN_PATTERN,
  PANTS_MAIN_EVIDENCE_RULE,
  PANTS_POSE_HISTORY_PATTERNS,
  type PantsPoseCard,
  type PantsPoseView,
} from './prompt-templates/pants-pose-library'
import { appendFlatDetailReferenceLock } from './fission-flat-detail-lock'
import {
  getPantsAngleLabel,
  getPantsReferenceAngleForView,
  getPantsShotDetailAvailability,
  getPantsShotInputImageLabels,
  getPantsShotReferenceSlots,
  sanitizePantsPlannerReferenceText,
  selectPantsShotInputImages,
  type PantsDetailAvailability,
} from './pants-reference-policy'
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
const PANTS_POSE_RESTRICTED_GENERATIONS = 3
const PANTS_POSE_CYCLE_LENGTH = 8
const recentSuitActionHistoryByKey = new Map<string, string[][]>()
const recentDressActionHistoryByKey = new Map<string, string[][]>()
const pantsPoseHistoryByKey = new Map<
  string,
  { generationCount: number; generations: string[][] }
>()
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
  imagePrompt: string | import('@/lib/types').StructuredImagePrompt
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
  pants: PANTS_CATEGORY_REQUIREMENT,
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
  const hasSideDetail =
    childrensCategory === 'pants' &&
    readOptionalBoolean(
      params.hasSideDetail,
      false,
      '服装大片裂变侧面细节图参数无效',
    )
  const hasBackDetail = readOptionalBoolean(
    params.hasBackDetail,
    false,
    '服装大片裂变背面细节图参数无效',
  )
  const maxDetailCount = childrensCategory === 'pants' ? 2 : 1
  const frontDetailCount = readPhotoFissionDetailCount(
    params.frontDetailCount,
    hasFrontDetail,
    maxDetailCount,
    '服装大片裂变正面参考图数量无效',
  )
  const sideDetailCount =
    childrensCategory === 'pants'
      ? readPhotoFissionDetailCount(
          params.sideDetailCount,
          hasSideDetail,
          2,
          '服装大片裂变侧面参考图数量无效',
        )
      : 0
  const backDetailCount = readPhotoFissionDetailCount(
    params.backDetailCount,
    hasBackDetail,
    maxDetailCount,
    '服装大片裂变背面参考图数量无效',
  )
  if (
    hasFrontDetail !== (frontDetailCount > 0) ||
    hasSideDetail !== (sideDetailCount > 0) ||
    hasBackDetail !== (backDetailCount > 0)
  ) {
    throw new Error('服装大片裂变细节图数量与上传状态不一致')
  }
  const imageRatio = readPhotoFissionImageRatio(params.imageRatio)
  const resolution = readPhotoFissionResolution(params.resolution)
  const resultCount = readResultCount(params.resultCount)
  const plannerReasoningEnabled = readOptionalBoolean(
    params.plannerReasoningEnabled,
    false,
    '服装大片裂变推理模式参数无效',
  )
  const pantsMainHandVisibility =
    childrensCategory === 'pants'
      ? readPantsMainHandVisibility(params.pantsMainHandVisibility)
      : undefined

  const rawFaceIdModelId =
    typeof params.faceIdModelId === 'string' && params.faceIdModelId.trim()
      ? params.faceIdModelId.trim()
      : null
  const rawFaceMaskAssetId =
    typeof params.faceMaskAssetId === 'string' && params.faceMaskAssetId.trim()
      ? params.faceMaskAssetId.trim()
      : null
  const faceIdModelId = childrensCategory === 'pants' ? null : rawFaceIdModelId
  const faceMaskAssetId = childrensCategory === 'pants' ? null : rawFaceMaskAssetId
  if (faceIdModelId && !faceMaskAssetId) {
    throw new Error('请先涂抹主图五官区域')
  }

  const expectedAssetCount =
    1 +
    frontDetailCount +
    sideDetailCount +
    backDetailCount +
    (faceIdModelId ? 1 : 0)
  if (inputAssetCount !== expectedAssetCount) {
    throw new Error('服装大片裂变素材数量与细节图参数不一致')
  }

  const referenceAssetKey = buildPhotoFissionReferenceAssetKey(inputAssetIds)
  const pantsPoseDrawSeed =
    childrensCategory === 'pants'
      ? `${referenceAssetKey ?? 'unknown-reference'}:${Date.now()}:${Math.random().toString(36).slice(2)}`
      : undefined
  const shotPlan = buildPhotoFissionShotPlan({
    category,
    childrensCategory,
    imageRatio,
    resolution,
    hasFrontDetail,
    hasSideDetail,
    hasBackDetail,
    frontDetailCount,
    sideDetailCount,
    backDetailCount,
    pantsMainHandVisibility,
    resultCount,
    hasFaceIdModel: Boolean(faceIdModelId),
    pantsPoseDrawSeed,
  })

  // R6 输入预检：每条 shot.prompt 不应超过 32000 字（对齐 OpenAI GPT Image 官方限制）
  for (const shot of shotPlan) {
    if (shot.prompt.length > 32000) {
      throw new Error(
        `服装大片裂变 prompt 长度异常（shot=${shot.shotId} 长度=${shot.prompt.length}，上限 32000）`,
      )
    }
  }

  return {
    model,
    category,
    childrensCategory,
    hasFrontDetail,
    hasSideDetail,
    hasBackDetail,
    frontDetailCount,
    sideDetailCount,
    backDetailCount,
    pantsMainHandVisibility,
    imageRatio,
    resolution,
    shotPlan,
    resultCount,
    referenceAssetKey,
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
  hasSideDetail: boolean
  hasBackDetail: boolean
  frontDetailCount?: number
  sideDetailCount?: number
  backDetailCount?: number
  pantsMainHandVisibility?: PantsMainHandVisibility
  resultCount: PhotoFissionResultCount
  /** Whether a portrait card (face ID model) is selected for facial feature locking */
  hasFaceIdModel: boolean
  /** 每个裤子任务独立的加权姿势抽卡种子。 */
  pantsPoseDrawSeed?: string
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
    view?: PantsPoseView
    scene?: PhotoFissionShotScene
  }> | undefined

  if (input.category === 'childrens') {
    if (!input.childrensCategory) {
      throw new Error('服装大片裂变童装品类无效')
    }
    // 优先使用按数量构建的 blueprint
    if (input.childrensCategory === 'pants') {
      activeBlueprint = getPantsShotBlueprintForCount(input.resultCount)
    } else if (input.childrensCategory === 'suit') {
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
  // Image index = 1(main) + (front?1:0) + (side?1:0) + (back?1:0) + 1
  const faceIdImageIndex = input.hasFaceIdModel
    ? 1 +
      (input.frontDetailCount ?? (input.hasFrontDetail ? 1 : 0)) +
      (input.sideDetailCount ?? (input.hasSideDetail ? 1 : 0)) +
      (input.backDetailCount ?? (input.hasBackDetail ? 1 : 0)) +
      1
    : undefined

  return activeBlueprint.map((blueprint, index) => {
    const shotId = `shot_${index + 1}`
    const order = index + 1
    const pantsView =
      input.category === 'childrens' && input.childrensCategory === 'pants'
        ? (blueprint.view ?? 'front')
        : undefined
    const pantsMainHandVisibility = pantsView
      ? input.pantsMainHandVisibility ?? 'hidden'
      : undefined
    const pantsAssignedPose = pantsView
      ? getPantsAssignedPoseForShot(
          input.resultCount,
          shotId,
          input.pantsPoseDrawSeed,
          pantsMainHandVisibility,
        )
      : undefined
    const shotDetailAvailability =
      pantsView
        ? getPantsShotDetailAvailability(
            {
              hasFrontDetail: input.hasFrontDetail,
              hasSideDetail: input.hasSideDetail,
              hasBackDetail: input.hasBackDetail,
              frontDetailCount: input.frontDetailCount,
              sideDetailCount: input.sideDetailCount,
              backDetailCount: input.backDetailCount,
            },
            pantsView,
          )
        : {
            hasFrontDetail: input.hasFrontDetail,
            hasSideDetail: input.hasSideDetail,
            hasBackDetail: input.hasBackDetail,
            frontDetailCount: input.frontDetailCount,
            sideDetailCount: input.sideDetailCount,
            backDetailCount: input.backDetailCount,
          }
    const prompt = buildShotPrompt({
      label: blueprint.label,
      shotDescription: blueprint.description,
      shotIndex: index,
      shotScene: blueprint.scene,
      category: input.category,
      childrensCategory: input.childrensCategory,
      imageRatio: input.imageRatio,
      resolution: input.resolution,
      resultCount: input.resultCount,
      hasFrontDetail: shotDetailAvailability.hasFrontDetail,
      hasSideDetail: shotDetailAvailability.hasSideDetail,
      hasBackDetail: shotDetailAvailability.hasBackDetail,
      frontDetailCount: shotDetailAvailability.frontDetailCount,
      sideDetailCount: shotDetailAvailability.sideDetailCount,
      backDetailCount: shotDetailAvailability.backDetailCount,
      pantsView,
      pantsAssignedPose,
      pantsMainHandVisibility,
      hasFaceIdModel: input.hasFaceIdModel,
      faceIdImageIndex,
    })

    const pantsFields = pantsAssignedPose
      ? {
          pantsPoseCardId: pantsAssignedPose.id,
          pantsMainHandVisibility,
          pantsMayRevealHandsWhenMainHidden:
            pantsMainHandVisibility === 'visible',
        }
      : {}

    return {
      shotId,
      label: blueprint.label,
      prompt,
      order,
      ...pantsFields,
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
  resultCount: PhotoFissionResultCount
  hasFrontDetail: boolean
  hasSideDetail: boolean
  hasBackDetail: boolean
  frontDetailCount?: number
  sideDetailCount?: number
  backDetailCount?: number
  pantsView?: PantsPoseView
  pantsAssignedPose?: PantsPoseCard
  pantsMainHandVisibility?: PantsMainHandVisibility
  /** Whether a portrait card is selected for facial feature locking */
  hasFaceIdModel: boolean
  /** 1-based image index of the portrait card in inputImages */
  faceIdImageIndex?: number
}

function buildShotPrompt(input: BuildShotPromptInput): string {
  if (isPantsChildrensCategory(input.category, input.childrensCategory)) {
    return buildCompactPantsShotPrompt(input)
  }

  const faceIdImageIndex = input.hasFaceIdModel ? input.faceIdImageIndex : undefined

  // 构建 JSON 结构化提示词
  const jsonPrompt = {
    generation_request: {
      meta_data: {
        tool: "Gemini Image Generation",
        task_type: "ecommerce_fashion_photo",
        language: "zh-CN",
        priority: "highest"
      },
      input: {
        mode: "image_to_image",
        reference_image_usage: "maximum",
        preserve_identity: true,
        preserve_clothing: true,
        notes: input.shotDescription
      },
      identity_lock: input.hasFaceIdModel ? {
        face_priority: "absolute",
        face_geometry_lock: true,
        bone_structure_lock: true,
        face_reference_index: faceIdImageIndex,
        no_beautification: true,
        note: `图${faceIdImageIndex}提供脸部身份（脸型、五官、皮肤质感、发色），图1提供发型、刘海、帽子、发饰、服装。脸型骨骼严格以图${faceIdImageIndex}为准。`
      } : {
        face_reference: "图1",
        preserve_facial_features: true
      },
      output_settings: {
        aspect_ratio: input.imageRatio,
        resolution_target: input.resolution,
        num_images: 1,
        orientation: getCompositionOrientation(input.imageRatio),
        sharpness: "editorial_crisp"
      },
      scene: buildSceneConfig(input),
      wardrobe: {
        description: "这套服装",
        color_source: input.hasFrontDetail || input.hasBackDetail ? "细节图为准" : "图1为准",
        material_source: "参考图中真实存在的材质特征",
        rules: [
          "完整延续版型、图案、logo、纽扣、口袋、领口、袖口、下摆",
          "不增加、不减少、不替换任何服装元素",
          "图1已有配饰必须保留"
        ]
      },
      shot: {
        label: input.label,
        description: input.shotDescription,
        angle_control: buildAngleControlConfig(input.category, input.childrensCategory)
      },
      category_requirements: buildCategoryConfig(input.category, input.childrensCategory),
      anatomy_and_hands: {
        hands_priority: "maximum",
        finger_count: "5_per_hand",
        avoid: ["extra_fingers", "missing_fingers", "warped_wrists", "反关节"]
      },
      quality_control: {
        surface_quality: "必须干净清晰",
        avoid: [
          "横向扫描线", "横向条纹伪影", "摩尔纹", "水波纹",
          "密集平行线", "屏幕纹", "压缩噪声", "马赛克",
          "色块", "条带状失真", "规则重复线条",
          "text", "watermark", "cartoon", "anime", "3D渲染"
        ],
        texture_requirement: "布料纹理必须是真实自然的织物质感，不是像素级规则线条"
      },
      negative_prompt: buildNegativeArray(input.category, input.childrensCategory, input.hasFaceIdModel, faceIdImageIndex)
    }
  }

  return JSON.stringify(jsonPrompt, null, 2)
}

function buildSceneConfig(input: BuildShotPromptInput) {
  const isDressOutdoor = isDressChildrensOutdoorShot(input.category, input.childrensCategory, input.shotScene)
  const isSuitOutdoor = isSuitChildrensOutdoorShot(input.category, input.childrensCategory, input.shotScene)

  if (isDressOutdoor) {
    return {
      environment: "无云蓝天草地外景",
      lighting: { style: "明亮柔和户外自然光", shadow: "自然接触阴影" },
      camera: { look: "童装连衣裙电商外景补充图" }
    }
  }
  if (isSuitOutdoor) {
    return {
      environment: "晴朗夏日蓝天绿草地真实外景",
      lighting: { style: "柔和自然户外散射光", shadow: "清楚自然接触阴影" },
      camera: { look: "童装套装电商外景补充图" }
    }
  }
  return {
    environment: "沿用图1的背景、环境、陈设",
    lighting: { style: "柔和均匀自然光", direction: "沿用图1光源方向、色温" },
    camera: { look: "电商主图调性" }
  }
}

function buildAngleControlConfig(category: PhotoFissionCategory, childrensCategory?: PhotoFissionChildrensCategory): string | null {
  if (isSuitChildrensCategory(category, childrensCategory)) {
    return SUIT_ACTION_CONTROL
  }
  if (category === 'childrens' && childrensCategory) {
    return getChildrensCategoryAngleControl(childrensCategory) ?? null
  }
  return null
}

function buildCategoryConfig(category: PhotoFissionCategory, childrensCategory?: PhotoFissionChildrensCategory) {
  const config: Record<string, unknown> = {
    primary: categoryRequirementMap[category]
  }
  if (category === 'childrens' && childrensCategory) {
    config.secondary = childrensCategoryRequirementMap[childrensCategory]
  }
  config.shoe_requirement = "图1主图如有鞋子，所有生成图中必须保留同款鞋子"
  return config
}

function buildNegativeArray(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
  hasFaceIdModel?: boolean,
  faceIdImageIndex?: number
): string[] {
  const negatives = [
    "文字", "水印", "品牌印章", "多余人物", "多宫格拼接",
    "cartoon", "插画", "动漫", "3D渲染",
    "横向扫描线", "横向条纹", "摩尔纹", "水波纹", "网格纹",
    "屏幕纹", "密集平行细线", "规则重复线条", "压缩噪声",
    "马赛克", "色块", "条带状失真"
  ]

  if (hasFaceIdModel && faceIdImageIndex) {
    negatives.push(
      "通用AI脸", "网红脸", "娃娃脸", "过度美颜脸", "成人化脸",
      "糊脸", "低清", "塑料皮", "过度磨皮",
      `不像图${faceIdImageIndex}的脸`, "陌生脸", "混合脸"
    )
  }

  if (isSuitChildrensCategory(category, childrensCategory)) {
    negatives.push(...SUIT_NEGATIVE_ADDON.split('；'))
  } else if (category === 'childrens' && childrensCategory) {
    const addon = getChildrensCategoryNegativeAddon(childrensCategory)
    if (addon) negatives.push(...addon.split('；'))
  }

  return negatives
}

function getFaceIdImageIndexFromParams(
  params: PhotoFissionParams,
): number | undefined {
  if (!params.faceIdModelId) return undefined
  return (
    1 +
    (params.frontDetailCount ?? (params.hasFrontDetail ? 1 : 0)) +
    (params.sideDetailCount ?? (params.hasSideDetail ? 1 : 0)) +
    (params.backDetailCount ?? (params.hasBackDetail ? 1 : 0)) +
    1
  )
}

function buildCompactPantsShotPrompt(input: BuildShotPromptInput): string {
  const orientation = getCompositionOrientation(input.imageRatio)
  const pantsMainHandVisibility = input.pantsMainHandVisibility ?? 'hidden'
  const isLowerBodyOnlyPants = pantsMainHandVisibility === 'hidden'
  const shotDescription = compactPantsPromptText(
    sanitizePantsCropText(
      isLowerBodyOnlyPants
        ? sanitizePantsHiddenHandText(input.shotDescription)
        : input.shotDescription,
    ),
    420,
  )
  const poseInstruction = input.pantsAssignedPose
    ? buildPantsAssignedPoseInstruction(input.pantsAssignedPose, {
        mainHandVisibility: pantsMainHandVisibility,
      })
    : '按当前镜头说明执行腿部、重心、脚掌落点和方向变化；裤子版型、裤长基准、裤脚宽度、上衣、背景和光线继续跟随图1，允许指定姿势造成裤脚垂坠、褶皱和鞋脚露出程度自然变化。'
  const handRule =
    pantsMainHandVisibility === 'visible'
      ? '主图露手：按图1保留可见手部数量、手臂范围、袖长、袖口和上衣款式，只执行姿势卡里的手部候选。'
      : '本镜头保持下半身商品图模式，不上移镜头，不扩展成完整人像。'
  const angleInstruction = buildPantsAngleInstruction(
    input.pantsView,
    input.shotIndex,
    input.resultCount,
  )
  const taskLine = isLowerBodyOnlyPants
    ? `生成同一条裤子的【${input.label}】单张下半身电商商品图，${orientation}。腿脚站法只执行本镜头唯一指定姿势。输出单张完整图片，不要多宫格。`
    : `生成同一条裤子的【${input.label}】单张电商商品图，${orientation}。腿脚站法只执行本镜头唯一指定姿势。输出单张完整图片，不要多宫格。`
  const productFrameLines = isLowerBodyOnlyPants
    ? [
        '裤子的穿着版型、裤型、宽松度、裤长基准和裤脚宽度以图1为准，不改造成其它裤型。指定腿脚姿势可以让裤脚垂坠、自然褶皱、裤脚高度投影、鞋子露出多少和脚部遮挡关系跟随动作发生真实变化。正面、侧面、背面细节图只校准对应可见局部真实存在的颜色、材质、纹理、图案、logo、刺绣、贴布、拼接、口袋、裤脚和侧缝；没有参考证据的结构不要生成，也不要凭常见裤装经验补口袋、装饰或图案。',
        '商品结构红线：右腿可见 logo 或图案只能在右腿对应可见区域出现，左侧没有证据就不生成左侧 logo，背面没有证据就不生成背面图案、logo 或口袋；局部放大图只证明拍到的局部存在，不能扩展成其它面、另一条腿或整条裤子的结构。',
        '图1已有的上衣局部颜色与图案、鞋子按同款保留，图1边界内露出多少上衣就保留多少；图1没有的内容不新增。画面边界、相机距离、主体大小和画面上边缘与图1一致，不上移镜头，不扩展成完整人像。以上锁定范围不包含腿脚站法，腿脚站法只执行本张唯一指定姿势。',
        PANTS_LOWER_BODY_PRODUCT_FRAME_RULE,
      ]
    : [
        '裤子的穿着版型、裤型、宽松度、裤长基准和裤脚宽度以图1为准，不改造成其它裤型。指定腿脚姿势可以让裤脚垂坠、自然褶皱、裤脚高度投影、鞋子露出多少和脚部遮挡关系跟随动作发生真实变化。正面、侧面、背面细节图只校准对应可见局部真实存在的颜色、材质、纹理、图案、logo、刺绣、贴布、拼接、口袋、裤脚和侧缝；没有参考证据的结构不要生成，也不要凭常见裤装经验补口袋、装饰或图案。',
        '商品结构红线：右腿可见 logo 或图案只能在右腿对应可见区域出现，左侧没有证据就不生成左侧 logo，背面没有证据就不生成背面图案、logo 或口袋；局部放大图只证明拍到的局部存在，不能扩展成其它面、另一条腿或整条裤子的结构。',
        '图1已有的上衣颜色与图案、鞋子按同款保留，图1露出多少上衣就保留多少上衣；图1没有的内容不新增。画面边界、相机距离、人物大小、胸口以上裁切和画面上边缘与图1一致。以上锁定范围不包含腿脚站法，腿脚站法只执行本张唯一指定姿势。',
      ]

  const sections = [
    [
      '【任务】',
      taskLine,
    ].join('\n'),
    [
      '【唯一指定姿势｜最高优先级】',
      '本段是本张唯一的姿势与腿脚来源，优先级高于其它所有段落。商品参考图只控制裤子外观和结构，不控制腿脚站法。若参考图姿势或任何参考描述与本段冲突，一律以本段为准。指定姿势可以自然改变裤脚垂坠、褶皱、鞋子露出程度和脚部遮挡关系。',
      angleInstruction,
      poseInstruction,
      handRule,
    ].join('\n'),
    buildCompactPantsReferenceSection(input),
    [
      '【商品与构图锁定】',
      ...productFrameLines,
    ].join('\n'),
    [
      '【本张镜头】',
      `${input.label}：${angleInstruction}。${shotDescription}。本段只描述当前方向家族与商品展示，腿脚和角度一律以上方【唯一指定姿势】为准。`,
    ].join('\n'),
    [
      '【保持与禁止】',
      isLowerBodyOnlyPants
        ? '保持裤子款式、裤型、裤长基准、裤脚宽度、上衣局部、鞋子款式、背景、光线、相机距离和主体大小与图1一致。保持指定姿势的脚尖点地、屈膝、行走、交叉步或台阶高低层次，不退化为参考图普通站姿。保持画面在图1上边缘以内，保持裤子图案、logo、刺绣、贴布、拼接、口袋和真实结构与参考图一致，只在对应可见区域呈现。输出干净单张图片，保持真实商品图质感。'
        : '保持裤子款式、裤型、裤长基准、裤脚宽度、上衣、鞋子款式、背景、光线、相机距离和人物大小与图1一致。保持指定姿势的脚尖点地、屈膝、行走、交叉步或台阶高低层次，不退化为参考图普通站姿。保持画面在图1上边缘以内，保持裤子图案、logo、刺绣、贴布、拼接、口袋和真实结构与参考图一致，只在对应可见区域呈现。输出干净单张图片，保持真实商品图质感。',
    ].join('\n'),
    [
      '【输出参数】',
      `画面比例：${input.imageRatio}；分辨率档位：${input.resolution}；品类：裤子。`,
    ].join('\n'),
  ]

  return sections.join('\n\n')
}

function sanitizePantsHiddenHandText(text: string): string {
  return text
    .replace(/手部是否出现严格服从主图露手证据，主图不露手则本镜头不露手，/g, '上衣可见范围与主图一致，')
    .replace(/手部和腿部严格执行本镜头指定姿势卡/g, '腿部严格执行本镜头指定姿势卡')
    .replace(/完整手部动作和完整腿部动作/g, '完整腿部动作')
    .replace(/不同手部动作、腿脚站位、重心和微侧幅度/g, '不同腿脚站位、重心和微侧幅度')
    .replace(/低位手部动作/g, '腿脚动作')
    .replace(/人物大小/g, '主体大小')
    .replace(/人物比例/g, '下半身比例')
    .replace(/模特/g, '下半身主体')
    .replace(/胸口以上区域不进入画面，?/g, '')
}

const PANTS_LOWER_BODY_PRODUCT_FRAME_RULE =
  '下半身商品图模式：图1如果只上传腰胯以下或下半身局部，输出必须保持同类下半身裁切；主体限定为腰胯、裤身、膝盖、小腿、脚踝、鞋子和图1边界内已有上衣局部；不要扩展成完整人像，不要根据人体常识补齐画面外身体结构。'

function buildPantsAngleInstruction(
  view: PantsPoseView | undefined,
  shotIndex: number,
  resultCount: PhotoFissionResultCount,
): string {
  if (view === 'front') {
    return '身体角度：正面为主要可见面，可微左或微右0°-15°，不能变成明确侧面或背面。'
  }
  if (view === 'back') {
    return '身体角度：背面为主要可见面，可微左或微右0°-15°，不能变成正面或明确侧面。'
  }
  if (view === 'side') {
    return '身体角度：明确侧面，可朝向左侧或右侧约60°，允许45°-75°，不能变成纯正面或纯背面。'
  }
  if (view !== 'left' && view !== 'right') return ''

  const direction = view === 'left' ? '左侧' : '右侧'
  const baseAngle = getPantsSideBaseAngle(view, shotIndex, resultCount)
  const rangeText = getPantsAngleRangeText(baseAngle)
  const directionAnchor =
    view === 'left'
      ? '鞋尖、膝盖、裤侧缝和裤腿外轮廓整体朝画面左侧；不能为了显示正面 logo 把左侧画成右侧或正面，右腿/正面 logo 没有左侧证据时应变窄、转到边缘或不可见。'
      : '鞋尖、膝盖、裤侧缝和裤腿外轮廓整体朝画面右侧；不能为了显示正面 logo 把右侧画成左侧或正面，左腿/正面 logo 没有右侧证据时应变窄、转到边缘或不可见。'
  return `身体角度：朝向${direction}约${baseAngle}°，允许${rangeText}。${directionAnchor}`
}

function getPantsSideBaseAngle(
  view: Extract<PantsPoseView, 'left' | 'right'>,
  shotIndex: number,
  resultCount: PhotoFissionResultCount,
): 30 | 60 | 90 {
  if (resultCount === 10) {
    const angles = [30, 60, 90] as const
    const startIndex = view === 'left' ? 4 : 7
    return angles[shotIndex - startIndex] ?? 60
  }
  if (resultCount === 9) {
    const startIndex = view === 'left' ? 4 : 7
    const angles =
      view === 'left'
        ? ([30, 60, 90] as const)
        : ([60, 90] as const)
    return angles[shotIndex - startIndex] ?? 60
  }
  return 60
}

function getPantsAngleRangeText(baseAngle: 30 | 60 | 90): string {
  if (baseAngle === 30) return '15°-45°'
  if (baseAngle === 60) return '45°-75°'
  return '75°-95°（最高不超过95°）'
}

function buildCompactPantsReferenceSection(input: BuildShotPromptInput): string {
  const targetView = input.pantsView ?? 'front'
  const isLowerBodyOnlyPants =
    (input.pantsMainHandVisibility ?? 'hidden') === 'hidden'
  const targetAngle = getPantsReferenceAngleForView(targetView)
  const targetLabel =
    targetView === 'left'
      ? '左侧'
      : targetView === 'right'
        ? '右侧'
        : getPantsAngleLabel(targetAngle)
  const referenceSlots = getPantsShotReferenceSlots(
    {
      hasFrontDetail: input.hasFrontDetail,
      hasSideDetail: input.hasSideDetail,
      hasBackDetail: input.hasBackDetail,
      frontDetailCount: input.frontDetailCount,
      sideDetailCount: input.sideDetailCount,
      backDetailCount: input.backDetailCount,
    },
    targetView,
  )
  const lines = [
    '【参考图】',
    isLowerBodyOnlyPants
      ? `参考图里的腿脚站姿必须被忽略，只锁定裤子外观、结构和图案。图1主图是下半身裁切基准。${PANTS_LOWER_BODY_PRODUCT_FRAME_RULE}`
      : '参考图里的人物站姿必须被忽略，只锁定裤子外观、结构和图案。',
  ]

  if (referenceSlots.length === 0) {
    lines.push(
      `本镜头没有可用${targetLabel}细节图，${targetLabel}商品元素只按图1清楚可见证据保守呈现；不得从其它角度推测或迁移 logo、图案、口袋、刺绣、贴布和拼接。`,
    )
    return lines.join('\n')
  }

  const grouped = referenceSlots.reduce<Record<string, number>>((acc, slot) => {
    const label = getPantsAngleLabel(slot.angle)
    acc[label] = (acc[label] ?? 0) + 1
    return acc
  }, {})
  const summary = Object.entries(grouped)
    .map(([label, count]) => `${count} 张${label}参考`)
    .join('、')
  const targetCount = referenceSlots.filter(
    (slot) => slot.angle === targetAngle,
  ).length

  lines.push(
    `本镜头可用商品细节图：${summary}。${targetLabel}细节图只锁定图中清楚可见的颜色、材质、纹理、图案、logo、刺绣、贴布、拼接、口袋、裤脚或侧缝；不控制腿脚姿势、身体朝向、构图边界、主体大小或完整裤身轮廓。`,
  )
  lines.push(
    targetCount > 0
      ? `当前共有 ${targetCount} 张${targetLabel}细节图；局部放大图只证明拍到的局部存在，不能扩展成另一条腿、另一侧、背面或整条裤子的结构。logo、图案、刺绣、贴布、拼接和口袋不得换腿、换面、镜像或移动位置。`
      : `当前没有${targetLabel}细节图，${targetLabel}商品元素只按图1清楚可见证据保守呈现；其它角度不能代替${targetLabel}结构证据。`,
  )
  if (targetAngle === 'back') {
    lines.push('背面细节图没有明确后袋、袋盖、贴袋轮廓、logo、图案或口袋缝线时，背面保持连续整片面料，禁止新增或从其它角度迁移。')
  }
  return lines.join('\n')
}

function compactPantsPromptText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized

  const sentenceBoundary = Math.max(
    normalized.lastIndexOf('。', maxLength),
    normalized.lastIndexOf('；', maxLength),
    normalized.lastIndexOf('.', maxLength),
  )
  if (sentenceBoundary >= Math.floor(maxLength * 0.6)) {
    return normalized.slice(0, sentenceBoundary + 1)
  }
  return `${normalized.slice(0, maxLength).trim()}。`
}

function buildPantsAssignedPoseSection(
  assignedPose: PantsPoseCard,
  pantsMainHandVisibility: PantsMainHandVisibility,
): string {
  const handRule =
    pantsMainHandVisibility === 'visible'
      ? '主图露手模式：按图1保留可见手部数量、手臂可见范围、上衣袖长、袖口和上衣款式，只执行上述手部候选。'
      : PANTS_LOWER_BODY_PRODUCT_FRAME_RULE
  return [
    '【本镜头唯一指定姿势｜最高优先级】',
    buildPantsAssignedPoseInstruction(assignedPose, {
      mainHandVisibility: pantsMainHandVisibility,
    }),
    `必须执行上述腿部、重心、脚掌落点和肉眼可见差异点；${handRule}不得参考其它姿势库或创造相似替代动作。姿势引起的自然褶皱、裤脚高度投影和鞋脚遮挡变化可以存在，但裤长、裤型、裤脚宽度、上衣和商品结构保持不变。`,
  ].join('\n')
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
      ? '- 图1：主图基准（这套连衣裙的视觉锚点，承载穿搭比例、发型、发饰、服装款式、材质类别与商品结构；五官特征不从此图读取，以人像小卡为准）'
      : isSuitOutdoorShot
        ? '- 图1：主图基准（这套童装套装的视觉锚点，承载穿搭比例、发型、发饰、上衣裤装成套关系、材质类别与商品结构；五官特征不从此图读取，以人像小卡为准）'
        : '- 图1：主图基准（这套服装的视觉锚点，承载穿搭比例、发型、发饰、服装细节、场景与光线；五官特征不从此图读取，以人像小卡为准）'
  } else {
    mainImageLine = isDressOutdoorShot
      ? '- 图1：主图基准（这套连衣裙与这位小女孩的视觉锚点，承载人物身份、服装款式、材质类别与商品结构；当前镜头抽中无云蓝天草地外景卡，场景不能出现云）'
      : isSuitOutdoorShot
        ? '- 图1：主图基准（这套童装套装与这位模特的视觉锚点，承载人物身份、上衣裤装成套关系、材质类别与商品结构；当前镜头抽中晴朗夏日蓝天绿草地真实外景补充卡，场景不出现白云）'
        : '- 图1：主图基准（这套服装与这位模特的视觉锚点，承载身份、服装、场景、光线的全部细节）'
  }
  const lines: string[] = [
    '【参考图说明】',
    mainImageLine,
  ]
  let nextIndex = 2
  if (hasFrontDetail) {
    lines.push(
      `- 图${nextIndex}：这套服装的正面细节参考（颜色、材质类别、主要图案、领口、扣件、logo、纽扣、口袋和正面结构以此为准）`,
    )
    nextIndex += 1
  }
  if (hasBackDetail) {
    lines.push(
      `- 图${nextIndex}：这套服装的背面细节参考（背部颜色、材质类别、主要图案、剪裁、印花、肩线、背部扣件和背面结构以此为准）`,
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
    '图像质量要求：服装表面必须干净清晰，绝对禁止生成横向扫描线、横向条纹伪影、摩尔纹、水波纹、密集平行线、屏幕纹、压缩噪声、马赛克、色块、条带状伪影或任何规则重复的横向/纵向纹理失真。布料纹理必须是真实自然的织物质感，不是像素级规则线条。',
    '人物穿着这套服装，完整延续这套服装的版型、图案、logo、纽扣、口袋、领口、袖口与下摆细节。',
    '颜色、材质类别、主要图案和商品结构的参考优先级：如果有正面/背面细节图，颜色、材质类别、主要图案和商品结构以细节图为准；如果没有细节图，才以图1主图为准。',
    '参考图中真实存在的材质特征才保留；参考图没有的棉麻肌理、纱层、粗织纹、针织纹或额外纹理不得新增。',
    '服装版型、拼布色块、主要图案、领口、腰线、下摆与配饰清晰可见，不增加、不减少、不替换任何服装元素；微细纹理不作为强制复刻目标。',
    '布料表面质感要求：参考真实摄影作品中的自然布料纹理，避免 AI 生成常见的横向扫描伪影、规则重复线条、数字噪声和失真纹理。服装表面应当光滑自然或具有真实织物肌理，不应出现像透过屏幕拍摄产生的摩尔纹或扫描设备产生的条带。',
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

function isPantsChildrensCategory(
  category: PhotoFissionCategory,
  childrensCategory?: PhotoFissionChildrensCategory,
): childrensCategory is 'pants' {
  return category === 'childrens' && childrensCategory === 'pants'
}

function getPantsDetailAvailability(
  params: PhotoFissionParams,
): PantsDetailAvailability {
  return {
    hasFrontDetail: params.hasFrontDetail,
    hasSideDetail: Boolean(params.hasSideDetail),
    hasBackDetail: params.hasBackDetail,
    frontDetailCount:
      params.frontDetailCount ?? (params.hasFrontDetail ? 1 : 0),
    sideDetailCount:
      params.sideDetailCount ?? (params.hasSideDetail ? 1 : 0),
    backDetailCount:
      params.backDetailCount ?? (params.hasBackDetail ? 1 : 0),
  }
}

function getPantsShotReferenceText(
  params: PhotoFissionParams,
  shot: PhotoFissionShot,
): string {
  const blueprint = getPantsShotBlueprintForCount(params.resultCount)[shot.order - 1]
  return blueprint
    ? `${blueprint.label} ${blueprint.description}`
    : `${shot.label} ${shot.prompt}`
}

function getPantsShotView(
  params: PhotoFissionParams,
  shot: PhotoFissionShot,
): PantsPoseView {
  return (
    getPantsShotBlueprintForCount(params.resultCount)[shot.order - 1]?.view ??
    'front'
  )
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
      ? '专业儿童电商时尚外景摄影，清晰但自然的商品摄影质感，自然明亮的户外柔光均匀打亮人物和服装；画面清爽干净，商品结构、主要图案和裙身轮廓清楚，整体像可直接上架的童装连衣裙外景补充素材。'
      : '专业儿童电商时尚摄影，清晰但自然的商品摄影质感，影棚柔和柔光，光线均匀打亮人物和服装；画面干净柔和，商品结构、主要图案和裙身轮廓清楚，整体像可直接上架的童装连衣裙商品素材。'
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
      ? '专业儿童电商套装真实外景摄影，清晰但柔和的商品摄影质感，自然户外散射光均匀打亮人物和套装；晴朗夏日蓝天和真实绿草地只作为清爽低存在感陪衬，场景不出现白云，草地避免塑料草坪、假草皮、重复贴图和过饱和荧光绿，上衣廓形、下摆、裤长、裤脚、鞋型和成套比例清楚，整体像可直接用于淘宝轮播图或详情页的童装套装外景补充素材。'
      : '专业电商套装摄影，清晰但自然的商品摄影质感，背景、光线和画面风格沿用图1；通过姿态和构图突出上衣廓形、裤装轮廓、裤长裤脚、鞋子和成套比例，整体像可直接上架的套装商品素材。'
    return [
      '【画面质感 STYLE】',
      styleSummary,
      SUIT_STYLE_ANCHOR,
    ].join('\n')
  }
  const lines = [
    '【画面质感 STYLE】',
    `${cinematicPrefix}写实风格摄影，色彩饱和度适中，主体清晰自然，服装结构与主要图案清晰可见，真实材质特征自然保留，具有电影感的逼真渲染效果，整体氛围接近时尚杂志的经典大片风格。`,
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
    '【最高优先级 - 绝对禁止的图像伪影】横向扫描线、横向条纹、摩尔纹、水波纹、网格纹、屏幕纹、密集平行细线、规则重复的横向或纵向线条、压缩噪声、马赛克、色块、条带状失真。服装和皮肤表面必须干净自然，不能有任何规则的人工线条纹理、扫描痕迹或数字伪影。',
    `不改变这套服装的颜色、版型、材质、图案与 logo；${faceConstraint}画面场景与背景严格沿用参考图原本拍摄环境，保持风格、色调、光线方向一致，不随意替换或新增场景元素。`,
    '不要生成：文字、水印、品牌印章、多余人物、多宫格拼接，不要变成卡通/插画/动漫/3D 渲染风格。',
    '参考图已有的手持物（包包、花束、帽子、眼镜、饮品杯等随身搭配）必须在大部分生成图中保留：可以拿在手里、挎在肩上作为正常穿搭，或放置在地面远处（远离模特身体、靠近画面边缘、只作为环境点缀，不能紧贴腿部、裤脚或鞋子）。手持物必须保持真实尺寸比例、极低存在感、不抢服装主体、不遮挡服装关键部位（领口、腰线、版型结构、裤脚、裙摆、鞋子）、不影响人物姿态和商品展示。只有极少数图片（2张模式中1张、4张模式中1-2张、9/10张模式中1-2张）可以完全不出现手持物。',
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
  signal?: AbortSignal
  onShotProgress?: (shotId: string, message: string, retryAttempt?: number) => void
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
  /** 失败错误类别，用于日志与最终错误提示。 */
  errorCategory?: string
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
        signal: options.signal,
        onShotProgress: options.onShotProgress,
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
              signal: options.signal,
              onShotProgress: options.onShotProgress,
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
  signal?: AbortSignal
  onShotProgress?: (shotId: string, message: string, retryAttempt?: number) => void
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
    signal,
    onShotProgress,
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
      if (signal?.aborted) return

      const shot = shots[currentIndex]
      const globalIndex = shotIndexMap.get(shot.shotId)
      if (globalIndex === undefined) continue

      try {
        const isPantsTask = isPantsChildrensCategory(
          params.category,
          params.childrensCategory,
        )
        const pantsAvailability = isPantsTask
          ? getPantsDetailAvailability(params)
          : null
        const pantsView = isPantsTask ? getPantsShotView(params, shot) : undefined
        const shotInputImages = pantsAvailability
          ? selectPantsShotInputImages(
              inputImages,
              pantsAvailability,
              pantsView ?? 'front',
            )
          : inputImages
        const inputImageLabels = pantsAvailability
          ? getPantsShotInputImageLabels(pantsAvailability, pantsView ?? 'front')
          : undefined
        const single = await runImageEditViaProvider({
          taskId,
          provider,
          fallbackApiKey: apiKey,
          model: params.model,
          prompt: shot.prompt,
          inputImages: shotInputImages,
          inputImageLabels,
          count: 1,
          aspectRatio,
          imageSize,
          traceId: `${taskId}_${shot.shotId}`,
          shotId: shot.shotId,
          signal,
          onRetryAttempt: (attempt) => {
            onShotProgress?.(shot.shotId, `第 ${attempt} 次重跑中...`, attempt)
          },
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
        const errorCategory =
          error instanceof GoogleImageError ? error.category : undefined
        // wrapper 已经在 gimg.fail 里打过结构化日志，这里仅记录 shot 级 result 供上层 partial 判定
        allShotResults[globalIndex] = {
          shot,
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

function readProviderDefaultConcurrency(provider: ImageProvider): number {
  if (provider.type === 'openai') {
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

function readPhotoFissionDetailCount(
  value: unknown,
  legacyHasDetail: boolean,
  max: number,
  errorMessage: string,
): number {
  if (value === undefined || value === null || value === '') {
    return legacyHasDetail ? 1 : 0
  }
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  ) {
    return value
  }
  throw new Error(errorMessage)
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

function readPantsMainHandVisibility(value: unknown): PantsMainHandVisibility {
  if (value === undefined || value === null || value === '') return 'hidden'
  if (value === 'hidden' || value === 'visible') return value
  throw new Error('裤子主图露手参数无效')
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

function getRecentPantsPoseHints(params: PhotoFissionParams): string[] {
  if (!isPantsChildrensCategory(params.category, params.childrensCategory)) {
    return []
  }
  const key = buildPantsPoseHistoryKey(params)
  const state = pantsPoseHistoryByKey.get(key)
  if (!state) return []

  const cyclePosition = state.generationCount % PANTS_POSE_CYCLE_LENGTH
  if (cyclePosition === 0) {
    return []
  }
  if (cyclePosition >= PANTS_POSE_RESTRICTED_GENERATIONS) {
    return []
  }
  return [...new Set(state.generations.flat())]
}

function rememberSuitActionHints(
  params: PhotoFissionParams,
  shots: ReadonlyArray<{ role: string; imagePrompt: string | import('@/lib/types').StructuredImagePrompt }>,
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
  shots: ReadonlyArray<{ role: string; imagePrompt: string | import('@/lib/types').StructuredImagePrompt }>,
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

function rememberPantsPoseHints(
  params: PhotoFissionParams,
  shots: ReadonlyArray<{ role: string; imagePrompt: string | import('@/lib/types').StructuredImagePrompt }>,
): void {
  if (!isPantsChildrensCategory(params.category, params.childrensCategory)) {
    return
  }
  const key = buildPantsPoseHistoryKey(params)
  const current = pantsPoseHistoryByKey.get(key) ?? {
    generationCount: 0,
    generations: [],
  }
  const cyclePosition = current.generationCount % PANTS_POSE_CYCLE_LENGTH
  const nextHints = extractPantsPoseHints(shots)
  const nextGenerations =
    cyclePosition < PANTS_POSE_RESTRICTED_GENERATIONS && nextHints.length > 0
      ? [
          ...(cyclePosition === 0 ? [] : current.generations),
          nextHints,
        ].slice(-PANTS_POSE_RESTRICTED_GENERATIONS)
      : current.generations

  pantsPoseHistoryByKey.set(key, {
    generationCount: current.generationCount + 1,
    generations: nextGenerations,
  })
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

function buildPantsPoseHistoryKey(params: PhotoFissionParams): string {
  return [
    params.category,
    params.childrensCategory ?? 'none',
    params.resultCount ?? 10,
    params.imageRatio,
    params.referenceAssetKey ?? 'unknown-reference',
  ].join(':')
}

function extractSuitActionHints(
  shots: ReadonlyArray<{ role: string; imagePrompt: string | import('@/lib/types').StructuredImagePrompt }>,
): string[] {
  const hints = new Set<string>()
  for (const shot of shots) {
    const promptText =
      typeof shot.imagePrompt === 'string'
        ? shot.imagePrompt
        : `${shot.imagePrompt.pose} ${shot.imagePrompt.expression}`
    const text = `${shot.role} ${promptText}`
    for (const [pattern, hint] of SUIT_ACTION_HINT_PATTERNS) {
      if (pattern.test(text)) {
        hints.add(hint)
      }
    }
  }
  return [...hints].slice(0, 12)
}

function extractDressActionHints(
  shots: ReadonlyArray<{ role: string; imagePrompt: string | import('@/lib/types').StructuredImagePrompt }>,
): string[] {
  const hints = new Set<string>()
  for (const shot of shots) {
    const promptText =
      typeof shot.imagePrompt === 'string'
        ? shot.imagePrompt
        : `${shot.imagePrompt.pose} ${shot.imagePrompt.expression}`
    const text = `${shot.role} ${promptText}`
    for (const [pattern, hint] of DRESS_ACTION_HINT_PATTERNS) {
      if (pattern.test(text)) {
        hints.add(hint)
      }
    }
  }
  return [...hints].slice(0, 14)
}

function extractPantsPoseHints(
  shots: ReadonlyArray<{ role: string; imagePrompt: string | import('@/lib/types').StructuredImagePrompt }>,
): string[] {
  const hints = new Set<string>()
  for (const shot of shots) {
    const promptText =
      typeof shot.imagePrompt === 'string'
        ? shot.imagePrompt
        : `${shot.imagePrompt.pose} ${shot.imagePrompt.expression}`
    const text = `${shot.role} ${promptText}`
    for (const [pattern, hint] of PANTS_POSE_HISTORY_PATTERNS) {
      if (pattern.test(text)) {
        hints.add(hint)
      }
    }
  }
  return [...hints].slice(0, 12)
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
  // 结构化 JSON 格式直接返回，不需要 refine
  if (typeof card.imagePrompt !== 'string') {
    return card
  }
  const role = sanitizeSuitExpressionText(card.role).trim()
  let imagePrompt = sanitizeSuitExpressionText(card.imagePrompt).trim()
  imagePrompt = sanitizeSuitLegText(imagePrompt)
  imagePrompt = appendSuitLegVariation(imagePrompt, shotIndex)
  imagePrompt = appendSuitFaceQualityGuard(imagePrompt)
  return { role, imagePrompt }
}

function refineDressPlannerCard(card: PlannerPromptCard): PlannerPromptCard {
  // 结构化 JSON 格式直接返回，不需要 refine
  if (typeof card.imagePrompt !== 'string') {
    return card
  }
  const role = sanitizeDressPoseText(card.role).trim()
  const imagePrompt = appendDressPoseFaceQualityGuard(
    sanitizeDressPoseText(card.imagePrompt).trim(),
  )
  return { role, imagePrompt }
}

function refinePantsPlannerCard(
  card: PlannerPromptCard,
  view: PantsPoseView,
  _assignedPose: PantsPoseCard,
  pantsMainHandVisibility: PantsMainHandVisibility,
): PlannerPromptCard {
  const role = sanitizePantsCropText(card.role).trim()
  const rawImagePrompt =
    typeof card.imagePrompt === 'string' ? card.imagePrompt : ''
  const croppedPrompt = sanitizePantsCropText(rawImagePrompt).trim()
  const handSafePrompt =
    pantsMainHandVisibility === 'hidden'
      ? removeVisiblePantsHandText(croppedPrompt)
      : croppedPrompt
  const poseSafePrompt = removeForbiddenPantsHandText(
    handSafePrompt,
    view,
  )
  const poseFreePrompt = removePantsPoseTextFromPlannerPrompt(poseSafePrompt)
  return { role, imagePrompt: poseFreePrompt }
}

const PANTS_VISIBLE_HAND_ACTION_PATTERN =
  /手部候选|手部动作|手势|手臂|手掌|手指|双手|单手|一手|另一手|两只手|手腕|手肘|前臂|抱臂|交叉抱|搭腰|扶腰|叉腰|插袋|插兜|捏腰头|扶后腰|低位|侧展|轻抬|隐藏|收在身后|背在身后|袖口.*手/

function removeVisiblePantsHandText(text: string): string {
  return text
    .split(/(?<=[。！？；])/u)
    .filter((sentence) => !PANTS_VISIBLE_HAND_ACTION_PATTERN.test(sentence))
    .join('')
    .trim()
}

function removeForbiddenPantsHandText(
  text: string,
  view: PantsPoseView,
): string {
  const directionPatterns: RegExp[] =
    view === 'back'
      ? [
          /后腰.*(?:交握|交叠)|(?:交握|交叠).*后腰/,
          /双腕.*(?:靠拢|相碰)/,
          /双手.*身后低位/,
        ]
      : view === 'left' || view === 'right' || view === 'side'
        ? [
            /手(?:掌|臂).*裤缝|裤缝.*手(?:掌|臂)/,
            /手指.*侧缝|侧缝.*手指/,
            /手掌.*大腿外侧|大腿外侧.*手掌/,
            /低位自然平衡|自然前后摆动/,
          ]
        : [
            /双手.*(?:小腹|裆部|裤面).*(?:贴压|紧贴|覆盖|遮挡)/,
            /(?:贴压|紧贴|覆盖|遮挡).*(?:腰头|裆部|裤面)/,
          ]
  return text
    .split(/(?<=[。！？；])/u)
    .filter(
      (sentence) =>
        !PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN_PATTERN.test(sentence) &&
        !directionPatterns.some((pattern) => pattern.test(sentence)),
    )
    .join('')
    .trim()
}

const PANTS_PLANNER_POSE_TEXT_PATTERN =
  /指定姿势卡|执行姿势卡|姿势卡|指定姿势|视觉动作族|腿脚视觉族|视觉族|肉眼可见差异点|必须看出|禁止退化|动作族|脚尖|脚跟|脚后跟|前脚|后脚|前后脚|双脚|双腿|支撑脚|支撑腿|重心|错步|错开|交叉步|交叉腿|交叉抱|迈步|行走|蹬地|屈膝|抬腿|抬脚|脚掌|站距|跨步|弓步|开放三角|平行站|并排站|并排平放|分腿|宽站|窄站|站姿|腿部必须|台阶|栏杆|扶手|透明金属椅|椅子|台面/

/**
 * 去冲突：删除 planner imagePrompt 里一切腿脚/重心/支撑物/姿势卡引用句。
 * 让最终 prompt 的【本张镜头】只保留方向家族与商品展示，姿势只由后端注入的
 * 唯一指定姿势卡（【姿势】段）提供，避免两套姿势互相打架导致正侧面塌缩成同款站姿。
 */
function removePantsPoseTextFromPlannerPrompt(text: string): string {
  return text
    .split(/(?<=[。！？；\n])/u)
    .filter((sentence) => !PANTS_PLANNER_POSE_TEXT_PATTERN.test(sentence))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasForbiddenPositivePantsHandText(text: string): boolean {
  return text
    .split(/(?<=[。！？；])/u)
    .some(
      (sentence) =>
        PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN_PATTERN.test(sentence) &&
        !isPantsNegativeGuardSentence(sentence),
    )
}

function repairForbiddenPositivePantsHandText(text: string): string {
  const repaired = text
    .split(/(?<=[。！？；])/u)
    .filter(
      (sentence) =>
        !PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN_PATTERN.test(sentence) ||
        isPantsNegativeGuardSentence(sentence),
    )
    .join('')
    .trim()
  return repaired || text
}

function isPantsNegativeGuardSentence(sentence: string): boolean {
  return /禁止|不得|不能|不要|避免|不允许|不再|只禁止|禁用|关键约束|红线|负面|硬锁|不出现|不露手|不露出/.test(
    sentence,
  )
}

function enforcePantsAssignedPose(
  text: string,
  assignedPose: PantsPoseCard,
  pantsMainHandVisibility: PantsMainHandVisibility,
): string {
  const handRule =
    pantsMainHandVisibility === 'visible'
      ? '主图露手模式：按图1保留可见手部数量、手臂可见范围、上衣袖长、袖口和上衣款式，只执行上述手部候选。'
      : PANTS_LOWER_BODY_PRODUCT_FRAME_RULE
  const guard = [
    '【本镜头唯一指定姿势｜最高优先级】',
    buildPantsAssignedPoseInstruction(assignedPose, {
      mainHandVisibility: pantsMainHandVisibility,
    }),
    `必须执行上述腿部、重心、脚掌落点和肉眼可见差异点；${handRule}最终以本段指定姿势为准，不参考其它姿势库，不创造相似替代动作。商品参考图只锁定裤子外观和角度结构，不复制参考图站姿；指定姿势可以自然改变裤脚垂坠、褶皱、鞋子露出程度和脚部遮挡关系。`,
  ].join('')
  return `${guard}${text}`
}

const PANTS_POSE_ID_PREFIX_BY_VIEW: Record<PantsPoseView, string> = {
  front: 'front-',
  left: 'left-',
  right: 'right-',
  back: 'back-',
  side: '',
}

function resolvePantsAssignedPose(
  card: { poseCardId?: string },
  persistedPoseCardId: string | undefined,
  expectedView: PantsPoseView,
  resultCount: PhotoFissionResultCount,
  shotId: string,
  mainHandVisibility: PantsMainHandVisibility,
): PantsPoseCard {
  const candidateId = card.poseCardId ?? persistedPoseCardId
  if (candidateId) {
    try {
      const candidate = getPantsPoseCardById(candidateId)
      const expectedPrefix = PANTS_POSE_ID_PREFIX_BY_VIEW[expectedView]
      if (expectedPrefix && !candidateId.startsWith(expectedPrefix)) {
        console.warn(
          JSON.stringify({
            lvl: 'warn',
            evt: 'planner.pants-pose-direction-mismatch',
            shotId,
            poseCardId: candidateId,
            expectedView,
          }),
        )
      } else {
        return candidate
      }
    } catch {
      console.warn(
        JSON.stringify({
          lvl: 'warn',
          evt: 'planner.pants-pose-not-found',
          shotId,
          poseCardId: candidateId,
        }),
      )
    }
  }
  return getPantsAssignedPoseForShot(
    resultCount,
    shotId,
    undefined,
    mainHandVisibility,
  )
}

function appendPantsPoseDirectionGuard(
  text: string,
  view: PantsPoseView,
): string {
  const guard = [
    `裤子镜头方向硬约束：${getPantsPoseDirectionRule(view)}`,
    '姿势只能执行“本镜头唯一指定姿势”段落，不得再学习其它姿势卡、相似姿势、参考图站姿或同方向库外姿势；只允许按指定卡改变重心、脚掌落点和方向家族内的微侧幅度，不跨方向。商品参考图不控制腿脚站法。',
    PANTS_MAIN_EVIDENCE_RULE,
  ].join('')
  return appendSentence(text, guard)
}

function sanitizePantsCropText(text: string): string {
  return text
    .replace(/童装裤子/g, '裤子')
    .replace(/童装/g, '')
    .replace(/儿童身体比例|儿童体型比例|儿童比例/g, '图1身体比例')
    .replace(/儿童年龄感|年龄感/g, '图1人物状态')
    .replace(/腰头、门襟区域、前片结构/g, '正面真实结构')
    .replace(/门襟区域|门襟|扣件|装饰扣|纽扣|扣子|拉链|抽绳|松紧带|铆钉|口袋|前袋|后袋|侧袋|侧缝/g, '参考图真实结构')
    .replace(/裤脚不被遮挡|鞋子完整展示|鞋子完整可见|鞋型完整可见/g, '裤脚与鞋脚遮挡可随指定姿势自然变化')
    .replace(/从主图实际露出的最高位置到脚底完整入镜/g, '画面下边缘与主图一致')
    .replace(/到脚底完整入镜|脚底完整入镜/g, '且画面下边缘与主图一致')
    .replace(/完整人物全身照/g, '主图边界裤子商品图')
    .replace(/全身商品图/g, '主图边界商品图')
    .replace(/全身站姿/g, '主图腿部状态')
    .replace(/全身入镜/g, '画面上下边界与主图一致')
    .replace(/全身照/g, '主图边界商品图')
    .replace(/完整上半身/g, '主图实际露出的上衣范围')
    .replace(/头部顺着身体方向自然朝前[^。；]*[。；]?/g, '')
}

function appendPantsCropGuard(text: string): string {
  const guard = `裤子模式强制锁定：画面边界、相机距离、人物大小、身体比例和腿长必须与图1主图一致。裤子穿着版型、裤长基准、裤脚宽度和商品结构以图1及当前镜头实际参考图为准；腿脚站法只执行本镜头唯一指定姿势，参考图站姿不得覆盖指定姿势。指定腿脚动作可以自然改变裤脚垂坠、褶皱、鞋子露出程度和脚部遮挡关系，脚或鞋允许被裤脚遮挡且不要求完整展示。商品图案、刺绣、logo、拼接和其它真实结构只按本镜头实际提供的参考图中可见状态复现，参考图没有就不要生成，不凭常见裤装经验补结构。不要扩展图1边界外的头部、脸部、五官或完整发型；图1边界内已有少量发丝只保持原发色和相近可见范围。人物状态只根据图1，不按品类标签改写。${PANTS_MAIN_EVIDENCE_RULE}`
  if (/裤子模式强制(?:构图|锁定)/.test(text)) {
    return text
  }
  return appendSentence(text, guard)
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
    : isDressChildrensCategory(params.category, params.childrensCategory)
      ? getRecentDressActionHints(params)
      : isPantsChildrensCategory(params.category, params.childrensCategory)
        ? getRecentPantsPoseHints(params)
        : []
  const plan = buildPlannerRulePlan(
    params.category,
    params.childrensCategory,
    params.resultCount,
    recentActionHints,
    Boolean(params.faceIdModelId),
    getFaceIdImageIndexFromParams(params),
    isPantsChildrensCategory(params.category, params.childrensCategory)
      ? getPantsDetailAvailability(params)
      : undefined,
  )
  if (!plan) {
    throw new Error('生成失败：当前服装大片裂变仅支持童装连衣裙、套装和裤子')
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
  const isPantsTask = isPantsChildrensCategory(
    params.category,
    params.childrensCategory,
  )
  const rememberedSuitShots: PlannerPromptCard[] = []
  const rememberedDressShots: PlannerPromptCard[] = []
  const rememberedPantsShots: PlannerPromptCard[] = []
  const pantsPoseTextLeakShots: string[] = []
  let overridden = 0
  for (const card of output.shots) {
    const idx = indexByShotId.get(card.shotId)
    if (idx === undefined) continue
    const pantsView = isPantsTask
      ? getPantsShotView(params, fullPlan[idx])
      : undefined
    const persistedPantsPoseCardId = isPantsTask
      ? fullPlan[idx].pantsPoseCardId ??
        fullPlan[idx].prompt.match(/指定姿势卡\s+([a-z0-9-]+)/)?.[1]
      : undefined
    const pantsMainHandVisibility: PantsMainHandVisibility =
      fullPlan[idx].pantsMainHandVisibility ??
      (fullPlan[idx].pantsMayRevealHandsWhenMainHidden
        ? 'visible'
        : params.pantsMainHandVisibility ?? 'hidden')
    const assignedPantsPose = isPantsTask
      ? resolvePantsAssignedPose(
          card,
          persistedPantsPoseCardId,
          pantsView ?? 'front',
          params.resultCount,
          card.shotId,
          pantsMainHandVisibility,
        )
      : undefined
    const plannerCard = isSuitTask
      ? refineSuitPlannerCard(card, idx)
        : isDressTask
          ? refineDressPlannerCard(card)
          : isPantsTask
            ? refinePantsPlannerCard(
                card,
                pantsView ?? 'front',
                assignedPantsPose!,
                pantsMainHandVisibility,
              )
            : card
    const pantsShotText = isPantsTask
      ? getPantsShotReferenceText(params, fullPlan[idx])
      : ''
    const pantsShotAvailability = isPantsTask
      ? getPantsShotDetailAvailability(
          getPantsDetailAvailability(params),
          pantsView ?? 'front',
        )
      : undefined
    const plannerPromptRaw =
      typeof plannerCard.imagePrompt === 'string' ? plannerCard.imagePrompt : ''
    const plannerPrompt = pantsShotAvailability
      ? sanitizePantsPlannerReferenceText(
          plannerPromptRaw,
          pantsShotAvailability,
        )
      : plannerPromptRaw
    if (isPantsTask && PANTS_PLANNER_POSE_TEXT_PATTERN.test(plannerPrompt)) {
      pantsPoseTextLeakShots.push(card.shotId)
    }
    const nextLabel = isPantsTask
      ? fullPlan[idx].label
      : plannerCard.role.trim()
    const detailLockParams = pantsShotAvailability
      ? { ...params, ...pantsShotAvailability, pantsView }
      : params
    let next: string
    let nextIsJsonPrompt = false
    if (isPantsTask && assignedPantsPose) {
      next = buildCompactPantsShotPrompt({
        label: nextLabel || fullPlan[idx].label,
        shotDescription: plannerPrompt || pantsShotText || fullPlan[idx].prompt,
        shotIndex: idx,
        category: params.category,
        childrensCategory: params.childrensCategory,
        imageRatio: params.imageRatio,
        resolution: params.resolution,
        resultCount: params.resultCount,
        hasFrontDetail:
          pantsShotAvailability?.hasFrontDetail ?? params.hasFrontDetail,
        hasSideDetail:
          pantsShotAvailability?.hasSideDetail ?? Boolean(params.hasSideDetail),
        hasBackDetail:
          pantsShotAvailability?.hasBackDetail ?? params.hasBackDetail,
        frontDetailCount:
          pantsShotAvailability?.frontDetailCount ?? params.frontDetailCount,
        sideDetailCount:
          pantsShotAvailability?.sideDetailCount ?? params.sideDetailCount,
        backDetailCount:
          pantsShotAvailability?.backDetailCount ?? params.backDetailCount,
        pantsView,
        pantsAssignedPose: assignedPantsPose,
        pantsMainHandVisibility,
        hasFaceIdModel: Boolean(params.faceIdModelId),
        faceIdImageIndex: getFaceIdImageIndexFromParams(params),
      })
    } else if (typeof plannerCard.imagePrompt !== 'string') {
      // 结构化对象 → JSON（生产基线行为）
      next = convertStructuredPromptToJson(plannerCard.imagePrompt, params)
      nextIsJsonPrompt = true
    } else {
      const plannerPromptWithLocks = appendFlatDetailReferenceLock(
        plannerPrompt,
        detailLockParams,
        `${plannerCard.role} ${pantsShotText || plannerPrompt}`,
      ).trim()
      if (!plannerPromptWithLocks) continue
      next = convertTextPromptToJson(
        plannerPromptWithLocks,
        params,
        nextLabel || fullPlan[idx].label,
      )
      nextIsJsonPrompt = true
    }
    if (!next) continue
    if (!nextIsJsonPrompt) {
      // Face ID lock: force-inject identity lock paragraph after planner rewrite
      next = appendFaceIdLock(next, params)
    }
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
    if (isPantsTask) {
      rememberedPantsShots.push({
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
  if (isSuitTask) {
    rememberSuitActionHints(
      params,
      rememberedSuitShots.length > 0 ? rememberedSuitShots : output.shots,
    )
  }
  if (isDressTask) {
    rememberDressActionHints(
      params,
      rememberedDressShots.length > 0 ? rememberedDressShots : output.shots,
    )
  }
  if (isPantsTask) {
    rememberPantsPoseHints(
      params,
      rememberedPantsShots.length > 0 ? rememberedPantsShots : output.shots,
    )
    const repairedForbiddenShots: string[] = []
    fullPlan.forEach((shot) => {
      if (!hasForbiddenPositivePantsHandText(shot.prompt)) return
      shot.prompt = repairForbiddenPositivePantsHandText(shot.prompt)
      repairedForbiddenShots.push(shot.shotId)
    })
    console.log(
      JSON.stringify({
        lvl:
          repairedForbiddenShots.length > 0 ||
          pantsPoseTextLeakShots.length > 0
            ? 'warn'
            : 'info',
        evt: 'planner.pants-diversity',
        ts: new Date().toISOString(),
        traceId: taskId,
        taskId,
        assignedPoseCards: fullPlan.map((shot) => ({
          shotId: shot.shotId,
          poseCardId:
            shot.pantsPoseCardId ??
            shot.prompt.match(/指定姿势卡\s+([a-z0-9-]+)/)?.[1] ??
            'unknown',
        })),
        repairedForbiddenPositiveHandShots: repairedForbiddenShots,
        poseTextLeakShots: pantsPoseTextLeakShots,
      }),
    )
  }

  // 裤子只展示胸部以下，不能套用带面部表情/发型替代池的多样性修复。
  if (!isPantsTask) {
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
 * 将 LLM 导演输出的结构化 imagePrompt 对象转换为 JSON 字符串格式。
 * 同时追加关键的反伪影约束和服装细节锁定规则。
 */
function convertStructuredPromptToJson(
  structured: import('@/lib/types').StructuredImagePrompt,
  params: PhotoFissionParams,
): string {
  const faceIdImageIndex = getFaceIdImageIndexFromParams(params)

  const jsonPrompt = {
    generation_request: {
      meta_data: {
        tool: "Gemini Image Generation",
        task_type: "ecommerce_childrens_fashion_photo",
        language: "zh-CN",
        priority: "highest"
      },
      scene: {
        description: structured.scene,
        environment: structured.background,
        framing: structured.framing
      },
      subject: {
        description: structured.subject,
        pose: structured.pose,
        expression: structured.expression,
        clothing: structured.clothing
      },
      identity_lock: faceIdImageIndex ? {
        face_priority: "absolute",
        face_reference_index: faceIdImageIndex,
        note: `图${faceIdImageIndex}提供脸型、五官、皮肤质感、发色；图1提供发型、刘海、帽子、发饰、服装`
      } : {
        face_reference: "图1",
        note: "延续参考图人物身份与面部特征"
      },
      wardrobe: {
        color_source: params.hasFrontDetail || params.hasBackDetail ? "细节图为准" : "图1为准",
        rules: [
          "完整延续版型、图案、logo、纽扣、口袋、领口、袖口、下摆",
          "参考图中真实存在的材质特征才保留",
          "图1已有配饰必须保留"
        ]
      },
      quality_control: {
        texture_requirement: structured.quality,
        surface_quality: "必须干净清晰",
        avoid: [
          "横向扫描线", "横向条纹伪影", "摩尔纹", "水波纹",
          "密集平行线", "屏幕纹", "压缩噪声", "马赛克",
          "色块", "条带状失真", "规则重复线条"
        ],
        note: "布料纹理必须是真实自然的织物质感，不是像素级规则线条"
      },
      negative_prompt: buildNegativeArray(
        params.category,
        params.childrensCategory,
        params.faceIdModelId ? true : false,
        faceIdImageIndex
      )
    }
  }

  return JSON.stringify(jsonPrompt, null, 2)
}

function convertTextPromptToJson(
  promptText: string,
  params: PhotoFissionParams,
  role: string,
): string {
  const faceIdImageIndex = getFaceIdImageIndexFromParams(params)
  const jsonPrompt = {
    generation_request: {
      meta_data: {
        tool: "Gemini Image Generation",
        task_type: "ecommerce_childrens_fashion_photo",
        language: "zh-CN",
        priority: "highest"
      },
      input: {
        mode: "image_to_image",
        reference_image_usage: "maximum",
        preserve_identity: true,
        preserve_clothing: true
      },
      identity_lock: faceIdImageIndex ? {
        face_priority: "absolute",
        face_reference_index: faceIdImageIndex,
        note: `图${faceIdImageIndex}提供脸型、五官、皮肤质感、发色；图1提供发型、刘海、帽子、发饰、服装`
      } : {
        face_reference: "图1",
        note: "延续参考图人物身份与面部特征"
      },
      prompt: {
        role,
        description: promptText
      },
      wardrobe: {
        color_source: params.hasFrontDetail || params.hasBackDetail ? "细节图为准" : "图1为准",
        rules: [
          "完整延续版型、图案、logo、纽扣、口袋、领口、袖口、下摆",
          "参考图中真实存在的材质特征才保留",
          "图1已有配饰必须保留"
        ]
      },
      category_requirements: buildCategoryConfig(params.category, params.childrensCategory),
      quality_control: {
        surface_quality: "必须干净清晰",
        avoid: [
          "横向扫描线", "横向条纹伪影", "摩尔纹", "水波纹",
          "密集平行线", "屏幕纹", "压缩噪声", "马赛克",
          "色块", "条带状失真", "规则重复线条"
        ],
        note: "布料纹理必须是真实自然的织物质感，不是像素级规则线条"
      },
      negative_prompt: buildNegativeArray(
        params.category,
        params.childrensCategory,
        params.faceIdModelId ? true : false,
        faceIdImageIndex
      )
    }
  }

  return JSON.stringify(jsonPrompt, null, 2)
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

  // 移除 planner 可能残留的"延续参考图"脸部指令
  let cleaned = prompt
  cleaned = cleaned.replace(/脸型五官和人物身份延续参考图[。；]/g, '')
  cleaned = cleaned.replace(/脸型五官延续参考图[。；]/g, '')
  cleaned = cleaned.replace(/人物脸部必须严格延续参考图[：:][^。；]+[。；]/g, '')
  cleaned = cleaned.replace(/脸部延续参考图[，,][^。；]+[。；]/g, '')
  cleaned = cleaned.replace(/面部仍保持参考图一致/g, '')
  cleaned = cleaned.replace(/脸部若可见仍保持参考图一致/g, '')

  // 精简版 Face ID 锁定指令（只在开头声明一次，避免重复）
  const prepend = `【多图参考分工】图${imgRef}提供脸部身份（脸型、五官、面部比例、皮肤质感、发色），图1提供发型、刘海、发长、帽子、发饰、服装、姿势、场景。生成时把图${imgRef}的脸融合到图1人物身上，不复制图${imgRef}的发型或服装。脸型骨骼、五官细节严格以图${imgRef}为准；表情可自然变化。图1已有配饰必须保留，不新增图1没有的头饰、眼镜、耳饰。\n\n`

  return `${prepend}${cleaned.trim()}`
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
