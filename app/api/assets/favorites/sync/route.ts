import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { setAssetsFavoriteBatch } from '@/lib/server/task-store'

export const runtime = 'nodejs'

const MAX_BATCH = 2000

/**
 * POST /api/assets/favorites/sync
 * Body: { assetIds: string[] }
 *
 * 批量把历史收藏（来自前端 localStorage）同步到服务端，标记为 favorited=true。
 * 用于首次迁移：避免清理误删用户已收藏但服务端未记录的老图。
 *
 * 只处理属于当前用户的资产；不存在 / 非本人的 assetId 会被忽略并在 missing 中返回。
 */
export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  let body: { assetIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求 JSON 格式错误' }, { status: 400 })
  }

  if (!Array.isArray(body.assetIds)) {
    return NextResponse.json(
      { error: '缺少 assetIds 字段或类型错误' },
      { status: 400 },
    )
  }

  const assetIds = body.assetIds
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .slice(0, MAX_BATCH)

  if (assetIds.length === 0) {
    return NextResponse.json({ success: true, updated: 0, missing: [] })
  }

  const result = await setAssetsFavoriteBatch(assetIds, true, userId)

  return NextResponse.json({
    success: true,
    updated: result.updated,
    missing: result.missing,
  })
}
