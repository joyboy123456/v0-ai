/**
 * 多供应商并发生图调度池（Provider Pool）。
 *
 * 职责：
 * 1. 解析 IMAGE_PROVIDERS JSON 或从单渠道 env 降级构造 provider 列表
 * 2. 按唯一凭证优先的加权轮询将 N 个生图任务分发到 M 个渠道
 * 3. 每个 provider 维护独立的健康状态（熔断 / 限流标记）
 * 4. 提供 failover 接口：当某个 provider 单次调用失败且重试耗尽时，
 *    调度层可请求 pool 分配下一个可用 provider 重试
 *
 * 向后兼容：
 * - 不配 IMAGE_PROVIDERS 时，自动从 GOOGLE_API_KEY / QINIU_IMAGE_API_KEY 等
 *   单渠道 env 构造 provider 数组，Google 行为与改造前完全一致
 */

import { logImageEvent } from './log'
import {
  computeProviderSelectionScore,
  percentile,
} from './image-provider-metrics'

export { computeProviderSelectionScore, percentile } from './image-provider-metrics'

export type ImageProviderType =
  | 'google'
  | 'openai'
  | 'jimeng'
  | 'volces'
  | 'laozhang'
  | 'grsai'

export interface ImageProvider {
  /** 唯一标识，用于日志、节流桶隔离和配置引用 */
  id: string
  /** 供应商类型：决定走哪个 adapter */
  type: ImageProviderType
  /** API 凭证 */
  apiKey: string
  /** 可选 API base URL（不同模型可能有不同的默认地址） */
  baseUrl?: string
  /** 可选模型覆盖（不传走 env 默认） */
  model?: string
  /** 该渠道的 IPM 上限（用于独立节流） */
  maxIpm: number
  /** 该渠道的 RPM 上限 */
  maxRpm: number
  /** 单个任务内分配到该 provider 的最大并发 worker 数 */
  maxConcurrency?: number
  /** 权重（用于加权轮询调度，值越大分配越多） */
  weight: number
  /** 是否启用（运行时可熔断） */
  enabled: boolean
  /** 超时（ms） */
  timeoutMs: number
}

// ---- 模块级 singleton ----

const globalKey = '__image_provider_pool__'
const globalAny = globalThis as typeof globalThis & {
  [globalKey]?: ProviderPool
}

interface ProviderPool {
  providers: ImageProvider[]
  /** 轮询游标（跨调用递增，用于轮转每个批次的起始凭证） */
  cursor: number
  /** per-provider 临时熔断到期时间戳 */
  circuitOpenUntil: Map<string, number>
  circuitReason: Map<string, ProviderFailureCategory>
  halfOpenProbeCredentials: Set<string>
  activeByProvider: Map<string, number>
  recentResults: Map<string, ProviderRequestResult[]>
  consecutiveInfrastructureFailures: Map<string, number>
  circuitTripsByProvider: Map<string, number>
}

interface ProviderDispatchLane {
  provider: ImageProvider
  weight: number
}

function getPool(): ProviderPool {
  if (!globalAny[globalKey]) {
    globalAny[globalKey] = {
      providers: loadProviders(),
      cursor: 0,
      circuitOpenUntil: new Map(),
      circuitReason: new Map(),
      halfOpenProbeCredentials: new Set(),
      activeByProvider: new Map(),
      recentResults: new Map(),
      consecutiveInfrastructureFailures: new Map(),
      circuitTripsByProvider: new Map(),
    }
  }
  return globalAny[globalKey]
}

// ---- 配置加载 ----

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

interface RawProviderJson {
  id?: string
  type?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  maxIpm?: number
  maxRpm?: number
  maxConcurrency?: number
  weight?: number
  enabled?: boolean
  timeoutMs?: number
}

function loadProviders(): ImageProvider[] {
  const raw = process.env.IMAGE_PROVIDERS
  if (raw) {
    try {
      const parsed = parseProvidersConfig(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, index) => normalizeProviderConfig(item, index))
      }
    } catch (error) {
      console.error(
        '[provider-pool] IMAGE_PROVIDERS JSON 解析失败，降级到单渠道 env',
        error,
      )
    }
  }

  // 降级：从单渠道 env 构造 provider 数组。
  // Google 始终保留以维持历史兼容；七牛只有配置了 key 才加入。
  return buildDefaultProviders()
}

