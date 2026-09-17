import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { NextRequest } from 'next/server'
import { createEventsPostHandler } from '@/app/api/events/handler'
import { canonicalize } from '@/lib/agent/contracts'
import { AgentEventStore, AgentObservabilityError, recordThenInvoke, type ModelRequestSnapshot,
  type RecordModelRequestInput, type RecordTurnCompletionInput, type RequestScope, type TurnScope } from './event-store'
import { recordAgentEvent, type AgentEvent, type AgentEventName } from './events'

const turnScope: TurnScope = { userId: 'user_1', sessionId: 'session_1', turnId: 'turn_1' }
const scope: RequestScope = { ...turnScope, requestId: 'request_1' }
const errorCode = (code: AgentObservabilityError['code']) =>
  (error: unknown) => error instanceof AgentObservabilityError && error.code === code
const errnoCode = (code: string) =>
  (error: unknown) => error instanceof Error && 'code' in error && error.code === code

function requestInput(): RecordModelRequestInput {
  return {
    ...scope, createdAt: '2026-09-16T00:00:00.000Z', promptVersion: 'planner-v1',
    route: { lane: 'structured_decision', routerVersion: 'v1' }, toolTrace: [{ tool: 'asset.inspect' }],
    request: { schemaVersion: 1, model: 'planner-model', messages: [
      { role: 'system', content: '输出结构化方案。' },
      { role: 'user', content: '保留服装款式。' },
    ], parameters: { temperature: 0.4, response_format: { type: 'json_object' } } },
  }
}

function completionInput(): RecordTurnCompletionInput {
  return {
    ...turnScope,
    inputDigest: 'a'.repeat(64),
    route: { lane: 'direct_answer', routerVersion: 'v1', reasoningMode: 'direct' },
    budgetUsage: { modelCalls: 0, toolCalls: 0, elapsedMs: 12 },
    toolTrace: [],
    stopReason: 'completed_without_model',
    requestIds: [],
    outcome: { status: 'completed', responseKind: 'direct_answer', reasonCode: null, resultUrl: '/api/agent/results/1',
      content: '用户询问 Bearer ABCD、/tmp/catalog 与 C:\\catalog\\dress.png 的含义，这些只是业务文本。' },
    startedAt: '2026-09-16T00:00:00.000Z',
    completedAt: '2026-09-16T00:00:00.012Z',
  }
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-events-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new AgentEventStore(directory)
  const requestDirectory = path.join(directory, 'requests', scope.userId, scope.sessionId, scope.turnId)
  const completionDirectory = path.join(directory, 'completions', turnScope.userId, turnScope.sessionId, turnScope.turnId)
  return { directory, requestDirectory, completionDirectory, store,
    artifactPath: path.join(requestDirectory, `${scope.requestId}.request.json`),
    turnPath: path.join(requestDirectory, `${scope.requestId}.turn.json`),
    completionPath: path.join(completionDirectory, 'completion.json'),
  }
}

test('TurnRecord 与请求重启后完整重建，返回句柄不包含本地路径', async (t) => {
  const f = await fixture(t)
  const input = requestInput()
  const recorded = await f.store.recordModelRequest(input)
  const restarted = new AgentEventStore(f.directory)
  const rebuilt = await restarted.reconstructRequest(scope)
  assert.deepEqual(rebuilt.request, input.request)
  assert.deepEqual(rebuilt.record, recorded)
  assert.equal(rebuilt.record.promptVersion, input.promptVersion)
  assert.deepEqual(rebuilt.record.toolTrace, input.toolTrace)
  assert.equal(rebuilt.record.stopReason, null)
  assert.equal(JSON.stringify(recorded).includes(f.directory), false)
  assert.equal(recorded.contextArtifactId, scope.requestId)
})

