import { createHash } from 'node:crypto'
import path from 'node:path'
import type { AgentBetaMessage, AgentBetaNode } from '@/lib/agent-beta/types'
import { loadJsonFileWithRecovery, writeJsonFileAtomic } from '@/lib/server/json-file-store'

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
export interface ExecutionRecord {
  key: string
  userId: string
  sessionId: string
  messageId: string
  prompt: string
  taskId: string
  createdAt: string
  submitted?: boolean
}

/** 一个本地 Node 进程内串行更新；不把聊天和画布写入业务 store。 */
export class AgentBetaRepository {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(readonly directory = path.join(process.cwd(), 'data', 'agent-beta')) {}

  private async locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.chains.set(key, next)
    try {
      return await next
    } finally {
      if (this.chains.get(key) === next) this.chains.delete(key)
    }
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
    return this.locked(`user:${userId}`, () => this.loadUser(userId))
  }

  async mutateUser<T>(userId: string, operation: (file: UserFile) => Promise<T> | T): Promise<T> {
    return this.locked(`user:${userId}`, async () => {
      const file = await this.loadUser(userId)
      const result = await operation(file)
      await writeJsonFileAtomic(this.userPath(userId), file, 'agent-beta-sessions')
      return result
    })
  }

  async withExecutions<T>(operation: (records: ExecutionRecord[], save: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.locked('executions', async () => {
      const filePath = path.join(this.directory, 'executions.json')
      const records = await loadJsonFileWithRecovery({
        filePath,
        label: 'agent-beta-executions',
        parse(value: unknown): ExecutionRecord[] {
          if (!Array.isArray(value) || value.some((record) => !record?.key || !record.userId || !record.taskId || !record.createdAt)) {
            throw new Error('Agent Beta 执行记录格式错误')
          }
          return value as ExecutionRecord[]
        },
      }) ?? []
      return operation(records, () => writeJsonFileAtomic(filePath, records, 'agent-beta-executions'))
    })
  }
}
