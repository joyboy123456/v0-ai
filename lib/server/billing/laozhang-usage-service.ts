/**
 * 老张 API 历史用量查询服务。
 *
 * 两个上游接口（均用 LAOZHANG_ACCESS_TOKEN 认证，不带 Bearer）：
 * - GET /api/data/self?start_timestamp&end_timestamp → 按天×按模型聚合（实际扣费）
 * - GET /api/log/self?p&start_timestamp&end_timestamp → 逐条调用流水（10条/页，无总数）
 *
 * 调研文档：.trellis/tasks/08-03-billing-observatory/research/laozhang-usage-api.md
 */

import { getUnitPriceUsd } from './pricing'

/** 查询范围预设。 */
export type BillingRange = 'today' | '7d' | '30d'

/** 单天用量（按天聚合）。 */
export interface DailyUsage {
  /** YYYY-MM-DD（上游 UTC 口径） */
  date: string
  /** 当天总花费 USD */
  totalUsd: number
  /** 当天调用次数（推算） */
  calls: number
  /** 当天按模型分组 */
  byModel: Array<{
    model: string
    totalUsd: number
    calls: number
  }>
}

/** 范围用量汇总。 */
export interface RangeUsageSummary {
  /** 范围标识 */
  range: BillingRange
  /** 范围内总花费 USD */
  totalUsd: number
  /** 范围内总调用次数 */
  totalCalls: number
  /** 按天分布 */
  days: DailyUsage[]
  /** 按模型汇总 */
  byModel: Array<{
    model: string
    totalUsd: number
    calls: number
  }>
}

/** 单条调用日志。 */
export interface CallLogItem {
  /** ISO 时间戳 */
  ts: string
  /** Unix 秒 */
  createdAt: number
  /** 模型 ID */
  model: string
  /** 使用的 key 名称（token_name） */
  keyName: string
  /** 本次扣费 USD */
  usd: number
  /** 输入 tokens */
  promptTokens: number
  /** 输出 tokens */
  completionTokens: number
  /** 耗时秒 */
  durationSec: number
  /** 计费明细文字 */
  content: string
}

/** 逐条日志查询结果。 */
export interface CallLogResult {
  /** 查询日期 YYYY-MM-DD */
  date: string
  /** 当前页码 */
  page: number
  /** 日志条目 */
  items: CallLogItem[]
  /** 是否还有下一页（满页=可能有更多） */
  hasMore: boolean
}

/** 单小时用量（本地时区 0-23）。 */
export interface HourlyUsage {
  hour: number
  totalUsd: number
  calls: number
}

/** 某天逐小时用量聚合结果。 */
export interface HourlyUsageResult {
  date: string
  /** 24 个小时的完整数组（无消费的小时全 0） */
  hours: HourlyUsage[]
  /** 日志翻页触达上限，聚合可能不完整 */
  truncated: boolean
}

// ---- 进程内缓存 ----

interface CacheEntry<T> {
  data: T
  tsMs: number
}

const dailyCacheKey = '__laozhang_daily_usage_cache__'
const hourlyCacheKey = '__laozhang_hourly_usage_cache__'
const globalAny = globalThis as typeof globalThis & {
  [dailyCacheKey]?: CacheEntry<Record<string, RangeUsageSummary>>
  [hourlyCacheKey]?: Record<string, CacheEntry<HourlyUsageResult>>
}

/** daily 聚合缓存有效期（ms）。 */
const DAILY_CACHE_TTL_MS = 60_000
/** hourly 聚合缓存：今天 60s（数据在变），历史天 30min（基本不变）。 */
const HOURLY_CACHE_TTL_TODAY_MS = 60_000
const HOURLY_CACHE_TTL_PAST_MS = 30 * 60_000
/** hourly 聚合翻页上限（10 条/页 → 最多聚合 500 条调用），防异常天刷爆上游。 */
const HOURLY_MAX_PAGES = 50

// ---- 时间工具 ----

