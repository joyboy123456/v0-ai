import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { canonicalize, digest } from '@/lib/agent/contracts'
import type { AgentTurnInput } from '../agent/turn'
import {
  V1_TURN_REPOSITORY_FILE,
  V1TurnRepository,
  V1TurnRepositoryError,
  computeAgentTurnInputDigest,
  v1TurnKey,
  type V1TurnSaveInput,
} from './v1-turn-repository'

const createdAt = '2026-09-17T02:00:00.000Z'

async function fixture(t: TestContext, prefix = 'agent-v1-turn-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return {
    directory,
    filePath: path.join(directory, V1_TURN_REPOSITORY_FILE),
    repository: new V1TurnRepository(directory),
  }
}

function frozenInput(text = '分析当前服装素材'): AgentTurnInput {
  return {
    identity: {
      userId: 'user_1',
      sessionId: 'session_1',
      messageId: 'message_1',
      turnId: 'turn_1',
    },
    text,
    model: 'planner-model-v1',
    parameters: { temperature: 0, response_format: { type: 'json_object' } },
    triage: {
      userId: 'user_1',
      sessionId: 'session_1',
      observerVersion: 'observer-v1',
      tokenBudget: 10_000,
      goal: { goalId: 'goal_1', userGoal: text, constraints: ['保持服装结构'] },
      taskStatus: { summary: '尚未提交任务', currentStepId: 'turn', status: 'TODO' },
      failureEvidence: [],
      platformRules: ['付费动作必须先预览并确认'],
      settings: {},
      nodes: [],
      messages: [{
        id: 'message_1',
        role: 'user',
        content: text,
        createdAt,
      }],
      historyTaskIds: [],
    },
    authorization: { allowed: true, allowedToolNames: [], purpose: 'general' },
    binding: {
      userId: 'user_1',
      sessionId: 'session_1',
      messageId: 'message_1',
      idempotencyKey: 'agent-beta:session_1:message_1',
      assetIds: { value: [], origin: 'system_policy' },
    },
    preparation: {
      userId: 'user_1',
      sessionId: 'session_1',
      messageId: 'message_1',
      proposalId: 'proposal_1',
      version: 1,
      selectedAssetIds: [],
      settings: {},
    },
  }
}

async function saveInput(text = '分析当前服装素材'): Promise<V1TurnSaveInput> {
  const input = frozenInput(text)
  return {
    userId: input.identity.userId,
    sessionId: input.identity.sessionId,
    clientMessageId: 'client_message_1',
    messageId: input.identity.messageId,
    turnId: input.identity.turnId,
    requestFingerprint: 'a'.repeat(64),
    inputDigest: await computeAgentTurnInputDigest(input),
    input,
    createdAt,
  }
}

async function rejected(operation: Promise<unknown>, code: V1TurnRepositoryError['code']): Promise<void> {
  try {
    await operation
  } catch (error) {
    assert.ok(error instanceof V1TurnRepositoryError)
    assert.equal(error.code, code)
    return
  }
  assert.fail(`expected ${code}`)
}

test('跨实例并发 saveIfAbsent 同 key 同摘要幂等，主表只保存一条冻结记录', async (t) => {
  const f = await fixture(t)
  const candidate = await saveInput()
  const stores = Array.from({ length: 10 }, (_, index) => new V1TurnRepository(
    index % 2 ? path.join(f.directory, '.') : f.directory,
  ))
  const records = await Promise.all(stores.map((store) => store.saveIfAbsent(candidate)))

  assert.ok(records.every((record) => canonicalize(record) === canonicalize(records[0])))
  assert.equal(records[0].key, v1TurnKey({
    userId: candidate.userId,
    sessionId: candidate.sessionId,
    clientMessageId: candidate.clientMessageId,
  }))
  assert.equal(records[0].inputDigest, candidate.inputDigest)
  assert.equal(records[0].requestFingerprint, candidate.requestFingerprint)
  const file = JSON.parse(await readFile(f.filePath, 'utf8')) as { entries: unknown[] }
  assert.equal(file.entries.length, 1)

  records[0].input.text = '调用方本地篡改'
  const reread = await f.repository.get({
    userId: candidate.userId,
    sessionId: candidate.sessionId,
    clientMessageId: candidate.clientMessageId,
  })
  assert.equal(reread?.input.text, '分析当前服装素材')
})

test('新实例/重启后可按 scope、三参数或稳定 key 读取原始冻结输入', async (t) => {
  const f = await fixture(t)
  const candidate = await saveInput()
  const saved = await f.repository.saveIfAbsent(candidate)
  const restarted = new V1TurnRepository(f.directory)
  const scope = { userId: candidate.userId, sessionId: candidate.sessionId, clientMessageId: candidate.clientMessageId }

  assert.deepEqual(await restarted.get(scope), saved)
  assert.deepEqual(await restarted.get(scope.userId, scope.sessionId, scope.clientMessageId), saved)
  assert.deepEqual(await restarted.get(saved.key), saved)
  assert.equal(await restarted.get({ ...scope, clientMessageId: 'missing_message' }), undefined)
})

