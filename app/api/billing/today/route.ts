/**
 * GET /api/billing/today
 *
 * 返回今日计费统计：今日生成图片总数、今日花费总额（USD）、按模型分组的消耗明细、全部模型单价表。
 *
 * 跟随 /api/cleanup 路由模式：需要 requireUser 认证。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { getTodayBilling } from '@/lib/server/billing/billing-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const userResult = await requireUser(_request)
  if (userResult instanceof NextResponse) return userResult

  try {
    const summary = await getTodayBilling()
    return NextResponse.json({ ok: true, ...summary }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, error: `计费统计查询失败：${message}` },
      { status: 500 },
    )
  }
}
