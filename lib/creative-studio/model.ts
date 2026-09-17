/** Front-end-only studio model. No production task types or paid API imports. */
export type Point = { x: number; y: number }
export type Viewport = Point & { zoom: number }
export type NodeStatus = 'ready' | 'queued' | 'running' | 'failed' | 'cancelled' | 'interrupted'
export type CanvasNode = Point & {
  id: string; name: string; width: number; height: number
  kind: 'image' | 'text'; url?: string; assetId?: string; text?: string
  group?: string; z?: number; status: NodeStatus; taskId?: string; slotId?: string
  sourceId?: string; demo?: boolean; favorite?: boolean
}
export type Reference = { nodeId: string; role: string }
export type Draft = {
  tool: string; prompt: string; ratio: string; count: number; quality: string
  model: string; poses: string[]; shots: string[]; options: Record<string, string>
}
export type Slot = { id: string; nodeId: string; title: string; status: NodeStatus; url?: string; error?: string }
export type StudioTask = {
  id: string; title: string; createdAt: number; finishedAt?: number; attempt: number
  status: 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
  snapshot: Draft & { references: (CanvasNode & { role: string })[]; mask?: string }
  slots: Slot[]; partialDemo: boolean
}
export type StudioDocument = {
  version: 1; title: string; nodes: CanvasNode[]; viewport: Viewport
  references: Reference[]; draft: Draft; tasks: StudioTask[]
}
export const CASES = [3, 4, 5, 6, 9].map(n => `/cases/photo-fission-kid-white-tee-shot-${n}.jpg`)
export const POSES = [
  { id: 'front', name: '正面挥手', url: '/cases/pose-front-wave.jpg' },
  { id: 'side', name: '侧面行走', url: '/cases/pose-side-walk.jpg' },
  { id: 'back', name: '背身回眸', url: '/cases/pose-back-turn.jpg' },
  { id: 'cross', name: '交叉步', url: '/cases/pose-cross-step.jpg' },
  { id: 'bag', name: '拎包前行', url: '/cases/pose-bag-forward.jpg' },
  { id: 'low', name: '低姿蹲坐', url: '/cases/pose-low-crouch.jpg' },
]
export const SHOTS = ['正面全身', '自然侧身', '背面展示', '近景细节', '行走抓拍', '坐姿展示', '服装特写', '轻松互动', '场景远景']
export const uid = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
export function initialDocument(): StudioDocument {
  const image = (id: string, name: string, url: string, x: number, y: number, width: number, group: string): CanvasNode =>
    ({ id, name, url, x, y, width, height: width * 4 / 3, kind: 'image', status: 'ready', group })
  return {
    version: 1, title: '童装白 T · 自然商拍', viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      image('ref-1', '商拍参考 A', CASES[3], 90, 155, 148, '参考素材'),
      image('ref-2', '商拍参考 B', CASES[2], 90, 405, 148, '参考素材'),
      image('hero', '主图 · 人物与服装参考', CASES[0], 320, 155, 282, '当前主图'),
      image('look-1', '自然侧身', CASES[1], 696, 155, 155, '已有套图'),
      image('look-2', '轻松互动', CASES[2], 882, 155, 155, '已有套图'),
      image('look-3', '坐姿展示', CASES[3], 696, 416, 155, '已有套图'),
      image('look-4', '近景构图', CASES[4], 882, 416, 155, '已有套图'),
    ],
    references: [{ nodeId: 'hero', role: '主图' }], tasks: [],
    draft: { tool: 'fission', prompt: '保持人物和白色上衣一致，生成一组自然、有生活感的童装商拍套图，补充不同角度与近景。', ratio: '3:4', count: 4, quality: '2K', model: '自动选择', poses: ['front', 'side', 'back'], shots: SHOTS.slice(0, 4), options: {} },
  }
}
/** Ordinary affine geometry, implemented independently of the licensed Agent Beta module. */
export function worldPoint(p: Point, v: Viewport): Point { return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom } }
export function clampZoom(z: number): number { return Number.isFinite(z) ? Math.min(3, Math.max(.15, z)) : 1 }
export function zoomAround(v: Viewport, p: Point, zoom: number): Viewport {
  const z = clampZoom(zoom), w = worldPoint(p, v)
  return { x: p.x - w.x * z, y: p.y - w.y * z, zoom: z }
}
export function bounds(nodes: CanvasNode[]) {
  if (!nodes.length) return { x: 0, y: 0, width: 800, height: 550 }
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y))
  return { x, y, width: Math.max(...nodes.map(n => n.x + n.width)) - x, height: Math.max(...nodes.map(n => n.y + n.height)) - y }
}
export function fitViewport(nodes: CanvasNode[], width: number, height: number): Viewport {
  const b = bounds(nodes), z = clampZoom(Math.min((width - 156) / (b.width + 24), (height - 190) / (b.height + 24), 1.1))
  return { zoom: z, x: 85 + (width - 156 - b.width * z) / 2 - b.x * z, y: 88 + (height - 164 - b.height * z) / 2 - b.y * z }
}
export function taskStatus(slots: Slot[]): StudioTask['status'] {
  if (slots.some(s => s.status === 'queued' || s.status === 'running')) return 'running'
  if (slots.every(s => s.status === 'ready')) return 'success'
  if (slots.some(s => s.status === 'ready')) return 'partial'
  if (slots.some(s => s.status === 'interrupted')) return 'interrupted'
  if (slots.every(s => s.status === 'cancelled')) return 'cancelled'
  return 'failed'
}
export function safeImageUrl(value: unknown): value is string {
  return typeof value === 'string' && (/^\/cases\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(value) || value.startsWith('blob:') || /^data:image\/(png|jpeg|webp);base64,/.test(value))
}
export function resultUrl(source: CanvasNode, index: number) {
  return source.url?.startsWith('/cases/photo-fission-') ? CASES[(index + 1) % CASES.length] : source.url ?? CASES[0]
}
