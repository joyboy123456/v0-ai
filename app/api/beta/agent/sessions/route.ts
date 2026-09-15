import type { NextRequest } from 'next/server'
import { agentBetaResponse, readAgentBetaBody } from '@/lib/server/agent-beta/http'
import { emptyInputSchema, parseInput } from '@/lib/server/agent-beta/validation'

export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  return agentBetaResponse(request, async (service, userId) => ({ sessions: await service.listSessions(userId) }))
}
export async function POST(request: NextRequest) {
  return agentBetaResponse(request, async (service, userId) => {
    parseInput(emptyInputSchema, await readAgentBetaBody(request))
    return { session: await service.createSession(userId) }
  })
}
