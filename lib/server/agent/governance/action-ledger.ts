import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ActionLedgerFile, ActionLedgerRecord, LedgerFacts, LegacyLedgerEntry } from '@/lib/agent/contracts'
import type { GenerationTask } from '@/lib/types'
import type { TaskQueryPort } from '../ports'

const chains = new Map<string, Promise<unknown>>()

/** 锁按绝对文件路径共享，多个 Repository 实例不能覆盖彼此的更新。 */
export async function withAgentFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath)
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  chains.set(key, next)
  try { return await next } finally { if (chains.get(key) === next) chains.delete(key) }
}

const text = z.string().min(1)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = text.refine((value) => Number.isFinite(Date.parse(value)), '无效时间')
const taskStatus = z.enum(['pending', 'running', 'success', 'partial', 'failed', 'cancelled'])
const facts = {
  submissionState: z.enum(['NOT_STARTED', 'STARTING', 'SUBMITTED', 'UNKNOWN', 'VERIFYING']),
  taskStatus: taskStatus.optional(),
  gateOutcome: z.enum(['NOT_RUN', 'PASSED_PRE', 'BLOCKED_PRE', 'BLOCKED_POST_SUBMIT', 'BLOCKED_RESULT']),
  sideEffectState: z.enum(['NONE', 'POSSIBLE', 'CONFIRMED']),
  resultAdmission: z.enum(['NOT_APPLICABLE', 'PENDING', 'ADMITTED', 'QUARANTINED']),
  evidenceRefs: z.array(text),
  updatedAt: timestamp,
}
const identity = { key: text, userId: text, sessionId: text, messageId: text, createdAt: timestamp }
const oldRecordSchema = z.object({ ...identity, prompt: z.string(), taskId: text, submitted: z.boolean().optional() }).passthrough()
const legacySchema = oldRecordSchema.extend({ ...facts, schemaVersion: z.literal(1), recordKind: z.literal('legacy'), approvalEvidence: z.literal('unavailable') })
const v1Base = { ...identity, ...facts, schemaVersion: z.literal(1), recordKind: z.literal('v1'), toolName: text, requestDigest: digest, assetDigests: z.array(digest), providerRequestIds: z.array(text) }
const v1Schema = z.union([
  z.object({ ...v1Base, actionKind: z.enum(['generate', 'retry_shots']), approvalEvidence: z.literal('receipt'), approvalDigest: digest, proposalId: text, previewVersion: z.number().int().positive(), featureType: z.enum(['ai-fashion-photo', 'photo-fission', 'pose-fission', 'garment-detail']), taskId: text }).strict(),
  z.object({ ...v1Base, actionKind: z.enum(['classify', 'cutout_prepare']), approvalEvidence: z.literal('explicit_user_intent'), approvalDigest: z.null(), intentId: text, assetId: text }).strict(),
  z.object({ ...v1Base, actionKind: z.literal('cancel'), approvalEvidence: z.literal('explicit_user_intent'), approvalDigest: z.null(), intentId: text, taskId: text }).strict(),
])
const fileSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(z.union([legacySchema, v1Schema])) }).strict()

export type LegacyExecutionInput = Pick<LegacyLedgerEntry, 'key' | 'userId' | 'sessionId' | 'messageId' | 'prompt' | 'taskId' | 'createdAt' | 'submitted'>

export class ActionLedgerError extends Error {
  readonly code = 'AGENT_ACTION_LEDGER_UNAVAILABLE'
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'ActionLedgerError' }
}

/** SUBMITTED 只说明任务存在；pending 等业务状态原样复制，不推断成功。 */
export function taskEvidence(record: Pick<LegacyExecutionInput, 'userId' | 'taskId'>, task: GenerationTask | undefined, updatedAt: string): LedgerFacts {
  if (task && task.taskId === record.taskId && task.userId === record.userId) {
    taskStatus.parse(task.status)
    return { submissionState: 'SUBMITTED', taskStatus: task.status, gateOutcome: 'NOT_RUN', sideEffectState: 'CONFIRMED', resultAdmission: 'PENDING', evidenceRefs: [`task:${task.taskId}`], updatedAt }
  }
  return { submissionState: 'UNKNOWN', gateOutcome: 'NOT_RUN', sideEffectState: 'POSSIBLE', resultAdmission: 'PENDING', evidenceRefs: [], updatedAt }
}

