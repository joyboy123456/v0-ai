import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContextSnapshot, type TriageInput } from './context-triage'

function input(): TriageInput {
  return {
    userId: 'user_1', sessionId: 'session_1', observerVersion: 'observer_v1', tokenBudget: 8000,
    goal: { goalId: 'goal_1', userGoal: '保留款式并修复上次失败', constraints: ['不改变颜色', '只生成一张'] },
    taskStatus: { summary: '供应商结果待核实', currentStepId: 'step_1', status: 'UNKNOWN' },
    failureEvidence: ['上一轮连接超时，不能重复提交'], platformRules: ['生成需确认'],
    settings: { model: 'nano-banana-2' }, nodes: [], messages: [],
  }
}

test('独立验收：50 个冷节点、100 条消息和极小预算仍完整保留 P0', () => {
  const source = input()
  source.tokenBudget = 1
  source.nodes = Array.from({ length: 50 }, (_, i) => ({ nodeId: `node_${i}`, assetId: `asset_${i}`,
    assetDigest: 'a'.repeat(64), selected: false, rawProviderResponse: '不可进入上下文' }))
  source.messages = Array.from({ length: 100 }, (_, i) => ({ id: `message_${i}`, role: 'user',
    content: `旧内容 ${i}`, createdAt: '2026-09-17T00:00:00.000Z' }))
  const snapshot = buildContextSnapshot(source)
  assert.equal(snapshot.p0.userGoal, source.goal.userGoal)
  assert.deepEqual(snapshot.p0.constraints, source.goal.constraints)
  assert.deepEqual(snapshot.p0.failureEvidence, source.failureEvidence)
  assert.deepEqual(snapshot.p0.taskStatus, source.taskStatus)
  assert.equal(snapshot.accounting.p0DroppedCount, 0)
  assert.equal(snapshot.accounting.overBudget, true)
  assert.equal(snapshot.p2.recentMessages.length, 0)
  assert.equal(JSON.stringify(snapshot).includes('不可进入上下文'), false)
  for (const handle of snapshot.p3.handles) {
    assert.equal(handle.userId, source.userId)
    assert.equal(handle.sessionId, source.sessionId)
    assert.ok(['session_nodes', 'asset', 'observation', 'task'].includes(handle.kind))
  }
})

test('独立验收：冻结快照不能保留输入对象引用', () => {
  const source = input()
  source.settings.nested = { selection: ['original'] }
  const snapshot = buildContextSnapshot(source)
  source.goal.constraints.push('随后修改')
  source.settings.nested = { selection: ['mutated'] }
  assert.equal(snapshot.p0.constraints.includes('随后修改'), false)
  assert.deepEqual(snapshot.p1.settings.nested, { selection: ['original'] })
  assert.throws(() => snapshot.p0.constraints.push('篡改'), TypeError)
})

test('独立验收：getter 和 toJSON 在输入检查中不得执行', () => {
  for (const location of ['settings', 'goal', 'nodes'] as const) {
    const source = input()
    let executed = 0
    Object.defineProperty(source, location, { enumerable: true, get() { executed++; return input()[location] } })
    assert.throws(() => buildContextSnapshot(source), TypeError)
    assert.equal(executed, 0)
  }
  const source = input()
  let executed = 0
  Object.defineProperty(source.settings, 'toJSON', { enumerable: true,
    get() { executed++; return () => ({}) } })
  assert.throws(() => buildContextSnapshot(source), TypeError)
  assert.equal(executed, 0)
})

test('独立验收：稀疏数组、隐藏字段与符号字段必须拒绝', () => {
  const sparse = input()
  sparse.settings.values = new Array(3)
  assert.throws(() => buildContextSnapshot(sparse), TypeError)
  for (const key of ['hidden', Symbol('hidden')]) {
    const source = input()
    Object.defineProperty(source.settings, key, { value: '不可隐藏', enumerable: false })
    assert.throws(() => buildContextSnapshot(source), TypeError)
  }
})

test('独立验收：任务状态只保留约定字段，不能把完整供应商响应抬成 P0', () => {
  const source = input()
  Object.assign(source.taskStatus, { rawProviderResponse: { credential: 'provider-private-marker' } })
  try {
    assert.equal(JSON.stringify(buildContextSnapshot(source)).includes('provider-private-marker'), false)
  } catch (error) {
    // strict 输入拒绝额外字段或白名单投影均可，不能把原始冷数据送进 P0。
    if (error instanceof assert.AssertionError) throw error
    assert.ok(error instanceof TypeError)
  }
})
