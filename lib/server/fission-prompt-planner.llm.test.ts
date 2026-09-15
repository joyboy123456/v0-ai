import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { invokeFissionPromptPlanner } from './fission-prompt-planner'

const schema = z.object({ ok: z.boolean() })

interface CapturedRequest {
  url: string
  auth?: string
  body?: { model?: string }
}

/** mock 全局 fetch，捕获请求 URL/鉴权/model，返回合法 JSON 响应 */
function withMockedFetch<T>(run: (calls: CapturedRequest[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  const calls: CapturedRequest[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { model?: string }) : undefined
    calls.push({
      url: String(input),
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      body,
    })
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return run(calls).finally(() => {
    globalThis.fetch = original
  })
}

test('llm 覆盖项优先于 TEXT_LLM_* 环境变量', async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    TEXT_LLM_BASE_URL: 'https://env.example.com',
    TEXT_LLM_MODEL: 'env-model',
    TEXT_LLM_API_KEY: 'env-key',
  })
  try {
    await withMockedFetch(async (calls) => {
      await invokeFissionPromptPlanner({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: schema,
        llm: { baseUrl: 'https://agent.example.com/', model: 'agent-model', apiKey: 'agent-key' },
      })
      assert.equal(calls[0].url, 'https://agent.example.com/v1/chat/completions')
      assert.equal(calls[0].auth, 'Bearer agent-key')
      assert.equal(calls[0].body?.model, 'agent-model')
    })
  } finally {
    for (const key of ['TEXT_LLM_BASE_URL', 'TEXT_LLM_MODEL', 'TEXT_LLM_API_KEY']) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test('llm 缺项时逐项回退环境变量', async () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    TEXT_LLM_BASE_URL: 'https://env.example.com',
    TEXT_LLM_MODEL: 'env-model',
    TEXT_LLM_API_KEY: 'env-key',
  })
  try {
    await withMockedFetch(async (calls) => {
      await invokeFissionPromptPlanner({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: schema,
        llm: { model: 'agent-model' }, // 只给 model，baseUrl/apiKey 回退 env
      })
      assert.equal(calls[0].url, 'https://env.example.com/v1/chat/completions')
      assert.equal(calls[0].auth, 'Bearer env-key')
      assert.equal(calls[0].body?.model, 'agent-model')
    })
  } finally {
    for (const key of ['TEXT_LLM_BASE_URL', 'TEXT_LLM_MODEL', 'TEXT_LLM_API_KEY']) delete process.env[key]
    Object.assign(process.env, previous)
  }
})
