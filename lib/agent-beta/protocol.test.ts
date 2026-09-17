import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBetaPlan, AgentBetaSession } from './types'
import { confirmationInput, hasAdmittedResults, previewIdentity, sessionNeedsRefresh } from './protocol'

function plan(overrides: Partial<AgentBetaPlan> = {}): AgentBetaPlan {
  return {
    id: 'plan_1',
    prompt: '保持服装细节',
    referenceNodeIds: ['node_1'],
    settings: { model: 'nano-banana-2', imageRatio: '3:4', resolution: '2k' },
    status: 'proposed',
    protocol: 'agent-runtime-v1',
    preview: {
      schemaVersion: 1,
      proposalId: 'proposal_1',
      version: 2,
      digest: 'a'.repeat(64),
      featureType: 'ai-fashion-photo',
      toolName: 'fashion_photo.create',
      resolvedModelId: 'nano-banana-2',
      estimatedResultCount: 1,
      assets: [{ nodeId: 'node_1', assetId: 'asset_1', name: '主图' }],
      blockers: [],
      riskNotices: ['仅预览'],
      createdAt: '2026-09-17T00:00:00.000Z',
      expiresAt: '2026-09-17T00:30:00.000Z',
      confirmable: true,
    },
    resultAdmission: { state: 'not_submitted' },
    ...overrides,
  }
}

function session(value: AgentBetaPlan): AgentBetaSession {
  return {
    id: 'session_1', title: '测试', createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z', nodes: [],
    messages: [{ id: 'message_1', role: 'assistant', content: '预览', createdAt: '2026-09-17T00:00:00.000Z', referenceNodeIds: [], plan: value }],
  }
}

test('v1 确认只复制服务端 proposal/version/digest', () => {
  const value = plan()
  assert.deepEqual(previewIdentity(value), {
    proposalId: 'proposal_1', previewVersion: 2, previewDigest: 'a'.repeat(64),
  })
  assert.deepEqual(confirmationInput(value, 'message_1'), {
    messageId: 'message_1', proposalId: 'proposal_1', previewVersion: 2, previewDigest: 'a'.repeat(64),
  })
})

test('blocked、旧协议或已提交方案不能构造确认', () => {
  const blocked = plan({ preview: { ...plan().preview!, blockers: ['decision_gate'], confirmable: false } })
  assert.equal(confirmationInput(blocked, 'message_1'), undefined)
  assert.equal(confirmationInput({ ...plan(), protocol: 'legacy' }, 'message_1'), undefined)
  assert.equal(confirmationInput({ ...plan(), status: 'submitted' }, 'message_1'), undefined)
})

test('只有 ADMITTED 且服务端安全结果数大于零才可声明画布结果', () => {
  assert.equal(hasAdmittedResults(plan({ resultAdmission: { state: 'admitted', resultCount: 1 } })), true)
  assert.equal(hasAdmittedResults(plan({ resultAdmission: { state: 'admitted', resultCount: 0 } })), false)
  assert.equal(hasAdmittedResults(plan({ resultAdmission: { state: 'pending', resultCount: 1 } })), false)
})

test('pending/UNKNOWN(映射 verifying) 刷新但不会产生 execute 输入', () => {
  const pending = plan({ resultAdmission: { state: 'pending' } })
  assert.equal(sessionNeedsRefresh(session(pending)), true)
  const verifying = plan({ status: 'submitted', resultAdmission: { state: 'verifying' } })
  assert.equal(sessionNeedsRefresh(session(verifying)), true)
  const admitted = plan({ status: 'submitted', resultAdmission: { state: 'admitted' } })
  assert.equal(sessionNeedsRefresh(session(admitted)), false)
  assert.equal(sessionNeedsRefresh({
    ...session(admitted),
    messages: [{ id: 'message_unknown', role: 'assistant', content: '待核实', createdAt: '2026-09-17T00:00:00.000Z',
      referenceNodeIds: [], toolTrace: [{ step: 1, toolName: 'cutout.prepare', status: 'verification_required' }] }],
  }), true)
  assert.equal(confirmationInput(verifying, 'message_1'), undefined)
})


test('渲染时 preview identity 仅在当前同方案身份逐字段一致时绑定原对象', async () => {
  type Identity = NonNullable<ReturnType<typeof previewIdentity>>
  type Binder = (clicked: Identity | undefined, current: AgentBetaPlan | undefined) => Identity | undefined
  const protocol = await import('./protocol')
  const candidate = Reflect.get(protocol, 'bindClickedPreviewIdentity')
  if (typeof candidate !== 'function') assert.fail('缺少 bindClickedPreviewIdentity')
  const bindClickedPreviewIdentity = candidate as Binder

  const rendered = plan()
  const clicked = previewIdentity(rendered)!
  const newer = plan({
    preview: { ...rendered.preview!, version: 3, digest: 'b'.repeat(64) },
  })
  assert.equal(newer.id, rendered.id)
  assert.equal(newer.prompt, rendered.prompt)
  assert.equal(bindClickedPreviewIdentity(clicked, newer), undefined, '同 message/prompt 的旧卡不得升级到最新身份')

  for (const current of [
    plan({ preview: { ...rendered.preview!, proposalId: 'proposal_2' } }),
    plan({ preview: { ...rendered.preview!, version: 3 } }),
    plan({ preview: { ...rendered.preview!, digest: 'c'.repeat(64) } }),
  ]) {
    assert.equal(bindClickedPreviewIdentity(clicked, current), undefined)
  }

  const equalSnapshot = plan({ preview: { ...rendered.preview! } })
  assert.strictEqual(bindClickedPreviewIdentity(clicked, equalSnapshot), clicked, '一致时必须原样返回点击身份，不自行计算摘要')
})

test('v1 仅 proposed + confirmable + not_submitted 可构造确认输入', () => {
  assert.ok(confirmationInput(plan({ resultAdmission: { state: 'not_submitted' } }), 'message_1'))
  for (const state of ['verifying', 'pending', 'admitted', 'quarantined'] as const) {
    const value = plan({ resultAdmission: { state } })
    assert.equal(value.task, undefined, `${state} 用例必须覆盖无 task 状态`)
    assert.equal(confirmationInput(value, 'message_1'), undefined, `proposed + ${state} 不得确认`)
  }
  assert.equal(confirmationInput(plan({ resultAdmission: undefined }), 'message_1'), undefined, '缺失准入状态不得确认')
})