function parseProvidersConfig(raw: string): RawProviderJson[] {
  const trimmed = raw.trim()
  const candidates = [
    trimmed,
    stripEnvWrappingQuotes(trimmed),
  ].filter((item, index, list) => item && list.indexOf(item) === index)

  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as RawProviderJson[]
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

function stripEnvWrappingQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return value.slice(1, -1)
  }
  return value
}

function buildDefaultProviders(): ImageProvider[] {
  const providers = [buildDefaultGoogleProvider()]
  const qiniuProvider = buildDefaultQiniuProvider()
  const jimengProvider = buildDefaultJimengProvider()
  const volcesProvider = buildDefaultVolcesProvider()
  if (jimengProvider) providers.push(jimengProvider)
  if (qiniuProvider) providers.push(qiniuProvider)
  if (volcesProvider) providers.push(volcesProvider)
  return providers
}

function buildDefaultGoogleProvider(): ImageProvider {
  return {
    id: 'google-default',
    type: 'google',
    apiKey: process.env.GOOGLE_API_KEY ?? '',
    model: process.env.GOOGLE_IMAGE_MODEL ?? 'gemini-3.1-flash-image-preview',
    maxIpm: readPositiveInt(process.env.GOOGLE_IMAGE_IPM, 10),
    maxRpm: readPositiveInt(process.env.GOOGLE_IMAGE_RPM, 150),
    maxConcurrency: readPositiveInt(process.env.GOOGLE_IMAGE_CONCURRENCY, 3),
    weight: 1,
    enabled: true,
    timeoutMs: readPositiveInt(process.env.GOOGLE_IMAGE_TIMEOUT_MS, 600000),
  }
}

function buildDefaultQiniuProvider(): ImageProvider | null {
  const apiKey = process.env.QINIU_IMAGE_API_KEY ?? process.env.QINIU_API_KEY ?? ''
  if (!apiKey) return null

  return {
    id: 'openai-default',
    type: 'openai',
    apiKey,
    baseUrl: process.env.QINIU_IMAGE_BASE_URL,
    model: process.env.QINIU_IMAGE_MODEL ?? 'openai/gpt-image-2',
    maxIpm: readPositiveInt(process.env.QINIU_IMAGE_IPM, 10),
    maxRpm: readPositiveInt(process.env.QINIU_IMAGE_RPM, 150),
    maxConcurrency: readPositiveInt(process.env.QINIU_IMAGE_CONCURRENCY, 5),
    weight: 1,
    enabled: true,
    timeoutMs: readPositiveInt(process.env.QINIU_IMAGE_TIMEOUT_MS, 600000),
  }
}

function buildDefaultJimengProvider(): ImageProvider | null {
  const accessKey = process.env.JIMENG_ACCESS_KEY?.trim() ?? ''
  const secretKey = process.env.JIMENG_SECRET_KEY?.trim() ?? ''
  if (!accessKey || !secretKey) return null

  return {
    id: 'jimeng-default',
    type: 'jimeng',
    apiKey: accessKey + ':' + secretKey,
    model: process.env.JIMENG_IMAGE_MODEL ?? 'jimeng_seedream46_cvtob',
    maxIpm: readPositiveInt(process.env.JIMENG_IMAGE_IPM, 10),
    maxRpm: readPositiveInt(process.env.JIMENG_IMAGE_RPM, 150),
    maxConcurrency: readPositiveInt(process.env.JIMENG_IMAGE_CONCURRENCY, 9),
    weight: 5,
    enabled: true,
    timeoutMs: readPositiveInt(process.env.JIMENG_IMAGE_TIMEOUT_MS, 600000),
  }
}

function buildDefaultVolcesProvider(): ImageProvider | null {
  const apiKey = process.env.VOLCES_API_KEY?.trim() ?? ''
  if (!apiKey) return null

  return {
    id: 'volces-default',
    type: 'volces',
    apiKey,
    baseUrl: process.env.VOLCES_BASE_URL ?? 'https://ark.cn-beijing.volces.com',
    model: process.env.VOLCES_IMAGE_MODEL ?? 'doubao-seedream-4-5-251128',
    maxIpm: readPositiveInt(process.env.VOLCES_IMAGE_IPM, 500),
    maxRpm: readPositiveInt(process.env.VOLCES_IMAGE_RPM, 150),
    maxConcurrency: readPositiveInt(process.env.VOLCES_IMAGE_CONCURRENCY, 9),
    weight: 5,
    enabled: true,
    timeoutMs: readPositiveInt(process.env.VOLCES_IMAGE_TIMEOUT_MS, 600000),
  }
}

