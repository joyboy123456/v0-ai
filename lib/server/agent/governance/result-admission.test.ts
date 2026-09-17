import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  approvalDigest,
  canonicalize,
  digest,
  paramsDigest,
  requestDigest,
  type ActionLedgerEntry,
  type ApprovalReceipt,
  type PreviewArtifact,
  type RetryPreviewArtifact,
} from '@/lib/agent/contracts'
import type {
  AssetRecord,
  GarmentDetailParams,
  GenerationTask,
  PhotoFissionParams,
  ResultAsset,
  TaskStatus,
} from '@/lib/types'
import type { PaidGovernedAction } from '../ports'
import type { StoredPreparationReference } from '../action/task-preparation'
import type { ApprovalEvidenceStorePort } from './approval-store'
import { preparationArtifactKey } from './preparation-artifact-store'
import { normalizePhotoFissionParams } from '../../photo-fission-service'
import {
  FileResultAdmissionEvidenceStore,
  RESULT_ADMISSION_EVIDENCE_FILE,
  createPostSubmitVerifier,
  createResultAdmission,
  type ResultAdmissionEvidenceStorePort,
} from './result-admission'

const now = '2026-09-17T00:00:00.000Z'
const key = 'agent-beta:session:message'
const taskId = 'task-1'
const inputAssetId = 'input-1'
const inputDigest = '1'.repeat(64)

function garmentParams(
  shots: GarmentDetailParams['detailShots'] = [
    { shotId: 'detail_1', label: '领口细节', referenceAssetId: null },
  ],
): GarmentDetailParams {
  return {
    category: 'tops', algorithmModelId: 'std-v1', algorithmModelName: '标准版',
    modelTier: 'standard', resolution: '1k', imageRatio: '1:1', userPrompt: '保留服装事实',
    aiAppendDescription: false, referenceImageCount: 0, detailShots: shots,
    resultCount: shots.length, creditsCost: 0, resolvedModelId: 'nano-banana-2',
    promptTemplateVersion: 'garment-detail-v1',
  }
}

async function sealReference(
  value: Omit<StoredPreparationReference, 'referenceDigest'>,
): Promise<StoredPreparationReference> {
  const { artifact: _artifact, ...base } = value
  return { ...value, referenceDigest: await digest(base) }
}

function generatedAsset(id: string, owner = 'user', linkedTaskId = taskId, url = `/local-assets/results/${id}.png`): AssetRecord {
  return {
    assetId: id, userId: owner, projectId: 'project', fileName: `${id}.png`, fileUrl: url,
    fileType: 'image/png', width: 1024, height: 1024, createdAt: now, taskId: linkedTaskId,
  }
}

function result(id: string, shotId = 'detail_1'): ResultAsset {
  return {
    assetId: id,
    // 这些字段不可信；安全视图必须完全忽略它们。
    url: 'javascript:alert(1)', downloadUrl: 'data:image/png;base64,secret', width: 1, height: 1,
    shotId, label: '供应商伪造标签',
  }
}

interface Harness {
  directory: string
  action: PaidGovernedAction
  preview: PreviewArtifact | RetryPreviewArtifact
  reference: StoredPreparationReference
  receipt: ApprovalReceipt
  approvalHash: string
  task: GenerationTask
  entry: ActionLedgerEntry & { approvalEvidence: 'receipt' }
  tasks: Map<string, GenerationTask>
  assets: Map<string, AssetRecord>
  references: Map<string, StoredPreparationReference>
  evidence: FileResultAdmissionEvidenceStore
  post: ReturnType<typeof createPostSubmitVerifier>
  admission: ReturnType<typeof createResultAdmission>
  ledger: { entries: ActionLedgerEntry[]; save(): Promise<void> }
  get saveCount(): number
  setSaveFailure(value: boolean): void
  runPost(task?: GenerationTask, expectedTaskId?: string): ReturnType<ReturnType<typeof createPostSubmitVerifier>['postSubmit']>
  admit(scope?: { userId: string; sessionId: string }): ReturnType<ReturnType<typeof createResultAdmission>['admitResults']>
}

async function buildGenerateHarness(
  t: TestContext,
  shots: GarmentDetailParams['detailShots'] = [
    { shotId: 'detail_1', label: '领口细节', referenceAssetId: null },
  ],
): Promise<Harness> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-c8-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const params = garmentParams(shots)
  const preview: PreviewArtifact = {
    schemaVersion: 1, proposalId: 'proposal-1', version: 1,
    userId: 'user', sessionId: 'session', messageId: 'message',
    toolName: 'garment_detail.create', featureType: 'garment-detail', normalizedParams: params,
    inputAssetIds: [inputAssetId], assetDigests: [inputDigest],
    paramsDigest: await paramsDigest('garment-detail', params), policyVersion: 'policy-v1',
    estimatedResultCount: shots.length, normalizationSeed: '2'.repeat(64), resolvedModelId: 'nano-banana-2',
    promptTemplateVersion: 'garment-detail-v1', blockers: [], riskNotices: ['测试'],
    createdAt: '2026-09-16T22:00:00.000Z', expiresAt: '2026-09-16T22:30:00.000Z',
  }
  const action = { actionKind: 'generate' as const, payload: preview }
  const fullDigest = await requestDigest(action)
  const receipt: ApprovalReceipt = {
    schemaVersion: 1, approvalId: 'approval-1', userId: 'user', proposalId: preview.proposalId,
    previewVersion: preview.version, paramsDigest: preview.paramsDigest,
    assetDigests: [...preview.assetDigests], requestDigest: fullDigest,
    // 已超过 30 分钟：历史核验不得拿当前时间使它失效。
    approvedAt: '2026-09-16T22:01:00.000Z',
  }
  const approvalHash = await approvalDigest(receipt)
  const reference = await sealReference({
    schemaVersion: 1, key: preparationArtifactKey('user', preview.proposalId, preview.version),
    kind: 'generate', inputDigest: '3'.repeat(64), requestDigest: fullDigest,
    inputAssetIds: [inputAssetId], sourceTaskId: null, sourceTaskStateDigest: null, artifact: preview,
  })
  const task: GenerationTask = {
    taskId, userId: 'user', featureType: 'garment-detail', workflowId: 'workflow',
    inputAssetIds: [inputAssetId], params, status: 'pending', progress: 0, message: '排队中',
    resultAssetIds: [], results: [], creditsUsed: 0, createdAt: now,
    agentExecution: {
      schemaVersion: 1, paramsDigest: preview.paramsDigest, assetDigests: [...preview.assetDigests],
      resolvedModelId: preview.resolvedModelId!, promptTemplateVersion: preview.promptTemplateVersion!,
      normalizationSeed: preview.normalizationSeed, requestDigest: fullDigest, idempotencyKey: key,
      attempts: [{ actionKind: 'generate', requestDigest: fullDigest, idempotencyKey: key,
        shotIds: [], attempt: null, priorResultAssetIds: [] }],
    },
  }
  const entry: Harness['entry'] = {
    schemaVersion: 1, recordKind: 'v1', actionKind: 'generate', approvalEvidence: 'receipt',
    key, userId: 'user', sessionId: 'session', messageId: 'message', toolName: preview.toolName,
    requestDigest: fullDigest, approvalDigest: approvalHash, assetDigests: [...preview.assetDigests],
    proposalId: preview.proposalId, previewVersion: preview.version, featureType: preview.featureType,
    taskId, providerRequestIds: [], submissionState: 'SUBMITTED', taskStatus: 'pending',
    gateOutcome: 'PASSED_PRE', sideEffectState: 'CONFIRMED', resultAdmission: 'PENDING',
    evidenceRefs: [], createdAt: now, updatedAt: now,
  }
  return buildHarness(t, { directory, action, preview, reference, receipt, approvalHash, task, entry })
}

