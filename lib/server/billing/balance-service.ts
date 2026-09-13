/**
 * 老张 API 账户余额查询服务。
 *
 * 接口：GET https://api.laozhang.ai/api/user/self
 * 认证：Authorization Header 直接放 AccessToken（不带 Bearer 前缀）
 * 换算：500,000 额度 = 1 USD
 *
 * 带进程内缓存（默认 30s），避免频繁打老张管理接口。
 */

/** 额度 → USD 换算系数。 */
const QUOTA_PER_USD = 500_000

/** 账户余额信息。 */
export interface AccountBalance {
  /** 用户名 */
  username: string
  /** 显示名 */
  displayName: string
  /** 账户分组 */
  group: string
  /** 剩余额度（原始 quota） */
  quota: number
  /** 已用额度（原始 used_quota） */
  usedQuota: number
  /** 累计请求次数 */
  requestCount: number
  /** 剩余美元余额 */
  remainingUsd: number
  /** 已用美元额度 */
  usedUsd: number
  /** 历史总额度（剩余+已用）美元 */
  totalUsd: number
  /** 账户级模型固定单价表（model → USD/张），可能为空 */
  modelFixedPrices: Record<string, number>
  /** 数据获取时间（ISO） */
  fetchedAt: string
}

/** 老张 /api/user/self 响应（仅取需要的字段）。 */
interface LaozhangUserSelfResponse {
  success: boolean
  message?: string | null
  data?: {
    username?: string
    display_name?: string
    group?: string
    quota?: number
    used_quota?: number
    request_count?: number
    /** 模型固定单价表，键为模型名，值为 USD/张 */
    ModelFixedPrice?: Record<string, number> | unknown[]
  }
}

// ---- 进程内缓存 ----

interface CacheEntry {
  data: AccountBalance
  tsMs: number
}

const globalKey = '__laozhang_balance_cache__'
const globalAny = globalThis as typeof globalThis & {
  [globalKey]?: CacheEntry
}

/** 缓存有效期（ms）。余额查询走管理接口，避免高频调用。 */
const CACHE_TTL_MS = 30_000

/**
 * 查询老张 API 账户余额。
 *
 * @param forceRefresh 是否强制刷新（跳过缓存）
 * @throws 未配置 AccessToken 时抛出明确错误
 */
export async function getAccountBalance(forceRefresh = false): Promise<AccountBalance> {
  const cached = globalAny[globalKey]
  const now = Date.now()
  if (!forceRefresh && cached && now - cached.tsMs < CACHE_TTL_MS) {
    return cached.data
  }

  const token = process.env.LAOZHANG_ACCESS_TOKEN
  if (!token) {
    throw new Error('未配置 LAOZHANG_ACCESS_TOKEN（老张系统令牌），无法查询账户余额')
  }

  const response = await fetch('https://api.laozhang.ai/api/user/self', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: token,
      'Content-Type': 'application/json',
    },
    // Node fetch 自动处理 gzip 解压
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`老张余额查询失败：HTTP ${response.status}${text ? ` - ${text}` : ''}`)
  }

  const payload = (await response.json()) as LaozhangUserSelfResponse
  if (!payload.success || !payload.data) {
    throw new Error(`老张余额查询失败：${payload.message ?? '响应数据异常'}`)
  }

  const d = payload.data
  const quota = d.quota ?? 0
  const usedQuota = d.used_quota ?? 0

  // ModelFixedPrice 可能是对象或空数组，统一处理
  let modelFixedPrices: Record<string, number> = {}
  if (d.ModelFixedPrice && !Array.isArray(d.ModelFixedPrice)) {
    modelFixedPrices = d.ModelFixedPrice as Record<string, number>
  }

  const balance: AccountBalance = {
    username: d.username ?? '',
    displayName: d.display_name ?? d.username ?? '',
    group: d.group ?? '',
    quota,
    usedQuota,
    requestCount: d.request_count ?? 0,
    remainingUsd: Number((quota / QUOTA_PER_USD).toFixed(4)),
    usedUsd: Number((usedQuota / QUOTA_PER_USD).toFixed(4)),
    totalUsd: Number(((quota + usedQuota) / QUOTA_PER_USD).toFixed(4)),
    modelFixedPrices,
    fetchedAt: new Date(now).toISOString(),
  }

  globalAny[globalKey] = { data: balance, tsMs: now }
  return balance
}
