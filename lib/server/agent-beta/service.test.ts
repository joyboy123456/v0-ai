import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import type { AgentBetaSession } from '@/lib/agent-beta/types'
import { DEFAULT_FASHION_MODEL, type AssetRecord, type GenerationTask } from '@/lib/types'
import { AgentBetaRepository } from './repository'
import { AgentBetaService, type AgentBetaDependencies } from './service'
import { AgentBetaError, type PlannerOutput } from './validation'

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
  delete records[0].submitted
  await writeFile(recordsPath, JSON.stringify(records))
  f.tasks.clear()
  await assert.rejects(f.makeService().execute(userId, proposed.id, { messageId: proposed.messages[1].id }), errorCode('AGENT_BETA_TASK_MISSING'))
  assert.equal(f.calls.create, 1)
  assert.equal(JSON.parse(await readFile(recordsPath, 'utf8')).length, 1)
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
  const results = await Promise.allSettled([
    f.service.execute(userId, a.id, { messageId: a.messages[1].id }),
    f.service.execute(otherUser, b.id, { messageId: b.messages[1].id }),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(f.calls.create, 1)
  for (const task of f.tasks.values()) task.status = 'success'
  f.setQueueFailure(true)
  await assert.rejects(f.service.execute(otherUser, b.id, { messageId: b.messages[1].id }), /queue full/)
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

test('任务创建前失败释放确认额度，允许重试', async (t) => {
  const f = await fixture(t)
  const session = await f.propose(await f.prepare())
  f.setCreationFailure(true)
  await assert.rejects(f.service.execute(userId, session.id, { messageId: session.messages[1].id }), /simulated disk/)
  assert.deepEqual(JSON.parse(await readFile(path.join(f.directory, 'executions.json'), 'utf8')), [])
  f.setCreationFailure(false)
  const result = await f.service.execute(userId, session.id, { messageId: session.messages[1].id })
  assert.equal(result.messages[1].plan?.status, 'submitted')
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
