import { NextResponse, type NextRequest } from 'next/server'
import { getAgentBetaAccess, isAgentBetaEnabled } from '@/lib/agent-beta/feature'
import { resolveAgentBetaLlmCatalog } from '@/lib/server/agent-beta/llm-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const options = { headers: { 'Cache-Control': 'no-store' } }
  if (!isAgentBetaEnabled()) {
    return NextResponse.json({ ...getAgentBetaAccess(null), llmOptions: [], defaultLlmId: null }, options)
  }
  const { getRequestUser } = await import('@/lib/server/auth/require-user')
  const current = await getRequestUser(request)
  // 目录只暴露模型 id/label 供前端选择器使用；baseUrl/apiKey 等凭据仅在服务端 runtime 解析
  const catalog = resolveAgentBetaLlmCatalog()
  return NextResponse.json({
    ...getAgentBetaAccess(current?.user ?? null),
    llmOptions: catalog.map((entry) => ({ id: entry.id, label: entry.id })),
    defaultLlmId: catalog[0]?.id ?? null,
  }, options)
}
