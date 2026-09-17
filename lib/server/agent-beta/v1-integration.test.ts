import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { assetDigest, paramsDigest, requestDigest, type GovernedAction } from '@/lib/agent/contracts'
import { PREVIEW_TTL_MS } from '@/lib/agent/budget'
import type { JsonValue } from '@/lib/agent/types'
import { DEFAULT_FASHION_MODEL, type AssetRecord, type GenerationTask } from '@/lib/types'
import { AgentBetaRepository } from './repository'
import { AgentBetaService } from './service'
import { AgentBetaError } from './validation'
import { createAgentBetaV1Bridge, type AgentBetaV1StoredSession } from './v1-service'
import { V1TurnRepository } from './v1-turn-repository'
import { createTaskPreparation } from '../agent/action/task-preparation'
import { createLocalPreparationNormalizers } from '../agent/action/preparation-normalizers'
import { ToolRegistry } from '../agent/action/tool-registry'
import { READ_TOOL_METADATA } from '../agent/action/read-tool-runner'
import { GOVERNED_TOOL_METADATA } from '../agent/action/governed-tool-actions'
import { TASK_PREPARATION_TOOL_METADATA } from '../agent/action/task-preparation'
import { AgentEventStore, type ModelRequestSnapshot } from '../agent/observability/event-store'
import { ActionLedgerStore } from '../agent/governance/action-ledger'
import { ApprovalStore, createApprovalEvidenceStore, type AuthenticatedActionScope, type AuthenticatedUserIntent } from '../agent/governance/approval-store'
import { createGovernanceGateway } from '../agent/governance/gateway'
import { FileTaskPreparationArtifactStore } from '../agent/governance/preparation-artifact-store'
import { createPostSubmitVerifier, createResultAdmission, createResultAdmissionEvidenceStore } from '../agent/governance/result-admission'
import { createTaskAdapter, createVendorActionAdapter, preparedTaskControls } from '../agent/governance/task-adapter'
import type { AgentModelPort, QueryPort } from '../agent/ports'

const startedAt = new Date('2026-09-17T03:00:00.000Z')

function understanding(content = '已理解当前单张服饰创作请求') {
  return {
    kind: 'understanding' as const,
    content,
    goal: '按当前服务端配置准备方案',
    constraints: ['必须先预览再确认'],
    evidenceRefs: [],
    uncertainties: [],
    questions: [],
  }
}

function toolResult(content = '只读工具结果已整理') {
  return {
    kind: 'tool_result' as const,
    content,
    evidenceRefs: [],
    uncertainties: [],
    blockers: [],
    next: 'answer' as const,
  }
}

function plan(tool: string, args: Record<string, JsonValue>) {
  return {
    kind: 'plan' as const,
    content: '准备服务端可核验的方案',
    claims: [],
    proposedToolCalls: [{ tool, args, dryRun: true as const }],
    blockers: [],
  }
}

function taskIdFor(userId: string, key: string): string {
  return `task_idem_${createHash('sha256').update(JSON.stringify([userId, key])).digest('hex')}`
}

interface Fixture {
  directory: string
  userId: string
  assets: Map<string, AssetRecord>
  tasks: Map<string, GenerationTask>
  outputs: JsonValue[]
  modelCalls: ModelRequestSnapshot[]
  counts: { create: number; retry: number; cancel: number; vendor: number; legacyPlan: number }
  setFlag(value: boolean): void
  setThrowAfterCreate(value: boolean): void
  advance(ms: number): void
  holdNextCreate(): () => void
  makeService(options?: { withoutV1?: boolean }): AgentBetaService
}

