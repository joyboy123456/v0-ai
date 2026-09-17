import assert from 'node:assert/strict'
import test from 'node:test'
import { assetDigest } from '@/lib/agent/contracts'
import type { UserIntentReceipt } from '@/lib/agent/contracts'
import type { ContextHandle } from '@/lib/agent/context'
import type { GarmentObservation } from '@/lib/agent/types'
import type { AssetRecord, GenerationTask } from '@/lib/types'
import type { QueryPort, SessionQueryRecord } from '../ports'
import { ToolRegistry } from './tool-registry'
import { ToolDispatcher } from './tool-dispatch'
import { bindToolProposal } from './provenance'
import { bindClassificationAction, GARMENT_CLASSIFY_TOOL_METADATA, READ_TOOL_METADATA, READ_TOOL_SCHEMAS,
  ReadToolError, ReadToolRunner, resolveContextHandle } from './read-tool-runner'

const scope = { userId: 'user_1', sessionId: 'session_1', messageId: 'message_1' }
const timestamp = '2026-09-16T00:00:00.000Z'
const now = () => new Date('2026-09-16T01:00:00.000Z')
const secret = 'secret-url-or-provider-response'

function fixture() {
  const asset: AssetRecord = { assetId: 'asset_1', userId: scope.userId, projectId: 'project_1',
    fileName: 'shirt.png', fileType: 'image/png', fileUrl: `https://example.com/${secret}`, dataUrl: secret,
    width: 1000, height: 1200, createdAt: timestamp, taskId: null }
  const task = { taskId: 'task_1', userId: scope.userId, featureType: 'garment-detail', status: 'running', progress: 50,
    createdAt: timestamp, params: { prompt: secret }, message: secret, errorMessage: secret,
    results: [{ url: secret }], resultAssetIds: ['unadmitted'] } as unknown as GenerationTask
  const session: SessionQueryRecord = { sessionId: scope.sessionId, userId: scope.userId,
    nodes: [{ id: 'node_1', assetId: asset.assetId, name: '衣服', taskId: task.taskId }], taskIds: [task.taskId] }
  const assets = new Map([[asset.assetId, asset]])
  const tasks = new Map([[task.taskId, task]])
  const query: QueryPort = { getAsset: async (id) => assets.get(id), getTask: async (id) => tasks.get(id),
    getSession: async (id) => id === session.sessionId ? session : undefined }
  return { asset, task, session, assets, tasks, query, runner: new ReadToolRunner({ query }) }
}

function error(code: ReadToolError['code'], status?: number) {
  return (value: unknown) => value instanceof ReadToolError && value.code === code && (status === undefined || value.status === status)
}

function handle(kind: ContextHandle['kind'], resourceId: string, extra: Partial<ContextHandle> = {}): ContextHandle {
  return { schemaVersion: 1, kind, resourceId, userId: scope.userId, sessionId: scope.sessionId, ...extra }
}

async function cacheFixture() {
  const data = fixture()
  const observation: GarmentObservation = { assetId: data.asset.assetId, assetDigest: await assetDigest(data.asset),
    observedAt: timestamp, origin: 'image_observation', observerModel: secret, subject: 'unknown', category: 'tops',
    dominantColors: ['#ffffff'], silhouette: secret, keyDetails: [secret], hasVisibleText: false, hasFace: false,
    quality: { blurry: false, lowResolution: false, watermark: false }, confidence: 0.35, notes: secret }
  const entry = { observerVersion: 'deterministic-v1', observation }
  data.query.getObservation = async () => entry
  return { ...data, observation, entry, reference: handle('observation', data.asset.assetId,
    { assetDigest: observation.assetDigest, observerVersion: entry.observerVersion }) }
}

test('元数据可注册且分类固定走 vendor_api/用户意图/两次配额', () => {
  const registry = new ToolRegistry([...READ_TOOL_METADATA, GARMENT_CLASSIFY_TOOL_METADATA])
  assert.equal(registry.list().length, 4)
  assert.equal(registry.get('garment.classify')?.costClass, 'vendor_api')
  assert.equal(registry.get('garment.classify')?.approvalPolicy, 'explicit_user_intent')
  assert.equal(registry.get('garment.classify')?.quotaPerTurn, 2)
  for (const schema of Object.values(READ_TOOL_SCHEMAS)) assert.throws(() => schema.parse({ injected: true }))
})

