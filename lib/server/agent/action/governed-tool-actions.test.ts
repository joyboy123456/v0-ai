import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { AGENT_BUDGET } from '@/lib/agent/budget'
import { assetDigest } from '@/lib/agent/contracts'
import type { UserIntentReceipt } from '@/lib/agent/contracts'
import { isFieldOriginAllowed, type FieldOrigin } from '@/lib/agent/provenance'
import type { AssetRecord, GenerationTask } from '@/lib/types'
import type { QueryPort, SessionQueryRecord } from '../ports'
import { bindToolProposal, type BoundToolProposal } from './provenance'
import { ReadToolError } from './read-tool-runner'
import { ToolRegistry } from './tool-registry'
import {
  bindGovernedToolAction,
  CUTOUT_PREPARE_TOOL_METADATA,
  GOVERNED_TOOL_METADATA,
  GOVERNED_UTILITY_INPUT_SCHEMAS,
  GOVERNED_UTILITY_TOOL_METADATA,
  TASK_CANCEL_TOOL_METADATA,
} from './governed-tool-actions'

const scope = { userId: 'user_1', sessionId: 'session_1', messageId: 'message_1' }
const verifiedAt = '2026-09-17T00:00:00.000Z'
const secret = 'provider-secret-must-not-leak'

function fixture() {
  const asset: AssetRecord = {
    assetId: 'asset_1', userId: scope.userId, projectId: 'project_1', fileName: 'shirt.png',
    fileUrl: `https://example.com/${secret}`, fileType: 'image/png', dataUrl: secret,
    width: 1000, height: 1200, createdAt: verifiedAt, taskId: null,
  }
  const task = {
    taskId: 'task_1', userId: scope.userId, featureType: 'garment-detail', workflowId: 'workflow_1',
    inputAssetIds: [asset.assetId], params: {}, status: 'running', progress: 50, message: secret,
    resultAssetIds: [], results: [], createdAt: verifiedAt,
  } as unknown as GenerationTask
  const session: SessionQueryRecord = {
    sessionId: scope.sessionId,
    userId: scope.userId,
    nodes: [{ id: 'node_1', assetId: asset.assetId, name: '衣服', taskId: task.taskId }],
    taskIds: [task.taskId],
  }
  const assets = new Map([[asset.assetId, asset]])
  const tasks = new Map([[task.taskId, task]])
  const calls = { session: 0, asset: 0, task: 0 }
  const query: QueryPort = {
    async getSession(id) { calls.session++; return id === session.sessionId ? session : undefined },
    async getAsset(id) { calls.asset++; return assets.get(id) },
    async getTask(id) { calls.task++; return tasks.get(id) },
  }
  return { asset, task, session, assets, tasks, calls, query }
}

function proposal(toolName: 'garment.classify' | 'cutout.prepare' | 'task.cancel'): BoundToolProposal {
  const registry = new ToolRegistry(GOVERNED_TOOL_METADATA)
  return bindToolProposal(
    { toolName },
    {
      ...scope,
      idempotencyKey: `key-${toolName}`,
      ...(toolName === 'task.cancel'
        ? { taskId: { value: 'task_1', origin: 'user_selection' as const } }
        : { assetIds: { value: ['asset_1'], origin: 'user_selection' as const } }),
    },
    (name) => registry.get(name),
  )
}

function intent(
  actionKind: UserIntentReceipt['actionKind'],
  targetId = actionKind === 'cancel' ? 'task_1' : 'asset_1',
): UserIntentReceipt {
  return { schemaVersion: 1, intentId: `intent_${actionKind}`, ...scope, actionKind, targetId, verifiedAt }
}

function error(code: ReadToolError['code'], status?: number) {
  return (value: unknown) => value instanceof ReadToolError && value.code === code
    && (status === undefined || value.status === status)
}

async function rejectWithoutLeak(promise: Promise<unknown>, code: ReadToolError['code']): Promise<void> {
  await assert.rejects(promise, (caught) => {
    assert.ok(error(code)(caught))
    assert.equal(String(caught).includes(secret), false)
    return true
  })
}

