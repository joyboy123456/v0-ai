import { NextResponse, type NextRequest } from 'next/server'
import { getAgentBetaAccess, isAgentBetaEnabled } from '@/lib/agent-beta/feature'
import type { RequestUser } from '@/lib/server/auth/require-user'

/** 每个 Beta API 都独立鉴权；隐藏导航不能代替服务端门禁。 */
export async function requireAgentBetaUser(request: NextRequest): Promise<RequestUser | NextResponse> {
  if (!isAgentBetaEnabled()) {
    return NextResponse.json({ error: '此实验功能暂未开放', code: 'BETA_DISABLED' }, { status: 404 })
  }
  const { requireUser } = await import('@/lib/server/auth/require-user')
  const result = await requireUser(request)
  if (result instanceof NextResponse) return result
  if (!getAgentBetaAccess(result.user).allowed) {
    return NextResponse.json({ error: '此实验功能暂未开放', code: 'BETA_NOT_ALLOWED' }, { status: 404 })
  }
  return result
}
