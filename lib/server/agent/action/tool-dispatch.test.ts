import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_BUDGET } from '@/lib/agent/budget'
import type { AgentToolMeta } from '@/lib/agent/types'
import type { ServerBindingContext, ServerSelection } from './provenance'
import { ToolDispatcher, type ToolDispatchScope } from './tool-dispatch'
import { ToolRegistry } from './tool-registry'

type InspectableSchema = AgentToolMeta['inputSchema'] & {
  _def: {
    typeName: 'ZodObject'
    unknownKeys: 'strict'
    catchall: { _def: { typeName: 'ZodNever' } }
  }
}

function strictFakeSchema(onParse: (value: unknown) => unknown = (value) => value): InspectableSchema {
  return {
    _def: {
      typeName: 'ZodObject',
      unknownKeys: 'strict',
      catchall: { _def: { typeName: 'ZodNever' } },
    },
    parse: onParse,
  }
}

function metadata(name: string, overrides: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return {
    name,
    description: `fake ${name}`,
    whenToUse: `需要 ${name} 时`,
    whenNotToUse: ['不匹配当前意图时'],
    inputSchema: strictFakeSchema(),
    readOnly: true,
    costClass: 'free',
    sideEffectClass: 'none',
    approvalPolicy: 'none',
    requiresFreshState: false,
    quotaPerTurn: 2,
    rollbackCapability: 'none',
    ...overrides,
  }
}

function generation(overrides: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return metadata('fashion_photo.create', {
    featureType: 'ai-fashion-photo',
    readOnly: false,
    costClass: 'paid_generation',
    sideEffectClass: 'external_irreversible',
    approvalPolicy: 'preview_confirmation',
    requiresFreshState: true,
    quotaPerTurn: 1,
    rollbackCapability: 'irreversible_after_submit',
    ...overrides,
  })
}

function classification(overrides: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return metadata('garment.classify', {
    readOnly: true,
    costClass: 'vendor_api',
    sideEffectClass: 'none',
    approvalPolicy: 'explicit_user_intent',
    requiresFreshState: true,
    quotaPerTurn: 1,
    ...overrides,
  })
}

function cancellation(overrides: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return metadata('task.cancel', {
    readOnly: false,
    costClass: 'free',
    sideEffectClass: 'local_write',
    approvalPolicy: 'explicit_user_intent',
    requiresFreshState: true,
    quotaPerTurn: 1,
    rollbackCapability: 'local_polling_only',
    ...overrides,
  })
}

const TURN_SCOPE: ToolDispatchScope = {
  userId: 'user_1',
  sessionId: 'session_1',
  messageId: 'message_1',
}

function context(overrides: Partial<ServerBindingContext> = {}): ServerBindingContext {
  return {
    ...TURN_SCOPE,
    idempotencyKey: 'agent:user_1:session_1:message_1',
    ...overrides,
  }
}

function selected<T>(value: T): ServerSelection<T> {
  return { value, origin: 'user_selection' }
}

function frontier(registry: ToolRegistry, ...names: string[]): readonly AgentToolMeta[] {
  return names.map((name) => {
    const tool = registry.get(name)
    if (!tool) throw new Error(`fake registry missing ${name}`)
    return tool
  })
}

function rejectedReason(result: ReturnType<ToolDispatcher['dispatch']>): string | undefined {
  return result.status === 'rejected' ? result.reason : undefined
}

test('正常只读、付费生成和取消分别路由到 read_only、preview、gateway', () => {
  const registry = new ToolRegistry([
    metadata('asset.inspect'),
    generation(),
    cancellation(),
  ])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE })

  const read = dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context({ assetIds: selected(['asset_1']) }),
    frontier: frontier(registry, 'asset.inspect'),
  })
  assert.equal(read.status, 'admitted')
  if (read.status !== 'admitted') assert.fail('只读工具应准入')
  assert.equal(read.target, 'read_only')
  assert.equal(read.proposal.kind, 'utility')
  assert.deepEqual(read.proposal.assetIds, ['asset_1'])

  const paid = dispatcher.dispatch({
    proposal: { toolName: 'fashion_photo.create', prompt: '保留服装颜色并生成商品主图' },
    context: context(),
    frontier: frontier(registry, 'fashion_photo.create'),
  })
  assert.equal(paid.status, 'awaiting_approval')
  if (paid.status !== 'awaiting_approval') assert.fail('付费生成应等待预览确认')
  assert.equal(paid.reason, 'awaiting_approval')
  assert.equal(paid.target, 'preview')
  assert.equal(paid.proposal.kind, 'generation')

  const cancel = dispatcher.dispatch({
    proposal: { toolName: 'task.cancel' },
    context: context({ taskId: selected('task_1') }),
    frontier: frontier(registry, 'task.cancel'),
  })
  assert.equal(cancel.status, 'admitted')
  if (cancel.status !== 'admitted') assert.fail('取消应通过调度准入')
  assert.equal(cancel.target, 'gateway')
  assert.equal(cancel.proposal.taskId, 'task_1')
})