test('cutout.prepare 与 task.cancel 元数据可注册、strict 空参且不能伪装只读', () => {
  const registry = new ToolRegistry(GOVERNED_UTILITY_TOOL_METADATA)
  const cutout = registry.get('cutout.prepare')
  const cancel = registry.get('task.cancel')
  assert.ok(cutout)
  assert.ok(cancel)
  assert.deepEqual(cutout.inputSchema.parse({}), {})
  assert.deepEqual(cancel.inputSchema.parse({}), {})
  for (const args of [
    { assetId: 'asset_1' }, { taskId: 'task_1' }, { scene: 'garment' }, { targetId: 'asset_1' },
    { consent: true }, { status: 'running' }, { userId: scope.userId },
  ]) {
    assert.throws(() => GOVERNED_UTILITY_INPUT_SCHEMAS['cutout.prepare'].parse(args))
    assert.throws(() => GOVERNED_UTILITY_INPUT_SCHEMAS['task.cancel'].parse(args))
  }
  assert.deepEqual({ readOnly: cutout.readOnly, cost: cutout.costClass, approval: cutout.approvalPolicy,
    effect: cutout.sideEffectClass, rollback: cutout.rollbackCapability, quota: cutout.quotaPerTurn }, {
    readOnly: false, cost: 'vendor_api', approval: 'explicit_user_intent', effect: 'external_irreversible',
    rollback: 'irreversible_after_submit', quota: AGENT_BUDGET.maxCutoutPreparationsPerTurn,
  })
  assert.deepEqual({ readOnly: cancel.readOnly, cost: cancel.costClass, approval: cancel.approvalPolicy,
    effect: cancel.sideEffectClass, rollback: cancel.rollbackCapability, quota: cancel.quotaPerTurn }, {
    readOnly: false, cost: 'free', approval: 'explicit_user_intent', effect: 'local_write',
    rollback: 'local_polling_only', quota: 1,
  })
})

test('统一纯绑定覆盖 classify/cutout/cancel，scene 与 target 只来自服务端证据', async () => {
  const f = fixture()
  const classify = await bindGovernedToolAction(proposal('garment.classify'), scope, intent('classify'), f.query)
  assert.equal(classify.actionKind, 'classify')
  assert.equal(classify.payload.assetDigest, await assetDigest(f.asset))

  const cutout = await bindGovernedToolAction(
    proposal('cutout.prepare'), scope, intent('cutout_prepare'), f.query, 'garment',
  )
  assert.deepEqual(cutout, {
    actionKind: 'cutout_prepare',
    payload: {
      schemaVersion: 1, ...scope, assetId: f.asset.assetId, assetDigest: await assetDigest(f.asset),
      scene: 'garment', intent: intent('cutout_prepare'),
    },
  })

  const cancel = await bindGovernedToolAction(proposal('task.cancel'), scope, intent('cancel'), f.query)
  assert.deepEqual(cancel, {
    actionKind: 'cancel',
    payload: { schemaVersion: 1, ...scope, taskId: f.task.taskId, intent: intent('cancel') },
  })
  assert.equal(Object.isFrozen(cutout), true)
  assert.equal(Object.isFrozen(cutout.payload), true)
  assert.equal(Object.isFrozen(cutout.payload.intent), true)
  assert.equal('status' in cancel.payload, false)
  for (const bound of [proposal('garment.classify'), proposal('cutout.prepare'), proposal('task.cancel')]) {
    for (const [field, origin] of Object.entries(bound.origins)) {
      assert.equal(isFieldOriginAllowed(field, origin as FieldOrigin), true, `${field} <- ${origin}`)
    }
  }
  assert.equal(JSON.stringify([classify, cutout, cancel]).includes(secret), false)
})

