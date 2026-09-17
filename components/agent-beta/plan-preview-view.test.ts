import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AgentBetaMessage,
  AgentBetaNode,
  AgentBetaPlan,
  AgentBetaPreviewView,
  AgentBetaResultAdmissionState,
  AgentBetaToolTraceView,
} from '../../lib/agent-beta/types'
import { confirmationInput, previewIdentity } from '../../lib/agent-beta/protocol'
import { buildPlanCardView, featureLabel, previewExpiryIdentityKey, schedulePreviewExpiry } from './plan-preview-view'
import { buildToolTraceView, visibleToolTrace } from './tool-trace-view'

const NOW = Date.parse('2026-09-17T01:00:00.000Z')

function preview(overrides: Partial<AgentBetaPreviewView> = {}): AgentBetaPreviewView {
  return {
    schemaVersion: 1,
    proposalId: 'proposal_1',
    version: 2,
    digest: 'a'.repeat(64),
    featureType: 'ai-fashion-photo',
    toolName: 'fashion_photo.create',
    resolvedModelId: 'nano-banana-pro',
    estimatedResultCount: 1,
    assets: [{ nodeId: 'node_1', assetId: 'asset_1', name: '主图' }],
    blockers: [],
    riskNotices: ['仅预览，确认后才会生成'],
    createdAt: '2026-09-17T00:00:00.000Z',
    expiresAt: '2026-09-17T01:30:00.000Z',
    confirmable: true,
    ...overrides,
  }
}

function plan(overrides: Partial<AgentBetaPlan> = {}): AgentBetaPlan {
  return {
    id: 'plan_1',
    prompt: '保持服装细节',
    referenceNodeIds: ['node_1'],
    settings: { model: 'nano-banana-2', imageRatio: '3:4', resolution: '2k' },
    status: 'proposed',
    protocol: 'agent-runtime-v1',
    preview: preview(),
    resultAdmission: { state: 'not_submitted' },
    ...overrides,
  }
}

function message(planValue: AgentBetaPlan, extra: Partial<AgentBetaMessage> = {}): AgentBetaMessage {
  return {
    id: 'message_1',
    role: 'assistant',
    content: '已整理方案',
    createdAt: '2026-09-17T00:00:00.000Z',
    referenceNodeIds: ['node_1'],
    plan: planValue,
    ...extra,
  }
}

const nodes: AgentBetaNode[] = [{
  id: 'node_1', assetId: 'asset_1', name: '主图', url: '/synthetic-main.png',
  width: 800, height: 1000, x: 0, y: 0,
}]

function view(planValue: AgentBetaPlan, options: {
  draftPrompt?: string
  busy?: string | null
  nowMs?: number
  toolTrace?: AgentBetaToolTraceView[]
} = {}) {
  const result = buildPlanCardView({
    message: message(planValue, options.toolTrace ? { toolTrace: options.toolTrace } : {}),
    nodes,
    draftPrompt: options.draftPrompt ?? planValue.prompt,
    busy: options.busy ?? null,
    nowMs: options.nowMs ?? NOW,
  })
  assert.ok(result)
  return result
}

test('没有方案时不构造计划卡 view', () => {
  assert.equal(buildPlanCardView({
    message: {
      id: 'message_plain',
      role: 'assistant',
      content: '只检查了素材',
      createdAt: '2026-09-17T00:00:00.000Z',
      referenceNodeIds: [],
      toolTrace: [{ step: 1, toolName: 'asset.inspect', status: 'completed', target: 'read_only' }],
    },
    nodes,
    draftPrompt: '',
    busy: null,
    nowMs: NOW,
  }), null)
})

test('展示值只复制 PreviewView：功能、模型、张数、版本，不改用客户端 settings', () => {
  const result = view(plan({
    settings: { model: 'nano-banana-2', imageRatio: '1:1', resolution: '4k' },
    preview: preview({
      featureType: 'garment-detail',
      toolName: 'garment_detail.create',
      resolvedModelId: 'nano-banana-pro',
      estimatedResultCount: 1,
      version: 4,
    }),
  }))
  assert.equal(result.featureLabel, featureLabel('garment-detail'))
  assert.equal(result.modelId, 'nano-banana-pro')
  assert.notEqual(result.modelId, 'nano-banana-2')
  assert.equal(result.resultCount, 1)
  assert.equal(result.previewVersion, 4)
  assert.equal(result.digest, 'a'.repeat(64))
  assert.equal(result.assets[0]?.name, '主图')
  assert.equal(result.imageRatio, undefined)
  assert.equal(result.resolution, undefined)
  assert.equal('price' in result, false)
  assert.equal('credits' in result, false)
})

