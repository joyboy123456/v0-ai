import { readFileSync } from 'node:fs'
import type { ImageSchedulerState } from '@/lib/types'

export type { ImageSchedulerState } from '@/lib/types'

export interface ImageSchedulerMemorySnapshot {
  rssBytes: number
  heapUsedBytes: number
  externalBytes: number
  systemAvailableBytes: number
}

export interface ImageWorkSchedulerOptions {
  globalConcurrency?: number
  perUserConcurrency?: number
  perProviderConcurrency?: number
  maxPending?: number
  memoryPollIntervalMs?: number
  metricsLogIntervalMs?: number
  memoryReader?: () => ImageSchedulerMemorySnapshot
}

export interface ScheduleImageWorkInput<T> {
  userId: string
  taskId: string
  providerId: string
  resolution?: string
  signal?: AbortSignal
  run: (signal: AbortSignal) => Promise<T>
}

export interface ImageProviderCapacity {
  providerId: string
  active: number
  limit: number
}

export interface ImageSchedulerCapacitySnapshot {
  active: number
  pending: number
  activeUsers: number
  dynamicConcurrency: number
  configuredConcurrency: number
  state: ImageSchedulerState
  memory: ImageSchedulerMemorySnapshot
  providers: ImageProviderCapacity[]
}

export interface ImageTaskSchedulingSnapshot {
  schedulerState: ImageSchedulerState
  queuePosition?: number
  activeUnits: number
  pendingUnits: number
}

interface QueueEntry extends ScheduleImageWorkInput<unknown> {
  id: number
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  abortController: AbortController
  removeExternalAbortListener?: () => void
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

interface SystemAvailableMemoryOptions {
  platform?: NodeJS.Platform
  nodeEnv?: string
  readFile?: (filePath: string) => string
}

/**
 * Linux 生产环境使用 MemAvailable，它包含可回收缓存，比 freemem 更能反映真实余量。
 * 其他平台、开发环境或读取失败时不使用系统余量门槛，仅保留进程 RSS 保护。
 */
export function readSystemAvailableMemoryBytes(
  options: SystemAvailableMemoryOptions = {},
): number {
  const platform = options.platform ?? process.platform
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV
  if (platform !== 'linux' || nodeEnv !== 'production') {
    return Number.POSITIVE_INFINITY
  }

  try {
    const meminfo = (options.readFile ?? ((filePath) => readFileSync(filePath, 'utf8')))(
      '/proc/meminfo',
    )
    const match = /^MemAvailable:\s+(\d+)\s+kB\s*$/im.exec(meminfo)
    const availableKiB = Number.parseInt(match?.[1] ?? '', 10)
    return Number.isFinite(availableKiB)
      ? availableKiB * 1024
      : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function defaultMemoryReader(): ImageSchedulerMemorySnapshot {
  const usage = process.memoryUsage()
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    systemAvailableBytes: readSystemAvailableMemoryBytes(),
  }
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error(typeof reason === 'string' ? reason : '生图任务已取消')
  error.name = 'AbortError'
  return error
}

export class ImageQueueFullError extends Error {
  readonly code = 'QUEUE_FULL'
  readonly status = 503
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds = 15) {
    super('当前生图队列已满，请稍后重试')
    this.name = 'ImageQueueFullError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class ImageWorkScheduler {
  private readonly configuredConcurrency: number
  private readonly perUserConcurrency: number
  private readonly perProviderConcurrency: number
  private readonly maxPending: number
  private readonly memoryReader: () => ImageSchedulerMemorySnapshot
  private readonly queues = new Map<string, QueueEntry[]>()
  private readonly activeByUser = new Map<string, number>()
  private readonly activeByProvider = new Map<string, number>()
  private readonly activeEntries = new Map<number, QueueEntry>()
  private userOrder: string[] = []
  private cursor = 0
  private nextId = 1
  private pendingCount = 0
  private memory: ImageSchedulerMemorySnapshot
  private dynamicConcurrency: number
  private drainScheduled = false
  private readonly memoryTimer: ReturnType<typeof setInterval>
  private readonly metricsTimer: ReturnType<typeof setInterval>

  constructor(options: ImageWorkSchedulerOptions = {}) {
    this.configuredConcurrency = options.globalConcurrency ?? readPositiveInteger('IMAGE_GLOBAL_CONCURRENCY', 12)
    this.perUserConcurrency = options.perUserConcurrency ?? readPositiveInteger('IMAGE_PER_USER_CONCURRENCY', 3)
    this.perProviderConcurrency = options.perProviderConcurrency ?? readPositiveInteger('IMAGE_PER_PROVIDER_CONCURRENCY', 2)
    this.maxPending = options.maxPending ?? readPositiveInteger('IMAGE_QUEUE_MAX_PENDING', 200)
    this.memoryReader = options.memoryReader ?? defaultMemoryReader
    this.memory = this.memoryReader()
    this.dynamicConcurrency = this.configuredConcurrency
    this.memoryTimer = setInterval(() => this.refreshMemory(), options.memoryPollIntervalMs ?? 2_000)
    this.memoryTimer.unref?.()
    this.metricsTimer = setInterval(() => this.logCapacityMetrics(), options.metricsLogIntervalMs ?? 60_000)
    this.metricsTimer.unref?.()
  }

  schedule<T>(input: ScheduleImageWorkInput<T>): Promise<T> {
    if (input.signal?.aborted) return Promise.reject(abortError(input.signal.reason))
    try {
      this.assertQueueCapacity()
    } catch (error) {
      return Promise.reject(error)
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        ...input,
        id: this.nextId++,
        resolve: (value) => resolve(value as T),
        reject,
        abortController: new AbortController(),
      }
      if (input.signal) {
        const onAbort = () => this.cancelEntry(entry, input.signal?.reason)
        input.signal.addEventListener('abort', onAbort, { once: true })
        entry.removeExternalAbortListener = () => input.signal?.removeEventListener('abort', onAbort)
      }
      const queue = this.queues.get(input.userId)
      if (queue) queue.push(entry)
      else {
        this.queues.set(input.userId, [entry])
        this.userOrder.push(input.userId)
      }
      this.pendingCount += 1
      this.requestDrain()
    })
  }

