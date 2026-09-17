import { createHash } from 'node:crypto'
import path from 'node:path'
import type { AgentBetaMessage, AgentBetaNode } from '@/lib/agent-beta/types'
import type { ActionLedgerRecord, LedgerFacts, LegacyLedgerEntry } from '@/lib/agent/contracts'
import { loadJsonFileWithRecovery, writeJsonFileAtomic } from '@/lib/server/json-file-store'
import { ActionLedgerStore, migrateLegacyExecution, withAgentFileLock } from '../agent/governance/action-ledger'
import type { LockedResultAdmissionLedger, TaskQueryPort } from '../agent/ports'

export type StoredNode = Pick<AgentBetaNode, 'id' | 'assetId' | 'x' | 'y' | 'taskId' | 'parentNodeId'>
export interface StoredSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  nodes: StoredNode[]
  messages: AgentBetaMessage[]
  messageFingerprints: Record<string, string>
}
interface UserFile {
  version: 1
  userId: string
  sessions: StoredSession[]
}
export interface ExecutionRecord extends Partial<LedgerFacts> {
  key: string
  userId: string
  sessionId: string
  messageId: string
  prompt: string
  taskId: string
  createdAt: string
  submitted?: boolean
  schemaVersion?: 1
  recordKind?: 'legacy'
  approvalEvidence?: 'unavailable'
}

export interface LegacyExecutionAccess {
  isBlocked(userId: string, key: string, taskId: string): boolean
  blockedTaskIds: ReadonlySet<string>
  hasUnresolvedGeneration: boolean
  hasPendingGeneration: boolean
  generationTaskIds: ReadonlySet<string>
}

function legacyAccess(entries: ActionLedgerRecord[]): LegacyExecutionAccess {
  const protectedEntries = entries.filter((entry) => entry.recordKind === 'v1' || entry.resultAdmission === 'QUARANTINED')
  const keys = new Set(protectedEntries.map((entry) => JSON.stringify([entry.userId, entry.key])))
  const blockedTaskIds = new Set(protectedEntries.flatMap((entry) => 'taskId' in entry ? [entry.taskId] : []))
  const generations = entries.filter((entry) => entry.recordKind === 'v1' && (entry.actionKind === 'generate' || entry.actionKind === 'retry_shots'))
  return {
    blockedTaskIds,
    isBlocked: (userId, key, taskId) => keys.has(JSON.stringify([userId, key])) || blockedTaskIds.has(taskId),
    hasUnresolvedGeneration: generations.some((entry) => ['STARTING', 'UNKNOWN', 'VERIFYING'].includes(entry.submissionState) || entry.sideEffectState === 'POSSIBLE'),
    hasPendingGeneration: generations.some((entry) => entry.submissionState === 'SUBMITTED' && (!entry.taskStatus || ['pending', 'running'].includes(entry.taskStatus))),
    generationTaskIds: new Set(generations.flatMap((entry) => 'taskId' in entry ? [entry.taskId] : [])),
  }
}

/** 一个本地 Node 进程内串行更新；不把聊天和画布写入业务 store。 */
export class AgentBetaRepository {
  private readonly ledger: ActionLedgerStore

  constructor(readonly directory = path.join(process.cwd(), 'data', 'agent-beta'), private readonly taskQuery?: TaskQueryPort) {
    this.ledger = new ActionLedgerStore(directory, taskQuery)
  }

  private userPath(userId: string): string {
    return path.join(this.directory, `user-${createHash('sha256').update(userId).digest('hex')}.json`)
  }

  private async loadUser(userId: string): Promise<UserFile> {
    const value = await loadJsonFileWithRecovery({
      filePath: this.userPath(userId),
      label: 'agent-beta-sessions',
      parse(value: unknown): UserFile {
        const file = value as UserFile
        if (file?.version !== 1 || file.userId !== userId || !Array.isArray(file.sessions)) {
          throw new Error('Agent Beta 会话文件格式错误')
        }
        for (const session of file.sessions) {
          if (!session?.id || !Array.isArray(session.nodes) || !Array.isArray(session.messages) || !session.messageFingerprints) {
            throw new Error('Agent Beta 会话内容损坏')
          }
        }
        return file
      },
    })
    return value ?? { version: 1, userId, sessions: [] }
  }

  async readUser(userId: string): Promise<UserFile> {
    return withAgentFileLock(this.userPath(userId), () => this.loadUser(userId))
  }

  async mutateUser<T>(userId: string, operation: (file: UserFile) => Promise<T> | T): Promise<T> {
    return withAgentFileLock(this.userPath(userId), async () => {
      const file = await this.loadUser(userId)
      const result = await operation(file)
      await writeJsonFileAtomic(this.userPath(userId), file, 'agent-beta-sessions')
      return result
    })
  }

  readActionLedger(query = this.taskQuery) { return this.ledger.read(query) }

  withActionLedger<T>(operation: (entries: ActionLedgerRecord[], save: () => Promise<void>) => Promise<T>, query = this.taskQuery): Promise<T> {
    return this.ledger.withEntries(operation, query)
  }

  async withExecutions<T>(operation: (
    records: ExecutionRecord[],
    save: () => Promise<void>,
    access: LegacyExecutionAccess,
    ledger: LockedResultAdmissionLedger,
  ) => Promise<T>, query = this.taskQuery): Promise<T> {
    return this.withActionLedger(async (entries, save) => {
      const records: ExecutionRecord[] = entries.filter((entry): entry is LegacyLedgerEntry => entry.recordKind === 'legacy')
      const protectedEntries = entries.filter((entry) => entry.recordKind === 'v1')
      return operation(records, async () => {
        const legacy: LegacyLedgerEntry[] = []
        for (const record of records) {
          legacy.push(record.recordKind === 'legacy' ? record as LegacyLedgerEntry : {
            ...await migrateLegacyExecution(record, query), ...record,
            schemaVersion: 1, recordKind: 'legacy', approvalEvidence: 'unavailable',
          })
        }
        entries.splice(0, entries.length, ...protectedEntries, ...legacy)
        await save()
      }, legacyAccess(entries), { entries, save })
    }, query)
  }
}