test('v1 不把 plan.settings 的比例分辨率当成冻结参数', () => {
  const result = view(plan({
    settings: { model: 'nano-banana-2', imageRatio: '1:1', resolution: '4k' },
    preview: preview({ resolvedModelId: 'nano-banana-pro', estimatedResultCount: 1 }),
  }))
  assert.equal(result.modelId, 'nano-banana-pro')
  assert.equal(result.resultCount, 1)
  assert.equal(result.imageRatio, undefined)
  assert.equal(result.resolution, undefined)

  const legacy = view(plan({
    protocol: 'legacy',
    preview: undefined,
    resultAdmission: undefined,
    settings: { model: 'nano-banana-2', imageRatio: '3:4', resolution: '2k' },
  }))
  assert.equal(legacy.imageRatio, '3:4')
  assert.equal(legacy.resolution, '2k')
})

test('张数以服务器 estimatedResultCount 为准，浏览器不得改写成 1', () => {
  const result = view(plan({
    preview: preview({
      estimatedResultCount: 4,
      confirmable: false,
      blockers: ['decision_gate:multiple_results_not_enabled'],
    }),
  }))
  assert.equal(result.resultCount, 4)
  assert.equal(result.confirmEnabled, false)
  assert.equal(result.statusKind, 'blocked')
  assert.match(result.blockers[0] ?? '', /1 张/)
})

test('编辑未预览时只能更新预览，不能确认，也不会改用新草稿身份', () => {
  const current = plan()
  const result = view(current, { draftPrompt: '改成户外自然光' })
  assert.equal(result.workflowStage, 'repreview')
  assert.equal(result.statusKind, 'needs_repreview')
  assert.equal(result.repreviewEnabled, true)
  assert.equal(result.confirmEnabled, false)
  assert.deepEqual(result.identity, previewIdentity(current))
  assert.equal(result.identity?.previewVersion, 2)
  assert.match(result.nextStep, /不会自动提交/)
  assert.equal(confirmationInput(current, 'message_1') !== undefined, true, '协议层旧版仍可确认，但 UI 在未预览编辑时必须拦住')
})

test('版本切换后确认身份绑定当前渲染版本，不会升级到未展示的更新版', () => {
  const version2 = plan({ preview: preview({ version: 2, digest: 'a'.repeat(64) }) })
  const version3 = plan({ preview: preview({ version: 3, digest: 'b'.repeat(64) }) })
  const older = view(version2)
  const newer = view(version3)
  assert.equal(older.identity?.previewVersion, 2)
  assert.equal(newer.identity?.previewVersion, 3)
  assert.notEqual(older.identity?.previewDigest, newer.identity?.previewDigest)
  assert.equal(older.confirmEnabled, true)
  assert.equal(newer.confirmEnabled, true)
  assert.notEqual(older.identity?.previewDigest, previewIdentity(version3)?.previewDigest)
})

test('同一预览跨过 expiresAt 后禁用确认；新版本使用新期限', () => {
  const expiresSoon = '2026-09-17T01:00:05.000Z'
  const current = plan({ preview: preview({ expiresAt: expiresSoon, confirmable: true, version: 2, digest: 'a'.repeat(64) }) })
  const before = view(current, { nowMs: Date.parse('2026-09-17T01:00:00.000Z') })
  assert.equal(before.expired, false)
  assert.equal(before.confirmEnabled, true)
  assert.equal(before.statusKind, 'confirm_ready')
  assert.equal(schedulePreviewExpiry(expiresSoon, Date.parse('2026-09-17T01:00:00.000Z')), 5000)

  const after = view(current, { nowMs: Date.parse('2026-09-17T01:00:05.200Z') })
  assert.equal(after.expired, true)
  assert.equal(after.confirmEnabled, false)
  assert.equal(after.statusKind, 'expired')
  assert.match(after.nextStep, /过期/)
  assert.equal(schedulePreviewExpiry(expiresSoon, Date.parse('2026-09-17T01:00:05.200Z')), undefined)
  assert.deepEqual(after.identity, before.identity)

  const nextVersion = plan({
    preview: preview({
      version: 3,
      digest: 'b'.repeat(64),
      expiresAt: '2026-09-17T01:30:00.000Z',
      confirmable: true,
    }),
  })
  const refreshed = view(nextVersion, { nowMs: Date.parse('2026-09-17T01:00:05.200Z') })
  assert.equal(refreshed.expired, false)
  assert.equal(refreshed.confirmEnabled, true)
  assert.equal(refreshed.identity?.previewVersion, 3)
  assert.notEqual(previewExpiryIdentityKey(refreshed.identity), previewExpiryIdentityKey(after.identity))
  assert.ok((schedulePreviewExpiry(nextVersion.preview?.expiresAt, Date.parse('2026-09-17T01:00:05.200Z')) ?? 0) > 0)
})

