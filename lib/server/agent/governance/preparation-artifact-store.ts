import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { canonicalize, digest, requestDigest, type GovernedAction } from '@/lib/agent/contracts'
import type { StoredPreparationReference, TaskPreparationArtifactStorePort } from '../action/task-preparation'
import { withAgentFileLock } from './action-ledger'

/** 审批及副作用证据不能自动回退到旧备份或空表。进程锁不等于跨进程锁。 */
export class DurableGovernanceTable<T> {
  readonly filePath: string
  constructor(directory: string, name: string, private readonly validate: (value: unknown) => Promise<T>) {
    this.filePath = path.join(path.resolve(directory), name)
  }

  async transaction<R>(operation: (entries: T[], save: () => Promise<void>) => Promise<R>): Promise<R> {
    return withAgentFileLock(this.filePath, async () => {
      let entries: T[] = []
      let bytes: string | undefined
      try { bytes = await readFile(this.filePath, 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        let names: string[] = []
        try { names = await readdir(path.dirname(this.filePath)) } catch (directoryError) {
          if ((directoryError as NodeJS.ErrnoException).code !== 'ENOENT') throw directoryError
        }
        if (names.some((name) => name.startsWith(`${path.basename(this.filePath)}.`))) {
          throw new Error('governance_storage_unavailable: 主文件缺失且存在写入证据')
        }
      }
      if (bytes !== undefined) {
        const file = z.object({ schemaVersion: z.literal(1), entries: z.array(z.unknown()), digest: z.string() }).strict().parse(JSON.parse(bytes))
        if (file.digest !== await digest({ schemaVersion: 1, entries: file.entries })) {
          throw new Error('governance_storage_unavailable: 文件摘要不一致')
        }
        entries = await Promise.all(file.entries.map(this.validate))
      }
      return operation(entries, async () => {
        const valid = await Promise.all(entries.map(this.validate))
        const payload = { schemaVersion: 1, entries: valid }
        const serialized = canonicalize({ ...payload, digest: await digest(payload) })
        await mkdir(path.dirname(this.filePath), { recursive: true })
        const handle = await open(`${this.filePath}.tmp-write`, 'w', 0o600)
        try { await handle.writeFile(serialized); await handle.sync() } finally { await handle.close() }
        await rename(`${this.filePath}.tmp-write`, this.filePath)
        const directory = await open(path.dirname(this.filePath), 'r')
        try { await directory.sync() } finally { await directory.close() }
        // 只供缺主文件时检测历史写入和人工核实，不自动恢复旧数据。
        const backup = await open(`${this.filePath}.bak.tmp-write`, 'w', 0o600)
        try { await backup.writeFile(serialized); await backup.sync() } finally { await backup.close() }
        await rename(`${this.filePath}.bak.tmp-write`, `${this.filePath}.bak`)
        const backupDirectory = await open(path.dirname(this.filePath), 'r')
        try { await backupDirectory.sync() } finally { await backupDirectory.close() }
      })
    })
  }
}

export function preparationArtifactKey(userId: string, proposalId: string, version: number): string {
  return canonicalize({ userId, proposalId, version })
}

/** 审批和新执行必须核实同一提案的最新服务端版本。 */
export interface CurrentTaskPreparationArtifactStorePort extends TaskPreparationArtifactStorePort {
  getLatest(userId: string, proposalId: string): Promise<StoredPreparationReference | undefined>
  withCurrent<T>(expected: { userId: string; proposalId: string; version: number; requestDigest: string }, operation: () => Promise<T>): Promise<T>
}

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const referenceSchema = z.object({
  schemaVersion: z.literal(1), key: z.string().min(1), kind: z.enum(['generate', 'retry_shots']),
  inputDigest: hash, requestDigest: hash, referenceDigest: hash,
  inputAssetIds: z.array(z.string().min(1)).min(1), sourceTaskId: z.string().min(1).nullable(),
  sourceTaskStateDigest: hash.nullable(), artifact: z.object({ schemaVersion: z.literal(1),
    userId: z.string().min(1), sessionId: z.string().min(1), messageId: z.string().min(1),
    proposalId: z.string().min(1), version: z.number().int().positive().safe(),
  }).passthrough(),
}).strict()

async function validateReference(value: unknown): Promise<StoredPreparationReference> {
  const reference = referenceSchema.parse(JSON.parse(canonicalize(value)))
  const { referenceDigest, artifact, ...base } = reference
  if (referenceDigest !== await digest(base)
    || reference.requestDigest !== await requestDigest({ actionKind: reference.kind, payload: artifact } as unknown as GovernedAction)
    || reference.key !== preparationArtifactKey(artifact.userId, artifact.proposalId, artifact.version)) {
    throw new Error('artifact_tampered: 持久化预览摘要或身份不一致')
  }
  return reference as unknown as StoredPreparationReference
}

/** C4 工件的强持久化实现；相同键只能返回原始不可变版本。 */
export class FileTaskPreparationArtifactStore implements CurrentTaskPreparationArtifactStorePort {
  private readonly table: DurableGovernanceTable<StoredPreparationReference>
  constructor(directory: string) {
    this.table = new DurableGovernanceTable(directory, 'preparation-artifacts.json', validateReference)
  }
  async get(key: string): Promise<StoredPreparationReference | undefined> {
    return this.table.transaction(async (entries) => {
      const matches = entries.filter((entry) => entry.key === key)
      if (matches.length > 1) throw new Error('artifact_tampered: 预览身份重复')
      return matches[0]
    })
  }
  async getLatest(userId: string, proposalId: string): Promise<StoredPreparationReference | undefined> {
    return this.table.transaction(async (entries) => entries
      .filter((entry) => entry.artifact.userId === userId && entry.artifact.proposalId === proposalId)
      .sort((left, right) => right.artifact.version - left.artifact.version)[0])
  }
  /** 与 saveIfAbsent 共用锁；callback 不能再读取本仓储，避免重入死锁。 */
  async withCurrent<T>(expected: { userId: string; proposalId: string; version: number; requestDigest: string }, operation: () => Promise<T>): Promise<T> {
    return this.table.transaction(async (entries) => {
      const latest = entries.filter((entry) => entry.artifact.userId === expected.userId && entry.artifact.proposalId === expected.proposalId)
        .sort((left, right) => right.artifact.version - left.artifact.version)[0]
      if (!latest || latest.artifact.version !== expected.version || latest.requestDigest !== expected.requestDigest) {
        throw new Error('preview_superseded: 预览已有更新版本或摘要不一致')
      }
      return operation()
    })
  }
  async saveIfAbsent(reference: StoredPreparationReference): Promise<StoredPreparationReference> {
    const candidate = await validateReference(reference)
    return this.table.transaction(async (entries, save) => {
      const matches = entries.filter((entry) => entry.key === candidate.key)
      if (matches.length > 1) throw new Error('artifact_tampered: 预览身份重复')
      if (matches[0]) return matches[0]
      entries.push(candidate)
      await save()
      return candidate
    })
  }
}
