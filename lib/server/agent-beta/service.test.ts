import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import type { AgentBetaSession } from '@/lib/agent-beta/types'
import {
  approvalDigest,
  assetDigest,
  digest,
  paramsDigest,
  requestDigest,
  type ActionLedgerEntry,
  type ApprovalReceipt,
  type LegacyLedgerEntry,
  type ResultAdmission,
  type RetryPreviewArtifact,
} from '@/lib/agent/contracts'
import { DEFAULT_FASHION_MODEL, type AssetRecord, type GarmentDetailParams, type GenerationTask, type PoseFissionParams } from '@/lib/types'
import type { AdmittedResultView, ResultAdmissionDecision } from '../agent/ports'
import { AgentBetaRepository } from './repository'
import { AgentBetaService, type AgentBetaDependencies } from './service'
import { AgentBetaError, type PlannerOutput } from './validation'
import { createUnknownReconciler } from '../agent/governance/unknown-reconciler'
import { preparationArtifactKey } from '../agent/governance/preparation-artifact-store'
import { FileResultAdmissionEvidenceStore, createPostSubmitVerifier, createResultAdmission } from '../agent/governance/result-admission'
import type { StoredPreparationReference } from '../agent/action/task-preparation'

const userId = 'beta_user_a'
const otherUser = 'beta_user_b'
const settings = { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const }
const errorCode = (code: string) => (error: unknown) => error instanceof AgentBetaError && error.code === code

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-beta-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const assets = new Map<string, AssetRecord>()
  const tasks = new Map<string, GenerationTask>()
  const executing = new Set<string>()
  const calls = { create: 0, plan: 0, queue: 0, cancel: 0 }
  let planner: AgentBetaDependencies['plan'] = async () => ({ kind: 'plan', content: '请确认这张服装商拍方案。', prompt: '保持参考服装款式，生成自然光电商模特展示图。' })
  let queueFailure = false
  let creationFailure = false
  const deps: AgentBetaDependencies = {
    now: () => new Date('2026-09-13T15:00:00.000Z'),
    getAsset: async (id) => assets.get(id),
    getTask: async (id) => tasks.get(id),
    isTaskExecutionActive: (id) => executing.has(id),
    getTaskId: (owner, key) => `task_idem_${createHash('sha256').update(JSON.stringify([owner, key])).digest('hex')}`,
    assertQueueCapacity: () => { calls.queue++; if (queueFailure) throw new Error('queue full') },
    createTask: async (input) => {
      calls.create++
      if (creationFailure) throw new Error('simulated disk error')
      const taskId = deps.getTaskId(input.userId, input.idempotencyKey)
      const task: GenerationTask = {
        taskId, userId: input.userId, featureType: input.featureType, workflowId: 'existing-fashion',
        inputAssetIds: input.inputAssetIds, params: input.params, status: 'pending', progress: 0,
        message: '排队中', resultAssetIds: [], results: [], createdAt: deps.now!().toISOString(), creditsUsed: 35,
      }
      tasks.set(taskId, task)
      return task
    },
    cancelTask: async (id, owner) => {
      calls.cancel++
      const task = tasks.get(id)!
      assert.equal(task.userId, owner)
      task.status = 'cancelled'
      return task
    },
    plan: async (input) => { calls.plan++; return planner(input) },
  }
  const makeService = () => new AgentBetaService(new AgentBetaRepository(directory), deps)
  const service = makeService()
  function addAsset(id: string, owner = userId) {
    const asset: AssetRecord = { assetId: id, userId: owner, projectId: 'project', fileName: `${id}.png`, fileUrl: `/generated/${id}.png`, fileType: 'image/png', width: 800, height: 1000, createdAt: deps.now!().toISOString() }
    assets.set(id, asset)
    return asset
  }
  addAsset('asset_a')
  addAsset('asset_b', otherUser)
  async function prepare(owner = userId) {
    const created = await service.createSession(owner)
    return service.addAssets(owner, created.id, { assetIds: [owner === userId ? 'asset_a' : 'asset_b'] })
  }
  async function propose(session: AgentBetaSession, clientMessageId = 'message_1', owner = userId) {
    return service.sendMessage(owner, session.id, { clientMessageId, text: '将这件服装做成自然光模特展示图', referenceNodeIds: [session.nodes[0].id], settings })
  }
  return { service, makeService, directory, assets, tasks, executing, calls, deps, prepare, propose, addAsset,
    setPlanner(value: AgentBetaDependencies['plan']) { planner = value },
    setQueueFailure(value: boolean) { queueFailure = value },
    setCreationFailure(value: boolean) { creationFailure = value },
  }
}

test('严格隔离会话、素材与参考节点，不接受客户端URL', async (t) => {
  const f = await fixture(t)
  const session = await f.prepare()
  await assert.rejects(f.service.getSession(otherUser, session.id), errorCode('AGENT_BETA_SESSION_NOT_FOUND'))
  await assert.rejects(f.service.addAssets(userId, session.id, { assetIds: ['asset_b'] }), errorCode('AGENT_BETA_ASSET_NOT_FOUND'))
  await assert.rejects(f.service.addAssets(userId, session.id, { assetIds: ['asset_a'], url: 'https://untrusted.example/' }), errorCode('AGENT_BETA_INVALID_REQUEST'))
  await assert.rejects(f.service.sendMessage(userId, session.id, { clientMessageId: 'x', text: '生成图片', referenceNodeIds: ['missing_node'], settings }), /参考图不属于/)
  assert.equal(f.calls.plan, 0)
  assert.equal(f.calls.create, 0)
})

test('规划只保存确认方案，模型输入声明无视觉且不含图片URL', async (t) => {
  const f = await fixture(t)
  f.setPlanner(async (input) => {
    assert.match(input.systemPrompt, /没有读取或分析图片像素/)
    const context = JSON.parse(input.userPrompt)
    assert.equal(context.imagePixelsProvided, false)
    assert.equal(context.selectedReferences[0].name, 'asset_a.png')
    assert.equal(input.userPrompt.includes('/generated/'), false)
    return { kind: 'plan', content: '确认后生成', prompt: '保持参考服装，自然光商拍。' }
  })
  const session = await f.propose(await f.prepare())
  assert.equal(session.messages.length, 2)
  assert.equal(session.messages[1].plan?.status, 'proposed')
  assert.equal(session.messages[1].plan?.task, undefined)
  assert.equal(f.calls.create, 0)
  assert.equal(f.calls.queue, 0)
  const [userFile] = (await readdir(f.directory)).filter((name) => name.startsWith('user-') && name.endsWith('.json'))
  const disk = JSON.parse(await readFile(path.join(f.directory, userFile), 'utf8'))
  assert.equal('url' in disk.sessions[0].nodes[0], false)
})

test('未选参考图时即使LLM返回plan也必须澄清', async (t) => {
  const f = await fixture(t)
  const initial = await f.service.createSession(userId)
  const session = await f.service.sendMessage(userId, initial.id, { clientMessageId: 'empty_ref', text: '帮我生成服装模特图', referenceNodeIds: [], settings })
  assert.equal(session.messages[1].plan, undefined)
  assert.match(session.messages[1].content, /上传并选中/)
  assert.equal(f.calls.create, 0)
})

test('LLM失败不留下伪成功消息或任务，允许重试同消息', async (t) => {
  const f = await fixture(t)
  const session = await f.prepare()
  f.setPlanner(async () => { throw new Error('secret upstream response') })
  await assert.rejects(f.propose(session), errorCode('AGENT_BETA_PLANNER_FAILED'))
  assert.equal((await f.service.getSession(userId, session.id)).messages.length, 0)
  assert.equal(f.calls.create, 0)
  f.setPlanner(async () => ({ kind: 'clarify', content: '想用什么背景？', prompt: null }))
  assert.equal((await f.propose(session)).messages.length, 2)
})

test('重复确认与服务实例重建只创建一次任务，修改已确认参数409', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  const messageId = session.messages[1].id
  const [first, second] = await Promise.all([
    f.service.execute(userId, session.id, { messageId, prompt: '自定义确认提示词' }),
    f.service.execute(userId, session.id, { messageId, prompt: '自定义确认提示词' }),
  ])
  assert.equal(first.messages[1].plan?.task?.taskId, second.messages[1].plan?.task?.taskId)
  assert.equal(f.calls.create, 1)
  const restarted = f.makeService()
  const recovered = await restarted.execute(userId, session.id, { messageId })
  assert.equal(recovered.messages[1].plan?.prompt, '自定义确认提示词')
  assert.equal(f.calls.create, 1)
  await assert.rejects(restarted.execute(userId, session.id, { messageId, prompt: '冲突提示词' }), errorCode('AGENT_BETA_EXECUTION_CONFLICT'))
})