async function fixture(t: TestContext): Promise<Fixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-beta-c13-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const userId = 'user_1'
  const inputAsset: AssetRecord = {
    assetId: 'asset_input', userId, projectId: 'project_1', fileName: 'garment.png',
    fileUrl: 'https://assets.example.test/garment.png', fileType: 'image/png',
    width: 1200, height: 1600, createdAt: startedAt.toISOString(), taskId: null,
  }
  const assets = new Map([[inputAsset.assetId, inputAsset]])
  const tasks = new Map<string, GenerationTask>()
  const outputs: JsonValue[] = []
  const modelCalls: ModelRequestSnapshot[] = []
  const counts = { create: 0, retry: 0, cancel: 0, vendor: 0, legacyPlan: 0 }
  let enabled = true
  let throwAfterCreate = false
  let createGate: Promise<void> | undefined
  let time = startedAt.getTime()
  const now = () => new Date(time)
  const getAsset = async (assetId: string) => {
    const asset = assets.get(assetId)
    return asset ? structuredClone(asset) : undefined
  }
  const getTask = async (taskId: string) => {
    const task = tasks.get(taskId)
    return task ? structuredClone(task) : undefined
  }
  const availability = {
    async isFeatureAvailable() { return true },
    async isModelAvailable() { return true },
  }
  const artifacts = new FileTaskPreparationArtifactStore(directory)
  const normalizers = createLocalPreparationNormalizers({
    poses: { async getPoseTemplate() { return undefined } },
    async resolveGarmentDetailModel(algorithmModelId) {
      return {
        definition: { algorithmModelId, algorithmModelName: '专业版', tier: 'professional' as const, resolutions: ['2k', '4k'] as const },
        resolvedModelId: DEFAULT_FASHION_MODEL,
      }
    },
  })
  const preparation = createTaskPreparation({
    assets: { getAsset }, tasks: { getTask }, normalizers, availability, store: artifacts,
    taskControls: preparedTaskControls, now,
  })
  const rawCommands = {
    async createPreparedTask(preview: Parameters<ReturnType<typeof createTaskAdapter>['createPreparedTask']>[0], key: string) {
      counts.create += 1
      if (createGate) {
        const pendingGate = createGate
        createGate = undefined
        await pendingGate
      }
      const fullDigest = await requestDigest({ actionKind: 'generate', payload: preview })
      const task: GenerationTask = {
        taskId: taskIdFor(preview.userId, key), userId: preview.userId,
        featureType: preview.featureType, workflowId: 'workflow_c13',
        inputAssetIds: [...preview.inputAssetIds], params: structuredClone(preview.normalizedParams),
        status: 'pending', progress: 0, message: '排队中', resultAssetIds: [], results: [],
        createdAt: now().toISOString(), creditsUsed: 0,
        agentExecution: {
          schemaVersion: 1, paramsDigest: preview.paramsDigest, assetDigests: [...preview.assetDigests],
          resolvedModelId: preview.resolvedModelId!, promptTemplateVersion: preview.promptTemplateVersion!,
          normalizationSeed: preview.normalizationSeed, requestDigest: fullDigest, idempotencyKey: key,
          attempts: [{ actionKind: 'generate', requestDigest: fullDigest, idempotencyKey: key,
            shotIds: [], attempt: null, priorResultAssetIds: [] }],
        },
      }
      tasks.set(task.taskId, task)
      if (throwAfterCreate) throw new Error('provider raw error must not escape')
      return structuredClone(task)
    },
    async retryPreparedShots(preview: Parameters<ReturnType<typeof createTaskAdapter>['retryPreparedShots']>[0], key: string) {
      counts.retry += 1
      const current = tasks.get(preview.taskId)
      if (!current) throw new Error('missing task')
      const fullDigest = await requestDigest({ actionKind: 'retry_shots', payload: preview })
      const priorResultAssetIds = [...current.resultAssetIds]
      const next: GenerationTask = {
        ...current,
        status: 'pending', progress: current.progress, message: '已批准重试，等待执行',
        shotProgress: current.shotProgress?.map((shot) => preview.shotIds.includes(shot.shotId)
          ? { ...shot, status: 'retrying' as const, retryAttempt: preview.attempt } : shot),
        agentExecution: {
          schemaVersion: 1, paramsDigest: preview.paramsDigest, assetDigests: [...preview.assetDigests],
          resolvedModelId: preview.resolvedModelId!, promptTemplateVersion: preview.promptTemplateVersion!,
          normalizationSeed: current.agentExecution?.normalizationSeed ?? null,
          requestDigest: fullDigest, idempotencyKey: key,
          attempts: [...(current.agentExecution?.attempts ?? []), {
            actionKind: 'retry_shots', requestDigest: fullDigest, idempotencyKey: key,
            shotIds: [...preview.shotIds], attempt: preview.attempt, priorResultAssetIds,
          }],
        },
      }
      tasks.set(next.taskId, next)
      return structuredClone(next)
    },
    async cancelTask(taskId: string, owner: string) {
      counts.cancel += 1
      const current = tasks.get(taskId)
      if (!current || current.userId !== owner) throw new Error('missing task')
      const next = { ...current, status: 'cancelled' as const, message: '任务已取消' }
      tasks.set(taskId, next)
      return structuredClone(next)
    },
  }
  const commands = createTaskAdapter({
    preparation, queries: { getAsset, getTask }, commands: rawCommands, availability,
  })
  const vendors = createVendorActionAdapter({
    assets: { getAsset },
    async classify(payload) {
      counts.vendor += 1
      return { status: 'classified', assetId: payload.assetId, category: 'tops', confidence: 0.9 }
    },
    async prepareCutout(payload) {
      counts.vendor += 1
      return { cutoutSessionId: `cutout_${payload.assetId}`, preparedImageUrl: '/ignored' }
    },
  })
  const approvalEvidence = createApprovalEvidenceStore(directory)
  const evidence = createResultAdmissionEvidenceStore(directory, { now })
  const postSubmit = createPostSubmitVerifier({ artifacts, approvals: approvalEvidence, evidence })
  const resultAdmission = createResultAdmission({
    tasks: { getTask }, assets: { getAsset }, artifacts, approvals: approvalEvidence, evidence, now,
  })
  const model: AgentModelPort = {
    async invoke(request) {
      modelCalls.push(structuredClone(request))
      const value = outputs.shift()
      if (value === undefined) throw new Error('missing model output')
      return structuredClone(value)
    },
  }
  const registry = new ToolRegistry([
    ...READ_TOOL_METADATA, ...GOVERNED_TOOL_METADATA, ...TASK_PREPARATION_TOOL_METADATA,
  ])

  function makeService(options: { withoutV1?: boolean } = {}): AgentBetaService {
    const repository = new AgentBetaRepository(directory, { getTask })
    const ledger = new ActionLedgerStore(directory, { getTask })
    const eventStore = new AgentEventStore(directory)
    const sessions = {
      async getSession(owner: string, sessionId: string): Promise<AgentBetaV1StoredSession | undefined> {
        const file = await repository.readUser(owner)
        const session = file.sessions.find((candidate) => candidate.id === sessionId)
        return session ? {
          id: session.id,
          nodes: session.nodes.map((node) => ({ ...node })),
          messages: session.messages.map((message) => structuredClone(message)),
        } : undefined
      },
    }
    const bridge = createAgentBetaV1Bridge({
      enabled: () => enabled,
      turns: new V1TurnRepository(directory), sessions,
      queries: {
        getAsset, getTask,
        async getObservation(scope) {
          const asset = await getAsset(scope.assetId)
          if (!asset || asset.userId !== scope.userId) return null
          return { observerVersion: scope.observerVersion, observation: await observe(scope.userId, asset) }
        },
      },
      async observe(scope) {
        const asset = await getAsset(scope.assetId)
        if (!asset || asset.userId !== scope.userId) throw new Error('missing asset')
        return observe(scope.userId, asset)
      },
      preparation, artifacts, registry, observability: eventStore, model,
      resolvePlanner: () => ({ model: 'mock-planner-v1', parameters: { temperature: 0, response_format: { type: 'json_object' } } }),
      governance(scope: AuthenticatedActionScope, intent?: AuthenticatedUserIntent, query?: QueryPort) {
        const fixedScope = structuredClone(scope)
        const fixedIntent = intent ? structuredClone(intent) : undefined
        const approvals = new ApprovalStore(directory, {
          authenticate: async () => structuredClone(fixedScope),
          readAuthenticatedIntent: async () => {
            if (!fixedIntent) throw new Error('missing intent')
            return structuredClone(fixedIntent)
          },
          artifacts, preparation, now,
        })
        assert.ok(query)
        const actions = createGovernanceGateway({
          queries: query, commands, vendors, preparation, artifacts, approvals, ledger, postSubmit,
          authenticate: async () => structuredClone(fixedScope), getTaskId: taskIdFor,
          assertQueueCapacity: () => undefined, isTaskExecutionActive: () => false,
          contentPolicy: async () => ({ allowed: true }), now,
        })
        return { approvals, actions }
      },
      now,
    })
    return new AgentBetaService(repository, {
      getAsset, getTask,
      async createTask() { throw new Error('legacy create forbidden in v1 test') },
      async cancelTask(taskId, owner) { return rawCommands.cancelTask(taskId, owner) },
      getTaskId: taskIdFor, isTaskExecutionActive: () => false, assertQueueCapacity: () => undefined,
      resultAdmission, ...(options.withoutV1 ? {} : { v1: bridge }),
      async plan() {
        counts.legacyPlan += 1
        return { kind: 'clarify', content: 'legacy clarification', prompt: null }
      },
      now,
    })
  }

  async function observe(owner: string, asset: AssetRecord) {
    const digestValue = await assetDigest(asset)
    return {
      assetId: asset.assetId, assetDigest: digestValue, observedAt: now().toISOString(),
      observerModel: 'deterministic-v1', origin: 'image_observation' as const,
      subject: 'unknown' as const, category: 'unknown' as const, dominantColors: [], silhouette: '', keyDetails: [],
      hasVisibleText: false, hasFace: false,
      quality: { blurry: false, lowResolution: false, watermark: false }, confidence: 0,
      notes: `owner:${owner}; metadata-only test observation`,
    }
  }

  return {
    directory, userId, assets, tasks, outputs, modelCalls, counts,
    setFlag(value) { enabled = value },
    setThrowAfterCreate(value) { throwAfterCreate = value },
    advance(ms) { time += ms },
    holdNextCreate() {
      let release!: () => void
      createGate = new Promise<void>((resolve) => { release = resolve })
      return release
    },
    makeService,
  }
}

