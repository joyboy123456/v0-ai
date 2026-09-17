import type {
  AgentBetaConfirmInput,
  AgentBetaPlan,
  AgentBetaPreviewIdentity,
  AgentBetaResultAdmissionState,
  AgentBetaSession,
} from './types'

export function isAgentRuntimeV1Plan(plan: AgentBetaPlan | undefined): boolean {
  return plan?.protocol === 'agent-runtime-v1'
}

/** 浏览器只复制服务端下发的版本身份，不读取或重算完整工件摘要。 */
export function previewIdentity(plan: AgentBetaPlan): AgentBetaPreviewIdentity | undefined {
  const preview = plan.preview
  if (!isAgentRuntimeV1Plan(plan) || !preview) return undefined
  return {
    proposalId: preview.proposalId,
    previewVersion: preview.version,
    previewDigest: preview.digest,
  }
}

export function samePreviewIdentity(
  left: AgentBetaPreviewIdentity | undefined,
  right: AgentBetaPreviewIdentity | undefined,
): boolean {
  return Boolean(left && right
    && left.proposalId === right.proposalId
    && left.previewVersion === right.previewVersion
    && left.previewDigest === right.previewDigest)
}

/** 只接受用户点击时看到的身份；一致时返回原对象，绝不重算或升级摘要。 */
export function bindClickedPreviewIdentity(
  clicked: AgentBetaPreviewIdentity | undefined,
  currentPlan: AgentBetaPlan | undefined,
): AgentBetaPreviewIdentity | undefined {
  const current = currentPlan ? previewIdentity(currentPlan) : undefined
  return samePreviewIdentity(clicked, current) ? clicked : undefined
}

export function confirmationInput(plan: AgentBetaPlan, messageId: string): AgentBetaConfirmInput | undefined {
  const identity = previewIdentity(plan)
  if (!identity
    || !plan.preview?.confirmable
    || plan.status !== 'proposed'
    || plan.resultAdmission?.state !== 'not_submitted') return undefined
  return { messageId, ...identity }
}

export function admissionNeedsRefresh(state: AgentBetaResultAdmissionState | undefined): boolean {
  return state === 'pending' || state === 'verifying'
}

export function hasAdmittedResults(plan: AgentBetaPlan | undefined): boolean {
  return plan?.resultAdmission?.state === 'admitted'
    && Number.isSafeInteger(plan.resultAdmission.resultCount)
    && (plan.resultAdmission.resultCount ?? 0) > 0
}

/** UNKNOWN/VERIFYING 只触发安全刷新；客户端从不据此重新提交 execute。 */
export function sessionNeedsRefresh(session: AgentBetaSession | null): boolean {
  return Boolean(session?.messages.some((message) => {
    if (message.toolTrace?.some((entry) => entry.status === 'verification_required')
      || message.plan?.toolTrace?.some((entry) => entry.status === 'verification_required')) return true
    const plan = message.plan
    if (!plan) return false
    const status = plan.task?.status
    return status === 'pending' || status === 'running'
      || admissionNeedsRefresh(plan.resultAdmission?.state)
  }))
}
