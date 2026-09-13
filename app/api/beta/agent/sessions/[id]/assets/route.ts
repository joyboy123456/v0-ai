import type { NextRequest } from 'next/server'
import { agentBetaResponse, readAgentBetaBody, type SessionRouteContext } from '@/lib/server/agent-beta/http'

export const runtime = 'nodejs'
export async function POST(request: NextRequest, context: SessionRouteContext) {
  return agentBetaResponse(request, async (service, userId) => ({ session: await service.addAssets(userId, (await context.params).id, await readAgentBetaBody(request)) }))
}
