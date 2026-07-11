import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ImageQueueFullError,
  ImageWorkScheduler,
  readSystemAvailableMemoryBytes,
  type ImageSchedulerMemorySnapshot,
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
} from './image-work-scheduler.ts'

const GIB = 1024 ** 3

function memory(rssGiB = 1, availableGiB = 4): ImageSchedulerMemorySnapshot {
  return { rssBytes: rssGiB * GIB, heapUsedBytes: 0, externalBytes: 0, systemAvailableBytes: availableGiB * GIB }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

test('按用户轮转且遵守全局、用户、provider 并发上限', async () => {
  const scheduler = new ImageWorkScheduler({ globalConcurrency: 4, perUserConcurrency: 2, perProviderConcurrency: 2, memoryReader: () => memory() })
  const gates = Array.from({ length: 6 }, deferred)
  const started: string[] = []
  const jobs = ['a', 'a', 'a', 'b', 'b', 'c'].map((userId, index) => scheduler.schedule({
    userId, taskId: `t-${index}`, providerId: index % 2 ? 'p2' : 'p1',
    run: async () => { started.push(userId); await gates[index].promise },
  }))
  await tick()
  const capacity = scheduler.getCapacitySnapshot()
  assert.equal(capacity.active, 4)
  assert.ok(capacity.providers.every((provider) => provider.active <= 2))
  assert.deepEqual(started.slice(0, 3), ['a', 'b', 'c'])
  for (const gate of gates) gate.resolve()
  await Promise.all(jobs)
  scheduler.dispose()
})

test('5 用户混合 27 单元保持公平和各级并发上限', async () => {
  const scheduler = new ImageWorkScheduler({
    globalConcurrency: 12,
    perUserConcurrency: 3,
    perProviderConcurrency: 2,
    memoryReader: () => memory(),
  })
  const workloads = [
    { userId: 'single-a', units: 1 },
    { userId: 'single-b', units: 1 },
    { userId: 'photo-a', units: 9 },
    { userId: 'photo-b', units: 9 },
    { userId: 'pose', units: 7 },
  ]
  const providers = Array.from({ length: 6 }, (_, index) => `laozhang-${index + 1}`)
  const firstStarts: string[] = []
  const seenUsers = new Set<string>()
  const activeByUser = new Map<string, number>()
  const activeByProvider = new Map<string, number>()
  let activeGlobal = 0
  let maxGlobal = 0
  let maxUser = 0
  let maxProvider = 0

  const jobs: Promise<void>[] = []
  let unitIndex = 0
  for (const workload of workloads) {
    for (let index = 0; index < workload.units; index += 1) {
      const providerId = providers[unitIndex % providers.length]
      unitIndex += 1
      jobs.push(scheduler.schedule({
        userId: workload.userId,
        taskId: `${workload.userId}-task`,
        providerId,
        run: async () => {
          if (!seenUsers.has(workload.userId)) {
            seenUsers.add(workload.userId)
            firstStarts.push(workload.userId)
          }
          activeGlobal += 1
          const userActive = (activeByUser.get(workload.userId) ?? 0) + 1
          const providerActive = (activeByProvider.get(providerId) ?? 0) + 1
          activeByUser.set(workload.userId, userActive)
          activeByProvider.set(providerId, providerActive)
          maxGlobal = Math.max(maxGlobal, activeGlobal)
          maxUser = Math.max(maxUser, userActive)
          maxProvider = Math.max(maxProvider, providerActive)
          await new Promise((resolve) => setImmediate(resolve))
          activeGlobal -= 1
          activeByUser.set(workload.userId, (activeByUser.get(workload.userId) ?? 1) - 1)
          activeByProvider.set(providerId, (activeByProvider.get(providerId) ?? 1) - 1)
        },
      }))
    }
  }

  await Promise.all(jobs)
  assert.equal(jobs.length, 27)
  assert.ok(maxGlobal <= 12)
  assert.ok(maxUser <= 3)
  assert.ok(maxProvider <= 2)
  assert.deepEqual(new Set(firstStarts.slice(0, 5)), new Set(workloads.map((item) => item.userId)))
  scheduler.dispose()
})

test('内存水位不再改变生图并发', () => {
  let current = memory(3.3, 1)
  const scheduler = new ImageWorkScheduler({ memoryReader: () => current })
  assert.equal(scheduler.getCapacitySnapshot().dynamicConcurrency, 12)
  current = memory(4, 0.5); scheduler.refreshMemory()
  assert.equal(scheduler.getCapacitySnapshot().dynamicConcurrency, 12)
  assert.equal(scheduler.getCapacitySnapshot().state, 'queued')
  scheduler.dispose()
})

test('macOS 开发环境忽略系统空闲内存，不误触发保护', () => {
  const availableBytes = readSystemAvailableMemoryBytes({
    platform: 'darwin',
    nodeEnv: 'development',
    readFile: () => 'MemAvailable: 1024 kB',
  })
  assert.equal(availableBytes, Number.POSITIVE_INFINITY)

  const scheduler = new ImageWorkScheduler({
    memoryReader: () => memory(1, availableBytes / GIB),
  })
  assert.equal(scheduler.getCapacitySnapshot().dynamicConcurrency, 12)
  assert.equal(scheduler.getCapacitySnapshot().state, 'queued')
  scheduler.dispose()
})

test('Linux 生产环境仍采集 MemAvailable，但不触发保护', () => {
  const availableBytes = readSystemAvailableMemoryBytes({
    platform: 'linux',
    nodeEnv: 'production',
    readFile: () => 'MemTotal:       8192000 kB\nMemAvailable:   1048576 kB\n',
  })
  assert.equal(availableBytes, GIB)

  const scheduler = new ImageWorkScheduler({
    memoryReader: () => memory(1, availableBytes / GIB),
  })
  assert.equal(scheduler.getCapacitySnapshot().dynamicConcurrency, 12)
  assert.equal(scheduler.getCapacitySnapshot().state, 'queued')
  scheduler.dispose()
})

test('高内存水位也不会暂停 4K 工作', async () => {
  const scheduler = new ImageWorkScheduler({
    globalConcurrency: 12,
    memoryReader: () => memory(2.9, 4),
  })
  let fourKRan = false
  let twoKRan = false
  const fourK = scheduler.schedule({
    userId: 'a', taskId: '4k', providerId: 'p1', resolution: '4K',
    run: async () => { fourKRan = true },
  })
  const twoK = scheduler.schedule({
    userId: 'b', taskId: '2k', providerId: 'p2', resolution: '2k',
    run: async () => { twoKRan = true },
  })
  await twoK
  await tick()
  assert.equal(twoKRan, true)
  await fourK
  assert.equal(fourKRan, true)
  scheduler.dispose()
})

test('队列满返回专用 503 错误', async () => {
  const scheduler = new ImageWorkScheduler({ globalConcurrency: 1, maxPending: 1, memoryReader: () => memory() })
  const gate = deferred()
  const first = scheduler.schedule({ userId: 'a', taskId: '1', providerId: 'p', run: () => gate.promise })
  await tick()
  const second = scheduler.schedule({ userId: 'a', taskId: '2', providerId: 'p', run: async () => undefined })
  await assert.rejects(
    scheduler.schedule({ userId: 'a', taskId: '3', providerId: 'p', run: async () => undefined }),
    (error) => error instanceof ImageQueueFullError && error.status === 503 && error.code === 'QUEUE_FULL',
  )
  gate.resolve()
  await Promise.all([first, second])
  scheduler.dispose()
})

test('创建前容量预检无副作用并支持批量单元', async () => {
  const scheduler = new ImageWorkScheduler({ globalConcurrency: 1, maxPending: 2, memoryReader: () => memory() })
  const gate = deferred()
  const active = scheduler.schedule({ userId: 'a', taskId: 'active', providerId: 'p', run: () => gate.promise })
  await tick()
  const waiting = scheduler.schedule({ userId: 'b', taskId: 'waiting', providerId: 'p', run: async () => undefined })
  const before = scheduler.getCapacitySnapshot().pending
  assert.doesNotThrow(() => scheduler.assertQueueCapacity(1))
  assert.throws(() => scheduler.assertQueueCapacity(2), ImageQueueFullError)
  assert.equal(scheduler.getCapacitySnapshot().pending, before)
  gate.resolve()
  await Promise.all([active, waiting])
  scheduler.dispose()
})

test('取消 task 会移除等待项并 abort 在途项', async () => {
  const scheduler = new ImageWorkScheduler({ globalConcurrency: 1, memoryReader: () => memory() })
  let activeAborted = false
  const active = scheduler.schedule({ userId: 'a', taskId: 'same', providerId: 'p', run: (signal) => new Promise<void>((_, reject) => {
    signal.addEventListener('abort', () => { activeAborted = true; reject(signal.reason) }, { once: true })
  }) })
  await tick()
  let queuedRan = false
  const queued = scheduler.schedule({ userId: 'a', taskId: 'same', providerId: 'p', run: async () => { queuedRan = true } })
  assert.equal(scheduler.cancelTask('same'), 2)
  await assert.rejects(active)
  await assert.rejects(queued)
  assert.equal(activeAborted, true)
  assert.equal(queuedRan, false)
  scheduler.dispose()
})

test('任务快照返回位置和单元数，取消后消失', async () => {
  const scheduler = new ImageWorkScheduler({ globalConcurrency: 1, memoryReader: () => memory() })
  const gate = deferred()
  const active = scheduler.schedule({ userId: 'a', taskId: 'active', providerId: 'p', run: () => gate.promise })
  await tick()
  const firstWaiting = scheduler.schedule({ userId: 'b', taskId: 'target', providerId: 'p', run: async () => undefined })
  const secondWaiting = scheduler.schedule({ userId: 'b', taskId: 'target', providerId: 'p', run: async () => undefined })
  assert.deepEqual(scheduler.getTaskSnapshot('target'), {
    schedulerState: 'queued', queuePosition: 1, activeUnits: 0, pendingUnits: 2,
  })
  assert.deepEqual(scheduler.getTaskSnapshot('active'), {
    schedulerState: 'active', queuePosition: undefined, activeUnits: 1, pendingUnits: 0,
  })
  assert.equal(scheduler.cancelTask('target'), 2)
  assert.equal(scheduler.getTaskSnapshot('target'), null)
  await assert.rejects(firstWaiting)
  await assert.rejects(secondWaiting)
  gate.resolve()
  await active
  scheduler.dispose()
})
