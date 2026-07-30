/**
 * Grsai 账户余额查询服务。
 *
 * 接口：GET {baseUrl}/client/common/getCredits?apikey={apiKey}
 * 鉴权：query 参数 apikey（sk- 格式，即生图同款 GRSAI_API_KEY）
 * 返回：{ code: 0, data: { credits: number }, msg: "success" }
 *
 * 计费口径：积分制，1 元 = 10000 积分 → 剩余 ￥ = credits / 10000（CNY）
 * 接口仅返回剩余积分，无"已用额度/累计请求次数"。
 *
 * 调研：.trellis/tasks/07-08-billing-system（实测 grsai 旧版 getCredits，
 *   /api/user/self 与 /api/usage/balance 均 404，grsai 不走 one-api 余额体系）
 */

/** 积分 → CNY 换算系数（1 元 = 10000 积分）。 */
const CREDITS_PER_CNY = 10_000

/** Grsai 账户余额信息。 */
export interface GrsaiBalance {
  /** 渠道标识，固定 "grsai" */
  channel: 'grsai'
  /** 渠道显示名 */
  displayName: string
  /** 剩余积分（原始 credits） */
  credits: number
  /** 剩余 ￥（CNY），credits / 10000 */
  remainingCny: number
  /** 币种标记，固定 "CNY" */
  currency: 'CNY'
  /** 数据获取时间（ISO） */
  fetchedAt: string
}

/** Grsai getCredits 响应。 */
interface GrsaiGetCreditsResponse {
  code: number
  data: { credits?: number } | null
  msg?: string
}

// ---- 进程内缓存 ----

interface CacheEntry {
  data: GrsaiBalance
  tsMs: number
}

const globalKey = '__grsai_balance_cache__'
const globalAny = globalThis as typeof globalThis & {
  [globalKey]?: CacheEntry
}

/** 缓存有效期（ms）。与老张 balance-service 一致 30s。 */
const CACHE_TTL_MS = 30_000

/** 默认国内直连节点。 */
const DEFAULT_BASE_URL = 'https://grsai.dakka.com.cn'

/**
 * 查询 Grsai 账户余额（剩余积分）。
 *
 * @param forceRefresh 是否强制刷新（跳过缓存）
 * @throws 未配置 GRSAI_API_KEY 时抛出明确错误
 */
export async function getGrsaiBalance(forceRefresh = false): Promise<GrsaiBalance> {
  const cached = globalAny[globalKey]
  const now = Date.now()
  if (!forceRefresh && cached && now - cached.tsMs < CACHE_TTL_MS) {
    return cached.data
  }

  const apiKey = process.env.GRSAI_API_KEY
  if (!apiKey) {
    throw new Error('未配置 GRSAI_API_KEY，无法查询 grsai 账户余额')
  }

  const baseUrl = (process.env.GRSAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const url = `${baseUrl}/client/common/getCredits?apikey=${encodeURIComponent(apiKey)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`grsai 余额查询失败：HTTP ${response.status}${text ? ` - ${text}` : ''}`)
  }

  const payload = (await response.json()) as GrsaiGetCreditsResponse
  if (payload.code !== 0 || !payload.data) {
    throw new Error(`grsai 余额查询失败：${payload.msg ?? `code=${payload.code}`}`)
  }

  const credits = payload.data.credits ?? 0
  const balance: GrsaiBalance = {
    channel: 'grsai',
    displayName: 'Grsai',
    credits,
    remainingCny: Number((credits / CREDITS_PER_CNY).toFixed(4)),
    currency: 'CNY',
    fetchedAt: new Date(now).toISOString(),
  }

  globalAny[globalKey] = { data: balance, tsMs: now }
  return balance
}
