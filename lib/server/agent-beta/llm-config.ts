/**
 * Agent Beta（画布创作助手）专属 LLM 接入配置。
 *
 * 与生图链路完全隔离：生图走 IMAGE_PROVIDERS 供应商池（volces/jimeng/grsai 等），
 * 裂变 planner 走 TEXT_LLM_*；画布 Agent 独立读 AGENT_LLM_*，互不影响。
 * 任一项未配置时返回 undefined，由 planner 回退 TEXT_LLM_* 对应项（向后兼容）。
 */
export interface AgentBetaLlmConfig {
  baseUrl?: string
  model?: string
  apiKey?: string
  timeoutMs?: number
}

export function resolveAgentBetaLlmConfig(
  env: Record<string, string | undefined> = process.env,
): AgentBetaLlmConfig {
  const rawTimeout = Number.parseInt(env.AGENT_LLM_TIMEOUT_MS?.trim() ?? '', 10)
  return {
    baseUrl: env.AGENT_LLM_BASE_URL?.trim().replace(/\/$/, '') || undefined,
    model: env.AGENT_LLM_MODEL?.trim() || undefined,
    apiKey: env.AGENT_LLM_API_KEY?.trim() || undefined,
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : undefined,
  }
}