/** 返回本地时区日期字符串 YYYY-MM-DD。 */
function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 根据 range 计算起止 Unix 秒（本地时区日界）。 */
function getRangeTimestamps(range: BillingRange): { startSec: number; endSec: number } {
  const now = new Date()
  // end = 当前时刻
  const end = now
  // start = N 天前 00:00 本地
  const start = new Date(now)
  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (range === '7d') {
    start.setDate(start.getDate() - 6) // 含今天共 7 天
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(start.getDate() - 29) // 含今天共 30 天
    start.setHours(0, 0, 0, 0)
  }
  return {
    startSec: Math.floor(start.getTime() / 1000),
    endSec: Math.floor(end.getTime() / 1000),
  }
}

/** 将本地日期 YYYY-MM-DD 转为当天的 Unix 秒范围 [00:00, 次日00:00)。 */
function getDateTimestampRange(dateStr: string): { startSec: number; endSec: number } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0)
  return {
    startSec: Math.floor(start.getTime() / 1000),
    endSec: Math.floor(end.getTime() / 1000),
  }
}

// ---- 上游响应类型 ----

interface LaozhangDataSelfRow {
  date: string
  modelName: string
  sumQuota: number
  sumUsd: number
}

interface LaozhangDataSelfResponse {
  success: boolean
  message?: string | null
  data?: LaozhangDataSelfRow[]
}

interface LaozhangLogSelfRow {
  created_at: number
  model_name: string
  token_name: string
  quota: number
  prompt_tokens: number
  completion_tokens: number
  duration_for_view: number
  content: string
}

interface LaozhangLogSelfResponse {
  success: boolean
  message?: string | null
  data?: LaozhangLogSelfRow[]
}

/** 额度 → USD 换算系数（与 balance-service 一致）。 */
const QUOTA_PER_USD = 500_000

// ---- 公共 API ----

/**
 * 查询老张 API 按天聚合用量（实际扣费）。
 *
 * 调 /api/data/self，一次请求拿整段范围，本地聚合为按天+按模型+范围汇总。
 * 带 60s 进程内缓存。
 */
export async function getLaozhangDailyUsage(range: BillingRange): Promise<RangeUsageSummary> {
  // 缓存
  const cache = globalAny[dailyCacheKey]
  const now = Date.now()
  if (cache && now - cache.tsMs < DAILY_CACHE_TTL_MS && cache.data[range]) {
    return cache.data[range]
  }

  const token = process.env.LAOZHANG_ACCESS_TOKEN
  if (!token) {
    throw new Error('未配置 LAOZHANG_ACCESS_TOKEN，无法查询老张历史用量')
  }

  const { startSec, endSec } = getRangeTimestamps(range)
  const url = `https://api.laozhang.ai/api/data/self?start_timestamp=${startSec}&end_timestamp=${endSec}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: token,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`老张用量查询失败：HTTP ${response.status}${text ? ` - ${text}` : ''}`)
  }

  const payload = (await response.json()) as LaozhangDataSelfResponse
  if (!payload.success) {
    throw new Error(`老张用量查询失败：${payload.message ?? '响应数据异常'}`)
  }

  const rows = payload.data ?? []

  // 聚合为按天
  const dayMap = new Map<string, DailyUsage>()
  for (const row of rows) {
    let day = dayMap.get(row.date)
    if (!day) {
      day = { date: row.date, totalUsd: 0, calls: 0, byModel: [] }
      dayMap.set(row.date, day)
    }
    day.totalUsd += row.sumUsd
    // 推算调用次数：sumQuota ÷ 单次固定额度
    const unitQuota = getUnitPriceUsd(row.modelName) * QUOTA_PER_USD
    const calls = unitQuota > 0 ? Math.round(row.sumQuota / unitQuota) : 0
    day.calls += calls
    day.byModel.push({ model: row.modelName, totalUsd: row.sumUsd, calls })
  }

  const days = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  // 范围汇总
  let totalUsd = 0
  let totalCalls = 0
  const modelMap = new Map<string, { totalUsd: number; calls: number }>()
  for (const day of days) {
    totalUsd += day.totalUsd
    totalCalls += day.calls
    for (const m of day.byModel) {
      const existing = modelMap.get(m.model)
      if (existing) {
        existing.totalUsd += m.totalUsd
        existing.calls += m.calls
      } else {
        modelMap.set(m.model, { totalUsd: m.totalUsd, calls: m.calls })
      }
    }
  }

  const byModel = Array.from(modelMap.entries())
    .map(([model, v]) => ({ model, totalUsd: Number(v.totalUsd.toFixed(6)), calls: v.calls }))
    .sort((a, b) => b.totalUsd - a.totalUsd)

  const summary: RangeUsageSummary = {
    range,
    totalUsd: Number(totalUsd.toFixed(6)),
    totalCalls,
    days: days.map((d) => ({
      ...d,
      totalUsd: Number(d.totalUsd.toFixed(6)),
    })),
    byModel,
  }

  // 写缓存
  if (!globalAny[dailyCacheKey]) {
    globalAny[dailyCacheKey] = { data: {}, tsMs: now }
  }
  globalAny[dailyCacheKey]!.data[range] = summary
  globalAny[dailyCacheKey]!.tsMs = now

  return summary
}

/**
 * 查询老张 API 某天逐条调用日志。
 *
 * 调 /api/log/self，按本地日界转 Unix 秒过滤。页大小固定 10，无总数，
 * hasMore = 返回满页（10 条）= 可能有下一页。
 */
export async function getLaozhangCallLogs(date: string, page = 1): Promise<CallLogResult> {
  const token = process.env.LAOZHANG_ACCESS_TOKEN
  if (!token) {
    throw new Error('未配置 LAOZHANG_ACCESS_TOKEN，无法查询老张调用日志')
  }

  const { startSec, endSec } = getDateTimestampRange(date)
  const url = `https://api.laozhang.ai/api/log/self?p=${page}&start_timestamp=${startSec}&end_timestamp=${endSec}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: token,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`老张日志查询失败：HTTP ${response.status}${text ? ` - ${text}` : ''}`)
  }

  const payload = (await response.json()) as LaozhangLogSelfResponse
  if (!payload.success) {
    throw new Error(`老张日志查询失败：${payload.message ?? '响应数据异常'}`)
  }

  const rows = payload.data ?? []
  const items: CallLogItem[] = rows.map((row) => ({
    ts: new Date(row.created_at * 1000).toISOString(),
    createdAt: row.created_at,
    model: row.model_name,
    keyName: row.token_name,
    usd: Number((row.quota / QUOTA_PER_USD).toFixed(6)),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    durationSec: row.duration_for_view,
    content: row.content,
  }))

  // 按时间倒序（上游返回顺序不保证）
  items.sort((a, b) => b.createdAt - a.createdAt)

  return {
    date,
    page,
    items,
    hasMore: rows.length === 10,
  }
}

