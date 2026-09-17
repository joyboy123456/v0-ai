import { UNKNOWN_MANUAL_REVIEW_AFTER_MS } from '@/lib/agent/budget'
import type { ActionLedgerRecord, SubmissionState } from '@/lib/agent/contracts'
import type { GenerationTask, TaskStatus } from '@/lib/types'
import type { TaskQueryPort } from '../ports'

/** 仅安全账事务和任务查询能力；核实器不持有任何业务命令。 */
export interface ReconciliationLedger {
  withActionLedger<T>(operation: (entries: ActionLedgerRecord[], save: () => Promise<void>) => Promise<T>, query?: TaskQueryPort): Promise<T>
}

export interface UnknownReconcilerDependencies {
  ledger: ReconciliationLedger
  tasks: TaskQueryPort
  now?: () => Date
}

export interface ReconciliationSummary {
  checkedCount: number
  changedCount: number
  unknownKeys: string[]
  /** 查询缺失、异常或身份不符；已确认记录仍保留原有事实。 */
  unverifiedKeys: string[]
  manualReviewKeys: string[]
  requiresManualReview: boolean
}

const reconciledStates = new Set<SubmissionState>(['STARTING', 'UNKNOWN', 'VERIFYING', 'SUBMITTED'])
const unknownStates = new Set<SubmissionState>(['STARTING', 'UNKNOWN', 'VERIFYING'])
const taskStatuses = new Set<TaskStatus>(['pending', 'running', 'success', 'partial', 'failed', 'cancelled'])
// 旧数组的格式读取不能绕过下面的用户过滤，预先查询整本账的任务。
const noMigrationQuery: TaskQueryPort = { getTask: async () => undefined }

function provesCreation(entry: ActionLedgerRecord, task: GenerationTask | undefined): task is GenerationTask {
  return Boolean(task && 'taskId' in entry && task.taskId === entry.taskId && task.userId === entry.userId && taskStatuses.has(task.status))
}

/** 每次请求只核实该用户已落账的创建身份；不存在的账条目不会被猜测或补造。 */
export async function reconcileUnknownActions({ userId, ledger, tasks, now = () => new Date() }: UnknownReconcilerDependencies & { userId: string }): Promise<ReconciliationSummary> {
  if (!userId.trim()) throw new TypeError('核实执行账必须指定用户')
  const timestamp = now()
  const updatedAt = timestamp.toISOString()
  return ledger.withActionLedger(async (entries, save) => {
    const summary: ReconciliationSummary = { checkedCount: 0, changedCount: 0, unknownKeys: [], unverifiedKeys: [], manualReviewKeys: [], requiresManualReview: false }
    for (const entry of entries) {
      if (entry.userId !== userId || !reconciledStates.has(entry.submissionState)) continue
      // 原任务存在只能证明创建发生，不能证明取消或某一重试轮次已经执行。
      const isCreation = entry.recordKind === 'legacy' || entry.actionKind === 'generate'
      if (isCreation && 'taskId' in entry) {
        summary.checkedCount++
        let task: GenerationTask | undefined
        try { task = await tasks.getTask(entry.taskId) } catch { task = undefined }
        const previous = JSON.stringify([entry.submissionState, entry.sideEffectState, entry.taskStatus ?? null, entry.evidenceRefs])
        if (provesCreation(entry, task)) {
          entry.submissionState = 'SUBMITTED'
          entry.sideEffectState = 'CONFIRMED'
          entry.taskStatus = task.status
          entry.evidenceRefs = [...new Set([...entry.evidenceRefs, `task:${task.taskId}`])]
        } else {
          summary.unverifiedKeys.push(entry.key)
          entry.submissionState = 'UNKNOWN'
          if (entry.sideEffectState !== 'CONFIRMED') entry.sideEffectState = 'POSSIBLE'
          delete entry.taskStatus
        }
        // 核实不能解除隔离、补造批准或把结果自动放行；时间只随事实变化更新。
        const current = JSON.stringify([entry.submissionState, entry.sideEffectState, entry.taskStatus ?? null, entry.evidenceRefs])
        if (current !== previous) {
          entry.updatedAt = updatedAt
          summary.changedCount++
        }
      }
      if (unknownStates.has(entry.submissionState)) {
        summary.unknownKeys.push(entry.key)
        if (timestamp.getTime() - Date.parse(entry.createdAt) > UNKNOWN_MANUAL_REVIEW_AFTER_MS) summary.manualReviewKeys.push(entry.key)
      }
    }
    summary.requiresManualReview = summary.manualReviewKeys.length > 0
    if (summary.changedCount > 0) await save()
    return summary
  }, noMigrationQuery)
}

/** composition root 可注入窄能力闭包，旧 service 只接收当前用户的核实函数。 */
export function createUnknownReconciler(dependencies: UnknownReconcilerDependencies): (userId: string) => Promise<ReconciliationSummary> {
  return (userId) => reconcileUnknownActions({ ...dependencies, userId })
}
