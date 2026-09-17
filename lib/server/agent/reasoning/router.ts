import { AGENT_BUDGET } from '@/lib/agent/budget'
import type { AgentRouteDecision } from '@/lib/agent/types'
import type { FeatureType, TaskStatus } from '@/lib/types'

export const AGENT_ROUTER_VERSION = 'deterministic-v1'

/** 仅传入已验证的用户原话与服务端会话事实；不传 OCR、画像或模型生成的控制字段。 */
export interface AgentRouteInput {
  text: string
  selectedAssetIds: readonly string[]
  featureType?: FeatureType | null
  resolvedModelId?: string | null
  task?: { taskId: string; status: TaskStatus | 'unknown'; failedShotCount?: number } | null
  evidenceState?: AgentRouteDecision['evidenceState']
  hasPlan?: boolean
}

type Operation = 'ask' | 'analyze' | 'classify' | 'cutout' | 'cancel' | 'retry' | 'edit' | 'generate' | 'plan' | 'unknown'
type Request = { operation: Operation; operations: Operation[]; text: string; conflict: boolean; controlAttempt: boolean }

const ASK = /怎么|如何|为什么|多少钱|收费|积分|价格|流程|支持|介绍|解释|区别|需要什么|(?:是否|能否|能不能|可不可以)|(?:可以|能够).*吗/u
const ANALYZE = /分析|评价|评审|看看|看一下|清晰吗|模糊吗|是否清晰|有哪些问题|什么颜色/u
const CLASSIFY = /识别.*(?:类别|品类)|分类|辨认.*(?:衣服|服装)/u
const CUTOUT = /抠图|抠出|抠完|去(?:掉|除)背景|透明背景/u
const CANCEL = /取消.*(?:任务|生成)|停止.*(?:任务|生成)|别再生成/u
const RETRY = /重试|再试一次|重新生成失败|重跑失败/u
const EDIT = /(?:换|改|调|变成|替换).*(?:背景|颜色|白底|光线|构图)|(?:背景|颜色|光线|构图).*(?:换|改|调|变成)|修图/u
const GENERATE = /生成|生图|出图|制作|画一|做.*(?:张|图|套)|来.*张|姿势裂变|细节图|高清放大/u
const PLAN = /规划|策划|设计.*方案|制定.*方案|按.*方案/u
const DETAIL_VIEW = /看(?:看|一下)?.*(?:领口|袖口|衣领|面料|衣服).*细节(?:图)?/u
const NEGATION = /^(?:(?:请你|请|先|暂时|现在|千万|暂且|你|我们|我|本次|这次|目前|绝对|帮我|帮忙|麻烦你)\s*)*(?:不要|别|不必|无需|不用|禁止|不想|不需要|不(?=生图|生成|抠图|重试|取消|修改|修图|执行|停止|调整|替换|换|改|分类|识别|制作|重跑|分析))/u
const CONTROL = /(?:跳过|绕过|取消|不要|无需|不用|忽略).*(?:审批|审核|确认|限额|闸门|规则)|(?:humanGate|costClass|lane|budget|maxModelCalls)\s*[:=]|(?:自动|无限|并发).*生成|生成.*(?:不[用需]确认|直接扣)/iu

function stripPoliteRequest(text: string): string {
  return text.replace(/^(?:请问)?(?:能不能|可不可以|能否|可以|能够|能)(?:请)?帮我/u, '')
}

/** 只在已识别动作后且后面紧跟明确动作词时分句，不拆“后背”等名词。 */
function splitActionSequence(clause: string): string[] {
  if (NEGATION.test(clause) || recognize(clause) === 'ask') return [clause]
  const separator = /(?:之后|以后|后)(?=(?:再)?(?:生成|生图|重试|取消|抠图|抠出|分析|修改|换))|(?<!别|要)再(?=重试|生成|生图|取消|抠图|把|做)/u.exec(clause)
  if (!separator || separator.index === 0) return [clause]
  const before = clause.slice(0, separator.index)
  if (recognize(before) === 'unknown') return [clause]
  return [before, ...splitActionSequence(clause.slice(separator.index + separator[0].length))]
}

/** 引号和转述的图片文字仅是被讨论的数据，不是第二份用户指令。 */
function userClauses(text: string): string[] {
  const unquoted = text.replace(/「[^」]*」|“[^”]*”|"[^"]*"|『[^』]*』|`[^`]*`/gu, '')
  // 用户常不打标点，例如“生成一张不要抠图”；否定从自身开始管辖后面的动作。
  const separated = unquoted.replace(/(不要|不需要|不想|无需|不用|别|不)(?=生图|生成|抠图|重试|取消|确认|改|换|分析|执行|停止|调整|替换|修图|分类|识别|制作|重跑)/gu, '，$1')
  return separated.split(/[，。；！？\n,;!?]|(?:但是|但|然后|接着|同时|并且|再给|再帮)|并(?!发)/u)
    .map((clause) => stripPoliteRequest(clause.trim())).filter(Boolean)
    .filter((clause) => !/(?:图片|图中|图上|水印|OCR|模型|画像).*(?:写着|说|文字|建议|显示)/iu.test(clause))
    .flatMap(splitActionSequence)
}

