import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import type { AgentToolMeta } from '../../../agent/types'
import { ToolRegistry } from './tool-registry'

function metadata(overrides: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return {
    name: 'asset.inspect',
    description: '读取已鉴权素材信息',
    whenToUse: '需要理解当前素材时',
    whenNotToUse: ['用户只咨询流程时'],
    inputSchema: z.object({ assetId: z.string() }).strict(),
    readOnly: true,
    costClass: 'free',
    sideEffectClass: 'none',
    approvalPolicy: 'none',
    requiresFreshState: true,
    quotaPerTurn: 2,
    rollbackCapability: 'none',
    ...overrides,
  }
}

function generation(overrides: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return metadata({
    name: 'fashion_photo.create',
    featureType: 'ai-fashion-photo',
    readOnly: false,
    costClass: 'paid_generation',
    sideEffectClass: 'external_irreversible',
    approvalPolicy: 'preview_confirmation',
    rollbackCapability: 'irreversible_after_submit',
    ...overrides,
  })
}

test('启动拒绝重复名称、缺失说明和四轴矛盾配置', () => {
  assert.throws(() => new ToolRegistry([metadata(), metadata()]), /重复/)
  assert.throws(() => new ToolRegistry([metadata({ whenNotToUse: [] })]), /whenNotToUse/)
  assert.throws(() => new ToolRegistry([
    metadata({ rollbackCapability: undefined as never }),
  ]), /rollbackCapability/)
  assert.throws(() => new ToolRegistry([
    metadata({ sideEffectClass: 'local_write' }),
  ]), /只读却包含写副作用/)
  assert.throws(() => new ToolRegistry([
    metadata({
      name: 'task.cancel',
      readOnly: false,
      sideEffectClass: 'local_write',
      approvalPolicy: 'none',
      rollbackCapability: 'local_polling_only',
    }),
  ]), /没有审批策略/)
})

test('工具名与 featureType 使用冻结的共享范围', () => {
  for (const name of ['.hidden', 'bad name', `${'a'.repeat(100)}b`]) {
    assert.throws(() => new ToolRegistry([metadata({ name })]), /工具名格式/)
  }
  assert.doesNotThrow(() => new ToolRegistry([metadata({ name: 'Asset.inspect-v1' })]))
  assert.throws(() => new ToolRegistry([
    metadata({ featureType: 'unknown' as AgentToolMeta['featureType'] }),
  ]), /featureType/)
  assert.throws(() => new ToolRegistry([
    generation({ featureType: undefined }),
  ]), /缺少 featureType/)
  assert.doesNotThrow(() => new ToolRegistry([
    generation({ name: 'task.retry_shots', featureType: undefined }),
  ]))
})

test('只接受可验证的 strict ZodObject 且 catchall 必须为 ZodNever', () => {
  const unsupportedSchemas: AgentToolMeta['inputSchema'][] = [
    z.object({ assetId: z.string() }),
    z.object({ assetId: z.string() }).strict().transform((value) => value),
    z.object({ assetId: z.string() }).strict().catchall(z.any()),
    { parse: (value: unknown) => value },
  ]
  for (const inputSchema of unsupportedSchemas) {
    assert.throws(() => new ToolRegistry([metadata({ inputSchema })]), /strict ZodObject/)
  }

  const registry = new ToolRegistry([metadata()])
  assert.deepEqual(registry.get('asset.inspect')?.inputSchema.parse({ assetId: 'asset-1' }), {
    assetId: 'asset-1',
  })
  assert.throws(() => registry.get('asset.inspect')?.inputSchema.parse({
    assetId: 'asset-1',
    userId: '伪造字段',
  }), z.ZodError)
})

test('paid_generation 必须是带 featureType、审批和写副作用的非只读工具', () => {
  assert.throws(() => new ToolRegistry([
    generation({ approvalPolicy: 'always' }),
  ]), /preview_confirmation/)
  assert.throws(() => new ToolRegistry([
    generation({ readOnly: true }),
  ]), /不能声明 readOnly/)
  assert.throws(() => new ToolRegistry([
    generation({ sideEffectClass: 'none', rollbackCapability: 'none' }),
  ]), /必须声明写副作用/)
})

test('返回元数据和列表不可变，且不冻结 Zod 解析器缓存', () => {
  const schema = z.object({ assetId: z.string() }).strict()
  const source = metadata({ inputSchema: schema })
  const registry = new ToolRegistry([source])
  const listed = registry.list()
  const registered = registry.get('asset.inspect')

  assert.ok(registered)
  assert.equal(Object.isFrozen(listed), true)
  assert.equal(Object.isFrozen(registered), true)
  assert.equal(Object.isFrozen(registered.whenNotToUse), true)
  assert.equal(Object.isFrozen(registered.inputSchema), true)
  assert.equal(Object.isFrozen(schema), false)
  assert.notEqual(registered.inputSchema, schema)

  assert.equal(Reflect.set(registered, 'name', 'changed'), false)
  assert.equal(Reflect.set(registered.inputSchema, 'parse', () => ({})), false)
  const listedBefore = [...listed]
  assert.throws(() => (listed as AgentToolMeta[]).pop(), TypeError)
  assert.deepEqual(listed, listedBefore)
  const whenNotToUseBefore = [...registered.whenNotToUse]
  assert.throws(() => registered.whenNotToUse.push('外部修改'), TypeError)
  assert.deepEqual(registered.whenNotToUse, whenNotToUseBefore)

  source.name = 'changed-at-source'
  source.whenNotToUse.push('源数组修改')
  assert.equal(registry.get('asset.inspect')?.name, 'asset.inspect')
  assert.deepEqual(registry.get('asset.inspect')?.whenNotToUse, ['用户只咨询流程时'])
  assert.deepEqual(registered.inputSchema.parse({ assetId: 'asset-2' }), { assetId: 'asset-2' })
})

test('列表保持注册顺序，未知名称返回 undefined', () => {
  const registry = new ToolRegistry([
    metadata(),
    metadata({ name: 'session.list_nodes' }),
  ])
  assert.deepEqual(registry.list().map((tool) => tool.name), [
    'asset.inspect',
    'session.list_nodes',
  ])
  assert.equal(registry.get('missing'), undefined)
})