/**
 * 查询老张 API 某天逐小时用量（下钻图表用）。
 *
 * 基于 /api/log/self 逐页拉全当天日志后按本地小时分桶；
 * 结果按日期缓存（今天 60s / 历史天 30min），避免每次下钻都打满上游翻页。
 */
export async function getLaozhangHourlyUsage(date: string): Promise<HourlyUsageResult> {
  const now = Date.now()
  const isToday = date === getLocalDateString(new Date(now))
  const ttl = isToday ? HOURLY_CACHE_TTL_TODAY_MS : HOURLY_CACHE_TTL_PAST_MS

  const cached = globalAny[hourlyCacheKey]?.[date]
  if (cached && now - cached.tsMs < ttl) {
    return cached.data
  }

  const buckets = new Map<number, { totalUsd: number; calls: number }>()
  let truncated = false

  for (let page = 1; ; page += 1) {
    const result = await getLaozhangCallLogs(date, page)
    for (const item of result.items) {
      const hour = new Date(item.createdAt * 1000).getHours()
      const bucket = buckets.get(hour) ?? { totalUsd: 0, calls: 0 }
      bucket.totalUsd += item.usd
      bucket.calls += 1
      buckets.set(hour, bucket)
    }
    if (!result.hasMore) break
    if (page >= HOURLY_MAX_PAGES) {
      truncated = true
      break
    }
  }

  const hours: HourlyUsage[] = Array.from({ length: 24 }, (_, hour) => {
    const bucket = buckets.get(hour)
    return {
      hour,
      totalUsd: Number((bucket?.totalUsd ?? 0).toFixed(6)),
      calls: bucket?.calls ?? 0,
    }
  })

  const aggregated: HourlyUsageResult = { date, hours, truncated }
  if (!globalAny[hourlyCacheKey]) {
    globalAny[hourlyCacheKey] = {}
  }
  globalAny[hourlyCacheKey]![date] = { data: aggregated, tsMs: now }
  return aggregated
}
