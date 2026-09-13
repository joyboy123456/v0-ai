import assert from 'node:assert/strict'
import test from 'node:test'
import { getAgentBetaAccess, isAgentBetaEnabled } from './feature'

test('默认关闭且空白名单拒绝所有用户', () => {
  assert.equal(isAgentBetaEnabled({}), false)
  assert.equal(getAgentBetaAccess({ username: 'admin' }, { BETA_AGENT_ENABLED: 'true' }).allowed, false)
})

test('仅显式开启并命中白名单的登录用户可用', () => {
  const env = { NODE_ENV: 'development', BETA_AGENT_ENABLED: 'true', BETA_AGENT_USERNAMES: ' user01, Artist ' }
  assert.equal(getAgentBetaAccess({ username: 'ARTIST' }, env).allowed, true)
  assert.equal(getAgentBetaAccess({ username: 'artist-other' }, env).allowed, false)
  assert.equal(getAgentBetaAccess(null, env).allowed, false)
})

test('生产模式即使配置白名单和开关也不开放本地试验', () => {
  assert.equal(getAgentBetaAccess({ username: 'user01' }, { NODE_ENV: 'production', BETA_AGENT_ENABLED: 'true', BETA_AGENT_USERNAMES: 'user01' }).allowed, false)
})
