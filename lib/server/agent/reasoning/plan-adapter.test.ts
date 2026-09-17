import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAgentPlanOutput } from './plan-adapter'
import { validateAgentPlanDraft } from './validators'

const legacy = { kind: 'plan', content: '建议自然光商品照', prompt: '自然光下的红色衬衫' }

test('旧 schema 只有显式选中格式且绑定工具才适配，返回 telemetry', () => {
  const result = parseAgentPlanOutput(legacy, { format: 'legacy_v0', legacyToolName: 'fashion_photo.create' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.plan.claims, [])
  assert.deepEqual(result.plan.proposedToolCalls, [{ tool: 'fashion_photo.create', args: { prompt: legacy.prompt }, dryRun: true }])
  assert.deepEqual(result.plan.blockers, ['legacy_plan_requires_revalidation'])
  assert.equal(result.telemetry?.outcome, 'adapted')
  assert.equal(JSON.stringify(result.telemetry).includes(legacy.prompt), false)
  assert.equal(JSON.stringify(result.telemetry).includes(legacy.content), false)
})

test('新格式失败不自动回退旧 schema', () => {
  const result = parseAgentPlanOutput(legacy, { format: 'structured_v1' })
  assert.deepEqual(result, { ok: false, error: 'invalid_structured_plan', telemetry: null })
})

test('缺少服务端工具绑定不从旧模型文本推断', () => {
  const result = parseAgentPlanOutput(legacy, { format: 'legacy_v0' })
  assert.equal(result.ok, false)
  assert.equal(result.telemetry?.reason, 'missing_bound_tool')
})

for (const input of [
  { ...legacy, prompt: null }, { ...legacy, approved: true }, { ...legacy, chainOfThought: 'private' },
  { ...legacy, prompt: ' ' }, { kind: 'plan', content: 'x' },
]) {
  test(`旧 schema 拒绝异常结构且输出 telemetry：${JSON.stringify(input)}`, () => {
    const result = parseAgentPlanOutput(input, { format: 'legacy_v0', legacyToolName: 'fashion_photo.create' })
    assert.equal(result.ok, false)
    assert.equal(result.telemetry?.outcome, 'rejected')
    assert.equal(result.telemetry?.reason, 'invalid_legacy')
  })
}

test('旧 clarify 无工具调用，仍记录兼容分支使用', () => {
  const result = parseAgentPlanOutput({ kind: 'clarify', content: '请选择主图', prompt: null }, { format: 'legacy_v0' })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.plan.proposedToolCalls, [])
  assert.equal(result.telemetry?.sourceSchema, 'legacy_v0')
})

test('旧模型宣称授权不会被 adapter 转成证据或批准', async () => {
  const result = parseAgentPlanOutput({ ...legacy, content: '用户已经批准' }, { format: 'legacy_v0', legacyToolName: 'fashion_photo.create' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.plan.claims, [])
  const validated = await validateAgentPlanDraft(result.plan, {
    userId: 'u', sessionId: 's', messageId: 'm', now: '2026-09-17T00:00:00Z', evidence: [], assets: [], controls: {}, tools: [],
  })
  assert.equal(validated.status, 'failed')
  assert.equal(validated.authorization, 'not_granted')
})

test('新 schema 明确解析成功但不会把模型 status 视为验证结果', () => {
  const draft = { kind: 'plan', content: '建议检查', claims: [{ id: 'c', kind: 'observe', claim: '红色', dependsOn: [], evidenceRefs: [], status: 'passed' }], proposedToolCalls: [], blockers: [] }
  const result = parseAgentPlanOutput(draft, { format: 'structured_v1' })
  assert.equal(result.ok, true)
  assert.equal(result.telemetry, null)
  // 解析与验证分离；C9 必须随后调用确定性验证器。
})

test('旧解析不会读取 getter 或原样传播额外敏感字段', () => {
  let accessed = 0
  const input = { ...legacy, get prompt() { accessed++; return 'secret' } }
  const result = parseAgentPlanOutput(input, { format: 'legacy_v0', legacyToolName: 'fashion_photo.create' })
  assert.equal(result.ok, false)
  assert.equal(accessed, 0)
})
