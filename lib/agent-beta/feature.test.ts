import assert from 'node:assert/strict'
import test from 'node:test'
import { getAgentBetaAccess, isAgentBetaEnabled } from './feature'

test('默认关闭：未配置开关时任何人不可用', () => {
  assert.equal(isAgentBetaEnabled({}), false)
  assert.equal(getAgentBetaAccess({ username: 'admin' }, {}).allowed, false)
})

test('开启且白名单为空 = 全体登录用户可用，生产模式同样开放', () => {
  const env = { NODE_ENV: 'production', BETA_AGENT_ENABLED: 'true' }
  assert.equal(isAgentBetaEnabled(env), true)
  assert.equal(getAgentBetaAccess({ username: 'anyone' }, env).allowed, true)
  assert.equal(getAgentBetaAccess(null, env).allowed, false)
})

test('配置白名单则回到定向灰度：仅名单内登录用户可用', () => {
  const env = { NODE_ENV: 'development', BETA_AGENT_ENABLED: 'true', BETA_AGENT_USERNAMES: ' user01, Artist ' }
  assert.equal(getAgentBetaAccess({ username: 'ARTIST' }, env).allowed, true)
  assert.equal(getAgentBetaAccess({ username: 'artist-other' }, env).allowed, false)
  assert.equal(getAgentBetaAccess(null, env).allowed, false)
})
