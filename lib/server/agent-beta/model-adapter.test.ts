import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { canonicalize } from '@/lib/agent/contracts'
import type { JsonValue } from '@/lib/agent/types'
import type { ModelRequestSnapshot } from '../agent/observability/event-store'
import { AgentEventStore, recordThenInvoke } from '../agent/observability/event-store'
import {
  AgentModelAdapter,
  AgentModelAdapterError,
  type AgentModelAdapterConfig,
} from './model-adapter'

interface CapturedCall {
  url: string
  init: RequestInit
}

function injectedFetch(payload: unknown, status = 200) {
  const calls: CapturedCall[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json', 'x-provider-secret': 'never-return-this' },
    })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

function adapter(config: AgentModelAdapterConfig, fetch: typeof globalThis.fetch): AgentModelAdapter {
  return new AgentModelAdapter({ config, fetch, env: {} })
}

const snapshot: ModelRequestSnapshot = {
  schemaVersion: 1,
  model: 'recorded-model-v1',
  messages: [
    { role: 'system', content: '只输出 JSON。' },
    { role: 'user', content: '{"request":"保持原样"}' },
  ],
  parameters: {
    temperature: 0,
    response_format: { type: 'json_object' },
  },
}

async function rejection(operation: Promise<unknown>): Promise<AgentModelAdapterError> {
  try {
    await operation
  } catch (error) {
    assert.ok(error instanceof AgentModelAdapterError)
    return error
  }
  assert.fail('expected AgentModelAdapterError')
}

function assertSafe(error: AgentModelAdapterError, ...secrets: string[]): void {
  const exposed = `${error.name}\n${error.message}\n${JSON.stringify(error)}`
  for (const secret of secrets) assert.equal(exposed.includes(secret), false)
  assert.equal('cause' in error, false)
}

test('OpenAI：逐字发送 A2 model/messages/parameters，单次调用且只返回 assistant JSON', async () => {
  const response = {
    id: 'provider-id-not-returned',
    headers: { authorization: 'raw-provider-key' },
    choices: [{ message: {
      role: 'assistant',
      content: '{"kind":"understanding","content":"已理解"}',
      reasoning_content: 'private chain of thought',
    } }],
  }
  const mock = injectedFetch(response)
  const model = adapter({ protocol: 'openai', baseUrl: 'https://openai.example.test/root', apiKey: 'openai-secret', timeoutMs: 1_000 }, mock.fetch)
  const result = await model.invoke(snapshot)

  assert.deepEqual(result, { kind: 'understanding', content: '已理解' })
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].url, 'https://openai.example.test/root/v1/chat/completions')
  assert.equal(mock.calls[0].init.method, 'POST')
  assert.deepEqual(mock.calls[0].init.headers, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer openai-secret',
  })
  assert.equal(mock.calls[0].init.body, canonicalize({
    model: snapshot.model,
    messages: snapshot.messages,
    ...snapshot.parameters,
  }))
  assert.ok(mock.calls[0].init.signal instanceof AbortSignal)
  assert.equal(JSON.stringify(result).includes('private chain of thought'), false)
  assert.equal(JSON.stringify(result).includes('raw-provider-key'), false)
})

test('OpenAI：parameters 不能覆盖 model/messages，前置拒绝时调用数为 0', async () => {
  const mock = injectedFetch({ choices: [{ message: { content: '{"ok":true}' } }] })
  const model = adapter({ protocol: 'openai', endpoint: 'https://openai.example.test/custom', apiKey: 'secret' }, mock.fetch)
  const error = await rejection(model.invoke({
    ...snapshot,
    parameters: { ...snapshot.parameters, model: 'unrecorded-model' },
  }))
  assert.equal(error.code, 'MODEL_REQUEST_INVALID')
  assert.equal(mock.calls.length, 0)
})

