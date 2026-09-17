import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { canonicalize, digest, toJsonValue } from '@/lib/agent/contracts'
import type { JsonValue } from '@/lib/agent/types'
import { AGENT_EVENT_NAMES, type AgentEvent, type AgentEventSink } from './events'

/** 一轮身份来自服务端；三个 ID 共同隔离最终完成记录，任何一级不得从模型输出赋值。 */
export interface TurnScope {
  userId: string
  sessionId: string
  turnId: string
}

/** 请求身份来自服务端；四个 ID 共同隔离工件，任何一级不得从模型输出赋值。 */
export interface RequestScope extends TurnScope {
  requestId: string
}

/** 只记录模型可见请求；HTTP headers、apiKey、端点凭据不属于此类型。 */
export interface ModelRequestSnapshot {
  schemaVersion: 1
  model: string
  messages: JsonValue[]
  parameters: { [key: string]: JsonValue }
}

/** 一次模型调用一条不可变记录；多次调用使用同 turnId 和不同 requestId。 */
export interface TurnRecord extends RequestScope {
  schemaVersion: 1
  contextArtifactId: string
  contextDigest: string
  promptVersion: string
  route: JsonValue
  toolTrace: JsonValue[]
  stopReason: string | null
  createdAt: string
}

/** 请求工件和 TurnRecord 为强写；最终停止状态另存为每 turn 唯一的完成记录。 */
export interface RecordModelRequestInput extends RequestScope {
  request: ModelRequestSnapshot
  promptVersion: string
  route?: JsonValue
  toolTrace?: JsonValue[]
  stopReason?: string | null
  createdAt: string
}

/** 预算只保存非负计数，不接受原始 provider、计费或请求对象。 */
export type TurnBudgetUsage = { [metric: string]: number }

/** 工具轨迹只接受调用方先行构造的安全 JSON 投影。 */
export type TurnToolTraceEntry = { [key: string]: JsonValue }

/** 每轮唯一的最终完成/停止记录；completionDigest 校验除自身外的全部冻结字段。 */
export interface TurnCompletionRecord extends TurnScope {
  schemaVersion: 1
  inputDigest: string
  route: { [key: string]: JsonValue }
  budgetUsage: TurnBudgetUsage
  toolTrace: TurnToolTraceEntry[]
  stopReason: string
  requestIds: string[]
  outcome: JsonValue
  startedAt: string
  completedAt: string
  completionDigest: string
}

/** 调用方必须显式提交空 requestIds/toolTrace，从而如实表示零模型/零工具路径。 */
export interface RecordTurnCompletionInput extends TurnScope {
  inputDigest: string
  route: { [key: string]: JsonValue }
  budgetUsage: TurnBudgetUsage
  toolTrace: TurnToolTraceEntry[]
  stopReason: string
  requestIds: string[]
  outcome: JsonValue
  startedAt: string
  completedAt: string
}

/** 公共错误只携带业务错误码；不把磁盘路径或请求凭据交给客户端。 */
export class AgentObservabilityError extends Error {
  constructor(readonly code: 'INVALID_RECORD' | 'UNSAFE_PATH' | 'RECORD_CONFLICT' | 'INTEGRITY_MISMATCH' | 'STORAGE_FAILURE') {
    super(`Agent 请求记录不可用：${code}`)
    this.name = 'AgentObservabilityError'
  }
}

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const turnScopeShape = { userId: identifier, sessionId: identifier, turnId: identifier }
const scopeShape = { ...turnScopeShape, requestId: identifier }
const turnScopeSchema = z.object(turnScopeShape).strict()
const turnScopeWithExtrasSchema = z.object(turnScopeShape).passthrough()
const scopeSchema = z.object(scopeShape).strict()
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), model: z.string().min(1).max(200), messages: z.array(z.unknown()).min(1),
  parameters: z.record(z.unknown()),
}).strict()
const artifactSchema = z.object({ schemaVersion: z.literal(1), ...scopeShape, request: snapshotSchema }).strict()
const presentJson = z.unknown().refine((value) => value !== undefined)
const turnSchema = z.object({
  schemaVersion: z.literal(1), ...scopeShape, contextArtifactId: identifier,
  contextDigest: hash, promptVersion: z.string().min(1).max(200),
  route: presentJson, toolTrace: z.array(z.unknown()), stopReason: z.string().nullable(), createdAt: z.string().datetime(),
}).strict()
const eventSchema = z.object({
  schemaVersion: z.literal(1), eventId: identifier, userId: identifier, sessionId: identifier, turnId: identifier,
  name: z.enum(AGENT_EVENT_NAMES), createdAt: z.string().datetime(), data: presentJson,
}).strict()
const budgetMetric = z.number().refine((value) => Number.isSafeInteger(value) && value >= 0)
const budgetUsageSchema = z.record(budgetMetric).refine((value) => {
  const size = Object.keys(value).length
  return size > 0 && size <= 32
})
const requestIdsSchema = z.array(identifier).max(64)
  .refine((values) => new Set(values).size === values.length)
const stopReasonSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/)
const completionFields = {
  inputDigest: hash,
  route: z.record(z.unknown()),
  budgetUsage: budgetUsageSchema,
  toolTrace: z.array(z.record(z.unknown())).max(128),
  stopReason: stopReasonSchema,
  requestIds: requestIdsSchema,
  outcome: presentJson,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
}
function timestampsOrdered(value: { startedAt: string; completedAt: string }): boolean {
  return Date.parse(value.startedAt) <= Date.parse(value.completedAt)
}
const completionInputSchema = z.object({ ...turnScopeShape, ...completionFields }).strict().refine(timestampsOrdered)
const completionPayloadSchema = z.object({ schemaVersion: z.literal(1), ...turnScopeShape, ...completionFields })
  .strict().refine(timestampsOrdered)
const completionSchema = z.object({
  schemaVersion: z.literal(1), ...turnScopeShape, ...completionFields, completionDigest: hash,
}).strict().refine(timestampsOrdered)
const secretKeys = new Set(['apikey', 'authorization', 'proxyauthorization', 'headers', 'cookie', 'setcookie',
  'password', 'secret', 'clientsecret', 'accesstoken', 'refreshtoken', 'credentials',
  'baseurl', 'apiurl', 'endpoint', 'httpagent', 'signal'])
const completionForbiddenKeys = new Set([...secretKeys,
  'token', 'sessiontoken', 'securitytoken', 'accesskey', 'accesskeyid', 'secretaccesskey', 'privatekey',
  'rawerror', 'error', 'errors', 'exception', 'stack', 'stacktrace', 'cause', 'errormessage',
  'cot', 'chainofthought', 'thought', 'thoughts', 'analysis', 'reasoning', 'reasoningcontent',
  'scratchpad', 'internalmonologue', 'path', 'filepath', 'absolutepath', 'relativepath', 'directory',
  'dirname', 'cwd', 'homedir', 'rootdir'])
const chains = new Map<string, Promise<unknown>>()

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  chains.set(key, next)
  try { return await next } finally { if (chains.get(key) === next) chains.delete(key) }
}

function assertNoSecrets(value: JsonValue): void {
  if (Array.isArray(value)) { for (const item of value) assertNoSecrets(item); return }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (secretKeys.has(key.replace(/[-_]/g, '').toLowerCase())) throw new AgentObservabilityError('INVALID_RECORD')
    assertNoSecrets(item)
  }
}

function normalizedKey(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase()
}

function assertSafeCompletionData(value: JsonValue): void {
  // 自由文本可能合法讨论 API、路径或 Bearer 字样；秘密防线依据受控字段名，不能误删用户数据。
  if (typeof value === 'string') return
  if (Array.isArray(value)) { for (const item of value) assertSafeCompletionData(item); return }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    const normalized = normalizedKey(key)
    if (completionForbiddenKeys.has(normalized) || normalized.endsWith('path')) {
      throw new AgentObservabilityError('INVALID_RECORD')
    }
    assertSafeCompletionData(item)
  }
}

