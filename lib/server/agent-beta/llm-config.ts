/**
 * Agent Beta（画布创作助手）规划 LLM 目录。
 *
 * 与生图链路完全隔离：生图走 IMAGE_PROVIDERS 供应商池（volces/jimeng/grsai 等），
 * 裂变 planner 走 TEXT_LLM_*；画布 Agent 的"大脑"由本目录管理，用户可在 UI 自选：
 * - AGENT_LLM_*            → OpenAI 协议条目（如 grok2api），单模型
 * - AGENT_LLM_ANTHROPIC_*  → Anthropic Messages 协议条目（如 yinxm 代理的 gpt-5.6 系列），可多模型
 * 凭据未配置的供应商整组不出现在目录里；目录为空时 planner 全量回退 TEXT_LLM_*（向后兼容）。
 */
export type AgentLlmProtocol = 'openai' | 'anthropic'

export interface AgentBetaLlmEntry {
  /** 用户可见的模型 id（选择器选项值） */
  id: string
  protocol: AgentLlmProtocol
  baseUrl?: string
  model?: string
  apiKey?: string
  timeoutMs?: number
}

const DEFAULT_ANTHROPIC_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']

function parsePositiveInt(raw: string | undefined): number | undefined {
  const n = Number.parseInt(raw?.trim() ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function trimTrailingSlash(raw: string | undefined): string | undefined {
  return raw?.trim().replace(/\/$/, '') || undefined
}

/** 按当前 env 构建可用 LLM 目录；顺序即 UI 展示顺序，第一项为默认。 */
export function resolveAgentBetaLlmCatalog(
  env: Record<string, string | undefined> = process.env,
): AgentBetaLlmEntry[] {
  const entries: AgentBetaLlmEntry[] = []
  const timeoutMs = parsePositiveInt(env.AGENT_LLM_TIMEOUT_MS)

  // OpenAI 协议条目：显式 AGENT_LLM_API_KEY 优先；缺省时 planner 内部回退 TEXT_LLM_API_KEY/qiniu 池
  const hasOpenAiEntry = Boolean(env.AGENT_LLM_API_KEY?.trim() || env.TEXT_LLM_API_KEY?.trim())
  if (hasOpenAiEntry) {
    entries.push({
      id: env.AGENT_LLM_MODEL?.trim() || 'agent-default',
      protocol: 'openai',
      baseUrl: trimTrailingSlash(env.AGENT_LLM_BASE_URL),
      model: env.AGENT_LLM_MODEL?.trim() || undefined,
      apiKey: env.AGENT_LLM_API_KEY?.trim() || undefined,
      timeoutMs,
    })
  }

  // Anthropic 协议条目：base+key 齐备才生效，模型列表可配（逗号分隔）
  const anthropicBase = trimTrailingSlash(env.AGENT_LLM_ANTHROPIC_BASE_URL)
  const anthropicKey = env.AGENT_LLM_ANTHROPIC_API_KEY?.trim()
  if (anthropicBase && anthropicKey) {
    const configured = (env.AGENT_LLM_ANTHROPIC_MODELS ?? '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
    for (const model of configured.length ? configured : DEFAULT_ANTHROPIC_MODELS) {
      entries.push({ id: model, protocol: 'anthropic', baseUrl: anthropicBase, model, apiKey: anthropicKey, timeoutMs })
    }
  }

  return entries
}

/** 按用户选择的 id 解析接入配置；未命中回退目录第一项；目录为空返回 undefined（planner 回退 TEXT_LLM_*）。 */
export function resolveAgentBetaLlmConfig(
  id?: string,
  env: Record<string, string | undefined> = process.env,
): AgentBetaLlmEntry | undefined {
  const catalog = resolveAgentBetaLlmCatalog(env)
  if (!catalog.length) return undefined
  return catalog.find((entry) => entry.id === id) ?? catalog[0]
}
