import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import { readLocalSuperAdminUsername } from '@/lib/server/auth/local-auth-mode'
import { getProviderHealthSnapshot } from '@/lib/server/image-provider-pool'
import { getImageSchedulerCapacitySnapshot } from '@/lib/server/image-work-scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  if (userResult.user.username !== readLocalSuperAdminUsername()) {
    return NextResponse.json(
      { ok: false, error: 'FORBIDDEN' },
      { status: 403 },
    )
  }

  try {
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      capacity: getImageSchedulerCapacitySnapshot(),
      providers: getProviderHealthSnapshot(),
    })
  } catch (error) {
    console.error('[health/capacity] 获取生图容量快照失败：', error)
    return NextResponse.json(
      { ok: false, error: 'CAPACITY_UNAVAILABLE' },
      { status: 503 },
    )
  }
}
