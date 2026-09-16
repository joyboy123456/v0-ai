/**
 * 通用 Fission Prompt Planner 底座。
 *
 * 职责：
 * - 调用 OpenAI 兼容文本 LLM，为 fission 类功能生成结构化 prompt 计划
 * - 统一处理鉴权、超时、HTTP 错误、OpenAI 响应解析、JSON 容错解析、Zod schema 校验
 * - 不理解任何具体业务品类；photo-fission / pose-fission / 未来裂变功能只提供 systemPrompt、
 *   userPrompt 和 outputSchema
 */

import { z } from 'zod'

export type FissionPromptPlannerErrorStage =
  | 'config'
  | 'http'
  | 'parse'
  | 'schema'
  | 'timeout'

export interface InvokeFissionPromptPlannerInput<TOutput> {
  systemPrompt: string
  userPrompt: string
  outputSchema: z.ZodType<TOutput>
  /** 用于日志/错误上下文，通常传 taskId */
  traceId?: string
  /** 业务 feature 名称，如 photo-fission / pose-fission */
  feature?: string
  /** 便于错误信息区分不同策略，如 childrens-dress / pose-template */
  plannerName?: string
  temperature?: number
  reasoningEnabled?: boolean
  retryOnSchemaFailure?: boolean
  /** 可选：专属 LLM 接入配置（如 Agent Beta 画布）。未传/缺项时回退 TEXT_LLM_* 环境变量 */
  llm?: {
    baseUrl?: string
    model?: string
    apiKey?: string
    timeoutMs?: number
    /** 上游协议：openai=chat/completions（默认）；anthropic=Messages API（x-api-key 鉴权） */
    protocol?: 'openai' | 'anthropic'
    /** 仅 anthropic 协议必填项，默认 4096 */
    maxTokens?: number
  }
}

export class FissionPromptPlannerError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly stage?: FissionPromptPlannerErrorStage,
  ) {
    super(message)
    this.name = 'FissionPromptPlannerError'
  }
}

// 默认走 DeepSeek（OpenAI 兼容、deepseek-chat 性价比高、官方支持 json_object）
// 通过 TEXT_LLM_BASE_URL / TEXT_LLM_MODEL 可覆盖到任意 OpenAI 兼容端点。
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_TEMPERATURE = 0.85
const DEFAULT_MAX_ATTEMPTS = 2

/**
 * 调用文本 LLM 生成结构化 fission prompt 计划。
 *
 * @throws FissionPromptPlannerError caller 应捕获并回退到 feature 自己的稳定链路
 */
