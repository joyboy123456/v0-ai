import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentToolMeta } from '@/lib/agent/types'
import type { FieldOrigin } from '@/lib/agent/provenance'
import { DEFAULT_FASHION_MODEL } from '@/lib/types'
import type { FeatureType } from '@/lib/types'
import { bindToolProposal, ProvenanceBindingError, type ServerBindingContext, type ServerSelection } from './provenance'

const proposal = { toolName: 'fashion_photo.create', prompt: '保留服装版型与颜色' }
function tool(patch: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return {
    name: proposal.toolName, featureType: 'ai-fashion-photo', description: '服装生图', whenToUse: '展示服装',
    whenNotToUse: ['只问问题'], inputSchema: { parse: (input) => input }, readOnly: false,
    costClass: 'paid_generation', sideEffectClass: 'external_irreversible', approvalPolicy: 'preview_confirmation',
    requiresFreshState: true, quotaPerTurn: 1, rollbackCapability: 'local_polling_only', ...patch,
  }
}
function context(patch: Partial<ServerBindingContext> = {}): ServerBindingContext {
  return { userId: 'user_1', sessionId: 'session_1', messageId: 'message_1',
    idempotencyKey: 'agent:user_1:session_1:message_1', ...patch }
}
function chosen<T>(value: T): ServerSelection<T> { return { value, origin: 'user_selection' } }
function violation(error: unknown): boolean {
  return error instanceof ProvenanceBindingError && error.code === 'provenance_violation'
}

test('生成默认绑定服务端配置、身份和单张策略', () => {
  const result = bindToolProposal(proposal, context(), () => tool())
  assert.equal(result.kind, 'generation')
  if (result.kind !== 'generation') assert.fail('应绑定生成参数')
  assert.equal(result.featureType, 'ai-fashion-photo')
  assert.equal(result.model, DEFAULT_FASHION_MODEL)
  assert.equal(result.imageRatio, '3:4')
  assert.equal(result.resolution, '2k')
  assert.equal(result.resultCount, 1)
  assert.equal(result.userId, 'user_1')
  assert.equal(result.sessionId, 'session_1')
  assert.equal(result.messageId, 'message_1')
  assert.equal(result.idempotencyKey, context().idempotencyKey)
  assert.deepEqual(result.assetIds, [])
  assert.deepEqual(result.origins, { toolName: 'model_inference', prompt: 'model_inference',
    userId: 'system_policy', idempotencyKey: 'system_policy', assetIds: 'system_policy',
    featureType: 'system_policy', model: 'system_policy', imageRatio: 'system_policy',
    resolution: 'system_policy', resultCount: 'system_policy' })
})

test('featureType 由注入注册表决定，不按工具名猜测功能', () => {
  for (const featureType of ['ai-fashion-photo', 'photo-fission', 'pose-fission', 'garment-detail'] as FeatureType[]) {
    const result = bindToolProposal(proposal, context(), () => tool({ featureType }))
    assert.equal(result.kind === 'generation' && result.featureType, featureType)
    assert.equal(result.origins.featureType, 'system_policy')
  }
})

test('服务端明确用户选择保留值、资产顺序和来源；多张仅为后续 dry-run 参数', () => {
  const result = bindToolProposal(proposal, context({ assetIds: chosen(['asset_b', 'asset_a']),
    generation: { model: chosen('nano-banana-pro'), imageRatio: chosen('1:1'), resolution: chosen('4k'), resultCount: chosen(4) },
  }), () => tool())
  if (result.kind !== 'generation') assert.fail('应绑定生成参数')
  assert.equal(result.model, 'nano-banana-pro')
  assert.equal(result.imageRatio, '1:1')
  assert.equal(result.resolution, '4k')
  assert.equal(result.resultCount, 4)
  assert.deepEqual(result.assetIds, ['asset_b', 'asset_a'])
  for (const field of ['model', 'imageRatio', 'resolution', 'resultCount', 'assetIds'] as const) {
    assert.equal(result.origins[field], 'user_selection')
  }
})