async function buildRetryHarness(t: TestContext): Promise<Harness> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-c8-retry-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const params = garmentParams([
    { shotId: 'detail_1', label: '领口细节', referenceAssetId: null },
    { shotId: 'detail_2', label: '面料细节', referenceAssetId: null },
  ])
  const paramsHash = await paramsDigest('garment-detail', params)
  const preview: RetryPreviewArtifact = {
    schemaVersion: 1, proposalId: 'retry-proposal', version: 1,
    userId: 'user', sessionId: 'session', messageId: 'retry-message',
    toolName: 'task.retry_shots', featureType: 'garment-detail',
    assetDigests: [inputDigest], paramsDigest: paramsHash, policyVersion: 'policy-v1',
    estimatedResultCount: 1, resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'garment-detail-v1',
    blockers: [], riskNotices: ['重试'], createdAt: '2026-09-16T22:00:00.000Z',
    expiresAt: '2026-09-16T22:30:00.000Z', taskId, shotIds: ['detail_1'], attempt: 2,
  }
  const action = { actionKind: 'retry_shots' as const, payload: preview }
  const retryKey = 'agent-v1:retry-key'
  const fullDigest = await requestDigest(action)
  const receipt: ApprovalReceipt = {
    schemaVersion: 1, approvalId: 'approval-retry', userId: 'user', proposalId: preview.proposalId,
    previewVersion: preview.version, paramsDigest: preview.paramsDigest,
    assetDigests: [...preview.assetDigests], requestDigest: fullDigest, approvedAt: '2026-09-16T22:01:00.000Z',
  }
  const approvalHash = await approvalDigest(receipt)
  const reference = await sealReference({
    schemaVersion: 1, key: preparationArtifactKey('user', preview.proposalId, preview.version),
    kind: 'retry_shots', inputDigest: '4'.repeat(64), requestDigest: fullDigest,
    inputAssetIds: [inputAssetId], sourceTaskId: taskId,
    sourceTaskStateDigest: '5'.repeat(64), artifact: preview,
  })
  const old = result('result-old', 'detail_2')
  const task: GenerationTask = {
    taskId, userId: 'user', featureType: 'garment-detail', workflowId: 'workflow',
    inputAssetIds: [inputAssetId], params, status: 'pending', progress: 72, message: '重试中',
    resultAssetIds: [old.assetId], results: [old], creditsUsed: 0, createdAt: now,
    agentExecution: {
      schemaVersion: 1, paramsDigest: paramsHash, assetDigests: [inputDigest],
      resolvedModelId: preview.resolvedModelId!, promptTemplateVersion: preview.promptTemplateVersion!,
      normalizationSeed: '6'.repeat(64), requestDigest: fullDigest, idempotencyKey: retryKey,
      attempts: [
        { actionKind: 'generate', requestDigest: '7'.repeat(64), idempotencyKey: 'original-key',
          shotIds: [], attempt: null, priorResultAssetIds: [] },
        { actionKind: 'retry_shots', requestDigest: fullDigest, idempotencyKey: retryKey,
          shotIds: ['detail_1'], attempt: 2, priorResultAssetIds: [old.assetId] },
      ],
    },
  }
  const entry: Harness['entry'] = {
    schemaVersion: 1, recordKind: 'v1', actionKind: 'retry_shots', approvalEvidence: 'receipt',
    key: retryKey, userId: 'user', sessionId: 'session', messageId: 'retry-message',
    toolName: preview.toolName, requestDigest: fullDigest, approvalDigest: approvalHash,
    assetDigests: [inputDigest], proposalId: preview.proposalId, previewVersion: preview.version,
    featureType: preview.featureType, taskId, providerRequestIds: [], submissionState: 'SUBMITTED',
    taskStatus: 'pending', gateOutcome: 'PASSED_PRE', sideEffectState: 'CONFIRMED',
    resultAdmission: 'PENDING', evidenceRefs: [], createdAt: now, updatedAt: now,
  }
  return buildHarness(t, { directory, action, preview, reference, receipt, approvalHash, task, entry })
}

function buildHarness(
  _t: TestContext,
  seed: Pick<Harness, 'directory' | 'action' | 'preview' | 'reference' | 'receipt' | 'approvalHash' | 'task' | 'entry'>,
): Harness {
  const tasks = new Map([[seed.task.taskId, seed.task]])
  const assets = new Map<string, AssetRecord>()
  const references = new Map([[seed.reference.key, seed.reference]])
  const approvals: ApprovalEvidenceStorePort = {
    async verifyHistoricalApproval(action, expectedDigest) {
      if (expectedDigest !== seed.approvalHash || canonicalize(action) !== canonicalize(seed.action)) {
        throw new Error('approval mismatch')
      }
      return seed.receipt
    },
  }
  const evidence = new FileResultAdmissionEvidenceStore(seed.directory, { now: () => new Date(now) })
  const artifactPort = { get: async (artifactKey: string) => references.get(artifactKey) }
  const post = createPostSubmitVerifier({ artifacts: artifactPort, approvals, evidence })
  const admission = createResultAdmission({
    tasks: { getTask: async (id) => tasks.get(id) },
    assets: { getAsset: async (id) => assets.get(id) },
    artifacts: artifactPort, approvals, evidence, now: () => new Date(now),
  })
  let saveCount = 0
  let failSave = false
  const ledger = {
    entries: [seed.entry] as ActionLedgerEntry[],
    async save() { saveCount += 1; if (failSave) throw new Error('ledger write failed') },
  }
  return {
    ...seed, tasks, assets, references, evidence, post, admission, ledger,
    get saveCount() { return saveCount },
    setSaveFailure(value) { failSave = value },
    runPost(task = seed.task, expectedTaskId = seed.task.taskId) {
      return this.post.postSubmit({
        action: seed.action, key: seed.entry.key, expectedTaskId,
        approvalDigest: seed.approvalHash, task,
      })
    },
    admit(scope = { userId: 'user', sessionId: 'session' }) {
      return this.admission.admitResults(scope, this.ledger)
    },
  }
}

function cloneTask(task: GenerationTask): GenerationTask {
  return JSON.parse(JSON.stringify(task)) as GenerationTask
}

function finish(
  harness: Harness,
  results: ResultAsset[],
  status: TaskStatus = 'success',
): void {
  harness.task.results = results
  harness.task.resultAssetIds = results.map((item) => item.assetId)
  harness.task.status = status
  harness.task.progress = 100
  harness.task.finishedAt = now
  harness.tasks.set(harness.task.taskId, harness.task)
}

async function prepareAdmission(harness: Harness): Promise<void> {
  const checked = await harness.runPost()
  assert.equal(checked.outcome, 'accepted')
}

test('post-submit 对 pending 做完整冻结绑定核验，重复观察强写幂等', async (t) => {
  const f = await buildGenerateHarness(t)
  const first = await f.runPost()
  const second = await f.runPost()
  assert.equal(first.outcome, 'accepted')
  assert.equal(first.taskStatus, 'pending')
  assert.equal(first.confirmedTask, true)
  assert.equal(second.evidenceRef, first.evidenceRef)
  const disk = JSON.parse(await readFile(path.join(f.directory, RESULT_ADMISSION_EVIDENCE_FILE), 'utf8'))
  assert.equal(disk.entries.length, 1)
})

test('post-submit 拦截任务 id/owner/feature/params/input/model/template/asset digest/调用凭据错配', async (t) => {
  const cases: Array<[string, (task: GenerationTask) => string | undefined]> = [
    ['task id', (task) => { task.taskId = 'other-task'; return undefined }],
    ['owner', (task) => { task.userId = 'other'; return undefined }],
    ['feature', (task) => { task.featureType = 'ai-fashion-photo'; return undefined }],
    ['params', (task) => { (task.params as GarmentDetailParams).userPrompt = '篡改'; return undefined }],
    ['input order', (task) => { task.inputAssetIds = ['other-input']; return undefined }],
    ['model', (task) => { task.agentExecution!.resolvedModelId = 'other-model'; return undefined }],
    ['template', (task) => { task.agentExecution!.promptTemplateVersion = 'other-template'; return undefined }],
    ['asset digest', (task) => { task.agentExecution!.assetDigests = ['9'.repeat(64)]; return undefined }],
    ['credential', (task) => { task.agentExecution!.idempotencyKey = 'forged-key'; return undefined }],
    ['expected id', () => 'forged-expected-task'],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, async (subtest) => {
      const f = await buildGenerateHarness(subtest)
      const candidate = cloneTask(f.task)
      const expected = mutate(candidate)
      const decision = await f.runPost(candidate, expected)
      assert.equal(decision.outcome, 'blocked')
      assert.equal(decision.confirmedTask, false)
      assert.ok(decision.reasonCodes.length > 0)
    })
  }
})

