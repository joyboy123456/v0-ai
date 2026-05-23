/**
 * v5 服装大片裂变 LLM 镜头策划器。
 *
 * 职责：
 * 1. 调用 OpenAI 兼容文本 LLM 中转（默认 `https://elysiver.h-e.top`，
 *    默认模型 `qwen3.6-plus`）
 * 2. 输入：rule-engine 提供的 systemPrompt + userPrompt（D16 纯文本，不传图像）
 * 3. 输出解析：去除 markdown 围栏 + JSON.parse + Zod 校验
 * 4. 任何异常都向上抛出，由 caller（service 层）决定是否回退到 v4 链路
 *
 * 历史决策：
 * - 原计划走七牛云 `https://openai.qiniu.com` + `moonshotai/kimi-k2.5`，
 *   实测图像 API key 跟文本 LLM key 不通用（HTTP 403 access_denied）；
 * - 改试 Mistral `api.mistral.ai`，DNS 被污染到 198.18.0.6 不可达；
 * - 最终走笨蛋自建 OpenAI 兼容中转 elysiver.h-e.top + qwen3.6-plus。
 *
 * 环境变量：
 * - `TEXT_LLM_BASE_URL`  默认 `https://elysiver.h-e.top`
 * - `TEXT_LLM_API_KEY`   首选；未配置时自动从 `IMAGE_PROVIDERS` JSON 中取
 *                        第一个 `type: qiniu` 条目的 apiKey（向后兼容）
 * - `TEXT_LLM_MODEL`     默认 `qwen3.6-plus`
 * - `TEXT_LLM_TIMEOUT_MS` 默认 60000（60 秒，qwen 生成 9 段提示词
 *                        实测基础延迟 8s+，留余量）
 */

import { z } from 'zod'

import type {
  PhotoFissionShotCard,
  PhotoFissionShotPlannerOutput,
} from '@/lib/types'

/**
 * Zod schema for `PhotoFissionShotPlannerOutput`。
 * 必须严格 9 项 + 字段非空。
 */
const ShotCardSchema = z.object({
  shotId: z.string().min(1),
  role: z.string().min(1),
  imagePrompt: z.string().min(20),
}) satisfies z.ZodType<PhotoFissionShotCard>

const ShotPlannerOutputSchema = z.object({
  shots: z.array(ShotCardSchema).length(9),
}) satisfies z.ZodType<PhotoFissionShotPlannerOutput>

export interface InvokeShotPlannerInput {
  systemPrompt: string
  userPrompt: string
  /** 可选的 traceId，仅用于日志追踪 */
  traceId?: string
}

export class ShotPlannerError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly stage?:
      | 'config'
      | 'http'
      | 'parse'
      | 'schema'
      | 'timeout',
  ) {
    super(message)
    this.name = 'ShotPlannerError'
  }
}

const DEFAULT_BASE_URL = 'https://elysiver.h-e.top'
const DEFAULT_MODEL = 'qwen3.6-plus'
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * 调用七牛云文本 LLM 生成 9 个 ShotCard。
 *
 * @throws ShotPlannerError caller 应捕获并回退到 v4 链路
 */
export async function invokeShotPlanner(
  input: InvokeShotPlannerInput,
): Promise<PhotoFissionShotPlannerOutput> {
  const apiKey = resolveTextLlmApiKey()
  if (!apiKey) {
    throw new ShotPlannerError(
      'TEXT_LLM_API_KEY is not configured (and no qiniu provider found in IMAGE_PROVIDERS)',
      undefined,
      'config',
    )
  }

  const baseUrl =
    process.env.TEXT_LLM_BASE_URL?.trim().replace(/\/$/, '') || DEFAULT_BASE_URL
  const model = process.env.TEXT_LLM_MODEL?.trim() || DEFAULT_MODEL
  const timeoutMs = parseTimeout(process.env.TEXT_LLM_TIMEOUT_MS)
  const endpoint = `${baseUrl}/v1/chat/completions`

  const body = {
    model,
    messages: [
      { role: 'system' as const, content: input.systemPrompt },
      { role: 'user' as const, content: input.userPrompt },
    ],
    stream: false,
    temperature: 0.85,
  }

  let response: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new ShotPlannerError(
        `Shot planner timed out after ${timeoutMs}ms`,
        err,
        'timeout',
      )
    }
    throw new ShotPlannerError(
      'Failed to reach text LLM endpoint',
      err,
      'http',
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errBody = await safeReadBody(response)
    throw new ShotPlannerError(
      `Text LLM returned ${response.status}: ${truncate(errBody, 400)}`,
      undefined,
      'http',
    )
  }

  const raw = await response.json().catch(() => null)
  if (!raw) {
    throw new ShotPlannerError(
      'Text LLM response is not valid JSON',
      undefined,
      'parse',
    )
  }

  const content = extractAssistantContent(raw)
  if (!content) {
    throw new ShotPlannerError(
      'Text LLM response missing assistant content',
      raw,
      'parse',
    )
  }

  const parsedJson = parseJsonLoose(content)
  if (!parsedJson) {
    throw new ShotPlannerError(
      'Assistant content is not parseable JSON',
      { content: truncate(content, 400) },
      'parse',
    )
  }

  const validated = ShotPlannerOutputSchema.safeParse(parsedJson)
  if (!validated.success) {
    throw new ShotPlannerError(
      `Schema validation failed: ${validated.error.message}`,
      validated.error,
      'schema',
    )
  }

  return validated.data
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return n
}

/**
 * 按优先级解析文本 LLM 的 API key：
 *   1. 显式 `TEXT_LLM_API_KEY`
 *   2. 复用 `IMAGE_PROVIDERS` JSON 中第一个 `type: qiniu` 条目的 apiKey
 *      （D5 决议：七牛云图像 API 与文本 LLM 同一套鉴权）
 *
 * 返回空字符串表示未找到，由 caller 抛出 config 错误。
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
 * 兼容 OpenAI 标准 chat.completion 响应 shape：
 *   choices[0].message.content 是 string
 * Kimi K2.5 同样走这套结构（content 可能是 string，也可能是 segments 数组）
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

/**
 * 容错 JSON 解析：剥离 ```json 代码围栏、抓最外层 {...}。
 * 系统提示词明令禁止围栏，但模型偶尔会越界，做一层保险。
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

  // 剥离 ```json ... ``` 或 ``` ... ``` 围栏
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch?.[1]) {
    const fenced = tryParse(fenceMatch[1].trim())
    if (fenced) return fenced
  }

  // 抓首个 { 到末个 } 之间的子串
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