test('未知工具固定拒绝为 tool_hallucination，拒绝不占总名额且不回显输入', () => {
  const registry = new ToolRegistry([metadata('asset.inspect')])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 1 })
  const secret = 'secret-token-must-not-leak'

  const unknown = dispatcher.dispatch({
    proposal: { toolName: 'unknown.tool', prompt: secret },
    context: context(),
    frontier: [],
  })
  assert.deepEqual(unknown, { status: 'rejected', reason: 'tool_hallucination' })
  assert.equal(Object.isFrozen(unknown), true)
  assert.equal(JSON.stringify(unknown).includes(secret), false)

  const admitted = dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  })
  assert.equal(admitted.status, 'admitted')
})

test('非法提案、getter 和伪造控制字段固定拒绝为 provenance_violation 且不执行 getter', () => {
  const registry = new ToolRegistry([metadata('asset.inspect')])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 1 })
  let getterRuns = 0
  const getterProposal = {
    toolName: 'asset.inspect',
    get prompt() {
      getterRuns += 1
      return '不应读取'
    },
  }

  for (const proposal of [
    null,
    { tool: 'asset.inspect' },
    { toolName: 'asset.inspect', model: 'nano-banana-pro' },
    { toolName: 'asset.inspect', userId: 'other_user' },
    getterProposal,
  ]) {
    assert.equal(rejectedReason(dispatcher.dispatch({
      proposal,
      context: context(),
      frontier: frontier(registry, 'asset.inspect'),
    })), 'provenance_violation')
  }
  assert.equal(getterRuns, 0)

  assert.equal(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  }).status, 'admitted')
})

test('越过服务端前沿固定拒绝且不占名额', () => {
  const registry = new ToolRegistry([
    metadata('asset.inspect'),
    metadata('session.list_nodes'),
  ])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 1 })

  const outside = dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'session.list_nodes'),
  })
  assert.equal(rejectedReason(outside), 'outside_tool_frontier')

  assert.equal(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  }).status, 'admitted')
})

test('跨 user、session 或 message 的 context 均拒绝且不共享当前实例配额', () => {
  const registry = new ToolRegistry([metadata('asset.inspect')])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 1 })

  for (const mismatch of [
    { userId: 'user_2' },
    { sessionId: 'session_2' },
    { messageId: 'message_2' },
  ]) {
    const result = dispatcher.dispatch({
      proposal: { toolName: 'asset.inspect' },
      context: context(mismatch),
      frontier: frontier(registry, 'asset.inspect'),
    })
    assert.equal(rejectedReason(result), 'provenance_violation')
  }

  assert.equal(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  }).status, 'admitted')
})

test('分别执行实例总预算和 registry 每工具 quota，所有耗尽使用 turn_budget_exceeded', () => {
  const registry = new ToolRegistry([
    metadata('asset.inspect', { quotaPerTurn: 1 }),
    metadata('session.list_nodes', { quotaPerTurn: 4 }),
  ])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 2 })

  assert.equal(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' }, context: context(), frontier: frontier(registry, 'asset.inspect'),
  }).status, 'admitted')
  assert.equal(rejectedReason(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' }, context: context(), frontier: frontier(registry, 'asset.inspect'),
  })), 'turn_budget_exceeded')

  assert.equal(dispatcher.dispatch({
    proposal: { toolName: 'session.list_nodes' }, context: context(), frontier: frontier(registry, 'session.list_nodes'),
  }).status, 'admitted')
  assert.equal(rejectedReason(dispatcher.dispatch({
    proposal: { toolName: 'session.list_nodes' }, context: context(), frontier: frontier(registry, 'session.list_nodes'),
  })), 'turn_budget_exceeded')
})

test('maxToolCalls 可以降低但不能提高共享工具预算', () => {
  const sharedLimit = AGENT_BUDGET.maxReadToolCallsPerTurn
  const registry = new ToolRegistry([
    metadata('asset.inspect', { quotaPerTurn: sharedLimit + 2 }),
  ])
  const dispatcher = new ToolDispatcher({
    registry,
    scope: TURN_SCOPE,
    maxToolCalls: sharedLimit + 100,
  })

  for (let index = 0; index < sharedLimit; index += 1) {
    assert.equal(dispatcher.dispatch({
      proposal: { toolName: 'asset.inspect' },
      context: context(),
      frontier: frontier(registry, 'asset.inspect'),
    }).status, 'admitted')
  }
  assert.equal(rejectedReason(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  })), 'turn_budget_exceeded')
})