test('post-submit 即使工件与审批彼此一致也拒绝非 Grsai 冻结模型', async (t) => {
  const f = await buildGenerateHarness(t)
  const preview = JSON.parse(JSON.stringify(f.preview)) as PreviewArtifact
  ;(preview.normalizedParams as GarmentDetailParams).resolvedModelId = 'gemini-3-pro-image-preview'
  preview.resolvedModelId = 'gemini-3-pro-image-preview'
  preview.paramsDigest = await paramsDigest(preview.featureType, preview.normalizedParams)
  const action = { actionKind: 'generate' as const, payload: preview }
  const fullDigest = await requestDigest(action)
  const receipt: ApprovalReceipt = { ...f.receipt, paramsDigest: preview.paramsDigest,
    assetDigests: [...preview.assetDigests], requestDigest: fullDigest }
  const approvalHash = await approvalDigest(receipt)
  const reference = await sealReference({ ...f.reference, requestDigest: fullDigest, artifact: preview })
  const task = cloneTask(f.task)
  task.params = preview.normalizedParams
  task.agentExecution = { ...task.agentExecution!, paramsDigest: preview.paramsDigest,
    resolvedModelId: preview.resolvedModelId, requestDigest: fullDigest,
    attempts: [{ actionKind: 'generate', requestDigest: fullDigest, idempotencyKey: key,
      shotIds: [], attempt: null, priorResultAssetIds: [] }] }
  const post = createPostSubmitVerifier({
    artifacts: { get: async () => reference },
    approvals: { verifyHistoricalApproval: async () => receipt },
    evidence: f.evidence,
  })
  const decision = await post.postSubmit({ action, key, expectedTaskId: taskId, approvalDigest: approvalHash, task })
  assert.equal(decision.outcome, 'blocked')
  assert.ok(decision.reasonCodes.includes('task_execution_model_not_allowed'))
})

test('post-submit 强写失败会拒绝返回结论', async (t) => {
  const f = await buildGenerateHarness(t)
  const failing: ResultAdmissionEvidenceStorePort = {
    record: async () => { throw new Error('evidence disk failed') },
    list: (...args) => f.evidence.list(...args),
  }
  const verifier = createPostSubmitVerifier({
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: { verifyHistoricalApproval: async () => f.receipt }, evidence: failing,
  })
  await assert.rejects(verifier.postSubmit({
    action: f.action, key: f.entry.key, expectedTaskId: taskId,
    approvalDigest: f.approvalHash, task: f.task,
  }), /evidence disk failed/)
})

test('历史审批已过期且同 proposal 有新 preview，不影响原提交结果按原版本准入', async (t) => {
  const f = await buildGenerateHarness(t)
  const newer = await sealReference({
    ...f.reference, key: preparationArtifactKey('user', 'proposal-1', 2),
    inputDigest: '8'.repeat(64), artifact: { ...(f.preview as PreviewArtifact), version: 2 },
  })
  f.references.set(newer.key, newer)
  await prepareAdmission(f)
  const output = result('result-1')
  finish(f, [output])
  f.assets.set(output.assetId, generatedAsset(output.assetId))
  const admitted = await f.admit()
  assert.equal(admitted.decisions[0].resultAdmission, 'ADMITTED')
})

test('post-submit 拒绝不存在的历史审批摘要', async (t) => {
  const f = await buildGenerateHarness(t)
  const decision = await f.post.postSubmit({
    action: f.action, key: f.entry.key, expectedTaskId: taskId,
    approvalDigest: '0'.repeat(64), task: f.task,
  })
  assert.equal(decision.outcome, 'blocked')
  assert.ok(decision.reasonCodes.includes('approval_unverifiable'))
})

test('pending/running 永不发布流式结果，终态才发布当前 AssetRecord 安全视图', async (t) => {
  const f = await buildGenerateHarness(t)
  await prepareAdmission(f)
  const output = result('result-1')
  finish(f, [output], 'running')
  f.assets.set(output.assetId, generatedAsset(output.assetId, 'user', taskId, '/local-assets/results/current.png'))
  const pending = await f.admit()
  assert.equal(pending.decisions[0].resultAdmission, 'PENDING')
  assert.equal(pending.decisions[0].c8Evidence, undefined)
  assert.deepEqual(pending.decisions[0].results, [])

  f.task.status = 'success'
  const admitted = await f.admit()
  assert.equal(admitted.decisions[0].resultAdmission, 'ADMITTED')
  assert.deepEqual(admitted.decisions[0].results, [{
    assetId: 'result-1', taskId, shotId: 'detail_1', label: '领口细节',
    fileName: 'result-1.png', url: '/local-assets/results/current.png',
    downloadUrl: '/local-assets/results/current.png', width: 1024, height: 1024,
  }])
  const c8Evidence = admitted.decisions[0].c8Evidence
  assert.match(c8Evidence?.evidenceRef ?? '', /^c8:[a-f0-9]{64}$/)
  assert.match(c8Evidence?.resultDigest ?? '', /^[a-f0-9]{64}$/)
  const bytes = await readFile(path.join(f.directory, RESULT_ADMISSION_EVIDENCE_FILE), 'utf8')
  const persistedEvidence = JSON.parse(bytes).entries.find((entry: { evidenceRef: string }) => entry.evidenceRef === c8Evidence?.evidenceRef)
  assert.equal(persistedEvidence?.outcome, 'admitted')
  assert.equal(persistedEvidence?.resultDigest, c8Evidence?.resultDigest)
  assert.equal(bytes.includes('/local-assets/results/current.png'), false)
  assert.equal(bytes.includes('javascript:'), false)
  assert.equal(bytes.includes('保留服装事实'), false)
})

test('跨用户作用域不查询、不返回；任务当前转属则隔离', async (t) => {
  const f = await buildGenerateHarness(t)
  await prepareAdmission(f)
  let queries = 0
  f.admission = createResultAdmission({
    tasks: { getTask: async (id) => { queries += 1; return f.tasks.get(id) } },
    assets: { getAsset: async (id) => f.assets.get(id) },
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: { verifyHistoricalApproval: async () => f.receipt },
    evidence: f.evidence, now: () => new Date(now),
  })
  assert.deepEqual((await f.admit({ userId: 'other', sessionId: 'session' })).decisions, [])
  assert.equal(queries, 0)
  f.task.userId = 'other'
  f.task.status = 'success'
  const blocked = await f.admit()
  assert.equal(blocked.decisions[0].resultAdmission, 'QUARANTINED')
  assert.equal(f.entry.gateOutcome, 'BLOCKED_RESULT')
})

test('终态结果数组错序、重复、超额、shot 越界与不安全 URL 全部隔离', async (t) => {
  const cases: Array<[string, (f: Harness) => void]> = [
    ['array mismatch', (f) => {
      const item = result('result-1'); finish(f, [item]); f.task.resultAssetIds = ['other-id']
    }],
    ['duplicate', (f) => {
      const item = result('result-1'); finish(f, [item, { ...item }])
    }],
    ['over approved count', (f) => {
      const one = result('result-1'); const two = result('result-2'); finish(f, [one, two])
    }],
    ['wrong shot', (f) => {
      const item = result('result-1', 'detail_99'); finish(f, [item]); f.assets.set(item.assetId, generatedAsset(item.assetId))
    }],
    ['unsafe data url', (f) => {
      const item = result('result-1'); finish(f, [item]); f.assets.set(item.assetId, generatedAsset(item.assetId, 'user', taskId, 'data:image/png;base64,AA'))
    }],
    ['unsafe javascript url', (f) => {
      const item = result('result-1'); finish(f, [item]); f.assets.set(item.assetId, generatedAsset(item.assetId, 'user', taskId, 'javascript:alert(1)'))
    }],
    ['asset owner mismatch', (f) => {
      const item = result('result-1'); finish(f, [item]); f.assets.set(item.assetId, generatedAsset(item.assetId, 'other'))
    }],
    ['asset task mismatch', (f) => {
      const item = result('result-1'); finish(f, [item]); f.assets.set(item.assetId, generatedAsset(item.assetId, 'user', 'other-task'))
    }],
    ['invalid dimensions', (f) => {
      const item = result('result-1'); finish(f, [item]); const asset = generatedAsset(item.assetId); asset.width = 0; f.assets.set(item.assetId, asset)
    }],
    ['unsafe filename', (f) => {
      const item = result('result-1'); finish(f, [item]); const asset = generatedAsset(item.assetId); asset.fileName = '../secret.png'; f.assets.set(item.assetId, asset)
    }],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, async (subtest) => {
      const f = await buildGenerateHarness(subtest)
      await prepareAdmission(f)
      mutate(f)
      const decision = await f.admit()
      assert.equal(decision.decisions[0].resultAdmission, 'QUARANTINED')
      assert.deepEqual(decision.decisions[0].results, [])
      assert.equal(f.entry.gateOutcome, 'BLOCKED_RESULT')
    })
  }
})