test('任务已创建但会话写回前中断，刷新自动重新绑定原任务', async (t) => {
  const f = await fixture(t)
  const proposed = await f.propose(await f.prepare())
  const [userFile] = (await readdir(f.directory)).filter((name) => name.startsWith('user-') && name.endsWith('.json'))
  const original = await readFile(path.join(f.directory, userFile), 'utf8')
  const result = await f.service.execute(userId, proposed.id, { messageId: proposed.messages[1].id })
  await writeFile(path.join(f.directory, userFile), original)
  const recovered = await f.makeService().getSession(userId, proposed.id)
  assert.equal(recovered.messages[1].plan?.task?.taskId, result.messages[1].plan?.task?.taskId)
  assert.equal(f.calls.create, 1)
})

test('确认记录submitted未写回且任务丢失时，同方案禁止再次创建', async (t) => {
  const f = await fixture(t)
  const proposed = await f.propose(await f.prepare())
  const [userFile] = (await readdir(f.directory)).filter((name) => name.startsWith('user-') && name.endsWith('.json'))
  const original = await readFile(path.join(f.directory, userFile), 'utf8')
  await f.service.execute(userId, proposed.id, { messageId: proposed.messages[1].id })
  // 模拟会话/提交标记尚未写回，而任务仓库恢复了缺少该任务的旧快照。
  await writeFile(path.join(f.directory, userFile), original)
  const recordsPath = path.join(f.directory, 'executions.json')
  const records = JSON.parse(await readFile(recordsPath, 'utf8'))
  delete records.entries[0].submitted
  await writeFile(recordsPath, JSON.stringify(records))
  f.tasks.clear()
  await assert.rejects(f.makeService().execute(userId, proposed.id, { messageId: proposed.messages[1].id }), errorCode('AGENT_BETA_TASK_MISSING'))
  assert.equal(f.calls.create, 1)
  assert.equal(JSON.parse(await readFile(recordsPath, 'utf8')).entries.length, 1)
})

test('全局有确认记录但任务状态缺失时，也拒绝其他用户的新方案', async (t) => {
  const f = await fixture(t)
  const first = await f.propose(await f.prepare())
  const other = await f.propose(await f.prepare(otherUser), 'other_message', otherUser)
  await f.service.execute(userId, first.id, { messageId: first.messages[1].id })
  f.tasks.clear()
  await assert.rejects(f.makeService().execute(otherUser, other.id, { messageId: other.messages[1].id }), errorCode('AGENT_BETA_TASK_MISSING'))
  assert.equal(f.calls.create, 1)
  assert.equal(f.calls.queue, 1)
})

test('全局同时只执行一个Beta生成，原队列已满时不创建任务', async (t) => {
  const f = await fixture(t)
  const a = await f.propose(await f.prepare())
  const b = await f.propose(await f.prepare(otherUser), 'other_message', otherUser)
  const contenders = [
    { userId, session: a },
    { userId: otherUser, session: b },
  ]
  const results = await Promise.allSettled(contenders.map((contender) =>
    f.service.execute(contender.userId, contender.session.id, { messageId: contender.session.messages[1].id })))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(f.calls.create, 1)
  const rejectedIndex = results.findIndex((result) => result.status === 'rejected')
  assert.notEqual(rejectedIndex, -1)
  const rejected = contenders[rejectedIndex]
  for (const task of f.tasks.values()) task.status = 'success'
  f.setQueueFailure(true)
  await assert.rejects(f.service.execute(rejected.userId, rejected.session.id, {
    messageId: rejected.session.messages[1].id,
  }), /queue full/)
  assert.equal(f.calls.create, 1)
})

test('每日20次额度跨实例保留；重复确认不重复计入', async (t) => {
  const f = await fixture(t)
  let session = await f.prepare()
  for (let index = 0; index < 20; index++) {
    session = await f.propose(session, `message_${index}`)
    const messageId = session.messages.at(-1)!.id
    session = await f.service.execute(userId, session.id, { messageId })
    await f.service.execute(userId, session.id, { messageId })
    for (const task of f.tasks.values()) task.status = 'success'
  }
  assert.equal(f.calls.create, 20)
  session = await f.propose(session, 'message_21')
  await assert.rejects(f.makeService().execute(userId, session.id, { messageId: session.messages.at(-1)!.id }), errorCode('AGENT_BETA_DAILY_LIMIT'))
  assert.equal(f.calls.create, 20)
})

test('创建调用通用异常保留UNKNOWN，重复确认与实例重建都不重提', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  f.setCreationFailure(true)
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), /simulated disk/)
  const ledger = JSON.parse(await readFile(path.join(f.directory, 'executions.json'), 'utf8'))
  assert.equal(ledger.entries.length, 1)
  assert.equal(ledger.entries[0].submissionState, 'UNKNOWN')
  assert.equal(ledger.entries[0].sideEffectState, 'POSSIBLE')
  assert.equal(ledger.entries[0].taskStatus, undefined)
  f.setCreationFailure(false)
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_TASK_MISSING'))
  await assert.rejects(f.makeService().execute(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_TASK_MISSING'))
  assert.equal(f.calls.create, 1)
})

test('位置保存与LLM返回并发时均保留，LLM全局限1', async (t) => {
  const f = await fixture(t)
  const initial = await f.prepare()
  const other = await f.prepare(otherUser)
  let resolvePlanner!: (value: PlannerOutput) => void
  let plannerStarted!: () => void
  const started = new Promise<void>((resolve) => { plannerStarted = resolve })
  f.setPlanner(() => { plannerStarted(); return new Promise((resolve) => { resolvePlanner = resolve }) })
  const planning = f.propose(initial)
  await started
  await assert.rejects(f.propose(other, 'other_message', otherUser), errorCode('AGENT_BETA_PLANNING_BUSY'))
  await f.service.patchSession(userId, initial.id, { positions: [{ id: initial.nodes[0].id, x: 777, y: -123 }] })
  resolvePlanner({ kind: 'plan', content: '请确认', prompt: '自然光服装展示图。' })
  const result = await planning
  assert.equal(result.nodes[0].x, 777)
  assert.equal(result.nodes[0].y, -123)
  assert.equal(result.messages.length, 2)
  assert.equal(f.calls.create, 0)
})

test('结果节点重复刷新不重复添加，取消复用当前用户原任务', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  const asset = f.addAsset('generated_result')
  task.results.push({ assetId: asset.assetId, url: asset.fileUrl, downloadUrl: asset.fileUrl, width: 800, height: 1000 })
  task.resultAssetIds.push(asset.assetId)
  const first = await f.service.getSession(userId, session.id)
  const second = await f.service.getSession(userId, session.id)
  assert.equal(first.nodes.length, 2)
  assert.equal(second.nodes.length, 2)
  assert.equal(second.nodes[1].parentNodeId, session.nodes[0].id)
  const cancelled = await f.service.cancel(userId, session.id, { messageId: session.messages[1].id })
  assert.equal(f.calls.cancel, 1)
  assert.equal(cancelled.messages[1].plan?.task?.status, 'cancelled')
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  assert.equal(f.calls.create, 1)
})

test('取消后上游仍运行时占用Beta在途名额，真实执行结束后才释放', async (t) => {
  const f = await fixture(t)
  const first = await f.propose(await f.prepare())
  const second = await f.propose(await f.prepare(otherUser), 'message_other', otherUser)
  const confirmed = await f.service.execute(userId, first.id, { messageId: first.messages[1].id })
  const taskId = confirmed.messages[1].plan!.task!.taskId
  f.executing.add(taskId)
  await f.service.cancel(userId, first.id, { messageId: first.messages[1].id })
  assert.equal(f.tasks.get(taskId)!.status, 'cancelled')
  await assert.rejects(f.service.execute(otherUser, second.id, { messageId: second.messages[1].id }), errorCode('AGENT_BETA_BUSY'))
  assert.equal(f.calls.create, 1)
  f.executing.delete(taskId)
  await f.service.execute(otherUser, second.id, { messageId: second.messages[1].id })
  assert.equal(f.calls.create, 2)
})

test('消息重试保持幂等且参数冲突拒绝，非法模型/超长内容在LLM前拒绝', async (t) => {
  const f = await fixture(t)
  const initial = await f.prepare()
  await f.propose(initial)
  assert.equal((await f.propose(initial)).messages.length, 2)
  assert.equal(f.calls.plan, 1)
  const base = { clientMessageId: 'message_1', text: '不同要求', referenceNodeIds: [initial.nodes[0].id], settings }
  await assert.rejects(f.service.sendMessage(userId, initial.id, base), errorCode('AGENT_BETA_MESSAGE_CONFLICT'))
  await assert.rejects(f.service.sendMessage(userId, initial.id, { ...base, text: 'a'.repeat(4001) }), errorCode('AGENT_BETA_INVALID_REQUEST'))
  await assert.rejects(f.service.sendMessage(userId, initial.id, { ...base, settings: { ...settings, model: 'unknown' } }), errorCode('AGENT_BETA_INVALID_REQUEST'))
  await assert.rejects(f.service.sendMessage(userId, initial.id, { ...base, settings: { ...settings, model: 'nano-banana-2-lite', resolution: '4K' } }), errorCode('AGENT_BETA_INVALID_REQUEST'))
  assert.equal(f.calls.plan, 1)
})

