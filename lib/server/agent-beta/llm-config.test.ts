import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAgentBetaLlmCatalog, resolveAgentBetaLlmConfig } from './llm-config'

test('空 env：目录为空，resolve 返回 undefined（planner 全量回退 TEXT_LLM_*）', () => {
  assert.deepEqual(resolveAgentBetaLlmCatalog({}), [])
  assert.equal(resolveAgentBetaLlmConfig('whatever', {}), undefined)
})

test('AGENT_LLM_* 生成 OpenAI 条目，id 取模型名，baseUrl 去尾斜杠', () => {
  const catalog = resolveAgentBetaLlmCatalog({
    AGENT_LLM_BASE_URL: 'https://grok.example.com/',
    AGENT_LLM_MODEL: 'grok-4.6',
    AGENT_LLM_API_KEY: 'k1',
    AGENT_LLM_TIMEOUT_MS: '45000',
  })
  assert.equal(catalog.length, 1)
  assert.deepEqual(catalog[0], {
    id: 'grok-4.6',
    protocol: 'openai',
    baseUrl: 'https://grok.example.com',
    model: 'grok-4.6',
    apiKey: 'k1',
    timeoutMs: 45000,
  })
})

test('无显式 AGENT_LLM_API_KEY 但有 TEXT_LLM_API_KEY 时仍生成条目（apiKey 留空由 planner 回退）', () => {
  const catalog = resolveAgentBetaLlmCatalog({ TEXT_LLM_API_KEY: 'text-key' })
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0].id, 'agent-default')
  assert.equal(catalog[0].apiKey, undefined)
})

test('ANTHROPIC base+key 齐备：默认展开 gpt-5.6 三款，自定义列表可覆盖，缺 key 整组不出现', () => {
  const env = { AGENT_LLM_ANTHROPIC_BASE_URL: 'https://yinxm.example.net', AGENT_LLM_ANTHROPIC_API_KEY: 'k2' }
  const catalog = resolveAgentBetaLlmCatalog(env)
  assert.deepEqual(catalog.map((entry) => entry.id), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
  assert.equal(catalog[0].protocol, 'anthropic')
  assert.equal(catalog[0].baseUrl, 'https://yinxm.example.net')

  const custom = resolveAgentBetaLlmCatalog({ ...env, AGENT_LLM_ANTHROPIC_MODELS: 'gpt-5.6-sol, deepseek-3.2 ' })
  assert.deepEqual(custom.map((entry) => entry.id), ['gpt-5.6-sol', 'deepseek-3.2'])

  assert.deepEqual(resolveAgentBetaLlmCatalog({ AGENT_LLM_ANTHROPIC_BASE_URL: 'https://x.example' }), [])
})

test('resolveAgentBetaLlmConfig：按 id 命中，未命中/缺省回退目录第一项', () => {
  const env = {
    AGENT_LLM_MODEL: 'grok-4.6',
    AGENT_LLM_API_KEY: 'k1',
    AGENT_LLM_ANTHROPIC_BASE_URL: 'https://yinxm.example.net',
    AGENT_LLM_ANTHROPIC_API_KEY: 'k2',
  }
  const picked = resolveAgentBetaLlmConfig('gpt-5.6-terra', env)
  assert.equal(picked?.protocol, 'anthropic')
  assert.equal(picked?.model, 'gpt-5.6-terra')
  assert.equal(resolveAgentBetaLlmConfig('not-exist', env)?.id, 'grok-4.6')
  assert.equal(resolveAgentBetaLlmConfig(undefined, env)?.id, 'grok-4.6')
})
