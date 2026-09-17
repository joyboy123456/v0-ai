import {
  confirmationInput,
  hasAdmittedResults,
  isAgentRuntimeV1Plan,
  previewIdentity,
} from '@/lib/agent-beta/protocol'
import type {
  AgentBetaMessage,
  AgentBetaNode,
  AgentBetaPlan,
  AgentBetaPreviewIdentity,
  AgentBetaPreviewView,
  AgentBetaResultAdmissionState,
  AgentBetaToolTraceView,
} from '@/lib/agent-beta/types'
import {
  asPlainDisplayText,
  buildToolTraceView,
  cutoutNeedsExplicitRedo,
  cutoutNeedsVerification,
  toolTraceNeedsVerification,
  visibleToolTrace,
  type ToolTraceView,
} from './tool-trace-view'

const BLOCKER_LABELS: Record<string, string> = {
  'decision_gate:multiple_results_not_enabled': '当前一次只能确认 1 张，多张方案只可预览、不能提交',
  'decision_gate:pose_prompt_not_supported': '姿势裂变还不能用自由提示词，请改用已绑定的姿势和设置',
}

const USER_GOAL_NOTICE_PREFIX = '用户目标：'

export type PlanWorkflowStage = 'edit' | 'repreview' | 'confirm' | 'submitted'

export type PlanStatusKind =
  | 'legacy_proposed'
  | 'confirm_ready'
  | 'needs_repreview'
  | 'blocked'
  | 'expired'
  | 'not_confirmable'
  | 'pending_generation'
  | 'pending_admission'
  | 'verifying'
  | 'quarantined'
  | 'admitted'
  | 'admitted_empty'
  | 'running'
  | 'failed'
  | 'cancelled'
  | 'submitted'

export interface PlanCardViewInput {
  message: AgentBetaMessage
  nodes: AgentBetaNode[]
  draftPrompt: string
  busy: string | null
  nowMs?: number
}

export interface PlanCardView {
  planId: string
  messageId: string
  isV1: boolean
  featureLabel: string
  /** 服务端冻结模型 id；界面只做目录标签查找，不改写。 */
  modelId: string
  /** v1 PreviewView 不含比例/分辨率真值，不得用 plan.settings 冒充冻结参数。 */
  imageRatio?: string
  resolution?: string
  resultCount: number
  previewVersion?: number
  digest?: string
  expiresAt?: string
  expiresLabel?: string
  expired: boolean
  assets: Array<{ nodeId: string; name: string }>
  riskNotices: string[]
  blockers: string[]
  workflowStage: PlanWorkflowStage
  statusKind: PlanStatusKind
  phaseLabel: string
  statusTitle: string
  nextStep: string
  showProposalControls: boolean
  promptMatchesPlan: boolean
  confirmEnabled: boolean
  repreviewEnabled: boolean
  cancelEnabled: boolean
  retryPrepareEnabled: boolean
  refreshEnabled: boolean
  identity?: AgentBetaPreviewIdentity
  claimsCanvas: boolean
  cutoutNeedsVerification: boolean
  cutoutNeedsExplicitRedo: boolean
  showVendorRetry: false
  traces: AgentBetaToolTraceView[]
  traceView: ToolTraceView
  taskProgress?: number
  taskMessage?: string
  showTaskMessage: boolean
}

export function featureLabel(featureType: string | undefined): string {
  if (featureType === 'photo-fission') return 'AI 服装大片'
  if (featureType === 'pose-fission') return '姿势裂变'
  if (featureType === 'garment-detail') return '高清放大细节图'
  if (featureType === 'ai-fashion-photo') return '服饰生图'
  return '服饰生图'
}

export function previewExpired(preview: Pick<AgentBetaPreviewView, 'expiresAt'>, nowMs: number): boolean {
  const expires = Date.parse(preview.expiresAt)
  return Number.isFinite(expires) && expires <= nowMs
}

export function previewExpiryIdentityKey(identity: AgentBetaPreviewIdentity | undefined): string | undefined {
  if (!identity) return undefined
  return `${identity.proposalId}:${identity.previewVersion}:${identity.previewDigest}`
}

