export type FeatureType = 
  | 'ai-photo'
  | 'element-replace'
  | 'detail-fission'
  | 'photo-fission'
  | 'pose-fission'

export interface Feature {
  id: FeatureType
  name: string
  credits: number
}

export interface UploadedImage {
  id: string
  file?: File
  preview: string
  name: string
}

export interface GeneratedImage {
  id: string
  url: string
  status: 'success' | 'failed'
  createdAt: Date
  feature: string
  favorite?: boolean
}

export interface GenerationSettings {
  version: string
  category: string
  aspectRatio: string
  resolution: string
  fissionCount: number
  prompt: string
}

export const FEATURES: Feature[] = [
  {
    id: 'ai-photo',
    name: 'AI服装大片',
    credits: 35
  },
  {
    id: 'element-replace',
    name: '服装大片 - 元素替换',
    credits: 35
  },
  {
    id: 'detail-fission',
    name: '服装详情图裂变',
    credits: 35
  },
  {
    id: 'photo-fission',
    name: '服装大片裂变',
    credits: 140
  },
  {
    id: 'pose-fission',
    name: '姿势裂变',
    credits: 35
  }
]

export const CATEGORIES = [
  { id: 'all', label: '筛选' },
  { id: 'women', label: '女装' },
  { id: 'men', label: '男装' },
  { id: 'kids', label: '童装' },
  { id: 'home', label: '家纺' },
  { id: 'bags', label: '箱包' },
  { id: 'shoes', label: '鞋子' },
  { id: 'accessories', label: '配饰' }
]

export const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
  { id: 'more', label: '更多' }
]

export const RESOLUTIONS = [
  { id: '1k', label: '1k' },
  { id: '2k', label: '2k' },
  { id: '4k', label: '4k' }
]

export const FISSION_COUNTS = [
  { id: 4, label: '4张' },
  { id: 6, label: '6张' },
  { id: 9, label: '9张' },
  { id: 12, label: '12张' }
]

export const PRODUCT_CATEGORIES = [
  { id: 'tops', label: '上衣' },
  { id: 'bottoms', label: '下装' },
  { id: 'dress', label: '连衣裙' },
  { id: 'suit', label: '套装' },
  { id: 'outerwear', label: '外套' }
]

export const VERSIONS = [
  { id: 'advanced', label: '高级版' },
  { id: 'standard', label: '标准版' }
]

export const ELEMENT_TYPES = [
  { id: 'clothing', label: '服装' },
  { id: 'environment', label: '环境' },
  { id: 'person', label: '人像' }
]

// Mock model library for AI Fashion Photo
export const MODEL_LIBRARY = [
  { id: '1', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=60&h=60&fit=crop&crop=face' },
  { id: '2', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=60&h=60&fit=crop&crop=face' },
  { id: '3', avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=60&h=60&fit=crop&crop=face' },
  { id: '4', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&h=60&fit=crop&crop=face' },
  { id: '5', avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=60&h=60&fit=crop&crop=face' },
  { id: '6', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=60&h=60&fit=crop&crop=face' },
]

// Mock data for gallery
export const MOCK_GALLERY_IMAGES: GeneratedImage[] = [
  { id: '1', url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: '服装大片裂变' },
  { id: '2', url: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: '服装大片裂变' },
  { id: '3', url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: 'AI服装大片' },
  { id: '4', url: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: 'AI服装大片' },
  { id: '5', url: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: '姿势裂变' },
  { id: '6', url: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: '姿势裂变' },
  { id: '7', url: 'https://images.unsplash.com/photo-1475180098004-ca77a66827be?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: 'AI服装大片' },
  { id: '8', url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&h=600&fit=crop', status: 'success', createdAt: new Date(), feature: '服装大片裂变' },
]