test('partial/failed/cancelled 可准入合法完成子集并保留真实状态', async (t) => {
  for (const status of ['partial', 'failed', 'cancelled'] as const) {
    await t.test(status, async (subtest) => {
      const f = await buildGenerateHarness(subtest)
      await prepareAdmission(f)
      finish(f, [], status)
      const decision = await f.admit()
      assert.equal(decision.decisions[0].resultAdmission, 'ADMITTED')
      assert.equal(decision.decisions[0].taskStatus, status)
      assert.deepEqual(decision.decisions[0].results, [])
    })
  }
})

test('retry 只发布 attempts 基线后的新图，旧图不能冒充且 shot 必须在批准范围', async (t) => {
  const f = await buildRetryHarness(t)
  await prepareAdmission(f)
  const fresh = result('result-new', 'detail_1')
  finish(f, [f.task.results[0], fresh])
  // 旧图故意不放资产 Map：retry 准入不能查询或发布它。
  f.assets.set(fresh.assetId, generatedAsset(fresh.assetId))
  const admitted = await f.admit()
  assert.equal(admitted.decisions[0].resultAdmission, 'ADMITTED')
  assert.deepEqual(admitted.decisions[0].results.map((item) => item.assetId), ['result-new'])

  await t.test('旧无 attempts 不能推断重试候选', async (subtest) => {
    const legacy = await buildRetryHarness(subtest)
    legacy.task.agentExecution!.attempts = undefined
    const post = await legacy.runPost()
    assert.equal(post.outcome, 'accepted')
    const item = result('result-new', 'detail_1')
    finish(legacy, [legacy.task.results[0], item])
    legacy.assets.set(item.assetId, generatedAsset(item.assetId))
    assert.equal((await legacy.admit()).decisions[0].resultAdmission, 'QUARANTINED')
  })

  await t.test('旧图作为本轮候选或错误 shot 均隔离', async (subtest) => {
    const forged = await buildRetryHarness(subtest)
    await prepareAdmission(forged)
    forged.task.agentExecution!.attempts![1].priorResultAssetIds = []
    finish(forged, [forged.task.results[0]])
    forged.assets.set('result-old', generatedAsset('result-old'))
    assert.equal((await forged.admit()).decisions[0].resultAdmission, 'QUARANTINED')
  })
})

test('后续 retry 运行或完成时，旧 ADMITTED attempt 保留历史终态与结果窗口', async (t) => {
  const f = await buildRetryHarness(t)
  await prepareAdmission(f)
  const fresh = result('result-new', 'detail_1')
  finish(f, [f.task.results[0], fresh], 'success')
  f.assets.set(fresh.assetId, generatedAsset(fresh.assetId))
  const first = await f.admit()
  assert.equal(first.decisions[0].resultAdmission, 'ADMITTED')
  assert.deepEqual(first.decisions[0].results.map((item) => item.assetId), ['result-new'])

  const laterAttempt = { actionKind: 'retry_shots' as const, requestDigest: '8'.repeat(64),
    idempotencyKey: 'later-retry', shotIds: ['detail_2'], attempt: 3,
    priorResultAssetIds: ['result-old', 'result-new'] }
  f.task.agentExecution!.attempts!.push(laterAttempt)
  f.task.agentExecution!.requestDigest = laterAttempt.requestDigest
  f.task.agentExecution!.idempotencyKey = laterAttempt.idempotencyKey
  f.task.status = 'pending'
  f.task.progress = 0
  const whileRunning = await f.admit()
  assert.equal(whileRunning.decisions[0].resultAdmission, 'ADMITTED')
  assert.equal(whileRunning.decisions[0].taskStatus, 'success')
  assert.deepEqual(whileRunning.decisions[0].results.map((item) => item.assetId), ['result-new'])
  assert.equal(f.entry.gateOutcome, 'PASSED_PRE')

  const later = result('result-later', 'detail_2')
  finish(f, [f.task.results[0], fresh, later], 'success')
  f.assets.set(later.assetId, generatedAsset(later.assetId))
  const afterCompletion = await f.admit()
  assert.deepEqual(afterCompletion.decisions[0].results.map((item) => item.assetId), ['result-new'])

  f.assets.delete(fresh.assetId)
  const changed = await f.admit()
  assert.equal(changed.decisions[0].resultAdmission, 'QUARANTINED')
  assert.equal(f.entry.gateOutcome, 'BLOCKED_RESULT')
})

test('UNKNOWN、STARTING、VERIFYING 与既有隔离不会因 task success 解禁', async (t) => {
  for (const state of ['UNKNOWN', 'STARTING', 'VERIFYING'] as const) {
    await t.test(state, async (subtest) => {
      const f = await buildGenerateHarness(subtest)
      f.entry.submissionState = state
      finish(f, [result('result-1')])
      let queried = false
      f.admission = createResultAdmission({
        tasks: { getTask: async () => { queried = true; return f.task } },
        assets: { getAsset: async () => generatedAsset('result-1') },
        artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
        approvals: { verifyHistoricalApproval: async () => f.receipt },
        evidence: f.evidence,
      })
      const decision = await f.admit()
      assert.equal(queried, false)
      assert.deepEqual(decision.decisions[0].results, [])
      assert.equal(f.entry.submissionState, state)
    })
  }
  await t.test('UNKNOWN + ADMITTED', async (subtest) => {
    const f = await buildGenerateHarness(subtest)
    f.entry.submissionState = 'UNKNOWN'
    f.entry.resultAdmission = 'ADMITTED'
    const decision = await f.admit()
    assert.equal(decision.decisions[0].resultAdmission, 'QUARANTINED')
    assert.equal(f.entry.gateOutcome, 'BLOCKED_RESULT')
    assert.deepEqual(decision.decisions[0].results, [])
  })
  await t.test('QUARANTINED', async (subtest) => {
    const f = await buildGenerateHarness(subtest)
    f.entry.resultAdmission = 'QUARANTINED'
    f.entry.gateOutcome = 'BLOCKED_RESULT'
    finish(f, [result('result-1')])
    assert.equal((await f.admit()).decisions[0].resultAdmission, 'QUARANTINED')
    assert.deepEqual((await f.admit()).decisions[0].results, [])
  })
})

test('任务缺失或查询异常转 UNKNOWN，不重提也不伪装失败', async (t) => {
  for (const mode of ['missing', 'throw'] as const) {
    await t.test(mode, async (subtest) => {
      const f = await buildGenerateHarness(subtest)
      await prepareAdmission(f)
      if (mode === 'missing') f.tasks.delete(taskId)
      else f.admission = createResultAdmission({
        tasks: { getTask: async () => { throw new Error('query unavailable') } },
        assets: { getAsset: async (id) => f.assets.get(id) },
        artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
        approvals: { verifyHistoricalApproval: async () => f.receipt }, evidence: f.evidence,
      })
      const decision = await f.admit()
      assert.equal(f.entry.submissionState, 'UNKNOWN')
      assert.equal(f.entry.resultAdmission, 'PENDING')
      assert.deepEqual(decision.decisions[0].results, [])
    })
  }
})

test('blocked post-submit 证据优先于后来成功任务，不能解禁', async (t) => {
  const f = await buildGenerateHarness(t)
  const wrong = cloneTask(f.task); wrong.userId = 'other'
  assert.equal((await f.runPost(wrong)).outcome, 'blocked')
  finish(f, [result('result-1')])
  f.assets.set('result-1', generatedAsset('result-1'))
  const decision = await f.admit()
  assert.equal(decision.decisions[0].resultAdmission, 'QUARANTINED')
  assert.deepEqual(decision.decisions[0].results, [])
})

test('C8 证据损坏或缺主文件但有写痕迹均 fail closed', async (t) => {
  for (const mode of ['corrupt', 'missing'] as const) {
    await t.test(mode, async (subtest) => {
      const f = await buildGenerateHarness(subtest)
      await prepareAdmission(f)
      const file = path.join(f.directory, RESULT_ADMISSION_EVIDENCE_FILE)
      if (mode === 'corrupt') await writeFile(file, '{}')
      else await rm(file)
      await assert.rejects(f.admit())
      assert.equal(f.entry.resultAdmission, 'PENDING')
    })
  }
})