/** 仅在尚未到期时给出 delay；到期后不再调度，由当前 nowMs 禁用确认。 */
export function schedulePreviewExpiry(expiresAt: string | undefined, nowMs: number): number | undefined {
  if (!expiresAt) return undefined
  const deadline = Date.parse(expiresAt)
  if (!Number.isFinite(deadline)) return undefined
  const delay = deadline - nowMs
  if (delay <= 0) return undefined
  return delay
}

export function formatPreviewExpiry(iso: string): string | undefined {
  const expires = Date.parse(iso)
  if (!Number.isFinite(expires)) return undefined
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(expires))
}

function blockerLabel(blocker: string): string {
  const plain = asPlainDisplayText(blocker)
  return BLOCKER_LABELS[plain] ?? plain
}

function visibleRiskNotices(preview: AgentBetaPreviewView | undefined): string[] {
  if (!preview) return []
  return preview.riskNotices
    .map(asPlainDisplayText)
    .filter((notice) => notice.length > 0 && !notice.startsWith(USER_GOAL_NOTICE_PREFIX))
}

function visibleBlockers(preview: AgentBetaPreviewView | undefined): string[] {
  if (!preview) return []
  return preview.blockers.map(blockerLabel).filter(Boolean)
}

function previewAssets(
  plan: AgentBetaPlan,
  preview: AgentBetaPreviewView | undefined,
  nodes: AgentBetaNode[],
): Array<{ nodeId: string; name: string }> {
  if (preview) return preview.assets.map((asset) => ({ nodeId: asset.nodeId, name: asset.name }))
  return plan.referenceNodeIds.map((id, index) => ({
    nodeId: id,
    name: nodes.find((node) => node.id === id)?.name ?? `图 ${index + 1}`,
  }))
}

function phaseCopy(kind: PlanStatusKind): { phaseLabel: string; statusTitle: string } {
  switch (kind) {
    case 'confirm_ready':
    case 'legacy_proposed':
      return { phaseLabel: '待你确认', statusTitle: '确认当前方案后才会开始生成' }
    case 'needs_repreview':
      return { phaseLabel: '请更新预览', statusTitle: '生成要求已改，请先更新服务器预览' }
    case 'blocked':
      return { phaseLabel: '暂不可确认', statusTitle: '当前方案存在阻断，不能提交' }
    case 'expired':
      return { phaseLabel: '预览已过期', statusTitle: '当前预览已过期，不能确认这一版' }
    case 'not_confirmable':
      return { phaseLabel: '当前版本不可确认', statusTitle: '服务器尚未允许确认这一版' }
    case 'pending_generation':
      return { phaseLabel: '已提交生成', statusTitle: '图片生成中' }
    case 'pending_admission':
      return { phaseLabel: '正在核验结果', statusTitle: '任务完成不代表已上画布，正在核验结果' }
    case 'verifying':
      return { phaseLabel: '正在核实任务', statusTitle: '任务与结果正在安全核实，不会自动重提' }
    case 'quarantined':
      return { phaseLabel: '结果已隔离', statusTitle: '结果已安全隔离' }
    case 'admitted':
      return { phaseLabel: '已加入画布', statusTitle: '图片已加入画布' }
    case 'admitted_empty':
      return { phaseLabel: '核验完成', statusTitle: '安全核验完成，暂无可发布图片' }
    case 'running':
      return { phaseLabel: '生成中', statusTitle: '图片生成中' }
    case 'failed':
      return { phaseLabel: '生成未完成', statusTitle: '生成未完成' }
    case 'cancelled':
      return { phaseLabel: '已取消', statusTitle: '任务已取消' }
    default:
      return { phaseLabel: '已提交', statusTitle: '提交状态待核验' }
  }
}

function submittedStatusKind(input: {
  admission: AgentBetaResultAdmissionState | undefined
  admitted: boolean
  admissionPassed: boolean
  quarantined: boolean
  running: boolean
  done: boolean
  failed: boolean
  cancelled: boolean
  traceNeedsVerification: boolean
}): PlanStatusKind {
  if (input.quarantined) return 'quarantined'
  if (input.admitted) return 'admitted'
  if (input.admissionPassed) return 'admitted_empty'
  if (input.admission === 'verifying' || input.traceNeedsVerification) return 'verifying'
  if (input.admission === 'pending' && (input.done || (!input.running && !input.failed))) return 'pending_admission'
  if (input.running || input.admission === 'pending') return 'pending_generation'
  if (input.cancelled) return 'cancelled'
  if (input.failed) return 'failed'
  if (input.done) return 'pending_admission'
  return 'submitted'
}

