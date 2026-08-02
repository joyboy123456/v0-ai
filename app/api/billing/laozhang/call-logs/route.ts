/**
 * GET /api/billing/laozhang/call-logs?date=YYYY-MM-DD&p=1
 *
 * 老张 API 某天逐条调用日志（上游实际扣费）。
 * 调 /api/log/self，按本地日界转 Unix 秒过滤，10条/页翻页。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { getLaozhangCallLogs } from '@/lib/server/billing/laozhang-usage-service'

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

  const pageStr = request.nextUrl.searchParams.get('p') ?? '1'
  const page = Math.max(1, parseInt(pageStr, 10) || 1)

  try {
    const result = await getLaozhangCallLogs(date, page)
    return NextResponse.json({ ok: true, ...result }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, error: `老张日志查询失败：${message}` },
      { status: 500 },
    )
  }
}
