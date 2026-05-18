export type FeatureType =
  | 'ai-fashion-photo'
  | 'element-replace'
  | 'photo-fission'
  | 'pose-fission'

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'partial'

export type SceneStyle = 'studio' | 'outdoor' | 'street' | 'lifestyle'
export type GenerateCount = 4 | 8 | 12 | 16
export type ImageRatio = '1:1' | '3:4' | '4:3' | '2:3'
export type FashionImageRatio = '1:1' | '3:2' | '2:3' | '3:4' | '4:3' | 'more'
export type PoseImageRatio = '1:1' | '3:2' | '2:3' | '3:4' | '4:3' | 'more'
export type PoseResolution = '1k' | '2k' | '4k'
export type FashionResolution = PoseResolution
export type PoseVersion = 'advanced'
export type ProductCategory = 'tops' | 'bottoms' | 'dress' | 'suit' | 'outerwear'
export type PhotoFissionCategory =
  | 'tops'
  | 'pants'
  | 'skirts'
  | 'suit'
  | 'outerwear'
  | 'childrens'
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
export type ElementReplaceType = 'clothing' | 'environment' | 'person'
export type FashionReferenceSource = 'model' | 'upload'
export type FashionPromptMode = 'enhanced' | 'raw'
export type FashionModelId =
  | 'gemini-3.1-flash-image-preview'
  | 'gemini-3-pro-image-preview'

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
}

export interface ResultAsset {
  assetId: string
  url: string
  downloadUrl: string
  width: number
  height: number
  label?: string
  shotId?: string
  finalPrompt?: string
}

export interface GenerationTask {
  taskId: string
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

export interface PhotoFissionParams {
  model: FashionModelId
  category: PhotoFissionCategory
  hasFrontDetail: boolean
  hasBackDetail: boolean
  imageRatio: PhotoFissionImageRatio
  resolution: PhotoFissionResolution
  shotPlan: PhotoFissionShot[]
  resultCount: 9
}

export interface BackgroundReplaceParams {
  elementType: ElementReplaceType
  prompt: string
  generateCount: GenerateCount
  imageRatio: ImageRatio
}

export interface PoseFissionParams {
  version: PoseVersion
  poseCaseId: string
  poseName: string
  posePrompt: string
  hasFrontDetail: boolean
  hasBackDetail: boolean
  imageRatio: PoseImageRatio
  resolution: PoseResolution
  resultCount: 6
  creditsCost: 35
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

export interface PoseCase {
  id: string
  featureType: FeatureType
  name: string
  prompt: string
  imageUrl: string
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
    id: 'element-replace',
    name: '服装大片-元素替换',
    description: '上传原图和替换元素，替换服装、环境或人像元素',
    credits: 1,
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
  { id: 'tops', label: '上衣' },
  { id: 'pants', label: '裤子' },
  { id: 'skirts', label: '裙子' },
  { id: 'suit', label: '套装' },
  { id: 'outerwear', label: '外套' },
  { id: 'childrens', label: '童装' },
] satisfies { id: PhotoFissionCategory; label: string }[]

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
  { id: '1k', label: '1k' },
  { id: '2k', label: '2k' },
  { id: '4k', label: '4k' },
] satisfies { id: PhotoFissionResolution; label: string }[]

export const ELEMENT_REPLACE_TYPES = [
  { id: 'clothing', label: '服装' },
  { id: 'environment', label: '环境' },
  { id: 'person', label: '人像' },
] satisfies { id: ElementReplaceType; label: string }[]

export const POSE_TEMPLATES = [
  '站姿',
  '坐姿',
  '走姿',
  '侧身',
  '回头',
]

export const POSE_IMAGE_RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
  { id: 'more', label: '更多' },
] satisfies { id: PoseImageRatio; label: string }[]

export const POSE_RESOLUTIONS = [
  { id: '1k', label: '1k' },
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
  maxResolutionLabel: '4K'
}

/**
 * AI 服装大片可选模型清单（仅在 IMAGE_API_PROVIDER=google 时生效）。
 *
 * 仅保留 Gemini 3 系列，2.5 已下线。
 * 选型依据见 .trellis/spec/frontend/quality-guidelines.md。
 * raycast 路径会忽略前端 model 选择，使用 env IMAGE_API_MODEL。
 */
export const FASHION_MODELS: FashionModelOption[] = [
  {
    id: 'gemini-3.1-flash-image-preview',
    label: '稳定版',
    alias: 'Nano Banana 2',
    description: '推荐默认。最多 14 张参考图，支持 4K 出图，单图约 2 分钟',
    maxInputImages: 14,
    maxResolutionLabel: '4K',
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: '旗舰版',
    alias: 'Nano Banana Pro',
    description: '最高画质，thinking 模式，最多 14 张参考图，速度较慢',
    maxInputImages: 14,
    maxResolutionLabel: '4K',
  },
]

export const DEFAULT_FASHION_MODEL: FashionModelId = 'gemini-3.1-flash-image-preview'

export const POSE_CASES: PoseCase[] = [
  {
    id: 'back-turn',
    featureType: 'pose-fission',
    name: '回头背影',
    prompt: '模特背身站立并自然回头，展示背部廓形、包袋和裙摆层次。',
    imageUrl: '/cases/pose-back-turn.jpg',
  },
  {
    id: 'low-crouch',
    featureType: 'pose-fission',
    name: '半蹲近景',
    prompt: '模特半蹲近景，双手靠近脸部，突出上衣、手套、领口和面部状态。',
    imageUrl: '/cases/pose-low-crouch.jpg',
  },
  {
    id: 'front-wave',
    featureType: 'pose-fission',
    name: '正面招手',
    prompt: '模特正面站立，单手轻抬招手，整体亲和自然，适合主图展示。',
    imageUrl: '/cases/pose-front-wave.jpg',
  },
  {
    id: 'side-walk',
    featureType: 'pose-fission',
    name: '侧身行走',
    prompt: '模特侧身行走，步态轻盈，展示侧面版型、裙摆动态和鞋履搭配。',
    imageUrl: '/cases/pose-side-walk.jpg',
  },
  {
    id: 'cross-step',
    featureType: 'pose-fission',
    name: '交叉步',
    prompt: '模特正面交叉步走姿，双臂自然展开，展示服装整体轮廓与动态感。',
    imageUrl: '/cases/pose-cross-step.jpg',
  },
  {
    id: 'bag-forward',
    featureType: 'pose-fission',
    name: '手持包前进',
    prompt: '模特侧前方行走并手持包袋，姿态利落，适合电商投流和搭配图。',
    imageUrl: '/cases/pose-bag-forward.jpg',
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
    resolution: '1k',
    modelId: 'gemini-3.1-flash-image-preview',
  },
]

export const FEATURE_WORKFLOWS: Record<FeatureType, string> = {
  'ai-fashion-photo': 'ai_fashion_photo_v1',
  'element-replace': 'element_replace_v1',
  'photo-fission': 'photo_fission_v1',
  'pose-fission': 'pose_fission_v1',
}

export const FEATURE_LABELS: Record<FeatureType, string> = {
  'ai-fashion-photo': 'AI服装大片',
  'element-replace': '服装大片-元素替换',
  'photo-fission': '服装大片裂变',
  'pose-fission': '姿势裂变',
}