  assertQueueCapacity(requiredUnits = 1): void {
    const units = Math.max(1, Math.ceil(requiredUnits))
    if (this.pendingCount + units > this.maxPending) throw new ImageQueueFullError()
  }

  cancelTask(taskId: string, reason?: unknown): number {
    let cancelled = 0
    for (const queue of this.queues.values()) {
      for (const entry of [...queue]) {
        if (entry.taskId === taskId) {
          this.cancelEntry(entry, reason)
          cancelled += 1
        }
      }
    }
    for (const entry of this.activeEntries.values()) {
      if (entry.taskId === taskId && !entry.abortController.signal.aborted) {
        entry.abortController.abort(abortError(reason))
        cancelled += 1
      }
    }
    return cancelled
  }

  getCapacitySnapshot(): ImageSchedulerCapacitySnapshot {
    const providerIds = new Set([...this.activeByProvider.keys()])
    for (const queue of this.queues.values()) for (const entry of queue) providerIds.add(entry.providerId)
    return {
      active: this.activeEntries.size,
      pending: this.pendingCount,
      activeUsers: new Set([...this.activeByUser.keys(), ...this.queues.keys()]).size,
      dynamicConcurrency: this.dynamicConcurrency,
      configuredConcurrency: this.configuredConcurrency,
      state: this.resolveState(),
      memory: { ...this.memory },
      providers: [...providerIds].sort().map((providerId) => ({
        providerId,
        active: this.activeByProvider.get(providerId) ?? 0,
        limit: this.perProviderConcurrency,
      })),
    }
  }

  getTaskSnapshot(taskId: string): ImageTaskSchedulingSnapshot | null {
    const waiting = [...this.queues.values()]
      .flat()
      .sort((left, right) => left.id - right.id)
    const taskWaiting = waiting.filter((entry) => entry.taskId === taskId)
    const activeUnits = [...this.activeEntries.values()].filter(
      (entry) => entry.taskId === taskId,
    ).length
    if (!taskWaiting.length && activeUnits === 0) return null

    const firstWaitingId = taskWaiting[0]?.id
    const queuePosition = firstWaitingId === undefined
      ? undefined
      : waiting.findIndex((entry) => entry.id === firstWaitingId) + 1
    return {
      schedulerState: activeUnits > 0 ? 'active' : 'queued',
      queuePosition,
      activeUnits,
      pendingUnits: taskWaiting.length,
    }
  }

  refreshMemory(): void {
    this.memory = this.memoryReader()
  }

  dispose(): void {
    clearInterval(this.memoryTimer)
    clearInterval(this.metricsTimer)
  }

  private logCapacityMetrics(): void {
    const snapshot = this.getCapacitySnapshot()
    const providerActive = snapshot.providers.reduce((total, provider) => total + provider.active, 0)
    const providerSlots = snapshot.providers.reduce((total, provider) => total + provider.limit, 0)
    const saturatedProviders = snapshot.providers.filter(
      (provider) => provider.active >= provider.limit,
    ).length
    console.info('[image-capacity]', JSON.stringify({
      active: snapshot.active,
      pending: snapshot.pending,
      users: snapshot.activeUsers,
      dynamicConcurrency: snapshot.dynamicConcurrency,
      configuredConcurrency: snapshot.configuredConcurrency,
      state: snapshot.state,
      rssBytes: snapshot.memory.rssBytes,
      heapUsedBytes: snapshot.memory.heapUsedBytes,
      externalBytes: snapshot.memory.externalBytes,
      systemAvailableBytes: snapshot.memory.systemAvailableBytes,
      providers: {
        configured: snapshot.providers.length,
        active: providerActive,
        slots: providerSlots,
        saturated: saturatedProviders,
      },
    }))
  }