async function createSessionWithAsset(f: Fixture) {
  const service = f.makeService()
  let session = await service.createSession(f.userId)
  session = await service.addAssets(f.userId, session.id, { assetIds: ['asset_input'] })
  return { service, session, nodeId: session.nodes[0].id }
}

function currentPlan(session: Awaited<ReturnType<AgentBetaService['getSession']>>) {
  const message = [...session.messages].reverse().find((candidate) => candidate.plan)
  assert.ok(message?.plan)
  return { message, plan: message.plan }
}

async function createPendingGeneration(f: Fixture, clientMessageId: string) {
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: `安全测试 ${clientMessageId}` }))
  let session = await service.sendMessage(f.userId, created.id, {
    clientMessageId, text: '生成一张安全测试图', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  const preview = currentPlan(session)
  session = await service.execute(f.userId, created.id, {
    messageId: preview.message.id,
    proposalId: preview.plan.preview!.proposalId,
    previewVersion: preview.plan.preview!.version,
    previewDigest: preview.plan.preview!.digest,
  })
  const submitted = currentPlan(session)
  return {
    service,
    sessionId: created.id,
    messageId: submitted.message.id,
    taskId: submitted.plan.task!.taskId,
  }
}

test('C13 完整链：C9→C4 preview→edit v2→stale拒绝→Approval/C7 pending→C8 ADMITTED→画布', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(
    understanding(),
    plan('fashion_photo.create', { prompt: '自然光电商展示，保持服装结构' }),
  )
  const request = {
    clientMessageId: 'client_message_1', text: '请生成一张自然光服装展示图',
    referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  }
  let session = await service.sendMessage(f.userId, created.id, request)
  let current = currentPlan(session)
  assert.equal(current.plan.protocol, 'agent-runtime-v1')
  assert.equal(current.plan.preview?.version, 1)
  assert.equal(current.plan.preview?.resolvedModelId, DEFAULT_FASHION_MODEL)
  assert.equal(current.plan.preview?.estimatedResultCount, 1)
  assert.equal(current.plan.preview?.confirmable, true)
  const publicSession = JSON.stringify(session)
  for (const forbidden of ['normalizedParams', 'assetDigests', 'approvalId', 'intentId', 'requestIds', 'budget']) {
    assert.equal(publicSession.includes(forbidden), false, `公开 session 不应包含 ${forbidden}`)
  }
  assert.equal(f.modelCalls.length, 2)
  assert.equal(f.counts.create, 0)

  const previewV1 = structuredClone(current.plan.preview!)
  const promptV1 = current.plan.prompt
  const stale = {
    messageId: current.message.id,
    proposalId: current.plan.preview!.proposalId,
    previewVersion: current.plan.preview!.version,
    previewDigest: current.plan.preview!.digest,
  }
  f.setFlag(false)
  await assert.rejects(
    service.repreview(f.userId, created.id, { ...stale, prompt: promptV1 }),
    (error: unknown) => error instanceof AgentBetaError && error.code === 'AGENT_BETA_PREVIEW_UNCHANGED',
  )
  session = await service.repreview(f.userId, created.id, { ...stale, prompt: '柔和棚拍白底，保持服装结构' })
  current = currentPlan(session)
  assert.equal(current.plan.preview?.version, 2)
  assert.equal(current.plan.prompt, '柔和棚拍白底，保持服装结构')
  assert.equal(session.newProposalRuntime, 'legacy')
  assert.equal(f.modelCalls.length, 2, 'repreview 不调用模型')
  assert.equal(f.counts.create, 0, 'repreview 不提交任务')

  // 模拟工件 v2 已强写、但进程在 user-file 指针更新前退出；GET 必须从最新工件修复。
  await service.repository.mutateUser(f.userId, (file) => {
    const stored = file.sessions.find((candidate) => candidate.id === created.id)!
    const storedPlan = stored.messages.find((message) => message.id === current.message.id)!.plan!
    storedPlan.preview = previewV1
    storedPlan.prompt = promptV1
  })
  session = await f.makeService().getSession(f.userId, created.id)
  current = currentPlan(session)
  assert.equal(current.plan.preview?.version, 2)
  assert.equal(current.plan.prompt, '柔和棚拍白底，保持服装结构')

  await assert.rejects(
    service.execute(f.userId, created.id, stale),
    (error: unknown) => error instanceof AgentBetaError && error.code === 'AGENT_BETA_PREVIEW_CONFLICT',
  )
  assert.equal(f.counts.create, 0)

  const approved = {
    messageId: current.message.id,
    proposalId: current.plan.preview!.proposalId,
    previewVersion: current.plan.preview!.version,
    previewDigest: current.plan.preview!.digest,
  }
  session = await service.execute(f.userId, created.id, approved)
  current = currentPlan(session)
  assert.equal(f.counts.create, 1)
  assert.equal(current.plan.status, 'submitted')
  assert.equal(current.plan.resultAdmission?.state, 'pending')
  assert.equal(session.nodes.length, 1, 'pending 不上画布')
  const taskId = current.plan.task!.taskId

  const restarted = f.makeService()
  session = await restarted.execute(f.userId, created.id, approved)
  assert.equal(f.counts.create, 1, '跨 service/repository/store 重放不重复 Gateway command')
  assert.equal(f.modelCalls.length, 2)
  assert.equal(session.newProposalRuntime, 'legacy')

  await assert.rejects(
    restarted.getSession('user_2', created.id),
    (error: unknown) => error instanceof AgentBetaError && error.status === 404,
  )

  const resultAsset: AssetRecord = {
    assetId: 'asset_result_1', userId: f.userId, projectId: 'project_1', taskId,
    fileName: 'result.png', fileUrl: 'https://assets.example.test/result-v1.png', fileType: 'image/png',
    width: 1024, height: 1365, createdAt: new Date(startedAt.getTime() + 1_000).toISOString(),
  }
  f.assets.set(resultAsset.assetId, resultAsset)
  const task = f.tasks.get(taskId)!
  f.tasks.set(taskId, {
    ...task, status: 'success', progress: 100, message: '供应商完成',
    resultAssetIds: [resultAsset.assetId],
    results: [{ assetId: resultAsset.assetId, url: 'https://provider.invalid/result.png',
      downloadUrl: 'https://provider.invalid/result.png', width: 1, height: 1 }],
    finishedAt: new Date(startedAt.getTime() + 2_000).toISOString(),
  })
  session = await restarted.getSession(f.userId, created.id)
  current = currentPlan(session)
  assert.equal(current.plan.resultAdmission?.state, 'admitted')
  assert.equal(session.nodes.length, 2)
  assert.equal(session.nodes.find((node) => node.assetId === resultAsset.assetId)?.url, resultAsset.fileUrl)

  f.assets.set(resultAsset.assetId, { ...resultAsset, fileUrl: 'https://assets.example.test/result-v2-signed.png' })
  session = await f.makeService().getSession(f.userId, created.id)
  assert.equal(session.nodes.find((node) => node.assetId === resultAsset.assetId)?.url,
    'https://assets.example.test/result-v2-signed.png')
  const admittedNodeId = session.nodes.find((node) => node.assetId === resultAsset.assetId)!.id
  f.setFlag(true)
  f.outputs.push(
    understanding('核对已准入结果'),
    plan('asset.inspect', {}),
    toolResult('已准入结果可安全作为参考'),
  )
  await f.makeService().sendMessage(f.userId, created.id, {
    clientMessageId: 'client_reuse_admitted', text: '分析一下这张已生成图片', referenceNodeIds: [admittedNodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  assert.equal(f.modelCalls.length, 5)

  f.assets.set(resultAsset.assetId, { ...resultAsset, userId: 'user_2' })
  session = await f.makeService().getSession(f.userId, created.id)
  current = currentPlan(session)
  assert.equal(current.plan.resultAdmission?.state, 'quarantined')
  assert.equal(session.nodes.some((node) => node.assetId === resultAsset.assetId), false)
  await assert.rejects(
    f.makeService().sendMessage(f.userId, created.id, {
      clientMessageId: 'client_reuse_quarantined', text: '分析这张图', referenceNodeIds: [admittedNodeId],
      settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' },
    }),
    (error: unknown) => error instanceof AgentBetaError && error.code === 'AGENT_BETA_ASSET_NOT_FOUND',
  )
  assert.equal(f.modelCalls.length, 5)
})

test('flag 关闭只影响新提案：同会话 legacy/v1 混合且已有 v1 动作继续安全刷新', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: '单张方案' }))
  const v1Request = {
    clientMessageId: 'client_v1', text: '生成一张服装图', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '1:1' as const, resolution: '2k' as const },
  }
  let session = await service.sendMessage(f.userId, created.id, v1Request)
  assert.equal(currentPlan(session).plan.protocol, 'agent-runtime-v1')
  f.setFlag(false)
  session = await f.makeService().sendMessage(f.userId, created.id, {
    ...v1Request, clientMessageId: 'client_legacy', text: '只问一下当前支持什么',
  })
  assert.equal(f.counts.legacyPlan, 1)
  assert.equal(f.modelCalls.length, 2)
  assert.equal(session.messages.filter((message) => message.plan?.protocol === 'agent-runtime-v1').length, 1)

  session = await f.makeService().sendMessage(f.userId, created.id, v1Request)
  assert.equal(f.modelCalls.length, 2, '已有 v1 clientMessageId 即使 flag 关闭也从完成记录/会话重放')
  assert.equal(currentPlan(session).plan.protocol, 'agent-runtime-v1')
})

