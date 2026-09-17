import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { assetDigest, requestDigest, type ActionLedgerEntry, type GovernedAction, type PreviewArtifact } from '@/lib/agent/contracts'
import type { JsonValue } from '@/lib/agent/types'
import type { AssetRecord, GenerationTask } from '@/lib/types'
import type { QueryPort, SessionQueryRecord } from '../ports'
import { createTaskPreparation } from '../action/task-preparation'
import { createLocalPreparationNormalizers } from '../action/preparation-normalizers'
import { ActionLedgerStore } from './action-ledger'
import { ApprovalStore, type AuthenticatedUserIntent } from './approval-store'
import { FileTaskPreparationArtifactStore } from './preparation-artifact-store'
import { FileResultAdmissionEvidenceStore, createPostSubmitVerifier } from './result-admission'
import { createGovernanceGateway, governedActionKey, type GovernanceGatewayDependencies } from './gateway'

const aiSettings = { model: 'nano-banana-2', imageRatio: '3:4', resolution: '2k', resultCount: 1 }
async function fixture(t: TestContext, templateVersion?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-gateway-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const assets = new Map<string, AssetRecord>()
  for (const id of ['main', 'other', 'third']) assets.set(id, {
    assetId: id, userId: 'user', projectId: 'project', fileName: `${id}.png`, fileUrl: `/uploads/${id}.png`,
    fileType: 'image/png', width: 800, height: 1200, createdAt: '2026-09-17T00:00:00.000Z', taskId: null,
  })
  const scope = { userId: 'user', sessionId: 'session', messageId: 'message' }
  const session: SessionQueryRecord = { sessionId: 'session', userId: 'user',
    nodes: [...assets.keys()].map((id) => ({ id: `node-${id}`, assetId: id, name: id })), taskIds: [] }
  const tasks = new Map<string, GenerationTask>()
  const queries: QueryPort = { getAsset: async (id) => assets.get(id), getTask: async (id) => tasks.get(id), getSession: async () => session }
  let nowMs = Date.parse('2026-09-17T01:00:00.000Z')
  const now = () => new Date(nowMs)
  const availability = { enabled: true }
  const artifacts = new FileTaskPreparationArtifactStore(directory)
  const preparation = createTaskPreparation({ assets: queries, tasks: queries, store: artifacts, now,
    taskControls: { resolve: async (task) => ({ resolvedModelId: 'nano-banana-2', promptTemplateVersion: `${task.featureType}-v1` }) },
    availability: { isFeatureAvailable: async () => availability.enabled, isModelAvailable: async () => availability.enabled },
    normalizers: createLocalPreparationNormalizers({
      ...(templateVersion ? { promptTemplateVersions: { 'ai-fashion-photo': templateVersion } } : {}),
      poses: { getPoseTemplate: async (id) => ({ id, name: '站姿', url: '/poses/a.png', bodyPart: 'full' }) },
      resolveGarmentDetailModel: async (algorithmModelId) => ({
        definition: { algorithmModelId, algorithmModelName: '标准', tier: 'standard', resolutions: ['1k', '2k', '4k'] },
        resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'garment-detail-v1',
      }),
    }),
  })
  let intent: AuthenticatedUserIntent = { actionKind: 'classify', targetId: 'main' }
  const approvalDependencies = { authenticate: async () => ({ ...scope }), readAuthenticatedIntent: async () => intent,
    artifacts, preparation, now }
  const approvals = new ApprovalStore(directory, approvalDependencies)
  const ledger = new ActionLedgerStore(directory, queries)
  const evidence = new FileResultAdmissionEvidenceStore(directory, { now })
  const postSubmit = createPostSubmitVerifier({ artifacts, approvals, evidence })
  const calls = { create: 0, retry: 0, cancel: 0, classify: 0, cutout: 0, queue: 0 }
  const getTaskId = (userId: string, key: string) => `task_idem_${createHash('sha256').update(JSON.stringify([userId, key])).digest('hex')}`
  const dependencies: GovernanceGatewayDependencies = {
    queries, preparation, artifacts, approvals, ledger, postSubmit, now, authenticate: async () => ({ ...scope }), getTaskId,
    isTaskExecutionActive: () => false,
    assertQueueCapacity: () => { calls.queue++ },
    contentPolicy: async () => ({ allowed: true }),
    commands: {
      async createPreparedTask(preview, key) {
        calls.create++
        const during = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(directory, 'executions.json'), 'utf8'))
        assert.equal(during.entries.at(-1).submissionState, 'STARTING')
        assert.equal(during.entries.at(-1).sideEffectState, 'POSSIBLE')
        const fullDigest = await requestDigest({ actionKind: 'generate', payload: preview })
        const task: GenerationTask = { taskId: getTaskId(preview.userId, key), userId: preview.userId,
          featureType: preview.featureType, workflowId: 'workflow', params: preview.normalizedParams,
          inputAssetIds: preview.inputAssetIds, status: 'pending', progress: 0, message: '排队中',
          resultAssetIds: [], results: [], createdAt: now().toISOString(), creditsUsed: 0,
          agentExecution: { schemaVersion: 1, paramsDigest: preview.paramsDigest,
            assetDigests: [...preview.assetDigests], resolvedModelId: preview.resolvedModelId!,
            promptTemplateVersion: preview.promptTemplateVersion!, normalizationSeed: preview.normalizationSeed,
            requestDigest: fullDigest, idempotencyKey: key, attempts: [{ actionKind: 'generate',
              requestDigest: fullDigest, idempotencyKey: key, shotIds: [], attempt: null, priorResultAssetIds: [] }] } }
        tasks.set(task.taskId, task); session.taskIds!.push(task.taskId)
        return task
      },
      async retryPreparedShots(preview, key) {
        calls.retry++
        const task = tasks.get(preview.taskId)!
        const fullDigest = await requestDigest({ actionKind: 'retry_shots', payload: preview })
        const priorResultAssetIds = task.results.map((result) => result.assetId)
        task.status = 'pending'
        task.agentExecution = { schemaVersion: 1, paramsDigest: preview.paramsDigest,
          assetDigests: [...preview.assetDigests], resolvedModelId: preview.resolvedModelId!,
          promptTemplateVersion: preview.promptTemplateVersion!, normalizationSeed: task.agentExecution?.normalizationSeed ?? null,
          requestDigest: fullDigest, idempotencyKey: key, attempts: [...(task.agentExecution?.attempts ?? []), {
            actionKind: 'retry_shots', requestDigest: fullDigest, idempotencyKey: key,
            shotIds: [...preview.shotIds], attempt: preview.attempt, priorResultAssetIds,
          }] }
        return task
      },
      async cancelTask(id) { calls.cancel++; const task = tasks.get(id)!; task.status = 'cancelled'; return task },
    },
    vendors: {
      async classify(payload) { calls.classify++; return { status: 'classified', assetId: payload.assetId, category: 'tops', confidence: 0.8 } },
      async prepareCutout() { calls.cutout++; return { cutoutSessionId: 'cutout-1', preparedImageUrl: '/api/cutout-sessions/cutout-1/image' } },
    },
  }
  async function prepare(proposalId = 'proposal', toolName = 'fashion_photo.create', settings: JsonValue = aiSettings,
    version = 1, selectedAssetIds = ['main']) {
    return preparation.prepare({ toolName, args: { prompt: '保留服装细节' } }, {
      ...scope, proposalId, version, settings, selectedAssetIds,
    })
  }
  const approve = (preview: Pick<PreviewArtifact, 'proposalId' | 'version' | 'paramsDigest'>) => approvals.issueApproval({ proposalId: preview.proposalId, version: preview.version, paramsDigest: preview.paramsDigest })
  async function vendorAction(kind: 'classify' | 'cutout_prepare', assetId = 'main'): Promise<GovernedAction> {
    intent = { actionKind: kind, targetId: assetId }
    const receipt = await approvals.issueIntent()
    const payload = { schemaVersion: 1 as const, ...scope, assetId, assetDigest: await assetDigest(assets.get(assetId)!), intent: receipt }
    return kind === 'classify' ? { actionKind: kind, payload } : { actionKind: kind, payload: { ...payload, scene: 'garment' } }
  }
  return { directory, dependencies, tasks, assets, session, scope, calls, approvals, ledger, artifacts,
    preparation, prepare, approve, vendorAction, availability, approvalDependencies,
    setIntent: (next: AuthenticatedUserIntent) => { intent = next },
    advance: (ms: number) => { nowMs += ms }, gateway: () => createGovernanceGateway(dependencies) }
}

