import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { UNKNOWN_MANUAL_REVIEW_AFTER_MS } from '@/lib/agent/budget'
import type { ActionLedgerEntry, ActionLedgerRecord, LegacyLedgerEntry } from '@/lib/agent/contracts'
import type { GenerationTask } from '@/lib/types'
import { AgentBetaRepository } from '../../agent-beta/repository'
import type { TaskQueryPort } from '../ports'
import { createUnknownReconciler, type ReconciliationLedger } from './unknown-reconciler'

const userId = 'user-a'
const start = '2026-09-16T00:00:00.000Z'
const legacy: LegacyLedgerEntry = { schemaVersion: 1, recordKind: 'legacy', key: 'legacy-key', userId, sessionId: 'session', messageId: 'message', prompt: '原始提示词', taskId: 'task', createdAt: start, updatedAt: start, submitted: true, approvalEvidence: 'unavailable', submissionState: 'UNKNOWN', sideEffectState: 'POSSIBLE', gateOutcome: 'NOT_RUN', resultAdmission: 'PENDING', evidenceRefs: [] }
const task: GenerationTask = { taskId: 'task', userId, featureType: 'ai-fashion-photo', workflowId: 'workflow', params: {} as GenerationTask['params'], inputAssetIds: [], status: 'pending', progress: 0, message: '排队中', resultAssetIds: [], results: [], createdAt: start, creditsUsed: 0 }

function generated(changes: Partial<ActionLedgerEntry> = {}): ActionLedgerEntry {
  return { schemaVersion: 1, recordKind: 'v1', actionKind: 'generate', key: 'v1-key', userId, sessionId: 'session', messageId: 'v1-message', toolName: 'generate', requestDigest: 'a'.repeat(64), approvalDigest: 'b'.repeat(64), assetDigests: ['c'.repeat(64)], approvalEvidence: 'receipt', proposalId: 'proposal', previewVersion: 1, featureType: 'ai-fashion-photo', taskId: 'task', providerRequestIds: [], submissionState: 'STARTING', sideEffectState: 'POSSIBLE', gateOutcome: 'PASSED_PRE', resultAdmission: 'PENDING', evidenceRefs: [], createdAt: start, updatedAt: start, ...changes } as ActionLedgerEntry
}

async function fixture(t: TestContext, entries: ActionLedgerRecord[] = [{ ...legacy }]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unknown-reconciler-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new AgentBetaRepository(directory)
  if (entries.length) await repository.withActionLedger(async (current, save) => { current.push(...structuredClone(entries)); await save() })
  const queries: string[] = []
  let query: TaskQueryPort['getTask'] = async () => undefined
  let clock = new Date(Date.parse(start) + 500)
  let writes = 0
  const ledger: ReconciliationLedger = {
    withActionLedger: (operation, taskQuery) => repository.withActionLedger(async (current, save) => operation(current, async () => { writes++; await save() }), taskQuery),
  }
  const reconcile = createUnknownReconciler({ ledger, tasks: { getTask: async (id) => { queries.push(id); return query(id) } }, now: () => clock })
  return { directory, repository, reconcile, queries, writes: () => writes, query: (value: TaskQueryPort['getTask']) => { query = value }, time: (value: number) => { clock = new Date(value) } }
}

test('legacy和v1生成只核对稳定任务身份，pending保持pending且不自动准入', async (t) => {
  for (const source of [{ ...legacy, submissionState: 'VERIFYING' as const }, generated()]) {
    await t.test(source.recordKind, async (t) => {
      const f = await fixture(t, [source])
      f.query(async () => task)
      const summary = await f.reconcile(userId)
      const entry = (await f.repository.readActionLedger()).entries[0]
      assert.equal(summary.checkedCount, 1)
      assert.equal(summary.changedCount, 1)
      assert.deepEqual(summary.unknownKeys, [])
      assert.equal(entry.submissionState, 'SUBMITTED')
      assert.equal(entry.taskStatus, 'pending')
      assert.equal(entry.sideEffectState, 'CONFIRMED')
      assert.equal(entry.resultAdmission, source.resultAdmission)
      assert.equal(entry.gateOutcome, source.gateOutcome)
      assert.deepEqual(entry.evidenceRefs, ['task:task'])
      if (entry.recordKind === 'legacy') {
        assert.equal(entry.prompt, legacy.prompt)
        assert.equal(entry.submitted, true)
        assert.equal(entry.approvalEvidence, 'unavailable')
        assert.equal('approvalDigest' in entry, false)
      }
    })
  }
})

