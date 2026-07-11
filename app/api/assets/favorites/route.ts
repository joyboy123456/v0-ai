import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { listAllFavoritedAssetIds } from '@/lib/server/task-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/assets/favorites
 *
 * 返回当前用户的全部服务端收藏 assetId，作为跨设备收藏状态真源。
 */
export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  const assetIds = await listAllFavoritedAssetIds(userResult.userId)
  return NextResponse.json({ assetIds })
}