test('JSON主文件损坏时使用最近原子备份恢复', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  const [userFile] = (await readdir(f.directory)).filter((name) => name.startsWith('user-') && name.endsWith('.json'))
  await writeFile(path.join(f.directory, userFile), '{broken')
  const recovered = await f.makeService().getSession(userId, session.id)
  assert.equal(recovered.messages.length, 2)
  assert.equal(recovered.nodes[0].assetId, 'asset_a')
})

type GeneratedLedgerEntry = ActionLedgerEntry & { actionKind: 'generate'; taskId: string }

function upgraded(entry: LegacyLedgerEntry): GeneratedLedgerEntry {
  return {
    schemaVersion: 1, recordKind: 'v1', actionKind: 'generate', key: entry.key,
    userId: entry.userId, sessionId: entry.sessionId, messageId: entry.messageId, taskId: entry.taskId,
    toolName: 'generate', requestDigest: 'a'.repeat(64), approvalEvidence: 'receipt', approvalDigest: 'b'.repeat(64),
    proposalId: 'proposal', previewVersion: 1, featureType: 'ai-fashion-photo', assetDigests: [], providerRequestIds: [],
    submissionState: entry.submissionState, sideEffectState: entry.sideEffectState, gateOutcome: entry.gateOutcome,
    resultAdmission: entry.resultAdmission, evidenceRefs: entry.evidenceRefs, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    ...(entry.taskStatus ? { taskStatus: entry.taskStatus } : {}),
  }
}

async function upgradeFirstExecution(repository: AgentBetaRepository): Promise<GeneratedLedgerEntry> {
  let upgradedEntry!: GeneratedLedgerEntry
  await repository.withActionLedger(async (entries, save) => {
    upgradedEntry = upgraded(entries[0] as LegacyLedgerEntry)
    entries[0] = upgradedEntry
    await save()
  })
  return upgradedEntry
}

function resultDecision(
  entry: GeneratedLedgerEntry,
  task: GenerationTask,
  resultAdmission: ResultAdmission,
  results: AdmittedResultView[],
): ResultAdmissionDecision {
  return {
    key: entry.key,
    messageId: entry.messageId,
    taskId: entry.taskId,
    taskStatus: task.status,
    resultAdmission,
    results,
    ...(resultAdmission === 'ADMITTED' ? {
      c8Evidence: { evidenceRef: `c8:${'c'.repeat(64)}`, resultDigest: 'd'.repeat(64) },
    } : {}),
  }
}

test('v1 pending只刷新真实任务展示，即使伪准入响应带结果也不上画布', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  const result = f.addAsset('pending_result')
  result.taskId = task.taskId
  task.results.push({ assetId: result.assetId, url: 'https://supplier.invalid/pending.png',
    downloadUrl: 'https://supplier.invalid/pending.png', width: 999, height: 999 })
  const entry = await upgradeFirstExecution(f.service.repository)
  const safe: AdmittedResultView = { assetId: result.assetId, taskId: task.taskId, fileName: 'safe-pending.png',
    url: '/admitted/pending.png', downloadUrl: '/admitted/pending.png', width: 320, height: 480 }
  f.deps.resultAdmission = { admitResults: async (scope, ledger) => {
    assert.deepEqual(scope, { userId, sessionId: session.id })
    const current = ledger.entries[0]
    current.resultAdmission = 'PENDING'
    current.taskStatus = task.status
    await ledger.save()
    return { decisions: [resultDecision(entry, task, 'PENDING', [safe])] }
  } }

  const refreshed = await f.service.getSession(userId, session.id)
  assert.equal(refreshed.messages[1].plan?.task?.status, 'pending')
  assert.equal(refreshed.nodes.length, 1)
  assert.equal(JSON.stringify(refreshed).includes('supplier.invalid'), false)
  assert.equal(JSON.stringify(refreshed).includes('/admitted/pending.png'), false)
})

test('账本仍为 ADMITTED 但本次 decision 未准入时，带 views 也不得发布', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  task.status = 'running'
  const result = f.addAsset('not_admitted_result')
  result.taskId = task.taskId
  task.results.push({ assetId: result.assetId, url: 'https://supplier.invalid/leak.png',
    downloadUrl: 'https://supplier.invalid/leak.png', width: 999, height: 999 })
  const entry = await upgradeFirstExecution(f.service.repository)
  const safe: AdmittedResultView = { assetId: result.assetId, taskId: task.taskId, fileName: 'leak.png',
    url: '/admitted/should-not-publish.png', downloadUrl: '/admitted/should-not-publish.png',
    width: 320, height: 480 }
  // 历史 action 早先已准入，但本轮 C8 判定回到 PENDING（共享任务正在跑后续 retry）。
  // 发布只能由本次 decision 决定，不能因为账本仍写着 ADMITTED 就放行。
  f.deps.resultAdmission = { admitResults: async (_scope, ledger) => {
    const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
    current.resultAdmission = 'ADMITTED'
    current.taskStatus = task.status
    await ledger.save()
    return { decisions: [resultDecision(entry, task, 'PENDING', [safe])] }
  } }

  const refreshed = await f.service.getSession(userId, session.id)
  assert.equal(refreshed.nodes.length, 1, '未准入的本轮结果不得成为画布节点')
  assert.equal(JSON.stringify(refreshed).includes('/admitted/should-not-publish.png'), false)
  assert.equal(JSON.stringify(refreshed).includes('supplier.invalid'), false)
})

