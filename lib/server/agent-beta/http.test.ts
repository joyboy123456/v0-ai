import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { agentBetaResponse, readAgentBetaBody } from './http'
import { AgentBetaError } from './validation'

test('Beta默认关闭时在读取请求体和加载业务服务前返回404', async (t) => {
  const previous = process.env.BETA_AGENT_ENABLED
  process.env.BETA_AGENT_ENABLED = 'false'
  t.after(() => { if (previous === undefined) delete process.env.BETA_AGENT_ENABLED; else process.env.BETA_AGENT_ENABLED = previous })
  let entered = false
  const response = await agentBetaResponse(new NextRequest('http://localhost/api/beta/agent/sessions', { method: 'POST', body: 'invalid JSON' }), async () => { entered = true })
  assert.equal(response.status, 404)
  assert.equal(entered, false)
  assert.equal((await response.json()).code, 'BETA_DISABLED')
})

test('Beta已开启但未登录返回401，不运行业务回调', async (t) => {
  const previous = { BETA_AGENT_ENABLED: process.env.BETA_AGENT_ENABLED, LOCAL_AUTH_MODE: process.env.LOCAL_AUTH_MODE, NODE_ENV: process.env.NODE_ENV }
  Object.assign(process.env, { BETA_AGENT_ENABLED: 'true', LOCAL_AUTH_MODE: 'password', NODE_ENV: 'development' })
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  })
  let entered = false
  const response = await agentBetaResponse(new NextRequest('http://localhost/api/beta/agent/sessions'), async () => { entered = true })
  assert.equal(response.status, 401)
  assert.equal(entered, false)
})

test('请求体按实际字节限制且拒绝非法JSON', async () => {
  const oversized = new NextRequest('http://localhost/', { method: 'POST', headers: { 'content-length': '0' }, body: JSON.stringify({ text: '界'.repeat(15_000) }) })
  await assert.rejects(readAgentBetaBody(oversized), (error: unknown) => error instanceof AgentBetaError && error.status === 413)
  await assert.rejects(readAgentBetaBody(new NextRequest('http://localhost/', { method: 'POST', body: '{' })), /有效 JSON/)
  assert.deepEqual(await readAgentBetaBody(new NextRequest('http://localhost/', { method: 'POST', body: '{}' })), {})
})