function normalizeProviderConfig(raw: RawProviderJson, index: number): ImageProvider {
  return {
    id: raw.id || `provider-${index}`,
    type: (raw.type as ImageProviderType) || 'google',
    apiKey: raw.apiKey || '',
    baseUrl: raw.baseUrl,
    model: raw.model,
    maxIpm: raw.maxIpm ?? 10,
    maxRpm: raw.maxRpm ?? 150,
    maxConcurrency: raw.maxConcurrency,
    weight: raw.weight ?? 1,
    enabled: raw.enabled !== false,
    timeoutMs: raw.timeoutMs ?? 600000,
  }
}

// ---- 健康状态管理 ----

const METRICS_WINDOW_MS = 5 * 60_000
const AUTH_CIRCUIT_DURATION_MS = 5 * 60_000
const INFRA_CIRCUIT_DURATION_MS = 60_000
const INFRA_FAILURE_THRESHOLD = 3

export type ProviderFailureCategory =
  | 'rate_limit'
  | 'auth_failed'
  | 'timeout'
  | 'server_error'
  | 'other_failure'

interface ProviderRequestResult {
  at: number
  durationMs: number
  category: 'success' | ProviderFailureCategory
}

export interface ProviderRequestToken {
  providerId: string
  startedAt: number
  halfOpenProbe: boolean
}

function isProviderAvailable(pool: ProviderPool, provider: ImageProvider): boolean {
  if (!provider.enabled) return false
  if (!provider.apiKey) return false

  const until = pool.circuitOpenUntil.get(provider.id)
  if (until !== undefined) {
    if (Date.now() < until) return false
    return !pool.halfOpenProbeCredentials.has(getProviderCredentialKey(provider))
  }

  return true
}

/** 标记 provider 凭证组进入熔断；认证失败默认 5 分钟，基础设施故障默认 60 秒。 */
export function tripProviderCircuit(
  providerId: string,
  category: ProviderFailureCategory = 'auth_failed',
  durationMs = category === 'auth_failed'
    ? AUTH_CIRCUIT_DURATION_MS
    : INFRA_CIRCUIT_DURATION_MS,
): void {
  const pool = getPool()
  const provider = pool.providers.find((item) => item.id === providerId)
  const providerIds = provider
    ? pool.providers
        .filter(
          (item) =>
            getProviderCredentialKey(item) === getProviderCredentialKey(provider),
        )
        .map((item) => item.id)
    : [providerId]
  const circuitOpenUntil = Date.now() + durationMs
  for (const id of providerIds) {
    pool.circuitOpenUntil.set(id, circuitOpenUntil)
    pool.circuitReason.set(id, category)
    pool.circuitTripsByProvider.set(
      id,
      (pool.circuitTripsByProvider.get(id) ?? 0) + 1,
    )
  }
  if (provider) {
    pool.halfOpenProbeCredentials.delete(getProviderCredentialKey(provider))
  }
  logImageEvent(
    'pool.circuit',
    { traceId: 'pool', taskId: '' },
    { providerId, providerIds, category, durationMs },
  )
}

/**
 * 在统一 provider router 开始真实请求前调用。
 * 熔断到期后，同一凭证组只允许一个半开探测请求进入上游。
 */
export function beginProviderRequest(
  providerId: string,
  now = Date.now(),
): ProviderRequestToken | null {
  const pool = getPool()
  const provider = pool.providers.find((item) => item.id === providerId)
  if (!provider || !provider.enabled || !provider.apiKey) return null
  const credentialKey = getProviderCredentialKey(provider)
  const openUntil = pool.circuitOpenUntil.get(providerId)
  let halfOpenProbe = false
  if (openUntil !== undefined) {
    if (now < openUntil) return null
    if (pool.halfOpenProbeCredentials.has(credentialKey)) return null
    pool.halfOpenProbeCredentials.add(credentialKey)
    halfOpenProbe = true
  }
  pool.activeByProvider.set(providerId, (pool.activeByProvider.get(providerId) ?? 0) + 1)
  return { providerId, startedAt: now, halfOpenProbe }
}