test('v1 ADMITTED只发布安全视图，重复刷新不重复，撤销后隐藏已持久化节点', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  task.status = 'success'
  task.progress = 100
  task.message = '供应商原始完成消息'
  const result = f.addAsset('admitted_result')
  result.taskId = task.taskId
  task.results.push({ assetId: result.assetId, url: 'https://supplier.invalid/forged.png',
    downloadUrl: 'https://supplier.invalid/forged-download.png', width: 999, height: 998 })
  task.resultAssetIds.push(result.assetId)
  const entry = await upgradeFirstExecution(f.service.repository)
  const safe: AdmittedResultView = { assetId: result.assetId, taskId: task.taskId, fileName: '准入结果.png',
    url: '/admitted/safe.png', downloadUrl: '/admitted/safe-download.png', width: 321, height: 654 }
  let revoked = false
  let admissionCalls = 0
  let competingEntered = false
  let competing: Promise<void> | undefined
  f.deps.resultAdmission = { admitResults: async (scope, ledger) => {
    admissionCalls++
    assert.deepEqual(scope, { userId, sessionId: session.id })
    assert.equal(ledger.entries.some((candidate) => candidate.key === entry.key), true)
    if (admissionCalls === 1) {
      competing = new AgentBetaRepository(f.directory).withActionLedger(async () => { competingEntered = true })
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(competingEntered, false, 'admitResults 调用期间必须仍持有同一 ActionLedger 锁')
    }
    const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
    current.resultAdmission = 'ADMITTED'
    current.taskStatus = task.status
    await ledger.save()
    return { decisions: [resultDecision(entry, task, 'ADMITTED', revoked ? [] : [safe])] }
  } }
  let signalReconciliation!: () => void
  let releaseReconciliation!: () => void
  const reconciliationStarted = new Promise<void>((resolve) => { signalReconciliation = resolve })
  const reconciliationHold = new Promise<void>((resolve) => { releaseReconciliation = resolve })
  f.deps.reconcileExecutions = async () => {
    signalReconciliation()
    await reconciliationHold
    return {
      checkedCount: 0,
      changedCount: 0,
      unknownKeys: [],
      unverifiedKeys: [],
      manualReviewKeys: [],
      requiresManualReview: false,
    }
  }
  let reviewCalls = 0
  let signalFirstShadow!: () => void
  let releaseFirstShadow!: () => void
  const firstShadowStarted = new Promise<void>((resolve) => { signalFirstShadow = resolve })
  const firstShadowHold = new Promise<void>((resolve) => { releaseFirstShadow = resolve })
  const waitForReviewCalls = async (expected: number): Promise<void> => {
    const deadline = Date.now() + 1_000
    while (reviewCalls < expected) {
      if (Date.now() >= deadline) throw new Error(`shadow review did not reach ${expected} calls`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  f.deps.resultReview = { reviewAdmittedResults: async (scope, candidates) => {
    reviewCalls++
    assert.deepEqual(scope, { userId, sessionId: session.id })
    assert.deepEqual(candidates, [{
      assetId: safe.assetId,
      taskId: safe.taskId,
      fileName: safe.fileName,
      width: safe.width,
      height: safe.height,
      c8: {
        userId,
        sessionId: session.id,
        messageId: entry.messageId,
        taskId: entry.taskId,
        actionKey: entry.key,
        actionKind: entry.actionKind,
        requestDigest: entry.requestDigest,
        approvalDigest: entry.approvalDigest,
        evidenceRef: `c8:${'c'.repeat(64)}`,
        resultDigest: 'd'.repeat(64),
      },
    }])
    let acquiredAfterAdmission = false
    await new AgentBetaRepository(f.directory).withActionLedger(async () => { acquiredAfterAdmission = true })
    assert.equal(acquiredAfterAdmission, true, 'E1 shadow 评审必须在 ActionLedger 锁释放后执行')
    if (reviewCalls === 1) {
      signalFirstShadow()
      await firstShadowHold
    }
    throw new Error('simulated shadow review failure')
  } }

  const firstRequest = f.service.getSession(userId, session.id)
  await reconciliationStarted
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(reviewCalls, 0, 'reconcile 未完成时不得提前启动中间 C8 投影的 shadow')
  releaseReconciliation()
  const first = await new Promise<AgentBetaSession>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('C8 response waited for shadow review')), 1_000)
    void firstRequest.then(
      (value) => { clearTimeout(timeout); resolve(value) },
      (error) => { clearTimeout(timeout); reject(error) },
    )
  })
  assert.equal(first.nodes.length, 2, 'shadow 悬挂时仍必须立即返回 C8 安全结果')
  await firstShadowStarted
  assert.equal(reviewCalls, 1, 'GET 返回后才允许 shadow 开始')
  releaseFirstShadow()
  await competing
  assert.equal(competingEntered, true)

  const patched = await f.service.patchSession(userId, session.id, { title: '更新后的标题' })
  assert.equal(patched.title, '更新后的标题')
  await waitForReviewCalls(2)
  assert.equal(reviewCalls, 2, 'PATCH 返回新的 C8 ADMITTED 视图也必须在锁后进入 shadow')
  const added = await f.service.addAssets(userId, session.id, { assetIds: ['asset_a'] })
  assert.equal(added.nodes.length, 2)
  await waitForReviewCalls(3)
  assert.equal(reviewCalls, 3, 'addAssets 返回新的 C8 ADMITTED 视图也必须在锁后进入 shadow')

  const second = await f.makeService().getSession(userId, session.id)
  assert.equal(first.nodes.length, 2)
  assert.equal(second.nodes.length, 2)
  assert.equal(second.nodes[1].name, safe.fileName)
  assert.equal(second.nodes[1].url, safe.url)
  assert.equal(second.nodes[1].width, safe.width)
  assert.equal(second.nodes[1].height, safe.height)
  assert.equal(JSON.stringify(second).includes('supplier.invalid'), false)
  assert.equal((await f.service.repository.readUser(userId)).sessions[0].nodes.length, 2)

  // 同一 task 启动后续 retry 会回到 pending；旧 ADMITTED action 仍应由其历史窗口发布。
  task.status = 'pending'
  task.progress = 0
  const duringLaterRetry = await f.makeService().getSession(userId, session.id)
  assert.equal(duringLaterRetry.messages[1].plan?.task?.status, 'pending')
  assert.equal(duringLaterRetry.nodes.length, 2)
  assert.equal(duringLaterRetry.nodes[1].url, safe.url)
  task.status = 'success'
  task.progress = 100

  await f.service.repository.mutateUser(userId, (file) => { file.sessions[0].nodes[1].taskId = 'wrong-task' })
  const mismatched = await f.makeService().getSession(userId, session.id)
  assert.equal(mismatched.nodes.length, 1, '安全视图必须同时精确匹配持久化节点的 taskId 与 assetId')
  await f.service.repository.mutateUser(userId, (file) => { file.sessions[0].nodes[1].taskId = task.taskId })

  revoked = true
  const hidden = await f.makeService().getSession(userId, session.id)
  assert.equal(hidden.nodes.length, 1)
  assert.equal((await f.service.repository.readUser(userId)).sessions[0].nodes.length, 2,
    '撤销准入后保留坐标记录，但 hydrate 不得旁路本次安全视图')
})

test('reconcile 撤销早期 C8 ADMITTED 后，不得把过期候选交给 shadow', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  task.status = 'success'
  task.progress = 100
  const result = f.addAsset('reconciled_result')
  result.taskId = task.taskId
  task.results.push({ assetId: result.assetId, url: '/supplier/reconciled.png',
    downloadUrl: '/supplier/reconciled.png', width: 640, height: 960 })
  task.resultAssetIds.push(result.assetId)
  const entry = await upgradeFirstExecution(f.service.repository)
  const safe: AdmittedResultView = { assetId: result.assetId, taskId: task.taskId, fileName: '最终会撤销.png',
    url: '/admitted/reconciled.png', downloadUrl: '/admitted/reconciled.png', width: 640, height: 960 }
  let admissionCalls = 0
  f.deps.resultAdmission = { admitResults: async (_scope, ledger) => {
    admissionCalls++
    const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
    if (current.submissionState === 'UNKNOWN') {
      current.resultAdmission = 'QUARANTINED'
      current.gateOutcome = 'BLOCKED_RESULT'
      await ledger.save()
      return { decisions: [resultDecision(entry, task, 'QUARANTINED', [])] }
    }
    current.resultAdmission = 'ADMITTED'
    current.taskStatus = task.status
    await ledger.save()
    return { decisions: [resultDecision(entry, task, 'ADMITTED', [safe])] }
  } }
  f.deps.reconcileExecutions = async () => {
    await f.service.repository.withActionLedger(async (entries, save) => {
      const current = entries.find((candidate) => candidate.key === entry.key)!
      current.submissionState = 'UNKNOWN'
      current.sideEffectState = 'POSSIBLE'
      current.gateOutcome = 'BLOCKED_RESULT'
      current.resultAdmission = 'QUARANTINED'
      delete current.taskStatus
      await save()
    })
    return {
      checkedCount: 1,
      changedCount: 1,
      unknownKeys: [entry.key],
      unverifiedKeys: [entry.key],
      manualReviewKeys: [],
      requiresManualReview: false,
    }
  }
  let reviewCalls = 0
  f.deps.resultReview = { async reviewAdmittedResults() { reviewCalls++; return { decisions: [] } } }

  const refreshed = await f.service.getSession(userId, session.id)
  assert.equal(admissionCalls, 2, 'getSession 应在 reconcile 前后各同步一次 C8')
  assert.equal(refreshed.nodes.length, 1, 'final C8 QUARANTINED 不得返回先前安全节点')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(reviewCalls, 0, 'final C8 撤销必须删除 scope 内早期 shadow candidate')
})

test('v1缺准入端口、UNKNOWN或QUARANTINED均不显示任务结果', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  task.status = 'success'
  task.progress = 100
  const result = f.addAsset('protected_result')
  result.taskId = task.taskId
  const entry = await upgradeFirstExecution(f.service.repository)
  await f.service.repository.mutateUser(userId, (file) => { file.sessions[0].nodes.push({
    id: `result_${result.assetId}`, assetId: result.assetId, taskId: task.taskId, x: 10, y: 20,
  }) })
  const safe: AdmittedResultView = { assetId: result.assetId, taskId: task.taskId, fileName: '不应显示.png',
    url: '/admitted/should-not-show.png', downloadUrl: '/admitted/should-not-show.png', width: 10, height: 20 }

  const withoutPort = await f.service.getSession(userId, session.id)
  assert.equal(withoutPort.nodes.length, 1)
  assert.equal(withoutPort.messages[1].plan?.task, undefined)

  f.deps.resultAdmission = { admitResults: async (_scope, ledger) => {
    const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
    current.submissionState = 'UNKNOWN'
    current.resultAdmission = 'ADMITTED'
    await ledger.save()
    return { decisions: [resultDecision(entry, task, 'ADMITTED', [safe])] }
  } }
  const unknown = await f.makeService().getSession(userId, session.id)
  assert.equal(unknown.nodes.length, 1)
  assert.equal(unknown.messages[1].plan?.task, undefined)

  f.deps.resultAdmission = { admitResults: async (_scope, ledger) => {
    const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
    current.submissionState = 'SUBMITTED'
    current.sideEffectState = 'CONFIRMED'
    current.gateOutcome = 'BLOCKED_RESULT'
    current.resultAdmission = 'QUARANTINED'
    await ledger.save()
    return { decisions: [resultDecision(entry, task, 'QUARANTINED', [])] }
  } }
  const quarantined = await f.makeService().getSession(userId, session.id)
  assert.equal(quarantined.nodes.length, 1)
  assert.equal(quarantined.messages[1].plan?.task, undefined)
})

