import { canonicalize, toJsonValue } from '@/lib/agent/contracts'
import type { JsonValue } from '@/lib/agent/types'
import type { ModelRequestSnapshot } from '../agent/observability/event-store'
import type { AgentModelPort } from '../agent/ports'
import { resolveAgentBetaLlmConfig, type AgentLlmProtocol } from './llm-config'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_OPENAI_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4_096
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'

export type AgentModelAdapterErrorCode =
  | 'MODEL_CONFIG_ERROR'
  | 'MODEL_REQUEST_INVALID'
  | 'MODEL_HTTP_ERROR'
  | 'MODEL_NETWORK_ERROR'
  | 'MODEL_ABORTED'
  | 'MODEL_RESPONSE_INVALID'
  | 'MODEL_OUTPUT_INVALID'

const ERROR_MESSAGES: Readonly<Record<AgentModelAdapterErrorCode, string>> = Object.freeze({
  MODEL_CONFIG_ERROR: '模型服务配置不可用',
  MODEL_REQUEST_INVALID: '模型请求快照无效',
  MODEL_HTTP_ERROR: '模型服务请求失败',
  MODEL_NETWORK_ERROR: '模型服务暂时不可达',
  MODEL_ABORTED: '模型服务请求已中止',
  MODEL_RESPONSE_INVALID: '模型服务响应格式无效',
  MODEL_OUTPUT_INVALID: '模型输出不是有效 JSON',
})

/** 只暴露稳定码和固定安全消息；不挂载 provider cause、响应正文、URL 或凭据。 */
export class AgentModelAdapterError extends Error {
  constructor(readonly code: AgentModelAdapterErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'AgentModelAdapterError'
  }
}

export interface AgentModelAdapterConfig {
  protocol: AgentLlmProtocol
  baseUrl?: string
  /** 可直接注入完整端点；与 baseUrl 同时存在时优先。 */
  endpoint?: string
  apiKey?: string
  timeoutMs?: number
  /** Anthropic Messages API 缺少 snapshot 参数时采用的协议必需默认值。 */
  maxTokens?: number
  anthropicVersion?: string
}

export type AgentModelAdapterConfigSource =
  | AgentModelAdapterConfig
  | Readonly<Record<string, AgentModelAdapterConfig>>
  | ((model: string) => AgentModelAdapterConfig | undefined)

export interface AgentModelAdapterOptions {
  fetch?: typeof globalThis.fetch
  env?: Record<string, string | undefined>
  config?: AgentModelAdapterConfigSource
}

interface ResolvedTransportConfig {
  protocol: AgentLlmProtocol
  endpoint: string
  apiKey: string
  timeoutMs: number
  maxTokens: number
  anthropicVersion: string
}

function fail(code: AgentModelAdapterErrorCode): never {
  throw new AgentModelAdapterError(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strictClone<T>(value: T, code: AgentModelAdapterErrorCode): T {
  try {
    return JSON.parse(canonicalize(value)) as T
  } catch {
    return fail(code)
  }
}

function normalizeSnapshot(raw: ModelRequestSnapshot): ModelRequestSnapshot {
  const value = strictClone<unknown>(raw, 'MODEL_REQUEST_INVALID')
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.model !== 'string'
    || !value.model.trim()
    || value.model !== value.model.trim()
    || value.model.length > 200
    || !Array.isArray(value.messages)
    || value.messages.length === 0
    || !isRecord(value.parameters)
    || Object.keys(value).length !== 4
    || !['schemaVersion', 'model', 'messages', 'parameters'].every((key) => Object.hasOwn(value, key))) {
    return fail('MODEL_REQUEST_INVALID')
  }
  return value as unknown as ModelRequestSnapshot
}

function positiveInteger(value: unknown, fallback: number, code: AgentModelAdapterErrorCode): number {
  const candidate = value ?? fallback
  if (!Number.isSafeInteger(candidate) || (candidate as number) <= 0) return fail(code)
  return candidate as number
}

function positiveIntegerFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || !value.trim()) return fallback
  const parsed = Number(value)
  return positiveInteger(parsed, fallback, 'MODEL_CONFIG_ERROR')
}