test('Gateway 调用后异常保留 UNKNOWN；刷新与重复确认不重提', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: '单张未知测试' }))
  let session = await service.sendMessage(f.userId, created.id, {
    clientMessageId: 'client_unknown', text: '生成一张测试图', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  const current = currentPlan(session)
  const confirmation = {
    messageId: current.message.id,
    proposalId: current.plan.preview!.proposalId,
    previewVersion: current.plan.preview!.version,
    previewDigest: current.plan.preview!.digest,
  }
  f.setThrowAfterCreate(true)
  await assert.rejects(service.execute(f.userId, created.id, confirmation), AgentBetaError)
  assert.equal(f.counts.create, 1)

  f.setFlag(false)
  session = await f.makeService().getSession(f.userId, created.id)
  const verifyingPlan = currentPlan(session).plan
  assert.equal(verifyingPlan.resultAdmission?.state, 'verifying')
  assert.equal(verifyingPlan.status, 'proposed')
  assert.equal(verifyingPlan.task, undefined)
  assert.equal(verifyingPlan.preview?.confirmable, false)
  assert.equal(session.nodes.length, 1)
  await assert.rejects(
    f.makeService().execute(f.userId, created.id, confirmation),
    (error: unknown) => error instanceof AgentBetaError
      && error.code === 'AGENT_BETA_ACTION_VERIFICATION_REQUIRED',
  )
  assert.equal(f.counts.create, 1)
  assert.equal(f.modelCalls.length, 2)
})