function checkedJson(value: unknown): JsonValue {
  try {
    const result = toJsonValue(value)
    assertNoSecrets(result)
    return result
  } catch (error) {
    if (error instanceof AgentObservabilityError) throw error
    throw new AgentObservabilityError('INVALID_RECORD')
  }
}

function checkedCompletionJson(value: unknown): JsonValue {
  const result = checkedJson(value)
  assertSafeCompletionData(result)
  return result
}

function parseTurnScope(value: TurnScope): TurnScope {
  try {
    const result = turnScopeSchema.safeParse(toJsonValue(value))
    if (!result.success) throw new AgentObservabilityError('UNSAFE_PATH')
    return result.data
  } catch (error) {
    if (error instanceof AgentObservabilityError) throw error
    throw new AgentObservabilityError('UNSAFE_PATH')
  }
}

function parseScope(value: RequestScope): RequestScope {
  const result = scopeSchema.safeParse(value)
  if (!result.success) throw new AgentObservabilityError('UNSAFE_PATH')
  return result.data
}

function sameTurnScope(left: TurnScope, right: TurnScope): boolean {
  return left.userId === right.userId && left.sessionId === right.sessionId && left.turnId === right.turnId
}

function sameScope(left: RequestScope, right: RequestScope): boolean {
  return sameTurnScope(left, right) && left.requestId === right.requestId
}

function completionDigestPayload(record: Omit<TurnCompletionRecord, 'completionDigest'> | TurnCompletionRecord): object {
  return {
    schemaVersion: 1,
    userId: record.userId,
    sessionId: record.sessionId,
    turnId: record.turnId,
    inputDigest: record.inputDigest,
    route: record.route,
    budgetUsage: record.budgetUsage,
    toolTrace: record.toolTrace,
    stopReason: record.stopReason,
    requestIds: record.requestIds,
    outcome: record.outcome,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  }
}

/** 本地存储；只依赖共享契约，不能反向调用任务、治理或供应商模块。 */
export class AgentEventStore implements AgentEventSink {
  private readonly directory: string