function nextStepFor(view: {
  statusKind: PlanStatusKind
  busy: string | null
  cutoutNeedsVerification: boolean
  cutoutNeedsExplicitRedo: boolean
  blockers: string[]
  isV1: boolean
}): string {
  if (view.busy) return `${view.busy}，请稍候。`
  if (view.cutoutNeedsVerification) {
    return '服装抠图结果待核实。请刷新状态或等待人工核实。'
  }
  if (view.cutoutNeedsExplicitRedo) {
    return '服装抠图未完成。如需抠图，请在对话里明确重新操作，系统不会自动再调供应商。'
  }
  switch (view.statusKind) {
    case 'needs_repreview':
      return '请先更新预览。确认按钮只提交当前服务器版本，不会自动提交你刚改的文字。'
    case 'expired':
      return '当前预览已过期。请重新准备方案或刷新后再看这一版是否仍可确认。'
    case 'blocked':
      return view.blockers.length
        ? `请先按阻断说明调整方案。${view.blockers[0]}`
        : '当前方案存在阻断，不能确认。'
    case 'not_confirmable':
      return '服务器标记当前版本不可确认，请调整方案或重新准备。'
    case 'confirm_ready':
      return view.isV1
        ? '请确认当前预览版本。点击只绑定你现在看到的版本，不会改用更新的草稿。'
        : '确认后开始生成。调整模型、比例或分辨率请在下方重新准备方案。'
    case 'legacy_proposed':
      return '确认后开始生成。调整模型、比例或分辨率请在下方重新准备方案。'
    case 'pending_generation':
    case 'running':
      return '生成进行中。可取消任务；系统只刷新进度，不会自动再提交。'
    case 'pending_admission':
      return '任务成功还不能当作已上画布。请刷新核验状态，通过后才会加入画布。'
    case 'verifying':
      return '正在核实任务，只会安全刷新，不会自动执行或重试。'
    case 'quarantined':
      return '结果未加入画布，请等待人工核实。不要再次提交同一方案。'
    case 'admitted':
      return '结果已通过安全核验，可在画布中查看。'
    case 'admitted_empty':
      return '安全核验完成，这次没有可发布的图片。'
    case 'failed':
      return '可以改要求后重新准备方案。不会静默重调供应商。'
    case 'cancelled':
      return '任务已取消。如需继续，请重新准备方案。'
    default:
      return '请查看当前方案状态后再操作。'
  }
}

