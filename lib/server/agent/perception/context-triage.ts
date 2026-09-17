import { canonicalize } from '@/lib/agent/contracts'
import type { ContextHandle } from '@/lib/agent/context'
import type { GarmentObservation, JsonValue } from '@/lib/agent/types'

/**
 * B5 上下文分诊：把服务端 JSON 输入换成 P0/P1/P2/P3 分级快照。
 * 纯函数、无 I/O；handle 只定位资源，不携带读取权限（真实解引用与鉴权归 C3）。
 * 观察数据仍是 image_observation，只能影响 prompt，不能当作控制事实。
 */

export type TriagePriority = 'P0' | 'P1' | 'P2' | 'P3'

/** included_over_budget 只允许出现在 P0/P1：超预算也原文保留，绝不静默丢弃。 */
export type TriageItemDecision =
  | 'included'
  | 'included_over_budget'
  | 'truncated'
  | 'handle_only'
  | 'dropped'

export interface TriageDecision {
  item: string
  priority: TriagePriority
  tokenEstimate: number
  decision: TriageItemDecision
  reason: string
}

/** 节点输入：冷节点只允许身份+摘要字段；任何多余原始载荷都不会进入快照。 */
export interface TriageNodeInput {
  nodeId: string
  assetId: string
  assetDigest: string
  selected: boolean
  /** 仅选中节点需要；必须是 origin=image_observation 的纯 JSON 观察。 */
  observation?: GarmentObservation
}

