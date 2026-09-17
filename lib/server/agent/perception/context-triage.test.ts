import assert from 'node:assert/strict'
import test from 'node:test'
import type { GarmentObservation } from '@/lib/agent/types'
import {
  buildContextSnapshot,
  estimateJsonTokens,
  type TriageInput,
  type TriageMessageInput,
  type TriageNodeInput,
} from './context-triage'

/** 构造合法观察对象；测试关注分诊逻辑，不重复 B2 的观察器校验。 */
function makeObservation(assetId: string, assetDigest: string): GarmentObservation {
  return {
    assetId,
    assetDigest,
    observedAt: '2026-09-17T00:00:00.000Z',
    observerModel: 'deterministic-v1',
    origin: 'image_observation',
    subject: 'garment_flat',
    category: 'unknown',
    dominantColors: ['#ffffff'],
    silhouette: 'straight',
    keyDetails: [],
    hasVisibleText: false,
    hasFace: false,
    quality: { blurry: false, lowResolution: false, watermark: false },
    confidence: 0.9,
    notes: '',
  }
}

function makeMessage(index: number): TriageMessageInput {
  return {
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `历史消息内容 #${index}`,
    createdAt: `2026-09-17T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
  }
}

function makeInput(overrides: Partial<TriageInput> = {}): TriageInput {
  const nodes: TriageNodeInput[] = [
    { nodeId: 'n1', assetId: 'a1', assetDigest: 'd1', selected: true, observation: makeObservation('a1', 'd1') },
    { nodeId: 'n2', assetId: 'a2', assetDigest: 'd2', selected: true, observation: makeObservation('a2', 'd2') },
    { nodeId: 'n3', assetId: 'a3', assetDigest: 'd3', selected: false },
    { nodeId: 'n4', assetId: 'a4', assetDigest: 'd4', selected: false },
    { nodeId: 'n5', assetId: 'a5', assetDigest: 'd5', selected: false },
  ]
  return {
    userId: 'u1',
    sessionId: 's1',
    observerVersion: 'obs-v1',
    tokenBudget: 4000,
    goal: { goalId: 'g1', userGoal: '生成保持款式不变的模特图', constraints: ['保持款式不变'] },
    taskStatus: { summary: '生成中', currentStepId: 'step-1', status: 'SUBMITTED' },
    failureEvidence: ['上一次生成失败：供应商超时'],
    platformRules: ['不得生成可识别人脸'],
    settings: { ratio: '3:4', count: 1 },
    lastResultSummary: '上次生成 1 张，构图偏暗',
    nodes,
    messages: Array.from({ length: 10 }, (_, index) => makeMessage(index)),
    historyTaskIds: ['t1'],
    ...overrides,
  }
}

test('基本分层：P0/P1/P2/P3 各就各位，账目求和一致', () => {
  const snapshot = buildContextSnapshot(makeInput())
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.p0.userGoal, '生成保持款式不变的模特图')
  assert.deepEqual(snapshot.p0.constraints, ['保持款式不变'])
  assert.deepEqual(snapshot.p0.failureEvidence, ['上一次生成失败：供应商超时'])
  assert.equal(snapshot.p1.selectedObservations.length, 2)
  assert.equal(snapshot.p1.lastResultSummary, '上次生成 1 张，构图偏暗')
  assert.equal(snapshot.p2.recentMessages.length, 10)
  const { p0Tokens, p1Tokens, p2Tokens, p3Tokens, estimatedTotalTokens } = snapshot.accounting
  assert.equal(estimatedTotalTokens, p0Tokens + p1Tokens + p2Tokens + p3Tokens)
  assert.equal(snapshot.accounting.p0DroppedCount, 0)
  assert.equal(snapshot.accounting.overBudget, false)
  // 每项都有决策记录
  assert.ok(snapshot.decisions.length >= 10 + 2 + 6 + 1)
  for (const decision of snapshot.decisions) {
    assert.ok(decision.tokenEstimate > 0)
    assert.ok(decision.reason.length > 0)
  }
})

test('P3 只含类型化 handle：session_nodes 绑定 sessionId，observation 携带摘要与观察器版本', () => {
  const snapshot = buildContextSnapshot(makeInput())
  const handles = snapshot.p3.handles
  assert.equal(handles[0]?.kind, 'session_nodes')
  assert.equal(handles[0]?.resourceId, 's1')
  const observationHandles = handles.filter((handle) => handle.kind === 'observation')
  assert.equal(observationHandles.length, 2)
  for (const handle of handles) {
    assert.equal(handle.schemaVersion, 1)
    assert.equal(handle.userId, 'u1')
    assert.equal(handle.sessionId, 's1')
  }
  for (const handle of observationHandles) {
    assert.ok(handle.assetDigest && handle.assetDigest.length > 0)
    assert.equal(handle.observerVersion, 'obs-v1')
  }
  // 冷节点是 asset handle，不带 observerVersion；历史任务是 task handle
  const assetHandles = handles.filter((handle) => handle.kind === 'asset')
  assert.equal(assetHandles.length, 3)
  for (const handle of assetHandles) assert.equal(handle.observerVersion, undefined)
  assert.equal(handles.filter((handle) => handle.kind === 'task').length, 1)
})

test('大 P0 超预算：仍然原文保留，标记 included_over_budget，p0_dropped_count 恒为 0', () => {
  const hugeGoal = '超长目标'.repeat(30_000) // 远超预算
  const snapshot = buildContextSnapshot(makeInput({
    tokenBudget: 500,
    goal: { goalId: 'g1', userGoal: hugeGoal, constraints: ['保持款式不变'] },
  }))
  assert.equal(snapshot.accounting.overBudget, true)
  assert.equal(snapshot.accounting.p0DroppedCount, 0)
  assert.equal(snapshot.p0.userGoal, hugeGoal)
  assert.deepEqual(snapshot.p0.failureEvidence, ['上一次生成失败：供应商超时'])
  assert.deepEqual(snapshot.p0.platformRules, ['不得生成可识别人脸'])
  const p0Decision = snapshot.decisions.find((entry) => entry.priority === 'P0')
  assert.equal(p0Decision?.decision, 'included_over_budget')
  // 预算不足时 P2 全部截断，但没有任何 P0 决策是 dropped
  assert.equal(snapshot.p2.recentMessages.length, 0)
  assert.ok(!snapshot.decisions.some((entry) => entry.priority === 'P0' && entry.decision === 'dropped'))
})

test('小预算下 P2 确定性截断：保留最近消息，丢弃更旧的，且不触碰目标与失败证据', () => {
  const baseline = buildContextSnapshot(makeInput())
  const lastMessageTokens = estimateJsonTokens(makeMessage(9))
  const tightBudget = baseline.accounting.p0Tokens + baseline.accounting.p1Tokens
    + baseline.accounting.p3Tokens + lastMessageTokens
  const snapshot = buildContextSnapshot(makeInput({ tokenBudget: tightBudget }))
  // 恰好只装得下最近一条
  assert.deepEqual(snapshot.p2.recentMessages.map((message) => message.id), ['m9'])
  assert.equal(snapshot.p0.userGoal, '生成保持款式不变的模特图')
  assert.deepEqual(snapshot.p0.failureEvidence, ['上一次生成失败：供应商超时'])
  assert.equal(snapshot.accounting.p0DroppedCount, 0)
  const dropped = snapshot.decisions.filter((entry) => entry.decision === 'dropped')
  assert.equal(dropped.length, 9)
  for (const entry of dropped) assert.equal(entry.priority, 'P2')
})

test('50 节点 + 100 消息仍产出合法快照，冷节点原始载荷零泄漏', () => {
  const nodes: TriageNodeInput[] = Array.from({ length: 50 }, (_, index) => {
    const selected = index < 5
    const node = {
      nodeId: `n${index}`,
      assetId: `a${index}`,
      assetDigest: `digest-${index}`,
      selected,
      ...(selected ? { observation: makeObservation(`a${index}`, `digest-${index}`) } : {}),
      // 冷节点上的多余原始载荷：分诊必须逐字段重建，绝不能带进快照
      providerRawPayload: `COLD-SECRET-${index}`,
      sourceUrl: `https://cdn.example.com/raw/${index}.bin`,
    } as TriageNodeInput
    return node
  })
  const messages = Array.from({ length: 100 }, (_, index) => ({
    ...makeMessage(index),
    internalTrace: 'TRACE-SECRET',
  })) as TriageMessageInput[]
  const snapshot = buildContextSnapshot(makeInput({ nodes, messages, tokenBudget: 200_000 }))
  assert.equal(snapshot.p1.selectedObservations.length, 5)
  assert.equal(snapshot.p3.handles.filter((handle) => handle.kind === 'asset').length, 45)
  assert.equal(snapshot.p3.handles.filter((handle) => handle.kind === 'observation').length, 5)
  assert.equal(snapshot.p2.recentMessages.length, 100)
  const serialized = JSON.stringify(snapshot)
  assert.ok(!serialized.includes('COLD-SECRET'))
  assert.ok(!serialized.includes('TRACE-SECRET'))
  assert.ok(!serialized.includes('cdn.example.com'))
})

