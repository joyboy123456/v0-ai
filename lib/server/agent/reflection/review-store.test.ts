import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import sharp from 'sharp'
import { canonicalize, digest } from '@/lib/agent/contracts'
import { evaluateAcceptancePolicy } from './acceptance-policy'
import { inspectDeterministicImage } from './critic'
import { FileResultReviewStore, RESULT_REVIEW_FILE } from './review-store'

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'e1-review-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = await sharp({ create: { width: 800, height: 1_000, channels: 4, background: '#222222' } }).png().toBuffer()
  const critique = await inspectDeterministicImage({ source, expectedWidth: 800, expectedHeight: 1_000 })
  const decision = evaluateAcceptancePolicy(critique)
  const observation = {
    userId: 'user_a',
    assetId: 'asset_a',
    taskId: 'task_a',
    assetDigest: 'a'.repeat(64),
    reviewerVersion: critique.reviewerVersion,
    policyVersion: decision.policyVersion,
    c8Admission: {
      userId: 'user_a',
      sessionId: 'session_a',
      messageId: 'message_a',
      taskId: 'task_a',
      actionKey: 'agent-beta:session_a:message_a',
      actionKind: 'generate' as 'generate' | 'retry_shots',
      requestDigest: 'b'.repeat(64),
      approvalDigest: 'c'.repeat(64),
      evidenceRef: `c8:${'d'.repeat(64)}`,
      resultDigest: 'e'.repeat(64),
    },
    critique,
    decision,
  }
  return { directory, observation }
}

test('评审 receipt 绑定 immutable asset identity 和 C8 ADMITTED evidence', async (t) => {
  const f = await fixture(t)
  const store = new FileResultReviewStore(f.directory, { now: () => new Date('2026-09-17T10:00:00.000Z') })
  const first = await store.record(f.observation)
  const repeated = await store.record(f.observation)
  const restored = await new FileResultReviewStore(f.directory).get({
    assetDigest: f.observation.assetDigest,
    reviewerVersion: f.observation.reviewerVersion,
    policyVersion: f.observation.policyVersion,
  }, f.observation.c8Admission)
  assert.equal(first.created, true)
  assert.equal(repeated.created, false)
  assert.equal(first.artifact.reviewRef, repeated.artifact.reviewRef)
  assert.equal(restored?.reviewRef, first.artifact.reviewRef)
  assert.equal(first.artifact.createdAt, '2026-09-17T10:00:00.000Z')
  assert.equal(first.artifact.c8Admission.evidenceRef, f.observation.c8Admission.evidenceRef)
})

test('同一不可变图可复用计算，但每个 C8 action/evidence 有独立 receipt', async (t) => {
  const f = await fixture(t)
  const store = new FileResultReviewStore(f.directory)
  const first = await store.record(f.observation)
  const retry = structuredClone(f.observation)
  retry.c8Admission = {
    ...retry.c8Admission,
    messageId: 'message_retry',
    actionKey: 'agent-v1:retry:session_a:message_retry',
    actionKind: 'retry_shots',
    evidenceRef: `c8:${'f'.repeat(64)}`,
    resultDigest: '0'.repeat(64),
  }
  const second = await store.record(retry)
  const evaluation = await store.getEvaluation({
    assetDigest: f.observation.assetDigest,
    reviewerVersion: f.observation.reviewerVersion,
    policyVersion: f.observation.policyVersion,
  })
  assert.equal(second.created, true)
  assert.notEqual(second.artifact.reviewRef, first.artifact.reviewRef)
  assert.equal(evaluation?.assetDigest, f.observation.assetDigest)
  assert.equal(second.artifact.c8Admission.actionKind, 'retry_shots')
})

test('同一冻结 identity 不能以不同计算结论或错配 C8 身份改写', async (t) => {
  const f = await fixture(t)
  const store = new FileResultReviewStore(f.directory)
  await store.record(f.observation)
  const changed = structuredClone(f.observation)
  changed.c8Admission.evidenceRef = `c8:${'f'.repeat(64)}`
  changed.c8Admission.resultDigest = '0'.repeat(64)
  changed.decision.score = Math.max(0, changed.decision.score - 0.1)
  await assert.rejects(store.record(changed), /同一评审身份产生不同计算结果/)

  const mismatched = structuredClone(f.observation)
  mismatched.c8Admission.userId = 'other_user'
  await assert.rejects(store.record(mismatched), /C8 凭证身份不一致/)
})