export function finishProviderRequest(
  token: ProviderRequestToken,
  result: { category: 'success' | ProviderFailureCategory; now?: number },
): void {
  const pool = getPool()
  const now = result.now ?? Date.now()
  const provider = pool.providers.find((item) => item.id === token.providerId)
  pool.activeByProvider.set(
    token.providerId,
    Math.max(0, (pool.activeByProvider.get(token.providerId) ?? 1) - 1),
  )
  const history = pruneProviderHistory(pool, token.providerId, now)
  history.push({
    at: now,
    durationMs: Math.max(0, now - token.startedAt),
    category: result.category,
  })

  if (!provider) return
  const credentialKey = getProviderCredentialKey(provider)
  if (token.halfOpenProbe) pool.halfOpenProbeCredentials.delete(credentialKey)

  if (result.category === 'success') {
    closeCredentialCircuit(pool, provider)
    pool.consecutiveInfrastructureFailures.set(token.providerId, 0)
    return
  }

  if (result.category === 'auth_failed') {
    tripProviderCircuit(token.providerId, 'auth_failed')
    return
  }

  const infrastructureFailure =
    result.category === 'timeout' || result.category === 'server_error'
  const consecutive = infrastructureFailure
    ? (pool.consecutiveInfrastructureFailures.get(token.providerId) ?? 0) + 1
    : 0
  pool.consecutiveInfrastructureFailures.set(token.providerId, consecutive)
  if (
    (token.halfOpenProbe && infrastructureFailure) ||
    consecutive >= INFRA_FAILURE_THRESHOLD
  ) {
    tripProviderCircuit(token.providerId, result.category)
  }
}

function closeCredentialCircuit(pool: ProviderPool, provider: ImageProvider): void {
  const credentialKey = getProviderCredentialKey(provider)
  for (const item of pool.providers) {
    if (getProviderCredentialKey(item) !== credentialKey) continue
    pool.circuitOpenUntil.delete(item.id)
    pool.circuitReason.delete(item.id)
    pool.consecutiveInfrastructureFailures.set(item.id, 0)
  }
  pool.halfOpenProbeCredentials.delete(credentialKey)
}

function pruneProviderHistory(
  pool: ProviderPool,
  providerId: string,
  now: number,
): ProviderRequestResult[] {
  const cutoff = now - METRICS_WINDOW_MS
  const history = (pool.recentResults.get(providerId) ?? []).filter(
    (item) => item.at >= cutoff,
  )
  pool.recentResults.set(providerId, history)
  return history
}

// ---- 调度 API ----

/**
 * 获取所有已注册的 provider（含不可用的）。
 * 调用方用于构建降级链。
 */
export function getAllProviders(): ImageProvider[] {
  return getPool().providers
}

/**
 * Health 快照：每个 provider 的当前可用性 / 熔断到期时间。
 * 供 /api/health/providers 端点使用，方便运维一眼看出哪个渠道在抽风。
 */
export interface ProviderHealthEntry {
  id: string
  type: ImageProviderType
  enabled: boolean
  hasApiKey: boolean
  available: boolean
  weight: number
  maxIpm: number
  maxRpm: number
  circuitOpenUntil: number | null
  circuitRemainMs: number | null
  circuitReason: ProviderFailureCategory | null
  halfOpenProbe: boolean
  active: number
  concurrencyLimit: number
  channelId: string
  samples: number
  successRate: number | null
  p50DurationMs: number | null
  p95DurationMs: number | null
  failures: {
    rateLimit: number
    auth: number
    timeout: number
    serverError: number
    other: number
  }
  consecutiveInfrastructureFailures: number
  circuitTrips: number
}

