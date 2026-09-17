import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import sharp from 'sharp'
import type { AgentEvent } from '../observability/events'
import type { ResultReviewCandidate } from '../ports'
import type { AssetRecord } from '@/lib/types'
import { createResultReview } from './result-review'
import { FileResultReviewStore } from './review-store'

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'e1-result-review-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const assets = new Map<string, AssetRecord>()
  const asset: AssetRecord = {
    assetId: 'asset_result',
    userId: 'user_a',
    projectId: 'project_a',
    fileName: 'result.png',
    fileUrl: '/generated/result.png',
    fileType: 'image/png',
    width: 800,
    height: 1_000,
    taskId: 'task_a',
    createdAt: '2026-09-17T10:00:00.000Z',
  }
  assets.set(asset.assetId, asset)
  let source = await sharp({ create: { width: 800, height: 1_000, channels: 4, background: '#222222' } }).png().toBuffer()
  let reads = 0
  let failRead = false
  const events: AgentEvent[] = []
  const store = new FileResultReviewStore(directory)
  const reviewer = createResultReview({
    assets: { async getAsset(assetId) { return assets.get(assetId) } },
    async readAssetBytes() {
      reads++
      if (failRead) throw new Error('source unavailable')
      return source
    },
    store,
    events: { async appendRequiredEvent(event) { events.push(structuredClone(event)) } },
  })
  const candidate = (
    overrides: Partial<ResultReviewCandidate['c8']> = {},
  ): ResultReviewCandidate => ({
    assetId: asset.assetId,
    taskId: asset.taskId!,
    fileName: asset.fileName,
    width: asset.width,
    height: asset.height,
    c8: {
      userId: asset.userId,
      sessionId: 'session_a',
      messageId: 'message_a',
      taskId: asset.taskId!,
      actionKey: 'agent-beta:session_a:message_a',
      actionKind: 'generate',
      requestDigest: 'a'.repeat(64),
      approvalDigest: 'b'.repeat(64),
      evidenceRef: `c8:${'c'.repeat(64)}`,
      resultDigest: 'd'.repeat(64),
      ...overrides,
    },
  })
  return {
    asset,
    assets,
    reviewer,
    candidate,
    events,
    reads: () => reads,
    failRead(value: boolean) { failRead = value },
    async changeSource(width: number, height: number) {
      source = await sharp({ create: { width, height, channels: 4, background: '#222222' } }).png().toBuffer()
    },
  }
}

test('同一 C8 receipt 并发只检查一次，签名 URL 轮换复用冻结评审', async (t) => {
  const f = await fixture(t)
  const scope = { userId: 'user_a', sessionId: 'session_a' }
  const [first, concurrent] = await Promise.all([
    f.reviewer.reviewAdmittedResults(scope, [f.candidate()]),
    f.reviewer.reviewAdmittedResults(scope, [f.candidate()]),
  ])
  assert.equal(f.reads(), 1)
  assert.equal(first.decisions[0].reviewRef, concurrent.decisions[0].reviewRef)
  assert.equal(f.events.length, 1)
  assert.equal(f.events[0].name, 'critique.issued')
  assert.equal((f.events[0].data as Record<string, unknown>).c8EvidenceRef, `c8:${'c'.repeat(64)}`)

  f.asset.fileUrl = 'https://signed.example/rotated-token'
  const rotated = await f.reviewer.reviewAdmittedResults(scope, [f.candidate()])
  assert.equal(rotated.decisions[0].reused, true)
  assert.equal(rotated.decisions[0].reviewRef, first.decisions[0].reviewRef)
  assert.equal(f.reads(), 1)
  assert.equal(f.events.length, 1)
})

