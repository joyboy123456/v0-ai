import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { setAssetFavorite } from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    assetId: string
  }>
}

export const runtime = 'nodejs'

/**
 * PATCH /api/assets/[assetId]/favorite
 * Body: { favorited: boolean }
 *
 * 设置资产收藏状态。收藏的资产不会被 24h 自动清理。
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  const { assetId } = await context.params

  let body: { favorited?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求 JSON 格式错误' }, { status: 400 })
  }

  if (typeof body.favorited !== 'boolean') {
    return NextResponse.json(
      { error: '缺少 favorited 字段或类型错误' },
      { status: 400 },
    )
  }

  const ok = await setAssetFavorite(assetId, body.favorited, userId)
  if (!ok) {
    return NextResponse.json(
      { error: '未找到对应的资产或无权操作' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, assetId, favorited: body.favorited })
}
