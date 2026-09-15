import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAgentBetaLlmConfig } from './llm-config'

test('AGENT_LLM_* 未配置时全部返回 undefined（由 planner 回退 TEXT_LLM_*）', () => {
  const config = resolveAgentBetaLlmConfig({})
  assert.equal(config.baseUrl, undefined)
  assert.equal(config.model, undefined)
  assert.equal(config.apiKey, undefined)
  assert.equal(config.timeoutMs, undefined)
})

test('配置项逐项裁剪：baseUrl 去尾斜杠、空白串视为未配置、非法 timeout 忽略', () => {
  const config = resolveAgentBetaLlmConfig({
    AGENT_LLM_BASE_URL: '  https://agent.example.com/  ',
    AGENT_LLM_MODEL: ' agent-model ',
    AGENT_LLM_API_KEY: 'sk-agent',
    AGENT_LLM_TIMEOUT_MS: '30000',
  })
  assert.deepEqual(config, {
    baseUrl: 'https://agent.example.com',
    model: 'agent-model',
    apiKey: 'sk-agent',
    timeoutMs: 30000,
  })

  const partial = resolveAgentBetaLlmConfig({
    AGENT_LLM_BASE_URL: '   ',
    AGENT_LLM_MODEL: 'm',
    AGENT_LLM_TIMEOUT_MS: 'abc',
  })
  assert.equal(partial.baseUrl, undefined)
  assert.equal(partial.model, 'm')
  assert.equal(partial.apiKey, undefined)
  assert.equal(partial.timeoutMs, undefined)
})