test('主评审证据损坏直接失败，不从 bak 静默恢复', async (t) => {
  const f = await fixture(t)
  const store = new FileResultReviewStore(f.directory)
  await store.record(f.observation)
  const filePath = path.join(f.directory, RESULT_REVIEW_FILE)
  const file = JSON.parse(await readFile(filePath, 'utf8'))
  file.entries[0].decision.score = 0
  await writeFile(filePath, JSON.stringify(file))
  await assert.rejects(store.get({
    assetDigest: f.observation.assetDigest,
    reviewerVersion: f.observation.reviewerVersion,
    policyVersion: f.observation.policyVersion,
  }, f.observation.c8Admission), /文件摘要不一致/)
})

test('瞬时不可用留痕不得成为计算缓存，后续重评可取代它', async (t) => {
  const f = await fixture(t)
  const store = new FileResultReviewStore(f.directory)
  const identity = {
    assetDigest: f.observation.assetDigest,
    reviewerVersion: f.observation.reviewerVersion,
    policyVersion: f.observation.policyVersion,
  }
  const unavailable = await inspectDeterministicImage({
    source: Buffer.from('not-an-image'),
    expectedWidth: 800,
    expectedHeight: 1_000,
  })
  const transient = await store.record({
    ...f.observation,
    critique: unavailable,
    decision: evaluateAcceptancePolicy(unavailable),
    outcomeKind: 'transient_unavailable',
  })
  assert.equal(transient.created, true)
  // 瞬时痕迹既不能命中计算缓存，也不能命中同一 C8 receipt。
  assert.equal(await store.getEvaluation(identity), null)
  assert.equal(await store.get(identity, f.observation.c8Admission), null)

  const repeated = await store.record({
    ...f.observation,
    critique: unavailable,
    decision: evaluateAcceptancePolicy(unavailable),
    outcomeKind: 'transient_unavailable',
  })
  assert.equal(repeated.created, false, '同一 admission 的瞬时痕迹不重复堆积')

  const settled = await store.record(f.observation)
  assert.equal(settled.created, true)
  assert.equal(settled.artifact.outcomeKind, 'deterministic')
  const evaluation = await store.getEvaluation(identity)
  assert.equal(evaluation?.reviewRef, settled.artifact.reviewRef)
  assert.equal(
    (await store.get(identity, f.observation.c8Admission))?.reviewRef,
    settled.artifact.reviewRef,
  )
  const file = JSON.parse(await readFile(path.join(f.directory, RESULT_REVIEW_FILE), 'utf8'))
  assert.equal(file.entries.length, 1, '确定性结论取代瞬时痕迹，不留误导性 UNREVIEWED')
})

test('已有确定性结论后瞬时故障不再覆盖既有 receipt', async (t) => {
  const f = await fixture(t)
  const store = new FileResultReviewStore(f.directory)
  const settled = await store.record(f.observation)
  const unavailable = await inspectDeterministicImage({
    source: Buffer.from('not-an-image'),
    expectedWidth: 800,
    expectedHeight: 1_000,
  })
  const transient = await store.record({
    ...f.observation,
    critique: unavailable,
    decision: evaluateAcceptancePolicy(unavailable),
    outcomeKind: 'transient_unavailable',
  })
  assert.equal(transient.created, false)
  assert.equal(transient.artifact.reviewRef, settled.artifact.reviewRef)
  assert.equal(transient.artifact.decision.disposition, settled.artifact.decision.disposition)
})

test('旧版本写下的 receipt 没有 outcomeKind 时按确定性结论读回', async (t) => {
  const f = await fixture(t)
  const store = new FileResultReviewStore(f.directory)
  const recorded = await store.record(f.observation)
  const filePath = path.join(f.directory, RESULT_REVIEW_FILE)
  const file = JSON.parse(await readFile(filePath, 'utf8'))
  // 模拟上一版本落盘的记录：没有 outcomeKind 字段，且按当时规则重算表摘要。
  delete file.entries[0].outcomeKind
  const entries = file.entries
  await writeFile(filePath, canonicalize({
    schemaVersion: 1,
    entries,
    digest: await digest({ schemaVersion: 1, entries }),
  }))
  const restored = await new FileResultReviewStore(f.directory).getEvaluation({
    assetDigest: f.observation.assetDigest,
    reviewerVersion: f.observation.reviewerVersion,
    policyVersion: f.observation.policyVersion,
  })
  assert.equal(restored?.reviewRef, recorded.artifact.reviewRef, '旧 receipt 摘要必须仍然有效')
  assert.equal(restored?.outcomeKind, 'deterministic')
})