test('真实 C4/C7/C8 retry 新窗口只发布本轮新结果', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  const normalizers = createLocalPreparationNormalizers({
    poses: { async getPoseTemplate() { return undefined } },
    async resolveGarmentDetailModel() { throw new Error('unused') },
  })
  const normalized = await normalizers['photo-fission'].normalize({
    featureType: 'photo-fission', prompt: '原套图', inputAssetIds: ['asset_input'],
    normalizationSeed: 'a'.repeat(64), userId: f.userId,
    settings: {
      model: DEFAULT_FASHION_MODEL, category: 'childrens', childrensCategory: 'dress',
      hasFrontDetail: false, hasSideDetail: false, hasBackDetail: false,
      imageRatio: '3:4', resolution: '2k', resultCount: 2, plannerReasoningEnabled: false,
    },
  })
  const [successShot, failedShot] = (normalized.normalizedParams as Extract<typeof normalized.normalizedParams, { shotPlan: unknown }>).shotPlan
  const originalTaskId = 'task_photo_retry'
  const priorAsset: AssetRecord = {
    assetId: 'asset_prior', userId: f.userId, projectId: 'project_1', taskId: originalTaskId,
    fileName: 'prior.png', fileUrl: 'https://assets.example.test/prior.png', fileType: 'image/png',
    width: 1000, height: 1200, createdAt: startedAt.toISOString(),
  }
  f.assets.set(priorAsset.assetId, priorAsset)
  const digestValue = await paramsDigest('photo-fission', normalized.normalizedParams)
  const inputDigestValue = await assetDigest(f.assets.get('asset_input')!)
  f.tasks.set(originalTaskId, {
    taskId: originalTaskId, userId: f.userId, featureType: 'photo-fission', workflowId: 'workflow_retry',
    inputAssetIds: ['asset_input'], params: normalized.normalizedParams,
    status: 'partial', progress: 50, message: '一张失败',
    resultAssetIds: [priorAsset.assetId], results: [{
      assetId: priorAsset.assetId, shotId: successShot.shotId,
      url: 'https://provider.invalid/prior.png', downloadUrl: 'https://provider.invalid/prior.png',
      width: 1, height: 1,
    }],
    shotProgress: [
      { shotId: successShot.shotId, label: successShot.label, status: 'success', message: '已完成' },
      { shotId: failedShot.shotId, label: failedShot.label, status: 'failed', message: '失败' },
    ],
    createdAt: startedAt.toISOString(), creditsUsed: 0,
    agentExecution: {
      schemaVersion: 1, paramsDigest: digestValue, assetDigests: [inputDigestValue],
      resolvedModelId: normalized.resolvedModelId, promptTemplateVersion: normalized.promptTemplateVersion,
      normalizationSeed: 'a'.repeat(64), requestDigest: 'b'.repeat(64), idempotencyKey: 'original-key', attempts: [],
    },
  })
  await service.repository.mutateUser(f.userId, (file) => {
    const session = file.sessions.find((candidate) => candidate.id === created.id)!
    session.nodes.find((node) => node.id === nodeId)!.taskId = originalTaskId
  })
  f.outputs.push(plan('task.retry_shots', {}))
  let session = await service.sendMessage(f.userId, created.id, {
    clientMessageId: 'client_retry', text: '重试失败镜头', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  let current = currentPlan(session)
  assert.equal(current.plan.preview?.featureType, 'photo-fission')
  assert.equal(current.plan.preview?.estimatedResultCount, 1)
  assert.equal(current.plan.preview?.confirmable, true)
  const confirmation = {
    messageId: current.message.id, proposalId: current.plan.preview!.proposalId,
    previewVersion: current.plan.preview!.version, previewDigest: current.plan.preview!.digest,
  }
  session = await service.execute(f.userId, created.id, confirmation)
  assert.equal(f.counts.retry, 1)
  assert.equal(currentPlan(session).plan.resultAdmission?.state, 'pending')

  const retriedAsset: AssetRecord = {
    assetId: 'asset_retried', userId: f.userId, projectId: 'project_1', taskId: originalTaskId,
    fileName: 'retried.png', fileUrl: 'https://assets.example.test/retried.png', fileType: 'image/png',
    width: 1000, height: 1200, createdAt: new Date(startedAt.getTime() + 2_000).toISOString(),
  }
  f.assets.set(retriedAsset.assetId, retriedAsset)
  const task = f.tasks.get(originalTaskId)!
  f.tasks.set(originalTaskId, {
    ...task, status: 'success', progress: 100, message: '重试完成',
    resultAssetIds: [priorAsset.assetId, retriedAsset.assetId],
    results: [...task.results, {
      assetId: retriedAsset.assetId, shotId: failedShot.shotId,
      url: 'https://provider.invalid/retried.png', downloadUrl: 'https://provider.invalid/retried.png',
      width: 1, height: 1,
    }],
    shotProgress: task.shotProgress?.map((shot) => shot.shotId === failedShot.shotId
      ? { ...shot, status: 'success' as const, retryAttempt: 1 } : shot),
  })
  session = await f.makeService().getSession(f.userId, created.id)
  current = currentPlan(session)
  assert.equal(current.plan.resultAdmission?.state, 'admitted')
  assert.equal(session.nodes.some((node) => node.assetId === retriedAsset.assetId), true)
  assert.equal(session.nodes.some((node) => node.assetId === priorAsset.assetId), false,
    'retry 消息只发布当前 attempt 新窗口')
})


test('消息经真实 C9 多轮模型与只读工具，重放不重复模型或工具', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(
    understanding('先核对当前素材事实'),
    plan('asset.inspect', {}),
    toolResult('只读素材信息已核对，本轮没有提交生成'),
  )
  const request = {
    clientMessageId: 'client_read', text: '分析一下当前图片是否清晰', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  }
  let session = await service.sendMessage(f.userId, created.id, request)
  const assistant = session.messages.at(-1)!
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.plan, undefined)
  assert.equal(assistant.toolTrace?.some((entry) => entry.toolName === 'asset.inspect'
    && entry.status === 'completed'), true)
  assert.equal(f.modelCalls.length, 3)
  assert.equal(f.counts.create, 0)
  assert.equal(f.counts.vendor, 0)

  session = await f.makeService().sendMessage(f.userId, created.id, request)
  assert.equal(f.modelCalls.length, 3)
  assert.equal(session.messages.filter((message) => message.id === 'client_read').length, 1)
})