test('生成先强写 STARTING，pending 原样返回；并发重复确认及新实例只调用一次', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  const action = { actionKind: 'generate' as const, payload: preview }
  const results = await Promise.all(Array.from({ length: 4 }, () => f.gateway().execute(action, approval)))
  assert.equal(f.calls.create, 1)
  assert.ok(results.every((result) => result.actionKind === 'generate' && result.task.status === 'pending'))
  f.dependencies.approvals = new ApprovalStore(f.directory, f.approvalDependencies)
  await f.gateway().execute(action, approval)
  const entry = (await f.ledger.read()).entries[0]
  assert.equal(entry.submissionState, 'SUBMITTED'); assert.equal(entry.resultAdmission, 'PENDING'); assert.equal(entry.taskStatus, 'pending')
})

test('审批必须已持久化，模型 receipt/同 ID 变更均不能伪造', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const receipt = await f.approve(preview)
  for (const forged of [{ ...receipt, approvalId: 'fake' }, { ...receipt, approvedAt: '2026-09-17T00:00:00.000Z' }]) {
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, forged), /approval_not_issued/)
  }
  assert.equal(f.calls.create, 0)
})

test('客户端确认不允许夹带控制字段、receipt 或 intent', async (t) => {
  const f = await fixture(t); const preview = await f.prepare()
  for (const name of ['userId', 'receipt', 'intent', 'normalizedParams']) await assert.rejects(f.approvals.issueApproval({
    proposalId: preview.proposalId, version: preview.version, paramsDigest: preview.paramsDigest, [name]: true,
  }))
})

