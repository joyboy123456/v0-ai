import type { AgentBetaMessage, AgentBetaToolTraceView } from '@/lib/agent-beta/types'

const TOOL_LABELS: Record<string, string> = {
  'asset.inspect': '检查素材',
  'session.list_nodes': '查看画布素材',
  'task.get_status': '查询任务进度',
  'garment.classify': '服装分类',
  'fashion_photo.create': '准备服饰生图方案',
  'photo_fission.create': '准备服装大片方案',
  'pose_fission.create': '准备姿势裂变方案',
  'garment_detail.create': '准备细节图方案',
  'cutout.prepare': '准备服装抠图',
  'task.cancel': '取消任务',
  'task.retry_shots': '准备失败镜头重试',
}

const STATUS_LABELS: Record<AgentBetaToolTraceView['status'], string> = {
  completed: '完成',
  rejected: '未通过',
  awaiting_approval: '待确认',
  verification_required: '待核实',
}

const TARGET_LABELS: Record<NonNullable<AgentBetaToolTraceView['target']>, string> = {
  read_only: '只读检查',
  preview: '准备方案',
  gateway: '提交执行',
}

const REASON_LABELS: Record<string, string> = {
  completed: '本步已完成',
  clarification_required: '还需要你补充说明',
  permission_denied: '当前没有执行权限',
  model_budget_exceeded: '本轮思考次数已用完',
  tool_budget_exceeded: '本轮检查次数已用完',
  elapsed_time_exceeded: '本轮处理超时',
  model_request_record_failed: '记录请求失败，未继续调用模型',
  model_unavailable: '规划服务暂不可用',
  model_output_invalid: '规划结果无法使用',
  plan_validation_failed: '方案未通过校验',
  plan_needs_review: '方案需要人工复核',
  tool_hallucination: '提出了未登记的步骤',
  outside_tool_frontier: '该步骤当前不可用',
  provenance_violation: '步骤参数未通过来源校验',
  trusted_intent_missing: '缺少可核验的操作意图',
  tool_execution_failed: '步骤执行失败',
  awaiting_approval: '等待你确认当前方案',
  action_verification_required: '操作结果待核实，不会自动重提',
  waiting_for_task: '正在等待已提交任务',
}

const MARKUP = /<\/?[a-zA-Z][^>]*>/g
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

/** 只作纯文本展示；去掉标签后仍不当成用户指令。 */
export function asPlainDisplayText(value: string): string {
  return value.replace(MARKUP, '').replace(CONTROLS, '').replace(/\s+/g, ' ').trim()
}

export function toolTraceBusinessLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? '创作步骤'
}

export function toolTraceStatusLabel(status: AgentBetaToolTraceView['status']): string {
  return STATUS_LABELS[status]
}

export function toolTraceTargetLabel(target: AgentBetaToolTraceView['target']): string | undefined {
  return target ? TARGET_LABELS[target] : undefined
}

export function toolTraceNote(reason: string | undefined): string | undefined {
  if (!reason) return undefined
  const plain = asPlainDisplayText(reason)
  if (!plain) return undefined
  return REASON_LABELS[plain] ?? plain
}

/** 无方案的助手消息也可展示轨迹；有方案时沿用方案上的服务器顺序，避免重复。 */
export function visibleToolTrace(message: AgentBetaMessage): AgentBetaToolTraceView[] {
  if (message.plan?.toolTrace?.length) return message.plan.toolTrace
  return message.toolTrace ?? []
}

export function toolTraceNeedsVerification(entries: readonly AgentBetaToolTraceView[]): boolean {
  return entries.some((entry) => entry.status === 'verification_required')
}

export function cutoutNeedsVerification(entries: readonly AgentBetaToolTraceView[]): boolean {
  return entries.some((entry) => entry.toolName === 'cutout.prepare' && entry.status === 'verification_required')
}

/** 仅明确拒绝/失效；UNKNOWN 待核实不得当成已失效或引导再创建。 */
export function cutoutNeedsExplicitRedo(entries: readonly AgentBetaToolTraceView[]): boolean {
  return entries.some((entry) => entry.toolName === 'cutout.prepare' && entry.status === 'rejected')
}

export interface ToolTraceRowView {
  step: number
  toolName: string
  label: string
  status: AgentBetaToolTraceView['status']
  statusLabel: string
  targetLabel?: string
  note?: string
  /** 供应商/系统说明，不得提升为按钮文案或自动重提指令。 */
  isInstruction: false
}

export interface ToolTraceView {
  rows: ToolTraceRowView[]
  accessibleName: string
  defaultOpen: boolean
  cutoutNeedsVerification: boolean
  cutoutNeedsExplicitRedo: boolean
  cutoutHint?: string
  showVendorRetry: false
}

export function buildToolTraceView(entries: readonly AgentBetaToolTraceView[]): ToolTraceView {
  const rows: ToolTraceRowView[] = entries.map((entry) => ({
    step: entry.step,
    toolName: entry.toolName,
    label: toolTraceBusinessLabel(entry.toolName),
    status: entry.status,
    statusLabel: toolTraceStatusLabel(entry.status),
    targetLabel: toolTraceTargetLabel(entry.target),
    note: toolTraceNote(entry.reason),
    isInstruction: false,
  }))
  const verifying = rows.filter((row) => row.status === 'verification_required').length
  const cutoutVerifying = cutoutNeedsVerification(entries)
  const redo = cutoutNeedsExplicitRedo(entries)
  const summary = verifying > 0
    ? `创作检查，共 ${rows.length} 步，其中 ${verifying} 步待核实`
    : `创作检查，共 ${rows.length} 步`
  return {
    rows,
    accessibleName: summary,
    defaultOpen: verifying > 0 || redo || rows.some((row) => row.status === 'rejected'),
    cutoutNeedsVerification: cutoutVerifying,
    cutoutNeedsExplicitRedo: redo,
    cutoutHint: cutoutVerifying
      ? '服装抠图结果待核实。请刷新状态或等待人工核实，系统不会自动再调供应商。'
      : redo
        ? '服装抠图未完成。如需抠图，请在对话里明确重新操作，系统不会自动再调供应商。'
        : undefined,
    showVendorRetry: false,
  }
}
