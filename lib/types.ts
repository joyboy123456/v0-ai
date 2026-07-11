import {
  AI_FASHION_DEMO_TASKS as YIBAI_AI_FASHION_DEMO_TASKS,
} from './yibai-demo-cases'

export type FeatureType =
  | 'ai-fashion-photo'
  | 'photo-fission'
  | 'pose-fission'

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'partial'
  | 'cancelled'

export type ShotProgressStatus =
  | 'prompting'
  | 'generating'
  | 'retrying'
  | 'success'
  | 'failed'
  | 'cancelled'

export interface ShotProgress {
  shotId: string
  label: string
  status: ShotProgressStatus
  message: string
  retryAttempt?: number
}

export type SceneStyle = 'studio' | 'outdoor' | 'street' | 'lifestyle'
export type GenerateCount = 4 | 8 | 12 | 16
export type ImageRatio = '1:1' | '3:4' | '4:3' | '2:3'
export type FashionImageRatio = '1:1' | '3:2' | '2:3' | '3:4' | '4:3' | 'more'
/**
 * 姿势裂变（pose-fission）支持的全部 10 个真实比例 + 1 个 UI 概念 'more'。
 * 与 PhotoFissionImageRatio 完全对齐（PRD D6），「更多」按钮只是 UI 概念，
 * 不会写入 params。
 */
export type PoseImageRatio =
  | '1:1'
  | '3:2'
  | '2:3'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9'
  | 'more'
export type PoseResolution = '2k' | '4k'
export type FashionResolution = PoseResolution
export type ProductCategory = 'tops' | 'bottoms' | 'dress' | 'suit' | 'outerwear'
export type PhotoFissionCategory = 'childrens'
export type PhotoFissionChildrensCategory = 'dress' | 'suit' | 'pants'
export type PhotoFissionImageRatio =
  | '1:1'
  | '3:2'
  | '2:3'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9'
export type PhotoFissionResolution = PoseResolution
export type PhotoFissionResultCount = 2 | 4 | 9 | 10
export type PantsMainHandVisibility = 'hidden' | 'visible'
export type PoseMainArmVisibility = 'hidden' | 'visible'
export type ElementReplaceType = 'clothing' | 'environment' | 'person'
export type FashionReferenceSource = 'model' | 'upload'
export type FashionPromptMode = 'enhanced' | 'raw'
export type FashionModelId =
  | 'gemini-3.1-flash-image-preview'
  | 'gemini-3-pro-image-preview'
  | 'gpt-image-2'
  | 'jimeng-seedream-4.6'
  | 'doubao-seedream-4.5'
  | 'doubao-seedream-5.0-lite'

export interface Feature {
  id: FeatureType
  name: string
  description: string
  credits: number
  status: 'available' | 'demo' | 'coming-soon'
}

export interface AssetRecord {
  assetId: string
  userId: string
  projectId: string
  fileName: string
  fileUrl: string
  fileType: string
  dataUrl?: string
  width: number
  height: number
  createdAt: string
  /**
   * 关联的 taskId（仅 kind=generated 时有意义）。
   * upload 类（用户上传的素材）为 null。
   *
   * PR4 引入：原 AssetRecord 没有 taskId，导致 listAssetsByTask 在 local
   * 模式无法按 taskId 过滤。PR4 给 createAsset / persistOneResult / saveResults
   * 内部把 taskId 写进 AssetRecord，listAssetsByTask 在 local 实现里改为
   * 按 taskId 过滤。
   */
  taskId?: string | null
  /**
   * 是否被用户收藏。收藏的资产不会被自动清理。
   * 默认 false（未收藏），由 PATCH /api/assets/[assetId]/favorite 设置。
   */
  favorited?: boolean
}

export type PoseBodyPart = 'full' | 'upper' | 'lower'

export interface SavedPose {
  id: string
  userId: string
  assetId: string
  url: string
  name: string
  width: number
  height: number
  bodyPart: PoseBodyPart
  createdAt: string
}

