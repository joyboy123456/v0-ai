import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  approvalDigest, assetDigest, paramsDigest, requestDigest,
  type GovernedAction, type PreviewArtifact,
} from '@/lib/agent/contracts'
import type { AiFashionPhotoParams, AssetRecord } from '@/lib/types'
import { ApprovalEvidenceStore, ApprovalStore, validateVendorResult } from './approval-store'
import type {
  CurrentTaskPreparationArtifactStorePort,
} from './preparation-artifact-store'
import { preparationArtifactKey } from './preparation-artifact-store'
import type {
  StoredPreparationReference,
  TaskPreparationWithRetryPort,
} from '../action/task-preparation'

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-approval-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const scope = { userId: 'user', sessionId: 'session', messageId: 'message' }
  let authorized = true
  const dependencies = {
    authenticate: async () => scope,
    readAuthenticatedIntent: async () => { if (!authorized) throw new Error('no explicit authenticated user intent'); return { actionKind: 'classify' as const, targetId: 'main' } },
    artifacts: {} as CurrentTaskPreparationArtifactStorePort, preparation: {} as TaskPreparationWithRetryPort,
    now: () => new Date('2026-09-17T00:00:00.000Z'),
  }
  return { directory, scope, dependencies, store: new ApprovalStore(directory, dependencies), deny: () => { authorized = false } }
}

test('意图签发只能来自当前已认证请求解析器，无用户授权就不签发', async (t) => {
  const f = await fixture(t); f.deny()
  await assert.rejects(f.store.issueIntent(), /no explicit/)
})

test('意图经强写可跨实例验证，同消息同目标重复签发保持同身份', async (t) => {
  const f = await fixture(t)
  const receipt = await f.store.issueIntent()
  const restarted = new ApprovalStore(f.directory, f.dependencies)
  assert.deepEqual(await restarted.issueIntent(), receipt)
  const asset: AssetRecord = { assetId: 'main', userId: 'user', projectId: 'p', fileName: 'a', fileUrl: '/a',
    fileType: 'image/png', width: 1, height: 1, createdAt: '2026-09-17T00:00:00.000Z', taskId: null }
  const action: GovernedAction = { actionKind: 'classify', payload: { schemaVersion: 1, ...f.scope,
    assetId: 'main', assetDigest: await assetDigest(asset), intent: receipt } }
  assert.deepEqual(await restarted.verifyIntent(action), receipt)
  await assert.rejects(restarted.verifyIntent({ ...action, payload: { ...action.payload, messageId: 'forged' } }), /intent_mismatch/)
})

test('审批主文件丢失/损坏不能恢复空表或静默重签意图', async (t) => {
  for (const kind of ['missing', 'corrupt']) {
    const f = await fixture(t); await f.store.issueIntent()
    const file = path.join(f.directory, 'approvals.json')
    if (kind === 'missing') await rm(file)
    else await writeFile(file, '{}')
    await assert.rejects(new ApprovalStore(f.directory, f.dependencies).issueIntent())
  }
})

test('供应商结果绑定用户/调用键/摘要，重放返回副本且不允许覆盖', async (t) => {
  const f = await fixture(t)
  const response = { actionKind: 'classify' as const, result: { status: 'fallback' as const, assetId: 'main', category: null, confidence: null } }
  await f.store.saveVendorResult('user', 'key', 'a'.repeat(64), response)
  assert.equal(await f.store.getVendorResult('other', 'key', 'a'.repeat(64)), undefined)
  await assert.rejects(f.store.getVendorResult('user', 'key', 'b'.repeat(64)), /vendor_result_conflict/)
  assert.deepEqual(await new ApprovalStore(f.directory, f.dependencies).getVendorResult('user', 'key', 'a'.repeat(64)), response)
  await assert.rejects(f.store.saveVendorResult('user', 'key', 'b'.repeat(64), response), /vendor_result_conflict/)
})

test('分类不能把 fallback 当成功，抠图仅保存对应同源代理引用', () => {
  assert.throws(() => validateVendorResult({ actionKind: 'classify', result: { status: 'fallback', assetId: 'main', category: 'tops', confidence: 1 } }))
  assert.throws(() => validateVendorResult({ actionKind: 'classify', result: { status: 'classified', assetId: 'main', category: null, confidence: null } }))
  for (const url of ['https://temp.example.com/private', '//evil.example.com/x', '/api/cutout-sessions/other/image']) {
    assert.throws(() => validateVendorResult({ actionKind: 'cutout_prepare', result: { cutoutSessionId: 'session', preparedImageUrl: url } }))
  }
})


test('历史审批证据按原 action 与 approvalDigest 核验，不受过期或新 preview 影响', async (t) => {
  const f = await fixture(t)
  const params: AiFashionPhotoParams = {
    prompt: '原始提示', userPrompt: '原始提示', finalPrompt: '原始提示', promptMode: 'raw',
    model: 'nano-banana-2', referenceImageCount: 1, imageRatio: '1:1', resolution: '2k',
    resultCount: 1, creditsCost: 0,
  }
  const preview: PreviewArtifact = {
    schemaVersion: 1, proposalId: 'proposal', version: 1, ...f.scope,
    toolName: 'fashion_photo.create', featureType: 'ai-fashion-photo', normalizedParams: params,
    inputAssetIds: ['main'], assetDigests: ['c'.repeat(64)],
    paramsDigest: await paramsDigest('ai-fashion-photo', params), policyVersion: 'policy-v1',
    estimatedResultCount: 1, normalizationSeed: 'd'.repeat(64), resolvedModelId: 'nano-banana-2',
    promptTemplateVersion: 'ai-fashion-photo-v1', blockers: [], riskNotices: ['notice'],
    createdAt: '2026-09-16T23:00:00.000Z', expiresAt: '2026-09-16T23:30:00.000Z',
  }
  const action = { actionKind: 'generate' as const, payload: preview }
  const fullDigest = await requestDigest(action)
  const reference: StoredPreparationReference = {
    schemaVersion: 1,
    key: preparationArtifactKey('user', 'proposal', 1),
    kind: 'generate', inputDigest: 'e'.repeat(64), requestDigest: fullDigest,
    referenceDigest: 'f'.repeat(64), inputAssetIds: ['main'], sourceTaskId: null,
    sourceTaskStateDigest: null, artifact: preview,
  }
  const newer = { ...reference, key: preparationArtifactKey('user', 'proposal', 2),
    artifact: { ...preview, version: 2 } }
  f.dependencies.artifacts = {
    get: async (key) => key === reference.key ? reference : undefined,
    getLatest: async () => reference,
    saveIfAbsent: async (value) => value,
    withCurrent: async (_expected, operation) => operation(),
  }
  f.dependencies.preparation = {
    prepare: async () => preview,
    validatePrepared: async () => undefined,
    prepareRetry: async () => { throw new Error('unused') },
    validateRetry: async () => undefined,
  }
  const receipt = await f.store.issueApproval({
    proposalId: preview.proposalId, version: preview.version, paramsDigest: preview.paramsDigest,
  })
  f.dependencies.artifacts.getLatest = async () => newer

  const historical = new ApprovalEvidenceStore(f.directory)
  assert.deepEqual(
    await historical.verifyHistoricalApproval(action, await approvalDigest(receipt)),
    receipt,
  )
  await assert.rejects(
    historical.verifyHistoricalApproval({ ...action, payload: { ...preview, messageId: 'changed' } }, await approvalDigest(receipt)),
    /approval_evidence_mismatch/,
  )
  await assert.rejects(historical.verifyHistoricalApproval(action, '0'.repeat(64)), /approval_evidence_not_found/)
})
