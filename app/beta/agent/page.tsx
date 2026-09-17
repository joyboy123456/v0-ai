import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { requireUserFromCookies } from '@/lib/server/auth/require-user'
import { isAgentBetaEnabled, getAgentBetaAccess } from '@/lib/agent-beta/feature'
import type { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isUnauthorized(
  result: Awaited<ReturnType<typeof requireUserFromCookies>>,
): result is NextResponse {
  return result instanceof Response && result.status === 401
}

export default async function AgentBetaPage() {
  const current = await requireUserFromCookies(
    (await cookies()).get('session_id')?.value,
  )
  if (isUnauthorized(current)) redirect('/login?next=%2Fbeta%2Fagent')

  if (!isAgentBetaEnabled() || !getAgentBetaAccess(current.user).allowed) {
    notFound()
  }

  const { AgentBetaWorkbench } = await import(
    '@/components/agent-beta/agent-beta-workbench'
  )
  return <AgentBetaWorkbench />
}