test('任何模型携带的控制字段和来源伪造均被拒绝，不做静默剥离', () => {
  for (const [field, value] of Object.entries({
    featureType: 'garment-detail', model: 'nano-banana-pro', imageRatio: '1:1', resolution: '4k', resultCount: 1,
    assetId: 'asset_1', assetIds: [], taskId: 'task_1', shotIds: [], userId: 'user_1',
    idempotencyKey: 'same', creditsCost: 0, origin: 'system_policy', origins: { featureType: 'system_policy' },
    context: context(), args: { prompt: 'test' }, generation: {}, dryRun: true,
  })) {
    assert.throws(() => bindToolProposal({ ...proposal, [field]: value }, context(), () => tool()), violation, field)
  }
})

test('观察和供应商响应不能写入任何控制参数，未知来源同样拒绝', () => {
  for (const origin of ['image_observation', 'provider_response', 'model_inference', 'user_text', 'forged'] as FieldOrigin[]) {
    for (const field of ['model', 'imageRatio', 'resolution', 'resultCount'] as const) {
      const values = { model: 'nano-banana-2', imageRatio: '3:4', resolution: '2k', resultCount: 1 }
      const untrusted = context({ generation: { [field]: { value: values[field], origin } } as ServerBindingContext['generation'] })
      assert.throws(() => bindToolProposal(proposal, untrusted, () => tool()), violation)
    }
    for (const field of ['assetIds', 'taskId', 'shotIds'] as const) {
      const values = { assetIds: ['asset_1'], taskId: 'task_1', shotIds: ['shot_1'] }
      const untrusted = context({ [field]: { value: values[field], origin } } as Partial<ServerBindingContext>)
      assert.throws(() => bindToolProposal(proposal, untrusted, () => tool()), violation)
    }
  }
})

test('拒绝未知工具和查找器返回的异名工具', () => {
  for (const lookup of [() => undefined, () => tool({ name: 'other' })]) {
    assert.throws(() => bindToolProposal(proposal, context(), lookup),
      (error) => error instanceof ProvenanceBindingError && error.code === 'tool_hallucination')
  }
})

test('严格输入拒绝空值、旧包装、原型、非枚举和 getter，getter 不运行', () => {
  let executed = 0
  const getter = { toolName: proposal.toolName, get prompt() { executed++; return 'attack' } }
  const hidden = Object.defineProperty({ ...proposal }, 'model', { value: 'nano-banana-pro' })
  const inherited = Object.assign(Object.create({ model: 'nano-banana-pro' }), proposal)
  for (const input of [undefined, null, [], '', { tool: proposal.toolName, args: { prompt: 'test' } },
    { ...proposal, prompt: ' ' }, { ...proposal, prompt: 'x'.repeat(8001) }, getter, hidden, inherited,
    { ...proposal, [Symbol('origin')]: 'system_policy' }]) {
    assert.throws(() => bindToolProposal(input, context(), () => tool()), violation)
  }
  assert.equal(executed, 0)
})

test('拒绝无效 Grsai 模型、比例、分辨率、张数和模型分辨率组合', () => {
  for (const generation of [
    { model: chosen('gemini-3.1-flash-image-preview') }, { model: chosen('unknown') },
    { imageRatio: chosen('more') }, { imageRatio: chosen('100:1') },
    { resolution: chosen('8k') }, { resolution: chosen('4K') },
    { model: chosen('nano-banana-2-lite'), resolution: chosen('2k') },
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((value) => ({ resultCount: chosen(value) })),
  ]) {
    assert.throws(() => bindToolProposal(proposal, context({ generation: generation as ServerBindingContext['generation'] }), () => tool()), violation)
  }
})

