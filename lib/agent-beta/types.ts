import type {
  FashionImageRatio,
  FashionModelId,
  FashionResolution,
  FeatureType,
  TaskStatus,
} from '@/lib/types'

/** Beta 只编排现有服饰生图；业务图片始终使用平台的 assetId。 */
export interface AgentBetaSettings {
  model: FashionModelId
  imageRatio: Exclude<FashionImageRatio, 'more'>
  resolution: FashionResolution
  /** 规划 LLM（大脑）选择，对应 access 接口下发的 llmOptions；缺省用服务端默认 */
  plannerLlm?: string
}

export type AgentBetaPlanProtocol = 'legacy' | 'agent-runtime-v1'

/** C9 工具轨迹的浏览器安全投影；不包含参数、凭据、原始异常或 A2 请求。 */
export interface AgentBetaToolTraceView {
  step: number
  toolName: string
  status: 'rejected' | 'completed' | 'awaiting_approval' | 'verification_required'
  target?: 'read_only' | 'preview' | 'gateway'
  reason?: string
}

/** 素材摘要只展示当前会话成员身份，不下发 assetDigest 或底层 URL。 */
export interface AgentBetaPreviewAssetView {
  nodeId: string
  assetId: string
  name: string
}

/** C4 PreviewArtifact 的安全浏览器投影；完整 normalizedParams 只留在服务端工件仓储。 */
export interface AgentBetaPreviewView {
  schemaVersion: 1
  proposalId: string
  version: number
  /** 服务端计算的完整 requestDigest 引用；客户端只原样回传，绝不自行计算。 */
  digest: string
  featureType: FeatureType
  toolName: string
  resolvedModelId: string
  estimatedResultCount: number
  assets: AgentBetaPreviewAssetView[]
  blockers: string[]
  riskNotices: string[]
  createdAt: string
  expiresAt: string
  confirmable: boolean
}

export type AgentBetaResultAdmissionState =
  | 'not_submitted'
  | 'pending'
  | 'verifying'
  | 'admitted'
  | 'quarantined'

/** 任务状态与结果发布分离；只有 admitted 的节点才会由服务端加入画布。 */
export interface AgentBetaResultAdmissionView {
  state: AgentBetaResultAdmissionState
  taskId?: string
  taskStatus?: TaskStatus
  /** 仅统计本 action 经 C8 返回的安全结果，不从 task aggregate 推导。 */
  resultCount?: number
}

/** 浏览器确认只绑定曾看到的服务端版本；不携带批准回执或完整参数。 */
export interface AgentBetaPreviewIdentity {
  proposalId: string
  previewVersion: number
  previewDigest: string
}

export interface AgentBetaConfirmInput extends AgentBetaPreviewIdentity {
  messageId: string
}

export interface AgentBetaRepreviewInput extends AgentBetaPreviewIdentity {
  messageId: string
  prompt: string
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
  /** 旧持久记录可缺省；新写入始终显式标记，禁止随 flag 降级已有 v1 方案。 */
  protocol?: AgentBetaPlanProtocol
  preview?: AgentBetaPreviewView
  toolTrace?: AgentBetaToolTraceView[]
  resultAdmission?: AgentBetaResultAdmissionView
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
  /** 无付费预览的只读/治理动作也可返回安全轨迹。 */
  toolTrace?: AgentBetaToolTraceView[]
  plan?: AgentBetaPlan
}

export interface AgentBetaSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  nodes: AgentBetaNode[]
  messages: AgentBetaMessage[]
  /** 旧会话文件读取兼容；C13 HTTP 响应始终补为 1。 */
  protocolVersion?: 1
  /** 只说明下一条新提案的路由，不改变会话内已有方案的协议。 */
  newProposalRuntime?: AgentBetaPlanProtocol
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
  /** 可选规划 LLM 目录（access 路由下发；仅暴露 id/label，不含凭据） */
  llmOptions?: Array<{ id: string; label: string }>
  /** 默认规划 LLM id；null 表示目录为空（服务端回退 TEXT_LLM_*） */
  defaultLlmId?: string | null
}