function legacyTextApiKey(env: Record<string, string | undefined>): string | undefined {
  const explicit = env.AGENT_LLM_API_KEY?.trim() || env.TEXT_LLM_API_KEY?.trim()
  if (explicit) return explicit
  const raw = env.IMAGE_PROVIDERS?.trim()
  if (!raw) return undefined
  try {
    const providers: unknown = JSON.parse(raw)
    if (!Array.isArray(providers)) return undefined
    for (const provider of providers) {
      if (provider && typeof provider === 'object'
        && (provider as { type?: unknown }).type === 'qiniu'
        && typeof (provider as { apiKey?: unknown }).apiKey === 'string') {
        const key = (provider as { apiKey: string }).apiKey.trim()
        if (key) return key
      }
    }
  } catch {
    return undefined
  }
  return undefined
}
function configFromSource(
  source: AgentModelAdapterConfigSource | undefined,
  model: string,
  env: Record<string, string | undefined>,
): AgentModelAdapterConfig | undefined {
  if (typeof source === 'function') return source(model)
  if (source && Object.hasOwn(source, 'protocol')) return source as AgentModelAdapterConfig
  if (source) {
    const catalog = source as Readonly<Record<string, AgentModelAdapterConfig>>
    return Object.hasOwn(catalog, model) ? catalog[model] : undefined
  }
  const entry = resolveAgentBetaLlmConfig(model, env)
  if (!entry) return { protocol: 'openai' }
  return {
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey,
    timeoutMs: entry.timeoutMs,
  }
}

function checkedEndpoint(raw: string): string {
  const endpoint = raw.trim()
  if (!endpoint || endpoint !== raw) return fail('MODEL_CONFIG_ERROR')
  try {
    const parsed = new URL(endpoint)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      return fail('MODEL_CONFIG_ERROR')
    }
  } catch {
    return fail('MODEL_CONFIG_ERROR')
  }
  return endpoint
}

function resolveTransportConfig(
  source: AgentModelAdapterConfigSource | undefined,
  model: string,
  env: Record<string, string | undefined>,
): ResolvedTransportConfig {
  let raw: AgentModelAdapterConfig | undefined
  try {
    raw = configFromSource(source, model, env)
  } catch {
    return fail('MODEL_CONFIG_ERROR')
  }
  if (!raw || !['openai', 'anthropic'].includes(raw.protocol)) return fail('MODEL_CONFIG_ERROR')

  const anthropic = raw.protocol === 'anthropic'
  const baseUrl = raw.baseUrl
    ?? (anthropic
      ? env.AGENT_LLM_ANTHROPIC_BASE_URL
      : env.AGENT_LLM_BASE_URL ?? env.TEXT_LLM_BASE_URL ?? DEFAULT_OPENAI_BASE_URL)
  const apiKey = raw.apiKey
    ?? (anthropic
      ? env.AGENT_LLM_ANTHROPIC_API_KEY
      : env.AGENT_LLM_API_KEY ?? env.TEXT_LLM_API_KEY ?? legacyTextApiKey(env))
  if (typeof apiKey !== 'string' || !apiKey.trim()) return fail('MODEL_CONFIG_ERROR')

  let endpoint: string
  if (raw.endpoint !== undefined) {
    endpoint = checkedEndpoint(raw.endpoint)
  } else {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) return fail('MODEL_CONFIG_ERROR')
    const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
    if (!normalizedBase) return fail('MODEL_CONFIG_ERROR')
    endpoint = checkedEndpoint(`${normalizedBase}${anthropic ? '/v1/messages' : '/v1/chat/completions'}`)
  }

  const timeoutFallback = positiveIntegerFromEnv(env.AGENT_LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const timeoutMs = positiveInteger(raw.timeoutMs, timeoutFallback, 'MODEL_CONFIG_ERROR')
  const maxTokens = positiveInteger(raw.maxTokens, DEFAULT_ANTHROPIC_MAX_TOKENS, 'MODEL_CONFIG_ERROR')
  const anthropicVersion = raw.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION
  if (typeof anthropicVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(anthropicVersion)) {
    return fail('MODEL_CONFIG_ERROR')
  }
  return { protocol: raw.protocol, endpoint, apiKey: apiKey.trim(), timeoutMs, maxTokens, anthropicVersion }
}

function copyParameters(
  snapshot: ModelRequestSnapshot,
  reserved: readonly string[],
): Record<string, JsonValue> {
  const parameters = strictClone(snapshot.parameters, 'MODEL_REQUEST_INVALID')
  if (reserved.some((key) => Object.hasOwn(parameters, key))) return fail('MODEL_REQUEST_INVALID')
  return parameters
}

function openAiBody(snapshot: ModelRequestSnapshot): Record<string, JsonValue> {
  const parameters = copyParameters(snapshot, ['model', 'messages'])
  return { model: snapshot.model, messages: snapshot.messages, ...parameters }
}