test('awaiting_approval 也消耗一次准入名额，付费工具永不进入 read_only', () => {
  const registry = new ToolRegistry([generation({ quotaPerTurn: 5 })])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 1 })
  const call = () => dispatcher.dispatch({
    proposal: { toolName: 'fashion_photo.create', prompt: '生成一张服装主图' },
    context: context(),
    frontier: frontier(registry, 'fashion_photo.create'),
  })

  const first = call()
  assert.equal(first.status, 'awaiting_approval')
  if (first.status !== 'awaiting_approval') assert.fail('付费工具必须等待批准')
  assert.equal(first.target, 'preview')
  assert.equal(rejectedReason(call()), 'turn_budget_exceeded')
})

test('vendor 只读工具仍进入 gateway，frontier 伪造 metadata 不能降风险或放宽 quota', () => {
  const registry = new ToolRegistry([classification()])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 4 })
  const forged = metadata('garment.classify', {
    costClass: 'free',
    readOnly: true,
    sideEffectClass: 'none',
    approvalPolicy: 'none',
    quotaPerTurn: 999,
  })

  const first = dispatcher.dispatch({
    proposal: { toolName: 'garment.classify' },
    context: context({ assetIds: selected(['asset_1']) }),
    frontier: [forged],
  })
  assert.equal(first.status, 'admitted')
  assert.equal(first.status === 'admitted' && first.target, 'gateway')

  const second = dispatcher.dispatch({
    proposal: { toolName: 'garment.classify' },
    context: context({ assetIds: selected(['asset_1']) }),
    frontier: [forged],
  })
  assert.equal(rejectedReason(second), 'turn_budget_exceeded')
})

test('frontier 名称 getter 不会运行，也不能伪造成成员；该拒绝不占名额', () => {
  const registry = new ToolRegistry([metadata('asset.inspect')])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 1 })
  let getterRuns = 0
  const forged = Object.defineProperty({}, 'name', {
    enumerable: true,
    get() {
      getterRuns += 1
      return 'asset.inspect'
    },
  }) as AgentToolMeta

  assert.equal(rejectedReason(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: [forged],
  })), 'outside_tool_frontier')
  assert.equal(getterRuns, 0)
  assert.equal(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  }).status, 'admitted')
})

test('Dispatcher 不解析具体 inputSchema，也不持有任何执行回调', () => {
  let schemaCalls = 0
  const registry = new ToolRegistry([
    metadata('asset.inspect', {
      inputSchema: strictFakeSchema(() => {
        schemaCalls += 1
        throw new Error('dispatch 不应解析工具参数')
      }),
    }),
  ])
  const dispatcher = new ToolDispatcher({ registry, scope: TURN_SCOPE })

  const result = dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  })
  assert.equal(result.status, 'admitted')
  assert.equal(schemaCalls, 0)
})

test('返回判别和绑定提案被冻结，外部修改不能影响内部计数', () => {
  const mutableScope = { ...TURN_SCOPE }
  const registry = new ToolRegistry([metadata('asset.inspect', { quotaPerTurn: 1 })])
  const dispatcher = new ToolDispatcher({ registry, scope: mutableScope, maxToolCalls: 2 })
  mutableScope.userId = 'other_user'

  const first = dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context({ assetIds: selected(['asset_1']) }),
    frontier: frontier(registry, 'asset.inspect'),
  })
  assert.equal(first.status, 'admitted')
  if (first.status !== 'admitted') assert.fail('预期准入')
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.proposal), true)
  assert.equal(Object.isFrozen(first.proposal.assetIds), true)
  assert.equal(Reflect.set(first, 'status', 'rejected'), false)
  assert.equal(Reflect.set(first.proposal, 'toolName', 'session.list_nodes'), false)
  assert.throws(() => (first.proposal.assetIds as string[]).push('asset_2'), TypeError)

  assert.equal(rejectedReason(dispatcher.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  })), 'turn_budget_exceeded')
})

test('非法 maxToolCalls 在构造时 fail closed，0 明确禁用本 turn 工具准入', () => {
  const registry = new ToolRegistry([metadata('asset.inspect')])
  for (const maxToolCalls of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls }), RangeError)
  }
  const disabled = new ToolDispatcher({ registry, scope: TURN_SCOPE, maxToolCalls: 0 })
  assert.equal(rejectedReason(disabled.dispatch({
    proposal: { toolName: 'asset.inspect' },
    context: context(),
    frontier: frontier(registry, 'asset.inspect'),
  })), 'turn_budget_exceeded')
})