test('结果证据先于 ledger 保存；任一强写失败都不返回安全视图', async (t) => {
  const f = await buildGenerateHarness(t)
  await prepareAdmission(f)
  const output = result('result-1')
  finish(f, [output]); f.assets.set(output.assetId, generatedAsset(output.assetId))
  f.setSaveFailure(true)
  await assert.rejects(f.admit(), /ledger write failed/)
  assert.equal(f.entry.resultAdmission, 'PENDING')
  const records = await f.evidence.list({
    key: f.entry.key, userId: f.entry.userId, sessionId: f.entry.sessionId,
    messageId: f.entry.messageId, taskId: f.entry.taskId, actionKind: 'generate',
    requestDigest: f.entry.requestDigest, approvalDigest: f.entry.approvalDigest,
  })
  assert.ok(records.some((record) => record.outcome === 'admitted'))

  const failingEvidence: ResultAdmissionEvidenceStorePort = {
    list: (...args) => f.evidence.list(...args),
    record: async (observation) => {
      if (observation.evidenceKind === 'result_admission') throw new Error('c8 write failed')
      return f.evidence.record(observation)
    },
  }
  f.setSaveFailure(false)
  f.admission = createResultAdmission({
    tasks: { getTask: async (id) => f.tasks.get(id) }, assets: { getAsset: async (id) => f.assets.get(id) },
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: { verifyHistoricalApproval: async () => f.receipt }, evidence: failingEvidence,
  })
  await assert.rejects(f.admit(), /c8 write failed/)
  assert.equal(f.entry.resultAdmission, 'PENDING')
})

test('并发 post-submit 与跨实例证据写入保持单条幂等观察', async (t) => {
  const f = await buildGenerateHarness(t)
  const secondEvidence = new FileResultAdmissionEvidenceStore(f.directory, { now: () => new Date(now) })
  const second = createPostSubmitVerifier({
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: { verifyHistoricalApproval: async () => f.receipt }, evidence: secondEvidence,
  })
  const input = { action: f.action, key: f.entry.key, expectedTaskId: taskId,
    approvalDigest: f.approvalHash, task: f.task }
  const [left, right] = await Promise.all([f.post.postSubmit(input), second.postSubmit(input)])
  assert.equal(left.evidenceRef, right.evidenceRef)
  const listed = await secondEvidence.list({
    key: f.entry.key, userId: 'user', sessionId: 'session', messageId: 'message', taskId,
    actionKind: 'generate', requestDigest: f.entry.requestDigest, approvalDigest: f.approvalHash,
  })
  assert.equal(listed.filter((record) => record.evidenceKind === 'post_submit').length, 1)
})

test('ADMITTED 每次轮询重查资产；删除、转属、不安全 URL 或稳定身份改动后永久隔离', async (t) => {
  const mutations: Array<[string, (f: Harness) => void]> = [
    ['task deleted', (f) => { f.tasks.delete(taskId) }],
    ['deleted', (f) => { f.assets.delete('result-1') }],
    ['transferred', (f) => { f.assets.get('result-1')!.userId = 'other' }],
    ['url became unsafe', (f) => { f.assets.get('result-1')!.fileUrl = 'javascript:alert(1)' }],
    ['dimensions changed', (f) => { f.assets.get('result-1')!.width = 2048 }],
  ]
  for (const [name, mutate] of mutations) {
    await t.test(name, async (subtest) => {
      const f = await buildGenerateHarness(subtest)
      await prepareAdmission(f)
      const output = result('result-1')
      finish(f, [output]); f.assets.set(output.assetId, generatedAsset(output.assetId))
      assert.equal((await f.admit()).decisions[0].resultAdmission, 'ADMITTED')
      mutate(f)
      const quarantined = await f.admit()
      assert.equal(quarantined.decisions[0].resultAdmission, 'QUARANTINED')
      assert.deepEqual(quarantined.decisions[0].results, [])
      assert.equal(f.entry.gateOutcome, 'BLOCKED_RESULT')
      if (name === 'task deleted') {
        assert.equal(f.entry.submissionState, 'UNKNOWN')
        assert.equal(f.entry.taskStatus, undefined)
      }
      assert.equal((await f.admit()).decisions[0].resultAdmission, 'QUARANTINED')
    })
  }
})


test('并发结果轮询跨实例返回同一安全结论且只保存一条 admitted 观察', async (t) => {
  const f = await buildGenerateHarness(t)
  await prepareAdmission(f)
  const output = result('result-1')
  finish(f, [output]); f.assets.set(output.assetId, generatedAsset(output.assetId))
  const secondEvidence = new FileResultAdmissionEvidenceStore(f.directory, { now: () => new Date(now) })
  const secondAdmission = createResultAdmission({
    tasks: { getTask: async (id) => f.tasks.get(id) },
    assets: { getAsset: async (id) => f.assets.get(id) },
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: { verifyHistoricalApproval: async () => f.receipt },
    evidence: secondEvidence, now: () => new Date(now),
  })
  const secondEntry = JSON.parse(JSON.stringify(f.entry)) as Harness['entry']
  const secondLedger = { entries: [secondEntry], save: async () => undefined }
  const [left, right] = await Promise.all([
    f.admit(),
    secondAdmission.admitResults({ userId: 'user', sessionId: 'session' }, secondLedger),
  ])
  assert.equal(left.decisions[0].resultAdmission, 'ADMITTED')
  assert.deepEqual(right.decisions[0].results, left.decisions[0].results)
  const listed = await secondEvidence.list({
    key: f.entry.key, userId: f.entry.userId, sessionId: f.entry.sessionId,
    messageId: f.entry.messageId, taskId: f.entry.taskId, actionKind: 'generate',
    requestDigest: f.entry.requestDigest, approvalDigest: f.entry.approvalDigest,
  })
  assert.equal(listed.filter((record) => record.outcome === 'admitted').length, 1)
})


interface ApprovedRetryFixture {
  action: PaidGovernedAction
  reference: StoredPreparationReference
  receipt: ApprovalReceipt
  approvalHash: string
  entry: Harness['entry']
}

async function approvedRetryFixture(
  f: Harness,
  options: { suffix: string; shotIds: string[]; attempt: number; key: string },
): Promise<ApprovedRetryFixture> {
  const execution = f.task.agentExecution!
  const preview: RetryPreviewArtifact = {
    schemaVersion: 1,
    proposalId: `retry-${options.suffix}`,
    version: 1,
    userId: 'user',
    sessionId: 'session',
    messageId: `retry-message-${options.suffix}`,
    toolName: 'task.retry_shots',
    featureType: 'garment-detail',
    assetDigests: [...execution.assetDigests],
    paramsDigest: execution.paramsDigest,
    policyVersion: 'policy-v1',
    estimatedResultCount: options.shotIds.length,
    resolvedModelId: execution.resolvedModelId,
    promptTemplateVersion: execution.promptTemplateVersion,
    blockers: [],
    riskNotices: ['重试'],
    createdAt: '2026-09-16T22:00:00.000Z',
    expiresAt: '2026-09-16T22:30:00.000Z',
    taskId,
    shotIds: [...options.shotIds],
    attempt: options.attempt,
  }
  const action: PaidGovernedAction = { actionKind: 'retry_shots', payload: preview }
  const fullDigest = await requestDigest(action)
  const receipt: ApprovalReceipt = {
    schemaVersion: 1,
    approvalId: `approval-${options.suffix}`,
    userId: 'user',
    proposalId: preview.proposalId,
    previewVersion: preview.version,
    paramsDigest: preview.paramsDigest,
    assetDigests: [...preview.assetDigests],
    requestDigest: fullDigest,
    approvedAt: '2026-09-16T22:01:00.000Z',
  }
  const approvalHash = await approvalDigest(receipt)
  const reference = await sealReference({
    schemaVersion: 1,
    key: preparationArtifactKey('user', preview.proposalId, preview.version),
    kind: 'retry_shots',
    inputDigest: await digest({ schemaVersion: 1, kind: 'retry-input', suffix: options.suffix }),
    requestDigest: fullDigest,
    inputAssetIds: [...f.task.inputAssetIds],
    sourceTaskId: taskId,
    sourceTaskStateDigest: await digest({ schemaVersion: 1, taskId, attempt: options.attempt, suffix: options.suffix }),
    artifact: preview,
  })
  const entry: Harness['entry'] = {
    schemaVersion: 1,
    recordKind: 'v1',
    actionKind: 'retry_shots',
    approvalEvidence: 'receipt',
    key: options.key,
    userId: 'user',
    sessionId: 'session',
    messageId: preview.messageId,
    toolName: preview.toolName,
    requestDigest: fullDigest,
    approvalDigest: approvalHash,
    assetDigests: [...preview.assetDigests],
    proposalId: preview.proposalId,
    previewVersion: preview.version,
    featureType: preview.featureType,
    taskId,
    providerRequestIds: [],
    submissionState: 'SUBMITTED',
    taskStatus: 'pending',
    gateOutcome: 'PASSED_PRE',
    sideEffectState: 'CONFIRMED',
    resultAdmission: 'PENDING',
    evidenceRefs: [],
    createdAt: now,
    updatedAt: now,
  }
  return { action, reference, receipt, approvalHash, entry }
}