export function getProviderHealthSnapshot(): ProviderHealthEntry[] {
  const pool = getPool()
  const now = Date.now()
  return pool.providers.map((p) => {
    const until = pool.circuitOpenUntil.get(p.id) ?? null
    const circuitOpen = until !== null && now < until
    const history = pruneProviderHistory(pool, p.id, now)
    const successes = history.filter((item) => item.category === 'success')
    const durations = history.map((item) => item.durationMs)
    return {
      id: p.id,
      type: p.type,
      enabled: p.enabled,
      hasApiKey: Boolean(p.apiKey),
      available: isProviderAvailable(pool, p),
      weight: p.weight,
      maxIpm: p.maxIpm,
      maxRpm: p.maxRpm,
      circuitOpenUntil: circuitOpen ? until : null,
      circuitRemainMs: circuitOpen ? Math.max(0, (until as number) - now) : null,
      circuitReason: until !== null ? (pool.circuitReason.get(p.id) ?? null) : null,
      halfOpenProbe:
        until !== null &&
        now >= until &&
        pool.halfOpenProbeCredentials.has(getProviderCredentialKey(p)),
      active: pool.activeByProvider.get(p.id) ?? 0,
      concurrencyLimit: readProviderConcurrency(p),
      channelId: p.type === 'laozhang' ? 'laozhang' : p.id,
      samples: history.length,
      successRate: history.length ? successes.length / history.length : null,
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      failures: {
        rateLimit: history.filter((item) => item.category === 'rate_limit').length,
        auth: history.filter((item) => item.category === 'auth_failed').length,
        timeout: history.filter((item) => item.category === 'timeout').length,
        serverError: history.filter((item) => item.category === 'server_error').length,
        other: history.filter((item) => item.category === 'other_failure').length,
      },
      consecutiveInfrastructureFailures:
        pool.consecutiveInfrastructureFailures.get(p.id) ?? 0,
      circuitTrips: pool.circuitTripsByProvider.get(p.id) ?? 0,
    }
  })
}

/**
 * 获取当前可用的 provider 列表（排除 enabled=false、apiKey 为空、熔断中的）。
 */
export function getAvailableProviders(): ImageProvider[] {
  const pool = getPool()
  return pool.providers.filter((p) => isProviderAvailable(pool, p))
}

export function isGoogleImageModel(model: string | undefined): boolean {
  if (!model) return true
  return model.trim().toLowerCase().startsWith('gemini-')
}

/**
 * gpt-image-2.5 系列目前只接入 Grsai 渠道（老张渠道已弃用、七牛未配置），
 * 必须从七牛/老张的兼容判定中排除，避免 failover 链误打已废渠道。
 */
export function isGrsaiOnlyGptImageModel(model: string | undefined): boolean {
  if (!model) return false
  const lower = model.trim().toLowerCase()
  return lower.startsWith('gpt-image-2.5') || lower.startsWith('openai/gpt-image-2.5')
}

export function isQiniuImageModel(model: string | undefined): boolean {
  if (!model) return true
  if (isGrsaiOnlyGptImageModel(model)) return false
  const lower = model.trim().toLowerCase()
  return (
    lower.startsWith('gemini-') ||
    lower.startsWith('gpt-image-') ||
    lower.startsWith('openai/gpt-image-')
  )
}

function getQiniuModelFamily(model: string | undefined): 'gemini' | 'gpt' | null {
  if (!model) return null
  const lower = normalizeImageModelId(model)
  if (lower.startsWith('gemini-')) return 'gemini'
  if (lower.startsWith('openai/gpt-image-')) return 'gpt'
  return null
}

export function isJimengImageModel(model: string | undefined): boolean {
  if (!model) return true
  const lower = model.trim().toLowerCase()
  return lower.startsWith("jimeng")
}

export function isVolcesImageModel(model: string | undefined): boolean {
  if (!model) return true
  const lower = model.trim().toLowerCase()
  return lower.startsWith('doubao') || lower.startsWith('seedream') || lower.startsWith('volces')
}

export function isLaozhangImageModel(model: string | undefined): boolean {
  if (!model) return true
  if (isGrsaiOnlyGptImageModel(model)) return false
  const lower = model.trim().toLowerCase()
  return (
    lower.startsWith('gemini-') ||
    lower.startsWith('gpt-image-') ||
    lower.startsWith('openai/gpt-image-') ||
    lower.startsWith('doubao') ||
    lower.startsWith('seedream')
  )
}

/**
 * Grsai 原生 /v1/api/generate 接受的模型名：
 * - nano-banana-* 全系列（见 lib/server/grsai-image-adapter.ts 和 grsai 官方文档）
 * - gpt-image-2.5-* 系列（grsai 已注册 gpt-image-2.5 / -flare / -sunburst，实测校验通过）
 */
