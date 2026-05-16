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
export type ElementReplaceType = 'clothing' | 'environment' | 'person'
export type FashionModelSource = 'featured' | 'mine'
export type FashionModelGender = 'female' | 'male'
export type FashionModelAgeGroup = 'adult' | 'teen'
export type FashionModelEthnicity = 'east-asian' | 'white' | 'black' | 'latino' | 'mixed'
export type FashionModelHairColor = 'black' | 'blonde' | 'brown' | 'red'
export type FashionReferenceSource = 'official-model' | 'upload'

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
}

export interface GenerationTask {
  taskId: string
  featureType: FeatureType
  workflowId: string
  inputAssetIds: string[]
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

export interface AiFashionPhotoParams {
  prompt: string
  referenceImageCount: number
  officialModelId?: string
  officialModelName?: string
  imageRatio: FashionImageRatio
  resolution: FashionResolution
  creditsCost: 35
}

export interface PhotoFissionParams {
  productCategory: ProductCategory
  hasFrontDetail: boolean
  hasBackDetail: boolean
  generateCount: GenerateCount
  imageRatio: ImageRatio
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

export interface FashionModel {
  id: string
  name: string
  previewUrl: string
  source: FashionModelSource
  gender: FashionModelGender
  ageGroup: FashionModelAgeGroup
  ethnicity: FashionModelEthnicity
  hairColor: FashionModelHairColor
  favorite?: boolean
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

export const FEATURES: Feature[] = [
  {
    id: 'ai-fashion-photo',
    name: 'AI服装大片',
    description: '上传参考图并选择官方模特，生成高级服装商拍大片',
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

export const FASHION_MODELS: FashionModel[] = [
  {
    id: 'official_model_female_019',
    name: '女模特019',
    previewUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'female',
    ageGroup: 'adult',
    ethnicity: 'east-asian',
    hairColor: 'black',
    favorite: true,
  },
  {
    id: 'official_model_female_214',
    name: '女模特214',
    previewUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'female',
    ageGroup: 'adult',
    ethnicity: 'white',
    hairColor: 'blonde',
  },
  {
    id: 'official_model_female_215',
    name: '女模特215',
    previewUrl: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'female',
    ageGroup: 'adult',
    ethnicity: 'mixed',
    hairColor: 'brown',
  },
  {
    id: 'official_model_female_216',
    name: '女模特216',
    previewUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'female',
    ageGroup: 'adult',
    ethnicity: 'white',
    hairColor: 'black',
  },
  {
    id: 'official_model_female_218',
    name: '女模特218',
    previewUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'female',
    ageGroup: 'adult',
    ethnicity: 'white',
    hairColor: 'blonde',
  },
  {
    id: 'official_model_female_219',
    name: '女模特219',
    previewUrl: 'https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'female',
    ageGroup: 'adult',
    ethnicity: 'latino',
    hairColor: 'brown',
  },
  {
    id: 'official_model_male_001',
    name: '男模特001',
    previewUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'male',
    ageGroup: 'adult',
    ethnicity: 'white',
    hairColor: 'brown',
  },
  {
    id: 'official_model_male_002',
    name: '男模特002',
    previewUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'male',
    ageGroup: 'adult',
    ethnicity: 'white',
    hairColor: 'brown',
  },
  {
    id: 'official_model_male_003',
    name: '男模特003',
    previewUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'male',
    ageGroup: 'adult',
    ethnicity: 'white',
    hairColor: 'blonde',
  },
  {
    id: 'official_model_male_004',
    name: '男模特004',
    previewUrl: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'male',
    ageGroup: 'adult',
    ethnicity: 'mixed',
    hairColor: 'black',
  },
  {
    id: 'official_model_male_005',
    name: '男模特005',
    previewUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'male',
    ageGroup: 'adult',
    ethnicity: 'black',
    hairColor: 'black',
  },
  {
    id: 'official_model_male_006',
    name: '男模特006',
    previewUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=900&h=1200&fit=crop&crop=faces',
    source: 'featured',
    gender: 'male',
    ageGroup: 'adult',
    ethnicity: 'white',
    hairColor: 'brown',
  },
]

export const POSE_CASES: PoseCase[] = [
  {
    id: 'back-turn',
    featureType: 'pose-fission',
    name: '回头背影',
    prompt: '模特背身站立并自然回头，展示背部廓形、包袋和裙摆层次。',
    imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=900&h=1200&fit=crop',
  },
  {
    id: 'low-crouch',
    featureType: 'pose-fission',
    name: '半蹲近景',
    prompt: '模特半蹲近景，双手靠近脸部，突出上衣、手套、领口和面部状态。',
    imageUrl: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=900&h=1200&fit=crop',
  },
  {
    id: 'front-wave',
    featureType: 'pose-fission',
    name: '正面招手',
    prompt: '模特正面站立，单手轻抬招手，整体亲和自然，适合主图展示。',
    imageUrl: 'https://images.unsplash.com/photo-1495385794356-15371f348c31?w=900&h=1200&fit=crop',
  },
  {
    id: 'side-walk',
    featureType: 'pose-fission',
    name: '侧身行走',
    prompt: '模特侧身行走，步态轻盈，展示侧面版型、裙摆动态和鞋履搭配。',
    imageUrl: 'https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?w=900&h=1200&fit=crop',
  },
  {
    id: 'cross-step',
    featureType: 'pose-fission',
    name: '交叉步',
    prompt: '模特正面交叉步走姿，双臂自然展开，展示服装整体轮廓与动态感。',
    imageUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=900&h=1200&fit=crop',
  },
  {
    id: 'bag-forward',
    featureType: 'pose-fission',
    name: '手持包前进',
    prompt: '模特侧前方行走并手持包袋，姿态利落，适合电商投流和搭配图。',
    imageUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=900&h=1200&fit=crop',
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