export interface ResultAsset {
  assetId: string
  url: string
  downloadUrl: string
  width: number
  height: number
  kind?: 'generated'
  label?: string
  shotId?: string
  finalPrompt?: string
  metadata?: Record<string, unknown>
  /** 缩略图 URL，列表/网格视图使用，减少流量 */
  thumbnailUrl?: string
}

export type ImageSchedulerState =
  | 'queued'
  | 'active'

export interface GenerationTask {
  taskId: string
  /**
   * 任务所属用户 id。
   *
   * PR4 引入：原 GenerationTask 没有 userId，导致 listTasks / getTask
   * 没法按用户隔离。PR4 给 createTask 加 userId 形参，由 API 路由通过
   * requireUser 注入；历史任务（PR3 之前创建）该字段可能为 undefined，
   * 调用方应做 graceful fallback（local 模式视为 demo_user）。
   */
  userId?: string
  featureType: FeatureType
  workflowId: string
  inputAssetIds: string[]
  inputAssets?: AssetRecord[]
  params: TaskParams
  status: TaskStatus
  progress: number
  message: string
  resultAssetIds: string[]
  results: ResultAsset[]
  shotProgress?: ShotProgress[]
  /** 当前任务在全局生图调度器中的位置与执行状态；历史任务可能没有这些字段。 */
  queuePosition?: number
  estimatedStartAt?: string
  activeUnits?: number
  completedUnits?: number
  totalUnits?: number
  schedulerState?: ImageSchedulerState
  /** 进程异常退出后已尝试恢复的次数；历史任务可能没有该字段。 */
  recoveryAttempts?: number
  /** 最近一次把中断任务重新放回执行队列的时间。 */
  lastRecoveredAt?: string
  /** 当前恢复执行的幂等键，用于避免同一恢复批次被重复启动。 */
  recoveryExecutionKey?: string
  errorMessage?: string
  createdAt: string
  finishedAt?: string
  creditsUsed: number
}

export interface FashionRemixRequest {
  requestId: number
  task: GenerationTask
}

export interface AiFashionPhotoParams {
  prompt: string
  userPrompt: string
  finalPrompt: string
  promptMode: FashionPromptMode
  model: FashionModelId
  referenceImageCount: number
  imageRatio: FashionImageRatio
  resolution: FashionResolution
  resultCount: 1
  creditsCost: 35
}

export interface PhotoFissionShot {
  shotId: string
  label: string
  prompt: string
  order: number
  /** 裤子任务持久化的抽卡结果，保证 Planner 覆盖和失败重试仍使用同一姿势。 */
  pantsPoseCardId?: string
  /** 裤子主图是否露手：hidden 时全批不生成手，也不写手部姿势。 */
  pantsMainHandVisibility?: PantsMainHandVisibility
  /** 裤子分镜导演输出的方向元数据，仅用于日志和诊断。 */
  pantsPlannerView?: string
  /** 裤子分镜导演输出的角度元数据，仅用于日志和诊断。 */
  pantsPlannerAngle?: string
  /** 裤子分镜导演输出的自检摘要，仅用于日志和诊断。 */
  pantsPlannerSelfCheck?: string
  /** 历史兼容字段；当前裤子规则下主图不露手时所有镜头都不露手。 */
  pantsMayRevealHandsWhenMainHidden?: boolean
}

/**
 * LLM 导演输出的结构化图像提示词对象。
 */
export interface StructuredImagePrompt {
  scene: string
  subject: string
  pose: string
  expression: string
  clothing: string
  background: string
  framing: string
  quality: string
}

/**
 * 通用 Fission Prompt Planner 产物：单个计划卡片。
 *
 * `shotId` 在底座里表示「当前 fission item 的稳定 id」：
 * - photo-fission 使用 `shot_1` ~ `shot_9`
 * - pose-fission 未来可使用姿势模板 id
 *
 * `imagePrompt` 可以是字符串（兼容旧版）或结构化对象（新版）。
 * 后端会把结构化对象转换为 JSON 格式传给出图模型。
 */
