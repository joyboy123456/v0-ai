import type { AgentBetaAccess } from './types'

type BetaEnvironment = {
  NODE_ENV?: string
  BETA_AGENT_ENABLED?: string
  BETA_AGENT_USERNAMES?: string
}

/** 未获商业授权的实验版本仅可在本地开发模式使用。生产模式始终关闭。 */
export function isAgentBetaEnabled(environment: BetaEnvironment = process.env): boolean {
  return environment.NODE_ENV !== 'production' && environment.BETA_AGENT_ENABLED === 'true'
}

export function getAgentBetaAccess(
  user: { username: string } | null,
  environment: BetaEnvironment = process.env,
): AgentBetaAccess {
  const enabled = isAgentBetaEnabled(environment)
  const usernames = new Set(
    (environment.BETA_AGENT_USERNAMES ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean),
  )
  return { enabled, allowed: enabled && Boolean(user && usernames.has(user.username.toLowerCase())), localOnly: true }
}
