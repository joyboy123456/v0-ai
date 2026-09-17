import { sessionNeedsRefresh } from '../../lib/agent-beta/protocol'
import type { AgentBetaNode, AgentBetaSession } from '@/lib/agent-beta/types'

export type NodePosition = Pick<AgentBetaNode, 'id' | 'x' | 'y'>
export type SessionPollAction = 'refresh' | 'idle'

/** 服务端进度刷新时保留还未保存的拖动位置。 */
export function withLocalPositions(session: AgentBetaSession, positions: Map<string, NodePosition>): AgentBetaSession {
  return {
    ...session,
    nodes: session.nodes.map((node) => ({ ...node, ...positions.get(node.id) })),
  }
}

/** 后台只能选择 GET 刷新或空闲，绝不从状态推导 execute。 */
export function sessionPollAction(session: AgentBetaSession | null): SessionPollAction {
  return sessionNeedsRefresh(session) ? 'refresh' : 'idle'
}

/** 手动核实只封装已有 GET 会话路径，不生成 execute/retry。 */
export function manualSessionRefresh(sessionId: string): { method: 'GET'; path: string } {
  return { method: 'GET', path: `/api/beta/agent/sessions/${encodeURIComponent(sessionId)}` }
}

/** 保留旧 helper 语义，仅判断任务本身是否仍在运行。 */
export function hasRunningTask(session: AgentBetaSession | null): boolean {
  return !!session?.messages.some((message) => {
    const status = message.plan?.task?.status
    return status === 'pending' || status === 'running'
  })
}

export function toggleNodeSelection(selected: string[], id: string, multiple: boolean): string[] {
  if (multiple) return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
  return [id]
}

export function nodeDisplaySize(node: Pick<AgentBetaNode, 'width' | 'height'>) {
  const ratio = Math.max(0.2, Math.min(5, node.width / (node.height || 1)))
  const width = ratio < 1 ? Math.max(130, 240 * ratio) : 240
  return { width, height: Math.min(300, width / ratio) }
}