test('Anthropic：确定性提升 system、保留对话和参数，忽略 thinking 块且只调用一次', async () => {
  const anthropicSnapshot: ModelRequestSnapshot = {
    schemaVersion: 1,
    model: 'gpt-5.6-sol',
    messages: [
      { role: 'system', content: '系统内容逐字保留' },
      { role: 'user', content: '用户内容逐字保留' },
      { role: 'assistant', content: '历史助手内容逐字保留' },
      { role: 'user', content: '本轮请求逐字保留' },
    ],
    parameters: { temperature: 0, max_tokens: 2_048, top_p: 0.8 },
  }
  const mock = injectedFetch({
    content: [
      { type: 'thinking', thinking: 'private chain of thought' },
      { type: 'text', text: '{"kind":"tool_' },
      { type: 'text', text: 'result","content":"完成"}' },
    ],
    request_headers: { 'x-api-key': 'raw-anthropic-key' },
  })
  const model = adapter({
    protocol: 'anthropic',
    baseUrl: 'https://anthropic.example.test',
    apiKey: 'anthropic-secret',
    timeoutMs: 1_000,
  }, mock.fetch)
  const result = await model.invoke(anthropicSnapshot)

  assert.deepEqual(result, { kind: 'tool_result', content: '完成' })
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].url, 'https://anthropic.example.test/v1/messages')
  assert.deepEqual(mock.calls[0].init.headers, {
    'Content-Type': 'application/json',
    'x-api-key': 'anthropic-secret',
    'anthropic-version': '2023-06-01',
  })
  assert.equal(mock.calls[0].init.body, canonicalize({
    model: anthropicSnapshot.model,
    system: '系统内容逐字保留',
    messages: anthropicSnapshot.messages.slice(1),
    ...anthropicSnapshot.parameters,
  }))
  assert.equal(JSON.stringify(result).includes('private chain of thought'), false)
  assert.equal(JSON.stringify(result).includes('raw-anthropic-key'), false)
})

test('Anthropic：缺 max_tokens 时只补协议必需的确定值，不改 snapshot', async () => {
  const request: ModelRequestSnapshot = {
    schemaVersion: 1,
    model: 'claude-compatible',
    messages: [{ role: 'user', content: 'JSON only' }],
    parameters: { temperature: 0 },
  }
  const before = canonicalize(request)
  const mock = injectedFetch({ content: [{ type: 'text', text: 'null' }] })
  const model = adapter({
    protocol: 'anthropic',
    endpoint: 'https://anthropic.example.test/custom-messages',
    apiKey: 'anthropic-secret',
    maxTokens: 321,
  }, mock.fetch)
  assert.equal(await model.invoke(request), null)
  assert.equal(mock.calls[0].init.body, canonicalize({
    model: request.model,
    messages: request.messages,
    temperature: 0,
    max_tokens: 321,
  }))
  assert.equal(canonicalize(request), before)
})

test('HTTP、provider JSON、assistant JSON 与 Abort 错误均为稳定安全码，且每次最多一次调用', async (t) => {
  const cases: Array<{
    name: string
    expected: AgentModelAdapterError['code']
    makeFetch: () => { calls: CapturedCall[]; fetch: typeof globalThis.fetch }
  }> = [
    {
      name: 'http',
      expected: 'MODEL_HTTP_ERROR',
      makeFetch: () => injectedFetch('RAW_HTTP_BODY api-key-http', 503),
    },
    {
      name: 'provider-json',
      expected: 'MODEL_RESPONSE_INVALID',
      makeFetch: () => injectedFetch('RAW_INVALID_JSON api-key-json'),
    },
    {
      name: 'assistant-json',
      expected: 'MODEL_OUTPUT_INVALID',
      makeFetch: () => injectedFetch({ choices: [{ message: { content: 'RAW_ASSISTANT_BODY api-key-output' } }] }),
    },
    {
      name: 'abort',
      expected: 'MODEL_ABORTED',
      makeFetch: () => {
        const calls: CapturedCall[] = []
        const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          calls.push({ url: String(input), init: init ?? {} })
          const error = new Error('RAW_ABORT_ERROR api-key-abort')
          error.name = 'AbortError'
          throw error
        }) as typeof globalThis.fetch
        return { calls, fetch }
      },
    },
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const mock = item.makeFetch()
      const model = adapter({
        protocol: 'openai',
        baseUrl: 'https://safe.example.test',
        apiKey: 'configured-api-key',
        timeoutMs: 1_000,
      }, mock.fetch)
      const error = await rejection(model.invoke(snapshot))
      assert.equal(error.code, item.expected)
      assert.equal(mock.calls.length, 1)
      assertSafe(error,
        'configured-api-key',
        'RAW_HTTP_BODY',
        'RAW_INVALID_JSON',
        'RAW_ASSISTANT_BODY',
        'RAW_ABORT_ERROR',
        'api-key-http',
        'api-key-json',
        'api-key-output',
        'api-key-abort')
    })
  }
})

