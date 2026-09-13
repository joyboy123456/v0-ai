import { NextResponse, type NextRequest } from 'next/server'
import { requireAgentBetaUser } from './access'
import type { AgentBetaService } from './service'
import { AgentBetaError } from './validation'

export type SessionRouteContext = { params: Promise<{ id: string }> }
const MAX_BODY_BYTES = 40_000

/** 实际流也有上限，不能仅信任可伪造的 Content-Length。 */
export async function readAgentBetaBody(request: NextRequest): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new AgentBetaError('请求内容过长', 413)
  const reader = request.body?.getReader()
  if (!reader) return {}
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new AgentBetaError('请求内容过长', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    const raw = Buffer.concat(chunks).toString('utf8')
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    throw new AgentBetaError('请求必须为有效 JSON')
  }
}

export async function agentBetaResponse(request: NextRequest, operation: (service: AgentBetaService, userId: string) => Promise<unknown>): Promise<NextResponse> {
  const user = await requireAgentBetaUser(request)
  if (user instanceof NextResponse) return user
  try {
    const { getAgentBetaService } = await import('./runtime')
    const result = await operation(await getAgentBetaService(), user.userId)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof AgentBetaError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    if (error instanceof Error && error.name === 'ImageQueueFullError') return NextResponse.json({ error: '生成队列已满，请稍后再试', code: 'AGENT_BETA_QUEUE_FULL' }, { status: 429 })
    console.error('[agent-beta] 请求失败', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: '操作暂时失败，请稍后重试', code: 'AGENT_BETA_FAILED' }, { status: 500 })
  }
}