test('任务缺失、查询抛错、错用户或错taskId都保持UNKNOWN/POSSIBLE', async (t) => {
  const queries: TaskQueryPort['getTask'][] = [async () => undefined, async () => { throw new Error('unavailable') }, async () => ({ ...task, userId: 'other' }), async () => ({ ...task, taskId: 'other' })]
  for (const [index, query] of queries.entries()) {
    await t.test(String(index), async (t) => {
      const f = await fixture(t, [generated({ evidenceRefs: ['provider:request-1'] })])
      f.query(query)
      const result = await f.reconcile(userId)
      const entry = (await f.repository.readActionLedger()).entries[0]
      assert.equal(entry.submissionState, 'UNKNOWN')
      assert.equal(entry.sideEffectState, 'POSSIBLE')
      assert.equal(entry.taskStatus, undefined)
      assert.deepEqual(entry.evidenceRefs, ['provider:request-1'])
      assert.deepEqual(result.unknownKeys, ['v1-key'])
      assert.deepEqual(result.unverifiedKeys, ['v1-key'])
      assert.equal(result.changedCount, 1)
      assert.equal((await f.reconcile(userId)).changedCount, 0)
      assert.equal(f.writes(), 1)
    })
  }
})

test('已CONFIRMED后来任务缺失转UNKNOWN，但保留已发生证据及隔离', async (t) => {
  const source = generated({ submissionState: 'SUBMITTED', sideEffectState: 'CONFIRMED', taskStatus: 'success', resultAdmission: 'QUARANTINED', gateOutcome: 'BLOCKED_RESULT', evidenceRefs: ['task:task', 'audit:quarantine'] })
  const f = await fixture(t, [source])
  f.time(Date.parse(start) + UNKNOWN_MANUAL_REVIEW_AFTER_MS + 1)
  const summary = await f.reconcile(userId)
  const entry = (await f.repository.readActionLedger()).entries[0]
  assert.equal(entry.submissionState, 'UNKNOWN')
  assert.equal(entry.sideEffectState, 'CONFIRMED')
  assert.equal(entry.taskStatus, undefined)
  assert.deepEqual(entry.evidenceRefs, source.evidenceRefs)
  assert.equal(entry.resultAdmission, 'QUARANTINED')
  assert.equal(entry.gateOutcome, 'BLOCKED_RESULT')
  assert.deepEqual(summary.unknownKeys, ['v1-key'])
  assert.deepEqual(summary.manualReviewKeys, ['v1-key'])
  assert.equal(summary.requiresManualReview, true)
  f.query(async () => { throw new Error('still unavailable') })
  assert.equal((await f.reconcile(userId)).changedCount, 0)
  assert.equal(f.writes(), 1)
})

test('已知失败终态保持SUBMITTED/CONFIRMED，业务失败不变UNKNOWN', async (t) => {
  const f = await fixture(t)
  f.query(async () => ({ ...task, status: 'failed' }))
  const summary = await f.reconcile(userId)
  const entry = (await f.repository.readActionLedger()).entries[0]
  assert.equal(entry.submissionState, 'SUBMITTED')
  assert.equal(entry.sideEffectState, 'CONFIRMED')
  assert.equal(entry.taskStatus, 'failed')
  assert.deepEqual(summary.unknownKeys, [])
  assert.equal(summary.requiresManualReview, false)
})

test('SUBMITTED刷新真实状态，重复核实不重复证据、不写盘、不更新时间', async (t) => {
  const source = generated({ submissionState: 'SUBMITTED', sideEffectState: 'CONFIRMED', taskStatus: 'pending', evidenceRefs: ['existing:ref', 'task:task', 'task:task'] })
  const f = await fixture(t, [source])
  f.query(async () => ({ ...task, status: 'running' }))
  assert.equal((await f.reconcile(userId)).changedCount, 1)
  const first = await readFile(path.join(f.directory, 'executions.json'))
  const entry = (await f.repository.readActionLedger()).entries[0]
  assert.equal(entry.taskStatus, 'running')
  assert.deepEqual(entry.evidenceRefs, ['existing:ref', 'task:task'])
  f.time(Date.parse(start) + 1000)
  assert.equal((await f.reconcile(userId)).changedCount, 0)
  assert.equal(f.writes(), 1)
  assert.deepEqual(await readFile(path.join(f.directory, 'executions.json')), first)
})

test('任务核实成功仍保留QUARANTINED、gate和审批摘要', async (t) => {
  const source = generated({ resultAdmission: 'QUARANTINED', gateOutcome: 'BLOCKED_POST_SUBMIT', evidenceRefs: ['post:blocked'] })
  const f = await fixture(t, [source])
  f.query(async () => ({ ...task, status: 'success' }))
  await f.reconcile(userId)
  const entry = (await f.repository.readActionLedger()).entries[0]
  assert.equal(entry.resultAdmission, 'QUARANTINED')
  assert.equal(entry.gateOutcome, 'BLOCKED_POST_SUBMIT')
  assert.deepEqual(entry.evidenceRefs, ['post:blocked', 'task:task'])
  assert.equal(entry.recordKind === 'v1' && entry.approvalDigest, source.approvalDigest)
})