function configureHistoricalSources(f: Harness, retries: ApprovedRetryFixture[]): void {
  const sources = [
    { action: f.action, receipt: f.receipt, approvalHash: f.approvalHash },
    ...retries.map((retry) => ({
      action: retry.action,
      receipt: retry.receipt,
      approvalHash: retry.approvalHash,
    })),
  ]
  for (const retry of retries) f.references.set(retry.reference.key, retry.reference)
  const approvals: ApprovalEvidenceStorePort = {
    async verifyHistoricalApproval(action, expectedDigest) {
      const source = sources.find((candidate) => candidate.approvalHash === expectedDigest)
      if (!source || canonicalize(source.action) !== canonicalize(action)) {
        throw new Error('approval mismatch')
      }
      return source.receipt
    },
  }
  const artifacts = { get: async (artifactKey: string) => f.references.get(artifactKey) }
  f.post = createPostSubmitVerifier({ artifacts, approvals, evidence: f.evidence })
  f.admission = createResultAdmission({
    tasks: { getTask: async (id) => f.tasks.get(id) },
    assets: { getAsset: async (id) => f.assets.get(id) },
    artifacts,
    approvals,
    evidence: f.evidence,
    now: () => new Date(now),
  })
}

async function beginRetry(
  f: Harness,
  retry: ApprovedRetryFixture,
  priorResultAssetIds: string[],
): Promise<void> {
  if (retry.action.actionKind !== 'retry_shots') throw new Error('expected retry action')
  f.task.agentExecution!.attempts!.push({
    actionKind: 'retry_shots',
    requestDigest: retry.entry.requestDigest,
    idempotencyKey: retry.entry.key,
    shotIds: [...retry.action.payload.shotIds],
    attempt: retry.action.payload.attempt,
    priorResultAssetIds: [...priorResultAssetIds],
  })
  f.task.agentExecution!.requestDigest = retry.entry.requestDigest
  f.task.agentExecution!.idempotencyKey = retry.entry.key
  f.task.status = 'pending'
  f.task.progress = 0
  f.task.message = '重试中'
  delete f.task.finishedAt
  f.tasks.set(taskId, f.task)
  const posted = await f.post.postSubmit({
    action: retry.action,
    key: retry.entry.key,
    expectedTaskId: taskId,
    approvalDigest: retry.approvalHash,
    task: f.task,
  })
  assert.equal(posted.outcome, 'accepted')
}

async function failedGenerateThenFailedRetry(t: TestContext): Promise<{
  f: Harness
  firstRetry: ApprovedRetryFixture
}> {
  const f = await buildGenerateHarness(t)
  await prepareAdmission(f)
  finish(f, [], 'failed')
  const generated = await f.admit()
  assert.equal(generated.decisions[0].resultAdmission, 'ADMITTED')
  assert.equal(generated.decisions[0].taskStatus, 'failed')

  const firstRetry = await approvedRetryFixture(f, {
    suffix: 'first', shotIds: ['detail_1'], attempt: 2, key: 'agent-v1:retry-first',
  })
  configureHistoricalSources(f, [firstRetry])
  f.ledger.entries.push(firstRetry.entry)
  await beginRetry(f, firstRetry, [])
  finish(f, [], 'failed')
  const retried = await f.admit()
  assert.equal(retried.decisions[0].resultAdmission, 'ADMITTED')
  assert.equal(retried.decisions[0].taskStatus, 'failed')
  assert.equal(retried.decisions[1].resultAdmission, 'ADMITTED')
  assert.equal(retried.decisions[1].taskStatus, 'failed')
  return { f, firstRetry }
}

test('同一资产仅轮换签名 URL 时保持 ADMITTED，并返回本次重查的最新安全 URL', async (t) => {
  const f = await buildGenerateHarness(t)
  await prepareAdmission(f)
  const output = result('result-1')
  finish(f, [output])
  const oldUrl = 'https://cdn.example.test/result-1.png?Expires=1&Signature=old'
  const newUrl = 'https://cdn.example.test/result-1.png?Expires=2&Signature=new'
  f.assets.set(output.assetId, generatedAsset(output.assetId, 'user', taskId, oldUrl))
  const first = await f.admit()
  assert.equal(first.decisions[0].resultAdmission, 'ADMITTED')
  assert.equal(first.decisions[0].results[0].url, oldUrl)

  f.assets.get(output.assetId)!.fileUrl = newUrl
  const rotated = await f.admit()
  assert.equal(rotated.decisions[0].resultAdmission, 'ADMITTED')
  assert.equal(rotated.decisions[0].results[0].url, newUrl)
  assert.equal(rotated.decisions[0].results[0].downloadUrl, newUrl)
  assert.equal(f.entry.gateOutcome, 'PASSED_PRE')

  const records = await f.evidence.list({
    key: f.entry.key,
    userId: f.entry.userId,
    sessionId: f.entry.sessionId,
    messageId: f.entry.messageId,
    taskId: f.entry.taskId,
    actionKind: 'generate',
    requestDigest: f.entry.requestDigest,
    approvalDigest: f.entry.approvalDigest,
  })
  const admittedDigests = records
    .filter((record) => record.evidenceKind === 'result_admission' && record.outcome === 'admitted')
    .map((record) => record.resultDigest)
  assert.equal(new Set(admittedDigests).size, 1)
})

test('generate 失败空结果后追加真实 retry 证据，共享 task success 不重解释历史终态', async (t) => {
  const f = await buildGenerateHarness(t)
  await prepareAdmission(f)
  finish(f, [], 'failed')
  const failedGenerate = await f.admit()
  assert.equal(failedGenerate.decisions[0].resultAdmission, 'ADMITTED')
  assert.equal(failedGenerate.decisions[0].taskStatus, 'failed')
  assert.deepEqual(failedGenerate.decisions[0].results, [])

  const retry = await approvedRetryFixture(f, {
    suffix: 'success', shotIds: ['detail_1'], attempt: 2, key: 'agent-v1:retry-success',
  })
  configureHistoricalSources(f, [retry])
  f.ledger.entries.push(retry.entry)
  await beginRetry(f, retry, [])
  const fresh = result('result-retry-success', 'detail_1')
  finish(f, [fresh], 'success')
  f.assets.set(fresh.assetId, generatedAsset(fresh.assetId))

  const admitted = await f.admit()
  assert.equal(admitted.decisions.length, 2)
  assert.deepEqual(admitted.decisions.map((decision) => ({
    key: decision.key,
    admission: decision.resultAdmission,
    status: decision.taskStatus,
    assets: decision.results.map((item) => item.assetId),
  })), [
    { key: f.entry.key, admission: 'ADMITTED', status: 'failed', assets: [] },
    { key: retry.entry.key, admission: 'ADMITTED', status: 'success', assets: [fresh.assetId] },
  ])
  assert.deepEqual(f.ledger.entries.map((entry) => entry.resultAdmission), ['ADMITTED', 'ADMITTED'])
  assert.deepEqual(f.ledger.entries.map((entry) => entry.gateOutcome), ['PASSED_PRE', 'PASSED_PRE'])
})

