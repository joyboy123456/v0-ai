import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import type { ActionLedgerEntry } from '@/lib/agent/contracts'
import type { GenerationTask } from '@/lib/types'
import { ActionLedgerStore, migrateLegacyExecution, validateActionLedger } from './action-ledger'

const now = '2026-09-16T00:00:00.000Z'
const legacy = { key: 'key', userId: 'user', sessionId: 'session', messageId: 'message', prompt: '原始提示词', taskId: 'task', createdAt: now }
const task: GenerationTask = { taskId: 'task', userId: 'user', featureType: 'ai-fashion-photo', workflowId: 'workflow', params: {} as GenerationTask['params'], inputAssetIds: [], status: 'pending', progress: 0, message: '排队中', resultAssetIds: [], results: [], createdAt: now, creditsUsed: 0 }
const v1: ActionLedgerEntry = { schemaVersion: 1, recordKind: 'v1', actionKind: 'generate', key: 'v1-key', userId: 'user', sessionId: 'session', messageId: 'v1-message', toolName: 'generate', requestDigest: 'a'.repeat(64), approvalDigest: 'b'.repeat(64), assetDigests: ['c'.repeat(64)], approvalEvidence: 'receipt', proposalId: 'proposal', previewVersion: 1, featureType: 'ai-fashion-photo', taskId: 'v1-task', providerRequestIds: [], submissionState: 'STARTING', sideEffectState: 'POSSIBLE', gateOutcome: 'PASSED_PRE', resultAdmission: 'PENDING', evidenceRefs: [], createdAt: now, updatedAt: now }

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'action-ledger-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, filePath: path.join(directory, 'executions.json') }
}

test('旧账四格只采用任务真值，submitted 与 pending 都不推断成功', async (t) => {
  for (const submitted of [true, undefined]) for (const exists of [true, false]) {
    await t.test(`submitted=${submitted}, task=${exists}`, async (t) => {
      const f = await fixture(t)
      const old = { ...legacy, ...(submitted === undefined ? {} : { submitted }) }
      const bytes = Buffer.from(` \n${JSON.stringify([old], null, 4)}\n`)
      await writeFile(f.filePath, bytes)
      const store = new ActionLedgerStore(f.directory, { getTask: async () => exists ? task : undefined })
      const entry = (await store.read()).entries[0]
      assert.equal(entry.recordKind, 'legacy')
      assert.equal(entry.approvalEvidence, 'unavailable')
      assert.equal(entry.submissionState, exists ? 'SUBMITTED' : 'UNKNOWN')
      assert.equal(entry.sideEffectState, exists ? 'CONFIRMED' : 'POSSIBLE')
      assert.equal(entry.taskStatus, exists ? 'pending' : undefined)
      for (const [key, value] of Object.entries(old)) assert.deepEqual(Reflect.get(entry, key), value)
      assert.equal(Object.hasOwn(entry, 'submitted'), submitted !== undefined)
      assert.equal(Object.hasOwn(entry, 'approvalDigest'), false)
      assert.deepEqual(await readFile(f.filePath), bytes)
      assert.deepEqual(await readdir(f.directory), ['executions.json'])
      await store.withEntries(async (_entries, save) => save())
      assert.deepEqual(await readFile(`${f.filePath}.legacy-v0.bak`), bytes)
      const first = await readFile(f.filePath)
      await new ActionLedgerStore(f.directory).withEntries(async (_entries, save) => save())
      assert.deepEqual(await readFile(f.filePath), first)
      assert.deepEqual(await readFile(`${f.filePath}.legacy-v0.bak`), bytes)
      assert.deepEqual(await readFile(`${f.filePath}.bak`), first)
    })
  }
})

test('迁移查询异常、跨用户或返回其他taskId时保留UNKNOWN', async () => {
  for (const getTask of [async () => { throw new Error('unavailable') }, async () => ({ ...task, userId: 'other' }), async () => ({ ...task, taskId: 'other' })]) {
    const entry = await migrateLegacyExecution(legacy, { getTask }, now)
    assert.equal(entry.submissionState, 'UNKNOWN')
    assert.equal(entry.taskStatus, undefined)
    assert.deepEqual(entry.evidenceRefs, [])
  }
})

test('混合账严格保留v1，非法摘要、类型、审批和额外字段拒绝', async () => {
  const old = await migrateLegacyExecution({ ...legacy, submitted: false }, undefined, now)
  assert.deepEqual(validateActionLedger({ schemaVersion: 1, entries: [old, v1] }).entries, [old, v1])
  for (const change of [{ requestDigest: 'bad' }, { approvalDigest: 'bad' }, { assetDigests: ['bad'] }, { featureType: 'unknown' }, { approvalEvidence: 'unavailable' }, { previewVersion: 0 }, { taskStatus: 'SUCCEEDED' }, { billing: {} }]) {
    assert.throws(() => validateActionLedger({ schemaVersion: 1, entries: [{ ...v1, ...change }] }))
  }
  assert.throws(() => validateActionLedger({ schemaVersion: 1, entries: [v1, v1] }), /重复身份/)
})

test('损坏或不可读安全账拒绝操作，不用旧备份覆盖新调用证据', async (t) => {
  const f = await fixture(t)
  const bytes = '{newer-call-evidence-but-broken'
  await writeFile(f.filePath, bytes)
  await writeFile(`${f.filePath}.bak`, JSON.stringify({ schemaVersion: 1, entries: [] }))
  await writeFile(`${f.filePath}.legacy-v0.bak`, '[]')
  const store = new ActionLedgerStore(f.directory)
  await assert.rejects(store.read(), /损坏/)
  assert.equal(await readFile(f.filePath, 'utf8'), bytes)
  await rm(f.filePath)
  await assert.rejects(store.read(), /历史证据/)
  await mkdir(f.filePath)
  await assert.rejects(store.read(), /无法读取/)
})

test('只在主文件与任何恢复证据都不存在时视为空账', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await new ActionLedgerStore(f.directory).read(), { schemaVersion: 1, entries: [] })
  await writeFile(`${f.filePath}.tmp-write`, '{partial')
  await assert.rejects(new ActionLedgerStore(f.directory).read(), /历史证据/)
})

test('旧原始备份独占保留；已有不同内容时拒绝迁移', async (t) => {
  const f = await fixture(t)
  const bytes = JSON.stringify([legacy])
  await writeFile(f.filePath, bytes)
  await writeFile(`${f.filePath}.legacy-v0.bak`, '[]')
  await assert.rejects(new ActionLedgerStore(f.directory).withEntries(async (_entries, save) => save()), /不一致/)
  assert.equal(await readFile(f.filePath, 'utf8'), bytes)
  assert.equal(await readFile(`${f.filePath}.legacy-v0.bak`, 'utf8'), '[]')
})

test('旧数组中伪装的新格式条目以及损坏的混合v1均拒绝', async (t) => {
  const f = await fixture(t)
  for (const value of [[v1], { schemaVersion: 1, entries: [{ ...v1, approvalDigest: null }] }]) {
    await writeFile(f.filePath, JSON.stringify(value))
    await assert.rejects(new ActionLedgerStore(f.directory).read(), /损坏/)
  }
})