test('asset.inspect 返回白名单尺寸/版本，不泄露原记录字段', async () => {
  const { runner, asset } = fixture()
  const result = await runner.run({ toolName: 'asset.inspect', args: { assetId: asset.assetId } }, scope)
  assert.deepEqual(result, { toolName: 'asset.inspect', asset: { assetId: asset.assetId, width: 1000, height: 1200,
    createdAt: timestamp, assetDigest: await assetDigest(asset) } })
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('真实 50 节点会话逐张验证资产归属并返回完整列表', async () => {
  const { runner, session, assets, asset } = fixture()
  session.nodes = Array.from({ length: 50 }, (_, index) => {
    const assetId = `asset_${index}`
    assets.set(assetId, { ...asset, assetId })
    return { id: `node_${index}`, assetId, name: `节点 ${index}` }
  })
  const result = await runner.run({ toolName: 'session.list_nodes', args: {} }, scope)
  assert.equal(result.toolName, 'session.list_nodes')
  if (result.toolName !== 'session.list_nodes') assert.fail()
  assert.equal(result.nodes.length, 50)
  assert.equal(result.nodes[49].assetId, 'asset_49')
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('task.get_status 返回业务状态但不发布未准入结果或供应商错误文本', async () => {
  const { runner } = fixture()
  assert.deepEqual(await runner.run({ toolName: 'task.get_status', args: { taskId: 'task_1' } }, scope), {
    toolName: 'task.get_status', task: { taskId: 'task_1', featureType: 'garment-detail', status: 'running',
      progress: 50, createdAt: timestamp },
  })
})

for (const kind of ['asset.inspect', 'session.list_nodes', 'task.get_status'] as const) {
  for (const issue of ['foreign_session', 'missing_session', 'foreign_resource', 'missing_resource'] as const) {
    test(`${kind}: ${issue} 统一返回 404`, async () => {
      const { runner, session, asset, task, assets, tasks } = fixture()
      if (issue === 'foreign_session') session.userId = 'foreign'
      if (issue === 'missing_session') session.sessionId = 'missing'
      if (issue === 'foreign_resource') { asset.userId = 'foreign'; task.userId = 'foreign' }
      if (issue === 'missing_resource') { assets.clear(); tasks.clear() }
      const args = kind === 'asset.inspect' ? { assetId: asset.assetId } : kind === 'task.get_status' ? { taskId: task.taskId } : {}
      await assert.rejects(runner.run({ toolName: kind, args }, scope), error('not_found', 404))
    })
  }
}

test('同用户其他会话资源也拒绝；旧任务没有 userId 不回退 demo', async () => {
  const { runner, session, task } = fixture()
  session.nodes = []
  session.taskIds = []
  await assert.rejects(runner.run({ toolName: 'asset.inspect', args: { assetId: 'asset_1' } }, scope), error('not_found', 404))
  await assert.rejects(runner.run({ toolName: 'task.get_status', args: { taskId: 'task_1' } }, scope), error('not_found', 404))
  session.taskIds.push('task_1')
  delete task.userId
  await assert.rejects(runner.run({ toolName: 'task.get_status', args: { taskId: 'task_1' } }, scope), error('not_found', 404))
})

test('节点资产转属后再次读取立即拒绝', async () => {
  const { runner, asset } = fixture()
  await runner.run({ toolName: 'session.list_nodes', args: {} }, scope)
  asset.userId = 'user_2'
  await assert.rejects(runner.run({ toolName: 'session.list_nodes', args: {} }, scope), error('not_found', 404))
})

test('strict 输入拒绝额外字段/函数/日期/稀疏数组/undefined/原型对象，getter 不执行', async () => {
  const { runner } = fixture()
  let getterCalls = 0
  const getter = Object.defineProperty({}, 'assetId', { enumerable: true, get: () => { getterCalls++; return 'asset_1' } })
  const sparse: unknown[] = []; sparse.length = 2
  for (const args of [{ assetId: 'asset_1', userId: scope.userId }, { assetId: () => 'asset_1' }, new Date(),
    { assetId: 'asset_1', more: sparse }, { assetId: undefined }, Object.create({ assetId: 'asset_1' }), getter]) {
    await assert.rejects(runner.run({ toolName: 'asset.inspect', args }, scope), error('invalid_input'))
  }
  assert.equal(getterCalls, 0)
  await assert.rejects(runner.run({ toolName: 'session.list_nodes', args: { sessionId: scope.sessionId } }, scope), error('invalid_input'))
})

test('存储身份 getter 不执行且拒绝，非返回字段 getter 不复制或访问', async () => {
  const { runner, asset } = fixture()
  let getterCalls = 0
  Object.defineProperty(asset, 'fileUrl', { get: () => { getterCalls++; return secret } })
  await runner.run({ toolName: 'asset.inspect', args: { assetId: asset.assetId } }, scope)
  Object.defineProperty(asset, 'userId', { get: () => { getterCalls++; return scope.userId } })
  await assert.rejects(runner.run({ toolName: 'asset.inspect', args: { assetId: asset.assetId } }, scope), error('not_found', 404))
  assert.equal(getterCalls, 0)
})

test('vendor 或未知工具从不执行查询', async () => {
  const { query } = fixture()
  let queryCalls = 0
  query.getSession = async () => { queryCalls++; throw new Error(secret) }
  const runner = new ReadToolRunner({ query })
  for (const toolName of ['garment.classify', 'task.cancel', 'fabricated.tool']) {
    await assert.rejects(runner.run({ toolName, args: { assetId: 'asset_1' } }, scope), error('tool_not_read_only'))
  }
  assert.equal(queryCalls, 0)
})

for (const axis of [ { costClass: 'vendor_api' }, { sideEffectClass: 'local_write' }, { readOnly: false },
  { approvalPolicy: 'always' }, { rollbackCapability: 'local_polling_only' }]) {
  test(`runner 再核治理轴 ${Object.keys(axis)[0]}`, async () => {
    const { query } = fixture()
    const registry = { get: () => ({ ...READ_TOOL_METADATA[0], ...axis }) } as unknown as ToolRegistry
    await assert.rejects(new ReadToolRunner({ query, registry }).run({ toolName: 'asset.inspect', args: { assetId: 'asset_1' } }, scope),
      error('tool_not_read_only'))
  })
}

test('C5 dispatch → runAdmitted 从服务端选择生成 strict 工具参数', async () => {
  const { query } = fixture()
  const registry = new ToolRegistry([...READ_TOOL_METADATA, GARMENT_CLASSIFY_TOOL_METADATA])
  const dispatcher = new ToolDispatcher({ registry, scope })
  const admission = dispatcher.dispatch({ proposal: { toolName: 'asset.inspect', prompt: '查看素材' },
    context: { ...scope, idempotencyKey: 'key', assetIds: { value: ['asset_1'], origin: 'user_selection' } }, frontier: registry.list() })
  const runner = new ReadToolRunner({ query, registry })
  assert.equal((await runner.runAdmitted(admission, scope)).toolName, 'asset.inspect')
  await assert.rejects(runner.runAdmitted(admission, { ...scope, sessionId: 'session_2' }), error('not_found', 404))
  const classify = dispatcher.dispatch({ proposal: { toolName: 'garment.classify' },
    context: { ...scope, idempotencyKey: 'key', assetIds: { value: ['asset_1'], origin: 'user_selection' } }, frontier: registry.list() })
  await assert.rejects(runner.runAdmitted(classify, scope), error('invalid_input'))
})

test('P3 各类 handle 再验当前 scope、membership 与资源归属', async () => {
  const { query, asset, session } = fixture()
  const assetReference = handle('asset', 'asset_1', { assetDigest: await assetDigest(asset) })
  for (const reference of [assetReference, handle('task', 'task_1'), handle('session_nodes', scope.sessionId)]) {
    assert.ok(await resolveContextHandle(reference, scope, query))
    await assert.rejects(resolveContextHandle({ ...reference, userId: 'foreign' }, scope, query), error('not_found', 404))
    await assert.rejects(resolveContextHandle({ ...reference, sessionId: 'foreign' }, scope, query), error('not_found', 404))
  }
  await assert.rejects(resolveContextHandle(handle('session_nodes', 'another'), scope, query), error('not_found', 404))
  await assert.rejects(resolveContextHandle(handle('asset', 'asset_1', { assetDigest: 'a'.repeat(64) }), scope, query), error('not_found', 404))
  asset.userId = 'foreign'
  await assert.rejects(resolveContextHandle(assetReference, scope, query), error('not_found', 404))
  session.nodes = []; session.taskIds = []
  await assert.rejects(resolveContextHandle(handle('task', 'task_1'), scope, query), error('not_found', 404))
})

test('asset handle 不允许删除摘要绕过版本约束；旧摘要在素材变化后拒绝', async () => {
  const { query, asset } = fixture()
  const reference = handle('asset', asset.assetId, { assetDigest: await assetDigest(asset) })
  await assert.rejects(resolveContextHandle(handle('asset', asset.assetId), scope, query), error('invalid_input'))
  asset.width++
  await assert.rejects(resolveContextHandle(reference, scope, query), error('not_found', 404))
})

test('同用户查询返回其他 taskId 时仍统一 404', async () => {
  const { query, task } = fixture()
  query.getTask = async () => ({ ...task, taskId: 'task_other' })
  await assert.rejects(new ReadToolRunner({ query }).run({ toolName: 'task.get_status', args: { taskId: task.taskId } }, scope),
    error('not_found', 404))
})

test('观察 handle 只读 cache，绑定版本和摘要且不暴露供应商自由文本', async () => {
  const { query, reference } = await cacheFixture()
  const result = await resolveContextHandle(reference, scope, query, { now })
  assert.ok(result && 'kind' in result && result.kind === 'observation')
  assert.equal(result.observation.category, 'tops')
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.ok(result.limitations.length)
})

for (const issue of ['expired', 'future', 'version', 'digest', 'asset', 'invalid_quality', 'cache_missing', 'cache_absent'] as const) {
  test(`观察 ${issue} 为 miss，不计算或调用供应商`, async () => {
    const { query, reference, observation, entry } = await cacheFixture()
    if (issue === 'expired') observation.observedAt = '2026-09-15T01:00:00.000Z'
    if (issue === 'future') observation.observedAt = '2026-09-16T02:00:00.000Z'
    if (issue === 'version') entry.observerVersion = 'v2'
    if (issue === 'digest') observation.assetDigest = 'a'.repeat(64)
    if (issue === 'asset') observation.assetId = 'other'
    if (issue === 'invalid_quality') observation.quality = {} as GarmentObservation['quality']
    if (issue === 'cache_missing') query.getObservation = async () => null
    if (issue === 'cache_absent') delete query.getObservation
    assert.equal(await resolveContextHandle(reference, scope, query, { now }), null)
  })
}

test('观察查询途中转属或撤销会话成员关系时拒绝，摘要改变时 miss', async () => {
  for (const change of ['owner', 'membership', 'digest']) {
    const { query, reference, asset, session, entry } = await cacheFixture()
    query.getObservation = async () => {
      if (change === 'owner') asset.userId = 'foreign'
      if (change === 'membership') session.nodes = []
      if (change === 'digest') asset.width++
      return entry
    }
    if (change === 'digest') assert.equal(await resolveContextHandle(reference, scope, query, { now }), null)
    else await assert.rejects(resolveContextHandle(reference, scope, query, { now }), error('not_found', 404))
  }
})

test('观察 cache getter 不执行，坏 handle/缺失版本拒绝', async () => {
  const { query, reference, observation } = await cacheFixture()
  let calls = 0
  Object.defineProperty(observation, 'category', { enumerable: true, get: () => { calls++; return 'tops' } })
  assert.equal(await resolveContextHandle(reference, scope, query, { now }), null)
  assert.equal(calls, 0)
  await assert.rejects(resolveContextHandle(handle('observation', 'asset_1'), scope, query), error('invalid_input'))
  await assert.rejects(resolveContextHandle({ ...reference, extra: true } as ContextHandle, scope, query), error('invalid_input'))
})

test('缓存非展示字段包含 getter/非 JSON/额外字段也视为损坏，不执行行为', async () => {
  for (const issue of ['getter', 'function', 'extra']) {
    const { query, reference, observation } = await cacheFixture()
    let calls = 0
    if (issue === 'getter') Object.defineProperty(observation, 'notes', { get: () => { calls++; return secret } })
    if (issue === 'function') Object.assign(observation, { notes: () => secret })
    if (issue === 'extra') Object.assign(observation, { providerResponse: secret })
    assert.equal(await resolveContextHandle(reference, scope, query, { now }), null)
    assert.equal(calls, 0)
  }
})

test('分类只绑定动作，验证可信意图与当前素材；无供应商 capability', async () => {
  const { query, asset } = fixture()
  const registry = new ToolRegistry([GARMENT_CLASSIFY_TOOL_METADATA])
  const proposal = bindToolProposal({ toolName: 'garment.classify' }, { ...scope, idempotencyKey: 'key',
    assetIds: { value: [asset.assetId], origin: 'user_selection' } }, (name) => registry.get(name))
  const intent: UserIntentReceipt = { schemaVersion: 1, intentId: 'intent_1', ...scope, actionKind: 'classify',
    targetId: asset.assetId, verifiedAt: timestamp }
  const action = await bindClassificationAction(proposal, scope, intent, query)
  assert.equal(action.actionKind, 'classify')
  assert.equal(action.payload.assetDigest, await assetDigest(asset))
  assert.equal(JSON.stringify(action).includes(secret), false)
  await assert.rejects(bindClassificationAction(proposal, scope, { ...intent, targetId: 'other' }, query), error('not_found', 404))
  await assert.rejects(bindClassificationAction(proposal, scope, { ...intent, consent: true } as UserIntentReceipt, query), error('invalid_input'))
  asset.userId = 'foreign'
  await assert.rejects(bindClassificationAction(proposal, scope, intent, query), error('not_found', 404))
})

test('查询故障不泄露底层响应，也不把未知故障伪装成资源不存在', async () => {
  const { query } = fixture()
  query.getSession = async () => { throw new Error(secret) }
  await assert.rejects(new ReadToolRunner({ query }).run({ toolName: 'session.list_nodes', args: {} }, scope), (caught) => {
    assert.ok(error('query_unavailable', 503)(caught))
    assert.equal(String(caught).includes(secret), false)
    return true
  })
})