test('安全账save失败必须向上传播，磁盘旧事实与未知保护仍保留', async (t) => {
  const f = await fixture(t)
  f.query(async () => task)
  const original = await readFile(path.join(f.directory, 'executions.json'))
  await mkdir(path.join(f.directory, 'executions.json.tmp-write'))
  await assert.rejects(f.reconcile(userId))
  assert.deepEqual(await readFile(path.join(f.directory, 'executions.json')), original)
  assert.equal((await f.repository.readActionLedger()).entries[0].submissionState, 'UNKNOWN')
})

test('分类、抠图、取消与重试不凭原task认定动作成功', async (t) => {
  const base = { schemaVersion: 1 as const, recordKind: 'v1' as const, userId, sessionId: 'session', messageId: 'non-generation', toolName: 'tool', requestDigest: 'd'.repeat(64), assetDigests: [], providerRequestIds: [], approvalEvidence: 'explicit_user_intent' as const, approvalDigest: null, intentId: 'intent', submissionState: 'UNKNOWN' as const, sideEffectState: 'POSSIBLE' as const, gateOutcome: 'PASSED_PRE' as const, resultAdmission: 'NOT_APPLICABLE' as const, evidenceRefs: [], createdAt: start, updatedAt: start }
  const sources: ActionLedgerRecord[] = [
    { ...base, key: 'classify', actionKind: 'classify', assetId: 'asset' },
    { ...base, key: 'cutout', actionKind: 'cutout_prepare', assetId: 'asset' },
    { ...base, key: 'cancel', actionKind: 'cancel', taskId: 'task' },
    generated({ key: 'retry', actionKind: 'retry_shots', submissionState: 'UNKNOWN' }),
  ]
  const f = await fixture(t, sources)
  f.query(async () => ({ ...task, status: 'cancelled' }))
  const result = await f.reconcile(userId)
  assert.deepEqual(f.queries, [])
  assert.equal(result.checkedCount, 0)
  assert.equal(result.changedCount, 0)
  assert.deepEqual(result.unknownKeys, ['classify', 'cutout', 'cancel', 'retry'])
  assert.deepEqual((await f.repository.readActionLedger()).entries, sources)
})

test('人工核实以createdAt计算，满1小时不触发，超过1小时触发', async (t) => {
  const f = await fixture(t, [{ ...legacy, updatedAt: new Date(Date.parse(start) + UNKNOWN_MANUAL_REVIEW_AFTER_MS).toISOString() }])
  for (const [offset, expected] of [[UNKNOWN_MANUAL_REVIEW_AFTER_MS - 1, false], [UNKNOWN_MANUAL_REVIEW_AFTER_MS, false], [UNKNOWN_MANUAL_REVIEW_AFTER_MS + 1, true]] as const) {
    f.time(Date.parse(start) + offset)
    const result = await f.reconcile(userId)
    assert.equal(result.requiresManualReview, expected)
    assert.deepEqual(result.manualReviewKeys, expected ? ['legacy-key'] : [])
  }
  assert.equal(f.writes(), 0)
})

test('只查询和修改指定用户，NOT_STARTED也不主动推断或提交', async (t) => {
  const foreign = generated({ userId: 'other-user', key: 'foreign-key', taskId: 'foreign-task' })
  const unstarted = generated({ key: 'unstarted', taskId: 'not-started', submissionState: 'NOT_STARTED', sideEffectState: 'NONE' })
  const f = await fixture(t, [{ ...legacy }, foreign, unstarted])
  f.query(async () => task)
  const result = await f.reconcile(userId)
  assert.deepEqual(f.queries, ['task'])
  assert.equal(result.checkedCount, 1)
  assert.equal(result.changedCount, 1)
  assert.deepEqual((await f.repository.readActionLedger()).entries.slice(1), [foreign, unstarted])
})

test('空账即使任务存在也不扫描或补造记录，也不新建文件', async (t) => {
  const f = await fixture(t, [])
  f.query(async () => task)
  const result = await f.reconcile(userId)
  assert.equal(result.checkedCount, 0)
  assert.equal(result.changedCount, 0)
  assert.deepEqual(f.queries, [])
  assert.deepEqual(await readdir(f.directory), [])
})

test('旧数组迁移读取不会绕过用户过滤向TaskQueryPort查询其他用户', async (t) => {
  const f = await fixture(t, [])
  const old = { key: 'key', userId, sessionId: 'session', messageId: 'message', prompt: '旧提示词', taskId: 'task', createdAt: start }
  await writeFile(path.join(f.directory, 'executions.json'), JSON.stringify([old, { ...old, key: 'foreign', userId: 'other-user', taskId: 'foreign-task' }]))
  f.query(async () => task)
  await f.reconcile(userId)
  assert.deepEqual(f.queries, ['task'])
  const entries = (await f.repository.readActionLedger()).entries
  assert.equal(entries[0].submissionState, 'SUBMITTED')
  assert.equal(entries[1].submissionState, 'UNKNOWN')
  assert.equal(entries[1].sideEffectState, 'POSSIBLE')
})