test('用户/会话/消息当前身份与冻结身份必须一致', async (t) => {
  for (const field of ['userId', 'sessionId', 'messageId'] as const) {
    const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
    f.scope[field] = 'intruder'
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval), /identity_mismatch/)
    assert.equal(f.calls.create, 0)
  }
})

test('当前素材成员、所有者和摘要每次重查', async (t) => {
  for (const change of ['membership', 'owner', 'digest', 'url']) {
    const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
    if (change === 'membership') f.session.nodes = []
    else if (change === 'owner') f.assets.get('main')!.userId = 'other'
    else if (change === 'digest') f.assets.get('main')!.width++
    else f.assets.get('main')!.fileUrl = 'data:image/png;base64,AA'
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval), /asset_/)
    assert.equal(f.calls.create, 0)
  }
})

test('冻结工件不能替换模型、参数、版本、有效期或剥离 blocker', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  for (const patch of [{ resolvedModelId: 'gemini-3-pro' }, { version: 2 }, { expiresAt: '2099-01-01T00:00:00.000Z' }, { blockers: ['new'] }]) {
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: { ...preview, ...patch } }, approval), /artifact_mismatch/)
  }
  assert.equal(f.calls.create, 0)
})

test('全部多张及姿势自由提示词 blocker 必须阻断', async (t) => {
  const cases: Array<[string, JsonValue]> = [
    ['fashion_photo.create', { ...aiSettings, resultCount: 2 }],
    ['photo_fission.create', { model: 'nano-banana-2', category: 'childrens', childrensCategory: 'pants',
      imageRatio: '3:4', resolution: '2k', resultCount: 2 }],
    ['pose_fission.create', { model: 'nano-banana-2', poseIds: ['pose-a'], imageRatio: '3:4', resolution: '2k' }],
  ]
  for (const [tool, settings] of cases) {
    const f = await fixture(t); const preview = await f.prepare('proposal', tool, settings); const approval = await f.approve(preview)
    assert.ok(preview.blockers.length)
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval), /preview_blocked/)
    assert.equal(f.calls.create, 0)
  }
})

test('单张细节图消费冻结模型和参数', async (t) => {
  const f = await fixture(t)
  const preview = await f.prepare('detail', 'garment_detail.create', { category: 'tops', algorithmModelId: 'std-v1', resolution: '2k', imageRatio: '1:1' })
  const approval = await f.approve(preview)
  const result = await f.gateway().execute({ actionKind: 'generate', payload: preview }, approval)
  assert.equal(result.actionKind, 'generate'); assert.equal(f.calls.create, 1)
})

