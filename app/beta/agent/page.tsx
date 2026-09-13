import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { NextRequest, NextResponse } from 'next/server'
import { requireAgentBetaUser } from '@/lib/server/agent-beta/access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AgentBetaPage() {
  const current = await requireAgentBetaUser(new NextRequest('http://localhost/beta/agent', { headers: new Headers(await headers()) }))
  if (current instanceof NextResponse) {
    if (current.status === 401) redirect('/login?next=%2Fbeta%2Fagent')
    notFound()
  }
  const { AgentBetaWorkbench } = await import('@/components/agent-beta/agent-beta-workbench')
  return <AgentBetaWorkbench />
}
