import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { DEFAULT_FASHION_MODEL, type AssetRecord, type GenerationTask } from '@/lib/types'
import { createUnknownReconciler } from '../agent/governance/unknown-reconciler'
import { AgentBetaRepository } from './repository'
import { AgentBetaService, type AgentBetaDependencies } from './service'

/** 集成真实仓储、核实器和旧 service；生成与查询由本地 Map 替代，不调用供应商。 */
async function fixture(context: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-p0-integration-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const userId = 'integration_user'
  let timestamp = Date.parse('2026-09-16T10:00:00.000Z')
  let creationFails = false
  let queryFails = false
  let lastInput: Parameters<AgentBetaDependencies['createTask']>[0] | undefined
  const calls = { create: 0, reconcile: 0 }
  const tasks = new Map<string, GenerationTask>()
  const asset: AssetRecord = { assetId: 'input_asset', userId, projectId: 'test', fileName: 'test.png',
    fileUrl: '/test-only/input.png', fileType: 'image/png', width: 800, height: 1000,
    createdAt: new Date(timestamp).toISOString() }
  const getTaskId = (owner: string, key: string) => `task_idem_${createHash('sha256').update(JSON.stringify([owner, key])).digest('hex')}`
  const getTask = async (id: string) => {
    if (queryFails) throw new Error('查询暂不可用')
    return tasks.get(id)
  }
  const repository = new AgentBetaRepository(directory, { getTask })
  const reconcile = createUnknownReconciler({ ledger: repository, tasks: { getTask }, now: () => new Date(timestamp) })
  function taskFor(input: NonNullable<typeof lastInput>): GenerationTask {
    return { taskId: getTaskId(input.userId, input.idempotencyKey), userId: input.userId,
      featureType: input.featureType, workflowId: 'test-workflow', inputAssetIds: input.inputAssetIds,
      params: input.params, status: 'pending', progress: 0, message: '排队中', resultAssetIds: [], results: [],
      createdAt: new Date(timestamp).toISOString(), creditsUsed: 0 }
  }
  const dependencies: AgentBetaDependencies = {
    getAsset: async (id) => id === asset.assetId ? asset : undefined,
    getTask, getTaskId, isTaskExecutionActive: () => false, assertQueueCapacity: () => {},
    now: () => new Date(timestamp),
    plan: async () => ({ kind: 'plan', content: '请确认方案', prompt: '保留参考服装，生成自然光展示图' }),
    createTask: async (input) => {
      calls.create++
      lastInput = input
      if (creationFails) throw new Error('提交结果未知')
      const task = taskFor(input)
      tasks.set(task.taskId, task)
      return task
    },
    cancelTask: async () => { throw new Error('该验收不应调用取消') },
    reconcileExecutions: async (owner) => { calls.reconcile++; return reconcile(owner) },
  }
  const makeService = () => new AgentBetaService(new AgentBetaRepository(directory, { getTask }), dependencies)
  const service = makeService()
  let session = await service.createSession(userId)
  session = await service.addAssets(userId, session.id, { assetIds: [asset.assetId] })
  session = await service.sendMessage(userId, session.id, { clientMessageId: 'input_message', text: '生成服装展示图',
    referenceNodeIds: [session.nodes[0].id], settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' } })
  const input = { messageId: session.messages.at(-1)!.id }
  return { userId, service, makeService, session, input, repository, dependencies, calls, tasks,
    failCreation(value: boolean) { creationFails = value },
    failQuery(value: boolean) { queryFails = value },
    advance(ms: number) { timestamp += ms },
    restoreTask() {
      assert.ok(lastInput)
      const task = taskFor(lastInput)
      tasks.set(task.taskId, task)
      return task
    },
  }
}

test('未知提交跨实例保持保护，超过一小时提示核实；原任务恢复后复用而不重提', async (context) => {
  const f = await fixture(context)
  f.failCreation(true)
  await assert.rejects(f.service.execute(f.userId, f.session.id, f.input), /提交结果未知/)
  assert.equal(f.calls.create, 1)
  assert.equal((await f.repository.readActionLedger()).entries[0].submissionState, 'UNKNOWN')
  f.advance(60 * 60_000 + 1)
  await f.makeService().getSession(f.userId, f.session.id)
  await assert.rejects(f.makeService().execute(f.userId, f.session.id, f.input), /超过一小时/)
  assert.equal(f.calls.create, 1)
  const original = f.restoreTask()
  const refreshed = await f.makeService().getSession(f.userId, f.session.id)
  assert.equal(refreshed.messages.at(-1)!.plan!.task!.taskId, original.taskId)
  const entry = (await f.repository.readActionLedger()).entries[0]
  assert.equal(entry.submissionState, 'SUBMITTED')
  assert.equal(entry.taskStatus, 'pending')
  await f.makeService().execute(f.userId, f.session.id, f.input)
  assert.equal(f.calls.create, 1)
  assert.ok(f.calls.reconcile >= 5)
})

test('任务查询故障不消除已确认创建证据，恢复查询也不调用第二次生成', async (context) => {
  const f = await fixture(context)
  await f.service.execute(f.userId, f.session.id, f.input)
  f.failQuery(true)
  await assert.rejects(f.service.getSession(f.userId, f.session.id), /查询暂不可用/)
  const uncertain = (await f.repository.readActionLedger()).entries[0]
  assert.equal(uncertain.submissionState, 'UNKNOWN')
  assert.equal(uncertain.sideEffectState, 'CONFIRMED')
  f.failQuery(false)
  await f.service.getSession(f.userId, f.session.id)
  assert.equal((await f.repository.readActionLedger()).entries[0].submissionState, 'SUBMITTED')
  assert.equal(f.calls.create, 1)
})

test('核实安全账失败在确认创建前中止，不落入旧生成路径', async (context) => {
  const f = await fixture(context)
  f.dependencies.reconcileExecutions = async () => { throw new Error('安全账不可写') }
  await assert.rejects(f.service.execute(f.userId, f.session.id, f.input), /安全账不可写/)
  assert.equal(f.calls.create, 0)
})

test('会话刷新与重复确认并发，核实接线不反转锁顺序', { timeout: 5000 }, async (context) => {
  const f = await fixture(context)
  const operations = Array.from({ length: 8 }, (_, index) => index % 2
    ? f.makeService().getSession(f.userId, f.session.id)
    : f.makeService().execute(f.userId, f.session.id, f.input))
  await Promise.all(operations)
  assert.equal(f.calls.create, 1)
  assert.equal((await f.repository.readActionLedger()).entries.length, 1)
})
