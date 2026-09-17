import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import type { AgentRouteDecision, AgentToolMeta } from '../../../agent/types'
import { GOVERNED_TOOL_METADATA } from './governed-tool-actions'
import { routeAgentRequest } from '../reasoning/router'
import { selectToolFrontier, type ToolFrontierContext } from './tool-frontier'
import { ToolRegistry } from './tool-registry'

const READ_TOOLS = new Set(['asset.inspect', 'session.list_nodes', 'task.get_status'])
const FEATURE_BY_CREATE: Partial<Record<string, NonNullable<AgentToolMeta['featureType']>>> = {
  'fashion_photo.create': 'ai-fashion-photo',
  'photo_fission.create': 'photo-fission',
  'pose_fission.create': 'pose-fission',
  'garment_detail.create': 'garment-detail',
}

function metadata(name: string): AgentToolMeta {
  const featureType = FEATURE_BY_CREATE[name]
  const create = featureType !== undefined || name === 'task.retry_shots'
  const classify = name === 'garment.classify'
  const cutout = name === 'cutout.prepare'
  const cancel = name === 'task.cancel'
  const readOnly = READ_TOOLS.has(name) || classify

  return {
    name,
    ...(featureType === undefined ? {} : { featureType }),
    description: `工具 ${name}`,
    whenToUse: `需要 ${name} 时`,
    whenNotToUse: ['仅咨询流程时'],
    inputSchema: z.object({}).strict(),
    readOnly,
    costClass: create ? 'paid_generation' : (classify || cutout ? 'vendor_api' : 'free'),
    sideEffectClass: create
      ? 'external_irreversible'
      : (cutout || cancel ? 'local_write' : 'none'),
    approvalPolicy: create
      ? 'preview_confirmation'
      : (classify || cutout || cancel ? 'explicit_user_intent' : 'none'),
    requiresFreshState: !readOnly || classify,
    quotaPerTurn: classify ? 2 : 1,
    rollbackCapability: create
      ? 'irreversible_after_submit'
      : (cutout || cancel ? 'local_polling_only' : 'none'),
  }
}

function registry(): ToolRegistry {
  return new ToolRegistry([
    metadata('asset.inspect'),
    metadata('session.list_nodes'),
    metadata('garment.classify'),
    metadata('cutout.prepare'),
    metadata('fashion_photo.create'),
    metadata('photo_fission.create'),
    metadata('pose_fission.create'),
    metadata('garment_detail.create'),
    metadata('task.get_status'),
    metadata('task.cancel'),
    metadata('task.retry_shots'),
  ])
}

function route(overrides: Partial<AgentRouteDecision> = {}): AgentRouteDecision {
  return {
    routerVersion: 'test-v1',
    intent: 'plan',
    evidenceState: 'ready',
    mechanicalReady: true,
    risk: 'write_reversible',
    costClass: 'paid_generation',
    lane: 'plan_execute',
    reasoningMode: 'direct',
    humanGate: 'before_generation',
    budget: { maxModelCalls: 1, maxToolCalls: 4, maxLatencyMs: 1_000 },
    routeReason: '单元测试',
    blockers: [],
    ...overrides,
  }
}

const CUTOUT_ROUTE: AgentRouteDecision = {
  routerVersion: 'test-cutout-v1',
  intent: 'edit',
  evidenceState: 'ready',
  mechanicalReady: true,
  risk: 'write_reversible',
  costClass: 'vendor_api',
  lane: 'structured_decision',
  reasoningMode: 'direct',
  humanGate: 'none',
  budget: { maxModelCalls: 1, maxToolCalls: 2, maxLatencyMs: 1_000 },
  routeReason: '用户明确要求抠图',
  blockers: [],
}

const CANCEL_ROUTE: AgentRouteDecision = {
  routerVersion: 'test-cancel-v1',
  intent: 'edit',
  evidenceState: 'ready',
  mechanicalReady: true,
  risk: 'write_reversible',
  costClass: 'free_text',
  lane: 'structured_decision',
  reasoningMode: 'direct',
  humanGate: 'none',
  budget: { maxModelCalls: 0, maxToolCalls: 1, maxLatencyMs: 1_000 },
  routeReason: '用户明确要求取消任务',
  blockers: [],
}

