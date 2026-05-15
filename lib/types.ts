export type FeatureType = 
  | 'ai-fashion-photo'
  | 'element-replace'
  | 'photo-variation'
  | 'pose-variation'

export interface Feature {
  id: FeatureType
  name: string
  description: string
  icon: string
}

export interface UploadedImage {
  id: string
  file: File
  preview: string
  name: string
}

export interface GeneratedImage {
  id: string
  url: string
  status: 'success' | 'failed'
  createdAt: Date
}

export interface GenerationSettings {
  sceneStyle: string
  modelType: string
  count: number
  aspectRatio: string
  replaceType?: string
  replaceStrength?: string
  backgroundType?: string
  variationDirection?: string
  poseType?: string
  cameraAngle?: string
}

export const FEATURES: Feature[] = [
  {
    id: 'ai-fashion-photo',
    name: 'AI服装大片',
    description: '上传产品图、模特图，生成服装大片',
    icon: 'camera'
  },
  {
    id: 'element-replace',
    name: '服装大片-元素替换',
    description: '一键替换服装大片中的元素，支持替换服装、模特脸部、背景',
    icon: 'replace'
  },
  {
    id: 'photo-variation',
    name: '服装大片裂变',
    description: '一张服装大片生成多角度、多姿势、多场景套图',
    icon: 'grid'
  },
  {
    id: 'pose-variation',
    name: '姿势裂变',
    description: '一张服装模特图衍生不同模特姿势和拍摄角度',
    icon: 'pose'
  }
]

export const MOCK_GENERATED_IMAGES: GeneratedImage[] = [
  { id: '1', url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
  { id: '2', url: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
  { id: '3', url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
  { id: '4', url: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
  { id: '5', url: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
  { id: '6', url: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
  { id: '7', url: 'https://images.unsplash.com/photo-1475180098004-ca77a66827be?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
  { id: '8', url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&h=600&fit=crop', status: 'success', createdAt: new Date() },
]
