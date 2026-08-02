/**
 * GET /api/billing/laozhang/daily?range=today|7d|30d
 *
 * 老张 API 按天聚合用量（上游实际扣费）。
 * 调 /api/data/self，一次请求返回整段范围的按天×按模型聚合 + 范围汇总。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { getLaozhangDailyUsage, type BillingRange } from '@/lib/server/billing/laozhang-usage-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  const rangeParam = request.nextUrl.searchParams.get('range') ?? 'today'
  const validRanges: BillingRange[] = ['today', '7d', '30d']
  const range = validRanges.includes(rangeParam as BillingRange)
    ? (rangeParam as BillingRange)
    : 'today'

  try {
    const summary = await getLaozhangDailyUsage(range)
    return NextResponse.json({ ok: true, ...summary }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, error: `老张用量查询失败：${message}` },
      { status: 500 },
    )
  }
}