test('真实 reconciler 不得抢在 C8 前把已准入的缺失/不可查/转属任务降级后再解禁', async (t) => {
  for (const mode of ['missing', 'query_failed', 'owner_changed'] as const) {
    await t.test(mode, async (subtest) => {
      const f = await fixture(subtest)
      const session = await f.propose(await f.prepare())
      await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
      const task = [...f.tasks.values()][0]
      task.status = 'success'
      task.progress = 100
      const entry = await upgradeFirstExecution(f.service.repository)
      await f.service.repository.withActionLedger(async (entries, save) => {
        const current = entries.find((candidate) => candidate.key === entry.key)!
        current.taskStatus = 'success'
        current.resultAdmission = 'ADMITTED'
        await save()
      })

      let queryFails = mode === 'query_failed'
      if (mode === 'missing') f.tasks.delete(task.taskId)
      if (mode === 'owner_changed') task.userId = otherUser
      const getTask = async (id: string) => {
        if (queryFails) throw new Error('task query unavailable')
        return f.tasks.get(id)
      }
      f.deps.getTask = getTask
      f.deps.reconcileExecutions = createUnknownReconciler({
        ledger: f.service.repository,
        tasks: { getTask },
        now: f.deps.now,
      })
      let firstAdmissionState: string | undefined
      f.deps.resultAdmission = { admitResults: async (_scope, ledger) => {
        const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
        if (firstAdmissionState === undefined) firstAdmissionState = current.submissionState
        if (current.resultAdmission !== 'QUARANTINED') {
          let observed: GenerationTask | undefined
          try { observed = await getTask(entry.taskId) } catch { observed = undefined }
          if (!observed || observed.taskId !== entry.taskId || observed.userId !== userId) {
            current.submissionState = 'UNKNOWN'
            delete current.taskStatus
            current.gateOutcome = 'BLOCKED_RESULT'
            current.resultAdmission = 'QUARANTINED'
            await ledger.save()
          }
        }
        return { decisions: [{ key: entry.key, messageId: entry.messageId, taskId: entry.taskId,
          ...(current.taskStatus ? { taskStatus: current.taskStatus } : {}),
          resultAdmission: current.resultAdmission, results: [] }] }
      } }

      const hidden = await f.makeService().getSession(userId, session.id)
      assert.equal(firstAdmissionState, 'SUBMITTED', 'C8 必须先看到 reconciler 尚未改写的事实')
      assert.equal(hidden.nodes.length, 1)
      let persisted = (await f.service.repository.readActionLedger()).entries[0]
      assert.equal(persisted.gateOutcome, 'BLOCKED_RESULT')
      assert.equal(persisted.resultAdmission, 'QUARANTINED')

      queryFails = false
      task.userId = userId
      f.tasks.set(task.taskId, task)
      await f.makeService().getSession(userId, session.id)
      persisted = (await f.service.repository.readActionLedger()).entries[0]
      assert.equal(persisted.resultAdmission, 'QUARANTINED')
      assert.equal(persisted.gateOutcome, 'BLOCKED_RESULT')
    })
  }
})

test('v1并发刷新跨Repository实例在5秒内完成且不重取ledger锁', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  const entry = await upgradeFirstExecution(f.service.repository)
  let calls = 0
  f.deps.resultAdmission = { admitResults: async (_scope, ledger) => {
    calls++
    const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
    current.resultAdmission = 'PENDING'
    current.taskStatus = task.status
    await new Promise((resolve) => setTimeout(resolve, 2))
    await ledger.save()
    return { decisions: [resultDecision(entry, task, 'PENDING', [])] }
  } }
  const services = Array.from({ length: 8 }, () => f.makeService())
  const refreshed = await Promise.all(services.map((service) => service.getSession(userId, session.id)))
  assert.equal(calls, services.length)
  assert.equal(refreshed.every((current) => current.nodes.length === 1), true)
  assert.equal((await f.service.repository.readActionLedger()).entries.length, 1)
})

test('真实create调用前STARTING/POSSIBLE已落盘，pending原样记录', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  const create = f.deps.createTask
  f.deps.createTask = async (input) => {
    const file = JSON.parse(await readFile(path.join(f.directory, 'executions.json'), 'utf8'))
    assert.equal(file.entries[0].submissionState, 'STARTING')
    assert.equal(file.entries[0].sideEffectState, 'POSSIBLE')
    assert.equal(file.entries[0].taskStatus, undefined)
    return create(input)
  }
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const entry = (await f.service.repository.readActionLedger()).entries[0]
  assert.equal(entry.submissionState, 'SUBMITTED')
  assert.equal(entry.taskStatus, 'pending')
  assert.equal(entry.sideEffectState, 'CONFIRMED')
})

test('schema、所有权、队列在调用前失败均不占确认名额', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id, prompt: 42 }), errorCode('AGENT_BETA_INVALID_REQUEST'))
  f.assets.get('asset_a')!.userId = otherUser
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_ASSET_NOT_FOUND'))
  f.assets.get('asset_a')!.userId = userId
  f.setQueueFailure(true)
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), /queue full/)
  assert.equal(f.calls.create, 0)
  assert.deepEqual((await f.service.repository.readActionLedger()).entries, [])
  f.setQueueFailure(false)
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  assert.equal(f.calls.create, 1)
})

test('安全账STARTING写盘失败时不调用createTask', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.repository.withActionLedger(async (_entries, save) => save())
  await mkdir(path.join(f.directory, 'executions.json.tmp-write'))
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }))
  assert.equal(f.calls.create, 0)
  assert.deepEqual((await f.service.repository.readActionLedger()).entries, [])
})

test('create返回前抛错但任务已存在，保存真实pending并恢复同任务', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  const create = f.deps.createTask
  f.deps.createTask = async (input) => { await create(input); throw new Error('response lost') }
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), /response lost/)
  const entry = (await f.service.repository.readActionLedger()).entries[0]
  assert.equal(entry.submissionState, 'SUBMITTED')
  assert.equal(entry.taskStatus, 'pending')
  await f.makeService().execute(userId, session.id, { messageId: session.messages[1].id })
  assert.equal(f.calls.create, 1)
})

test('create返回错误身份不能绑定或上画布，保留UNKNOWN防重复', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  const create = f.deps.createTask
  f.deps.createTask = async (input) => {
    const task = await create(input)
    f.tasks.clear()
    return { ...task, taskId: 'wrong-task', userId: otherUser }
  }
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_EXECUTION_CONFLICT'))
  assert.equal((await f.service.repository.readActionLedger()).entries[0].submissionState, 'UNKNOWN')
  assert.equal((await f.service.getSession(userId, session.id)).messages[1].plan?.task, undefined)
  await assert.rejects(f.makeService().execute(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_TASK_MISSING'))
  assert.equal(f.calls.create, 1)
})

test('execute与其他Repository实例的getSession并发不死锁或重复创建', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  const other = f.makeService()
  const result = await Promise.all([
    f.service.execute(userId, session.id, { messageId: session.messages[1].id }),
    other.getSession(userId, session.id),
    other.execute(userId, session.id, { messageId: session.messages[1].id }),
  ])
  assert.equal(f.calls.create, 1)
  assert.equal(result[0].messages[1].plan?.task?.taskId, result[2].messages[1].plan?.task?.taskId)
})

test('混合v1不能走旧execute/cancel/sync，已存结果节点也不可重新展示', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  const asset = f.addAsset('v1_result')
  asset.taskId = task.taskId
  task.results.push({ assetId: asset.assetId, url: asset.fileUrl, downloadUrl: asset.fileUrl, width: 800, height: 1000 })
  assert.equal((await f.service.getSession(userId, session.id)).nodes.length, 2)
  await f.service.repository.withActionLedger(async (entries, save) => { entries[0] = upgraded(entries[0] as LegacyLedgerEntry); await save() })
  // 历史节点缺少taskId时仍必须通过资产来源检查。
  await f.service.repository.mutateUser(userId, (file) => { delete file.sessions[0].nodes[1].taskId })
  assert.equal((await f.service.getSession(userId, session.id)).nodes.length, 1)
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_EXECUTION_PROTECTED'))
  await assert.rejects(f.service.cancel(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_EXECUTION_PROTECTED'))
  await assert.rejects(f.service.addAssets(userId, session.id, { assetIds: [asset.assetId] }), errorCode('AGENT_BETA_EXECUTION_PROTECTED'))
  assert.equal(f.calls.create, 1)
  assert.equal(f.calls.cancel, 0)
})

test('QUARANTINED的legacy结果无node.taskId也不能展示或作为参考图', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  const asset = f.addAsset('quarantined')
  asset.taskId = task.taskId
  await f.service.repository.mutateUser(userId, (file) => { file.sessions[0].nodes.push({ id: 'hidden-node', assetId: asset.assetId, x: 100, y: 100 }) })
  await f.service.repository.withActionLedger(async (entries, save) => { entries[0].resultAdmission = 'QUARANTINED'; await save() })
  assert.equal((await f.service.getSession(userId, session.id)).nodes.length, 1)
  await assert.rejects(f.service.sendMessage(userId, session.id, { clientMessageId: 'new-message', text: '生成新图', referenceNodeIds: ['hidden-node'], settings }), errorCode('AGENT_BETA_EXECUTION_PROTECTED'))
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), errorCode('AGENT_BETA_EXECUTION_PROTECTED'))
  assert.equal(f.calls.plan, 1)
})

