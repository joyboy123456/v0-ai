import type { AgentBetaNode, AgentBetaSession } from '@/lib/agent-beta/types'

export type NodePosition = Pick<AgentBetaNode, 'id' | 'x' | 'y'>

/** 服务端进度刷新时保留还未保存的拖动位置。 */
export function withLocalPositions(session: AgentBetaSession, positions: Map<string, NodePosition>): AgentBetaSession {
  return {
    ...session,
    nodes: session.nodes.map((node) => ({ ...node, ...positions.get(node.id) })),
  }
}

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
