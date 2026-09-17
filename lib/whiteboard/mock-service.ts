import { ReferenceItem, TaskResult, TaskScenario, TaskStatus, WhiteboardImage } from './types'

type Listener = () => void

let counter = 0
const tasks = new Map<string, TaskResult>()
const listeners = new Set<Listener>()

function emit(): void {
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function allTasks(): TaskResult[] {
  return Array.from(tasks.values())
}

export function getTask(id: string): TaskResult | undefined {
  return tasks.get(id)
}

function put(task: TaskResult): TaskResult {
  tasks.set(task.id, task)
  emit()
  return task
}

export function createTask(options: {
  tool: TaskResult['tool']
  toolName: string
  prompt: string
  references: ReferenceItem[]
  scenario: TaskScenario
  params: { model?: string; ratio: string; count: number; resolution: string }
  baseline: Array<{ url: string | null; x: number; y: number; width: number; height: number; label: string }>
}): TaskResult {
  const id = `task-${++counter}`
  const images = options.baseline.map((item, index) => ({
    id: `${id}-${index}`,
    url: item.url,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    label: item.label,
    status: 'pending' as const,
  }))
  return put({
    id,
    tool: options.tool,
    toolName: options.toolName,
    references: options.references.map((r) => ({ ...r })),
    prompt: options.prompt,
    params: { ...options.params },
    images,
    scenario: options.scenario,
    status: 'queued',
    createdAt: Date.now(),
  })
}

export function updateTask(id: string, mutator: (t: TaskResult) => TaskResult | null): void {
  const current = tasks.get(id)
  if (!current) return
  const next = mutator(current)
  if (next) put(next)
}

export function markImage(taskId: string, imageId: string, status: 'ok' | 'failed', url: string | null): void {
  updateTask(taskId, (t) => {
    const images = t.images.map((img) => img.id === imageId ? { ...img, status, url } : img)
    const oks = images.filter((i) => i.status === 'ok').length
    const fails = images.filter((i) => i.status === 'failed').length
    const total = images.length
    const finished = oks + fails === total
    return {
      ...t,
      images,
      status: finished ? (fails === 0 ? 'completed' : 'partial-failed') : 'running',
    }
  })
}

export function cancelTask(id: string): void {
  updateTask(id, (t) => ({ ...t, status: 'cancelled' }))
}