test('分类与服装抠图由当前认证文本签发真实 intent，回放不重复供应商动作', async (t) => {
  const f = await fixture(t)
  const first = await createSessionWithAsset(f)
  f.outputs.push(plan('garment.classify', {}))
  const classify = {
    clientMessageId: 'client_classify', text: '识别一下这件服装的类别', referenceNodeIds: [first.nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  }
  let session = await first.service.sendMessage(f.userId, first.session.id, classify)
  assert.equal(session.messages.at(-1)?.toolTrace?.some((entry) => entry.toolName === 'garment.classify'
    && entry.status === 'completed'), true)
  assert.equal(f.counts.vendor, 1)
  await f.makeService().sendMessage(f.userId, first.session.id, classify)
  assert.equal(f.counts.vendor, 1)

  const second = await createSessionWithAsset(f)
  f.outputs.push(plan('cutout.prepare', {}))
  const cutout = {
    clientMessageId: 'client_cutout', text: '请把这件服装抠图去背景', referenceNodeIds: [second.nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  }
  session = await second.service.sendMessage(f.userId, second.session.id, cutout)
  assert.equal(session.messages.at(-1)?.toolTrace?.some((entry) => entry.toolName === 'cutout.prepare'
    && entry.status === 'completed'), true)
  assert.equal(f.counts.vendor, 2)
  await f.makeService().sendMessage(f.userId, second.session.id, cutout)
  assert.equal(f.counts.vendor, 2)
})

test('当前 Beta 无法表达 garment/pose 专属配置时明确澄清，零模型且不静默改图像模型', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  const session = await service.sendMessage(f.userId, created.id, {
    clientMessageId: 'client_detail', text: '请生成一张高清放大细节图，使用标准版 1k', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  const assistant = session.messages.at(-1)!
  assert.equal(assistant.plan, undefined)
  assert.match(assistant.content, /缺少必要信息|无法继续/)
  assert.equal(f.modelCalls.length, 0)
  assert.equal(f.counts.create, 0)
})


test('已有 v1 pending 在新提案 flag 关闭后仍走真实 intent/C7 取消且幂等', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: '待取消单张' }))
  let session = await service.sendMessage(f.userId, created.id, {
    clientMessageId: 'client_cancel_source', text: '生成一张待取消图片', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  let current = currentPlan(session)
  session = await service.execute(f.userId, created.id, {
    messageId: current.message.id,
    proposalId: current.plan.preview!.proposalId,
    previewVersion: current.plan.preview!.version,
    previewDigest: current.plan.preview!.digest,
  })
  current = currentPlan(session)
  assert.equal(current.plan.task?.status, 'pending')
  f.setFlag(false)
  session = await f.makeService().cancel(f.userId, created.id, { messageId: current.message.id })
  assert.equal(f.counts.cancel, 1)
  assert.equal(currentPlan(session).plan.task?.status, 'cancelled')
  assert.equal(currentPlan(session).plan.resultAdmission?.resultCount ?? 0, 0)
  assert.equal(session.nodes.length, 1)
  await f.makeService().cancel(f.userId, created.id, { messageId: current.message.id })
  assert.equal(f.counts.cancel, 1)
})


test('真实组合对任务删除、参数篡改和已准入资源删除持续失败关闭', async (t) => {
  await t.test('task deleted keeps verifying and never resubmits', async (subtest) => {
    const f = await fixture(subtest)
    const pending = await createPendingGeneration(f, 'client_deleted_task')
    f.tasks.delete(pending.taskId)
    const session = await f.makeService().getSession(f.userId, pending.sessionId)
    assert.equal(currentPlan(session).plan.resultAdmission?.state, 'verifying')
    assert.equal(session.nodes.length, 1)
    assert.equal(f.counts.create, 1)
  })

  await t.test('task params tamper quarantines', async (subtest) => {
    const f = await fixture(subtest)
    const pending = await createPendingGeneration(f, 'client_tampered_task')
    const task = f.tasks.get(pending.taskId)!
    f.tasks.set(pending.taskId, {
      ...task,
      params: { ...task.params, imageRatio: '1:1' },
      status: 'success',
      progress: 100,
    } as GenerationTask)
    const session = await f.makeService().getSession(f.userId, pending.sessionId)
    assert.equal(currentPlan(session).plan.resultAdmission?.state, 'quarantined')
    assert.equal(session.nodes.length, 1)
    assert.equal(f.counts.create, 1)
  })

  await t.test('admitted asset deletion becomes quarantined and disappears', async (subtest) => {
    const f = await fixture(subtest)
    const pending = await createPendingGeneration(f, 'client_deleted_asset')
    const asset: AssetRecord = {
      assetId: 'asset_delete_after_admit', userId: f.userId, projectId: 'project_1', taskId: pending.taskId,
      fileName: 'safe.png', fileUrl: 'https://assets.example.test/safe.png', fileType: 'image/png',
      width: 1024, height: 1024, createdAt: startedAt.toISOString(),
    }
    f.assets.set(asset.assetId, asset)
    const task = f.tasks.get(pending.taskId)!
    f.tasks.set(pending.taskId, {
      ...task, status: 'success', progress: 100,
      resultAssetIds: [asset.assetId],
      results: [{ assetId: asset.assetId, url: 'https://provider.invalid/unsafe-source.png',
        downloadUrl: 'https://provider.invalid/unsafe-source.png', width: 1, height: 1 }],
    })
    let session = await f.makeService().getSession(f.userId, pending.sessionId)
    assert.equal(currentPlan(session).plan.resultAdmission?.state, 'admitted')
    assert.equal(session.nodes.some((node) => node.assetId === asset.assetId), true)
    f.assets.delete(asset.assetId)
    session = await f.makeService().getSession(f.userId, pending.sessionId)
    assert.equal(currentPlan(session).plan.resultAdmission?.state, 'quarantined')
    assert.equal(session.nodes.some((node) => node.assetId === asset.assetId), false)
    assert.equal(f.counts.create, 1)
  })
})


test('并发 edit/confirm 以 C7 STARTING 为边界，晚到新预览不撤销已接受版本', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: '确认版本 v1' }))
  const session = await service.sendMessage(f.userId, created.id, {
    clientMessageId: 'client_edit_confirm_race', text: '生成一张并发测试图', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  const current = currentPlan(session)
  const identity = {
    messageId: current.message.id,
    proposalId: current.plan.preview!.proposalId,
    previewVersion: current.plan.preview!.version,
    previewDigest: current.plan.preview!.digest,
  }
  const release = f.holdNextCreate()
  const confirming = service.execute(f.userId, created.id, identity)
  for (let attempt = 0; attempt < 100 && f.counts.create === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.equal(f.counts.create, 1, '确认已越过 STARTING 并进入命令端口')
  const editing = f.makeService().repreview(f.userId, created.id, {
    ...identity,
    prompt: '晚到编辑版本 v2',
  })
  const artifactStore = new FileTaskPreparationArtifactStore(f.directory)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const latest = await artifactStore.getLatest(f.userId, identity.proposalId)
    if (latest?.artifact.version === 2) break
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.equal((await artifactStore.getLatest(f.userId, identity.proposalId))?.artifact.version, 2)
  release()
  const [confirmed, edited] = await Promise.all([confirming, editing])
  assert.equal(currentPlan(confirmed).plan.status, 'submitted')
  assert.equal(currentPlan(edited).plan.status, 'submitted')
  const final = await f.makeService().getSession(f.userId, created.id)
  const finalPlan = currentPlan(final).plan
  assert.equal(finalPlan.status, 'submitted')
  assert.equal(finalPlan.preview?.version, 1)
  assert.equal(finalPlan.prompt, '确认版本 v1')
  assert.equal(f.counts.create, 1)
})


test('C9 completion 已强写但会话写回丢失时，新实例重放且模型调用数不增加', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: '崩溃恢复方案' }))
  const request = {
    clientMessageId: 'client_completion_recovery', text: '生成一张崩溃恢复测试图', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  }
  await service.sendMessage(f.userId, created.id, request)
  assert.equal(f.modelCalls.length, 2)
  await service.repository.mutateUser(f.userId, (file) => {
    const session = file.sessions.find((candidate) => candidate.id === created.id)!
    session.messages = []
    session.messageFingerprints = {}
  })
  const recovered = await f.makeService().sendMessage(f.userId, created.id, request)
  assert.equal(f.modelCalls.length, 2)
  assert.equal(recovered.messages.length, 2)
  assert.equal(currentPlan(recovered).plan.preview?.version, 1)
})


test('同 clientMessageId 跨 service/repository 并发单飞，模型与消息不重复', async (t) => {
  const f = await fixture(t)
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: '并发单飞方案' }))
  const request = {
    clientMessageId: 'client_concurrent_turn', text: '生成一张并发单飞图片', referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  }
  const [left, right] = await Promise.all([
    service.sendMessage(f.userId, created.id, request),
    f.makeService().sendMessage(f.userId, created.id, request),
  ])
  assert.equal(f.modelCalls.length, 2)
  assert.equal(left.messages.filter((message) => message.id === request.clientMessageId).length, 1)
  assert.equal(right.messages.filter((message) => message.id === request.clientMessageId).length, 1)
  const stored = await service.repository.readUser(f.userId)
  assert.equal(stored.sessions[0].messages.filter((message) => message.id === request.clientMessageId).length, 1)
})


async function createPreviewOnly(f: Fixture, clientMessageId: string) {
  const { service, session: created, nodeId } = await createSessionWithAsset(f)
  f.outputs.push(understanding(), plan('fashion_photo.create', { prompt: `预览 ${clientMessageId}` }))
  const session = await service.sendMessage(f.userId, created.id, {
    clientMessageId,
    text: '生成一张服装图',
    referenceNodeIds: [nodeId],
    settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4' as const, resolution: '2k' as const },
  })
  const current = currentPlan(session)
  return { service, session, sessionId: created.id, nodeId, messageId: current.message.id, plan: current.plan }
}

