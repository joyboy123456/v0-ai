import { NextResponse, type NextRequest } from 'next/server'
import { getAgentBetaAccess, isAgentBetaEnabled } from '@/lib/agent-beta/feature'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isAgentBetaEnabled()) return NextResponse.json(getAgentBetaAccess(null), { headers: { 'Cache-Control': 'no-store' } })
  const { getRequestUser } = await import('@/lib/server/auth/require-user')
  const current = await getRequestUser(request)
  return NextResponse.json(getAgentBetaAccess(current?.user ?? null), { headers: { 'Cache-Control': 'no-store' } })
}
