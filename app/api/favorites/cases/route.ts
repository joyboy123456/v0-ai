/**
 * GET /api/favorites/cases?feature=photo-fission
 *
 * 返回指定功能下被收藏的生成图列表，用于各功能的「案例库」Tab 展示。
 *
 * 查询参数：
 * - feature: 'ai-fashion-photo' | 'photo-fission' | 'pose-fission'（默认 ai-fashion-photo）
 *
 * 鉴权：requireUser（登录用户即可）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { listFavoritedAssetsByFeature } from '@/lib/server/task-store'
import type { FeatureType } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_FEATURES: FeatureType[] = [
  'ai-fashion-photo',
  'photo-fission',
  'pose-fission',
]

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  const url = new URL(request.url)
  const feature = (url.searchParams.get('feature') ?? 'ai-fashion-photo') as FeatureType

  if (!VALID_FEATURES.includes(feature)) {
    return NextResponse.json(
      { ok: false, error: `无效的 feature 参数，支持：${VALID_FEATURES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const assets = await listFavoritedAssetsByFeature(feature, userId)
    return NextResponse.json({
      ok: true,
      feature,
      total: assets.length,
      assets: assets.map((asset) => ({
        assetId: asset.assetId,
        fileName: asset.fileName,
        fileUrl: asset.fileUrl,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
        taskId: asset.taskId ?? null,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { ok: false, error: `查询收藏案例失败：${message}` },
      { status: 500 },
    )
  }
}
