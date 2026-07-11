import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { readLocalSuperAdminUsername } from '@/lib/server/auth/local-auth-mode'
import { hideCase } from '@/lib/server/photo-fission-case-store'

interface RouteContext {
  params: Promise<{
    caseId: string
  }>
}

/**
 * 删除（软隐藏）整个 photo-fission 案例。
 *
 * 物理静态文件不动，源码常量 PHOTO_FISSION_CASES 也不动；这里只把 caseId
 * 加入隐藏列表（持久化在 data/photo-fission-cases-hidden.json），
 * 后续 GET /api/photo-fission/cases 会过滤掉。
 *
 * 404：caseId 在 PHOTO_FISSION_CASES 中不存在
 * 200：成功（含幂等）
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  if (userResult.user.username !== readLocalSuperAdminUsername()) {
    return NextResponse.json(
      { ok: false, error: 'FORBIDDEN' },
      { status: 403 },
    )
  }

  const { caseId } = await context.params

  const ok = await hideCase(caseId)
  if (!ok) {
    return NextResponse.json({ error: '案例不存在' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