test('功能停用、过期和画布上限均在调用前失败且不占账', async (t) => {
  for (const kind of ['feature', 'expired', 'canvas']) {
    const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
    if (kind === 'feature') f.availability.enabled = false
    if (kind === 'expired') f.advance(30 * 60_000)
    if (kind === 'canvas') while (f.session.nodes.length < 50) f.session.nodes.push({ id: `extra-${f.session.nodes.length}`, assetId: 'main', name: 'x' })
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval))
    assert.equal(f.calls.create, 0); assert.equal((await f.ledger.read()).entries.length, 0)
  }
})

test('队列/内容 hook 拒绝、异常及缺失全部 fail closed', async (t) => {
  for (const kind of ['queue', 'content_denied', 'content_throw', 'content_missing']) {
    const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
    if (kind === 'queue') f.dependencies.assertQueueCapacity = () => { throw new Error('full') }
    if (kind === 'content_denied') f.dependencies.contentPolicy = async () => ({ allowed: false })
    if (kind === 'content_throw') f.dependencies.contentPolicy = async () => { throw new Error('offline') }
    if (kind === 'content_missing') f.dependencies.contentPolicy = undefined as never
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval))
    assert.equal(f.calls.create, 0); assert.equal((await f.ledger.read()).entries.length, 0)
  }
})

test('同调用身份不同摘要必须冲突', async (t) => {
  const f = await fixture(t); const action = await f.vendorAction('cutout_prepare')
  await f.gateway().execute(action)
  assert.equal(action.actionKind, 'cutout_prepare')
  if (action.actionKind !== 'cutout_prepare') return
  await assert.rejects(f.gateway().execute({ ...action, payload: { ...action.payload, scene: 'person' } }), /idempotency_conflict/)
  assert.equal(f.calls.cutout, 1)
})

test('ledger 强写失败不调用供应商', async (t) => {
  const f = await fixture(t); const action = await f.vendorAction('classify')
  await writeFile(f.ledger.filePath, '{broken')
  await assert.rejects(f.gateway().execute(action)); assert.equal(f.calls.classify, 0)
})

test('调用超时后 UNKNOWN/POSSIBLE，重复确认绝不重提', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  f.dependencies.commands.createPreparedTask = async () => { f.calls.create++; throw new Error('timeout') }
  const action = { actionKind: 'generate' as const, payload: preview }
  await assert.rejects(f.gateway().execute(action, approval), /timeout/)
  await assert.rejects(f.gateway().execute(action, approval), /action_unknown/)
  const entry = (await f.ledger.read()).entries[0]
  assert.equal(entry.submissionState, 'UNKNOWN'); assert.equal(entry.sideEffectState, 'POSSIBLE'); assert.equal(f.calls.create, 1)
})

test('提交返回错误用户、任务或参数时保留调用债务', async (t) => {
  for (const kind of ['owner', 'id', 'params']) {
    const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
    const create = f.dependencies.commands.createPreparedTask
    f.dependencies.commands.createPreparedTask = async (...args) => {
      const task = await create(...args)
      return kind === 'owner' ? { ...task, userId: 'other' } : kind === 'id' ? { ...task, taskId: 'wrong' }
        : { ...task, params: { ...task.params, resolution: '4k' } as GenerationTask['params'] }
    }
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval), /task_mismatch/)
    const entry = (await f.ledger.read()).entries[0]
    assert.equal(entry.submissionState, 'UNKNOWN'); assert.equal(entry.gateOutcome, 'BLOCKED_POST_SUBMIT')
    assert.equal(entry.resultAdmission, 'QUARANTINED')
    assert.ok(entry.evidenceRefs.some((reference) => reference.startsWith('c8:')))
  }
})

test('分类持久化安全返回值，重启式新实例重放且不重复消费', async (t) => {
  const f = await fixture(t); const action = await f.vendorAction('classify')
  const first = await f.gateway().execute(action)
  f.dependencies.approvals = new ApprovalStore(f.directory, f.approvalDependencies)
  assert.deepEqual(await f.gateway().execute(action), first); assert.equal(f.calls.classify, 1)
})