export interface FissionPromptCard {
  shotId: string
  role: string
  imagePrompt: string | StructuredImagePrompt
  /** 裤子品类：LLM 分镜导演写好的、可直接送入生图模型的最终提示词。 */
  finalPrompt?: string
  /** 裤子品类：当前 shot 的方向元数据，供后端校验和日志使用。 */
  view?: string
  /** 裤子品类：当前 shot 的角度元数据，供后端校验和日志使用。 */
  angle?: string
  /** 裤子品类：LLM 对角度、手部模式、姿势去重的自检摘要。 */
  selfCheck?: string
  /** 裤子品类：DeepSeek 从姿势库选择的姿势卡 id，后端校验合法性 */
  poseCardId?: string
  /** 裤子 10 张 ActionPlan：LLM 选择的动作族，仅用于后端校验和日志。 */
  actionFamily?: string
  /** 裤子 10 张 ActionPlan：LLM 描述的肉眼轮廓 key，仅用于后端校验和日志。 */
  silhouetteKey?: string
}

/**
 * 通用 Fission Prompt Planner 输出。具体 feature 可用 Zod schema 约束数量与字段。
 */
export interface FissionPromptPlannerOutput {
  shots: FissionPromptCard[]
}

export type PhotoFissionShotCard = FissionPromptCard
export type PhotoFissionShotPlannerOutput = FissionPromptPlannerOutput

/**
 * v5 photo-fission LLM Shot Planner 调用入参。
 */
export interface PhotoFissionShotPlannerInput {
  category: PhotoFissionCategory
  childrensCategory?: PhotoFissionChildrensCategory
  imageRatio: PhotoFissionImageRatio
}

export interface PhotoFissionParams {
  model: FashionModelId
  category: PhotoFissionCategory
  childrensCategory?: PhotoFissionChildrensCategory
  hasFrontDetail: boolean
  hasSideDetail?: boolean
  hasBackDetail: boolean
  /** 裤子品类每个角度支持 0-2 张；历史任务缺失时由 has*Detail 回退为 0/1。 */
  frontDetailCount?: number
  sideDetailCount?: number
  backDetailCount?: number
  /** 裤子主图是否露手；默认 hidden，避免主图无手时 prompt 仍写手部姿势。 */
  pantsMainHandVisibility?: PantsMainHandVisibility
  /** 每个裤子任务独立的加权姿势抽卡种子。 */
  pantsPoseDrawSeed?: string
  plannerReasoningEnabled?: boolean
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  shotPlan: PhotoFissionShot[]
  resultCount: PhotoFissionResultCount
  /**
   * 后端根据输入素材 assetId 生成的同一组参考图标识。
   * 用于连衣裙第二次生图避开第一次姿势动作表情；前端不需要传。
   */
  referenceAssetKey?: string
  faceIdModelId?: string | null
  faceMaskAssetId?: string | null
}

export interface BackgroundReplaceParams {
  elementType: ElementReplaceType
  prompt: string
  generateCount: GenerateCount
  imageRatio: ImageRatio
}

export interface PoseFissionParams {
  model: FashionModelId
  poses: { id: string; url: string; name: string; bodyPart: PoseBodyPart }[]
  hasFrontDetail?: boolean
  hasBackDetail?: boolean
  /** 下半身姿势的主图裁切状态；历史任务缺失时按 hidden 处理。 */
  lowerBodyMainArmVisibility?: PoseMainArmVisibility
  imageRatio: PoseImageRatio
  resolution: PoseResolution
  /** = poses.length，由 normalize 阶段填充 */
  resultCount: number
  /** PRD D5：MVP 不计费 */
  creditsCost: 0
}

export type TaskParams =
  | AiFashionPhotoParams
  | PhotoFissionParams
  | BackgroundReplaceParams
  | PoseFissionParams

export interface UploadedImage {
  assetId: string
  preview: string
  name: string
  width: number
  height: number
}

export interface CompanyModel {
  assetId: string
  preview: string
  name: string
  width: number
  height: number
  createdAt: string
}

export interface FashionReferenceImage {
  assetId: string
  source: FashionReferenceSource
  preview: string
  name: string
  width?: number
  height?: number
  modelId?: string
}

/**
 * 服装大片裂变案例：一组「主图 → 9 张套图」的预设示例，
 * 供右侧案例库 Tab 展示，用户点「使用此案例」可一键复刻参数到左侧表单。
 */