export async function invokeFissionPromptPlanner<TOutput>(
  input: InvokeFissionPromptPlannerInput<TOutput>,
): Promise<TOutput> {
  const llm = input.llm
  const apiKey = llm?.apiKey?.trim() || resolveTextLlmApiKey()
  const plannerLabel = input.plannerName ?? input.feature ?? 'fission'
  if (!apiKey) {
    throw new FissionPromptPlannerError(
      'TEXT_LLM_API_KEY / llm.apiKey is not configured (and no qiniu provider found in IMAGE_PROVIDERS)',
      { plannerName: plannerLabel },
      'config',
    )
  }

  const baseUrl =
    llm?.baseUrl?.trim().replace(/\/$/, '') ||
    process.env.TEXT_LLM_BASE_URL?.trim().replace(/\/$/, '') ||
    DEFAULT_BASE_URL
  const model =
    llm?.model?.trim() || process.env.TEXT_LLM_MODEL?.trim() || DEFAULT_MODEL
  const timeoutMs =
    llm?.timeoutMs && llm.timeoutMs > 0
      ? llm.timeoutMs
      : parseTimeout(process.env.TEXT_LLM_TIMEOUT_MS)
  const protocol = llm?.protocol ?? 'openai'
  const endpoint =
    protocol === 'anthropic'
      ? `${baseUrl}/v1/messages`
      : `${baseUrl}/v1/chat/completions`
  const useDeepSeekThinkingControls =
    protocol === 'openai' && supportsDeepSeekThinkingControls(baseUrl, model)

  // response_format: json_object 让兼容 OpenAI 规范的模型（DeepSeek / GPT-4 /
  // qwen 等）强制返回合法 JSON，避免被 markdown 代码围栏包裹或附带说明文字。
  // 系统提示词已明确要求"直接输出 JSON"，满足 DeepSeek 对 prompt 含 "json"
  // 字样的要求。如果上游服务不支持该参数，会忽略它（不会报错）。
  // Anthropic Messages 协议 shape 不同：system 为顶层字段、max_tokens 必填、
  // 无 response_format——JSON 输出由系统提示词约束 + outputSchema 校验兜底。
  const body: Record<string, unknown> =
    protocol === 'anthropic'
      ? {
          model,
          max_tokens: llm?.maxTokens ?? 4096,
          system: input.systemPrompt,
          messages: [{ role: 'user' as const, content: input.userPrompt }],
        }
      : {
          model,
          messages: [
            { role: 'system' as const, content: input.systemPrompt },
            { role: 'user' as const, content: input.userPrompt },
          ],
          stream: false,
          temperature: input.temperature ?? DEFAULT_TEMPERATURE,
          response_format: { type: 'json_object' as const },
          ...(useDeepSeekThinkingControls
            ? {
                thinking: {
                  type: input.reasoningEnabled
                    ? ('enabled' as const)
                    : ('disabled' as const),
                },
                ...(input.reasoningEnabled
                  ? { reasoning_effort: 'high' as const }
                  : {}),
              }
            : {}),
        }

  let lastError: FissionPromptPlannerError | null = null
  for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await invokePlannerOnce({
        endpoint,
        apiKey,
        body,
        protocol,
        timeoutMs,
        plannerLabel,
        input,
      })
    } catch (error) {
      if (!(error instanceof FissionPromptPlannerError)) throw error
      lastError = error
      logPlannerRetry({
        error,
        attempt,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        plannerLabel,
        traceId: input.traceId,
        feature: input.feature,
      })
      if (
        !shouldRetry(error.stage, input.retryOnSchemaFailure) ||
        attempt === DEFAULT_MAX_ATTEMPTS
      ) {
        break
      }
    }
  }

  throw lastError ?? new FissionPromptPlannerError(
    `Text LLM planner ${plannerLabel} failed without a captured error`,
    { traceId: input.traceId, feature: input.feature },
    'parse',
  )
}

interface InvokePlannerOnceInput<TOutput> {
  endpoint: string
  apiKey: string
  body: Record<string, unknown>
  protocol: 'openai' | 'anthropic'
  timeoutMs: number
  plannerLabel: string
  input: InvokeFissionPromptPlannerInput<TOutput>
}

async function invokePlannerOnce<TOutput>({
  endpoint,
  apiKey,
  body,
  protocol,
  timeoutMs,
  plannerLabel,
  input,
}: InvokePlannerOnceInput<TOutput>): Promise<TOutput> {
  let response: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers:
        protocol === 'anthropic'
          ? {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            }
          : {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new FissionPromptPlannerError(
        `${plannerLabel} planner timed out after ${timeoutMs}ms`,
        err,
        'timeout',
      )
    }
    throw new FissionPromptPlannerError(
      `Failed to reach text LLM endpoint for ${plannerLabel} planner`,
      err,
      'http',
    )
  } finally {
    clearTimeout(timer)
  }

  const responseText = await safeReadBody(response)
  if (!response.ok) {
    throw new FissionPromptPlannerError(
      `Text LLM returned ${response.status} for ${plannerLabel}: ${truncate(responseText, 400)}`,
      {
        traceId: input.traceId,
        feature: input.feature,
        status: response.status,
        contentType: response.headers.get('content-type'),
      },
      'http',
    )
  }

  const raw = parseJsonText(responseText)
  if (!raw) {
    throw new FissionPromptPlannerError(
      `Text LLM response for ${plannerLabel} is not valid JSON: ${summarizeBody(responseText)}`,
      {
        traceId: input.traceId,
        feature: input.feature,
        contentType: response.headers.get('content-type'),
        bodyPreview: truncate(responseText, 400),
      },
      'parse',
    )
  }

  const content =
    protocol === 'anthropic'
      ? extractAnthropicContent(raw)
      : extractAssistantContent(raw)
  if (!content) {
    throw new FissionPromptPlannerError(
      `Text LLM response for ${plannerLabel} missing assistant content`,
      raw,
      'parse',
    )
  }

  const parsedJson = parseJsonLoose(content)
  if (!parsedJson) {
    throw new FissionPromptPlannerError(
      `Assistant content for ${plannerLabel} is not parseable JSON`,
      { content: truncate(content, 400) },
      'parse',
    )
  }

  const validated = input.outputSchema.safeParse(parsedJson)
  if (!validated.success) {
    throw new FissionPromptPlannerError(
      `Schema validation failed for ${plannerLabel}: ${validated.error.message}`,
      validated.error,
      'schema',
    )
  }

  return validated.data
}