test('连续两次 retry 各自冻结结果窗口与历史终态，只有末轮成功图可发布', async (t) => {
  const { f, firstRetry } = await failedGenerateThenFailedRetry(t)
  const secondRetry = await approvedRetryFixture(f, {
    suffix: 'second', shotIds: ['detail_1'], attempt: 3, key: 'agent-v1:retry-second',
  })
  configureHistoricalSources(f, [firstRetry, secondRetry])
  f.ledger.entries.push(secondRetry.entry)
  await beginRetry(f, secondRetry, [])
  const fresh = result('result-second-retry', 'detail_1')
  finish(f, [fresh], 'success')
  f.assets.set(fresh.assetId, generatedAsset(fresh.assetId))

  const admitted = await f.admit()
  assert.deepEqual(admitted.decisions.map((decision) => ({
    key: decision.key,
    admission: decision.resultAdmission,
    status: decision.taskStatus,
    assets: decision.results.map((item) => item.assetId),
  })), [
    { key: f.entry.key, admission: 'ADMITTED', status: 'failed', assets: [] },
    { key: firstRetry.entry.key, admission: 'ADMITTED', status: 'failed', assets: [] },
    { key: secondRetry.entry.key, admission: 'ADMITTED', status: 'success', assets: [fresh.assetId] },
  ])
  assert.deepEqual(f.ledger.entries.map((entry) => entry.resultAdmission), [
    'ADMITTED', 'ADMITTED', 'ADMITTED',
  ])
  assert.deepEqual(f.ledger.entries.map((entry) => entry.gateOutcome), [
    'PASSED_PRE', 'PASSED_PRE', 'PASSED_PRE',
  ])

  const cases: Array<[string, (candidate: Harness) => void]> = [
    ['latest success incomplete', (candidate) => finish(candidate, [], 'success')],
    ['latest attempt exceeds approved count', (candidate) => {
      const one = result('result-over-1', 'detail_1')
      const two = result('result-over-2', 'detail_1')
      finish(candidate, [one, two], 'success')
      candidate.assets.set(one.assetId, generatedAsset(one.assetId))
      candidate.assets.set(two.assetId, generatedAsset(two.assetId))
    }],
    ['latest attempt uses wrong shot', (candidate) => {
      const wrong = result('result-wrong-shot', 'detail_2')
      finish(candidate, [wrong], 'success')
      candidate.assets.set(wrong.assetId, generatedAsset(wrong.assetId))
    }],
    ['latest attempt baseline is reordered', (candidate) => {
      candidate.task.agentExecution!.attempts![2].priorResultAssetIds = ['forged-prior']
      const one = result('result-bad-baseline', 'detail_1')
      finish(candidate, [one], 'success')
      candidate.assets.set(one.assetId, generatedAsset(one.assetId))
    }],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, async (subtest) => {
      const prepared = await failedGenerateThenFailedRetry(subtest)
      const last = await approvedRetryFixture(prepared.f, {
        suffix: `negative-${name}`,
        shotIds: ['detail_1'],
        attempt: 3,
        key: `agent-v1:negative-${name}`,
      })
      configureHistoricalSources(prepared.f, [prepared.firstRetry, last])
      prepared.f.ledger.entries.push(last.entry)
      await beginRetry(prepared.f, last, [])
      mutate(prepared.f)
      const decisions = await prepared.f.admit()
      const latest = decisions.decisions.find((decision) => decision.key === last.entry.key)
      assert.ok(latest)
      assert.equal(latest.resultAdmission, 'QUARANTINED')
      assert.deepEqual(latest.results, [])
      assert.equal(last.entry.gateOutcome, 'BLOCKED_RESULT')
    })
  }
})

test('历史单 shot retry 准入期间后续批准 retry 完成时各自窗口保持可准入', async (t) => {
  const f = await buildGenerateHarness(t, [
    { shotId: 'detail_1', label: '领口细节', referenceAssetId: null },
    { shotId: 'detail_2', label: '面料细节', referenceAssetId: null },
  ])
  await prepareAdmission(f)
  finish(f, [], 'partial')
  assert.equal((await f.admit()).decisions[0].resultAdmission, 'ADMITTED')

  const firstRetry = await approvedRetryFixture(f, {
    suffix: 'concurrent-first', shotIds: ['detail_1'], attempt: 2,
    key: 'agent-v1:retry-concurrent-first',
  })
  configureHistoricalSources(f, [firstRetry])
  f.ledger.entries.push(firstRetry.entry)
  await beginRetry(f, firstRetry, [])
  const firstResult = result('result-concurrent-first', 'detail_1')
  finish(f, [firstResult], 'partial')
  f.assets.set(firstResult.assetId, generatedAsset(firstResult.assetId))
  const initiallyAdmitted = await f.admit()
  const initialFirstDecision = initiallyAdmitted.decisions.find(
    (decision) => decision.key === firstRetry.entry.key,
  )
  assert.ok(initialFirstDecision)
  assert.equal(initialFirstDecision.resultAdmission, 'ADMITTED')
  assert.equal(initialFirstDecision.taskStatus, 'partial')
  assert.deepEqual(initialFirstDecision.results.map((item) => item.assetId), [firstResult.assetId])

  const secondRetry = await approvedRetryFixture(f, {
    suffix: 'concurrent-second', shotIds: ['detail_2'], attempt: 3,
    key: 'agent-v1:retry-concurrent-second',
  })
  configureHistoricalSources(f, [firstRetry, secondRetry])
  f.ledger.entries.push(secondRetry.entry)
  await beginRetry(f, secondRetry, [firstResult.assetId])
  f.task.status = 'running'
  f.task.progress = 50
  f.task.message = '第二个重试运行中'
  f.tasks.set(taskId, f.task)
  assert.equal(secondRetry.entry.submissionState, 'SUBMITTED')

  const secondResult = result('result-concurrent-second', 'detail_2')
  f.assets.set(secondResult.assetId, generatedAsset(secondResult.assetId))
  const sources = [
    { action: f.action, receipt: f.receipt, approvalHash: f.approvalHash },
    { action: firstRetry.action, receipt: firstRetry.receipt, approvalHash: firstRetry.approvalHash },
    { action: secondRetry.action, receipt: secondRetry.receipt, approvalHash: secondRetry.approvalHash },
  ]
  let appended = false
  f.admission = createResultAdmission({
    tasks: { getTask: async (id) => f.tasks.get(id) },
    assets: {
      getAsset: async (id) => {
        if (id === firstResult.assetId && !appended) {
          appended = true
          await Promise.resolve()
          Object.assign(f.task, {
            results: [firstResult, secondResult],
            resultAssetIds: [firstResult.assetId, secondResult.assetId],
            status: 'success' as const,
            progress: 100,
            message: '全部完成',
            finishedAt: now,
          })
          f.tasks.set(taskId, f.task)
        }
        return f.assets.get(id)
      },
    },
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: {
      async verifyHistoricalApproval(action, expectedDigest) {
        const source = sources.find((candidate) => candidate.approvalHash === expectedDigest)
        if (!source || canonicalize(source.action) !== canonicalize(action)) {
          throw new Error('approval mismatch')
        }
        return source.receipt
      },
    },
    evidence: f.evidence,
    now: () => new Date(now),
  })

  const concurrent = await f.admit()
  assert.equal(appended, true)
  assert.deepEqual(f.task.resultAssetIds, [firstResult.assetId, secondResult.assetId])
  assert.deepEqual(f.task.results.map((item) => item.assetId), [firstResult.assetId, secondResult.assetId])

  const firstRecords = await f.evidence.list({
    key: firstRetry.entry.key,
    userId: firstRetry.entry.userId,
    sessionId: firstRetry.entry.sessionId,
    messageId: firstRetry.entry.messageId,
    taskId: firstRetry.entry.taskId,
    actionKind: 'retry_shots',
    requestDigest: firstRetry.entry.requestDigest,
    approvalDigest: firstRetry.entry.approvalDigest,
  })
  assert.deepEqual(firstRecords
    .filter((record) => record.evidenceKind === 'result_admission' && record.outcome === 'quarantined')
    .flatMap((record) => record.reasonCodes), [])

  const firstDecision = concurrent.decisions.find((decision) => decision.key === firstRetry.entry.key)
  const secondDecision = concurrent.decisions.find((decision) => decision.key === secondRetry.entry.key)
  assert.ok(firstDecision)
  assert.ok(secondDecision)
  assert.equal(firstDecision.resultAdmission, 'ADMITTED')
  assert.deepEqual(firstDecision.results.map((item) => item.assetId), [firstResult.assetId])
  assert.equal(secondDecision.resultAdmission, 'ADMITTED')
  assert.deepEqual(secondDecision.results.map((item) => item.assetId), [secondResult.assetId])
  assert.equal(firstRetry.entry.gateOutcome, 'PASSED_PRE')
  assert.equal(secondRetry.entry.gateOutcome, 'PASSED_PRE')
})