export interface PhotoFissionCase {
  id: string
  featureType: 'photo-fission'
  /** 中文短标题，如「童装白T 9宫格」 */
  name: string
  /** 1-2 句卖点描述 */
  description: string
  category: PhotoFissionCategory
  childrensCategory?: PhotoFissionChildrensCategory
  /** 输入主图路径（public 下相对路径） */
  mainImageUrl: string
  /** 9 张已生成的套图路径（顺序与 shotLabels 一一对应；文件可能暂未生成） */
  resultImageUrls: string[]
  /** 9 张对应 label，必须与 PRD 第 4 节的 shot 顺序一致 */
  shotLabels: string[]
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  modelId: FashionModelId
}

export const FEATURES: Feature[] = [
  {
    id: 'ai-fashion-photo',
    name: 'AI服装大片',
    description: '上传参考图并选择我的模特，生成高级服装商拍大片',
    credits: 35,
    status: 'available',
  },
  {
    id: 'photo-fission',
    name: '服装大片裂变',
    description: '上传服装产品图，自动生成多张模特展示图',
    credits: 1,
    status: 'available',
  },
  {
    id: 'pose-fission',
    name: '姿势裂变',
    description: '选择姿势案例，保持服装细节生成同款多姿势素材',
    credits: 1,
    status: 'available',
  },
]

export const SCENE_STYLES = [
  { id: 'studio', label: '棚拍' },
  { id: 'outdoor', label: '户外' },
  { id: 'street', label: '街拍' },
  { id: 'lifestyle', label: '生活场景' },
] satisfies { id: SceneStyle; label: string }[]

export const GENERATE_COUNTS = [
  { id: 4, label: '4张' },
  { id: 8, label: '8张' },
  { id: 12, label: '12张' },
  { id: 16, label: '16张' },
] satisfies { id: GenerateCount; label: string }[]

export const IMAGE_RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
  { id: '2:3', label: '2:3' },
] satisfies { id: ImageRatio; label: string }[]

export const FASHION_IMAGE_RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
  { id: 'more', label: '更多' },
] satisfies { id: FashionImageRatio; label: string }[]

export const PRODUCT_CATEGORIES = [
  { id: 'tops', label: '上衣' },
  { id: 'bottoms', label: '下装' },
  { id: 'dress', label: '连衣裙' },
  { id: 'suit', label: '套装' },
  { id: 'outerwear', label: '外套' },
] satisfies { id: ProductCategory; label: string }[]

export const PHOTO_FISSION_CATEGORIES = [
  { id: 'childrens', label: '童装' },
] satisfies { id: PhotoFissionCategory; label: string }[]

export const PHOTO_FISSION_CHILDRENS_CATEGORIES = [
  { id: 'dress', label: '连衣裙' },
  { id: 'suit', label: '套装' },
  { id: 'pants', label: '裤子' },
] satisfies { id: PhotoFissionChildrensCategory; label: string }[]

/**
 * 服装大片裂变（photo-fission）支持的全部 10 个真实图片比例。
 * 「更多」按钮只是 UI 概念，不会写入 params。
 */
export const PHOTO_FISSION_IMAGE_RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
  { id: '4:5', label: '4:5' },
  { id: '5:4', label: '5:4' },
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '21:9', label: '21:9' },
] satisfies { id: PhotoFissionImageRatio; label: string }[]

/**
 * UI 分组：主组 5 项常用比例 +「更多」按钮（按钮 id 'more' 仅用于 UI，不会写入 params）。
 */
export const PHOTO_FISSION_RATIOS_MAIN = [
  { id: '1:1', label: '1:1' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
] satisfies { id: PhotoFissionImageRatio; label: string }[]

/**
 * UI 分组：「更多」popover 内 5 项扩展比例。
 */
export const PHOTO_FISSION_RATIOS_EXTRA = [
  { id: '4:5', label: '4:5' },
  { id: '5:4', label: '5:4' },
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '21:9', label: '21:9' },
] satisfies { id: PhotoFissionImageRatio; label: string }[]