export function isGrsaiImageModel(model: string | undefined): boolean {
  if (!model) return true
  const lower = model.trim().toLowerCase()
  return lower.startsWith('nano-banana-') || lower.startsWith('gpt-image-2.5')
}

function normalizeVolcesModelId(model: string | undefined): string {
  const lower = model?.trim().toLowerCase() ?? ''
  if (lower === 'doubao-seedream-4.5') return 'doubao-seedream-4-5-251128'
  if (lower === 'doubao-seedream-5.0-lite') return 'doubao-seedream-5-0-260128'
  return lower
}

export function isImageProviderModelCompatible(
  provider: ImageProvider,
  model: string | undefined,
): boolean {
  const candidate = model || provider.model
  if (provider.type === 'google') return isGoogleImageModel(candidate)
  if (provider.type === 'openai') {
    if (!isQiniuImageModel(candidate)) return false
    const requestedFamily = getQiniuModelFamily(model)
    const providerFamily = getQiniuModelFamily(provider.model)
    return !requestedFamily || !providerFamily || requestedFamily === providerFamily
  }
  if (provider.type === 'laozhang') return isLaozhangImageModel(candidate)
  if (provider.type === 'grsai') return isGrsaiImageModel(candidate)
  if (provider.type === 'jimeng') return isJimengImageModel(candidate)
  if (provider.type === 'volces') {
    if (!isVolcesImageModel(candidate)) return false
    if (!model) return true
    return normalizeVolcesModelId(model) === normalizeVolcesModelId(provider.model)
  }
  return false
}

/**
 * 获取当前可用且支持指定模型的 provider。
 * 例如 gpt-image-2.5-* 只走 Grsai 渠道，gemini 官方名不能分发给 Grsai adapter。
 */
export function getAvailableProvidersForModel(
  model: string | undefined,
): ImageProvider[] {
  const allAvailable = getAvailableProviders()
  const compatible = allAvailable.filter((provider) =>
    isImageProviderModelCompatible(provider, model),
  )

  // 调试日志：记录 provider 匹配情况
  console.log('[provider-pool] getAvailableProvidersForModel', {
    model,
    allAvailableCount: allAvailable.length,
    allAvailable: allAvailable.map(p => ({
      id: p.id,
      type: p.type,
      model: p.model,
      hasApiKey: Boolean(p.apiKey),
      compatible: isImageProviderModelCompatible(p, model)
    })),
    compatibleCount: compatible.length,
    compatible: compatible.map(p => ({ id: p.id, type: p.type })),
  })

  if (compatible.length === 0 && allAvailable.length > 0) {
    console.warn('[provider-pool] 模型匹配失败，无可用 provider')
  }

  return compatible
}

/**
 * 返回起点轮转后的 provider failover 链（每个凭证 key 只出现一次）。
 *
 * 与 buildCredentialInterleavedList 的区别：后者按 weight 展开重复条目以支持
 * dispatchItems 的加权分配；本函数返回去重后的唯一链，适合单图任务（如
 * ai-fashion-photo）逐个 failover。每次调用 pool.cursor+1，让并发的单图任务
 * 自动分摊到不同 key，避免全部压在配置里的第一把 key。
 */
export function getRotatedProvidersForModel(
  model: string | undefined,
): ImageProvider[] {
  const available = getAvailableProvidersForModel(model)
  if (available.length <= 1) return available

  const pool = getPool()
  const lanes = buildProviderDispatchLanes(available, model)
  if (!lanes.length) return []

  const startIndex = pool.cursor % lanes.length
  pool.cursor += 1
  const rotated = lanes.slice(startIndex).concat(lanes.slice(0, startIndex))
  return rotated.map((lane) => lane.provider)
}