export async function migrateLegacyExecution(record: LegacyExecutionInput, query?: TaskQueryPort, now = new Date().toISOString()): Promise<LegacyLedgerEntry> {
  const source = oldRecordSchema.parse(record)
  // 查询不可用与找不到任务都不能证明未调用；不补造任何历史批准。
  const task = await query?.getTask(source.taskId).catch(() => undefined)
  return { ...source, ...taskEvidence(source, task, now), schemaVersion: 1, recordKind: 'legacy', approvalEvidence: 'unavailable' }
}

export function validateActionLedger(value: unknown): ActionLedgerFile {
  const file: ActionLedgerFile = fileSchema.parse(value)
  const keys = new Set<string>()
  for (const entry of file.entries) {
    const key = JSON.stringify([entry.userId, entry.key])
    if (keys.has(key)) throw new ActionLedgerError('执行账包含重复身份，需人工核实')
    keys.add(key)
  }
  return file
}

function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }

async function durableWrite(filePath: string, content: string | Buffer, exclusive = false): Promise<void> {
  const handle = await open(filePath, exclusive ? 'wx' : 'w', 0o600)
  try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
}

/** 安全账不自动回退旧备份：无法证明恢复副本最新时，保留现场并拒绝执行。 */
export class ActionLedgerStore {
  readonly filePath: string
  constructor(directory: string, private readonly query?: TaskQueryPort) { this.filePath = path.join(path.resolve(directory), 'executions.json') }

  private async load(query = this.query): Promise<{ file: ActionLedgerFile; legacyBytes?: Buffer }> {
    let bytes: Buffer
    try { bytes = await readFile(this.filePath) } catch (error) {
      if (!missing(error)) throw new ActionLedgerError('执行账无法读取，已停止执行', { cause: error })
      let names: string[]
      try { names = await readdir(path.dirname(this.filePath)) } catch (directoryError) {
        if (missing(directoryError)) return { file: { schemaVersion: 1, entries: [] } }
        throw new ActionLedgerError('执行账目录无法读取', { cause: directoryError })
      }
      if (names.some((name) => name.startsWith('executions.json.'))) throw new ActionLedgerError('执行账主文件缺失且存在历史证据，需人工核实')
      return { file: { schemaVersion: 1, entries: [] } }
    }
    try {
      const value: unknown = JSON.parse(bytes.toString('utf8'))
      if (!Array.isArray(value)) return { file: validateActionLedger(value) }
      const entries: LegacyLedgerEntry[] = []
      for (const item of value) {
        if (item?.recordKind !== undefined || item?.schemaVersion !== undefined) throw new ActionLedgerError('旧执行数组包含新格式条目')
        entries.push(await migrateLegacyExecution(oldRecordSchema.parse(item), query))
      }
      return { file: validateActionLedger({ schemaVersion: 1, entries }), legacyBytes: bytes }
    } catch (error) { throw new ActionLedgerError('执行账损坏或格式不受支持，已停止执行', { cause: error }) }
  }

  async read(query = this.query): Promise<ActionLedgerFile> {
    return this.withEntries(async (entries) => ({ schemaVersion: 1, entries }), query)
  }

  async withEntries<T>(operation: (entries: ActionLedgerRecord[], save: () => Promise<void>) => Promise<T>, query = this.query): Promise<T> {
    return withAgentFileLock(this.filePath, async () => {
      const loaded = await this.load(query)
      return operation(loaded.file.entries, async () => {
        const file = validateActionLedger(loaded.file)
        await mkdir(path.dirname(this.filePath), { recursive: true })
        if (loaded.legacyBytes) {
          try { await durableWrite(`${this.filePath}.legacy-v0.bak`, loaded.legacyBytes, true) } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
            const savedBytes = await readFile(`${this.filePath}.legacy-v0.bak`)
            if (!savedBytes.equals(loaded.legacyBytes)) throw new ActionLedgerError('原始迁移备份与当前旧账不一致，需人工核实')
          }
          loaded.legacyBytes = undefined
        }
        const payload = JSON.stringify(file, null, 2)
        await durableWrite(`${this.filePath}.tmp-write`, payload)
        await rename(`${this.filePath}.tmp-write`, this.filePath)
        const directory = await open(path.dirname(this.filePath), 'r')
        try { await directory.sync() } finally { await directory.close() }
        // 主文件已强写；最近有效副本只供人工核实，不用于隐式覆盖调用证据。
        await durableWrite(`${this.filePath}.bak.tmp-write`, payload)
        await rename(`${this.filePath}.bak.tmp-write`, `${this.filePath}.bak`)
      })
    })
  }
}
