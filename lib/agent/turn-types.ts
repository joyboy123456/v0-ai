import type { PreviewArtifact, RetryPreviewArtifact } from './contracts'
import type { AgentRouteDecision, JsonValue } from './types'

/** C9 的封闭停止原因；每个返回路径都必须先强写同名 completion 记录。 */
export type AgentTurnStopReason =
  | 'completed'
  | 'clarification_required'
  | 'permission_denied'
  | 'model_budget_exceeded'
  | 'tool_budget_exceeded'
  | 'elapsed_time_exceeded'
  | 'model_request_record_failed'
  | 'model_unavailable'
  | 'model_output_invalid'
  | 'plan_validation_failed'
  | 'plan_needs_review'
  | 'tool_hallucination'
  | 'outside_tool_frontier'
  | 'provenance_violation'
  | 'trusted_intent_missing'
  | 'tool_execution_failed'
  | 'awaiting_approval'
  | 'action_verification_required'
  | 'waiting_for_task'

export type AgentTurnStatus = 'completed' | 'stopped' | 'awaiting_approval' | 'verification_required'

/** 只保存服务端安全投影；不保存参数、凭据、原始异常或供应商自由文本。 */
export interface AgentTurnToolTraceEntry {
  step: number
  callId: string
  toolName: string
  status: 'rejected' | 'completed' | 'awaiting_approval' | 'verification_required'
  target?: 'read_only' | 'preview' | 'gateway'
  reason?: AgentTurnStopReason
}

export interface AgentTurnToolResult {
  callId: string
  toolName: string
  result: JsonValue
}

export interface AgentTurnBudget {
  limits: {
    maxModelCalls: number
    maxToolCalls: number
    maxElapsedMs: number
  }
  usage: {
    modelCalls: number
    toolAttempts: number
    toolCalls: number
    elapsedMs: number
  }
}

/** C4 预览是唯一可返回的付费产物；它不是 ApprovalReceipt，也不表示任务已提交。 */
export type AgentTurnPreview = PreviewArtifact | RetryPreviewArtifact

export interface AgentTurnResult {
  schemaVersion: 1
  userId: string
  sessionId: string
  messageId: string
  turnId: string
  status: AgentTurnStatus
  stopReason: AgentTurnStopReason
  route: AgentRouteDecision
  content: string
  blockers: string[]
  questions: string[]
  preview?: AgentTurnPreview
  toolResults: AgentTurnToolResult[]
  toolTrace: AgentTurnToolTraceEntry[]
  requestIds: string[]
  budget: AgentTurnBudget
  /** 仅表示读取了同 inputDigest 的强写完成记录，不授予任何新权限。 */
  replayed: boolean
}
