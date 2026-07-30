/**
 * GET /api/billing/balance
 *
 * 多渠道账户余额聚合查询。当前支持：
 * - 老张 API（USD 口径）：剩余/已用 USD、累计请求次数、账户分组、模型固定单价表
 * - Grsai（CNY 积分口径）：剩余积分、剩余 ￥（接口仅返回剩余，无已用/累计）
 *
 * 单渠道失败不影响另一个：用 Promise.allSettled 并发，每渠道独立返回 ok/error。
 * 顶层保留老张旧字段（向后兼容旧前端），新增 channels 数组承载多渠道结果。
 *
 * 跟随 /api/billing/today 路由模式：需要 requireUser 认证。
 * 支持查询参数 ?force=1 跳过缓存强制刷新（对所有渠道生效）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { getAccountBalance } from '@/lib/server/billing/balance-service'
import { getGrsaiBalance } from '@/lib/server/billing/grsai-balance-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 单渠道余额结果（成功或失败统一结构）。 */
interface ChannelBalanceResult {
  /** 渠道标识：laozhang | grsai */
  channel: string
  /** 该渠道是否查询成功 */
  ok: boolean
  /** 失败时的错误信息（ok=false 时有） */
  error?: string
  /** 成功时的余额数据（ok=true 时有；字段因渠道而异） */
  data?: Record<string, unknown>
}

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  const force = request.nextUrl.searchParams.get('force') === '1'

  // 并发查询两渠道，单渠道失败不抛出
  const [laozhangRes, grsaiRes] = await Promise.allSettled([
    getAccountBalance(force),
    getGrsaiBalance(force),
  ])

  const channels: ChannelBalanceResult[] = []

  // 老张
  const laozhang: ChannelBalanceResult = { channel: 'laozhang', ok: false }
  if (laozhangRes.status === 'fulfilled') {
    laozhang.ok = true
    laozhang.data = laozhangRes.value as unknown as Record<string, unknown>
  } else {
    const reason = laozhangRes.reason
    laozhang.error = reason instanceof Error ? reason.message : String(reason)
  }
  channels.push(laozhang)

  // Grsai
  const grsai: ChannelBalanceResult = { channel: 'grsai', ok: false }
  if (grsaiRes.status === 'fulfilled') {
    grsai.ok = true
    grsai.data = grsaiRes.value as unknown as Record<string, unknown>
  } else {
    const reason = grsaiRes.reason
    grsai.error = reason instanceof Error ? reason.message : String(reason)
  }
  channels.push(grsai)

  // 顶层 ok：至少一个渠道成功即 true
  const anyOk = channels.some((c) => c.ok)

  // 向后兼容：顶层展开老张旧字段（老张失败时用 ok:false + error）
  if (laozhang.ok && laozhang.data) {
    return NextResponse.json(
      { ok: true, ...laozhang.data, channels },
      { status: 200 },
    )
  }

  // 老张失败：顶层报老张错误（兼容旧前端），但 channels 里 grsai 可能成功
  return NextResponse.json(
    {
      ok: anyOk,
      error: laozhang.error
        ? `老张账户余额查询失败：${laozhang.error}`
        : undefined,
      channels,
    },
    { status: anyOk ? 200 : 500 },
  )
}