function names(context: ToolFrontierContext): string[] {
  return selectToolFrontier(registry(), context).map((tool) => tool.name)
}

test('各阶段只暴露固定前沿并返回冻结数组', () => {
  const understand = selectToolFrontier(registry(), {
    allowed: true,
    stage: 'understand',
    route: route({ risk: 'read_only', costClass: 'vendor_api', lane: 'read_only_analysis' }),
  })
  assert.deepEqual(understand.map((tool) => tool.name), [
    'asset.inspect',
    'session.list_nodes',
    'garment.classify',
  ])
  assert.equal(Object.isFrozen(understand), true)

  assert.deepEqual(names({ allowed: true, stage: 'plan', route: route() }), [
    'asset.inspect',
    'session.list_nodes',
    'garment.classify',
    'cutout.prepare',
    'fashion_photo.create',
    'photo_fission.create',
    'pose_fission.create',
    'garment_detail.create',
  ])
  assert.deepEqual(names({
    allowed: true,
    stage: 'waiting',
    route: CANCEL_ROUTE,
  }), ['task.get_status', 'task.cancel'])
  assert.deepEqual(names({
    allowed: true,
    stage: 'finish',
    route: route({ intent: 'retry', risk: 'draft', costClass: 'paid_regeneration' }),
  }), ['task.get_status', 'task.retry_shots'])
})

test('未授权、咨询、直接回答和人工澄清均返回空前沿', () => {
  assert.deepEqual(names({ allowed: false, stage: 'plan', route: route() }), [])
  assert.deepEqual(names({ allowed: true, stage: 'plan', purpose: 'consult', route: route() }), [])
  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    route: route({ lane: 'direct_answer', costClass: 'free_text', risk: 'read_only', humanGate: 'none' }),
  }), [])
  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    route: route({ lane: 'clarify_human_review', humanGate: 'always' }),
  }), [])
})

test('抠图目的在 structured_decision 中只开放受控抠图，不暴露 create 或 retry', () => {
  const plan = names({ allowed: true, stage: 'plan', purpose: 'cutout', route: CUTOUT_ROUTE })
  assert.deepEqual(plan, [
    'asset.inspect',
    'session.list_nodes',
    'garment.classify',
    'cutout.prepare',
  ])
  assert.equal(plan.some((name) => name.endsWith('.create') || name.includes('retry')), false)

  assert.deepEqual(names({
    allowed: true,
    stage: 'finish',
    purpose: 'cutout',
    route: route({ intent: 'retry', risk: 'draft', costClass: 'paid_regeneration' }),
  }), ['task.get_status'])
})

test('structured_decision 允许匹配阶段的取消，但 read_only route 不开放受控动作', () => {
  assert.deepEqual(names({ allowed: true, stage: 'waiting', route: CANCEL_ROUTE }), [
    'task.get_status',
    'task.cancel',
  ])
  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    purpose: 'cutout',
    route: { ...CUTOUT_ROUTE, risk: 'read_only' },
  }), ['asset.inspect', 'session.list_nodes', 'garment.classify'])
  assert.deepEqual(names({
    allowed: true,
    stage: 'waiting',
    route: { ...CANCEL_ROUTE, risk: 'read_only' },
  }), ['task.get_status'])
})

test('allowlist 是不可被 route 或 purpose 扩大的硬权限交集', () => {
  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    purpose: 'general',
    allowedToolNames: ['asset.inspect', 'fashion_photo.create', 'not.registered'],
    route: route(),
  }), ['asset.inspect', 'fashion_photo.create'])
  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    allowedToolNames: [],
    route: route(),
  }), [])
  assert.deepEqual(names({
    allowed: true,
    stage: 'waiting',
    allowedToolNames: ['fashion_photo.create'],
    route: route({ intent: 'edit' }),
  }), [])
})

