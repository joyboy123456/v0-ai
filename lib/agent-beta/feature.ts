import type { AgentBetaAccess } from './types'

type BetaEnvironment = {
  NODE_ENV?: string
  BETA_AGENT_ENABLED?: string
  BETA_AGENT_USERNAMES?: string
}

/** Beta 开关：配置 BETA_AGENT_ENABLED=true 即启用（生产/开发一致），可用作紧急总闸。 */
export function isAgentBetaEnabled(environment: BetaEnvironment = process.env): boolean {
  return environment.BETA_AGENT_ENABLED === 'true'
}

export function getAgentBetaAccess(
  user: { username: string } | null,
  environment: BetaEnvironment = process.env,
): AgentBetaAccess {
  const enabled = isAgentBetaEnabled(environment)
  const usernames = new Set(
    (environment.BETA_AGENT_USERNAMES ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean),
  )
  // 白名单留空 = 全体登录用户可用；配置白名单则回到定向灰度模式
  const allowed = enabled && Boolean(user)
    && (usernames.size === 0 || usernames.has((user?.username ?? '').toLowerCase()))
  return { enabled, allowed, localOnly: false }
}