test('recordThenInvoke 只向模型传磁盘重建快照，记录与重建完成后才调用', async (t) => {
  const f = await fixture(t)
  const input = requestInput()
  const order: string[] = []
  const store = {
    recordModelRequest: async (value: RecordModelRequestInput) => {
      const result = await f.store.recordModelRequest(value)
      order.push('persisted')
      // 原对象后续被修改不得改变模型实际看见的请求。
      value.request.messages = [{ role: 'user', content: '未入账的内容' }]
      return result
    },
    reconstructRequest: async (value: RequestScope) => {
      const result = await f.store.reconstructRequest(value)
      order.push('rebuilt')
      return result
    },
  }
  const original = structuredClone(input.request)
  const output = await recordThenInvoke(store, input, async (request) => {
    order.push('invoked')
    assert.ok(await readFile(f.artifactPath, 'utf8'))
    assert.ok(await readFile(f.turnPath, 'utf8'))
    assert.deepEqual(request, original)
    return 'plan'
  })
  assert.equal(output, 'plan')
  assert.deepEqual(order, ['persisted', 'rebuilt', 'invoked'])
})

test('同 ID 同内容跨实例并发幂等，不同内容冲突且不可覆盖', async (t) => {
  const f = await fixture(t)
  const input = requestInput()
  const outputs = await Promise.all(Array.from({ length: 12 }, () => new AgentEventStore(f.directory).recordModelRequest(input)))
  for (const output of outputs) assert.deepEqual(output, outputs[0])
  const previous = await readFile(f.artifactPath, 'utf8')
  const changed = requestInput(); changed.request.messages = [{ role: 'user', content: '不同请求' }]
  await assert.rejects(f.store.recordModelRequest(changed), errorCode('RECORD_CONFLICT'))
  await assert.rejects(f.store.recordModelRequest({ ...input, promptVersion: 'changed' }), errorCode('RECORD_CONFLICT'))
  assert.equal(await readFile(f.artifactPath, 'utf8'), previous)
  assert.equal((await readdir(f.requestDirectory)).filter((name) => name.endsWith('.tmp')).length, 0)
})

test('并发首次写入不同请求，只能有一个完整胜出', async (t) => {
  const f = await fixture(t)
  const first = requestInput(); const second = requestInput()
  second.request.parameters.temperature = 0.8
  const result = await Promise.allSettled([f.store.recordModelRequest(first), new AgentEventStore(f.directory).recordModelRequest(second)])
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(result.filter((item) => item.status === 'rejected').length, 1)
  const replay = await f.store.reconstructRequest(scope)
  assert.ok([canonicalize(first.request), canonicalize(second.request)].includes(canonicalize(replay.request)))
})

test('用户、会话、轮次隔离，文件身份被移植时拒绝重建', async (t) => {
  const f = await fixture(t)
  await f.store.recordModelRequest(requestInput())
  for (const changedScope of [{ ...scope, userId: 'user_2' }, { ...scope, sessionId: 'session_2' }, { ...scope, turnId: 'turn_2' }]) {
    await assert.rejects(f.store.reconstructRequest(changedScope))
  }
  const artifact = JSON.parse(await readFile(f.artifactPath, 'utf8'))
  artifact.userId = 'user_2'
  await writeFile(f.artifactPath, JSON.stringify(artifact))
  await assert.rejects(f.store.reconstructRequest(scope), errorCode('INTEGRITY_MISMATCH'))
})

test('工件篡改及摘要失配阻止重建和模型调用', async (t) => {
  const f = await fixture(t)
  const input = requestInput()
  let invocations = 0
  const wrapped = {
    recordModelRequest: async (value: RecordModelRequestInput) => {
      const record = await f.store.recordModelRequest(value)
      const artifact = JSON.parse(await readFile(f.artifactPath, 'utf8'))
      artifact.request.messages = [{ role: 'user', content: 'tampered' }]
      await writeFile(f.artifactPath, JSON.stringify(artifact))
      return record
    },
    reconstructRequest: (value: RequestScope) => f.store.reconstructRequest(value),
  }
  await assert.rejects(recordThenInvoke(wrapped, input, async () => { invocations++; }), errorCode('INTEGRITY_MISMATCH'))
  assert.equal(invocations, 0)
  await assert.rejects(f.store.recordModelRequest(input), errorCode('RECORD_CONFLICT'))
})

test('TurnRecord 部分写入失败时禁止模型调用，已有工件不会被视为完成', async (t) => {
  const f = await fixture(t)
  await mkdir(f.turnPath, { recursive: true })
  let invocations = 0
  await assert.rejects(recordThenInvoke(f.store, requestInput(), async () => { invocations++; }))
  assert.equal(invocations, 0)
  assert.ok(await readFile(f.artifactPath, 'utf8'))
  await assert.rejects(f.store.reconstructRequest(scope))
  assert.equal((await readdir(f.requestDirectory)).filter((name) => name.endsWith('.tmp')).length, 0)
})

