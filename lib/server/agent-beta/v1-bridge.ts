import type {
  AgentBetaMessage,
  AgentBetaMessageInput,
  AgentBetaPlan,
  AgentBetaPreviewIdentity,
  AgentBetaPreviewView,
} from '@/lib/agent-beta/types'
import type { GenerationTask } from '@/lib/types'

export interface AgentBetaV1TurnScope {
  userId: string
  sessionId: string
  clientMessageId: string
}

export interface AgentBetaV1ActionScope {
  userId: string
  sessionId: string
  messageId: string
}

export interface AgentBetaV1TurnProjection {
  userMessage: AgentBetaMessage
  assistantMessage: AgentBetaMessage
  /** 仅说明 C9 从同一 inputDigest 的完成记录重放；不授予执行权限。 */
  replayed: boolean
}

export interface AgentBetaV1RepreviewCommand extends AgentBetaV1ActionScope, AgentBetaPreviewIdentity {
  prompt: string
}

export interface AgentBetaV1ConfirmCommand extends AgentBetaV1ActionScope, AgentBetaPreviewIdentity {}

/**
 * C13 产品桥接：调用方不得在这些方法期间持有 ActionLedger 或 Beta user-file 锁。
 * 实现按每次调用创建固定认证闭包；Gateway 自行取得 ledger 锁，返回后调用方才能重新同步会话。
 */
export interface AgentBetaV1BridgePort {
  /** 默认 false；只影响尚无冻结 turn 的新提案。 */
  isEnabledForNewProposals(): boolean
  hasTurn(scope: AgentBetaV1TurnScope): Promise<boolean>
  runTurn(
    scope: Omit<AgentBetaV1TurnScope, 'clientMessageId'>,
    input: AgentBetaMessageInput,
    /** 由调用方刚完成的 C8 syncAndHydrate 提供，不接受 HTTP body 字段。 */
    visibleNodeIds: readonly string[],
  ): Promise<AgentBetaV1TurnProjection>
  repreview(command: AgentBetaV1RepreviewCommand): Promise<{ prompt: string; preview: AgentBetaPreviewView }>
  confirm(command: AgentBetaV1ConfirmCommand): Promise<{ task: GenerationTask }>
  cancel(scope: AgentBetaV1ActionScope, taskId: string): Promise<{ task: GenerationTask }>
  /** GET/PATCH/send 后用最新强持久工件修复崩溃窗口；只返回安全投影。 */
  refreshPreview(scope: AgentBetaV1ActionScope, plan: AgentBetaPlan): Promise<AgentBetaPreviewView | undefined>
}