test('分类每消息最多两次、抠图一次，模型布尔值不能提高额度', async (t) => {
  const f = await fixture(t)
  for (const id of ['main', 'other']) await f.gateway().execute(await f.vendorAction('classify', id))
  await assert.rejects(f.gateway().execute(await f.vendorAction('classify', 'third')), /turn_quota/)
  await f.gateway().execute(await f.vendorAction('cutout_prepare', 'main'))
  await assert.rejects(f.gateway().execute(await f.vendorAction('cutout_prepare', 'other')), /turn_quota/)
  const action = await f.vendorAction('classify')
  await assert.rejects(f.gateway().execute({ ...action, allowed: true } as unknown as GovernedAction))
  assert.equal(f.calls.classify, 2); assert.equal(f.calls.cutout, 1)
})

test('分类意图不可伪造或换目标/动作，过期意图失败关闭', async (t) => {
  const f = await fixture(t); const action = await f.vendorAction('classify')
  if (action.actionKind !== 'classify') return
  await assert.rejects(f.gateway().execute({ ...action, payload: { ...action.payload, intent: { ...action.payload.intent, intentId: 'fake' } } }), /intent_not_issued/)
  await assert.rejects(f.gateway().execute({ ...action, payload: { ...action.payload, assetId: 'other' } }), /intent_mismatch/)
  f.advance(30 * 60_000)
  await assert.rejects(f.gateway().execute(action), /intent_expired/); assert.equal(f.calls.classify, 0)
})

test('vendor 格式/归属/不安全 URL 不通过时保持 UNKNOWN，不能再调用', async (t) => {
  for (const kind of ['classification', 'url']) {
    const f = await fixture(t); const action = await f.vendorAction(kind === 'url' ? 'cutout_prepare' : 'classify')
    if (kind === 'url') f.dependencies.vendors.prepareCutout = async () => { f.calls.cutout++; return { cutoutSessionId: 'x', preparedImageUrl: 'https://temp.example.com/private.png' } }
    else f.dependencies.vendors.classify = async () => { f.calls.classify++; return { status: 'classified', assetId: 'other', category: 'tops', confidence: 0.8 } }
    await assert.rejects(f.gateway().execute(action)); await assert.rejects(f.gateway().execute(action), /action_unknown/)
    assert.equal(f.calls.classify + f.calls.cutout, 1)
  }
})

test('活动任务和未知任务阻断另一个批准，全局并发只放行一次', async (t) => {
  const f = await fixture(t); const p1 = await f.prepare('one'); const p2 = await f.prepare('two')
  const a1 = await f.approve(p1); const a2 = await f.approve(p2)
  const settled = await Promise.allSettled([f.gateway().execute({ actionKind: 'generate', payload: p1 }, a1), f.gateway().execute({ actionKind: 'generate', payload: p2 }, a2)])
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1); assert.equal(f.calls.create, 1)
  f.tasks.clear()
  f.scope.messageId = 'next-message'
  const p3 = await f.prepare('three'); const a3 = await f.approve(p3)
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: p3 }, a3), /unresolved_generation/)
})

test('20 次日限额来自落账事实，PRE 被拒不扣名额', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  await f.gateway().execute({ actionKind: 'generate', payload: preview }, approval)
  for (const task of f.tasks.values()) task.status = 'success'
  await f.ledger.withEntries(async (entries, save) => {
    const first = entries[0]
    for (let n = 1; n < 20; n++) entries.push({ ...first, key: `old-${n}`, messageId: `old-${n}` })
    await save()
  })
  f.scope.messageId = 'next-message'
  const second = await f.prepare('second'); const secondApproval = await f.approve(second)
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: second }, secondApproval), /daily_limit/)
  assert.equal(f.calls.create, 1)
})

test('取消原任务须当前会话成员和已签发意图，重放无重复取消', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  const result = await f.gateway().execute({ actionKind: 'generate', payload: preview }, approval)
  if (result.actionKind !== 'generate') return
  f.setIntent({ actionKind: 'cancel', targetId: result.task.taskId })
  const intent = await f.approvals.issueIntent()
  const action: GovernedAction = { actionKind: 'cancel', payload: { schemaVersion: 1, ...f.scope, taskId: result.task.taskId, intent } }
  await f.gateway().execute(action); await f.gateway().execute(action); assert.equal(f.calls.cancel, 1)
  f.session.taskIds = []
  await assert.rejects(f.gateway().execute(action), /task_not_in_session/)
})