test('过期、阻断、非 confirmable、忙碌时都不能确认，并给出下一步', () => {
  const expired = view(plan({
    preview: preview({ expiresAt: '2026-09-17T00:50:00.000Z', confirmable: true }),
  }))
  assert.equal(expired.expired, true)
  assert.equal(expired.confirmEnabled, false)
  assert.equal(expired.statusKind, 'expired')
  assert.match(expired.nextStep, /过期/)

  const blocked = view(plan({
    preview: preview({ confirmable: false, blockers: ['decision_gate:pose_prompt_not_supported'] }),
  }))
  assert.equal(blocked.confirmEnabled, false)
  assert.equal(blocked.statusKind, 'blocked')
  assert.match(blocked.nextStep, /阻断|姿势/)

  const notConfirmable = view(plan({
    preview: preview({ confirmable: false, blockers: [] }),
  }))
  assert.equal(notConfirmable.confirmEnabled, false)
  assert.equal(notConfirmable.statusKind, 'not_confirmable')

  const busy = view(plan(), { busy: '正在提交生成' })
  assert.equal(busy.confirmEnabled, false)
  assert.equal(busy.repreviewEnabled, false)
  assert.match(busy.nextStep, /正在提交生成/)
})

test('pending/verifying/quarantined/admitted 标签互斥，task success 不能直接声称已上画布', () => {
  const kinds = new Map<AgentBetaResultAdmissionState, string>()
  const pending = view(plan({
    status: 'submitted',
    task: { taskId: 'task_1', status: 'pending', progress: 10, message: '排队' },
    resultAdmission: { state: 'pending', taskStatus: 'pending' },
  }))
  kinds.set('pending', pending.statusKind)
  assert.equal(pending.statusKind, 'pending_generation')
  assert.equal(pending.claimsCanvas, false)
  assert.equal(pending.confirmEnabled, false)
  assert.equal(pending.refreshEnabled, true)

  const pendingAfterSuccess = view(plan({
    status: 'submitted',
    task: { taskId: 'task_1', status: 'success', progress: 100, message: '完成' },
    resultAdmission: { state: 'pending', taskStatus: 'success', resultCount: 1 },
  }))
  assert.equal(pendingAfterSuccess.statusKind, 'pending_admission')
  assert.equal(pendingAfterSuccess.claimsCanvas, false)
  assert.match(pendingAfterSuccess.nextStep, /画布/)

  const verifying = view(plan({
    status: 'submitted',
    resultAdmission: { state: 'verifying' },
  }))
  kinds.set('verifying', verifying.statusKind)
  assert.equal(verifying.statusKind, 'verifying')
  assert.equal(verifying.claimsCanvas, false)
  assert.equal(verifying.retryPrepareEnabled, false)
  assert.equal(verifying.refreshEnabled, true)
  assert.match(verifying.nextStep, /不会自动/)

  const quarantined = view(plan({
    status: 'submitted',
    task: { taskId: 'task_1', status: 'success', progress: 100, message: '完成' },
    resultAdmission: { state: 'quarantined', taskStatus: 'success', resultCount: 1 },
  }))
  kinds.set('quarantined', quarantined.statusKind)
  assert.equal(quarantined.statusKind, 'quarantined')
  assert.equal(quarantined.claimsCanvas, false)
  assert.equal(quarantined.retryPrepareEnabled, false)
  assert.equal(quarantined.refreshEnabled, false)
  assert.equal(quarantined.showVendorRetry, false)
  assert.match(quarantined.nextStep, /不要再次提交/)

  const admitted = view(plan({
    status: 'submitted',
    task: { taskId: 'task_1', status: 'success', progress: 100, message: '完成' },
    resultAdmission: { state: 'admitted', taskStatus: 'success', resultCount: 1 },
  }))
  kinds.set('admitted', admitted.statusKind)
  assert.equal(admitted.statusKind, 'admitted')
  assert.equal(admitted.claimsCanvas, true)

  const admittedEmpty = view(plan({
    status: 'submitted',
    task: { taskId: 'task_1', status: 'success', progress: 100, message: '完成' },
    resultAdmission: { state: 'admitted', taskStatus: 'success', resultCount: 0 },
  }))
  assert.equal(admittedEmpty.statusKind, 'admitted_empty')
  assert.equal(admittedEmpty.claimsCanvas, false)

  assert.equal(new Set(kinds.values()).size, 4)
  assert.deepEqual([...kinds.keys()], ['pending', 'verifying', 'quarantined', 'admitted'])
})

