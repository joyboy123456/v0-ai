import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { DEFAULT_FASHION_MODEL } from '@/lib/types'
import type { AgentToolMeta } from '@/lib/agent/types'
import { routeAgentRequest } from '../reasoning/router'
import { bindToolProposal, type ServerBindingContext } from './provenance'
import { ToolRegistry } from './tool-registry'
import { selectToolFrontier } from './tool-frontier'
import { ToolDispatcher } from './tool-dispatch'

function metadata(name: string, overrides: Partial<AgentToolMeta> = {}): AgentToolMeta {
  return { name, description: name, whenToUse: '匹配用户当前意图时', whenNotToUse: ['非当前意图时'],
    inputSchema: z.object({}).strict(), readOnly: true, costClass: 'free', sideEffectClass: 'none',
    approvalPolicy: 'none', requiresFreshState: true, quotaPerTurn: 1, rollbackCapability: 'none', ...overrides }
}

const registry = new ToolRegistry([
  metadata('asset.inspect'), metadata('session.list_nodes'), metadata('task.get_status'),
  metadata('garment.classify', { costClass: 'vendor_api', approvalPolicy: 'explicit_user_intent' }),
  metadata('cutout.prepare', { readOnly: false, costClass: 'vendor_api', sideEffectClass: 'local_write',
    approvalPolicy: 'explicit_user_intent', rollbackCapability: 'local_polling_only' }),
  metadata('task.cancel', { readOnly: false, sideEffectClass: 'local_write',
    approvalPolicy: 'explicit_user_intent', rollbackCapability: 'local_polling_only' }),
  metadata('fashion_photo.create', { featureType: 'ai-fashion-photo', readOnly: false,
    inputSchema: z.object({ prompt: z.string() }).strict(), costClass: 'paid_generation',
    sideEffectClass: 'external_irreversible', approvalPolicy: 'preview_confirmation', rollbackCapability: 'irreversible_after_submit' }),
])

const context: ServerBindingContext = { userId: 'user_1', sessionId: 'session_1', messageId: 'message_1',
  idempotencyKey: 'proposal:1', assetIds: { value: ['asset_1'], origin: 'user_selection' } }

test('明确生图意图可先选择 dry-run 工具，再绑定机械参数，不要求用户先选表单功能', () => {
  const route = routeAgentRequest({ text: '请生成一张自然光服装主图', selectedAssetIds: ['asset_1'] })
  assert.equal(route.mechanicalReady, false)
  assert.equal(route.evidenceState, 'ready')
  assert.equal(route.humanGate, 'before_plan_confirm')
  const tools = selectToolFrontier(registry, { allowed: true, stage: 'plan', route })
  assert.ok(tools.some((tool) => tool.name === 'fashion_photo.create'))
  const proposal = bindToolProposal({ toolName: 'fashion_photo.create', prompt: '保留参考服装，自然光展示' }, context, (name) => registry.get(name))
  assert.equal(proposal.kind, 'generation')
  if (proposal.kind !== 'generation') return
  assert.equal(proposal.featureType, 'ai-fashion-photo')
  assert.equal(proposal.model, DEFAULT_FASHION_MODEL)
  assert.equal(proposal.resultCount, 1)
  assert.equal(proposal.origins.featureType, 'system_policy')
  assert.deepEqual(proposal.assetIds, ['asset_1'])
})

test('礼貌抠图与取消请求保留对应受控工具，抠图前沿没有生图工具', () => {
  const route = routeAgentRequest({ text: '能不能帮我把这张衣服抠出来', selectedAssetIds: ['asset_1'] })
  const tools = selectToolFrontier(registry, { allowed: true, stage: 'plan', purpose: 'cutout', route })
  assert.ok(tools.some((tool) => tool.name === 'cutout.prepare'))
  assert.equal(tools.some((tool) => tool.name.endsWith('.create')), false)
  assert.equal(bindToolProposal({ toolName: 'cutout.prepare' }, context, (name) => registry.get(name)).kind, 'utility')
  const cancellation = routeAgentRequest({ text: '取消当前生成任务', selectedAssetIds: [], task: { taskId: 'task_1', status: 'running' } })
  assert.ok(selectToolFrontier(registry, { allowed: true, stage: 'waiting', route: cancellation })
    .some((tool) => tool.name === 'task.cancel'))
})

test('咨询、否定取消、缺失参考和硬权限不能通过完整路由前沿链取得动作', () => {
  for (const route of [
    routeAgentRequest({ text: '生图怎么收费', selectedAssetIds: ['asset_1'] }),
    routeAgentRequest({ text: '不取消当前任务', selectedAssetIds: [], task: { taskId: 'task_1', status: 'running' } }),
    routeAgentRequest({ text: '生成一张服装主图', selectedAssetIds: [] }),
  ]) {
    assert.deepEqual(selectToolFrontier(registry, { allowed: true, stage: 'plan', route }), [])
    assert.deepEqual(selectToolFrontier(registry, { allowed: true, stage: 'waiting', route }), [])
  }
  const route = routeAgentRequest({ text: '生成一张主图', selectedAssetIds: ['asset_1'] })
  assert.deepEqual(selectToolFrontier(registry, { allowed: false, stage: 'plan', route }), [])
  assert.deepEqual(selectToolFrontier(registry, { allowed: true, stage: 'plan', route, allowedToolNames: [] }), [])
})

test('路由、前沿、来源与调度连通后，生图仍只进入预览而非直接执行', () => {
  const route = routeAgentRequest({ text: '请生成一张服装主图', selectedAssetIds: ['asset_1'] })
  const frontier = selectToolFrontier(registry, { allowed: true, stage: 'plan', route })
  const dispatcher = new ToolDispatcher({ registry, scope: context })
  const forged = dispatcher.dispatch({ proposal: { toolName: 'fashion_photo.create', prompt: '展示服装', resultCount: 10 }, context, frontier })
  assert.deepEqual(forged, { status: 'rejected', reason: 'provenance_violation' })
  const accepted = dispatcher.dispatch({ proposal: { toolName: 'fashion_photo.create', prompt: '展示服装' }, context, frontier })
  assert.equal(accepted.status, 'awaiting_approval')
  if (accepted.status !== 'awaiting_approval') return
  assert.equal(accepted.target, 'preview')
  assert.equal(accepted.proposal.kind, 'generation')
  assert.deepEqual(dispatcher.dispatch({ proposal: { toolName: 'fashion_photo.create', prompt: '展示服装' }, context, frontier }),
    { status: 'rejected', reason: 'turn_budget_exceeded' })
})

test('受控抠图不会因调度准入通过就被当作免费本地工具执行', () => {
  const route = routeAgentRequest({ text: '把衣服抠出来', selectedAssetIds: ['asset_1'] })
  const frontier = selectToolFrontier(registry, { allowed: true, stage: 'plan', route, purpose: 'cutout' })
  const dispatcher = new ToolDispatcher({ registry, scope: context })
  const result = dispatcher.dispatch({ proposal: { toolName: 'cutout.prepare' }, context, frontier })
  assert.equal(result.status, 'admitted')
  if (result.status !== 'admitted') return
  assert.equal(result.target, 'gateway')
  assert.equal(result.proposal.kind, 'utility')
})
