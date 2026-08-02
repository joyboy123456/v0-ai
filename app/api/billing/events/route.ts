/**
 * GET /api/billing/events?date=YYYY-MM-DD&channel=grsai|laozhang|all
 *
 * 本地计费事件某天逐条明细（下钻用）。
 * 数据已在内存中，纯过滤，无网络请求。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import {
  getBillingEventsByDate,
  type ChannelFilter,
} from '@/lib/server/billing/billing-store'

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

  const channelParam = request.nextUrl.searchParams.get('channel') ?? 'all'
  const validChannels: ChannelFilter[] = ['grsai', 'laozhang', 'all']
  const channel = validChannels.includes(channelParam as ChannelFilter)
    ? (channelParam as ChannelFilter)
    : 'all'

  try {
    const items = await getBillingEventsByDate(date, channel)
    return NextResponse.json({ ok: true, date, channel, items }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, error: `计费事件查询失败：${message}` },
      { status: 500 },
    )
  }
}