test('错 actionKind、跨认证身份、错 target 与伪 consent 均在查询前失败关闭', async () => {
  for (const toolName of ['cutout.prepare', 'task.cancel'] as const) {
    const f = fixture()
    const expectedKind = toolName === 'cutout.prepare' ? 'cutout_prepare' : 'cancel'
    const target = toolName === 'cutout.prepare' ? 'asset_1' : 'task_1'
    const valid = intent(expectedKind, target)
    const invoke = (candidate: UserIntentReceipt) => bindGovernedToolAction(
      proposal(toolName), scope, candidate, f.query, toolName === 'cutout.prepare' ? 'garment' : undefined,
    )
    await assert.rejects(invoke({ ...valid, actionKind: expectedKind === 'cancel' ? 'classify' : 'cancel' }), error('invalid_input'))
    for (const changed of [
      { ...valid, userId: 'user_2' },
      { ...valid, sessionId: 'session_2' },
      { ...valid, messageId: 'message_2' },
      { ...valid, targetId: 'other' },
    ]) await assert.rejects(invoke(changed), error('not_found', 404))
    await assert.rejects(invoke({ ...valid, consent: true } as UserIntentReceipt), error('invalid_input'))
    await assert.rejects(invoke({ ...valid, verifiedAt: 'not-a-timestamp' }), error('invalid_input'))
    assert.equal(f.calls.session, 0)
    assert.equal(f.calls.asset + f.calls.task, 0)
  }
})

test('binder 只验证 freshness 形状，合法旧时间仍留给 Gateway 做最终 TTL 判定', async () => {
  const f = fixture()
  const staleButWellFormed = { ...intent('cutout_prepare'), verifiedAt: '2020-01-01T00:00:00.000Z' }
  const action = await bindGovernedToolAction(
    proposal('cutout.prepare'), scope, staleButWellFormed, f.query, 'garment',
  )
  assert.equal(action.payload.intent.verifiedAt, staleButWellFormed.verifiedAt)
})

test('cutout/cancel 强制服务端单一 target，拒绝混入另一个资源或 shot 控制', async () => {
  const f = fixture()
  const cutout = proposal('cutout.prepare')
  for (const forged of [
    { ...cutout, assetIds: [] },
    { ...cutout, assetIds: ['asset_1', 'asset_2'] },
    { ...cutout, taskId: 'task_1' },
    { ...cutout, shotIds: ['shot_1'] },
  ]) {
    await assert.rejects(bindGovernedToolAction(
      forged as BoundToolProposal, scope, intent('cutout_prepare'), f.query, 'garment',
    ), error('invalid_input'))
  }
  const cancel = proposal('task.cancel')
  for (const forged of [
    { ...cancel, taskId: undefined },
    { ...cancel, assetIds: ['asset_1'] },
    { ...cancel, shotIds: ['shot_1'] },
  ]) {
    await assert.rejects(bindGovernedToolAction(
      forged as BoundToolProposal, scope, intent('cancel'), f.query,
    ), error('invalid_input'))
  }
})

test('每次绑定重查会话 membership、owner、assetDigest 与 task identity', async () => {
  {
    const f = fixture()
    await bindGovernedToolAction(proposal('cutout.prepare'), scope, intent('cutout_prepare'), f.query, 'garment')
    f.asset.userId = 'user_2'
    await assert.rejects(bindGovernedToolAction(
      proposal('cutout.prepare'), scope, intent('cutout_prepare'), f.query, 'garment',
    ), error('not_found', 404))
  }
  {
    const f = fixture()
    f.session.nodes = []
    await assert.rejects(bindGovernedToolAction(
      proposal('cutout.prepare'), scope, intent('cutout_prepare'), f.query, 'garment',
    ), error('not_found', 404))
  }
  {
    const f = fixture()
    f.task.userId = 'user_2'
    await assert.rejects(bindGovernedToolAction(proposal('task.cancel'), scope, intent('cancel'), f.query), error('not_found', 404))
  }
  {
    const f = fixture()
    f.session.taskIds = []
    f.session.nodes = f.session.nodes.map(({ taskId: _taskId, ...node }) => node)
    await assert.rejects(bindGovernedToolAction(proposal('task.cancel'), scope, intent('cancel'), f.query), error('not_found', 404))
  }
  {
    const f = fixture()
    f.query.getTask = async () => ({ ...f.task, taskId: 'task_other' })
    await assert.rejects(bindGovernedToolAction(proposal('task.cancel'), scope, intent('cancel'), f.query), error('not_found', 404))
  }
})

