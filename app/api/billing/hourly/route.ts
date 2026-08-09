/**
 * GET /api/billing/hourly?date=YYYY-MM-DD
 *
 * 某天逐小时花费（双渠道合并，下钻图表用）：
 * - 老张：上游 /api/log/self 全页聚合（实际扣费）
 * - Grsai：本地计费事件按小时分桶（估算）
 * 单渠道失败不影响另一个（与 /api/billing/balance 同策略）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { getLaozhangHourlyUsage } from '@/lib/server/billing/laozhang-usage-service'
import { getBillingEventsByDate } from '@/lib/server/billing/billing-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  const date = request.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, error: '缺少或无效的 date 参数（格式 YYYY-MM-DD）' },
      { status: 400 },
    )
  }

  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    laozhang: 0,
    grsai: 0,
    total: 0,
    calls: 0,
  }))

  let laozhangError: string | undefined
  let truncated = false
  try {
    const laozhang = await getLaozhangHourlyUsage(date)
    truncated = laozhang.truncated
    for (const h of laozhang.hours) {
      hours[h.hour].laozhang = h.totalUsd
      hours[h.hour].calls += h.calls
    }
  } catch (error) {
    laozhangError = error instanceof Error ? error.message : String(error)
  }

  let grsaiError: string | undefined
  try {
    const events = await getBillingEventsByDate(date, 'grsai')
    for (const event of events) {
      const hour = new Date(event.ts).getHours()
      if (hour < 0 || hour > 23) continue
      hours[hour].grsai += event.totalUsd
      hours[hour].calls += event.count
    }
  } catch (error) {
    grsaiError = error instanceof Error ? error.message : String(error)
  }

  for (const h of hours) {
    h.laozhang = Number(h.laozhang.toFixed(6))
    h.grsai = Number(h.grsai.toFixed(6))
    h.total = Number((h.laozhang + h.grsai).toFixed(6))
  }

  return NextResponse.json({
    ok: true,
    date,
    hours,
    truncated,
    ...(laozhangError ? { laozhangError } : {}),
    ...(grsaiError ? { grsaiError } : {}),
  })
}
