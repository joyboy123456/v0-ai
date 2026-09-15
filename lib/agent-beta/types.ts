import type { FashionImageRatio, FashionModelId, FashionResolution, TaskStatus } from '@/lib/types'

/** Beta 只编排现有服饰生图；业务图片始终使用平台的 assetId。 */
export interface AgentBetaSettings {
  model: FashionModelId
  imageRatio: Exclude<FashionImageRatio, 'more'>
  resolution: FashionResolution
}

export interface AgentBetaNode {
  id: string
  assetId: string
  name: string
  url: string
  width: number
  height: number
  x: number
  y: number
  taskId?: string
  parentNodeId?: string
}

export interface AgentBetaPlan {
  id: string
  prompt: string
  referenceNodeIds: string[]
  settings: AgentBetaSettings
  status: 'proposed' | 'submitted'
  task?: {
    taskId: string
    status: TaskStatus
    progress: number
    message: string
  }
}

export interface AgentBetaMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  referenceNodeIds: string[]
  plan?: AgentBetaPlan
}

export interface AgentBetaSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  nodes: AgentBetaNode[]
  messages: AgentBetaMessage[]
}

export type AgentBetaSessionSummary = Pick<AgentBetaSession, 'id' | 'title' | 'updatedAt'>

export interface AgentBetaMessageInput {
  clientMessageId: string
  text: string
  referenceNodeIds: string[]
  settings: AgentBetaSettings
}

export interface AgentBetaAccess {
  allowed: boolean
  enabled: boolean
  localOnly: boolean
}