function recognize(text: string): Operation {
  // “可以帮我生成吗”是礼貌请求；“支持生成吗”和流程价格咨询仍是只读。
  text = stripPoliteRequest(text)
  if (/清晰吗|模糊吗|是否清晰|什么颜色/u.test(text)) return 'analyze'
  if (ASK.test(text) || /(?:只问|只想问|咨询|了解|说明一下)/u.test(text)) return 'ask'
  if (CANCEL.test(text)) return 'cancel'
  if (RETRY.test(text)) return 'retry'
  if (CUTOUT.test(text)) return 'cutout'
  if (CLASSIFY.test(text)) return 'classify'
  // 细节查看可能需要创建细节图，先走预览规划；明确“仅分析原图”仍保持只读。
  if (DETAIL_VIEW.test(text) && !/只|仅|分析|原图|已有/u.test(text)) return 'generate'
  if (ANALYZE.test(text)) return 'analyze'
  if (PLAN.test(text)) return 'plan'
  if (EDIT.test(text)) return 'edit'
  if (GENERATE.test(text)) return 'generate'
  return 'unknown'
}

function interpret(text: string): Request {
  const clauses = userClauses(text)
  const positive = clauses.filter((clause) => !NEGATION.test(clause) || /^别再生成/u.test(clause))
  const recognized = positive.map(recognize).filter((operation) => operation !== 'unknown')
  const unique: Operation[] = [...new Set(recognized)]
  const actionKinds = unique.filter((operation) => !['ask', 'analyze'].includes(operation))
  const mixedReadWrite = actionKinds.length > 0 && unique.some((operation) => operation === 'ask' || operation === 'analyze')
  const multi = /(?:先.*(?:再|后)|多步骤|整套|一套|套图)/u.test(positive.join('，')) || actionKinds.length > 1
  // operation 只用于展示意图/推理路径；权限与风险始终由原始动作集合计算。
  const operation = mixedReadWrite ? actionKinds[0] : multi && actionKinds.length ? 'plan' : unique[0] ?? 'unknown'
  const contradiction = clauses.some((clause) => NEGATION.test(clause)
    && unique.includes(recognize(clause.replace(NEGATION, ''))) && !/多张|批量/u.test(clause))
  return { operation, operations: unique, text: positive.join('，'), conflict: mixedReadWrite || contradiction,
    controlAttempt: positive.some((clause) => CONTROL.test(clause)) || clauses.some((clause) => CONTROL.test(clause)) }
}

function isGeneration(operation: Operation): boolean {
  return ['generate', 'edit', 'plan', 'retry'].includes(operation)
}

function intentFor(operation: Operation): AgentRouteDecision['intent'] {
  switch (operation) {
    case 'analyze': case 'classify': return 'review'
    case 'cutout': case 'cancel': return 'edit'
    default: return operation
  }
}

function costFor(operations: Operation[]): AgentRouteDecision['costClass'] {
  if (operations.includes('retry')) return 'paid_regeneration'
  if (operations.some(isGeneration)) return 'paid_generation'
  if (operations.some((operation) => operation === 'cutout' || operation === 'classify')) return 'vendor_api'
  return 'free_text'
}

function riskFor(operations: Operation[]): AgentRouteDecision['risk'] {
  if (operations.some((operation) => operation === 'cutout' || operation === 'cancel')) return 'write_reversible'
  if (operations.some(isGeneration)) return 'draft'
  return 'read_only'
}

function reasoningFor(operation: Operation): AgentRouteDecision['reasoningMode'] {
  return ['generate', 'plan', 'analyze'].includes(operation) ? 'cot' : 'direct'
}

const REASONS: Record<Operation, string> = {
  ask: '流程或能力咨询，只进行文本回答。',
  analyze: '仅分析已选素材，不提出执行授权。',
  classify: '明确分类意图；后续分类仍须经过 Gateway 配额与意图校验。',
  cutout: '明确抠图意图；后续准备仍须经过 Gateway 意图校验。',
  cancel: '仅处理指定任务的取消意图，不承诺供应商已撤销。',
  retry: '为原任务失败镜头准备重试预览，等待重新审批。',
  edit: '单点修改，准备单张预览后等待确认。',
  generate: '单张创作，整理约束和预览后等待确认。',
  plan: '先整理计划；多步骤和整套图片仍需人工逐次确认。',
  unknown: '无法确定用户意图，先澄清。',
}