export function buildPlanCardView(input: PlanCardViewInput): PlanCardView | null {
  const plan = input.message.plan
  if (!plan) return null

  const nowMs = input.nowMs ?? Date.now()
  const isV1 = isAgentRuntimeV1Plan(plan)
  const preview = isV1 ? plan.preview : undefined
  const traces = visibleToolTrace(input.message)
  const traceView = buildToolTraceView(traces)
  const identity = previewIdentity(plan)
  const task = plan.task
  const running = task?.status === 'pending' || task?.status === 'running'
  const done = task?.status === 'success' || task?.status === 'partial'
  const cancelled = task?.status === 'cancelled'
  const failed = task?.status === 'failed' || cancelled
  const admission = isV1 ? plan.resultAdmission?.state : undefined
  const admissionPassed = admission === 'admitted'
  const admitted = hasAdmittedResults(plan)
  const quarantined = admission === 'quarantined'
  const admissionVerifying = admission === 'verifying'
  const traceNeedsVerification = toolTraceNeedsVerification(traces)
  const verifying = admissionVerifying || traceNeedsVerification
  const cutoutVerifying = cutoutNeedsVerification(traces)
  const cutoutRedo = cutoutNeedsExplicitRedo(traces)
  const v1ActionProtected = isV1 && (
    plan.status === 'submitted'
    || task !== undefined
    || admission !== 'not_submitted'
    || traceNeedsVerification
  )
  const showProposalControls = plan.status === 'proposed' && !v1ActionProtected
  const normalizedPrompt = input.draftPrompt.trim()
  const promptMatchesPlan = normalizedPrompt === plan.prompt
  const expired = Boolean(preview && previewExpired(preview, nowMs))
  const blocked = Boolean(preview && preview.blockers.length > 0)
  const protocolConfirm = promptMatchesPlan ? confirmationInput(plan, input.message.id) : undefined
  const busy = Boolean(input.busy)
  const confirmEnabled = Boolean(
    showProposalControls
    && !busy
    && normalizedPrompt
    && (isV1
      ? protocolConfirm && identity && !expired && preview?.confirmable && !blocked
      : true),
  )
  const repreviewEnabled = Boolean(
    isV1
    && showProposalControls
    && !busy
    && normalizedPrompt
    && identity
    && !promptMatchesPlan,
  )

  let statusKind: PlanStatusKind
  let workflowStage: PlanWorkflowStage
  if (!showProposalControls) {
    workflowStage = 'submitted'
    statusKind = isV1
      ? submittedStatusKind({
        admission,
        admitted,
        admissionPassed,
        quarantined,
        running,
        done,
        failed,
        cancelled,
        traceNeedsVerification,
      })
      : running
        ? 'running'
        : cancelled
          ? 'cancelled'
          : failed
            ? 'failed'
            : done
              ? 'admitted'
              : 'submitted'
  } else if (isV1 && !promptMatchesPlan) {
    workflowStage = 'repreview'
    statusKind = 'needs_repreview'
  } else if (isV1 && expired) {
    workflowStage = 'confirm'
    statusKind = 'expired'
  } else if (isV1 && blocked) {
    workflowStage = 'confirm'
    statusKind = 'blocked'
  } else if (isV1 && !protocolConfirm) {
    workflowStage = 'confirm'
    statusKind = 'not_confirmable'
  } else {
    workflowStage = 'confirm'
    statusKind = isV1 ? 'confirm_ready' : 'legacy_proposed'
  }

  const copy = phaseCopy(statusKind)
  const nextStep = nextStepFor({
    statusKind,
    busy: input.busy,
    cutoutNeedsVerification: cutoutVerifying,
    cutoutNeedsExplicitRedo: cutoutRedo,
    blockers: visibleBlockers(preview),
    isV1,
  })

  const refreshEnabled = Boolean(
    !busy
    && !showProposalControls
    && (statusKind === 'verifying' || statusKind === 'pending_admission' || statusKind === 'pending_generation'),
  )
  const retryPrepareEnabled = Boolean(
    !busy
    && failed
    && !running
    && !cutoutRedo
    && (!isV1 || (!verifying && !quarantined && !traceNeedsVerification && statusKind !== 'pending_admission')),
  )

  return {
    planId: plan.id,
    messageId: input.message.id,
    isV1,
    featureLabel: featureLabel(preview?.featureType),
    modelId: preview?.resolvedModelId ?? plan.settings.model,
    imageRatio: isV1 ? undefined : plan.settings.imageRatio,
    resolution: isV1 ? undefined : plan.settings.resolution,
    resultCount: preview?.estimatedResultCount ?? 1,
    previewVersion: preview?.version,
    digest: preview?.digest,
    expiresAt: preview?.expiresAt,
    expiresLabel: preview ? formatPreviewExpiry(preview.expiresAt) : undefined,
    expired,
    assets: previewAssets(plan, preview, input.nodes),
    riskNotices: visibleRiskNotices(preview),
    blockers: visibleBlockers(preview),
    workflowStage,
    statusKind,
    phaseLabel: copy.phaseLabel,
    statusTitle: copy.statusTitle,
    nextStep,
    showProposalControls,
    promptMatchesPlan,
    confirmEnabled,
    repreviewEnabled,
    cancelEnabled: Boolean(!busy && running),
    retryPrepareEnabled,
    refreshEnabled,
    identity,
    claimsCanvas: isV1 ? admitted : Boolean(done && !failed),
    cutoutNeedsVerification: cutoutVerifying,
    cutoutNeedsExplicitRedo: cutoutRedo,
    showVendorRetry: false,
    traces,
    traceView,
    taskProgress: running && task ? Math.round(Math.max(0, Math.min(100, task.progress))) : undefined,
    taskMessage: task?.message,
    showTaskMessage: Boolean(task?.message && (!isV1 || admitted || running || failed)),
  }
}
