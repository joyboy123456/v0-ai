import assert from 'node:assert/strict'
import test from 'node:test'
import { assetDigest, requestDigest } from '@/lib/agent/contracts'
import type { GarmentObservation } from '@/lib/agent/types'
import type { AssetRecord } from '@/lib/types'
import type { QueryPort } from '../ports'
import { buildContextSnapshot, type TriageInput } from '../perception/context-triage'
import { routeAgentRequest } from '../reasoning/router'
import { ReadToolRunner, READ_TOOL_METADATA, GARMENT_CLASSIFY_TOOL_METADATA, resolveContextHandle } from './read-tool-runner'
import { CREATE_TASK_TOOL_METADATA, createTaskPreparation } from './task-preparation'
import { createLocalPreparationNormalizers } from './preparation-normalizers'
import { ToolRegistry } from './tool-registry'
import { ToolDispatcher } from './tool-dispatch'
import { selectToolFrontier } from './tool-frontier'

const scope = { userId: 'integration_user', sessionId: 'integration_session', messageId: 'integration_message' }
const now = new Date('2026-09-17T00:00:00.000Z')

function fixture() {
  const asset: AssetRecord = { assetId: 'asset_1', userId: scope.userId, projectId: 'project_1',
    fileName: 'sample.png', fileUrl: 'https://private.invalid/signed?token=secret_marker', fileType: 'image/png',
    width: 800, height: 1200, createdAt: now.toISOString(), taskId: null }
  const session = { sessionId: scope.sessionId, userId: scope.userId,
    nodes: [{ id: 'node_1', assetId: asset.assetId, name: '服装主图' }], taskIds: [] }
  let observation: GarmentObservation | undefined
  const query: QueryPort = {
    async getAsset(id) { return id === asset.assetId ? asset : undefined },
    async getTask() { return undefined },
    async getSession(id) { return id === session.sessionId ? session : undefined },
    async getObservation() { return observation ? { observerVersion: 'observer_v1', observation } : null },
  }
  const registry = new ToolRegistry([...READ_TOOL_METADATA, GARMENT_CLASSIFY_TOOL_METADATA, ...CREATE_TASK_TOOL_METADATA])
  return { asset, session, query, registry, setObservation(value: GarmentObservation) { observation = value } }
}

function triageInput(): TriageInput {
  return { ...scope, observerVersion: 'observer_v1', tokenBudget: 3000,
    goal: { goalId: 'goal_1', userGoal: '保持服装细节', constraints: ['生成前确认'] },
    taskStatus: { summary: '尚未执行', currentStepId: '', status: 'NOT_STARTED' },
    failureEvidence: [], platformRules: ['付费调用必须经过审批'], settings: {}, nodes: [], messages: [] }
}

test('B5→C3：冷素材 handle 可查询，撤销会话成员关系后立即失效', async () => {
  const f = fixture()
  const input = triageInput()
  input.nodes = [{ nodeId: 'node_1', assetId: f.asset.assetId, assetDigest: await assetDigest(f.asset), selected: false }]
  const snapshot = buildContextSnapshot(input)
  const handle = snapshot.p3.handles.find((entry) => entry.kind === 'asset')!
  const result = await resolveContextHandle(handle, scope, f.query, { now: () => now })
  assert.ok(JSON.stringify(result).includes(f.asset.assetId))
  assert.equal(JSON.stringify(result).includes('secret_marker'), false)
  f.session.nodes = []
  await assert.rejects(resolveContextHandle(handle, scope, f.query, { now: () => now }))
})

test('B5→C3：观察引用绑定当前摘要、观察器版本和24小时有效期', async () => {
  const f = fixture()
  const observation: GarmentObservation = { assetId: f.asset.assetId, assetDigest: await assetDigest(f.asset),
    observedAt: now.toISOString(), observerModel: 'deterministic_v1', origin: 'image_observation',
    subject: 'unknown', category: 'unknown', dominantColors: [], silhouette: '', keyDetails: [],
    hasVisibleText: false, hasFace: false, quality: { blurry: false, lowResolution: false, watermark: false },
    confidence: 0, notes: '未检测不代表不存在' }
  f.setObservation(observation)
  const input = triageInput()
  input.nodes = [{ nodeId: 'node_1', assetId: f.asset.assetId, assetDigest: observation.assetDigest,
    selected: true, observation }]
  const handle = buildContextSnapshot(input).p3.handles.find((entry) => entry.kind === 'observation')!
  const result = await resolveContextHandle(handle, scope, f.query, { now: () => now })
  assert.ok(JSON.stringify(result).includes('image_observation'))
  assert.equal(await resolveContextHandle({ ...handle, observerVersion: 'wrong_version' }, scope, f.query, { now: () => now }), null)
  assert.equal(await resolveContextHandle(handle, scope, f.query,
    { now: () => new Date(now.getTime() + 24 * 60 * 60_000) }), null)
})

