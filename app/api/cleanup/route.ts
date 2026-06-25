import { NextResponse, type NextRequest } from 'next/server'
import { cleanupExpiredAssets } from '@/lib/server/task-store'

export const runtime = 'nodejs'

/**
 * POST /api/cleanup
 *
 * 定时清理过期资产：删除超过 maxAgeHours 且未被收藏的 OSS 对象 + store 记录。
 * 由外部 cron 或 PM2 定时调用。
 *
 * 鉴权：请求头 `x-cron-secret` 必须匹配环境变量 `CRON_SECRET`。
 *
 * Query params:
 *   - maxAgeHours: number (默认 48)
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json(
      { error: '服务端未配置 CRON_SECRET，无法执行清理' },
      { status: 500 },
    )
  }

  const providedSecret = request.headers.get('x-cron-secret')?.trim()
  if (providedSecret !== cronSecret) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  const url = new URL(request.url)
  const maxAgeHoursParam = url.searchParams.get('maxAgeHours')
  let maxAgeHours = 48
  if (maxAgeHoursParam) {
    const parsed = Number(maxAgeHoursParam)
    if (Number.isFinite(parsed) && parsed > 0) {
      maxAgeHours = parsed
    }
  }

  const maxAgeMs = maxAgeHours * 60 * 60 * 1000
  const result = await cleanupExpiredAssets(maxAgeMs)

  return NextResponse.json({
    success: true,
    maxAgeHours,
    ...result,
    details: result.details.slice(0, 50),
  })
}
