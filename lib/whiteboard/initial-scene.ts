import type { GroupId, ImageRole, TaskScenario, TaskStatus, WhiteboardImage } from './types'

export const DEMO_PHOTO_URLS = [
  '/cases/photo-fission-kid-white-tee-shot-3.jpg',
  '/cases/photo-fission-kid-white-tee-shot-4.jpg',
  '/cases/photo-fission-kid-white-tee-shot-5.jpg',
  '/cases/photo-fission-kid-white-tee-shot-6.jpg',
  '/cases/photo-fission-kid-white-tee-shot-9.jpg',
]

export const DEMO_POSES = [
  { id: 'pose-01', url: '/cases/pose-front-wave.jpg', name: '正面 · 挥手' },
  { id: 'pose-02', url: '/cases/pose-side-walk.jpg', name: '侧面 · 步行' },
  { id: 'pose-03', url: '/cases/pose-back-turn.jpg', name: '背面 · 转身' },
  { id: 'pose-04', url: '/cases/pose-low-crouch.jpg', name: '低位 · 蹲坐' },
  { id: 'pose-05', url: '/cases/pose-cross-step.jpg', name: '跨步 · 动态' },
  { id: 'pose-06', url: '/cases/pose-bag-forward.jpg', name: '包姿 · 前倾' },
]

export const GROUP_TITLES: Record<GroupId, string> = {
  reference: '参考素材',
  main: '主图方案',
  results: '套图结果',
  uploads: '我的素材',
}

function demo(url: string, name: string): Omit<WhiteboardImage, 'id' | 'x' | 'y' | 'width'> {
  return { url, name, naturalWidth: 896, naturalHeight: 1200 }
}

export const assetLibrary: Array<{ groupId: GroupId; role?: ImageRole; demo: Pick<WhiteboardImage, 'url' | 'name' | 'naturalWidth' | 'naturalHeight'> }> = [
  { groupId: 'main', role: 'main', demo: demo(DEMO_PHOTO_URLS[0], '白 tee · 正面') },
  { groupId: 'reference', role: 'garment', demo: demo(DEMO_PHOTO_URLS[1], '白 tee · 正面') },
  { groupId: 'reference', role: 'garment', demo: demo(DEMO_PHOTO_URLS[2], '白 tee · 侧面') },
  { groupId: 'reference', role: 'garment', demo: demo(DEMO_PHOTO_URLS[3], '白 tee · 背面') },
]

export const poseLibrary = DEMO_POSES
export const POSE_LIBRARY = DEMO_POSES

export function makeInitialImages(): WhiteboardImage[] {
  return [
    { ...assetLibrary[0].demo, id: 'asset-1', x: 72, y: 96, width: 150, demo: true, kind: 'main', groupId: 'main' },
    { ...assetLibrary[1].demo, id: 'asset-2', x: 72, y: 336, width: 150, demo: true, kind: 'ref', groupId: 'reference' },
    { ...assetLibrary[2].demo, id: 'asset-3', x: 72, y: 576, width: 150, demo: true, kind: 'ref', groupId: 'reference' },
    { ...assetLibrary[3].demo, id: 'asset-4', x: 284, y: 72, width: 308, demo: true, kind: 'main', groupId: 'main' },
    { ...demo(DEMO_PHOTO_URLS[0], '正面全身'), id: 'asset-5', x: 664, y: 72, width: 148, demo: true, kind: 'result', groupId: 'results' },
    { ...demo(DEMO_PHOTO_URLS[1], '侧面全身'), id: 'asset-6', x: 830, y: 72, width: 148, demo: true, kind: 'result', groupId: 'results' },
    { ...demo(DEMO_PHOTO_URLS[2], '背面全身'), id: 'asset-7', x: 996, y: 72, width: 148, demo: true, kind: 'result', groupId: 'results' },
    { ...demo(DEMO_PHOTO_URLS[3], '白 tee · 细节'), id: 'asset-8', x: 664, y: 288, width: 148, demo: true, kind: 'result', groupId: 'results' },
  ]
}

export function isDemoAsset(url: string): boolean {
  return !url.startsWith('data:') && !url.startsWith('blob:')
}

export function snapshotScenarioLabel(s: TaskScenario): string {
  return s === 'all-success' ? '全部成功' : '部分失败'
}

export function taskKindLabel(t: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    submitting: '提交中',
    queued: '排队中',
    running: '生成中',
    completed: '完成',
    'partial-failed': '部分失败',
    failed: '失败',
    cancelled: '已取消',
  }
  return map[t]
}
