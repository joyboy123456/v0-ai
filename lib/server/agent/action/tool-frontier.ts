import type { AgentRouteDecision, AgentToolMeta } from '../../../agent/types'
import type { ToolRegistry } from './tool-registry'

export interface ToolFrontierContext {
  allowed: boolean
  stage: 'understand' | 'plan' | 'waiting' | 'finish'
  route: AgentRouteDecision
  purpose?: 'cutout' | 'consult' | 'general'
  allowedToolNames?: readonly string[]
}

const STAGE_TOOL_NAMES: Record<ToolFrontierContext['stage'], readonly string[]> = {
  understand: ['asset.inspect', 'session.list_nodes', 'garment.classify'],
  plan: [
    'asset.inspect',
    'session.list_nodes',
    'garment.classify',
    'cutout.prepare',
    'fashion_photo.create',
    'photo_fission.create',
    'pose_fission.create',
    'garment_detail.create',
  ],
  waiting: ['task.get_status', 'task.cancel'],
  finish: ['task.get_status', 'task.retry_shots'],
}

const EMPTY_FRONTIER: readonly AgentToolMeta[] = Object.freeze([])

function isCreateTool(name: string): boolean {
  return name.endsWith('.create')
}

function isRetryTool(name: string): boolean {
  return name.includes('retry')
}

function isDryRunTool(tool: AgentToolMeta): boolean {
  return isCreateTool(tool.name) || isRetryTool(tool.name)
}

function costAllows(tool: AgentToolMeta, route: AgentRouteDecision): boolean {
  if (route.costClass === 'free_text') return tool.costClass === 'free'
  if (route.costClass === 'vendor_api') return tool.costClass !== 'paid_generation'
  return true
}

const CONTROLLED_ACTION_NAMES = new Set(['cutout.prepare', 'task.cancel'])
const PLANNING_ONLY_BLOCKERS = new Set([
  'feature_required',
  'model_required',
  'single_approval_scope_required',
  'multi_action_scope_required',
])

function isControlledAction(tool: AgentToolMeta): boolean {
  return CONTROLLED_ACTION_NAMES.has(tool.name)
}

function isReadOnlyQuery(tool: AgentToolMeta): boolean {
  return tool.readOnly && tool.sideEffectClass === 'none'
}

function laneAllows(tool: AgentToolMeta, route: AgentRouteDecision): boolean {
  if (route.lane === 'read_only_analysis') return isReadOnlyQuery(tool)
  if (route.lane === 'structured_decision') {
    return isReadOnlyQuery(tool) || isDryRunTool(tool) || isControlledAction(tool)
  }
  return route.lane === 'plan_execute'
}

function isExplicitCutoutAction(tool: AgentToolMeta, route: AgentRouteDecision): boolean {
  return tool.name === 'cutout.prepare'
    && !tool.readOnly
    && tool.costClass === 'vendor_api'
    && tool.sideEffectClass === 'external_irreversible'
    && tool.approvalPolicy === 'explicit_user_intent'
    && tool.requiresFreshState
    && tool.rollbackCapability === 'irreversible_after_submit'
    && route.intent === 'edit'
    && route.risk === 'write_reversible'
    && route.costClass === 'vendor_api'
    && route.lane === 'structured_decision'
    && route.humanGate === 'none'
}

function riskAllows(tool: AgentToolMeta, route: AgentRouteDecision): boolean {
  const readOnly = isReadOnlyQuery(tool)
  if (route.risk === 'read_only') return readOnly
  if (route.risk === 'draft') return readOnly || isDryRunTool(tool)
  if (readOnly || isDryRunTool(tool) || isExplicitCutoutAction(tool, route)) return true
  return tool.sideEffectClass !== 'external_irreversible'
    && tool.rollbackCapability !== 'irreversible_after_submit'
}

function gateAllows(tool: AgentToolMeta, route: AgentRouteDecision): boolean {
  if (tool.approvalPolicy === 'none') return true
  if (tool.approvalPolicy === 'explicit_user_intent') return route.humanGate !== 'always'
  if (tool.approvalPolicy === 'preview_confirmation') return route.humanGate !== 'none'
  return route.humanGate === 'always'
}

function intentAllows(tool: AgentToolMeta, route: AgentRouteDecision): boolean {
  if (isCreateTool(tool.name)) {
    return route.intent === 'edit' || route.intent === 'plan' || route.intent === 'generate'
  }
  if (isRetryTool(tool.name)) return route.intent === 'retry'
  return true
}

function readinessAllows(tool: AgentToolMeta, context: ToolFrontierContext): boolean {
  const { route } = context
  if (isReadOnlyQuery(tool)) return true
  if (route.evidenceState !== 'ready') return false
  if (route.mechanicalReady && route.blockers.length === 0) return true

  // 这些 blocker 只限制真实提交；有人工闸门时仍允许生成冻结 preview。
  return isDryRunTool(tool)
    && route.humanGate !== 'none'
    && route.blockers.length > 0
    && route.blockers.every((blocker) => PLANNING_ONLY_BLOCKERS.has(blocker))
}

function routeAllows(tool: AgentToolMeta, context: ToolFrontierContext): boolean {
  const { route } = context
  return costAllows(tool, route)
    && laneAllows(tool, route)
    && riskAllows(tool, route)
    && gateAllows(tool, route)
    && intentAllows(tool, route)
    && readinessAllows(tool, context)
}

/**
 * 从可信服务端上下文计算本轮可见工具；这里只裁剪元数据，真实执行仍由 Gateway 完成。
 */
export function selectToolFrontier(
  registry: ToolRegistry,
  context: ToolFrontierContext,
): readonly AgentToolMeta[] {
  if (!context.allowed || context.purpose === 'consult'
    || context.route.lane === 'direct_answer'
    || context.route.lane === 'clarify_human_review') {
    return EMPTY_FRONTIER
  }

  const allowlist = context.allowedToolNames === undefined
    ? undefined
    : new Set(context.allowedToolNames)
  const selected: AgentToolMeta[] = []

  for (const name of STAGE_TOOL_NAMES[context.stage]) {
    // 硬权限最先取交集，后续规则不得扩权。
    if (allowlist && !allowlist.has(name)) continue
    const tool = registry.get(name)
    if (!tool) continue
    if (context.purpose === 'cutout' && (isCreateTool(name) || isRetryTool(name))) continue
    if (routeAllows(tool, context)) selected.push(tool)
  }

  return Object.freeze(selected)
}