async function createOrphanV1State(f: Fixture, suffix: string) {
  const prepared = await createPreviewOnly(f, `client_orphan_${suffix}`)
  const preview = prepared.plan.preview!
  const store = new FileTaskPreparationArtifactStore(f.directory)
  const reference = await store.getLatest(f.userId, preview.proposalId)
  assert.ok(reference && reference.kind === 'generate' && 'normalizedParams' in reference.artifact)
  const taskId = taskIdFor(f.userId, `agent-beta:${prepared.sessionId}:${prepared.messageId}`)
  const resultAsset: AssetRecord = {
    assetId: `asset_orphan_${suffix}`,
    userId: f.userId,
    projectId: 'project_1',
    taskId,
    fileName: 'orphan.png',
    fileUrl: '/uploads/orphan.png',
    fileType: 'image/png',
    width: 640,
    height: 800,
    createdAt: startedAt.toISOString(),
  }
  f.assets.set(resultAsset.assetId, resultAsset)
  f.tasks.set(taskId, {
    taskId,
    userId: f.userId,
    featureType: reference.artifact.featureType,
    workflowId: 'orphan_without_ledger',
    inputAssetIds: [...reference.artifact.inputAssetIds],
    params: reference.artifact.normalizedParams,
    status: 'success',
    progress: 100,
    message: '无账本任务不可信',
    resultAssetIds: [resultAsset.assetId],
    results: [{ assetId: resultAsset.assetId, url: '/supplier/orphan.png', downloadUrl: '/supplier/orphan.png', width: 1, height: 1 }],
    createdAt: startedAt.toISOString(),
    creditsUsed: 0,
  })
  await prepared.service.repository.mutateUser(f.userId, (file) => {
    const session = file.sessions.find((candidate) => candidate.id === prepared.sessionId)!
    session.nodes.push({
      id: `historic_node_${suffix}`,
      assetId: resultAsset.assetId,
      taskId,
      x: 320,
      y: 20,
    })
  })
  return { ...prepared, taskId, resultAsset }
}

function assertOrphanProtected(
  session: Awaited<ReturnType<AgentBetaService['getSession']>>,
  state: Awaited<ReturnType<typeof createOrphanV1State>>,
) {
  const original = session.messages.find((message) => message.id === state.messageId)?.plan
  assert.ok(original)
  assert.equal(original.protocol, 'agent-runtime-v1')
  assert.equal(original.status, 'proposed')
  assert.equal(original.resultAdmission?.state, 'verifying')
  assert.equal(original.preview?.confirmable, false)
  assert.equal(session.nodes.some((node) => node.assetId === state.resultAsset.assetId), false)
  assert.equal(JSON.stringify(session).includes('/uploads/orphan.png'), false)
}

test('A: 真实上传 AssetRecord 自有 dataUrl undefined 与 JSON 落盘态均可进入真实 C4 preview', async (t) => {
  for (const mode of ['memory-undefined', 'json-roundtrip'] as const) {
    await t.test(mode, async (subtest) => {
      const f = await fixture(subtest)
      const original = f.assets.get('asset_input')!
      Object.defineProperty(original, 'dataUrl', {
        configurable: true,
        enumerable: true,
        value: undefined,
        writable: true,
      })
      if (mode === 'json-roundtrip') {
        f.assets.set('asset_input', JSON.parse(JSON.stringify(original)) as AssetRecord)
      }
      const prepared = await createPreviewOnly(f, `client_upload_${mode.replace('-', '_')}`)
      assert.equal(prepared.plan.protocol, 'agent-runtime-v1')
      assert.equal(prepared.plan.preview?.featureType, 'ai-fashion-photo')
      assert.equal(prepared.plan.preview?.confirmable, true)
      assert.equal(f.modelCalls.length, 2)
      assert.equal(f.counts.create, 0)
    })
  }
})

test('B: v1 plan 缺 ledger 时 GET/PATCH/send/无 v1 端口均不落 legacy 或发布历史节点', async (t) => {
  for (const route of ['GET', 'PATCH', 'send', 'GET-without-v1'] as const) {
    await t.test(route, async (subtest) => {
      const f = await fixture(subtest)
      const state = await createOrphanV1State(f, route.toLowerCase().replaceAll('-', '_'))
      f.setFlag(false)
      let response
      if (route === 'PATCH') {
        response = await f.makeService().patchSession(f.userId, state.sessionId, { title: '仍受保护' })
      } else if (route === 'send') {
        response = await f.makeService().sendMessage(f.userId, state.sessionId, {
          clientMessageId: 'client_legacy_after_orphan',
          text: '只问一下支持什么',
          referenceNodeIds: [],
          settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' },
        })
      } else {
        response = await f.makeService({ withoutV1: route === 'GET-without-v1' }).getSession(f.userId, state.sessionId)
      }
      assertOrphanProtected(response, state)
      assert.equal(f.counts.create, 0)
    })
  }
})

test('B: v1 合法预览存在确定 task 但账本缺失时 confirm 待核实且零 Gateway command', async (t) => {
  const f = await fixture(t)
  const state = await createOrphanV1State(f, 'execute')
  await assert.rejects(
    f.makeService().execute(f.userId, state.sessionId, {
      messageId: state.messageId,
      proposalId: state.plan.preview!.proposalId,
      previewVersion: state.plan.preview!.version,
      previewDigest: state.plan.preview!.digest,
    }),
    (error: unknown) => error instanceof AgentBetaError
      && error.code === 'AGENT_BETA_ACTION_VERIFICATION_REQUIRED',
  )
  assert.equal(f.counts.create, 0)
})

test('E: v2 工件已强写但 user-file 仍为 v1 时 GET/PATCH/send 都恢复服务端最新预览', async (t) => {
  for (const route of ['GET', 'PATCH', 'send'] as const) {
    await t.test(route, async (subtest) => {
      const f = await fixture(subtest)
      const state = await createPreviewOnly(f, `client_repair_${route.toLowerCase()}`)
      const v1Preview = structuredClone(state.plan.preview!)
      const v1Prompt = state.plan.prompt
      const identity = {
        messageId: state.messageId,
        proposalId: v1Preview.proposalId,
        previewVersion: v1Preview.version,
        previewDigest: v1Preview.digest,
      }
      const updated = await state.service.repreview(f.userId, state.sessionId, {
        ...identity,
        prompt: `服务端 v2 ${route}`,
      })
      assert.equal(updated.messages.find((message) => message.id === state.messageId)?.plan?.preview?.version, 2)
      await state.service.repository.mutateUser(f.userId, (file) => {
        const session = file.sessions.find((candidate) => candidate.id === state.sessionId)!
        const plan = session.messages.find((message) => message.id === state.messageId)!.plan!
        plan.preview = v1Preview
        plan.prompt = v1Prompt
      })
      f.setFlag(false)
      const service = f.makeService()
      const response = route === 'GET'
        ? await service.getSession(f.userId, state.sessionId)
        : route === 'PATCH'
          ? await service.patchSession(f.userId, state.sessionId, { title: '触发恢复' })
          : await service.sendMessage(f.userId, state.sessionId, {
              clientMessageId: `client_repair_send_${route.toLowerCase()}`,
              text: '只问流程',
              referenceNodeIds: [],
              settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' },
            })
      const repaired = response.messages.find((message) => message.id === state.messageId)?.plan
      assert.equal(repaired?.preview?.version, 2)
      assert.equal(repaired?.prompt, `服务端 v2 ${route}`)
    })
  }
})