test('缺会话及查询异常使用安全投影，不泄露底层错误', async () => {
  for (const toolName of ['garment.classify', 'cutout.prepare', 'task.cancel'] as const) {
    const f = fixture()
    f.query.getSession = async () => undefined
    const kind = toolName === 'garment.classify' ? 'classify' : toolName === 'cutout.prepare' ? 'cutout_prepare' : 'cancel'
    await assert.rejects(bindGovernedToolAction(
      proposal(toolName), scope, intent(kind), f.query, toolName === 'cutout.prepare' ? 'garment' : undefined,
    ), error('not_found', 404))
  }

  for (const failure of ['session', 'asset', 'task'] as const) {
    const f = fixture()
    if (failure === 'session') f.query.getSession = async () => { throw new Error(secret) }
    if (failure === 'asset') f.query.getAsset = async () => { throw new Error(secret) }
    if (failure === 'task') f.query.getTask = async () => { throw new Error(secret) }
    const toolName = failure === 'task' ? 'task.cancel' : 'cutout.prepare'
    const kind = failure === 'task' ? 'cancel' : 'cutout_prepare'
    await rejectWithoutLeak(bindGovernedToolAction(
      proposal(toolName), scope, intent(kind), f.query, toolName === 'cutout.prepare' ? 'garment' : undefined,
    ), 'query_unavailable')
  }
})

test('伪 scene/target/consent/status/control 字段不能进入冻结提案且不触发查询', async () => {
  for (const toolName of ['cutout.prepare', 'task.cancel'] as const) {
    for (const [field, value] of [
      ['scene', 'person'], ['targetId', 'other'], ['consent', true], ['status', 'running'],
      ['state', 'cancelled'], ['control', { force: true }],
    ] as const) {
      const f = fixture()
      const forged = { ...proposal(toolName), [field]: value } as unknown as BoundToolProposal
      await assert.rejects(bindGovernedToolAction(
        forged, scope, intent(toolName === 'cutout.prepare' ? 'cutout_prepare' : 'cancel'), f.query,
        toolName === 'cutout.prepare' ? 'garment' : undefined,
      ), error('invalid_input'))
      assert.deepEqual(f.calls, { session: 0, asset: 0, task: 0 })
    }
  }
})

test('实现只产生 GovernedAction，不持有命令/供应商端口或调用执行方法', async () => {
  const source = await readFile(new URL('./governed-tool-actions.ts', import.meta.url), 'utf8')
  assert.equal(source.includes(['Vendor', 'ActionPort'].join('')), false)
  assert.equal(source.includes(['Task', 'CommandPort'].join('')), false)
  assert.equal(/\.execute\s*\(/.test(source), false)
  assert.equal(/\.prepareCutout\s*\(/.test(source), false)
  assert.equal(/\.cancelTask\s*\(/.test(source), false)
  assert.match(source, /bindClassificationAction\(/)
  assert.match(source, /isFieldOriginAllowed\(/)
  assert.doesNotMatch(source, /const\s+origin\s*=\s*z\.enum/)
})


test('cutout binder 当前仅支持 garment，person/product 在任何查询前拒绝', async () => {
  for (const scene of ['person', 'product'] as const) {
    const f = fixture()
    await assert.rejects(
      bindGovernedToolAction(
        proposal('cutout.prepare'),
        scope,
        intent('cutout_prepare'),
        f.query,
        scene,
      ),
      error('invalid_input'),
    )
    assert.deepEqual(f.calls, { session: 0, asset: 0, task: 0 })
  }
})