test('响应头已返回但 body 读取超时：中止同一 signal、稳定映射且不重试', async () => {
  const calls: CapturedCall[] = []
  let signalAborted = false
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const signal = init?.signal
    assert.ok(signal instanceof AbortSignal)

    let bodyTimer: ReturnType<typeof setTimeout> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const onAbort = () => {
          signalAborted = true
          if (bodyTimer !== undefined) clearTimeout(bodyTimer)
          controller.error(new DOMException('RAW_DELAYED_BODY api-key-body', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        bodyTimer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          controller.enqueue(new TextEncoder().encode(JSON.stringify({
            choices: [{ message: { content: '{"tooLate":true}' } }],
          })))
          controller.close()
        }, 60)
      },
      cancel() {
        if (bodyTimer !== undefined) clearTimeout(bodyTimer)
      },
    })

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'x-provider-secret': 'never-return-body-header',
      },
    })
  }) as typeof globalThis.fetch
  const model = adapter({
    protocol: 'openai',
    baseUrl: 'https://body-timeout.example.test',
    apiKey: 'configured-body-api-key',
    timeoutMs: 10,
  }, fetch)

  const error = await rejection(model.invoke(snapshot))
  assert.equal(error.code, 'MODEL_ABORTED')
  assert.equal(calls.length, 1)
  assert.equal(signalAborted, true)
  assertSafe(error,
    'configured-body-api-key',
    'RAW_DELAYED_BODY',
    'api-key-body',
    'never-return-body-header')
})

test('config resolver/env 只在 adapter 内解析，模型请求仍使用 snapshot.model', async () => {
  const mock = injectedFetch({ choices: [{ message: { content: '{"ok":true}' } }] })
  const model = new AgentModelAdapter({
    env: {
      AGENT_LLM_BASE_URL: 'https://env-openai.example.test',
      AGENT_LLM_MODEL: snapshot.model,
      AGENT_LLM_API_KEY: 'env-secret',
    },
    fetch: mock.fetch,
  })
  const output: JsonValue = await model.invoke(snapshot)
  assert.deepEqual(output, { ok: true })
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].url, 'https://env-openai.example.test/v1/chat/completions')
  assert.equal((JSON.parse(String(mock.calls[0].init.body)) as { model: string }).model, snapshot.model)
})


test('真实 A2 recordThenInvoke 重建快照与 adapter 实际请求一致且只调用一次', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-model-a2-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new AgentEventStore(directory)
  const mock = injectedFetch({ choices: [{ message: { content: '{"ok":true}' } }] })
  const model = adapter({
    protocol: 'openai', baseUrl: 'https://a2.example.test', apiKey: 'transport-only-secret', timeoutMs: 1_000,
  }, mock.fetch)
  const result = await recordThenInvoke(store, {
    userId: 'user_1', sessionId: 'session_1', turnId: 'turn_1', requestId: 'request_1',
    request: snapshot, promptVersion: 'agent.planning.v2', createdAt: '2026-09-17T03:00:00.000Z',
  }, (rebuilt) => model.invoke(rebuilt))
  assert.deepEqual(result, { ok: true })
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].init.body, canonicalize({
    model: snapshot.model,
    messages: snapshot.messages,
    ...snapshot.parameters,
  }))
  const rebuilt = await store.reconstructRequest({
    userId: 'user_1', sessionId: 'session_1', turnId: 'turn_1', requestId: 'request_1',
  })
  assert.deepEqual(rebuilt.request, snapshot)
  assert.equal(JSON.stringify(rebuilt).includes('transport-only-secret'), false)
})

test('只配置 OpenAI key/model 时复用既有 DeepSeek 默认 base URL', async () => {
  const mock = injectedFetch({ choices: [{ message: { content: '{"ok":true}' } }] })
  const model = new AgentModelAdapter({
    env: { AGENT_LLM_API_KEY: 'key-only', AGENT_LLM_MODEL: snapshot.model },
    fetch: mock.fetch,
  })
  assert.deepEqual(await model.invoke(snapshot), { ok: true })
  assert.equal(mock.calls[0].url, 'https://api.deepseek.com/v1/chat/completions')
  assert.equal(mock.calls.length, 1)
})


test('目录为空时可在 adapter 内复用 IMAGE_PROVIDERS qiniu 历史文本 key', async () => {
  const mock = injectedFetch({ choices: [{ message: { content: '{"ok":true}' } }] })
  const model = new AgentModelAdapter({
    env: {
      IMAGE_PROVIDERS: JSON.stringify([
        { id: 'other', type: 'grsai', apiKey: 'not-selected' },
        { id: 'text', type: 'qiniu', apiKey: 'qiniu-secret' },
      ]),
    },
    fetch: mock.fetch,
  })
  assert.deepEqual(await model.invoke(snapshot), { ok: true })
  assert.equal(mock.calls.length, 1)
  assert.equal((mock.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer qiniu-secret')
  assert.equal(String(mock.calls[0].init.body).includes('qiniu-secret'), false)
})