test('缺失、损坏记录不能回退空上下文或继续调用模型', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.store.reconstructRequest(scope))
  await f.store.recordModelRequest(requestInput())
  await writeFile(f.turnPath, '{broken json')
  await assert.rejects(f.store.reconstructRequest(scope), errorCode('STORAGE_FAILURE'))
  let invoked = false
  await assert.rejects(recordThenInvoke(f.store, requestInput(), async () => { invoked = true }))
  assert.equal(invoked, false)
})

test('路径穿越、符号链接目录及文件不能逃逸工件根目录', async (t) => {
  const f = await fixture(t)
  for (const value of ['../outside', '/tmp/outside', 'a/b', 'a\\b', '..', 'x\0y', 'a'.repeat(161)]) {
    await assert.rejects(f.store.recordModelRequest({ ...requestInput(), userId: value }), errorCode('UNSAFE_PATH'))
    await assert.rejects(f.store.reconstructRequest({ ...scope, requestId: value }), errorCode('UNSAFE_PATH'))
  }
  const outside = path.join(f.directory, 'outside')
  await mkdir(outside)
  await symlink(outside, path.join(f.directory, 'requests'))
  await assert.rejects(f.store.recordModelRequest(requestInput()), errorCode('UNSAFE_PATH'))
  assert.deepEqual(await readdir(outside), [])
  await rm(path.join(f.directory, 'requests'))
  await f.store.recordModelRequest(requestInput())
  const secretFile = path.join(outside, 'secret.json')
  await writeFile(secretFile, JSON.stringify({ protected: 'data' }))
  await rm(f.artifactPath)
  await symlink(secretFile, f.artifactPath)
  await assert.rejects(f.store.reconstructRequest(scope))
  assert.equal(await readFile(secretFile, 'utf8'), '{"protected":"data"}')
})

test('零模型 Turn completion 强写后可重启回放，且不伪造 request 工件', async (t) => {
  const f = await fixture(t)
  assert.equal(await f.store.getTurnCompletion(turnScope), undefined)
  const input = completionInput()
  const recorded = await f.store.recordTurnCompletion(input)
  assert.deepEqual(recorded.requestIds, [])
  assert.deepEqual(recorded.toolTrace, [])
  assert.equal(recorded.budgetUsage.modelCalls, 0)
  assert.match(recorded.completionDigest, /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(recorded).includes(f.directory), false)

  const replayed = await new AgentEventStore(f.directory).getTurnCompletion(turnScope)
  assert.deepEqual(replayed, recorded)
  await assert.rejects(readFile(f.artifactPath, 'utf8'), errnoCode('ENOENT'))
  await assert.rejects(readFile(f.turnPath, 'utf8'), errnoCode('ENOENT'))
  await assert.rejects(readdir(path.join(f.directory, 'requests')), errnoCode('ENOENT'))
})

test('Turn completion 同身份同内容并发幂等，不同内容 RECORD_CONFLICT 且不可覆盖', async (t) => {
  const f = await fixture(t)
  const input = completionInput()
  const outputs = await Promise.all(Array.from({ length: 12 }, () =>
    new AgentEventStore(f.directory).recordTurnCompletion(input)))
  for (const output of outputs) assert.deepEqual(output, outputs[0])
  const previous = await readFile(f.completionPath, 'utf8')

  await assert.rejects(f.store.recordTurnCompletion({
    ...completionInput(), outcome: { status: 'blocked', reasonCode: 'budget_exhausted' },
  }), errorCode('RECORD_CONFLICT'))
  await assert.rejects(f.store.recordTurnCompletion({
    ...completionInput(), inputDigest: 'b'.repeat(64),
  }), errorCode('RECORD_CONFLICT'))
  assert.equal(await readFile(f.completionPath, 'utf8'), previous)
  assert.equal((await readdir(f.completionDirectory)).filter((name) => name.endsWith('.tmp')).length, 0)
})