export const PHOTO_FISSION_RESOLUTIONS = [
  { id: '2k', label: '2k' },
  { id: '4k', label: '4k' },
] satisfies { id: PhotoFissionResolution; label: string }[]

export const PHOTO_FISSION_RESULT_COUNTS = [
  { id: 2, label: '2张' },
  { id: 4, label: '4张' },
  { id: 9, label: '9张' },
  { id: 10, label: '10张' },
] satisfies { id: PhotoFissionResultCount; label: string }[]

export const ELEMENT_REPLACE_TYPES = [
  { id: 'clothing', label: '服装' },
  { id: 'environment', label: '环境' },
  { id: 'person', label: '人像' },
] satisfies { id: ElementReplaceType; label: string }[]

/**
 * 姿势裂变（pose-fission）支持的全部 10 个真实图片比例（PRD D6 与 photo-fission 对齐）。
 * 「更多」按钮只是 UI 概念，不会写入 params。
 */
export const POSE_IMAGE_RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
  { id: '4:5', label: '4:5' },
  { id: '5:4', label: '5:4' },
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '21:9', label: '21:9' },
] satisfies { id: PoseImageRatio; label: string }[]

/**
 * UI 分组：主组 5 项常用比例 +「更多」按钮（按钮 id 'more' 仅用于 UI，不会写入 params）。
 */
export const POSE_IMAGE_RATIOS_MAIN = [
  { id: '1:1', label: '1:1' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
] satisfies { id: PoseImageRatio; label: string }[]

/**
 * UI 分组：「更多」popover 内 5 项扩展比例。
 */
export const POSE_IMAGE_RATIOS_EXTRA = [
  { id: '4:5', label: '4:5' },
  { id: '5:4', label: '5:4' },
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '21:9', label: '21:9' },
] satisfies { id: PoseImageRatio; label: string }[]

export const POSE_RESOLUTIONS = [
  { id: '2k', label: '2k' },
  { id: '4k', label: '4k' },
] satisfies { id: PoseResolution; label: string }[]

export const FASHION_RESOLUTIONS = POSE_RESOLUTIONS satisfies {
  id: FashionResolution
  label: string
}[]

export const FASHION_PROMPT_MODES = [
  {
    id: 'enhanced',
    label: '基础增强',
    description: '系统仅补充服装保持、画质和禁止项，不会改写主体描述',
  },
  {
    id: 'raw',
    label: '原始提示词',
    description: '完全按照用户输入发送给模型',
  },
] satisfies { id: FashionPromptMode; label: string; description: string }[]

export interface FashionModelOption {
  id: FashionModelId
  label: string
  alias: string
  description: string
  maxInputImages: number
  maxResolutionLabel: '1K' | '2K' | '3K' | '4K'
  selectable?: boolean
}

/**
 * 生图模型元数据。
 *
 * selectable !== false 的条目会出现在本阶段模型选择器中。
 * 当前可用模型：Google 两个（Nano Banana / Nano Banana Pro）+ GPT Image 2。
 */
export const FASHION_MODELS: FashionModelOption[] = [
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana',
    alias: 'Gemini 3.1 Flash',
    description: '推荐默认。走 Google Gemini / 七牛 Gemini 图像渠道，最多 14 张参考图，支持 4K 出图',
    maxInputImages: 14,
    maxResolutionLabel: '4K',
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    alias: 'OpenAI 兼容',
    description: '适合走七牛 OpenAI 图像模型渠道；使用前需配置支持 openai/gpt-image-* 的 qiniu provider',
    maxInputImages: 10,
    maxResolutionLabel: '4K',
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro',
    alias: 'Gemini 3 Pro',
    description: 'Google 旗舰画质，thinking 模式，最多 14 张参考图，速度较慢',
    maxInputImages: 14,
    maxResolutionLabel: '4K',
  },
  {
    id: 'jimeng-seedream-4.6',
    label: '即梦 Seedream 4.6',
    alias: '即梦 AI 4.6',
    description: '字节跳动火山引擎图片生成，高质量中文场景理解，支持 4K 出图',
    maxInputImages: 5,
    maxResolutionLabel: '4K',
    selectable: false,
  },
  {
    id: 'doubao-seedream-4.5',
    label: '豆包 Seedream 4.5',
    alias: '豆包 AI 4.5',
    description: '字节跳动火山引擎豆包图片生成，高质量中文场景理解，支持 4K 出图',
    maxInputImages: 5,
    maxResolutionLabel: '4K',
  },
  {
    id: 'doubao-seedream-5.0-lite',
    label: '豆包 Seedream 5.0 Lite',
    alias: '豆包 AI 5.0 Lite',
    description: '字节跳动火山引擎豆包图片生成，支持 PNG 无损输出、3K/4K 高分辨率和联网搜索',
    maxInputImages: 14,
    maxResolutionLabel: '4K',
    selectable: false,
  },
]

