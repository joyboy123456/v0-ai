/**
 * GET /api/billing/summary?range=today|7d|30d&channel=grsai|laozhang|all
 *
 * 本地计费事件范围汇总（固定单价估算）。
 * 数据已在内存中，纯过滤聚合，无网络请求。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import {
  getBillingSummaryByRange,
  type ChannelFilter,
} from '@/lib/server/billing/billing-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 返回本地时区日期字符串 YYYY-MM-DD。 */
function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 根据 range 计算起止日期 YYYY-MM-DD。 */
function getRangeDates(range: string): { startDate: string; endDate: string } {
  const today = getLocalDateString(new Date())
  if (range === '7d') {
    const start = new Date()
    start.setDate(start.getDate() - 6)
    return { startDate: getLocalDateString(start), endDate: today }
  }
  if (range === '30d') {
    const start = new Date()
    start.setDate(start.getDate() - 29)
    return { startDate: getLocalDateString(start), endDate: today }
  }
  // today
  return { startDate: today, endDate: today }
}

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  const range = request.nextUrl.searchParams.get('range') ?? 'today'
  const channelParam = request.nextUrl.searchParams.get('channel') ?? 'all'
  const validChannels: ChannelFilter[] = ['grsai', 'laozhang', 'all']
  const channel = validChannels.includes(channelParam as ChannelFilter)
    ? (channelParam as ChannelFilter)
    : 'all'

  const { startDate, endDate } = getRangeDates(range)

  try {
    const summary = await getBillingSummaryByRange(startDate, endDate, channel)
    return NextResponse.json(
      { ok: true, range, channel, startDate, endDate, summary },
      { status: 200 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, error: `计费汇总查询失败：${message}` },
      { status: 500 },
    )
  }
}