test('Turn completion 损坏、摘要失配及身份移植全部 fail closed', async (t) => {
  const f = await fixture(t)
  await f.store.recordTurnCompletion(completionInput())
  const original = await readFile(f.completionPath, 'utf8')
  const originalRecord = JSON.parse(original) as Record<string, unknown>

  await writeFile(f.completionPath, JSON.stringify({ ...originalRecord, outcome: { status: 'tampered' } }))
  await assert.rejects(f.store.getTurnCompletion(turnScope), errorCode('INTEGRITY_MISMATCH'))

  await writeFile(f.completionPath, JSON.stringify({ ...originalRecord, completionDigest: 'f'.repeat(64) }))
  await assert.rejects(f.store.getTurnCompletion(turnScope), errorCode('INTEGRITY_MISMATCH'))

  await writeFile(f.completionPath, JSON.stringify({ ...originalRecord, inputDigest: 'invalid' }))
  await assert.rejects(f.store.getTurnCompletion(turnScope), errorCode('INTEGRITY_MISMATCH'))

  await writeFile(f.completionPath, JSON.stringify({ ...originalRecord, userId: 'user_2' }))
  await assert.rejects(f.store.getTurnCompletion(turnScope), errorCode('INTEGRITY_MISMATCH'))

  await writeFile(f.completionPath, '{broken json')
  await assert.rejects(f.store.getTurnCompletion(turnScope), errorCode('STORAGE_FAILURE'))
})

test('Turn completion 拒绝凭据、原始错误、CoT 与本地路径字段，不静默剥离', async (t) => {
  const f = await fixture(t)
  const unsafe: Array<Partial<RecordTurnCompletionInput>> = [
    { outcome: { apiKey: 'credential-value' } },
    { toolTrace: [{ tool: 'asset.inspect', rawError: 'provider stack' }] },
    { outcome: { chainOfThought: 'private reasoning tokens' } },
    { outcome: { filePath: '/Volumes/private/result.json' } },
  ]
  for (const patch of unsafe) {
    await assert.rejects(f.store.recordTurnCompletion({ ...completionInput(), ...patch }), errorCode('INVALID_RECORD'))
  }
  assert.deepEqual(await readdir(f.directory), [])
})

test('Turn completion 的符号链接目录和文件均 fail closed，且外部文件不被覆盖', async (t) => {
  const f = await fixture(t)
  const outside = path.join(f.directory, 'outside-completion')
  await mkdir(outside)
  await symlink(outside, path.join(f.directory, 'completions'))
  await assert.rejects(f.store.recordTurnCompletion(completionInput()), errorCode('UNSAFE_PATH'))
  assert.deepEqual(await readdir(outside), [])

  await rm(path.join(f.directory, 'completions'))
  await f.store.recordTurnCompletion(completionInput())
  const protectedFile = path.join(outside, 'protected.json')
  await writeFile(protectedFile, '{"protected":true}')
  await rm(f.completionPath)
  await symlink(protectedFile, f.completionPath)
  await assert.rejects(f.store.getTurnCompletion(turnScope),
    (error: unknown) => error instanceof AgentObservabilityError)
  await assert.rejects(f.store.recordTurnCompletion(completionInput()),
    (error: unknown) => error instanceof AgentObservabilityError)
  assert.equal(await readFile(protectedFile, 'utf8'), '{"protected":true}')
  assert.equal((await readdir(f.completionDirectory)).filter((name) => name.endsWith('.tmp')).length, 0)
})

test('transport 凭据拒绝写入，不静默剥离或改写请求', async (t) => {
  const f = await fixture(t)
  for (const patch of [{ headers: { Authorization: 'secret' } }, { apiKey: 'secret' }]) {
    const input = requestInput()
    input.request = { ...input.request, ...patch } as ModelRequestSnapshot
    await assert.rejects(f.store.recordModelRequest(input), errorCode('INVALID_RECORD'))
  }
  const input = requestInput()
  input.request.parameters = { nested: { api_key: 'secret' } }
  await assert.rejects(f.store.recordModelRequest(input), errorCode('INVALID_RECORD'))
  input.request.parameters = { baseURL: 'https://model.example.test/v1' }
  await assert.rejects(f.store.recordModelRequest(input), errorCode('INVALID_RECORD'))
  assert.deepEqual(await readdir(f.directory), [])
})