test('C5→C3：真实元数据和服务端绑定可进入只读 runner，分类仍进入 Gateway', async () => {
  const f = fixture()
  const dispatcher = new ToolDispatcher({ registry: f.registry, scope })
  const context = { ...scope, idempotencyKey: 'request_1', assetIds: { value: ['asset_1'], origin: 'user_selection' as const } }
  const inspected = dispatcher.dispatch({ proposal: { toolName: 'asset.inspect' }, context, frontier: f.registry.list() })
  assert.equal(inspected.status, 'admitted')
  const runner = new ReadToolRunner({ query: f.query, registry: f.registry, now: () => now })
  const result = await runner.runAdmitted(inspected, scope)
  assert.ok(JSON.stringify(result).includes('asset_1'))
  assert.equal(JSON.stringify(result).includes('secret_marker'), false)
  const classify = dispatcher.dispatch({ proposal: { toolName: 'garment.classify' }, context, frontier: f.registry.list() })
  assert.equal(classify.status, 'admitted')
  if (classify.status === 'admitted') assert.equal(classify.target, 'gateway')
  await assert.rejects(runner.runAdmitted(classify, scope))
  f.asset.userId = 'another_user'
  await assert.rejects(runner.runAdmitted(inspected, scope))
})

test('C10→C2→C5→C4：单图进入可验证预览并稳定重放，不触发图片请求', async (t) => {
  let imageRequests = 0
  t.mock.method(globalThis, 'fetch', async () => { imageRequests++; throw new Error('验收禁止图片请求') })
  const f = fixture()
  const route = routeAgentRequest({ text: '请生成一张自然光服装主图', selectedAssetIds: ['asset_1'] })
  const frontier = selectToolFrontier(f.registry, { allowed: true, stage: 'plan', route })
  const dispatcher = new ToolDispatcher({ registry: f.registry, scope })
  const dispatched = dispatcher.dispatch({ proposal: { toolName: 'fashion_photo.create', prompt: '自然光展示，保留服装细节' },
    context: { ...scope, idempotencyKey: 'preview_1', assetIds: { value: ['asset_1'], origin: 'user_selection' } }, frontier })
  assert.equal(dispatched.status, 'awaiting_approval')
  if (dispatched.status !== 'awaiting_approval' || dispatched.proposal.kind !== 'generation') assert.fail('预览准入失败')
  const bound = dispatched.proposal
  const preparation = createTaskPreparation({ assets: f.query, tasks: f.query,
    normalizers: createLocalPreparationNormalizers({ poses: { async getPoseTemplate() { return undefined } },
      async resolveGarmentDetailModel() { throw new Error('此分支不需要动态模型解析') } }),
    availability: { async isFeatureAvailable() { return true }, async isModelAvailable() { return true } }, now: () => now })
  const context = { ...scope, proposalId: 'proposal_1', version: 1, selectedAssetIds: [...bound.assetIds],
    settings: { model: bound.model, imageRatio: bound.imageRatio, resolution: bound.resolution, resultCount: bound.resultCount } }
  const input = { toolName: bound.toolName, args: { prompt: bound.prompt } }
  const preview = await preparation.prepare(input, context)
  await preparation.validatePrepared(preview)
  const replay = await preparation.prepare(input, context)
  assert.equal(await requestDigest({ actionKind: 'generate', payload: preview }), await requestDigest({ actionKind: 'generate', payload: replay }))
  assert.equal(preview.estimatedResultCount, 1)
  assert.deepEqual(preview.blockers, [])
  assert.equal(imageRequests, 0)
})