test('历史调用保留且不能为同消息补造新版批准后重新提交', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  await writeFile(f.ledger.filePath, JSON.stringify([{ key: 'agent-beta:session:message', ...f.scope,
    prompt: '旧提示词', taskId: 'old-task', createdAt: '2026-09-16T00:00:00.000Z' }]))
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval), /legacy_protected/)
  assert.equal(f.calls.create, 0)
  assert.equal((await f.ledger.read()).entries[0].recordKind, 'legacy')
})

test('生成复用旧确认键，同消息换 proposal/version 不会产生第二任务身份', async (t) => {
  const f = await fixture(t); const preview = await f.prepare()
  const key = governedActionKey({ actionKind: 'generate', payload: preview })
  assert.equal(key, 'agent-beta:session:message')
  assert.equal(key, governedActionKey({ actionKind: 'generate', payload: { ...preview, version: 2, proposalId: 'new' } }))
})

test('已批准 v1 在保存 v2 后不能新提交，旧版本也不能再获批准', async (t) => {
  const f = await fixture(t); const v1 = await f.prepare(); const approval = await f.approve(v1)
  await f.prepare('proposal', 'fashion_photo.create', aiSettings, 2)
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: v1 }, approval), /preview_superseded/)
  await assert.rejects(f.approve(v1), /preview_superseded/)
  assert.equal(f.calls.create, 0)
})

test('已执行同消息修改版本/参数后不能当作新的付费执行', async (t) => {
  const f = await fixture(t); const v1 = await f.prepare(); const approval = await f.approve(v1)
  await f.gateway().execute({ actionKind: 'generate', payload: v1 }, approval)
  const v2 = await f.prepare('proposal', 'fashion_photo.create', { ...aiSettings, imageRatio: '1:1' }, 2)
  const next = await f.approve(v2)
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: v2 }, next), /idempotency_conflict/)
  assert.equal(f.calls.create, 1)
})

test('content hook 修改素材或保存新版本后，最后重查阻止提交', async (t) => {
  for (const kind of ['asset', 'version', 'scope']) {
    const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
    f.dependencies.contentPolicy = async () => {
      if (kind === 'asset') f.assets.delete('main')
      if (kind === 'version') await f.prepare('proposal', 'fashion_photo.create', aiSettings, 2)
      if (kind === 'scope') f.scope.userId = 'other'
      return { allowed: true }
    }
    await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval))
    assert.equal(f.calls.create, 0); assert.equal((await f.ledger.read()).entries.length, 0)
  }
})

test('content hook 看到递归冻结快照，不可覆盖已批准的参数', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  f.dependencies.contentPolicy = async (action) => {
    assert.ok(Object.isFrozen(action)); assert.ok(Object.isFrozen(action.payload))
    if (action.actionKind === 'generate') assert.ok(Object.isFrozen(action.payload.normalizedParams))
    return { allowed: true }
  }
  await f.gateway().execute({ actionKind: 'generate', payload: preview }, approval)
})

test('已签发但当前执行器不支持的冻结模板在 PRE 阻断', async (t) => {
  const f = await fixture(t, 'retired-template-v0'); const preview = await f.prepare(); const approval = await f.approve(preview)
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval), /template_unavailable/)
  assert.equal(f.calls.create, 0); assert.equal((await f.ledger.read()).entries.length, 0)
})

test('person/product 抠图不占调用额度或写 STARTING', async (t) => {
  const f = await fixture(t); const action = await f.vendorAction('cutout_prepare')
  if (action.actionKind !== 'cutout_prepare') return
  for (const scene of ['person', 'product'] as const) await assert.rejects(f.gateway().execute({
    ...action, payload: { ...action.payload, scene },
  }), /cutout_scene_unavailable/)
  assert.equal(f.calls.cutout, 0); assert.equal((await f.ledger.read()).entries.length, 0)
})