function parseJsonText(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function summarizeBody(text: string): string {
  if (!text.trim()) return '<empty body>'
  return truncate(text.replace(/\s+/g, ' ').trim(), 200)
}

function shouldRetry(
  stage: FissionPromptPlannerErrorStage | undefined,
  retryOnSchemaFailure?: boolean,
): boolean {
  return (
    stage === 'http' ||
    stage === 'parse' ||
    stage === 'timeout' ||
    (retryOnSchemaFailure === true && stage === 'schema')
  )
}

function logPlannerRetry(input: {
  error: FissionPromptPlannerError
  attempt: number
  maxAttempts: number
  plannerLabel: string
  traceId?: string
  feature?: string
}) {
  if (input.attempt >= input.maxAttempts) return
  console.warn(
    JSON.stringify({
      lvl: 'warn',
      evt: 'planner.retry',
      ts: new Date().toISOString(),
      traceId: input.traceId,
      feature: input.feature,
      plannerName: input.plannerLabel,
      attempt: input.attempt,
      nextAttempt: input.attempt + 1,
      stage: input.error.stage,
      reason: input.error.message,
    }),
  )
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return n
}

function supportsDeepSeekThinkingControls(baseUrl: string, model: string): boolean {
  return baseUrl.includes('api.deepseek.com') || model.startsWith('deepseek-')
}

/**
 * 按优先级解析文本 LLM 的 API key：
 * 1. 显式 `TEXT_LLM_API_KEY`
 * 2. 复用 `IMAGE_PROVIDERS` JSON 中第一个 `type: qiniu` 条目的 apiKey（历史兼容）
 */
function resolveTextLlmApiKey(): string {
  const explicit = process.env.TEXT_LLM_API_KEY?.trim()
  if (explicit) return explicit

  const poolRaw = process.env.IMAGE_PROVIDERS?.trim()
  if (!poolRaw) return ''
  try {
    const parsed = JSON.parse(poolRaw) as unknown
    if (!Array.isArray(parsed)) return ''
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === 'object' &&
        (entry as { type?: unknown }).type === 'qiniu' &&
        typeof (entry as { apiKey?: unknown }).apiKey === 'string'
      ) {
        const key = ((entry as { apiKey: string }).apiKey || '').trim()
        if (key) return key
      }
    }
  } catch {
    // IMAGE_PROVIDERS JSON 损坏不影响主链路，让 caller 报 config 错误
  }
  return ''
}

/**
 * 兼容 OpenAI 标准 chat.completion 响应 shape。
 */
function extractAssistantContent(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as {
    choices?: Array<{
      message?: { content?: string | Array<{ type: string; text?: string }> }
    }>
  }
  const message = root.choices?.[0]?.message
  if (!message?.content) return null
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter((seg) => seg.type === 'text' && typeof seg.text === 'string')
      .map((seg) => seg.text as string)
      .join('\n')
  }
  return null
}

/** Anthropic Messages 响应 shape：content 为块数组，拼接所有 text 块。 */
function extractAnthropicContent(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const content = (raw as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  const text = content
    .filter(
      (block) =>
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => (block as { text: string }).text)
    .join('\n')
  return text || null
}

/**
 * 容错 JSON 解析：剥离 ```json 围栏，并抓最外层 `{...}`。
 */
function parseJsonLoose(content: string): unknown | null {
  const trimmed = content.trim()
  const tryParse = (text: string): unknown | null => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  const direct = tryParse(trimmed)
  if (direct) return direct

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch?.[1]) {
    const fenced = tryParse(fenceMatch[1].trim())
    if (fenced) return fenced
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = tryParse(trimmed.slice(firstBrace, lastBrace + 1))
    if (sliced) return sliced
  }

  return null
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<unreadable body>'
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}...<truncated ${text.length - max} chars>`
}
