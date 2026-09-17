import type { ImageRole } from './types'

export type ToolEntity = 'image' | 'none'
export type ToolActionKind = 'ok' | 'demo' | 'none'

export interface ToolParameter {
  id: string
  label: string
  type: 'select' | 'text'
  options?: string[]
  text?: string
}

export interface ToolDefinition {
  id: string
  name: string
  category: string
  entity: ToolEntity
  action: ToolActionKind
  parameters: ToolParameter[]
}

export const CATEGORY_TITLES: Record<string, string> = {
  'business': '商业生图',
  'model': '模特与服装',
  'edit': '场景与编辑',
  'delivery': '电商交付',
  'video': '动态内容',
}

const commonImageParams: ToolParameter[] = [
  { id: 'model', label: '模型', type: 'select', options: ['Gemini 3', 'GLM 4.5', 'Claude 3.7', 'GPT-4o'] },
  { id: 'ratio', label: '比例', type: 'select', options: ['1:1', '7:9', '3:4', '9:16', '16:9'] },
]

export const toolDefinitions: ToolDefinition[] = [
  {
    id: 'generate-set',
    name: '生成套图',
    category: 'business',
    entity: 'image',
    action: 'ok',
    parameters: [
      ...commonImageParams,
      { id: 'count', label: '生成数量', type: 'select', options: ['1', '2', '4', '6'] },
      { id: 'views', label: '镜头', type: 'text', text: '正面全身、侧面、背面、面料细节' },
    ],
  },
  {
    id: 'switch-pose',
    name: '换姿势',
    category: 'business',
    entity: 'image',
    action: 'ok',
    parameters: [
      ...commonImageParams,
      { id: 'count', label: '生成数量', type: 'select', options: ['1', '2', '4', '6'] },
      { id: 'poses', label: '姿势参考', type: 'text', text: '从姿势库选择 1~6 个姿势预览' },
    ],
  },
  {
    id: 'business-photography',
    name: '服装商拍',
    category: 'business',
    entity: 'image',
    action: 'ok',
    parameters: [
      ...commonImageParams,
      { id: 'scene', label: '场景', type: 'select', options: ['纯色背景', '户外', '摄影棚', '时尚橱窗'] },
      { id: 'count', label: '生成数量', type: 'select', options: ['1', '2', '4'] },
    ],
  },
  { id: 'multi-angle', name: '多角度', category: 'business', entity: 'image', action: 'demo', parameters: commonImageParams },
  { id: 'batch-variants', name: '批量变体', category: 'business', entity: 'image', action: 'demo', parameters: commonImageParams },

  { id: 'swap-model', name: '更换模特', category: 'model', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'swap-garment', name: '换装', category: 'model', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'outfit-combo', name: '搭配组合', category: 'model', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'color-change', name: '服装换色', category: 'model', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'fabric-repair', name: '面料修复', category: 'model', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'face-repair', name: '面部精修', category: 'model', entity: 'image', action: 'ok', parameters: commonImageParams },

  { id: 'change-background', name: '更换背景', category: 'edit', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'style-transfer', name: '风格迁移', category: 'edit', entity: 'image', action: 'demo', parameters: commonImageParams },
  { id: 'lighting', name: '光线调整', category: 'edit', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'local-repaint', name: '局部重绘', category: 'edit', entity: 'image', action: 'ok', parameters: [{ id: 'brush', label: '笔刷大小', type: 'select', options: ['极细', '细', '中', '粗'] }, ...commonImageParams] },
  { id: 'erase', name: '擦除', category: 'edit', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'expand', name: '扩图', category: 'edit', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'remove-background', name: '去背景', category: 'edit', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'hd-upscale', name: '高清', category: 'edit', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'crop', name: '裁剪', category: 'edit', entity: 'image', action: 'ok', parameters: commonImageParams },

  { id: 'detail-page', name: '详情页', category: 'delivery', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'marketing-labels', name: '营销标签', category: 'delivery', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'collage', name: '拼图', category: 'delivery', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'platform-sizes', name: '平台尺寸适配', category: 'delivery', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'multi-size', name: '多尺寸版本', category: 'delivery', entity: 'image', action: 'ok', parameters: commonImageParams },
  { id: 'bulk-export', name: '批量导出', category: 'delivery', entity: 'image', action: 'ok', parameters: commonImageParams },

  { id: 'image-to-video', name: '图生视频', category: 'video', entity: 'image', action: 'demo', parameters: commonImageParams },
  { id: 'camera-movement', name: '镜头运动', category: 'video', entity: 'image', action: 'demo', parameters: commonImageParams },
  { id: 'storyboard', name: '商品分镜', category: 'video', entity: 'none', action: 'demo', parameters: commonImageParams },
]

export function toolById(toolId: string): ToolDefinition {
  return toolDefinitions.find((t) => t.id === toolId) ?? toolDefinitions[0]
}

export const roleOptions: Array<{ id: ImageRole; label: string }> = [
  { id: 'main', label: '主图' },
  { id: 'garment', label: '服装' },
  { id: 'model', label: '模特' },
  { id: 'pose', label: '姿势' },
  { id: 'backup', label: '参考' },
]

export function roleLabel(role: ImageRole): string {
  const item = roleOptions.find((o) => o.id === role)
  return item ? item.label : '参考'
}
