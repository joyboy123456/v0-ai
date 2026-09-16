import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { invokeFissionPromptPlanner } from './fission-prompt-planner'

const schema = z.object({ ok: z.boolean() })

interface CapturedRequest {
  url: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

/** OpenAI 协议成功响应（content 为 JSON 字符串） */
const OPENAI_RESPONSE = { choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }
/** Anthropic 协议成功响应（content[] 文本块） */
const ANTHROPIC_RESPONSE = { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }

/** mock 全局 fetch，捕获请求 URL/headers/body，返回指定 JSON 响应 */
function withMockedFetch<T>(
  run: (calls: CapturedRequest[]) => Promise<T>,
  responsePayload: unknown = OPENAI_RESPONSE,
): Promise<T> {
  const original = globalThis.fetch
  const calls: CapturedRequest[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string> | undefined,
      body,
    })
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return run(calls).finally(() => {
    globalThis.fetch = original
  })
}

function withTextLlmEnv(run: () => Promise<void>): Promise<void> {
  const previous = { ...process.env }
  Object.assign(process.env, {
    TEXT_LLM_BASE_URL: 'https://env.example.com',
    TEXT_LLM_MODEL: 'env-model',
    TEXT_LLM_API_KEY: 'env-key',
  })
  return run().finally(() => {
    for (const key of ['TEXT_LLM_BASE_URL', 'TEXT_LLM_MODEL', 'TEXT_LLM_API_KEY']) delete process.env[key]
    Object.assign(process.env, previous)
  })
}

test('llm 覆盖项优先于 TEXT_LLM_* 环境变量', () =>
  withTextLlmEnv(async () => {
    await withMockedFetch(async (calls) => {
      await invokeFissionPromptPlanner({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: schema,
        llm: { baseUrl: 'https://agent.example.com/', model: 'agent-model', apiKey: 'agent-key' },
      })
      assert.equal(calls[0].url, 'https://agent.example.com/v1/chat/completions')
      assert.equal(calls[0].headers?.Authorization, 'Bearer agent-key')
      assert.equal(calls[0].body?.model, 'agent-model')
    })
  }),
)

test('llm 缺项时逐项回退环境变量', () =>
  withTextLlmEnv(async () => {
    await withMockedFetch(async (calls) => {
      await invokeFissionPromptPlanner({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: schema,
        llm: { model: 'agent-model' }, // 只给 model，baseUrl/apiKey 回退 env
      })
      assert.equal(calls[0].url, 'https://env.example.com/v1/chat/completions')
      assert.equal(calls[0].headers?.Authorization, 'Bearer env-key')
      assert.equal(calls[0].body?.model, 'agent-model')
    })
  }),
)

test('anthropic 协议：POST /v1/messages + x-api-key，system 顶层字段，无 response_format', async () => {
  await withMockedFetch(
    async (calls) => {
      const result = await invokeFissionPromptPlanner({
        systemPrompt: 'sys',
        userPrompt: 'usr',
        outputSchema: schema,
        llm: {
          protocol: 'anthropic',
          baseUrl: 'https://anthropic.example.com/',
          model: 'gpt-5.6-sol',
          apiKey: 'anth-key',
          maxTokens: 2048,
        },
      })
      assert.equal(result.ok, true)
      assert.equal(calls[0].url, 'https://anthropic.example.com/v1/messages')
      assert.equal(calls[0].headers?.['x-api-key'], 'anth-key')
      assert.equal(calls[0].headers?.['anthropic-version'], '2023-06-01')
      assert.equal(calls[0].headers?.Authorization, undefined)
      const body = calls[0].body!
      assert.equal(body.model, 'gpt-5.6-sol')
      assert.equal(body.system, 'sys')
      assert.equal(body.max_tokens, 2048)
      assert.deepEqual(body.messages, [{ role: 'user', content: 'usr' }])
      assert.equal(body.response_format, undefined)
    },
    ANTHROPIC_RESPONSE,
  )
})