test('E: 同一 preview 到期后 GET/PATCH/send 都实时关闭 confirmable', async (t) => {
  for (const route of ['GET', 'PATCH', 'send'] as const) {
    await t.test(route, async (subtest) => {
      const f = await fixture(subtest)
      const state = await createPreviewOnly(f, `client_expiry_${route.toLowerCase()}`)
      assert.equal(state.plan.preview?.confirmable, true)
      f.advance(PREVIEW_TTL_MS)
      f.setFlag(false)
      const service = f.makeService()
      const response = route === 'GET'
        ? await service.getSession(f.userId, state.sessionId)
        : route === 'PATCH'
          ? await service.patchSession(f.userId, state.sessionId, { title: '过期预览' })
          : await service.sendMessage(f.userId, state.sessionId, {
              clientMessageId: `client_expiry_send_${route.toLowerCase()}`,
              text: '只问流程',
              referenceNodeIds: [],
              settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' },
            })
      const expired = response.messages.find((message) => message.id === state.messageId)?.plan
      assert.equal(expired?.preview?.version, state.plan.preview?.version)
      assert.equal(expired?.preview?.digest, state.plan.preview?.digest)
      assert.equal(expired?.preview?.confirmable, false)
    })
  }
})

test('E: 较旧 refresh 结果不能覆盖 user-file 中并发出现的更高预览版本', async (t) => {
  const f = await fixture(t)
  const state = await createPreviewOnly(f, 'client_no_preview_downgrade')
  const identity = {
    messageId: state.messageId,
    proposalId: state.plan.preview!.proposalId,
    previewVersion: state.plan.preview!.version,
    previewDigest: state.plan.preview!.digest,
  }
  const v2 = await state.service.repreview(f.userId, state.sessionId, { ...identity, prompt: '服务端 v2' })
  const v2Preview = v2.messages.find((message) => message.id === state.messageId)!.plan!.preview!
  await state.service.repository.mutateUser(f.userId, (file) => {
    const plan = file.sessions.find((candidate) => candidate.id === state.sessionId)!
      .messages.find((message) => message.id === state.messageId)!.plan!
    plan.preview = { ...v2Preview, version: 3, digest: 'f'.repeat(64) }
    plan.prompt = '并发更新 v3'
  })
  const response = await f.makeService().getSession(f.userId, state.sessionId)
  const current = response.messages.find((message) => message.id === state.messageId)!.plan!
  assert.equal(current.preview?.version, 3)
  assert.equal(current.prompt, '并发更新 v3')
})


test('B-retry: 缺账 v1 retry 保留原 taskId，node/asset 两种历史绑定均不发布或重提', async (t) => {
  for (const binding of ['node-task-id', 'asset-task-id'] as const) {
    for (const route of ['GET', 'PATCH', 'send'] as const) {
      await t.test(`${binding}-${route}`, async (subtest) => {
        const f = await fixture(subtest)
        const state = await createPreviewOnly(f, `client_retry_orphan_${binding}_${route.toLowerCase()}`)
        const originalTaskId = `original_retry_task_${binding}_${route.toLowerCase()}`
        const derivedGenerateTaskId = taskIdFor(
          f.userId,
          `agent-beta:${state.sessionId}:${state.messageId}`,
        )
        assert.notEqual(originalTaskId, derivedGenerateTaskId)
        const asset: AssetRecord = {
          assetId: `asset_retry_orphan_${binding}_${route.toLowerCase()}`,
          userId: f.userId,
          projectId: 'project_1',
          taskId: binding === 'asset-task-id' ? originalTaskId : null,
          fileName: 'retry-orphan.png',
          fileUrl: '/uploads/retry-orphan.png',
          fileType: 'image/png',
          width: 640,
          height: 800,
          createdAt: startedAt.toISOString(),
        }
        f.assets.set(asset.assetId, asset)
        f.tasks.set(originalTaskId, {
          taskId: originalTaskId,
          userId: f.userId,
          featureType: 'photo-fission',
          workflowId: 'retry_orphan_without_ledger',
          inputAssetIds: ['asset_input'],
          params: { ...f.tasks.values().next().value?.params } as GenerationTask['params'],
          status: 'success',
          progress: 100,
          message: '无账本 retry 任务不可信',
          resultAssetIds: [asset.assetId],
          results: [{ assetId: asset.assetId, url: '/supplier/retry-orphan.png',
            downloadUrl: '/supplier/retry-orphan.png', width: 1, height: 1 }],
          createdAt: startedAt.toISOString(),
          creditsUsed: 0,
        })
        await state.service.repository.mutateUser(f.userId, (file) => {
          const session = file.sessions.find((candidate) => candidate.id === state.sessionId)!
          const plan = session.messages.find((message) => message.id === state.messageId)!.plan!
          plan.status = 'submitted'
          plan.task = {
            taskId: originalTaskId,
            status: 'success',
            progress: 100,
            message: '无账本 retry 任务不可信',
          }
          plan.resultAdmission = {
            state: 'pending',
            taskId: originalTaskId,
            taskStatus: 'success',
          }
          session.nodes.push({
            id: `historic_retry_node_${binding}_${route.toLowerCase()}`,
            assetId: asset.assetId,
            ...(binding === 'node-task-id' ? { taskId: originalTaskId } : {}),
            x: 320,
            y: 20,
          })
        })
        f.setFlag(false)
        const service = f.makeService()
        const response = route === 'GET'
          ? await service.getSession(f.userId, state.sessionId)
          : route === 'PATCH'
            ? await service.patchSession(f.userId, state.sessionId, { title: 'retry 仍受保护' })
            : await service.sendMessage(f.userId, state.sessionId, {
                clientMessageId: `client_retry_orphan_followup_${binding}_${route.toLowerCase()}`,
                text: '只问流程',
                referenceNodeIds: [],
                settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' },
              })
        const protectedPlan = response.messages.find((message) => message.id === state.messageId)?.plan
        assert.ok(protectedPlan)
        assert.equal(protectedPlan.resultAdmission?.state, 'verifying')
        assert.equal(protectedPlan.resultAdmission?.taskId, originalTaskId)
        assert.equal(protectedPlan.task, undefined, 'sync 后 task 仅保留为待核实身份')
        assert.equal(protectedPlan.preview?.confirmable, false)
        assert.equal(response.nodes.some((node) => node.assetId === asset.assetId), false)
        assert.equal(JSON.stringify(response).includes('/uploads/retry-orphan.png'), false)
        await assert.rejects(
          f.makeService().execute(f.userId, state.sessionId, {
            messageId: state.messageId,
            proposalId: protectedPlan.preview!.proposalId,
            previewVersion: protectedPlan.preview!.version,
            previewDigest: protectedPlan.preview!.digest,
          }),
          (error: unknown) => error instanceof AgentBetaError
            && error.code === 'AGENT_BETA_ACTION_VERIFICATION_REQUIRED',
        )
        assert.equal(f.counts.create, 0)
        assert.equal(f.counts.retry, 0)
      })
    }
  }
})
