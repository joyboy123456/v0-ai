import { AGENT_BUDGET } from '@/lib/agent/budget'
import type { AgentToolMeta } from '@/lib/agent/types'
import {
  bindToolProposal,
  ProvenanceBindingError,
  type BoundToolProposal,
  type ServerBindingContext,
} from './provenance'
import type { ToolRegistry } from './tool-registry'

/** 一个 Dispatcher 实例固定绑定一个服务端 turn，调用方不能借复用实例跨身份共享配额。 */
export interface ToolDispatchScope {
  readonly userId: string
  readonly sessionId: string
  readonly messageId: string
}

export interface ToolDispatcherOptions {
  readonly registry: ToolRegistry
  readonly scope: ToolDispatchScope
  /** 只能收紧共享工具预算；超过共享上限时按共享上限执行。 */
  readonly maxToolCalls?: number
}

export interface ToolDispatchInput {
  /** 模型提案；只允许 binder 契约中的 toolName 与可选 prompt。 */
  readonly proposal: unknown
  /** 由服务端绑定的当前 turn 上下文。 */
  readonly context: ServerBindingContext
  /** 可信服务端前沿；这里只读取名称，风险与配额始终重新查询 registry。 */
  readonly frontier: readonly AgentToolMeta[]
}

export type ToolDispatchRejectionReason =
  | 'tool_hallucination'
  | 'outside_tool_frontier'
  | 'turn_budget_exceeded'
  | 'provenance_violation'

export type ToolDispatchTarget = 'read_only' | 'preview' | 'gateway'

/** Dispatch 只返回准入判别和冻结提案；它不是执行结果或 ApprovalReceipt。 */
export type ToolDispatchResult =
  | Readonly<{
    status: 'rejected'
    reason: ToolDispatchRejectionReason
  }>
  | Readonly<{
    status: 'admitted'
    target: 'read_only' | 'gateway'
    proposal: BoundToolProposal
  }>
  | Readonly<{
    status: 'awaiting_approval'
    reason: 'awaiting_approval'
    target: 'preview'
    proposal: BoundToolProposal
  }>

function rejected(reason: ToolDispatchRejectionReason): ToolDispatchResult {
  return Object.freeze({ status: 'rejected', reason })
}

function normalizeMaxToolCalls(value: number | undefined): number {
  if (value === undefined) return AGENT_BUDGET.maxReadToolCallsPerTurn
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('maxToolCalls must be a non-negative safe integer')
  }
  return Math.min(value, AGENT_BUDGET.maxReadToolCallsPerTurn)
}

/**
 * 前沿只承担名称成员关系。通过数据属性描述符读取名称，避免执行伪造 metadata getter；
 * 任何读取异常都按不在前沿 fail closed。
 */
function frontierContains(frontier: readonly AgentToolMeta[], toolName: string): boolean {
  if (!Array.isArray(frontier)) return false
  try {
    for (let index = 0; index < frontier.length; index += 1) {
      const itemDescriptor = Object.getOwnPropertyDescriptor(frontier, String(index))
      if (!itemDescriptor || !Object.hasOwn(itemDescriptor, 'value')) continue
      const item = itemDescriptor.value as unknown
      if ((typeof item !== 'object' && typeof item !== 'function') || item === null) continue
      const nameDescriptor = Object.getOwnPropertyDescriptor(item, 'name')
      if (nameDescriptor && Object.hasOwn(nameDescriptor, 'value') && nameDescriptor.value === toolName) {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

/**
 * 纯工具调度准入。内部计数表示本 turn 已准入的提案数，不表示工具或供应商调用成功。
 * 本类不解析工具 inputSchema、不执行 handler，也不检查资产、余额、队列或全局并发。
 */
export class ToolDispatcher {
  readonly #registry: ToolRegistry
  readonly #scope: Readonly<ToolDispatchScope>
  readonly #maxToolCalls: number
  #admittedCount = 0
  readonly #admittedByTool = new Map<string, number>()

  constructor(options: ToolDispatcherOptions) {
    this.#registry = options.registry
    this.#scope = Object.freeze({
      userId: options.scope.userId,
      sessionId: options.scope.sessionId,
      messageId: options.scope.messageId,
    })
    this.#maxToolCalls = normalizeMaxToolCalls(options.maxToolCalls)
  }

  dispatch(input: ToolDispatchInput): ToolDispatchResult {
    let proposal: BoundToolProposal
    try {
      // binder 必须先运行：它以 getter-safe 的 canonical 校验 proposal/context，并从 registry 绑定字段来源。
      proposal = bindToolProposal(input.proposal, input.context, (name) => this.#registry.get(name))
    } catch (error) {
      if (error instanceof ProvenanceBindingError) return rejected(error.code)
      // 不把异常消息或原始输入带入拒绝结果，避免回传潜在 secret。
      return rejected('provenance_violation')
    }

    if (proposal.userId !== this.#scope.userId
      || proposal.sessionId !== this.#scope.sessionId
      || proposal.messageId !== this.#scope.messageId) {
      return rejected('provenance_violation')
    }

    if (!frontierContains(input.frontier, proposal.toolName)) {
      return rejected('outside_tool_frontier')
    }

    // bindToolProposal 已确认注册；再次从 registry 取元数据，绝不采用 frontier 上的风险或 quota。
    const tool = this.#registry.get(proposal.toolName)
    if (!tool) return rejected('tool_hallucination')

    const admittedForTool = this.#admittedByTool.get(tool.name) ?? 0
    if (this.#admittedCount >= this.#maxToolCalls || admittedForTool >= tool.quotaPerTurn) {
      return rejected('turn_budget_exceeded')
    }

    // 只有完整准入后才记账；awaiting_approval 同样占一次，防止无限重复准备 preview。
    this.#admittedCount += 1
    this.#admittedByTool.set(tool.name, admittedForTool + 1)

    if (tool.costClass === 'paid_generation') {
      return Object.freeze({
        status: 'awaiting_approval',
        reason: 'awaiting_approval',
        target: 'preview',
        proposal,
      })
    }

    const target = tool.costClass === 'free' && tool.sideEffectClass === 'none' && tool.readOnly
      ? 'read_only'
      : 'gateway'
    return Object.freeze({ status: 'admitted', target, proposal })
  }
}