export interface TriageMessageInput {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export interface TriageInput {
  /** 已鉴权身份；所有 handle 都绑定这两个值。 */
  userId: string
  sessionId: string
  /** 观察器版本，写入 observation handle 供解引用方核对。 */
  observerVersion: string
  /** 正有限数；负数/NaN/Infinity 直接抛错。 */
  tokenBudget: number
  goal: { goalId: string; userGoal: string; constraints: string[] }
  taskStatus: { summary: string; currentStepId: string; status: string }
  failureEvidence: string[]
  platformRules: string[]
  settings: Record<string, JsonValue>
  lastResultSummary?: string
  nodes: TriageNodeInput[]
  messages: TriageMessageInput[]
  /** 历史任务只挂 task handle，绝不放供应商原始响应。 */
  historyTaskIds?: string[]
}

export interface SnapshotAccounting {
  tokenBudget: number
  estimatedTotalTokens: number
  p0Tokens: number
  p1Tokens: number
  p2Tokens: number
  p3Tokens: number
  overBudget: boolean
  /** 恒为 0：P0 受硬保护，超预算只标记不丢弃。 */
  p0DroppedCount: number
}

export interface AgentContextSnapshot {
  schemaVersion: 1
  userId: string
  sessionId: string
  p0: {
    goalId: string
    userGoal: string
    constraints: string[]
    taskStatus: { summary: string; currentStepId: string; status: string }
    failureEvidence: string[]
    platformRules: string[]
  }
  p1: {
    selectedObservations: GarmentObservation[]
    settings: Record<string, JsonValue>
    lastResultSummary: string | null
  }
  /** 确定性有界截断：预算不足时保留最近消息，丢弃更旧的。 */
  p2: { recentMessages: TriageMessageInput[] }
  /** 只允许类型化 ContextHandle；无 URL、无字节、无原始冷载荷。 */
  p3: { handles: ContextHandle[] }
  decisions: TriageDecision[]
  accounting: SnapshotAccounting
}

/** 确定性 token 估算：JSON 长度 / 4 向上取整；同一输入永远得到同一结果。 */
export function estimateJsonTokens(value: unknown): number {
  const length = canonicalize(value).length
  return Math.max(1, Math.ceil(length / 4))
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`context-triage: ${label} 必须是非空字符串`)
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

function validateInput(input: TriageInput): void {
  // 描述符检查不会读取 getter，同时保留预算错误的 RangeError 契约。
  const budget = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'tokenBudget') : undefined
  if (budget?.enumerable && Object.hasOwn(budget, 'value')
    && (typeof budget.value !== 'number' || !Number.isFinite(budget.value) || budget.value <= 0)) {
    throw new RangeError('context-triage: tokenBudget 必须是正有限数')
  }
  // 在读取任何属性前复用共享校验；不得执行 getter/toJSON，也不接受隐藏字段或稀疏数组。
  canonicalize(input)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('context-triage: 输入必须是对象')
  for (const collection of [input.nodes, input.messages, input.failureEvidence, input.platformRules, input.goal?.constraints]) {
    if (!Array.isArray(collection)) throw new TypeError('context-triage: 集合必须是数组')
  }
  if (input.historyTaskIds !== undefined && !Array.isArray(input.historyTaskIds)) throw new TypeError('context-triage: historyTaskIds 必须是数组')
  if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) throw new TypeError('context-triage: settings 必须是对象')
  if (!input.taskStatus || typeof input.taskStatus !== 'object' || Array.isArray(input.taskStatus)
    || [input.taskStatus.summary, input.taskStatus.currentStepId, input.taskStatus.status].some((value) => typeof value !== 'string')) {
    throw new TypeError('context-triage: taskStatus 格式错误')
  }
  requireNonEmptyString(input.userId, 'userId')
  requireNonEmptyString(input.sessionId, 'sessionId')
  requireNonEmptyString(input.observerVersion, 'observerVersion')
  if (typeof input.tokenBudget !== 'number' || !Number.isFinite(input.tokenBudget) || input.tokenBudget <= 0) {
    throw new RangeError('context-triage: tokenBudget 必须是正有限数')
  }
  requireNonEmptyString(input.goal?.goalId, 'goal.goalId')
  requireNonEmptyString(input.goal?.userGoal, 'goal.userGoal')
  for (const rule of input.failureEvidence) requireNonEmptyString(rule, 'failureEvidence 条目')
  for (const rule of input.platformRules) requireNonEmptyString(rule, 'platformRules 条目')
  for (const constraint of input.goal.constraints) requireNonEmptyString(constraint, 'goal.constraints 条目')

  const nodeIds = new Set<string>()
  const messageIds = new Set<string>()
  for (const node of input.nodes ?? []) {
    if (!node || typeof node !== 'object' || typeof node.selected !== 'boolean') throw new TypeError('context-triage: node 格式错误')
    requireNonEmptyString(node.nodeId, 'node.nodeId')
    requireNonEmptyString(node.assetId, 'node.assetId')
    requireNonEmptyString(node.assetDigest, 'node.assetDigest')
    if (nodeIds.has(node.nodeId)) {
      throw new TypeError(`context-triage: 节点 ${node.nodeId} 重复`)
    }
    nodeIds.add(node.nodeId)
    if (node.selected) {
      if (!node.observation) {
        throw new TypeError(`context-triage: 选中节点 ${node.nodeId} 缺少 observation`)
      }
      // 身份/摘要不一致视为输入损坏；观察必须声明其来源是图像观察。
      if (node.observation.assetId !== node.assetId) {
        throw new TypeError(`context-triage: 节点 ${node.nodeId} 的 observation.assetId 与 assetId 不一致`)
      }
      if (node.observation.assetDigest !== node.assetDigest) {
        throw new TypeError(`context-triage: 节点 ${node.nodeId} 的 observation.assetDigest 与 assetDigest 不一致`)
      }
      if (node.observation.origin !== 'image_observation') {
        throw new TypeError(`context-triage: 节点 ${node.nodeId} 的 observation.origin 必须是 image_observation`)
      }
    }
  }
  for (const message of input.messages ?? []) {
    if (!message || typeof message !== 'object' || !['user', 'assistant', 'system'].includes(message.role)) throw new TypeError('context-triage: message 格式错误')
    requireNonEmptyString(message.id, 'message.id')
    requireNonEmptyString(message.content, 'message.content')
    requireNonEmptyString(message.createdAt, 'message.createdAt')
    if (messageIds.has(message.id)) {
      throw new TypeError(`context-triage: 消息 ${message.id} 重复`)
    }
    messageIds.add(message.id)
  }
  for (const taskId of input.historyTaskIds ?? []) {
    requireNonEmptyString(taskId, 'historyTaskIds 条目')
  }
}

/** 逐字段重建消息对象：输入上的多余属性（原始载荷等）不会被克隆进来。 */
function cloneMessage(message: TriageMessageInput): TriageMessageInput {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }
}

/**
 * 纯函数入口：同一输入永远产出同一快照（稳定重放）。
 * P0 永远完整；预算只作用于 P2 的确定性截断（保留最近，丢弃更旧）。
 */