export function getNoAvailableProviderMessage(model: string | undefined): string {
  if (!model) return '没有可用的生图渠道（所有 provider 均不可用）'

  const lower = model.trim().toLowerCase()
  if (isGrsaiOnlyGptImageModel(model)) {
    const providers = getAllProviders()
    const grsaiProviders = providers.filter((provider) => provider.type === 'grsai')
    const availableGrsaiProviders = getAvailableProviders().filter(
      (provider) => provider.type === 'grsai',
    )

    return [
      `没有可用的生图渠道支持模型 ${model}`,
      'GPT Image 2.5 只走 Grsai 渠道，不能落到老张/七牛/Google adapter',
      '请确认 IMAGE_PROVIDERS 中至少有一个 type="grsai" 且 apiKey 不为空的 provider',
      `当前已加载 grsai provider ${grsaiProviders.length} 个，可用 ${availableGrsaiProviders.length} 个`,
      '如果刚修改过 .env.local，请重启 pnpm dev 让 Next.js 重新读取环境变量',
    ].join('。')
  }
  if (lower.startsWith('gpt-image-') || lower.startsWith('openai/gpt-image-')) {
    return `没有可用的生图渠道支持模型 ${model}（GPT Image 2 的老张/七牛渠道已下线，请改用 GPT Image 2.5）`
  }

  return `没有可用的生图渠道支持模型 ${model}`
}

/**
 * 加权轮询选一个可用 provider。
 * 多次调用自动轮转，适合 ai-fashion-photo 等 count>1 串行场景。
 *
 * 返回 null 表示所有 provider 都不可用。
 */
export function pickNextProvider(): ImageProvider | null {
  const available = getAvailableProviders()
  if (!available.length) return null
  if (available.length === 1) return available[0]

  const pool = getPool()
  const weighted = buildCredentialInterleavedList(
    available,
    undefined,
    pool.cursor,
  )
  pool.cursor += 1
  return weighted[0] ?? null
}

/**
 * 将 N 个工作单元（shot / 图片）按加权轮询分配到可用 provider。
 * 返回 Map<providerId, workItems[]>。
 *
 * 适用于 photo-fission / pose-fission 等批量生图场景。
 *
 * @param items - 待分发的工作单元数组
 * @returns 按 providerId 分组的 Map，value 是 { provider, item } 元组
 */
export function dispatchItems<T>(
  items: T[],
): Map<string, { provider: ImageProvider; items: T[] }> {
  return dispatchItemsWithProviders(items, getAvailableProviders(), undefined)
}

export function dispatchItemsForModel<T>(
  items: T[],
  model: string | undefined,
): Map<string, { provider: ImageProvider; items: T[] }> {
  return dispatchItemsWithProviders(
    items,
    getAvailableProvidersForModel(model),
    model,
  )
}

function dispatchItemsWithProviders<T>(
  items: T[],
  available: ImageProvider[],
  model: string | undefined,
): Map<string, { provider: ImageProvider; items: T[] }> {
  if (!available.length) {
    throw new Error(getNoAvailableProviderMessage(model))
  }

  const pool = getPool()
  const weighted = buildCredentialInterleavedList(
    available,
    model,
    pool.cursor,
  )
  const groups = new Map<string, { provider: ImageProvider; items: T[] }>()

  for (let i = 0; i < items.length; i++) {
    const providerIndex = i % weighted.length
    const provider = weighted[providerIndex]

    let group = groups.get(provider.id)
    if (!group) {
      group = { provider, items: [] }
      groups.set(provider.id, group)
    }
    group.items.push(items[i])
  }

  pool.cursor += 1
  return groups
}

/**
 * 当某个 provider 对某个 item 失败且重试耗尽时，尝试获取下一个可用 provider。
 * 排除指定的 excludeProviderIds。
 *
 * 返回 null 表示没有其他可用 provider。
 */
export function getFailoverProvider(excludeProviderIds: string[]): ImageProvider | null {
  const available = filterProvidersForFailover(
    getAvailableProviders(),
    excludeProviderIds,
  )
  if (!available.length) return null
  const pool = getPool()
  const provider =
    buildCredentialInterleavedList(available, undefined, pool.cursor)[0] ?? null
  pool.cursor += 1
  return provider
}

export function getFailoverProviderForModel(
  excludeProviderIds: string[],
  model: string | undefined,
): ImageProvider | null {
  const available = filterProvidersForFailover(
    getAvailableProvidersForModel(model),
    excludeProviderIds,
  )
  if (!available.length) return null
  const pool = getPool()
  const provider =
    buildCredentialInterleavedList(available, model, pool.cursor)[0] ?? null
  pool.cursor += 1
  return provider
}

export function getProviderRateLimitKey(provider: ImageProvider): string {
  return getProviderCredentialKey(provider)
}

// ---- 内部工具 ----