test('v1未知债务与在途生成阻止不同legacy方案绕过；纯分类不占生图名额', async (t) => {
  const f = await fixture(t)
  const first = await f.propose(await f.prepare())
  const next = await f.propose(await f.prepare(otherUser), 'next-message', otherUser)
  await f.service.execute(userId, first.id, { messageId: first.messages[1].id })
  const task = [...f.tasks.values()][0]
  await f.service.repository.withActionLedger(async (entries, save) => { entries[0] = { ...upgraded(entries[0] as LegacyLedgerEntry), submissionState: 'UNKNOWN', sideEffectState: 'POSSIBLE' }; await save() })
  await assert.rejects(f.makeService().execute(otherUser, next.id, { messageId: next.messages[1].id }), errorCode('AGENT_BETA_TASK_MISSING'))
  await f.service.repository.withActionLedger(async (entries, save) => { Object.assign(entries[0], { submissionState: 'SUBMITTED', sideEffectState: 'CONFIRMED', taskStatus: 'pending' }); await save() })
  await assert.rejects(f.service.execute(otherUser, next.id, { messageId: next.messages[1].id }), errorCode('AGENT_BETA_BUSY'))
  assert.equal(f.calls.create, 1)
  task.status = 'success'
  await f.service.repository.withActionLedger(async (entries, save) => {
    entries[0].taskStatus = 'success'
    const original = entries[0]
    entries.push({ schemaVersion: 1, recordKind: 'v1', actionKind: 'classify', key: 'classification', userId, sessionId: first.id, messageId: 'classify-message', toolName: 'classify', requestDigest: 'd'.repeat(64), assetDigests: [], providerRequestIds: [], approvalEvidence: 'explicit_user_intent', approvalDigest: null, intentId: 'intent', assetId: 'asset_a', submissionState: 'UNKNOWN', sideEffectState: 'POSSIBLE', gateOutcome: 'PASSED_PRE', resultAdmission: 'NOT_APPLICABLE', evidenceRefs: [], createdAt: original.createdAt, updatedAt: original.updatedAt })
    await save()
  })
  await f.service.execute(otherUser, next.id, { messageId: next.messages[1].id })
  assert.equal(f.calls.create, 2)
})


type BetaFixture = Awaited<ReturnType<typeof fixture>>
type RetryLedgerEntry = ActionLedgerEntry & { actionKind: 'retry_shots'; taskId: string }
type AdmissionMode = 'ADMITTED' | 'QUARANTINED' | 'UNKNOWN'

function retryResultDecision(
  entry: RetryLedgerEntry,
  task: GenerationTask,
  resultAdmission: ResultAdmission,
  results: AdmittedResultView[],
): ResultAdmissionDecision {
  return {
    key: entry.key,
    messageId: entry.messageId,
    taskId: entry.taskId,
    taskStatus: task.status,
    resultAdmission,
    results,
  }
}

async function prepareAdmittedBetaResult(f: BetaFixture, resultAssetId: string) {
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  task.status = 'success'
  task.progress = 100
  task.message = '生成完成'
  const result = f.addAsset(resultAssetId)
  result.taskId = task.taskId
  task.results.push({
    assetId: result.assetId,
    url: `https://supplier.invalid/${result.assetId}.png`,
    downloadUrl: `https://supplier.invalid/${result.assetId}-download.png`,
    width: 999,
    height: 998,
  })
  task.resultAssetIds.push(result.assetId)
  const entry = await upgradeFirstExecution(f.service.repository)
  const safe: AdmittedResultView = {
    assetId: result.assetId,
    taskId: task.taskId,
    fileName: `${result.assetId}-safe.png`,
    url: `/admitted/${result.assetId}.png`,
    downloadUrl: `/admitted/${result.assetId}-download.png`,
    width: 321,
    height: 654,
  }
  let mode: AdmissionMode = 'ADMITTED'
  let calls = 0
  f.deps.resultAdmission = {
    admitResults: async (scope, ledger) => {
      calls++
      assert.deepEqual(scope, { userId, sessionId: session.id })
      const current = ledger.entries.find((candidate) => candidate.key === entry.key)!
      current.taskStatus = task.status
      if (mode === 'UNKNOWN') {
        current.submissionState = 'UNKNOWN'
        current.sideEffectState = 'POSSIBLE'
        current.gateOutcome = 'PASSED_PRE'
        current.resultAdmission = 'ADMITTED'
      } else {
        current.submissionState = 'SUBMITTED'
        current.sideEffectState = 'CONFIRMED'
        current.gateOutcome = mode === 'QUARANTINED' ? 'BLOCKED_RESULT' : 'PASSED_PRE'
        current.resultAdmission = mode
      }
      await ledger.save()
      // UNKNOWN 故意返回伪 ADMITTED 安全视图，验证 Beta 仍按可信 ledger fail closed。
      const decisionAdmission = mode === 'QUARANTINED' ? 'QUARANTINED' : 'ADMITTED'
      return {
        decisions: [resultDecision(
          entry,
          task,
          decisionAdmission,
          decisionAdmission === 'ADMITTED' ? [safe] : [],
        )],
      }
    },
  }
  return {
    session,
    task,
    entry,
    safe,
    setMode(value: AdmissionMode) { mode = value },
    admissionCalls() { return calls },
  }
}

test('真实 retry 消息按唯一 v1 ledger 身份发布本轮新 shot，旧图与外部记录不发布且刷新去重', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  task.status = 'success'
  task.progress = 100
  task.message = '重试完成'
  const oldResult = f.addAsset('retry_old_result')
  const newResult = f.addAsset('retry_new_result')
  oldResult.taskId = task.taskId
  newResult.taskId = task.taskId
  task.results.push(
    { assetId: oldResult.assetId, url: oldResult.fileUrl, downloadUrl: oldResult.fileUrl, width: 800, height: 1000, shotId: 'shot_old' },
    { assetId: newResult.assetId, url: newResult.fileUrl, downloadUrl: newResult.fileUrl, width: 800, height: 1000, shotId: 'shot_retry' },
  )
  task.resultAssetIds.push(oldResult.assetId, newResult.assetId)
  await upgradeFirstExecution(f.service.repository)

  const retryMessageId = 'assistant_retry_message'
  await f.service.repository.mutateUser(userId, (file) => {
    const current = file.sessions.find((candidate) => candidate.id === session.id)!
    current.messages.push({
      id: retryMessageId,
      role: 'assistant',
      content: '已按批准范围重试失败分镜。',
      createdAt: f.deps.now!().toISOString(),
      referenceNodeIds: [current.nodes[0].id],
      plan: {
        id: 'retry_plan',
        prompt: '只重试批准的新分镜。',
        referenceNodeIds: [current.nodes[0].id],
        settings,
        status: 'submitted',
        // 持久化消息不是任务身份来源；刷新必须以可信 retry ledger 的原 taskId 为准。
        task: { taskId: 'message_supplied_wrong_task', status: 'success', progress: 100, message: '不可信缓存' },
      },
    })
  })

  const retryEntry: RetryLedgerEntry = {
    schemaVersion: 1,
    recordKind: 'v1',
    actionKind: 'retry_shots',
    approvalEvidence: 'receipt',
    key: `agent-v1:retry:${session.id}:${retryMessageId}:1`,
    userId,
    sessionId: session.id,
    messageId: retryMessageId,
    toolName: 'task.retry_shots',
    requestDigest: 'c'.repeat(64),
    approvalDigest: 'd'.repeat(64),
    assetDigests: ['e'.repeat(64)],
    proposalId: 'retry_proposal',
    previewVersion: 1,
    featureType: 'ai-fashion-photo',
    taskId: task.taskId,
    providerRequestIds: [],
    submissionState: 'SUBMITTED',
    taskStatus: 'success',
    gateOutcome: 'PASSED_PRE',
    sideEffectState: 'CONFIRMED',
    resultAdmission: 'PENDING',
    evidenceRefs: [],
    createdAt: f.deps.now!().toISOString(),
    updatedAt: f.deps.now!().toISOString(),
  }
  const foreignEntry: RetryLedgerEntry = {
    ...retryEntry,
    key: 'agent-v1:retry:foreign-session',
    userId: otherUser,
    sessionId: 'foreign_session',
    messageId: 'foreign_message',
    requestDigest: 'f'.repeat(64),
  }
  await f.service.repository.withActionLedger(async (entries, save) => {
    entries.push(retryEntry, foreignEntry)
    await save()
  })
  const safeNew: AdmittedResultView = {
    assetId: newResult.assetId,
    taskId: task.taskId,
    shotId: 'shot_retry',
    fileName: 'retry-new-safe.png',
    url: '/admitted/retry-new.png',
    downloadUrl: '/admitted/retry-new-download.png',
    width: 444,
    height: 666,
  }
  const foreignSafe: AdmittedResultView = {
    assetId: oldResult.assetId,
    taskId: task.taskId,
    shotId: 'shot_old',
    fileName: 'foreign-old.png',
    url: '/admitted/foreign-old.png',
    downloadUrl: '/admitted/foreign-old-download.png',
    width: 111,
    height: 222,
  }
  f.deps.resultAdmission = {
    admitResults: async (scope, ledger) => {
      assert.deepEqual(scope, { userId, sessionId: session.id })
      const current = ledger.entries.find((candidate) => candidate.key === retryEntry.key)!
      current.resultAdmission = 'ADMITTED'
      current.taskStatus = task.status
      await ledger.save()
      return {
        decisions: [
          retryResultDecision(retryEntry, task, 'ADMITTED', [safeNew]),
          retryResultDecision(foreignEntry, task, 'ADMITTED', [foreignSafe]),
        ],
      }
    },
  }

  const first = await f.service.getSession(userId, session.id)
  const second = await f.makeService().getSession(userId, session.id)
  for (const refreshed of [first, second]) {
    assert.deepEqual(refreshed.nodes.map((node) => node.assetId), ['asset_a', newResult.assetId])
    assert.equal(refreshed.nodes[1].url, safeNew.url)
    assert.equal(refreshed.nodes[1].name, safeNew.fileName)
    assert.equal(refreshed.nodes.some((node) => node.assetId === oldResult.assetId), false)
    assert.equal(refreshed.messages.find((message) => message.id === retryMessageId)?.plan?.task?.taskId, task.taskId)
  }
  assert.equal((await f.service.repository.readUser(userId)).sessions[0].nodes.filter((node) => node.assetId === newResult.assetId).length, 1)

  const duplicate: RetryLedgerEntry = {
    ...retryEntry,
    key: `${retryEntry.key}:duplicate`,
    requestDigest: '9'.repeat(64),
  }
  await f.service.repository.withActionLedger(async (entries, save) => {
    entries.push(duplicate)
    await save()
  })
  const ambiguous = await f.makeService().getSession(userId, session.id)
  assert.deepEqual(ambiguous.nodes.map((node) => node.assetId), ['asset_a'], '重复 retry ledger 身份必须 fail closed')
})

