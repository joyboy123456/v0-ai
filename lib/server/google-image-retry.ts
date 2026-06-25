import { acquireGoogleImageSlot } from './google-image-throttle'
import { logImageEvent, type LogContext } from './log'

/**
 * 统一封装 Google 生图调用的：错误分类 + 指数退避重试 + 节流 + 401/403 熔断 + 结构化日志。
 *
 * 设计契约（PRD v4 §15.3 / §15.4）：
 * 1. 通过 GoogleImageError.category 决定 retryable 与每类上限，禁止 message.includes 判错
 * 2. 退避：delay = min(maxDelayMs, baseDelayMs × exponent^(attempt-1)) × (1 ± jitter)
 * 3. rate_limit：优先读 Retry-After header，取 max(Retry-After, 30s) 再叠加 jitter
 * 4. image_safety / safety_block 默认上限 1 次；empty_output 默认 2 次
 * 5. auth_failed 触发 30s provider/key 级熔断
 * 6. throttle 在每次 attempt 进入 fetch 之前 acquire
 */

export type GoogleImageErrorCategory =
  | 'network'
  | 'rate_limit'
  | 'server_error'
  | 'safety_block'
  | 'image_safety'
  | 'prohibited'
  | 'empty_output'
  | 'bad_request'
  | 'payload_too_large'
  | 'auth_failed'
  | 'api_error'
  | 'unknown'

export interface GoogleImageErrorInit {
  category: GoogleImageErrorCategory
  message: string
  retryable?: boolean
  httpStatus?: number
  retryAfterSeconds?: number
  cause?: unknown
  finishReason?: string
  blockReason?: string
}

const defaultRetryableByCategory: Record<GoogleImageErrorCategory, boolean> = {
  network: true,
  rate_limit: true,
  server_error: true,
  safety_block: true,
  image_safety: true,
  prohibited: false,
  empty_output: true,
  bad_request: false,
  payload_too_large: false,
  auth_failed: false,
  api_error: false,
  unknown: true,
}

export class GoogleImageError extends Error {
  category: GoogleImageErrorCategory
  retryable: boolean
  httpStatus?: number
  retryAfterSeconds?: number
  finishReason?: string
  blockReason?: string

  constructor(init: GoogleImageErrorInit) {
    super(init.message)
    this.name = 'GoogleImageError'
    this.category = init.category
    this.retryable = init.retryable ?? defaultRetryableByCategory[init.category]
    this.httpStatus = init.httpStatus
    this.retryAfterSeconds = init.retryAfterSeconds
    this.finishReason = init.finishReason
    this.blockReason = init.blockReason
    if (init.cause) {
      ;(this as Error & { cause?: unknown }).cause = init.cause
    }
  }
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  exponent?: number
  jitter?: number
  perCategoryMaxAttempts?: Partial<Record<GoogleImageErrorCategory, number>>
}

interface RetryAcquireOptions {
  apiKey: string
  signal?: AbortSignal
  /** provider 唯一标识，用于令牌桶隔离。不传时降级到 apiKey */
  providerId?: string
  /** 节流桶 key：同一凭证的多个 provider 可共享桶，避免重复消耗同一 key 额度 */
  rateLimitKey?: string
  /** 该 provider 的 IPM 上限。不传时降级读 env */
  maxIpm?: number
  /** 该 provider 的 RPM 上限。不传时降级读 env */
  maxRpm?: number
  /** 自定义 Retry-After 解析器，兼容非 Google provider 的 header 表达 */
  parseRetryAfter?: (value: string | null | undefined) => number | undefined
}

/**
 * 单类失败上限（含首次失败 + 重试失败的合计次数，达到上限后 throw）。
 *
 * 语义：limit=N 等价于"该类失败最多容忍 N 次（即 N-1 次重试）"。
 *
 * 取值对齐 PRD §15.13 接受标准：
 * - empty_output=3：§15.13.4 要求"重试 2 次后才 fail"，即 1 原 + 2 重试 = 3 次失败
 * - image_safety / safety_block=1：§15.3.4 "上限 1 次"——第 1 次失败即放弃，避免反复触发安全过滤
 * - rate_limit=2：限流时通常 Retry-After 单次等待较久，多重试意义有限
 * - unknown=1：兜底类别不轻易反复重试，避免吞掉真问题
 */
const defaultPerCategoryMaxAttempts: Partial<
  Record<GoogleImageErrorCategory, number>
> = {
  image_safety: 1,
  safety_block: 1,
  empty_output: 3,
  rate_limit: 2,
  unknown: 1,
}

function readPositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function readPositiveFloat(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function resolveRetryOptions(input?: RetryOptions) {
  const attempts =
    input?.attempts ??
    readPositiveInt(process.env.GOOGLE_IMAGE_RETRY_ATTEMPTS, 4)
  const baseDelayMs =
    input?.baseDelayMs ??
    readPositiveInt(process.env.GOOGLE_IMAGE_RETRY_BASE_DELAY_MS, 1000)
  const maxDelayMs =
    input?.maxDelayMs ??
    readPositiveInt(process.env.GOOGLE_IMAGE_RETRY_MAX_DELAY_MS, 60000)
  const exponent = input?.exponent ?? readPositiveFloat(undefined, 2)
  const jitter = input?.jitter ?? 0.25
  const perCategoryMaxAttempts = {
    ...defaultPerCategoryMaxAttempts,
    ...(input?.perCategoryMaxAttempts ?? {}),
  }
  return { attempts, baseDelayMs, maxDelayMs, exponent, jitter, perCategoryMaxAttempts }
}

/**
 * 计算指数退避（含 jitter）。jitter 区间 [1-jitter, 1+jitter]。
 * baseDelayMs × exponent^(attempt-1)，封顶 maxDelayMs。
 *
 * attempt 从 1 开始；attempt=1 表示第一次失败后准备第二次尝试。
 */
export function computeBackoffDelay(
  attempt: number,
  base: number,
  exponent: number,
  maxDelayMs: number,
  jitter: number,
): number {
  const raw = base * Math.pow(exponent, Math.max(0, attempt - 1))
  const clamped = Math.min(raw, maxDelayMs)
  const jitterFactor = 1 + (Math.random() * 2 - 1) * jitter
  return Math.max(0, Math.floor(clamped * jitterFactor))
}

/**
 * 429 / 503 时优先尊重 Retry-After。取 max(Retry-After, 30s) 再叠加 ±10% jitter。
 * 没有 Retry-After 时回退到指数退避计算。
 */
function computeRateLimitDelay(retryAfterSeconds: number | undefined): number {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return -1
  const baseMs = Math.max(retryAfterSeconds * 1000, 30_000)
  const jitterFactor = 1 + (Math.random() * 0.2 - 0.1)
  return Math.max(0, Math.floor(baseMs * jitterFactor))
}

// ---- 401/403 熔断 ----

const authFailureUntilByKey = new Map<string, number>()
const AUTH_BLOCK_DURATION_MS = 30_000

function getAuthCircuitKey(options: RetryAcquireOptions): string {
  return options.rateLimitKey || options.providerId || options.apiKey || '__default__'
}

function isAuthBlocked(circuitKey: string): boolean {
  const until = authFailureUntilByKey.get(circuitKey)
  if (until === undefined) return false
  if (Date.now() < until) return true
  authFailureUntilByKey.delete(circuitKey)
  return false
}

function tripAuthFailure(circuitKey: string) {
  authFailureUntilByKey.set(circuitKey, Date.now() + AUTH_BLOCK_DURATION_MS)
}

/** 测试用：解除熔断。生产代码不要调。 */
export function __resetAuthCircuitForTests() {
  authFailureUntilByKey.clear()
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 错误分类入口。fn 抛出非 GoogleImageError 时按 cause 形态尽力归类成 network / unknown。
 */
export function classifyUnknownError(error: unknown): GoogleImageError {
  if (error instanceof GoogleImageError) return error
  if (error instanceof Error) {
    const message = error.message ?? String(error)
    const lower = message.toLowerCase()
    // AbortError（fetch timeout）算 network 的子集，可重试
    if (
      error.name === 'AbortError' ||
      lower.includes('aborted') ||
      lower.includes('timeout') ||
      lower.includes('超时')
    ) {
      return new GoogleImageError({
        category: 'network',
        message,
        retryable: true,
        cause: error,
      })
    }
    if (
      lower.includes('fetch failed') ||
      lower.includes('und_err') ||
      lower.includes('econnreset') ||
      lower.includes('enotfound') ||
      lower.includes('网络请求失败')
    ) {
      return new GoogleImageError({
        category: 'network',
        message,
        retryable: true,
        cause: error,
      })
    }
    return new GoogleImageError({
      category: 'unknown',
      message,
      retryable: true,
      cause: error,
    })
  }
  return new GoogleImageError({
    category: 'unknown',
    message: String(error),
    retryable: true,
    cause: error,
  })
}

/**
 * 主入口：在 wrapper 内串行 attempts × (acquire throttle → 调 fn → 分类错误 → 退避)。
 *
 * fn 应在内部完成 fetch + 解析 + 抛出 GoogleImageError；非 GoogleImageError 会被 classifyUnknownError 兜底。
 * acquireOptions 由调用方传入 apiKey；wrapper 在每次 attempt 进入 fn 前 acquire 一次。
 */
export async function callGoogleImageWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  context: LogContext,
  acquireOptions: RetryAcquireOptions,
  options?: RetryOptions,
): Promise<T> {
  const resolved = resolveRetryOptions(options)
  const maxAttempts = Math.max(1, resolved.attempts)
  const authCircuitKey = getAuthCircuitKey(acquireOptions)

  // 401/403 熔断快路径
  if (isAuthBlocked(authCircuitKey)) {
    const err = new GoogleImageError({
      category: 'auth_failed',
      message: acquireOptions.providerId
        ? `生图渠道 ${acquireOptions.providerId} 凭证异常（熔断窗口未结束），请稍后重试或检查渠道 API Key`
        : '生图 API 凭证异常（熔断窗口未结束），请稍后重试或检查 API Key',
      retryable: false,
    })
    logImageEvent('gimg.fail', { ...context, attempt: 1 }, {
      category: err.category,
      reason: 'auth_circuit_open',
      providerId: acquireOptions.providerId,
    })
    throw err
  }

  const perCategoryUsed: Partial<Record<GoogleImageErrorCategory, number>> = {}
  let lastError: GoogleImageError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // 节流：每次 attempt 进 fetch 前 acquire 一次
    await acquireGoogleImageSlot({
      apiKey: acquireOptions.apiKey,
      signal: acquireOptions.signal,
      providerId: acquireOptions.rateLimitKey ?? acquireOptions.providerId,
      maxIpm: acquireOptions.maxIpm,
      maxRpm: acquireOptions.maxRpm,
      onWait: (waitMs, reason) => {
        logImageEvent(
          'gimg.throttle',
          { ...context, attempt },
          { waitMs, reason, providerId: acquireOptions.providerId },
        )
      },
    })

    try {
      const result = await fn(attempt)
      return result
    } catch (rawError) {
      const error =
        rawError instanceof GoogleImageError
          ? rawError
          : classifyUnknownError(rawError)
      lastError = error

      // 401/403 触发熔断（但仍把当前错误抛出，不在熔断窗口内 retry）
      if (error.category === 'auth_failed') {
        tripAuthFailure(authCircuitKey)
        logImageEvent('gimg.fail', { ...context, attempt }, {
          category: error.category,
          httpStatus: error.httpStatus,
          reason: error.message,
          authCircuitTrippedMs: AUTH_BLOCK_DURATION_MS,
          providerId: acquireOptions.providerId,
        })
        throw error
      }

      // 不可重试类直接 throw
      if (!error.retryable) {
        logImageEvent('gimg.fail', { ...context, attempt }, {
          category: error.category,
          httpStatus: error.httpStatus,
          finishReason: error.finishReason,
          blockReason: error.blockReason,
          reason: error.message,
        })
        throw error
      }

      // per-category 上限检查
      const used = (perCategoryUsed[error.category] ?? 0) + 1
      perCategoryUsed[error.category] = used
      const categoryLimit =
        resolved.perCategoryMaxAttempts[error.category]
      if (typeof categoryLimit === 'number' && used >= categoryLimit) {
        logImageEvent('gimg.fail', { ...context, attempt }, {
          category: error.category,
          httpStatus: error.httpStatus,
          finishReason: error.finishReason,
          blockReason: error.blockReason,
          reason: `${error.message}（已达单类上限 ${categoryLimit}）`,
        })
        throw error
      }

      // 已经是最后一次 attempt
      if (attempt >= maxAttempts) {
        logImageEvent('gimg.fail', { ...context, attempt }, {
          category: error.category,
          httpStatus: error.httpStatus,
          finishReason: error.finishReason,
          blockReason: error.blockReason,
          reason: `${error.message}（已达总尝试上限 ${maxAttempts}）`,
        })
        throw error
      }

      // 计算下次退避：rate_limit / server_error 优先尊重 Retry-After
      let delayMs = -1
      if (
        (error.category === 'rate_limit' ||
          error.category === 'server_error') &&
        error.retryAfterSeconds
      ) {
        delayMs = computeRateLimitDelay(error.retryAfterSeconds)
      }
      if (delayMs < 0) {
        delayMs = computeBackoffDelay(
          attempt,
          resolved.baseDelayMs,
          resolved.exponent,
          resolved.maxDelayMs,
          resolved.jitter,
        )
      }

      logImageEvent('gimg.retry', { ...context, attempt }, {
        category: error.category,
        httpStatus: error.httpStatus,
        retryAfterSeconds: error.retryAfterSeconds,
        delayMs,
        finishReason: error.finishReason,
        blockReason: error.blockReason,
        reason: error.message,
      })

      await sleep(delayMs)
    }
  }

  // 理论上不会走到这里
  throw (
    lastError ??
    new GoogleImageError({
      category: 'unknown',
      message: 'callGoogleImageWithRetry: exhausted attempts without error',
    })
  )
}

/**
 * 解析 Retry-After header（秒数或 HTTP-Date），返回秒数。无法解析返回 undefined。
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds)
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    const diff = Math.ceil((dateMs - Date.now()) / 1000)
    return diff > 0 ? diff : 0
  }
  return undefined
}