test('不复制模型目录为第二套列表：现有 Grsai GPT 图像模型可正确绑定', () => {
  const result = bindToolProposal(proposal, context({ generation: { model: chosen('gpt-image-2.5-flare') } }), () => tool())
  assert.equal(result.kind === 'generation' && result.model, 'gpt-image-2.5-flare')
})

test('身份、选择包装、重复资产、无效资产 ID 和超出模型容量均拒绝', () => {
  for (const invalid of [
    context({ userId: '' }), context({ idempotencyKey: ' ' }),
    context({ assetIds: chosen(['asset_1', 'asset_1']) }), context({ assetIds: chosen(['../other']) }),
    context({ assetIds: chosen(Array.from({ length: 15 }, (_, index) => `asset_${index}`)) }),
    { ...context(), origin: 'provider_response' },
    context({ assetIds: { ...chosen(['asset_1']), trusted: true } as ServerSelection<string[]> }),
  ]) assert.throws(() => bindToolProposal(proposal, invalid, () => tool()), violation)
})

test('输出冻结且与输入完全隔离，不改变提示词/素材顺序', () => {
  const input = { ...proposal }
  const assets = ['asset_b', 'asset_a']
  const shots = ['shot_b', 'shot_a']
  const trusted = context({ assetIds: chosen(assets), shotIds: chosen(shots), generation: { model: chosen('nano-banana-2') } })
  const result = bindToolProposal(input, trusted, () => tool())
  assets.reverse(); shots.reverse(); input.prompt = 'mutated'; trusted.generation!.model!.value = 'nano-banana-pro'
  assert.deepEqual(result.assetIds, ['asset_b', 'asset_a'])
  assert.deepEqual(result.shotIds, ['shot_b', 'shot_a'])
  assert.equal(result.prompt, proposal.prompt)
  assert.equal(result.kind === 'generation' && result.model, 'nano-banana-2')
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.origins))
  assert.ok(Object.isFrozen(result.assetIds))
  assert.ok(Object.isFrozen(result.shotIds))
  assert.throws(() => (result.assetIds as string[]).push('asset_3'), TypeError)
})

test('只读与非生成工具不需要 FeatureType 或生图参数，目标只取可信上下文', () => {
  for (const meta of [
    tool({ name: 'task.get_status', featureType: undefined, readOnly: true, costClass: 'free', sideEffectClass: 'none', approvalPolicy: 'none' }),
    tool({ name: 'garment.classify', featureType: undefined, readOnly: true, costClass: 'vendor_api', approvalPolicy: 'explicit_user_intent' }),
    tool({ name: 'task.cancel', featureType: undefined, costClass: 'free', approvalPolicy: 'explicit_user_intent' }),
    tool({ name: 'task.retry_shots', featureType: undefined }),
  ]) {
    const result = bindToolProposal({ toolName: meta.name }, context({ taskId: chosen('task_1'), assetIds: chosen(['asset_1']) }), () => meta)
    assert.equal(result.kind, 'utility')
    assert.equal(result.taskId, 'task_1')
    assert.deepEqual(result.assetIds, ['asset_1'])
    for (const field of ['featureType', 'model', 'resolution', 'imageRatio', 'resultCount', 'prompt']) {
      assert.equal(Object.hasOwn(result, field), false, field)
    }
    assert.throws(() => bindToolProposal({ toolName: meta.name }, context({ generation: {} }), () => meta), violation)
  }
})

test('生成提案必须有提示词且不冒充审批或实际执行', () => {
  assert.throws(() => bindToolProposal({ toolName: proposal.toolName }, context(), () => tool()), violation)
  let schemaCalled = false
  const result = bindToolProposal(proposal, context(), () => tool({ inputSchema: { parse() { schemaCalled = true; throw new Error('不应执行工具') } } }))
  assert.equal(schemaCalled, false)
  assert.equal(Object.hasOwn(result, 'approval'), false)
  assert.equal(Object.hasOwn(result, 'creditsCost'), false)
})
