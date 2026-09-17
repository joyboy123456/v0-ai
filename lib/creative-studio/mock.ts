import type { NodeStatus, StudioTask } from './model'
export type MockEvent = { taskId: string; attempt: number; slotId: string; status: NodeStatus; error?: string }
/** Deterministic, cancellable UI simulation. Never contacts a model or production API. */
export class MockRunner {
  private jobs = new Map<string, Set<ReturnType<typeof setTimeout>>>()
  constructor(private tick = 1250) {}
  start(task: StudioTask, emit: (event: MockEvent) => void, only?: string[]) {
    this.cancel(task.id)
    const timers = new Set<ReturnType<typeof setTimeout>>()
    this.jobs.set(task.id, timers)
    const slots = only ? task.slots.filter(s => only.includes(s.id)) : task.slots
    const later = (ms: number, fn: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (this.jobs.get(task.id) !== timers) return
        fn()
        if (!timers.size && this.jobs.get(task.id) === timers) this.jobs.delete(task.id)
      }, ms)
      timers.add(timer)
    }
    slots.forEach((slot, index) => {
      const base = { taskId: task.id, attempt: task.attempt, slotId: slot.id }
      later(350 + index * 180, () => emit({ ...base, status: 'running' }))
      later(this.tick * (index + 1) + 650, () => {
        const failed = task.partialDemo && !only && index === Math.min(2, slots.length - 1)
        emit({ ...base, status: failed ? 'failed' : 'ready', ...(failed ? { error: '演示：此镜头未完成，可单独重试。' } : {}) })
      })
    })
  }
  cancel(id: string) { this.jobs.get(id)?.forEach(clearTimeout); this.jobs.delete(id) }
  dispose() { for (const id of this.jobs.keys()) this.cancel(id) }
  get activeCount() { return this.jobs.size }
}
