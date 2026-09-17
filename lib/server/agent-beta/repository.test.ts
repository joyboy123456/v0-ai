import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import type { ActionLedgerEntry } from '@/lib/agent/contracts'
import { AgentBetaRepository } from './repository'

const now = '2026-09-16T00:00:00.000Z'
const legacy = { key: 'old', userId: 'user', sessionId: 'session', messageId: 'message', prompt: '保持旧提示词', taskId: 'task', createdAt: now }
const v1: ActionLedgerEntry = { schemaVersion: 1, recordKind: 'v1', actionKind: 'cancel', key: 'new', userId: 'user', sessionId: 'session', messageId: 'message-v1', toolName: 'cancel', requestDigest: 'a'.repeat(64), assetDigests: [], approvalDigest: null, approvalEvidence: 'explicit_user_intent', intentId: 'intent', taskId: 'task-v1', providerRequestIds: [], submissionState: 'UNKNOWN', sideEffectState: 'POSSIBLE', gateOutcome: 'PASSED_PRE', resultAdmission: 'QUARANTINED', evidenceRefs: ['intent:intent'], createdAt: now, updatedAt: now }

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-repository-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, repository: new AgentBetaRepository(directory), filePath: path.join(directory, 'executions.json') }
}

test('兼容withExecutions仅看到legacy；修改与新增不影响混合v1内容', async (t) => {
  const f = await fixture(t)
  await f.repository.withExecutions(async (records, save) => { records.push(legacy); await save() })
  await f.repository.withActionLedger(async (entries, save) => { entries.unshift(v1); await save() })
  await f.repository.withExecutions(async (records, save, access) => {
    assert.equal(records.length, 1)
    assert.equal(records[0].key, 'old')
    assert.equal(access.isBlocked('user', 'new', 'another-task'), true)
    assert.equal(access.isBlocked('other-user', 'other-key', 'task-v1'), true)
    records[0].prompt = '更新旧提示词'
    records.push({ ...legacy, key: 'another', taskId: 'another-task' })
    await save()
  })
  const file = await f.repository.readActionLedger()
  assert.deepEqual(file.entries.find((entry) => entry.recordKind === 'v1'), v1)
  assert.equal(file.entries.length, 3)
  assert.equal(JSON.parse(await readFile(f.filePath, 'utf8')).schemaVersion, 1)
})

test('withExecutions向回调暴露当前已持锁entries与save，不发生第二次取锁', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  await f.repository.withActionLedger(async (entries, save) => { entries.push(v1); await save() })
  let competingEntered = false
  let competing: Promise<void> | undefined
  await f.repository.withExecutions(async (_records, _save, _access, ledger) => {
    assert.equal(ledger.entries.length, 1)
    assert.equal(ledger.entries[0].key, v1.key)
    ledger.entries[0].evidenceRefs.push('c8:locked-context')
    competing = new AgentBetaRepository(path.join(f.directory, '.')).withActionLedger(async () => { competingEntered = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(competingEntered, false)
    await ledger.save()
  })
  await competing
  assert.equal(competingEntered, true)
  assert.deepEqual((await f.repository.readActionLedger()).entries[0].evidenceRefs,
    ['intent:intent', 'c8:locked-context'])
})

test('相同目录的不同Repository并发写入串行且不丢执行记录或会话', async (t) => {
  const f = await fixture(t)
  const repositories = [f.repository, new AgentBetaRepository(path.join(f.directory, '.'))]
  let active = 0
  let maxActive = 0
  await Promise.all(Array.from({ length: 12 }, (_, index) => repositories[index % 2].withExecutions(async (records, save) => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    records.push({ ...legacy, key: `key-${index}`, taskId: `task-${index}` })
    await save()
    active--
  })))
  assert.equal(maxActive, 1)
  assert.equal((await f.repository.readActionLedger()).entries.length, 12)
  await Promise.all(Array.from({ length: 6 }, (_, index) => repositories[index % 2].mutateUser('user', async (file) => {
    await new Promise((resolve) => setTimeout(resolve, 2))
    file.sessions.push({ id: String(index), title: 'session', createdAt: now, updatedAt: now, nodes: [], messages: [], messageFingerprints: {} })
  })))
  assert.equal((await f.repository.readUser('user')).sessions.length, 6)
})

test('混合账非法v1不能被旧兼容接口读取后洗掉', async (t) => {
  const f = await fixture(t)
  await writeFile(f.filePath, JSON.stringify({ schemaVersion: 1, entries: [{ ...v1, requestDigest: 'invalid' }] }))
  let called = false
  await assert.rejects(f.repository.withExecutions(async () => { called = true }), /损坏/)
  assert.equal(called, false)
})