test('同 key 的 request fingerprint 或 inputDigest 冲突均失败关闭且不覆盖首条记录', async (t) => {
  const f = await fixture(t)
  const first = await saveInput()
  const saved = await f.repository.saveIfAbsent(first)

  await rejected(f.repository.saveIfAbsent({ ...first, requestFingerprint: 'b'.repeat(64) }), 'TURN_CONFLICT')

  const changedInput = frozenInput('改成另一个请求')
  const changed: V1TurnSaveInput = {
    ...first,
    input: changedInput,
    inputDigest: await computeAgentTurnInputDigest(changedInput),
  }
  await rejected(new V1TurnRepository(path.join(f.directory, '.')).saveIfAbsent(changed), 'TURN_CONFLICT')
  assert.deepEqual(await f.repository.get(saved.key), saved)
})

test('伪造 inputDigest、身份不一致、非法 canonical 或 transport credential 在写盘前拒绝', async (t) => {
  const f = await fixture(t)
  const candidate = await saveInput()
  await rejected(f.repository.saveIfAbsent({ ...candidate, inputDigest: 'f'.repeat(64) }), 'INVALID_RECORD')
  await rejected(f.repository.saveIfAbsent({ ...candidate, messageId: 'other_message' }), 'INVALID_RECORD')

  const credentialInput = frozenInput() as AgentTurnInput & { transport?: { apiKey: string } }
  credentialInput.transport = { apiKey: 'must-not-be-persisted' }
  await rejected(f.repository.saveIfAbsent({
    ...candidate,
    input: credentialInput,
    inputDigest: await digest({ schemaVersion: 1, input: credentialInput }),
  }), 'INVALID_RECORD')

  const invalid = { ...candidate, input: { ...candidate.input, parameters: { temperature: undefined } } }
  await rejected(f.repository.saveIfAbsent(invalid as unknown as V1TurnSaveInput), 'INVALID_RECORD')
  await assert.rejects(readFile(f.filePath, 'utf8'), (error: NodeJS.ErrnoException) => error.code === 'ENOENT')
})

test('主文件 JSON/表摘要损坏及缺主文件但有写入证据均拒绝，不回退备份或空表', async (t) => {
  await t.test('invalid-json', async (subtest) => {
    const f = await fixture(subtest, 'agent-v1-turn-json-')
    const candidate = await saveInput()
    await f.repository.saveIfAbsent(candidate)
    await writeFile(f.filePath, '{RAW_CORRUPT')
    await rejected(new V1TurnRepository(f.directory).get(v1TurnKey(candidate)), 'STORAGE_UNAVAILABLE')
  })

  await t.test('outer-digest', async (subtest) => {
    const f = await fixture(subtest, 'agent-v1-turn-outer-')
    const candidate = await saveInput()
    await f.repository.saveIfAbsent(candidate)
    const file = JSON.parse(await readFile(f.filePath, 'utf8')) as { schemaVersion: 1; entries: unknown[]; digest: string }
    file.digest = '0'.repeat(64)
    await writeFile(f.filePath, canonicalize(file))
    await rejected(new V1TurnRepository(f.directory).get(v1TurnKey(candidate)), 'STORAGE_UNAVAILABLE')
  })

  await t.test('missing-main', async (subtest) => {
    const f = await fixture(subtest, 'agent-v1-turn-missing-')
    const candidate = await saveInput()
    await f.repository.saveIfAbsent(candidate)
    await rm(f.filePath)
    await rejected(new V1TurnRepository(f.directory).get(v1TurnKey(candidate)), 'STORAGE_UNAVAILABLE')
  })
})

test('即使攻击者重算表摘要，冻结 input/record 摘要损坏仍由新实例拒绝', async (t) => {
  const f = await fixture(t)
  const candidate = await saveInput()
  await f.repository.saveIfAbsent(candidate)
  const file = JSON.parse(await readFile(f.filePath, 'utf8')) as {
    schemaVersion: 1
    entries: Array<{ input: AgentTurnInput }>
    digest: string
  }
  file.entries[0].input.text = '磁盘内容被修改'
  file.digest = await digest({ schemaVersion: 1, entries: file.entries })
  await writeFile(f.filePath, canonicalize(file))

  await rejected(new V1TurnRepository(f.directory).get(v1TurnKey(candidate)), 'INTEGRITY_MISMATCH')
})