test('稳定重放：相同输入两次构建产出逐字节一致的 JSON', () => {
  const first = JSON.stringify(buildContextSnapshot(makeInput()))
  const second = JSON.stringify(buildContextSnapshot(makeInput()))
  assert.equal(first, second)
})

test('数据不可变：快照冻结，构建后修改输入不影响快照', () => {
  const input = makeInput()
  const snapshot = buildContextSnapshot(input)
  const before = JSON.stringify(snapshot)
  // 构建后篡改输入
  input.messages.push(makeMessage(99))
  input.goal.constraints.push('篡改约束')
  input.settings.ratio = '16:9'
  input.nodes[0]!.assetDigest = 'hacked'
  ;(input.nodes[0]!.observation as GarmentObservation).notes = 'hacked-notes'
  assert.equal(JSON.stringify(snapshot), before)
  // 快照本体深度冻结
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.p0.constraints))
  assert.ok(Object.isFrozen(snapshot.p3.handles[0]))
  assert.throws(() => {
    (snapshot.p0 as { userGoal: string }).userGoal = '篡改'
  }, TypeError)
})

test('非法输入被拒绝：预算、身份、重复、摘要不一致、非 JSON', () => {
  // 负数 / NaN / 0 / Infinity 预算
  for (const budget of [-1, NaN, 0, Infinity]) {
    assert.throws(() => buildContextSnapshot(makeInput({ tokenBudget: budget })), RangeError)
  }
  // 空身份
  assert.throws(() => buildContextSnapshot(makeInput({ userId: '' })), TypeError)
  assert.throws(() => buildContextSnapshot(makeInput({ sessionId: '' })), TypeError)
  // 重复 nodeId / 重复消息 id
  const duplicated = makeInput()
  duplicated.nodes.push({ ...duplicated.nodes[0]! })
  assert.throws(() => buildContextSnapshot(duplicated), /重复/)
  const duplicatedMessage = makeInput()
  duplicatedMessage.messages.push(makeMessage(0))
  assert.throws(() => buildContextSnapshot(duplicatedMessage), /重复/)
  // observation 与节点摘要/资产不一致
  const mismatched = makeInput()
  mismatched.nodes[0]!.observation = makeObservation('a1', 'wrong-digest')
  assert.throws(() => buildContextSnapshot(mismatched), /不一致/)
  // 选中节点缺 observation
  const missing = makeInput()
  delete missing.nodes[0]!.observation
  assert.throws(() => buildContextSnapshot(missing), /缺少 observation/)
  // observation 伪装成非图像来源
  const fakeOrigin = makeInput()
  fakeOrigin.nodes[0]!.observation = {
    ...makeObservation('a1', 'd1'),
    origin: 'server_fact' as GarmentObservation['origin'],
  }
  assert.throws(() => buildContextSnapshot(fakeOrigin), /image_observation/)
  // settings 含函数 / NaN / undefined / 非普通对象
  assert.throws(
    () => buildContextSnapshot(makeInput({ settings: { fn: (() => 1) as unknown as number } })),
    TypeError,
  )
  assert.throws(
    () => buildContextSnapshot(makeInput({ settings: { bad: NaN } })),
    TypeError,
  )
  assert.throws(
    () => buildContextSnapshot(makeInput({ settings: { bad: new Date() as unknown as string } })),
    TypeError,
  )
})