  constructor(directory = path.join(process.cwd(), 'data', 'agent-beta')) {
    this.directory = path.resolve(directory)
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof AgentObservabilityError) throw error
      throw new AgentObservabilityError('STORAGE_FAILURE')
    }
  }

  private async safeDirectory(parts: string[]): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (!(await lstat(this.directory)).isDirectory()) throw new AgentObservabilityError('UNSAFE_PATH')
    let directory = await realpath(this.directory)
    for (const part of parts) {
      directory = path.join(directory, part)
      try { await mkdir(directory, { mode: 0o700 }) } catch (error) { if (!isErrno(error, 'EEXIST')) throw error }
      if (!(await lstat(directory)).isDirectory()) throw new AgentObservabilityError('UNSAFE_PATH')
    }
    return directory
  }

  private async requestDirectory(scope: RequestScope): Promise<string> {
    return this.safeDirectory(['requests', scope.userId, scope.sessionId, scope.turnId])
  }

  private async completionDirectory(scope: TurnScope): Promise<string> {
    return this.safeDirectory(['completions', scope.userId, scope.sessionId, scope.turnId])
  }

  /** 同一 Node 进程内跨 runtime/store 实例串行一个 turn；不宣称跨进程分布式锁。 */
  async withTurnLock<T>(identity: TurnScope, operation: () => Promise<T>): Promise<T> {
    const scope = parseTurnScope(identity)
    const physicalDirectory = await this.guarded(() => this.safeDirectory([]))
    return locked(`${physicalDirectory}:turn-execution:${scope.userId}:${scope.sessionId}:${scope.turnId}`, operation)
  }

  private async readJson(filePath: string): Promise<JsonValue> {
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if (!(await handle.stat()).isFile()) throw new AgentObservabilityError('UNSAFE_PATH')
      return checkedJson(JSON.parse(await handle.readFile('utf8')))
    } finally { await handle.close() }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, constants.O_RDONLY)
    try { await handle.sync() } finally { await handle.close() }
  }

  private async writeImmutable(filePath: string, value: object): Promise<void> {
    const serialized = canonicalize(value)
    const temporary = `${filePath}.${randomUUID()}.tmp`
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try {
      try {
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
      } finally { await handle.close() }
      try { await link(temporary, filePath) } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error
        if (canonicalize(await this.readJson(filePath)) !== serialized) throw new AgentObservabilityError('RECORD_CONFLICT')
      }
      await this.syncDirectory(path.dirname(filePath))
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  /** 强写追加；调用方若不能丢失此事件，应直接 await 此方法并让失败向上传播。 */
  async appendRequiredEvent(event: AgentEvent): Promise<void> {
    const parsed = eventSchema.safeParse(checkedJson(event))
    if (!parsed.success) throw new AgentObservabilityError('INVALID_RECORD')
    const serialized = `${canonicalize(parsed.data)}\n`
    if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) throw new AgentObservabilityError('INVALID_RECORD')
    return this.guarded(() => locked(`${this.directory}:events`, async () => {
      const directory = await this.safeDirectory([])
      const handle = await open(path.join(directory, 'events.jsonl'),
        constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        if (!(await handle.stat()).isFile()) throw new AgentObservabilityError('UNSAFE_PATH')
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
      } finally { await handle.close() }
      await this.syncDirectory(directory)
    }))
  }

  /** 同 ID、同内容幂等；不同内容冲突。工件先落盘，TurnRecord 最后作为完成标记。 */
  async recordModelRequest(input: RecordModelRequestInput): Promise<TurnRecord> {
    const scope = parseScope({ userId: input.userId, sessionId: input.sessionId, turnId: input.turnId, requestId: input.requestId })
    const request = snapshotSchema.safeParse(checkedJson(input.request))
    if (!request.success) throw new AgentObservabilityError('INVALID_RECORD')
    const artifact = { schemaVersion: 1 as const, ...scope, request: request.data }
    const contextDigest = await digest(artifact)
    const parsed = turnSchema.safeParse(checkedJson({
      schemaVersion: 1, ...scope, contextArtifactId: scope.requestId, contextDigest,
      promptVersion: input.promptVersion, route: input.route ?? null, toolTrace: input.toolTrace ?? [],
      stopReason: input.stopReason ?? null, createdAt: input.createdAt,
    }))
    if (!parsed.success) throw new AgentObservabilityError('INVALID_RECORD')
    const record = parsed.data as TurnRecord
    return this.guarded(() => locked(`${this.directory}:${scope.userId}:${scope.sessionId}:${scope.turnId}:${scope.requestId}`, async () => {
      const directory = await this.requestDirectory(scope)
      await this.writeImmutable(path.join(directory, `${scope.requestId}.request.json`), artifact)
      await this.writeImmutable(path.join(directory, `${scope.requestId}.turn.json`), record)
      return record
    }))
  }

  /** 只返回身份句柄及请求内容；调用方不得将模型上下文或本地路径暴露给客户端。 */
  async reconstructRequest(identity: RequestScope): Promise<{ record: TurnRecord; request: ModelRequestSnapshot }> {
    const scope = parseScope(identity)
    return this.guarded(async () => {
      const directory = await this.requestDirectory(scope)
      const parsedRecord = turnSchema.safeParse(await this.readJson(path.join(directory, `${scope.requestId}.turn.json`)))
      const parsedArtifact = artifactSchema.safeParse(await this.readJson(path.join(directory, `${scope.requestId}.request.json`)))
      if (!parsedRecord.success || !parsedArtifact.success) throw new AgentObservabilityError('INTEGRITY_MISMATCH')
      const record = parsedRecord.data as TurnRecord
      const artifact = parsedArtifact.data
      if (!sameScope(scope, record) || !sameScope(scope, artifact) || record.contextArtifactId !== scope.requestId
        || await digest(artifact) !== record.contextDigest) throw new AgentObservabilityError('INTEGRITY_MISMATCH')
      return { record, request: artifact.request as ModelRequestSnapshot }
    })
  }

  /**
   * 每个 {userId,sessionId,turnId} 只能强写一条最终记录。先校验并安全投影，再用不可变链接落盘；
   * 任一校验或存储失败均向上传播 AgentObservabilityError，不能降级为普通 telemetry。
   */
  async recordTurnCompletion(input: RecordTurnCompletionInput): Promise<TurnCompletionRecord> {
    return this.guarded(async () => {
      const safeInput = checkedCompletionJson(input)
      const parsedScope = turnScopeWithExtrasSchema.safeParse(safeInput)
      if (!parsedScope.success) throw new AgentObservabilityError('UNSAFE_PATH')
      const parsedInput = completionInputSchema.safeParse(safeInput)
      if (!parsedInput.success) throw new AgentObservabilityError('INVALID_RECORD')
      const parsedPayload = completionPayloadSchema.safeParse({ schemaVersion: 1, ...parsedInput.data })
      if (!parsedPayload.success) throw new AgentObservabilityError('INVALID_RECORD')
      const completionDigest = await digest(parsedPayload.data)
      const parsedRecord = completionSchema.safeParse({ ...parsedPayload.data, completionDigest })
      if (!parsedRecord.success) throw new AgentObservabilityError('INVALID_RECORD')
      const record = parsedRecord.data as TurnCompletionRecord
      if (Buffer.byteLength(canonicalize(record), 'utf8') > 64 * 1024) {
        throw new AgentObservabilityError('INVALID_RECORD')
      }
      const scope: TurnScope = {
        userId: parsedScope.data.userId,
        sessionId: parsedScope.data.sessionId,
        turnId: parsedScope.data.turnId,
      }
      return locked(`${this.directory}:completion:${scope.userId}:${scope.sessionId}:${scope.turnId}`, async () => {
        const directory = await this.completionDirectory(scope)
        await this.writeImmutable(path.join(directory, 'completion.json'), record)
        return record
      })
    })
  }

  /** 缺记录返回 undefined；存在记录必须通过 schema、身份和 completionDigest 三重校验。 */
  async getTurnCompletion(identity: TurnScope): Promise<TurnCompletionRecord | undefined> {
    const scope = parseTurnScope(identity)
    return this.guarded(async () => {
      const directory = await this.completionDirectory(scope)
      let stored: JsonValue
      try {
        stored = await this.readJson(path.join(directory, 'completion.json'))
      } catch (error) {
        if (isErrno(error, 'ENOENT')) return undefined
        throw error
      }
      assertSafeCompletionData(stored)
      const parsed = completionSchema.safeParse(stored)
      if (!parsed.success) throw new AgentObservabilityError('INTEGRITY_MISMATCH')
      const record = parsed.data as TurnCompletionRecord
      if (!sameTurnScope(scope, record)
        || await digest(completionDigestPayload(record)) !== record.completionDigest) {
        throw new AgentObservabilityError('INTEGRITY_MISMATCH')
      }
      return record
    })
  }
}

/** 模型只能看见从已落盘工件重建的快照；任何记录/校验失败都不能触发 invoke。 */
export async function recordThenInvoke<T>(store: Pick<AgentEventStore, 'recordModelRequest' | 'reconstructRequest'>,
  input: RecordModelRequestInput, invoke: (request: ModelRequestSnapshot) => Promise<T>): Promise<T> {
  const record = await store.recordModelRequest(input)
  const rebuilt = await store.reconstructRequest({ userId: record.userId, sessionId: record.sessionId,
    turnId: record.turnId, requestId: record.requestId })
  if (rebuilt.record.contextDigest !== record.contextDigest) throw new AgentObservabilityError('INTEGRITY_MISMATCH')
  return invoke(rebuilt.request)
}