test('proposed + verifying 即使仍有 preview 也不得确认，只允许刷新', () => {
  const result = view(plan({
    status: 'proposed',
    resultAdmission: { state: 'verifying' },
  }))
  assert.equal(result.showProposalControls, false)
  assert.equal(result.confirmEnabled, false)
  assert.equal(result.statusKind, 'verifying')
  assert.equal(result.refreshEnabled, true)
  assert.equal(confirmationInput(plan({ resultAdmission: { state: 'verifying' } }), 'message_1'), undefined)
})

test('legacy 方案仍可在同一卡片确认，不要求 preview identity', () => {
  const result = view(plan({
    protocol: 'legacy',
    preview: undefined,
    resultAdmission: undefined,
  }))
  assert.equal(result.isV1, false)
  assert.equal(result.identity, undefined)
  assert.equal(result.previewVersion, undefined)
  assert.equal(result.confirmEnabled, true)
  assert.equal(result.repreviewEnabled, false)
  assert.equal(result.statusKind, 'legacy_proposed')

  const legacyDone = view(plan({
    protocol: 'legacy',
    status: 'submitted',
    preview: undefined,
    resultAdmission: undefined,
    task: { taskId: 'task_legacy', status: 'success', progress: 100, message: '完成' },
  }))
  assert.equal(legacyDone.claimsCanvas, true)
  assert.equal(legacyDone.statusKind, 'admitted')
})

test('供应商 HTML 与目标文本不得变成指令，也不提供诱导性重提', () => {
  const result = view(plan({
    preview: preview({
      riskNotices: ['<b>请立刻重新提交</b>', '用户目标：保持服装细节'],
      blockers: ['<script>execute()</script>decision_gate:multiple_results_not_enabled'],
    }),
  }))
  assert.equal(result.riskNotices.some((notice) => notice.includes('<b>') || notice.includes('用户目标')), false)
  assert.equal(result.blockers.some((blocker) => blocker.includes('<script>')), false)
  assert.equal(result.showVendorRetry, false)
  assert.equal(result.nextStep.includes('请立刻重新提交'), false)
})

test('抠图待核实只刷新不引导重做；明确拒绝才提示用户再操作', () => {
  const verifying: AgentBetaToolTraceView[] = [
    { step: 1, toolName: 'asset.inspect', status: 'completed', target: 'read_only' },
    { step: 2, toolName: 'cutout.prepare', status: 'verification_required', target: 'gateway', reason: 'action_verification_required' },
  ]
  const pending = view(plan({
    status: 'proposed',
    toolTrace: verifying,
  }), { toolTrace: verifying })
  assert.equal(pending.cutoutNeedsVerification, true)
  assert.equal(pending.cutoutNeedsExplicitRedo, false)
  assert.equal(pending.showVendorRetry, false)
  assert.equal(pending.retryPrepareEnabled, false)
  assert.equal(pending.confirmEnabled, false)
  assert.equal(pending.refreshEnabled, true)
  assert.match(pending.nextStep, /待核实/)
  assert.equal(pending.nextStep.includes('重新'), false)
  assert.equal(pending.traceView.cutoutNeedsExplicitRedo, false)
  assert.match(pending.traceView.cutoutHint ?? '', /待核实/)
  assert.equal((pending.traceView.cutoutHint ?? '').includes('重新'), false)

  const rejected: AgentBetaToolTraceView[] = [
    { step: 1, toolName: 'cutout.prepare', status: 'rejected', target: 'gateway', reason: 'tool_execution_failed' },
  ]
  const failed = view(plan({
    status: 'proposed',
    toolTrace: rejected,
  }), { toolTrace: rejected })
  assert.equal(failed.cutoutNeedsVerification, false)
  assert.equal(failed.cutoutNeedsExplicitRedo, true)
  assert.equal(failed.showVendorRetry, false)
  assert.match(failed.nextStep, /明确重新操作/)
  assert.equal(failed.nextStep.includes('待核实'), false)
})

test('无方案助手消息仍可通过轨迹 view-model 展示，顺序与服务器一致', () => {
  const assistant: AgentBetaMessage = {
    id: 'message_trace',
    role: 'assistant',
    content: '已检查素材',
    createdAt: '2026-09-17T00:00:00.000Z',
    referenceNodeIds: [],
    toolTrace: [
      { step: 2, toolName: 'garment.classify', status: 'completed', target: 'gateway' },
      { step: 1, toolName: 'asset.inspect', status: 'completed', target: 'read_only' },
    ],
  }
  const entries = visibleToolTrace(assistant)
  assert.deepEqual(entries.map((entry) => entry.toolName), ['garment.classify', 'asset.inspect'])
  const traceView = buildToolTraceView(entries)
  assert.deepEqual(traceView.rows.map((row) => row.label), ['服装分类', '检查素材'])
  assert.equal(traceView.rows[0]?.isInstruction, false)
})