test('真实 dress/suit normalizer 可选 undefined 与 JSON 往返使用同一 action 参数事实', async (t) => {
  for (const childrensCategory of ['dress', 'suit'] as const) {
    await t.test(childrensCategory, async (subtest) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), `agent-c8-photo-${childrensCategory}-`))
      subtest.after(() => rm(directory, { recursive: true, force: true }))
      const params: PhotoFissionParams = normalizePhotoFissionParams({
        model: 'nano-banana-2', category: 'childrens', childrensCategory,
        hasFrontDetail: false, hasBackDetail: false, imageRatio: '3:4', resolution: '2k', resultCount: 2,
      }, 1, ['asset_1'])
      assert.deepEqual(Object.keys(params).filter((field) =>
        (params as unknown as Record<string, unknown>)[field] === undefined), ['pantsMainHandVisibility'])
      const persistedParams = JSON.parse(JSON.stringify(params)) as PhotoFissionParams
      assert.equal(await paramsDigest('photo-fission', params), await paramsDigest('photo-fission', persistedParams))
      assert.throws(() => canonicalize({ schemaVersion: 2, common: { params } }), /unsupported JSON value/)

      const frozenParamsDigest = await paramsDigest('photo-fission', params)
      const shotId = params.shotPlan[0].shotId
      const retryKey = `agent-v1:retry:photo-${childrensCategory}`
      const preview: RetryPreviewArtifact = {
        schemaVersion: 1, proposalId: `photo-${childrensCategory}`, version: 1,
        userId: 'user', sessionId: 'session', messageId: `photo-${childrensCategory}-message`,
        toolName: 'task.retry_shots', featureType: 'photo-fission', assetDigests: [inputDigest],
        paramsDigest: frozenParamsDigest, policyVersion: 'policy-v1', estimatedResultCount: 1,
        resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'photo-fission-v1', blockers: [],
        riskNotices: ['重试'], createdAt: '2026-09-16T22:00:00.000Z',
        expiresAt: '2026-09-16T22:30:00.000Z', taskId, shotIds: [shotId], attempt: 1,
      }
      const action = { actionKind: 'retry_shots' as const, payload: preview }
      const fullDigest = await requestDigest(action)
      const receipt: ApprovalReceipt = {
        schemaVersion: 1, approvalId: `approval-photo-${childrensCategory}`, userId: 'user',
        proposalId: preview.proposalId, previewVersion: 1, paramsDigest: frozenParamsDigest,
        assetDigests: [inputDigest], requestDigest: fullDigest, approvedAt: '2026-09-16T22:01:00.000Z',
      }
      const approvalHash = await approvalDigest(receipt)
      const reference = await sealReference({
        schemaVersion: 1, key: preparationArtifactKey('user', preview.proposalId, 1),
        kind: 'retry_shots', inputDigest: '4'.repeat(64), requestDigest: fullDigest,
        inputAssetIds: [inputAssetId], sourceTaskId: taskId, sourceTaskStateDigest: '5'.repeat(64),
        artifact: preview,
      })
      const task: GenerationTask = {
        taskId, userId: 'user', featureType: 'photo-fission', workflowId: 'workflow',
        inputAssetIds: [inputAssetId], params, status: 'pending', progress: 0, message: '重试中',
        resultAssetIds: [], results: [], creditsUsed: 0, createdAt: now,
        agentExecution: {
          schemaVersion: 1, paramsDigest: frozenParamsDigest, assetDigests: [inputDigest],
          resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'photo-fission-v1',
          normalizationSeed: null, requestDigest: fullDigest, idempotencyKey: retryKey,
          attempts: [{ actionKind: 'retry_shots', requestDigest: fullDigest, idempotencyKey: retryKey,
            shotIds: [shotId], attempt: 1, priorResultAssetIds: [] }],
        },
      }
      const entry: Harness['entry'] = {
        schemaVersion: 1, recordKind: 'v1', actionKind: 'retry_shots', approvalEvidence: 'receipt',
        key: retryKey, userId: 'user', sessionId: 'session', messageId: preview.messageId,
        toolName: preview.toolName, requestDigest: fullDigest, approvalDigest: approvalHash,
        assetDigests: [inputDigest], proposalId: preview.proposalId, previewVersion: 1,
        featureType: 'photo-fission', taskId, providerRequestIds: [], submissionState: 'SUBMITTED',
        taskStatus: 'pending', gateOutcome: 'PASSED_PRE', sideEffectState: 'CONFIRMED',
        resultAdmission: 'PENDING', evidenceRefs: [], createdAt: now, updatedAt: now,
      }
      const f = buildHarness(subtest, { directory, action, preview, reference, receipt, approvalHash, task, entry })
      await prepareAdmission(f)
      const output = result(`result-photo-${childrensCategory}`, shotId)
      finish(f, [output], 'success')
      f.assets.set(output.assetId, generatedAsset(output.assetId))
      const persistedTask = JSON.parse(JSON.stringify(f.task)) as GenerationTask
      let taskReads = 0
      f.admission = createResultAdmission({
        tasks: { getTask: async () => taskReads++ === 0 ? f.task : persistedTask },
        assets: { getAsset: async (assetId) => f.assets.get(assetId) },
        artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
        approvals: { verifyHistoricalApproval: async () => receipt }, evidence: f.evidence,
        now: () => new Date(now),
      })
      const admitted = await f.admit()
      assert.equal(admitted.decisions[0].resultAdmission, 'ADMITTED')
      assert.deepEqual(admitted.decisions[0].results.map((item) => item.assetId), [output.assetId])

      if (childrensCategory === 'dress') {
        ;(f.task.params as unknown as Record<string, unknown>).imageRatio = undefined
        f.tasks.set(taskId, f.task)
        f.admission = createResultAdmission({
          tasks: { getTask: async () => f.tasks.get(taskId) },
          assets: { getAsset: async (assetId) => f.assets.get(assetId) },
          artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
          approvals: { verifyHistoricalApproval: async () => receipt }, evidence: f.evidence,
          now: () => new Date(now),
        })
        const invalid = await f.admit()
        assert.equal(invalid.decisions[0].resultAdmission, 'QUARANTINED')
        assert.deepEqual(invalid.decisions[0].results, [])
      }
    })
  }
})

test('资产查询 await 期间任务结果对象被修改时 fail closed，不发布混合快照', async (t) => {
  const f = await buildGenerateHarness(t, [
    { shotId: 'detail_1', label: '领口细节', referenceAssetId: null },
    { shotId: 'detail_2', label: '面料细节', referenceAssetId: null },
  ])
  await prepareAdmission(f)
  const first = result('result-1', 'detail_1')
  const second = result('result-2', 'detail_2')
  finish(f, [first, second])
  f.assets.set(first.assetId, generatedAsset(first.assetId))
  f.assets.set(second.assetId, generatedAsset(second.assetId))
  let queries = 0
  f.admission = createResultAdmission({
    tasks: { getTask: async (id) => f.tasks.get(id) },
    assets: {
      getAsset: async (id) => {
        queries += 1
        if (queries === 1) {
          await Promise.resolve()
          f.task.results[1].shotId = 'detail_1'
        }
        return f.assets.get(id)
      },
    },
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: { verifyHistoricalApproval: async () => f.receipt },
    evidence: f.evidence,
    now: () => new Date(now),
  })

  const decision = await f.admit()
  assert.equal(decision.decisions[0].resultAdmission, 'QUARANTINED')
  assert.deepEqual(decision.decisions[0].results, [])
  assert.equal(f.entry.gateOutcome, 'BLOCKED_RESULT')
})

test('后续资产查询 await 期间已读资产转属时 fail closed，不发布旧安全视图', async (t) => {
  const f = await buildGenerateHarness(t, [
    { shotId: 'detail_1', label: '领口细节', referenceAssetId: null },
    { shotId: 'detail_2', label: '面料细节', referenceAssetId: null },
  ])
  await prepareAdmission(f)
  const first = result('result-1', 'detail_1')
  const second = result('result-2', 'detail_2')
  finish(f, [first, second])
  f.assets.set(first.assetId, generatedAsset(first.assetId))
  f.assets.set(second.assetId, generatedAsset(second.assetId))
  let queries = 0
  f.admission = createResultAdmission({
    tasks: { getTask: async (id) => f.tasks.get(id) },
    assets: {
      getAsset: async (id) => {
        queries += 1
        if (queries === 2) {
          await Promise.resolve()
          f.assets.get(first.assetId)!.userId = 'other'
        }
        return f.assets.get(id)
      },
    },
    artifacts: { get: async (artifactKey) => f.references.get(artifactKey) },
    approvals: { verifyHistoricalApproval: async () => f.receipt },
    evidence: f.evidence,
    now: () => new Date(now),
  })

  const decision = await f.admit()
  assert.equal(decision.decisions[0].resultAdmission, 'QUARANTINED')
  assert.deepEqual(decision.decisions[0].results, [])
  assert.equal(f.entry.gateOutcome, 'BLOCKED_RESULT')
})