  private resolveState(): ImageSchedulerState {
    return this.activeEntries.size > 0 ? 'active' : 'queued'
  }

  private requestDrain(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      this.drain()
    })
  }

  private drain(): void {
    while (this.activeEntries.size < this.dynamicConcurrency) {
      const entry = this.takeNextRunnable()
      if (!entry) return
      this.start(entry)
    }
  }

  private takeNextRunnable(): QueueEntry | null {
    if (!this.userOrder.length) return null
    const attempts = this.userOrder.length
    for (let attempt = 0; attempt < attempts && this.userOrder.length; attempt += 1) {
      if (this.cursor >= this.userOrder.length) this.cursor = 0
      const userId = this.userOrder[this.cursor]
      this.cursor = (this.cursor + 1) % this.userOrder.length
      const queue = this.queues.get(userId)
      if (!queue?.length) {
        this.removeUser(userId)
        attempt -= 1
        continue
      }
      if ((this.activeByUser.get(userId) ?? 0) >= this.perUserConcurrency) continue
      const runnableIndex = queue.findIndex(
        (entry) =>
          (this.activeByProvider.get(entry.providerId) ?? 0) < this.perProviderConcurrency,
      )
      if (runnableIndex < 0) continue
      const [entry] = queue.splice(runnableIndex, 1)
      this.pendingCount -= 1
      if (!queue.length) this.removeUser(userId)
      return entry
    }
    return null
  }

  private removeUser(userId: string): void {
    this.queues.delete(userId)
    const index = this.userOrder.indexOf(userId)
    if (index < 0) return
    this.userOrder.splice(index, 1)
    if (index < this.cursor) this.cursor -= 1
    if (this.cursor >= this.userOrder.length) this.cursor = 0
  }

  private start(entry: QueueEntry): void {
    this.activeEntries.set(entry.id, entry)
    this.increment(this.activeByUser, entry.userId)
    this.increment(this.activeByProvider, entry.providerId)
    void entry.run(entry.abortController.signal).then(entry.resolve, entry.reject).finally(() => {
      entry.removeExternalAbortListener?.()
      this.activeEntries.delete(entry.id)
      this.decrement(this.activeByUser, entry.userId)
      this.decrement(this.activeByProvider, entry.providerId)
      this.requestDrain()
    })
  }

  private cancelEntry(entry: QueueEntry, reason?: unknown): void {
    if (this.activeEntries.has(entry.id)) {
      entry.abortController.abort(abortError(reason))
      return
    }
    const queue = this.queues.get(entry.userId)
    const index = queue?.findIndex((candidate) => candidate.id === entry.id) ?? -1
    if (!queue || index < 0) return
    queue.splice(index, 1)
    this.pendingCount -= 1
    entry.removeExternalAbortListener?.()
    entry.reject(abortError(reason))
    if (!queue.length) this.removeUser(entry.userId)
  }

  private increment(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  private decrement(map: Map<string, number>, key: string): void {
    const next = (map.get(key) ?? 1) - 1
    if (next > 0) map.set(key, next)
    else map.delete(key)
  }
}

const globalSchedulerKey = Symbol.for('yibai.image-work-scheduler')

function getGlobalScheduler(): ImageWorkScheduler {
  const scope = globalThis as typeof globalThis & { [globalSchedulerKey]?: ImageWorkScheduler }
  scope[globalSchedulerKey] ??= new ImageWorkScheduler()
  return scope[globalSchedulerKey]
}

export function scheduleImageWork<T>(input: ScheduleImageWorkInput<T>): Promise<T> {
  return getGlobalScheduler().schedule(input)
}

export function cancelScheduledTask(taskId: string, reason?: unknown): number {
  return getGlobalScheduler().cancelTask(taskId, reason)
}

export function getImageSchedulerCapacitySnapshot(): ImageSchedulerCapacitySnapshot {
  return getGlobalScheduler().getCapacitySnapshot()
}

export function getImageTaskSchedulingSnapshot(
  taskId: string,
): ImageTaskSchedulingSnapshot | null {
  return getGlobalScheduler().getTaskSnapshot(taskId)
}

export function assertImageQueueCapacity(requiredUnits = 1): void {
  getGlobalScheduler().assertQueueCapacity(requiredUnits)
}