/**
 * 构建唯一凭证优先的加权列表。
 *
 * 同一把 key 下可能配置了多个模型 provider；调度时它们共享同一条
 * credential lane，避免一个批次先把多个 shot 都压到同一把 key。每条 lane
 * 使用当前模型实际命中的 provider 及其 weight，确保调度权重与 env 对齐。
 */
function buildCredentialInterleavedList(
  providers: ImageProvider[],
  model: string | undefined,
  startCursor: number,
): ImageProvider[] {
  const offset = providers.length ? startCursor % providers.length : 0
  const rotatedProviders = providers.slice(offset).concat(providers.slice(0, offset))
  const lanes = buildProviderDispatchLanes(rotatedProviders, model)
  if (!lanes.length) return []

  const maxWeight = Math.max(...lanes.map((lane) => lane.weight))
  const list: ImageProvider[] = []

  for (let round = 0; round < maxWeight; round++) {
    for (const lane of lanes) {
      if (round < lane.weight) {
        list.push(lane.provider)
      }
    }
  }

  return list
}

function buildProviderDispatchLanes(
  providers: ImageProvider[],
  model: string | undefined,
): ProviderDispatchLane[] {
  const groups = new Map<string, ImageProvider[]>()
  for (const provider of providers) {
    const key = getProviderCredentialKey(provider)
    const group = groups.get(key) ?? []
    group.push(provider)
    groups.set(key, group)
  }

  const pool = getPool()
  return Array.from(groups.values()).map((group) => {
    const provider = pickPreferredProviderForModel(group, model)
    return {
      provider,
      weight: readProviderWeight(provider),
    }
  }).sort((left, right) => {
    const scoreDiff = getProviderSelectionScore(pool, right.provider) -
      getProviderSelectionScore(pool, left.provider)
    return scoreDiff
  })
}

function pickPreferredProviderForModel(
  providers: ImageProvider[],
  model: string | undefined,
): ImageProvider {
  const normalizedModel = normalizeImageModelId(model)
  if (!normalizedModel) return providers[0]

  const exactMatch = providers.find(
    (provider) => normalizeImageModelId(provider.model) === normalizedModel,
  )
  return exactMatch ?? providers[0]
}

function filterProvidersForFailover(
  providers: ImageProvider[],
  excludeProviderIds: string[],
): ImageProvider[] {
  const excludeSet = new Set(excludeProviderIds)
  const excludedCredentialKeys = new Set(
    getAllProviders()
      .filter((provider) => excludeSet.has(provider.id))
      .map((provider) => getProviderCredentialKey(provider)),
  )

  return providers.filter(
    (provider) =>
      !excludeSet.has(provider.id) &&
      !excludedCredentialKeys.has(getProviderCredentialKey(provider)),
  )
}

function getProviderCredentialKey(provider: ImageProvider): string {
  const credential = provider.apiKey || provider.id
  return `${provider.type}:${credential}`
}

function normalizeImageModelId(model: string | undefined): string {
  if (!model) return ''
  const normalized = model.trim().toLowerCase()
  if (normalized.startsWith('gpt-image-')) return `openai/${normalized}`
  return normalized
}

function readProviderWeight(provider: ImageProvider): number {
  return Math.min(Math.max(1, Math.floor(provider.weight)), 10)
}

function readProviderConcurrency(provider: ImageProvider): number {
  return Math.max(
    1,
    Math.floor(
      provider.maxConcurrency ??
      readPositiveInt(process.env.IMAGE_PER_PROVIDER_CONCURRENCY, 2),
    ),
  )
}

function getProviderSelectionScore(
  pool: ProviderPool,
  provider: ImageProvider,
): number {
  const now = Date.now()
  const history = pruneProviderHistory(pool, provider.id, now)
  const successCount = history.filter((item) => item.category === 'success').length
  return computeProviderSelectionScore({
    weight: readProviderWeight(provider),
    active: pool.activeByProvider.get(provider.id) ?? 0,
    limit: readProviderConcurrency(provider),
    successRate: history.length ? successCount / history.length : null,
    p95DurationMs: percentile(history.map((item) => item.durationMs), 0.95),
  })
}

// ---- 测试工具 ----

/** 测试用：重置 pool singleton。生产代码不要调用。 */
export function __resetProviderPoolForTests(): void {
  delete globalAny[globalKey]
}
