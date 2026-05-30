import {
  POSE_TEMPLATES_SEED,
  POSE_TEMPLATES_DEFAULT_TRIO_SEED,
  POSE_FISSION_CASE_BLACK_DRESS_TEMPLATE_IDS_SEED,
} from './pose-templates-seed'
import {
  AI_FASHION_DEMO_TASKS as YIBAI_AI_FASHION_DEMO_TASKS,
} from './yibai-demo-cases'

export type FeatureType =
  | 'ai-fashion-photo'
  | 'photo-fission'
  | 'pose-fission'

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'partial'

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
export type PoseAgeGroup = 'adult' | 'kid'
export type PoseBodyPart = 'full' | 'upper' | 'lower'
export type PoseResolution = '2k' | '4k'
export type FashionResolution = PoseResolution
export type ProductCategory = 'tops' | 'bottoms' | 'dress' | 'suit' | 'outerwear'
export type PhotoFissionCategory = 'childrens'
export type PhotoFissionChildrensCategory = 'dress' | 'suit'
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
}

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
}

/**
 * 通用 Fission Prompt Planner 产物：单个计划卡片。
 *
 * `shotId` 在底座里表示「当前 fission item 的稳定 id」：
 * - photo-fission 使用 `shot_1` ~ `shot_9`
 * - pose-fission 未来可使用姿势模板 id
 *
 * `imagePrompt` 是最终直接传给出图模型的自然语言提示词。
 */
export interface FissionPromptCard {
  shotId: string
  role: string
  imagePrompt: string
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
  hasBackDetail: boolean
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
}

export interface BackgroundReplaceParams {
  elementType: ElementReplaceType
  prompt: string
  generateCount: GenerateCount
  imageRatio: ImageRatio
}

export interface PoseFissionParams {
  model: FashionModelId
  /** 用户多选的姿势模板 id 列表，长度 ∈ [1, 9] */
  poseTemplateIds: string[]
  /**
   * 冗余存储的姿势模板快照。
   * 目的：后续 POSE_TEMPLATES 常量变更（改名 / 改 prompt）不影响历史任务回放，
   * 也避免 service 层每次重新查表。
   * 顺序与 poseTemplateIds 一一对应。
   */
  poseTemplateSnapshots: PoseTemplate[]
  hasFrontDetail: boolean
  hasBackDetail: boolean
  imageRatio: PoseImageRatio
  resolution: PoseResolution
  /** = poseTemplateIds.length，由 normalize 阶段填充 */
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

export interface PoseTemplate {
  id: string
  /** 中文短描述，如 '站姿1' / '坐姿1' / '儿童跑跳' */
  name: string
  /** 姿势示意图 URL（public 下相对路径） */
  imageUrl: string
  /** 用于拼到生图 prompt 的姿势描述片段 */
  prompt: string
  ageGroup: PoseAgeGroup
  bodyPart: PoseBodyPart
}

/**
 * 姿势裂变成片案例：一组「主图 → 多张套图」的预设示例，
 * 供右侧案例库 Tab 展示，用户点「做同款」可一键复刻参数到左侧表单。
 *
 * 与 PhotoFissionCase 形状一致（参考 PRD D3 设计），区别仅在于：
 * - photoFissionCase 用 shotLabels 描述 9 个 shot
 * - poseFissionCase 用 poseTemplateIds 引用 POSE_TEMPLATES，更贴合"一键回填"用法
 */
export interface PoseFissionCase {
  id: string
  featureType: 'pose-fission'
  name: string
  description: string
  mainImageUrl: string
  /** 已生成的套图路径（顺序与 poseTemplateIds 一一对应；文件可能暂未生成） */
  resultImageUrls: string[]
  /** 案例使用的姿势模板 id 列表。前端回填时若某 id 不存在 POSE_TEMPLATES，应 graceful fallback */
  poseTemplateIds: string[]
  model: FashionModelId
  imageRatio: PoseImageRatio
  resolution: PoseResolution
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
 * 姿势裂变姿势模板（POSE_TEMPLATES）。
 *
 * 数据由 scripts/seed-pose-templates.ts 从友商资料按关键词分桶筛选生成，
 * 见 lib/pose-templates-seed.ts。本文件仅做 re-export，保持稳定接口。
 *
 * 关键字段说明：
 * - ageGroup：'adult' | 'kid' 控制 Modal 的「全部/成人/儿童」筛选
 * - bodyPart：'full' | 'upper' | 'lower' 控制 Modal 的「全部/全身/上半身/下半身」筛选
 * - prompt：姿势描述片段，避免提到具体性别 / 服装，姿势 prompt 只负责姿势本身
 */
export const POSE_TEMPLATES: PoseTemplate[] = POSE_TEMPLATES_SEED

/**
 * 「基础搭配 3 张」一键预设的姿势模板 id 集合（PRD D8）。
 */
export const POSE_TEMPLATES_DEFAULT_TRIO: string[] = POSE_TEMPLATES_DEFAULT_TRIO_SEED

export const POSE_TEMPLATE_AGE_GROUPS = [
  { id: 'adult', label: '成人' },
  { id: 'kid', label: '儿童' },
] satisfies { id: PoseAgeGroup; label: string }[]

export const POSE_TEMPLATE_BODY_PARTS = [
  { id: 'full', label: '全身' },
  { id: 'upper', label: '上半身' },
  { id: 'lower', label: '下半身' },
] satisfies { id: PoseBodyPart; label: string }[]

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
  },
]

export const SELECTABLE_FASHION_MODELS: FashionModelOption[] =
  FASHION_MODELS.filter((option) => option.selectable !== false)

export const DEFAULT_FASHION_MODEL: FashionModelId = 'gemini-3.1-flash-image-preview'

/**
 * 姿势裂变（pose-fission）案例库。
 * MVP 阶段含 1 个 case：现有 6 张 pose-*.jpg 归为一组「黑色蕾丝裙 6 姿势套图」。
 *
 * 注意：
 * - poseTemplateIds 引用 POSE_TEMPLATES 的 id。前端回填时若某 id 在
 *   当前 POSE_TEMPLATES 中不存在，需 graceful fallback（仅忽略该 id 即可）
 * - resultImageUrls 中的文件可能暂未生成，UI 需对每张图做 graceful fallback
 */
export const POSE_FISSION_CASES: PoseFissionCase[] = [
  {
    id: 'pose-black-dress-six-poses',
    featureType: 'pose-fission',
    name: '黑色蕾丝裙 6 姿势套图',
    description:
      '同一位模特身穿黑色蕾丝连衣裙，覆盖正面招手、侧身行走、回头背影等 6 个常用电商投流姿势。',
    mainImageUrl: '/cases/pose-front-wave.jpg',
    resultImageUrls: [
      '/cases/pose-front-wave.jpg',
      '/cases/pose-side-walk.jpg',
      '/cases/pose-back-turn.jpg',
      '/cases/pose-low-crouch.jpg',
      '/cases/pose-cross-step.jpg',
      '/cases/pose-bag-forward.jpg',
    ],
    poseTemplateIds: POSE_FISSION_CASE_BLACK_DRESS_TEMPLATE_IDS_SEED,
    model: DEFAULT_FASHION_MODEL,
    imageRatio: '3:4',
    resolution: '4k',
  },
]

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