test('pose-fission retry 任务无 prompt 字段时 GET、PATCH 与 sendMessage 保留原计划提示词', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  const poseParams: PoseFissionParams = {
    model: DEFAULT_FASHION_MODEL,
    poses: [{ id: 'pose_front_full', url: '/poses/front-full.png', name: '正面全身', bodyPart: 'full' }],
    hasFrontDetail: true,
    hasBackDetail: false,
    imageRatio: '3:4',
    resolution: '2k',
    resultCount: 1,
    creditsCost: 0,
  }
  assert.equal('userPrompt' in poseParams, false)
  assert.equal('prompt' in poseParams, false)
  task.featureType = 'pose-fission'
  task.params = poseParams
  task.status = 'running'
  task.progress = 45
  task.message = '姿势裂变重试中'

  const retryMessageId = 'assistant_pose_fission_retry'
  const originalPrompt = '严格保留原姿势裂变计划中的非空提示词。'
  assert.ok(originalPrompt.length > 0)
  await f.service.repository.mutateUser(userId, (file) => {
    const current = file.sessions.find((candidate) => candidate.id === session.id)!
    current.messages.push({
      id: retryMessageId,
      role: 'assistant',
      content: '正在重试批准的姿势分镜。',
      createdAt: f.deps.now!().toISOString(),
      referenceNodeIds: [current.nodes[0].id],
      plan: {
        id: 'pose-fission-retry-plan',
        prompt: originalPrompt,
        referenceNodeIds: [current.nodes[0].id],
        settings,
        status: 'submitted',
      },
    })
  })

  const retryEntry: RetryLedgerEntry = {
    schemaVersion: 1,
    recordKind: 'v1',
    actionKind: 'retry_shots',
    approvalEvidence: 'receipt',
    key: `agent-v1:retry:${session.id}:${retryMessageId}:1`,
    userId,
    sessionId: session.id,
    messageId: retryMessageId,
    toolName: 'task.retry_shots',
    requestDigest: '4'.repeat(64),
    approvalDigest: '5'.repeat(64),
    assetDigests: ['6'.repeat(64)],
    proposalId: 'pose-fission-retry-proposal',
    previewVersion: 1,
    featureType: 'pose-fission',
    taskId: task.taskId,
    providerRequestIds: [],
    submissionState: 'SUBMITTED',
    taskStatus: 'running',
    gateOutcome: 'PASSED_PRE',
    sideEffectState: 'CONFIRMED',
    resultAdmission: 'PENDING',
    evidenceRefs: [],
    createdAt: f.deps.now!().toISOString(),
    updatedAt: f.deps.now!().toISOString(),
  }
  await f.service.repository.withActionLedger(async (entries, save) => {
    entries.splice(0, entries.length, retryEntry)
    await save()
  })
  f.deps.resultAdmission = {
    admitResults: async (scope) => {
      assert.deepEqual(scope, { userId, sessionId: session.id })
      return { decisions: [retryResultDecision(retryEntry, task, 'PENDING', [])] }
    },
  }

  const fromGet = await f.service.getSession(userId, session.id)
  const fromPatch = await f.service.patchSession(userId, session.id, { title: '姿势裂变重试会话' })
  f.setPlanner(async () => ({ kind: 'clarify', content: '请补充下一个需求。', prompt: null }))
  const referenceNodeId = fromGet.nodes.find((node) => node.assetId === 'asset_a')!.id
  const fromSendMessage = await f.service.sendMessage(userId, session.id, {
    clientMessageId: 'message_after_pose_retry',
    text: '继续准备下一组姿势',
    referenceNodeIds: [referenceNodeId],
    settings,
  })

  const returnedPrompts = [fromGet, fromPatch, fromSendMessage].map((current) =>
    current.messages.find((message) => message.id === retryMessageId)?.plan?.prompt)
  assert.deepEqual(returnedPrompts, [originalPrompt, originalPrompt, originalPrompt])
  assert.equal(returnedPrompts.every((prompt) => typeof prompt === 'string' && prompt.length > 0), true)
})