test('失败镜头重新审批后按原任务重试，重复确认不重新 validate 已改变的失败状态', async (t) => {
  const f = await fixture(t)
  const initial = await f.prepare('detail', 'garment_detail.create', { category: 'tops', algorithmModelId: 'std-v1', resolution: '2k', imageRatio: '1:1' })
  const result = await f.gateway().execute({ actionKind: 'generate', payload: initial }, await f.approve(initial))
  if (result.actionKind !== 'generate') return
  result.task.status = 'failed'; result.task.shotProgress = [{ shotId: 'detail_1', label: '细节', status: 'failed', message: 'failed' }]
  f.scope.messageId = 'retry-message'
  const preview = await f.preparation.prepareRetry({ taskId: result.task.taskId, shotIds: ['detail_1'] }, {
    ...f.scope, proposalId: 'retry', version: 1, selectedAssetIds: [], settings: {},
  })
  const approval = await f.approve(preview)
  const action: GovernedAction = { actionKind: 'retry_shots', payload: preview }
  await f.gateway().execute(action, approval); await f.gateway().execute(action, approval)
  assert.equal(f.calls.retry, 1)
  const last = (await f.ledger.read()).entries.at(-1)!
  assert.equal(last.submissionState, 'SUBMITTED'); assert.equal(last.taskStatus, 'pending'); assert.equal(last.resultAdmission, 'PENDING')
})

test('重试调用超时后原任务存在仍保持 UNKNOWN，绝不当成本轮已提交', async (t) => {
  const f = await fixture(t)
  const initial = await f.prepare('detail', 'garment_detail.create', { category: 'tops', algorithmModelId: 'std-v1', resolution: '2k', imageRatio: '1:1' })
  const result = await f.gateway().execute({ actionKind: 'generate', payload: initial }, await f.approve(initial))
  if (result.actionKind !== 'generate') return
  result.task.status = 'failed'; result.task.shotProgress = [{ shotId: 'detail_1', label: '细节', status: 'failed', message: 'failed' }]
  f.scope.messageId = 'retry-message'
  const preview = await f.preparation.prepareRetry({ taskId: result.task.taskId, shotIds: ['detail_1'] }, {
    ...f.scope, proposalId: 'retry', version: 1, selectedAssetIds: [], settings: {},
  })
  const approval = await f.approve(preview)
  f.dependencies.commands.retryPreparedShots = async () => { f.calls.retry++; throw new Error('timeout') }
  const action: GovernedAction = { actionKind: 'retry_shots', payload: preview }
  await assert.rejects(f.gateway().execute(action, approval), /timeout/)
  await assert.rejects(f.gateway().execute(action, approval), /action_unknown/)
  assert.equal(f.calls.retry, 1); assert.equal((await f.ledger.read()).entries.at(-1)!.submissionState, 'UNKNOWN')
})

test('C7 再引用要求同一原任务的 generate/retry 两条 C8 ledger 均已 ADMITTED', async (t) => {
  const f = await fixture(t)
  const initial = await f.prepare()
  const submitted = await f.gateway().execute({ actionKind: 'generate', payload: initial }, await f.approve(initial))
  assert.equal(submitted.actionKind, 'generate')
  if (submitted.actionKind !== 'generate') assert.fail('预期生成任务')
  submitted.task.status = 'success'
  submitted.task.progress = 100
  const generatedAsset: AssetRecord = {
    assetId: 'admitted-source', userId: 'user', projectId: 'project', fileName: 'admitted-source.png',
    fileUrl: '/results/admitted-source.png', fileType: 'image/png', width: 800, height: 1200,
    createdAt: f.dependencies.now!().toISOString(), taskId: submitted.task.taskId,
  }
  f.assets.set(generatedAsset.assetId, generatedAsset)
  f.session.nodes.push({ id: 'node-admitted-source', assetId: generatedAsset.assetId,
    name: generatedAsset.fileName, taskId: submitted.task.taskId })
  submitted.task.results = [{ assetId: generatedAsset.assetId, url: generatedAsset.fileUrl,
    downloadUrl: generatedAsset.fileUrl, width: generatedAsset.width, height: generatedAsset.height }]
  submitted.task.resultAssetIds = [generatedAsset.assetId]

  let retryKey = ''
  await f.ledger.withEntries(async (entries, save) => {
    const generated = entries.find((entry): entry is Extract<ActionLedgerEntry, { approvalEvidence: 'receipt' }> =>
      entry.recordKind === 'v1' && entry.actionKind === 'generate' && entry.taskId === submitted.task.taskId)
    assert.ok(generated)
    generated.taskStatus = 'success'
    generated.resultAdmission = 'ADMITTED'
    retryKey = 'agent-v1:retry:c7-reference-boundary'
    entries.push({ ...generated, actionKind: 'retry_shots', key: retryKey,
      messageId: 'retry-reference-message', toolName: 'task.retry_shots',
      requestDigest: 'e'.repeat(64), approvalDigest: 'f'.repeat(64), proposalId: 'retry-reference',
      resultAdmission: 'PENDING', evidenceRefs: [], updatedAt: f.dependencies.now!().toISOString() })
    await save()
  })

  f.scope.messageId = 'reuse-result-message'
  const next = await f.prepare('reuse-result', 'fashion_photo.create', aiSettings, 1, [generatedAsset.assetId])
  const approval = await f.approve(next)
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: next }, approval), /asset_not_admitted/)
  await f.ledger.withEntries(async (entries, save) => {
    const retry = entries.find((entry) => entry.recordKind === 'v1' && entry.key === retryKey)!
    retry.resultAdmission = 'ADMITTED'
    await save()
  })
  const reused = await f.gateway().execute({ actionKind: 'generate', payload: next }, approval)
  assert.equal(reused.actionKind, 'generate')
  assert.equal(f.calls.create, 2)
})