export function buildContextSnapshot(input: TriageInput): AgentContextSnapshot {
  validateInput(input)

  const decisions: TriageDecision[] = []
  const { userId, sessionId, observerVersion, tokenBudget } = input

  // ---- P0：硬保护，超预算也只标记 included_over_budget，绝不丢弃 ----
  const p0 = {
    goalId: input.goal.goalId,
    userGoal: input.goal.userGoal,
    constraints: input.goal.constraints.map((entry) => entry),
    taskStatus: { summary: input.taskStatus.summary, currentStepId: input.taskStatus.currentStepId, status: input.taskStatus.status },
    failureEvidence: input.failureEvidence.map((entry) => entry),
    platformRules: input.platformRules.map((entry) => entry),
  }
  const p0Tokens = estimateJsonTokens(p0)
  decisions.push({
    item: 'p0',
    priority: 'P0',
    tokenEstimate: p0Tokens,
    decision: 'included',
    reason: 'P0 硬保护：目标/约束/任务状态/失败证据/平台规则原文保留',
  })

  // ---- P1：工作集（选中节点观察 + 当前 settings + 上次结果摘要）----
  const selectedNodes = input.nodes.filter((node) => node.selected)
  const selectedObservations = selectedNodes.map((node) =>
    structuredClone(node.observation as GarmentObservation),
  )
  for (const node of selectedNodes) {
    decisions.push({
      item: `p1.observation.${node.nodeId}`,
      priority: 'P1',
      tokenEstimate: estimateJsonTokens(node.observation),
      decision: 'included',
      reason: '选中节点观察进入工作集（image_observation，非控制事实）',
    })
  }
  const settings = structuredClone(input.settings)
  decisions.push({
    item: 'p1.settings',
    priority: 'P1',
    tokenEstimate: estimateJsonTokens(settings),
    decision: 'included',
    reason: '当前 settings 进入工作集',
  })
  const lastResultSummary = input.lastResultSummary ?? null
  if (lastResultSummary !== null) {
    requireNonEmptyString(lastResultSummary, 'lastResultSummary')
    decisions.push({
      item: 'p1.lastResultSummary',
      priority: 'P1',
      tokenEstimate: estimateJsonTokens(lastResultSummary),
      decision: 'included',
      reason: '上一次生成结果摘要进入工作集',
    })
  }
  const p1 = { selectedObservations, settings, lastResultSummary }
  const p1Tokens = estimateJsonTokens(p1)

  // ---- P3：只挂类型化 handle；冷节点/历史任务绝不携带原始载荷 ----
  const handles: ContextHandle[] = [
    { schemaVersion: 1, kind: 'session_nodes', userId, sessionId, resourceId: sessionId },
  ]
  for (const node of selectedNodes) {
    handles.push({
      schemaVersion: 1,
      kind: 'observation',
      userId,
      sessionId,
      resourceId: node.assetId,
      assetDigest: node.assetDigest,
      observerVersion,
    })
  }
  for (const node of input.nodes.filter((entry) => !entry.selected)) {
    handles.push({
      schemaVersion: 1,
      kind: 'asset',
      userId,
      sessionId,
      resourceId: node.assetId,
      assetDigest: node.assetDigest,
    })
  }
  for (const taskId of input.historyTaskIds ?? []) {
    handles.push({ schemaVersion: 1, kind: 'task', userId, sessionId, resourceId: taskId })
  }
  for (const handle of handles) {
    decisions.push({
      item: `p3.handle.${handle.kind}.${handle.resourceId}`,
      priority: 'P3',
      tokenEstimate: estimateJsonTokens(handle),
      decision: 'handle_only',
      reason: 'P3 只挂 handle；解引用与再鉴权由 C3 负责',
    })
  }
  const p3Tokens = estimateJsonTokens(handles)

  // ---- P2：确定性有界截断，从最近往旧填充剩余预算 ----
  const remaining = tokenBudget - p0Tokens - p1Tokens - p3Tokens
  const recentMessages: TriageMessageInput[] = []
  let p2Tokens = 0
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]
    const estimate = estimateJsonTokens(cloneMessage(message))
    if (remaining - p2Tokens >= estimate) {
      recentMessages.unshift(cloneMessage(message))
      p2Tokens += estimate
      decisions.push({
        item: `p2.message.${message.id}`,
        priority: 'P2',
        tokenEstimate: estimate,
        decision: 'included',
        reason: '最近历史在预算内保留',
      })
    } else {
      decisions.push({
        item: `p2.message.${message.id}`,
        priority: 'P2',
        tokenEstimate: estimate,
        decision: 'dropped',
        reason: 'P2 确定性截断：预算不足，优先保留最近消息；不影响 P0 目标与失败证据',
      })
    }
  }

  const totalTokens = p0Tokens + p1Tokens + p2Tokens + p3Tokens
  const overBudget = totalTokens > tokenBudget
  if (overBudget) {
    // P0 超预算不裁剪：改写 P0/P1 决策为 included_over_budget，计数仍为 0。
    for (const entry of decisions) {
      if ((entry.priority === 'P0' || entry.priority === 'P1') && entry.decision === 'included') {
        entry.decision = 'included_over_budget'
        entry.reason = `${entry.reason}（超出预算仍原文保留，p0_dropped_count 恒为 0）`
      }
    }
  }

  const snapshot: AgentContextSnapshot = {
    schemaVersion: 1,
    userId,
    sessionId,
    p0,
    p1,
    p2: { recentMessages },
    p3: { handles },
    decisions,
    accounting: {
      tokenBudget,
      estimatedTotalTokens: totalTokens,
      p0Tokens,
      p1Tokens,
      p2Tokens,
      p3Tokens,
      overBudget,
      p0DroppedCount: 0,
    },
  }
  // 克隆已完成（逐字段重建 + structuredClone）；整体冻结防止后续篡改。
  return deepFreeze(snapshot)
}
