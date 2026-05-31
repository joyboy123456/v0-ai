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

export type ImageProviderType = 'google' | 'qiniu' | 'jimeng' | 'volces'

export interface ImageProvider {
  /** 唯一标识，用于日志、节流桶隔离和配置引用 */
  id: string
  /** 供应商类型：决定走哪个 adapter */
  type: ImageProviderType
  /** API 凭证 */
  apiKey: string
  /** 可选 API base URL（七牛 Gemini 默认 api.qnaigc.com，GPT 图像默认 openai.qiniu.com） */
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
    id: 'qiniu-default',
    type: 'qiniu',
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

const CIRCUIT_OPEN_DURATION_MS = 30_000

function isProviderAvailable(pool: ProviderPool, provider: ImageProvider): boolean {
  if (!provider.enabled) return false
  if (!provider.apiKey) return false

  const until = pool.circuitOpenUntil.get(provider.id)
  if (until !== undefined) {
    if (Date.now() < until) return false
    // 熔断窗口已过，清除标记
    pool.circuitOpenUntil.delete(provider.id)
  }

  return true
}

/**
 * 标记某个 provider 进入熔断状态（30s 不可用）。
 * 用于 auth_failed (401/403) 等不可恢复错误场景。
 */
export function tripProviderCircuit(providerId: string): void {
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
  const circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS
  for (const id of providerIds) {
    pool.circuitOpenUntil.set(id, circuitOpenUntil)
  }
  logImageEvent(
    'pool.circuit',
    { traceId: 'pool', taskId: '' },
    { providerId, providerIds, durationMs: CIRCUIT_OPEN_DURATION_MS },
  )
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
}

export function getProviderHealthSnapshot(): ProviderHealthEntry[] {
  const pool = getPool()
  const now = Date.now()
  return pool.providers.map((p) => {
    const until = pool.circuitOpenUntil.get(p.id) ?? null
    const circuitOpen = until !== null && now < until
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

export function isQiniuImageModel(model: string | undefined): boolean {
  if (!model) return true
  const lower = model.trim().toLowerCase()
  return (
    lower.startsWith('gemini-') ||
    lower.startsWith('gpt-image-') ||
    lower.startsWith('openai/gpt-image-')
  )
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
  if (provider.type === 'qiniu') return isQiniuImageModel(candidate)
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
 * 例如 gpt-image-* 只能走七牛 OpenAI 兼容渠道，不能分发给 Google 官方 adapter。
 */
export function getAvailableProvidersForModel(
  model: string | undefined,
): ImageProvider[] {
  return getAvailableProviders().filter((provider) =>
    isImageProviderModelCompatible(provider, model),
  )
}

export function getNoAvailableProviderMessage(model: string | undefined): string {
  if (!model) return '没有可用的生图渠道（所有 provider 均不可用）'

  const lower = model.trim().toLowerCase()
  if (lower.startsWith('gpt-image-') || lower.startsWith('openai/gpt-image-')) {
    const providers = getAllProviders()
    const qiniuProviders = providers.filter((provider) => provider.type === 'qiniu')
    const availableQiniuProviders = getAvailableProviders().filter(
      (provider) => provider.type === 'qiniu',
    )

    return [
      `没有可用的生图渠道支持模型 ${model}`,
      'GPT Image 2 只走七牛云 qiniu 渠道，也不能落到 Google 官方 adapter',
      '请确认 IMAGE_PROVIDERS 中至少有一个 type="qiniu" 且 apiKey 不为空的 provider，或配置 QINIU_IMAGE_API_KEY',
      `当前已加载 qiniu provider ${qiniuProviders.length} 个，可用 ${availableQiniuProviders.length} 个`,
      '如果刚修改过 .env.local，请重启 pnpm dev 让 Next.js 重新读取环境变量',
    ].join('。')
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
 * 同一把七牛 key 下可能配置了多个模型 provider；调度时它们共享同一条
 * credential lane，避免一个批次先把多个 shot 都压到同一把 key。第一轮
 * 先覆盖每条 lane，第二轮开始再按 weight 补齐高权重 lane。
 */
function buildCredentialInterleavedList(
  providers: ImageProvider[],
  model: string | undefined,
  startCursor: number,
): ImageProvider[] {
  const lanes = buildProviderDispatchLanes(providers, model)
  if (!lanes.length) return []

  const startIndex = startCursor % lanes.length
  const rotated = lanes.slice(startIndex).concat(lanes.slice(0, startIndex))
  const maxWeight = Math.max(...rotated.map((lane) => lane.weight))
  const list: ImageProvider[] = []

  for (let round = 0; round < maxWeight; round++) {
    for (const lane of rotated) {
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

  return Array.from(groups.values()).map((group) => ({
    provider: pickPreferredProviderForModel(group, model),
    weight: Math.max(...group.map((provider) => readProviderWeight(provider))),
  }))
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

// ---- 测试工具 ----

/** 测试用：重置 pool singleton。生产代码不要调用。 */
export function __resetProviderPoolForTests(): void {
  delete globalAny[globalKey]
}