test('content hook 等待到意图过期时所有非付费动作均不能提交', async (t) => {
  for (const kind of ['classify', 'cutout_prepare', 'cancel'] as const) {
    const f = await fixture(t)
    let action: GovernedAction
    if (kind === 'cancel') {
      const preview = await f.prepare()
      const result = await f.gateway().execute({ actionKind: 'generate', payload: preview }, await f.approve(preview))
      if (result.actionKind !== 'generate') return
      f.setIntent({ actionKind: kind, targetId: result.task.taskId })
      action = { actionKind: kind, payload: { schemaVersion: 1, ...f.scope, taskId: result.task.taskId, intent: await f.approvals.issueIntent() } }
    } else action = await f.vendorAction(kind)
    f.dependencies.contentPolicy = async () => { f.advance(30 * 60_000); return { allowed: true } }
    await assert.rejects(f.gateway().execute(action), /intent_expired/)
    assert.equal(f.calls.classify + f.calls.cutout + f.calls.cancel, 0)
  }
})

test('最终异步 availability 校验期间保存新版本，原版本不能跨过 STARTING', async (t) => {
  const f = await fixture(t); const preview = await f.prepare(); const approval = await f.approve(preview)
  let validations = 0
  f.dependencies.preparation = { ...f.preparation, async validatePrepared(candidate) {
    await f.preparation.validatePrepared(candidate)
    if (++validations === 2) await f.prepare('proposal', 'fashion_photo.create', aiSettings, 2)
  } }
  await assert.rejects(f.gateway().execute({ actionKind: 'generate', payload: preview }, approval), /preview_superseded/)
  assert.equal(f.calls.create, 0); assert.equal((await f.ledger.read()).entries.length, 0)
})

test('STARTING 文件强写失败发生在调用前，不产生供应商副作用', async (t) => {
  const f = await fixture(t); const action = await f.vendorAction('classify')
  await f.ledger.withEntries(async (_entries, save) => save())
  await mkdir(`${f.ledger.filePath}.tmp-write`)
  await assert.rejects(f.gateway().execute(action))
  assert.equal(f.calls.classify, 0); assert.equal((await f.ledger.read()).entries.length, 0)
})

test('供应商返回但完成状态强写失败，保留 UNKNOWN 且不得重复消费', async (t) => {
  const f = await fixture(t); const action = await f.vendorAction('classify')
  let writes = 0
  const ledger = Object.create(f.ledger) as ActionLedgerStore
  ledger.withEntries = async (operation) => f.ledger.withEntries(async (entries, save) => operation(entries, async () => {
    if (++writes === 2) throw new Error('completion write failed')
    await save()
  }))
  f.dependencies.ledger = ledger
  await assert.rejects(f.gateway().execute(action), /completion write failed/)
  await assert.rejects(f.gateway().execute(action), /action_unknown/)
  assert.equal(f.calls.classify, 1); assert.equal((await f.ledger.read()).entries[0].submissionState, 'UNKNOWN')
})