function anthropicBody(
  snapshot: ModelRequestSnapshot,
  config: ResolvedTransportConfig,
): Record<string, JsonValue> {
  const parameters = copyParameters(snapshot, ['model', 'messages', 'system'])
  const messages: JsonValue[] = []
  let system: JsonValue | undefined
  let sawConversationMessage = false

  for (const messageValue of snapshot.messages) {
    if (!isRecord(messageValue)
      || typeof messageValue.role !== 'string'
      || !Object.hasOwn(messageValue, 'content')) return fail('MODEL_REQUEST_INVALID')
    const role = messageValue.role
    if (role === 'system') {
      if (system !== undefined || sawConversationMessage
        || Object.keys(messageValue).length !== 2) return fail('MODEL_REQUEST_INVALID')
      system = messageValue.content as JsonValue
      continue
    }
    if (!['user', 'assistant'].includes(role)) return fail('MODEL_REQUEST_INVALID')
    sawConversationMessage = true
    messages.push(messageValue as JsonValue)
  }
  if (!messages.length) return fail('MODEL_REQUEST_INVALID')

  if (!Object.hasOwn(parameters, 'max_tokens')) parameters.max_tokens = config.maxTokens
  positiveInteger(parameters.max_tokens, config.maxTokens, 'MODEL_REQUEST_INVALID')
  if (parameters.stream === true) return fail('MODEL_REQUEST_INVALID')

  return {
    model: snapshot.model,
    ...(system === undefined ? {} : { system }),
    messages,
    ...parameters,
  }
}

type AssistantTextBlock = { [key: string]: JsonValue } & { type: 'text'; text: string }

function isAssistantTextBlock(value: JsonValue): value is AssistantTextBlock {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string'
}

function openAiAssistantText(value: JsonValue): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices) || !value.choices.length) return undefined
  const choice = value.choices[0]
  if (!isRecord(choice) || !isRecord(choice.message)) return undefined
  const content = choice.message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const blocks = content.filter(isAssistantTextBlock)
  return blocks.length ? blocks.map((block) => block.text).join('') : undefined
}

function anthropicAssistantText(value: JsonValue): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return undefined
  const blocks = value.content.filter(isAssistantTextBlock)
  return blocks.length ? blocks.map((block) => block.text).join('') : undefined
}

function parseAssistantJson(text: string): JsonValue {
  try {
    return toJsonValue(JSON.parse(text))
  } catch {
    return fail('MODEL_OUTPUT_INVALID')
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * A2 快照到单次 provider HTTP 的最小适配器。每次 invoke 恰有零次（前置校验失败）或一次 fetch；
 * 不重试、不补发修复请求，也不把 provider envelope、思维块或传输元数据返回业务层。
 */
export class AgentModelAdapter implements AgentModelPort {
  readonly #fetch: typeof globalThis.fetch
  readonly #env: Record<string, string | undefined>
  readonly #config: AgentModelAdapterConfigSource | undefined

  constructor(options: AgentModelAdapterOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#env = options.env ?? process.env
    this.#config = options.config
  }

  async invoke(rawSnapshot: ModelRequestSnapshot): Promise<JsonValue> {
    const snapshot = normalizeSnapshot(rawSnapshot)
    const config = resolveTransportConfig(this.#config, snapshot.model, this.#env)
    const body = config.protocol === 'openai' ? openAiBody(snapshot) : anthropicBody(snapshot, config)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      let response: Response
      try {
        response = await this.#fetch(config.endpoint, {
          method: 'POST',
          headers: config.protocol === 'anthropic'
            ? {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': config.anthropicVersion,
              }
            : {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
              },
          body: canonicalize(body),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return fail('MODEL_ABORTED')
        return fail('MODEL_NETWORK_ERROR')
      }

      if (controller.signal.aborted) return fail('MODEL_ABORTED')
      try {
        if (!response.ok) return fail('MODEL_HTTP_ERROR')
        const envelope = toJsonValue(await response.json())
        if (controller.signal.aborted) return fail('MODEL_ABORTED')
        const text = config.protocol === 'openai'
          ? openAiAssistantText(envelope)
          : anthropicAssistantText(envelope)
        if (text === undefined) return fail('MODEL_RESPONSE_INVALID')
        const output = parseAssistantJson(text)
        if (controller.signal.aborted) return fail('MODEL_ABORTED')
        return output
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return fail('MODEL_ABORTED')
        if (error instanceof AgentModelAdapterError) throw error
        return fail('MODEL_RESPONSE_INVALID')
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

export { AgentModelAdapter as AgentBetaModelAdapter }

export function createAgentModelAdapter(options: AgentModelAdapterOptions = {}): AgentModelAdapter {
  return new AgentModelAdapter(options)
}

export const createAgentBetaModelAdapter = createAgentModelAdapter
