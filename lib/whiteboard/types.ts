export interface CanvasPoint {
  x: number
  y: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export type ImageKind = 'ref' | 'main' | 'result' | 'upload'
export type GroupId = 'reference' | 'main' | 'results' | 'uploads'

export interface WhiteboardImage {
  id: string
  url: string
  name: string
  naturalWidth: number
  naturalHeight: number
  width: number
  x: number
  y: number
  groupId?: GroupId
  kind?: ImageKind
  demo?: boolean
}

export type ImageRole = 'main' | 'garment' | 'model' | 'pose' | 'backup'

export interface ReferenceItem {
  id: string
  url: string
  name: string
  role: ImageRole
}

export type TaskSubmitType = 'image-set' | 'pose-set' | 'single-edit'
export type TaskScenario = 'all-success' | 'partial-fail'

export interface TaskSubImage {
  id: string
  url: string | null
  x: number
  y: number
  width: number
  height: number
  status: 'pending' | 'ok' | 'failed'
  label: string
}

export type TaskStatus =
  | 'submitting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial-failed'
  | 'failed'
  | 'cancelled'

export interface TaskResult {
  id: string
  tool: TaskSubmitType
  toolName: string
  status: TaskStatus
  references: ReferenceItem[]
  prompt: string
  params: { model?: string; ratio: string; count: number; resolution: string }
  images: TaskSubImage[]
  createdAt: number
  scenario: TaskScenario
}

export interface ResumeSummary {
  storageAvailable: boolean
  view?: { savedAt: number; zoom: number; x: number; y: number }
}