export const SELECTABLE_FASHION_MODELS: FashionModelOption[] =
  FASHION_MODELS.filter((option) => option.selectable !== false)

export const DEFAULT_FASHION_MODEL: FashionModelId = 'gemini-3.1-flash-image-preview'

/**
 * 服装大片裂变（photo-fission）案例库。
 * 注意：resultImageUrls 中的文件可能暂未生成，UI 需对每张图做 graceful fallback。
 */
export const PHOTO_FISSION_CASES: PhotoFissionCase[] = [
  {
    id: 'kid-white-tee',
    featureType: 'photo-fission',
    name: '童装白T 9 宫格',
    description:
      '童装白色T恤+深色半裙的标准电商套图：正面、侧面、背面、近景、远景、特写、45度等 9 个镜头',
    category: 'childrens',
    childrensCategory: 'dress',
    mainImageUrl: '/cases/photo-fission-kid-white-tee.jpg',
    resultImageUrls: [
      '/cases/photo-fission-kid-white-tee-shot-1.jpg',
      '/cases/photo-fission-kid-white-tee-shot-2.jpg',
      '/cases/photo-fission-kid-white-tee-shot-3.jpg',
      '/cases/photo-fission-kid-white-tee-shot-4.jpg',
      '/cases/photo-fission-kid-white-tee-shot-5.jpg',
      '/cases/photo-fission-kid-white-tee-shot-6.jpg',
      '/cases/photo-fission-kid-white-tee-shot-7.jpg',
      '/cases/photo-fission-kid-white-tee-shot-8.jpg',
      '/cases/photo-fission-kid-white-tee-shot-9.jpg',
    ],
    shotLabels: [
      '正面站姿',
      '45度斜侧',
      '侧面站姿',
      '背面站姿',
      '远景全景',
      '半身近景',
      '坐姿变化',
      '行走动态',
      '局部细节特写',
    ],
    imageRatio: '3:4',
    resolution: '2k',
    modelId: 'gemini-3.1-flash-image-preview',
  },
]

/**
 * AI 服装大片演示 task 库（仅 MVP 演示，不上线、不商用）。
 * 在 right-panel.tsx 的 aiFashionGalleryItems 中合并到瀑布流末尾，
 * 让案例库 Tab 始终有内容展示。详细说明见 ./yibai-demo-cases.ts。
 */
export const AI_FASHION_DEMO_TASKS = YIBAI_AI_FASHION_DEMO_TASKS

export const FEATURE_WORKFLOWS: Record<FeatureType, string> = {
  'ai-fashion-photo': 'ai_fashion_photo_v1',
  'photo-fission': 'photo_fission_v1',
  'pose-fission': 'pose_fission_v1',
}

export const FEATURE_LABELS: Record<FeatureType, string> = {
  'ai-fashion-photo': 'AI服装大片',
  'photo-fission': '服装大片裂变',
  'pose-fission': '姿势裂变',
}

/**
 * 多用户认证：用户记录（05-19-cloudflare-backend-foundation PR2）。
 * - DB 字段使用 snake_case（`password_hash` / `display_name` / `created_at`），
 *   仓储层 `user-repo.ts` 负责 mapping 成本接口的 camelCase。
 * - `passwordHash` 仅在服务端流转，**禁止**通过 API 响应或 props 传给前端。
 */
export interface User {
  id: string
  username: string
  passwordHash: string
  displayName: string | null
  createdAt: number
}
