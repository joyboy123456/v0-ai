/**
 * GET /api/billing/balance
 *
 * 返回老张 API 账户实时余额：剩余额度/USD、已用额度/USD、累计请求次数、账户分组、
 * 账户级模型固定单价表。
 *
 * 跟随 /api/billing/today 路由模式：需要 requireUser 认证。
 * 支持查询参数 ?force=1 跳过缓存强制刷新。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { getAccountBalance } from '@/lib/server/billing/balance-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  const force = request.nextUrl.searchParams.get('force') === '1'

  try {
    const balance = await getAccountBalance(force)
    return NextResponse.json({ ok: true, ...balance }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, error: `账户余额查询失败：${message}` },
      { status: 500 },
    )
  }
}