test('普通 telemetry 写失败可丢弃，强写接口和请求工件失败必须抛错', async (t) => {
  const f = await fixture(t)
  const blocker = path.join(f.directory, 'not-directory')
  await writeFile(blocker, 'blocker')
  const failing = new AgentEventStore(blocker)
  const event = { userId: scope.userId, sessionId: scope.sessionId, turnId: scope.turnId,
    name: 'turn.started' as const, data: { value: 1 } }
  assert.equal(await recordAgentEvent(failing, event), false)
  await assert.rejects(failing.appendRequiredEvent({ schemaVersion: 1, eventId: 'event_1',
    createdAt: '2026-09-16T00:00:00.000Z', ...event }), errorCode('STORAGE_FAILURE'))
  await assert.rejects(failing.recordTurnCompletion(completionInput()), errorCode('STORAGE_FAILURE'))
  let invocations = 0
  await assert.rejects(recordThenInvoke(failing, requestInput(), async () => { invocations++ }))
  assert.equal(invocations, 0)
})

test('并发追加服务端权威事件保持有效 JSONL，客户端名字不能混入', async (t) => {
  const f = await fixture(t)
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => recordAgentEvent(new AgentEventStore(f.directory), {
    userId: scope.userId, sessionId: scope.sessionId, turnId: scope.turnId, name: 'tool.admitted',
    data: { index, text: 'line one\nline two' },
  })))
  assert.ok(results.every(Boolean))
  const events = (await readFile(path.join(f.directory, 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as AgentEvent)
  assert.equal(events.length, 30)
  assert.equal(new Set(events.map((event) => event.eventId)).size, 30)
  for (const event of events) assert.equal(event.userId, scope.userId)
  assert.equal(await recordAgentEvent(f.store, { ...events[0], name: 'agent_ui.click' as AgentEventName }), false)
})

test('客户端伪造 gate、批准和任务创建事件均返回 400', async () => {
  const handler = createEventsPostHandler({ authenticate: async () => ({ userId: 'client_user' }) })
  for (const event of ['gate.pre', 'gate.result_admission', 'critique.issued', 'plan.approved', 'task.created', 'turn.started']) {
    const response = await handler(new NextRequest('http://localhost/api/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, payload: { userId: 'forged', approved: true } }),
    }))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'invalid_event')
  }
})


test('同目录不同 AgentEventStore 的 turn lock 串行，异常后也释放', async (t) => {
  const f = await fixture(t)
  const secondStore = new AgentEventStore(f.directory)
  const order: string[] = []
  let release!: () => void
  let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const releasePromise = new Promise<void>((resolve) => { release = resolve })
  const first = f.store.withTurnLock(turnScope, async () => {
    order.push('first-enter')
    entered()
    await releasePromise
    order.push('first-exit')
  })
  await enteredPromise
  const second = secondStore.withTurnLock(turnScope, async () => { order.push('second-enter') })
  await Promise.resolve()
  assert.deepEqual(order, ['first-enter'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first-enter', 'first-exit', 'second-enter'])
  await assert.rejects(f.store.withTurnLock(turnScope, async () => { throw new Error('business failure') }), /business failure/)
  await secondStore.withTurnLock(turnScope, async () => { order.push('after-error') })
  assert.equal(order.at(-1), 'after-error')
})


test('父目录别名指向同一物理 store 时 turn lock 共用身份，直接 store 根 symlink 仍拒绝', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-events-parent-alias-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const realParent = path.join(root, 'real')
  const aliasParent = path.join(root, 'alias')
  await mkdir(realParent)
  await symlink(realParent, aliasParent)

  const realStorePath = path.join(realParent, 'store')
  const aliasStorePath = path.join(aliasParent, 'store')
  const realStore = new AgentEventStore(realStorePath)
  const aliasStore = new AgentEventStore(aliasStorePath)
  let active = 0
  let maxActive = 0
  const criticalSection = async (store: AgentEventStore) => {
    await store.getTurnCompletion(turnScope)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 25))
    active -= 1
  }

  await Promise.all([
    realStore.withTurnLock(turnScope, () => criticalSection(realStore)),
    aliasStore.withTurnLock(turnScope, () => criticalSection(aliasStore)),
  ])
  assert.equal(maxActive, 1)

  const directRootAlias = path.join(root, 'direct-store-alias')
  await symlink(realStorePath, directRootAlias)
  await assert.rejects(
    new AgentEventStore(directRootAlias).withTurnLock(turnScope, async () => undefined),
    errorCode('UNSAFE_PATH'),
  )
})
