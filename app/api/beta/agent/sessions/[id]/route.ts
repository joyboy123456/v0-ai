import type { NextRequest } from 'next/server'
import { agentBetaResponse, readAgentBetaBody, type SessionRouteContext } from '@/lib/server/agent-beta/http'

export const runtime = 'nodejs'
export async function GET(request: NextRequest, context: SessionRouteContext) {
  return agentBetaResponse(request, async (service, userId) => ({ session: await service.getSession(userId, (await context.params).id) }))
}
export async function PATCH(request: NextRequest, context: SessionRouteContext) {
  return agentBetaResponse(request, async (service, userId) => ({ session: await service.patchSession(userId, (await context.params).id, await readAgentBetaBody(request)) }))
}
