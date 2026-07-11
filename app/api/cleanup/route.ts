import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { readLocalSuperAdminUsername } from '@/lib/server/auth/local-auth-mode'
import {
  countAssetsByDateRange,
  cleanupAssetsByDateRange,
} from '@/lib/server/task-store'

export const runtime = 'nodejs'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

function isValidDateRange(startDate: string, endDate: string): boolean {
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) return false
  const startMs = new Date(`${startDate}T00:00:00`).getTime()
  const endMs = new Date(`${endDate}T23:59:59.999`).getTime()
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs
}

function rejectNonAdmin(username: string): NextResponse | null {
  if (username === readLocalSuperAdminUsername()) return null
  return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
}

/**
 * GET /api/cleanup?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * 预览指定日期范围内可清理的生成图数量 + 资产列表（不执行删除）。
 * 鉴权：仅配置的本地管理员账号；数据范围仍限定为该用户自己的资产。
 */
export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const forbidden = rejectNonAdmin(userResult.user.username)
  if (forbidden) return forbidden

  const url = new URL(request.url)
  const startDate = url.searchParams.get('startDate') ?? ''
  const endDate = url.searchParams.get('endDate') ?? ''

  if (!isValidDateRange(startDate, endDate)) {
    return NextResponse.json(
      { error: 'startDate 和 endDate 格式必须为 YYYY-MM-DD' },
      { status: 400 },
    )
  }

  const result = await countAssetsByDateRange(
    startDate,
    endDate,
    userResult.userId,
  )
  return NextResponse.json({ ...result, criteria: { startDate, endDate } })
}

/**
 * POST /api/cleanup
 * Body: { startDate: string, endDate: string }
 *
 * 手动清理指定日期范围内的生成图（原图 + 缩略图 + store/repo 记录 + 清空 task）。
 * 鉴权：仅配置的本地管理员账号；数据范围仍限定为该用户自己的资产。
 */
export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const forbidden = rejectNonAdmin(userResult.user.username)
  if (forbidden) return forbidden

  let body: { startDate?: unknown; endDate?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求 JSON 格式错误' }, { status: 400 })
  }

  const startDate = typeof body.startDate === 'string' ? body.startDate : ''
  const endDate = typeof body.endDate === 'string' ? body.endDate : ''

  if (!isValidDateRange(startDate, endDate)) {
    return NextResponse.json(
      { error: 'startDate 和 endDate 格式必须为 YYYY-MM-DD' },
      { status: 400 },
    )
  }

  const result = await cleanupAssetsByDateRange(
    startDate,
    endDate,
    userResult.userId,
  )

  return NextResponse.json({
    success: true,
    ...result,
    details: result.details.slice(0, 50),
  })
}