/** 纯规则，路由本身零模型/工具调用；输出是建议，绝不是执行或审批凭证。 */
export function routeAgentRequest(input: AgentRouteInput): AgentRouteDecision {
  const request = interpret(input.text.trim())
  const operation = request.operation
  const blockers: string[] = []
  const planningBlockers = ['single_approval_scope_required', 'multi_action_scope_required', 'feature_required', 'model_required']
  const paid = request.operations.some(isGeneration)
  const needsAsset = request.operations.some((item) => !['ask', 'unknown', 'retry', 'cancel'].includes(item))
  let evidenceState: AgentRouteDecision['evidenceState'] = 'ready'
  if (request.conflict) { blockers.push('conflicting_intents'); evidenceState = 'conflict' }
  if (request.controlAttempt) { blockers.push('control_override_requested'); evidenceState = 'conflict' }
  if (operation === 'unknown') { blockers.push('intent_unclear'); if (evidenceState === 'ready') evidenceState = 'unknown' }
  if (/按.*方案/u.test(request.text) && !input.hasPlan) blockers.push('plan_required')
  if (needsAsset && !input.selectedAssetIds.some((id) => id.trim())) blockers.push('selected_asset_required')
  if (paid && !input.featureType) blockers.push('feature_required')
  if (paid && !input.resolvedModelId?.trim()) blockers.push('model_required')
  const requestedFeature = /细节图|高清放大/u.test(request.text) || DETAIL_VIEW.test(request.text) ? 'garment-detail'
    : /姿势裂变/u.test(request.text) ? 'pose-fission' : null
  if (paid && requestedFeature && input.featureType && input.featureType !== requestedFeature) {
    blockers.push('feature_conflict'); evidenceState = 'conflict'
  }
  const retries = request.operations.includes('retry')
  const cancels = request.operations.includes('cancel')
  if (retries || cancels) {
    if (!input.task?.taskId.trim()) blockers.push('task_required')
    else if (input.task.status === 'unknown') { blockers.push('task_state_unknown'); evidenceState = 'unknown' }
    else {
      if (retries) {
        if (!['failed', 'partial'].includes(input.task.status)) blockers.push('task_not_retryable')
        if (!Number.isInteger(input.task.failedShotCount) || (input.task.failedShotCount ?? 0) < 1) blockers.push('failed_shots_required')
      }
      if (cancels && !['pending', 'running'].includes(input.task.status)) blockers.push('task_not_active')
    }
  } else if ((paid || request.operations.includes('cutout')) && input.task) {
    if (input.task.status === 'unknown') { blockers.push('task_state_unknown'); evidenceState = 'unknown' }
    if (['pending', 'running'].includes(input.task.status)) blockers.push('task_in_progress')
  }
  if (operation !== 'ask' && input.evidenceState && input.evidenceState !== 'ready') {
    blockers.push(`evidence_${input.evidenceState}`)
    if (evidenceState !== 'conflict') evidenceState = input.evidenceState
  }
  // 功能/模型尚待准备器绑定不代表素材或用户意图缺失，保持证据轴独立。
  if (blockers.some((blocker) => !planningBlockers.includes(blocker)) && evidenceState === 'ready') evidenceState = 'missing'

  // 张数是意图风险信号；预算与真实参数由准备器冻结，不能从“4K”误读为四张。
  const batch = /(?:[2-9]\d*|1\d+|[两二三四五六七八九十百]+)\s*张|多张|批量|整套|一套|套图/u.test(request.text)
  const multiStep = operation === 'plan'
  if (paid && (batch || multiStep)) blockers.push('single_approval_scope_required')
  else if (multiStep) blockers.push('multi_action_scope_required')
  // 机械参数可以在规划中由工具选择和服务端准备器补齐，不要求用户先填功能表单。
  const hardBlocked = blockers.some((blocker) => !planningBlockers.includes(blocker))
  const lane: AgentRouteDecision['lane'] = hardBlocked ? 'clarify_human_review'
    : operation === 'ask' ? 'direct_answer'
      : ['analyze', 'classify'].includes(operation) ? 'read_only_analysis'
        : multiStep || batch ? 'plan_execute' : 'structured_decision'
  const humanGate: AgentRouteDecision['humanGate'] = hardBlocked ? 'always'
    : multiStep ? 'before_plan_confirm'
      : paid ? (batch || blockers.length ? 'before_plan_confirm' : 'before_generation') : 'none'
  const reasoningMode = reasoningFor(operation)
  // 以下是后续 turn 的上限，不表示路由已调用模型；澄清也不允许调用工具。
  const maxModelCalls = hardBlocked || reasoningMode === 'direct' ? 1 : AGENT_BUDGET.maxModelCallsPerTurn
  const maxToolCalls = hardBlocked || operation === 'ask' ? 0 : AGENT_BUDGET.maxReadToolCallsPerTurn
  return {
    routerVersion: AGENT_ROUTER_VERSION, intent: intentFor(operation), evidenceState,
    mechanicalReady: blockers.length === 0, risk: riskFor(request.operations), costClass: costFor(request.operations),
    lane, reasoningMode, humanGate,
    budget: { maxModelCalls, maxToolCalls, maxLatencyMs: AGENT_BUDGET.maxLatencyMsPerTurn },
    routeReason: hardBlocked ? `${REASONS[operation]} 当前证据或意图未满足，停止并澄清。` : REASONS[operation],
    blockers,
  }
}