test('同一 immutable 图在新的 C8 retry 绑定下不重读，但强写独立 review receipt', async (t) => {
  const f = await fixture(t)
  const scope = { userId: 'user_a', sessionId: 'session_a' }
  const first = await f.reviewer.reviewAdmittedResults(scope, [f.candidate()])
  const retry = await f.reviewer.reviewAdmittedResults(scope, [f.candidate({
    messageId: 'message_retry',
    actionKey: 'agent-v1:retry:session_a:message_retry',
    actionKind: 'retry_shots',
    evidenceRef: `c8:${'e'.repeat(64)}`,
    resultDigest: 'f'.repeat(64),
  })])
  assert.equal(f.reads(), 1)
  assert.equal(retry.decisions[0].reused, true)
  assert.notEqual(retry.decisions[0].reviewRef, first.decisions[0].reviewRef)
  assert.equal(f.events.length, 2)
})

test('尺寸摘要变化视为新 artifact 并重新评审，不能继承旧图状态', async (t) => {
  const f = await fixture(t)
  const scope = { userId: 'user_a', sessionId: 'session_a' }
  const first = await f.reviewer.reviewAdmittedResults(scope, [f.candidate()])
  f.asset.width = 900
  const second = await f.reviewer.reviewAdmittedResults(scope, [f.candidate({
    evidenceRef: `c8:${'e'.repeat(64)}`,
    resultDigest: 'f'.repeat(64),
  })])
  assert.notEqual(second.decisions[0].reviewRef, first.decisions[0].reviewRef)
  assert.equal(second.decisions[0].disposition, 'SHADOW_WOULD_BLOCK')
  assert.equal(second.decisions[0].issueCodes.includes('dimension_mismatch'), true)
  assert.equal(f.reads(), 2)
})

test('读取失败留 UNREVIEWED 痕迹但不污染缓存，恢复后必须重评出确定性结论', async (t) => {
  const f = await fixture(t)
  const scope = { userId: 'user_a', sessionId: 'session_a' }
  f.failRead(true)
  const unavailable = await f.reviewer.reviewAdmittedResults(scope, [f.candidate()])
  assert.equal(unavailable.decisions[0].disposition, 'UNREVIEWED')
  assert.equal(f.events.length, 1)

  // 瞬时故障不是这张图的质量事实：下一次必须真的重读，而不是复用 UNREVIEWED。
  const retried = await f.reviewer.reviewAdmittedResults(scope, [f.candidate()])
  assert.equal(retried.decisions[0].disposition, 'UNREVIEWED')
  assert.equal(f.reads(), 2, '读图失败后必须重试，不能把瞬时故障当成缓存结论')
  assert.equal(f.events.length, 1, '同一 admission 的瞬时痕迹不重复留痕')

  f.failRead(false)
  const settled = await f.reviewer.reviewAdmittedResults(scope, [f.candidate()])
  assert.equal(settled.decisions[0].disposition, 'SHADOW_WOULD_WARN')
  assert.notEqual(settled.decisions[0].reviewRef, unavailable.decisions[0].reviewRef)
  assert.equal(f.reads(), 3)
  assert.equal(f.events.length, 2)

  // 确定性结论落盘后才允许复用。
  const reused = await f.reviewer.reviewAdmittedResults(scope, [f.candidate()])
  assert.equal(reused.decisions[0].reused, true)
  assert.equal(reused.decisions[0].reviewRef, settled.decisions[0].reviewRef)
  assert.equal(f.reads(), 3)

  await assert.rejects(
    f.reviewer.reviewAdmittedResults({ userId: 'other_user', sessionId: 'session_a' }, [f.candidate()]),
    /INVALID_CANDIDATE/,
  )
  await assert.rejects(
    f.reviewer.reviewAdmittedResults(scope, [{ ...f.candidate(), taskId: 'wrong_task' }]),
    /INVALID_CANDIDATE/,
  )
  await assert.rejects(
    f.reviewer.reviewAdmittedResults(scope, [{ ...f.candidate(), width: 1 }]),
    /ASSET_NOT_FOUND/,
  )
  await assert.rejects(
    f.reviewer.reviewAdmittedResults(scope, [f.candidate({ sessionId: 'other_session' })]),
    /INVALID_CANDIDATE/,
  )
})