test('route 成本、风险和人工闸门只能继续缩小前沿', () => {
  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    route: route({ costClass: 'free_text', risk: 'read_only', lane: 'read_only_analysis', humanGate: 'none' }),
  }), ['asset.inspect', 'session.list_nodes'])

  const vendorNames = names({
    allowed: true,
    stage: 'understand',
    route: route({ costClass: 'vendor_api', risk: 'read_only', lane: 'read_only_analysis', humanGate: 'none' }),
  })
  assert.equal(vendorNames.includes('garment.classify'), true)

  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    route: route({ risk: 'draft', lane: 'structured_decision' }),
  }), [
    'asset.inspect',
    'session.list_nodes',
    'garment.classify',
    'fashion_photo.create',
    'photo_fission.create',
    'pose_fission.create',
    'garment_detail.create',
  ])

  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    route: route({ humanGate: 'none' }),
  }), ['asset.inspect', 'session.list_nodes', 'garment.classify', 'cutout.prepare'])
})

test('规划型 blockers 保留有人工闸门的 create dry-run，不开放真实副作用工具', () => {
  const expected = [
    'asset.inspect',
    'session.list_nodes',
    'garment.classify',
    'fashion_photo.create',
    'photo_fission.create',
    'pose_fission.create',
    'garment_detail.create',
  ]
  for (const blocker of [
    'feature_required',
    'model_required',
    'single_approval_scope_required',
    'multi_action_scope_required',
  ]) {
    const needsMechanicalInput = blocker === 'feature_required' || blocker === 'model_required'
    assert.deepEqual(names({
      allowed: true,
      stage: 'plan',
      route: route({
        lane: 'structured_decision',
        mechanicalReady: !needsMechanicalInput,
        humanGate: 'before_plan_confirm',
        blockers: [blocker],
      }),
    }), expected)
  }

  assert.deepEqual(names({
    allowed: true,
    stage: 'plan',
    route: route({
      lane: 'structured_decision',
      mechanicalReady: false,
      humanGate: 'none',
      blockers: ['feature_required'],
    }),
  }), ['asset.inspect', 'session.list_nodes', 'garment.classify'])
})

test('机械未就绪、硬 blocker 及未知或冲突证据不开放动作工具', () => {
  const blockedRoutes: AgentRouteDecision[] = [
    route({ mechanicalReady: false }),
    route({ blockers: ['asset_ownership_required'] }),
    route({ mechanicalReady: false, blockers: ['feature_required', 'asset_ownership_required'] }),
    route({ evidenceState: 'unknown', blockers: ['feature_required'] }),
    route({ evidenceState: 'conflict', blockers: ['multi_action_scope_required'] }),
  ]
  for (const blockedRoute of blockedRoutes) {
    assert.deepEqual(names({
      allowed: true,
      stage: 'plan',
      route: blockedRoute,
    }), ['asset.inspect', 'session.list_nodes', 'garment.classify'])
  }
})


test('真实 C10 抠图路由与诚实 governed metadata 在 C2 前沿一致', () => {
  const actualRegistry = new ToolRegistry(GOVERNED_TOOL_METADATA)
  const actualRoute = routeAgentRequest({
    text: '把当前衣服抠出来',
    selectedAssetIds: ['asset_1'],
  })
  const cutout = actualRegistry.get('cutout.prepare')
  assert.ok(cutout)
  assert.equal(cutout.sideEffectClass, 'external_irreversible')
  assert.equal(cutout.rollbackCapability, 'irreversible_after_submit')
  assert.equal(actualRoute.intent, 'edit')
  assert.equal(actualRoute.costClass, 'vendor_api')
  assert.equal(actualRoute.lane, 'structured_decision')
  assert.equal(actualRoute.mechanicalReady, true)
  assert.deepEqual(selectToolFrontier(actualRegistry, {
    allowed: true,
    allowedToolNames: GOVERNED_TOOL_METADATA.map((tool) => tool.name),
    stage: 'plan',
    purpose: 'cutout',
    route: actualRoute,
  }).map((tool) => tool.name), ['garment.classify', 'cutout.prepare'])
})