test('真实 C8 核心 decision 接入 Beta retry 消息，只发布该 attempt 新结果', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  const task = [...f.tasks.values()][0]
  const retryMessageId = 'assistant_real_c8_retry'
  const retryKey = `agent-v1:retry:${session.id}:${retryMessageId}:1`
  const input = f.assets.get('asset_a')!
  const inputHash = await assetDigest(input)
  const garmentParams: GarmentDetailParams = {
    category: 'tops', algorithmModelId: 'std-v1', algorithmModelName: '标准版', modelTier: 'standard',
    resolution: '1k', imageRatio: '1:1', userPrompt: '保留真实服装', aiAppendDescription: false,
    referenceImageCount: 0, detailShots: [
      { shotId: 'detail_1', label: '领口细节', referenceAssetId: null },
      { shotId: 'detail_2', label: '面料细节', referenceAssetId: null },
    ], resultCount: 2, creditsCost: 0, resolvedModelId: 'nano-banana-2',
    promptTemplateVersion: 'garment-detail-v1',
  }
  const frozenParamsDigest = await paramsDigest('garment-detail', garmentParams)
  const preview: RetryPreviewArtifact = {
    schemaVersion: 1, proposalId: 'real-c8-retry', version: 1, userId, sessionId: session.id,
    messageId: retryMessageId, toolName: 'task.retry_shots', featureType: 'garment-detail',
    assetDigests: [inputHash], paramsDigest: frozenParamsDigest, policyVersion: 'policy-v1',
    estimatedResultCount: 1, resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'garment-detail-v1',
    blockers: [], riskNotices: ['重试已批准'], createdAt: '2026-09-13T14:00:00.000Z',
    expiresAt: '2026-09-13T14:30:00.000Z', taskId: task.taskId, shotIds: ['detail_1'], attempt: 1,
  }
  const action = { actionKind: 'retry_shots' as const, payload: preview }
  const fullDigest = await requestDigest(action)
  const receipt: ApprovalReceipt = {
    schemaVersion: 1, approvalId: 'approval-real-c8-retry', userId, proposalId: preview.proposalId,
    previewVersion: preview.version, paramsDigest: preview.paramsDigest,
    assetDigests: [...preview.assetDigests], requestDigest: fullDigest, approvedAt: '2026-09-13T14:01:00.000Z',
  }
  const approvalHash = await approvalDigest(receipt)
  const referenceBase = {
    schemaVersion: 1 as const, key: preparationArtifactKey(userId, preview.proposalId, preview.version),
    kind: 'retry_shots' as const, inputDigest: '1'.repeat(64), requestDigest: fullDigest,
    inputAssetIds: ['asset_a'], sourceTaskId: task.taskId, sourceTaskStateDigest: '2'.repeat(64),
  }
  const reference: StoredPreparationReference = {
    ...referenceBase, artifact: preview, referenceDigest: await digest(referenceBase),
  }
  const oldResult = { assetId: 'real-c8-old', url: '/old.png', downloadUrl: '/old.png',
    width: 800, height: 1000, shotId: 'detail_2' }
  task.featureType = 'garment-detail'
  task.params = garmentParams
  task.inputAssetIds = ['asset_a']
  task.status = 'pending'
  task.progress = 0
  task.results = [oldResult]
  task.resultAssetIds = [oldResult.assetId]
  task.agentExecution = {
    schemaVersion: 1, paramsDigest: frozenParamsDigest, assetDigests: [inputHash],
    resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'garment-detail-v1', normalizationSeed: null,
    requestDigest: fullDigest, idempotencyKey: retryKey, attempts: [
      { actionKind: 'generate', requestDigest: '3'.repeat(64), idempotencyKey: 'original-generate',
        shotIds: [], attempt: null, priorResultAssetIds: [] },
      { actionKind: 'retry_shots', requestDigest: fullDigest, idempotencyKey: retryKey,
        shotIds: ['detail_1'], attempt: 1, priorResultAssetIds: [oldResult.assetId] },
    ],
  }
  const evidence = new FileResultAdmissionEvidenceStore(f.directory, { now: f.deps.now })
  const artifacts = { get: async (key: string) => key === reference.key ? reference : undefined }
  const approvals = { verifyHistoricalApproval: async () => receipt }
  const posted = await createPostSubmitVerifier({ artifacts, approvals, evidence }).postSubmit({
    action, key: retryKey, expectedTaskId: task.taskId, approvalDigest: approvalHash, task,
  })
  assert.equal(posted.outcome, 'accepted')

  const retryEntry: RetryLedgerEntry = {
    schemaVersion: 1, recordKind: 'v1', actionKind: 'retry_shots', approvalEvidence: 'receipt',
    key: retryKey, userId, sessionId: session.id, messageId: retryMessageId,
    toolName: preview.toolName, requestDigest: fullDigest, approvalDigest: approvalHash,
    assetDigests: [inputHash], proposalId: preview.proposalId, previewVersion: preview.version,
    featureType: preview.featureType, taskId: task.taskId, providerRequestIds: [],
    submissionState: 'SUBMITTED', taskStatus: 'pending', gateOutcome: 'PASSED_PRE',
    sideEffectState: 'CONFIRMED', resultAdmission: 'PENDING', evidenceRefs: [posted.evidenceRef],
    createdAt: f.deps.now!().toISOString(), updatedAt: f.deps.now!().toISOString(),
  }
  await f.service.repository.withActionLedger(async (entries, save) => {
    entries.splice(0, entries.length, retryEntry)
    await save()
  })
  await f.service.repository.mutateUser(userId, (file) => {
    const current = file.sessions.find((candidate) => candidate.id === session.id)!
    current.messages.push({ id: retryMessageId, role: 'assistant', content: '重试完成',
      createdAt: f.deps.now!().toISOString(), referenceNodeIds: [current.nodes[0].id],
      plan: { id: 'real-c8-retry-plan', prompt: '只重试领口细节', referenceNodeIds: [current.nodes[0].id],
        settings, status: 'submitted' } })
  })
  const fresh = f.addAsset('real-c8-new')
  fresh.taskId = task.taskId
  task.results = [oldResult, { assetId: fresh.assetId, url: 'https://supplier.invalid/new.png',
    downloadUrl: 'https://supplier.invalid/new-download.png', width: 1, height: 1,
    shotId: 'detail_1', label: '供应商标签' }]
  task.resultAssetIds = [oldResult.assetId, fresh.assetId]
  task.status = 'success'
  task.progress = 100
  f.deps.resultAdmission = createResultAdmission({ tasks: { getTask: f.deps.getTask },
    assets: { getAsset: f.deps.getAsset }, artifacts, approvals, evidence, now: f.deps.now })

  const first = await f.service.getSession(userId, session.id)
  const second = await f.makeService().getSession(userId, session.id)
  for (const current of [first, second]) {
    assert.deepEqual(current.nodes.map((node) => node.assetId), ['asset_a', fresh.assetId])
    assert.equal(current.nodes[1].url, fresh.fileUrl)
    assert.equal(current.nodes[1].width, fresh.width)
    assert.equal(current.nodes.some((node) => node.assetId === oldResult.assetId), false)
  }
  assert.equal((await f.service.repository.readUser(userId)).sessions[0].nodes
    .filter((node) => node.assetId === fresh.assetId).length, 1)
})

test('PATCH 在同一锁事务重算安全视图并保留 ADMITTED 节点、标题与坐标，撤销后即时隐藏', async (t) => {
  const f = await fixture(t)
  const admitted = await prepareAdmittedBetaResult(f, 'patch_admitted_result')
  const initial = await f.service.getSession(userId, admitted.session.id)
  const resultNode = initial.nodes.find((node) => node.assetId === admitted.safe.assetId)!
  assert.ok(resultNode)

  const patched = await f.service.patchSession(userId, admitted.session.id, {
    title: '已更新的安全画布',
    positions: [{ id: resultNode.id, x: 901, y: -45 }],
  })
  const patchedResult = patched.nodes.find((node) => node.assetId === admitted.safe.assetId)
  assert.equal(patched.title, '已更新的安全画布')
  assert.equal(patchedResult?.x, 901)
  assert.equal(patchedResult?.y, -45)
  assert.equal(patchedResult?.url, admitted.safe.url)

  admitted.setMode('QUARANTINED')
  const revoked = await f.service.patchSession(userId, admitted.session.id, { title: '撤销后仍可改标题' })
  assert.equal(revoked.title, '撤销后仍可改标题')
  assert.equal(revoked.nodes.some((node) => node.assetId === admitted.safe.assetId), false)
})

test('sendMessage 成功响应重算 ADMITTED 安全视图，ledger 变 UNKNOWN 后不泄露缓存结果', async (t) => {
  const f = await fixture(t)
  const admitted = await prepareAdmittedBetaResult(f, 'message_admitted_result')
  const initial = await f.service.getSession(userId, admitted.session.id)
  const referenceNodeId = initial.nodes.find((node) => node.assetId === 'asset_a')!.id

  const sent = await f.service.sendMessage(userId, admitted.session.id, {
    clientMessageId: 'message_after_admission',
    text: '再准备一个自然光方案',
    referenceNodeIds: [referenceNodeId],
    settings,
  })
  assert.equal(sent.messages.length, 4)
  assert.equal(sent.nodes.find((node) => node.assetId === admitted.safe.assetId)?.url, admitted.safe.url)

  admitted.setMode('UNKNOWN')
  const hidden = await f.service.sendMessage(userId, admitted.session.id, {
    clientMessageId: 'message_after_revocation',
    text: '撤销后准备另一个方案',
    referenceNodeIds: [referenceNodeId],
    settings,
  })
  assert.equal(hidden.messages.length, 6)
  assert.equal(hidden.nodes.some((node) => node.assetId === admitted.safe.assetId), false)
})

test('addAssets、execute、cancel 返回已有会话时持续携带本次 ADMITTED 安全视图', async (t) => {
  const f = await fixture(t)
  const admitted = await prepareAdmittedBetaResult(f, 'entrypoint_admitted_result')
  await f.service.getSession(userId, admitted.session.id)
  f.addAsset('extra_asset')

  const withAsset = await f.service.addAssets(userId, admitted.session.id, { assetIds: ['extra_asset'] })
  assert.equal(withAsset.nodes.find((node) => node.assetId === admitted.safe.assetId)?.url, admitted.safe.url)
  assert.equal(withAsset.nodes.some((node) => node.assetId === 'extra_asset'), true)

  const proposed = await f.service.sendMessage(userId, admitted.session.id, {
    clientMessageId: 'entrypoint_second_generation',
    text: '准备第二个生成方案',
    referenceNodeIds: [withAsset.nodes.find((node) => node.assetId === 'asset_a')!.id],
    settings,
  })
  const messageId = proposed.messages.at(-1)!.id
  const executed = await f.service.execute(userId, admitted.session.id, { messageId })
  assert.equal(executed.nodes.find((node) => node.assetId === admitted.safe.assetId)?.url, admitted.safe.url)
  const cancelled = await f.service.cancel(userId, admitted.session.id, { messageId })
  assert.equal(cancelled.nodes.find((node) => node.assetId === admitted.safe.assetId)?.url, admitted.safe.url)
  assert.equal(f.calls.create, 2)
  assert.equal(f.calls.cancel, 1)
})

test('PATCH、addAssets 与 GET 并发重算准入时遵守 ledger→user 锁序且不死锁', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const admitted = await prepareAdmittedBetaResult(f, 'concurrent_admitted_result')
  const initial = await f.service.getSession(userId, admitted.session.id)
  const resultNode = initial.nodes.find((node) => node.assetId === admitted.safe.assetId)!
  f.addAsset('concurrent_extra_asset')

  const responses = await Promise.all([
    f.service.patchSession(userId, admitted.session.id, { positions: [{ id: resultNode.id, x: 123, y: 456 }] }),
    f.makeService().addAssets(userId, admitted.session.id, { assetIds: ['concurrent_extra_asset'] }),
    f.makeService().getSession(userId, admitted.session.id),
  ])
  assert.equal(responses.every((session) => session.nodes.some((node) => node.assetId === admitted.safe.assetId)), true)
  assert.equal(admitted.admissionCalls() >= 4, true)
})
