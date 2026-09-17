import { z } from 'zod'
import { canonicalize, digest } from '@/lib/agent/contracts'
import type { AgentTurnInput } from '../agent/turn'
import { DurableGovernanceTable } from '../agent/governance/preparation-artifact-store'
import type { AgentBetaV1TurnScope } from './v1-bridge'

export const V1_TURN_REPOSITORY_FILE = 'v1-turns.json'

export type V1TurnIdentity = AgentBetaV1TurnScope

export interface V1TurnSaveInput extends AgentBetaV1TurnScope {
  messageId: string
  turnId: string
  requestFingerprint: string
  inputDigest: string
  input: AgentTurnInput
  createdAt: string
}

export interface V1TurnRecord extends V1TurnSaveInput {
  schemaVersion: 1
  key: string
  recordDigest: string
}

export type StoredV1Turn = V1TurnRecord
export type SaveV1TurnInput = V1TurnSaveInput

export interface V1TurnRepositoryPort {
  get(identity: V1TurnIdentity | string): Promise<V1TurnRecord | undefined>
  saveIfAbsent(input: V1TurnSaveInput): Promise<V1TurnRecord>
}

export type V1TurnRepositoryErrorCode =
  | 'INVALID_RECORD'
  | 'TURN_CONFLICT'
  | 'INTEGRITY_MISMATCH'
  | 'STORAGE_UNAVAILABLE'

const ERROR_MESSAGES: Readonly<Record<V1TurnRepositoryErrorCode, string>> = Object.freeze({
  INVALID_RECORD: 'v1 turn 记录无效',
  TURN_CONFLICT: '同一客户端消息的 v1 turn 内容冲突',
  INTEGRITY_MISMATCH: 'v1 turn 记录完整性校验失败',
  STORAGE_UNAVAILABLE: 'v1 turn 强持久存储不可用',
})

/** 不暴露磁盘路径、冻结输入或底层解析错误。 */
export class V1TurnRepositoryError extends Error {
  constructor(readonly code: V1TurnRepositoryErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'V1TurnRepositoryError'
  }
}

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = z.string().datetime()
const identitySchema = z.object({
  userId: identifier,
  sessionId: identifier,
  clientMessageId: identifier,
}).strict()
const saveInputSchema = z.object({
  ...identitySchema.shape,
  messageId: identifier,
  turnId: identifier,
  requestFingerprint: hash,
  inputDigest: hash,
  input: z.unknown(),
  createdAt: timestamp,
}).strict()
const recordSchema = saveInputSchema.extend({
  schemaVersion: z.literal(1),
  key: z.string().min(1).max(2_048),
  recordDigest: hash,
}).strict()
const inputIdentitySchema = z.object({
  userId: identifier,
  sessionId: identifier,
  messageId: identifier,
  turnId: identifier,
}).strict()

const forbiddenTransportKeys = new Set([
  'apikey',
  'xapikey',
  'headers',
  'cookie',
  'setcookie',
  'password',
  'secret',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'credentials',
  'baseurl',
  'apiurl',
  'endpoint',
  'httpagent',
  'signal',
  'transportcredential',
  'transportcredentials',
])

function fail(code: V1TurnRepositoryErrorCode): never {
  throw new V1TurnRepositoryError(code)
}

function strictClone<T>(value: T, code: V1TurnRepositoryErrorCode): T {
  try {
    return JSON.parse(canonicalize(value)) as T
  } catch {
    return fail(code)
  }
}

function normalizedKey(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase()
}

function assertNoTransportCredentials(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoTransportCredentials(item)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenTransportKeys.has(normalizedKey(key))) return fail('INVALID_RECORD')
    assertNoTransportCredentials(child)
  }
}

function parseIdentity(value: unknown): V1TurnIdentity {
  try {
    const frozen = strictClone<unknown>(value, 'INVALID_RECORD')
    if (frozen === null || typeof frozen !== 'object' || Array.isArray(frozen)) {
      return fail('INVALID_RECORD')
    }
    return identitySchema.parse({
      userId: (frozen as Record<string, unknown>).userId,
      sessionId: (frozen as Record<string, unknown>).sessionId,
      clientMessageId: (frozen as Record<string, unknown>).clientMessageId,
    })
  } catch (error) {
    if (error instanceof V1TurnRepositoryError) throw error
    return fail('INVALID_RECORD')
  }
}

export function v1TurnKey(identity: V1TurnIdentity): string
export function v1TurnKey(userId: string, sessionId: string, clientMessageId: string): string
export function v1TurnKey(
  identityOrUserId: V1TurnIdentity | string,
  sessionId?: string,
  clientMessageId?: string,
): string {
  const identity = typeof identityOrUserId === 'string'
    ? parseIdentity({ userId: identityOrUserId, sessionId, clientMessageId })
    : parseIdentity(identityOrUserId)
  return canonicalize({
    schemaVersion: 1,
    userId: identity.userId,
    sessionId: identity.sessionId,
    clientMessageId: identity.clientMessageId,
  })
}

export async function computeAgentTurnInputDigest(input: AgentTurnInput): Promise<string> {
  const frozen = strictClone(input, 'INVALID_RECORD')
  assertNoTransportCredentials(frozen)
  return digest({ schemaVersion: 1, input: frozen })
}

export const agentTurnInputDigest = computeAgentTurnInputDigest

function recordDigestPayload(record: Omit<V1TurnRecord, 'recordDigest'> | V1TurnRecord): object {
  return {
    schemaVersion: 1,
    key: record.key,
    userId: record.userId,
    sessionId: record.sessionId,
    clientMessageId: record.clientMessageId,
    messageId: record.messageId,
    turnId: record.turnId,
    requestFingerprint: record.requestFingerprint,
    inputDigest: record.inputDigest,
    input: record.input,
    createdAt: record.createdAt,
  }
}

async function validateRecord(raw: unknown): Promise<V1TurnRecord> {
  let record: V1TurnRecord
  try {
    record = recordSchema.parse(strictClone(raw, 'INTEGRITY_MISMATCH')) as V1TurnRecord
  } catch (error) {
    if (error instanceof V1TurnRepositoryError) throw error
    return fail('INTEGRITY_MISMATCH')
  }

  assertNoTransportCredentials(record.input)
  let inputIdentity: z.infer<typeof inputIdentitySchema>
  try {
    const input = record.input as unknown as { identity?: unknown }
    inputIdentity = inputIdentitySchema.parse(input?.identity)
  } catch {
    return fail('INTEGRITY_MISMATCH')
  }
  if (inputIdentity.userId !== record.userId
    || inputIdentity.sessionId !== record.sessionId
    || inputIdentity.messageId !== record.messageId
    || inputIdentity.turnId !== record.turnId
    || record.key !== v1TurnKey(record)
    || record.inputDigest !== await digest({ schemaVersion: 1, input: record.input })
    || record.recordDigest !== await digest(recordDigestPayload(record))) {
    return fail('INTEGRITY_MISMATCH')
  }
  return record
}

async function buildRecord(raw: V1TurnSaveInput): Promise<V1TurnRecord> {
  let input: z.infer<typeof saveInputSchema>
  try {
    input = saveInputSchema.parse(strictClone(raw, 'INVALID_RECORD'))
  } catch (error) {
    if (error instanceof V1TurnRepositoryError) throw error
    return fail('INVALID_RECORD')
  }
  assertNoTransportCredentials(input.input)

  let inputIdentity: z.infer<typeof inputIdentitySchema>
  try {
    const frozen = input.input as { identity?: unknown }
    inputIdentity = inputIdentitySchema.parse(frozen?.identity)
  } catch {
    return fail('INVALID_RECORD')
  }
  if (inputIdentity.userId !== input.userId
    || inputIdentity.sessionId !== input.sessionId
    || inputIdentity.messageId !== input.messageId
    || inputIdentity.turnId !== input.turnId
    || input.inputDigest !== await digest({ schemaVersion: 1, input: input.input })) {
    return fail('INVALID_RECORD')
  }

  const base = {
    schemaVersion: 1 as const,
    key: v1TurnKey(input),
    ...input,
  }
  return validateRecord({ ...base, recordDigest: await digest(recordDigestPayload(base as V1TurnRecord)) })
}

function assertUniqueKeys(entries: readonly V1TurnRecord[]): void {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (keys.has(entry.key)) return fail('INTEGRITY_MISMATCH')
    keys.add(entry.key)
  }
}

function copyRecord(record: V1TurnRecord): V1TurnRecord {
  return strictClone(record, 'INTEGRITY_MISMATCH')
}

/**
 * 服务端冻结输入的强持久仓储。DurableGovernanceTable 提供原子替换、目录 fsync、最近证据副本及
 * 同一 Node 进程内按绝对路径跨实例锁；任何主文件/摘要异常均失败关闭，不从备份自动恢复。
 */
export class V1TurnRepository implements V1TurnRepositoryPort {
  readonly #table: DurableGovernanceTable<V1TurnRecord>

  constructor(directory: string) {
    this.#table = new DurableGovernanceTable(directory, V1_TURN_REPOSITORY_FILE, validateRecord)
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof V1TurnRepositoryError) throw error
      return fail('STORAGE_UNAVAILABLE')
    }
  }

  get(identity: V1TurnIdentity | string): Promise<V1TurnRecord | undefined>
  get(userId: string, sessionId: string, clientMessageId: string): Promise<V1TurnRecord | undefined>
  async get(
    identityOrKey: V1TurnIdentity | string,
    sessionId?: string,
    clientMessageId?: string,
  ): Promise<V1TurnRecord | undefined> {
    let key: string
    if (typeof identityOrKey === 'string' && sessionId === undefined && clientMessageId === undefined) {
      if (!identityOrKey || identityOrKey.length > 2_048) return fail('INVALID_RECORD')
      key = identityOrKey
    } else {
      key = typeof identityOrKey === 'string'
        ? v1TurnKey(identityOrKey, sessionId as string, clientMessageId as string)
        : v1TurnKey(identityOrKey)
    }
    return this.guarded(() => this.#table.transaction(async (entries) => {
      assertUniqueKeys(entries)
      const record = entries.find((entry) => entry.key === key)
      return record ? copyRecord(record) : undefined
    }))
  }

  async saveIfAbsent(raw: V1TurnSaveInput): Promise<V1TurnRecord> {
    const candidate = await buildRecord(raw)
    return this.guarded(() => this.#table.transaction(async (entries, save) => {
      assertUniqueKeys(entries)
      const prior = entries.find((entry) => entry.key === candidate.key)
      if (prior) {
        if (prior.requestFingerprint !== candidate.requestFingerprint
          || prior.inputDigest !== candidate.inputDigest
          || canonicalize(prior.input) !== canonicalize(candidate.input)) {
          return fail('TURN_CONFLICT')
        }
        return copyRecord(prior)
      }
      entries.push(candidate)
      await save()
      return copyRecord(candidate)
    }))
  }
}

export { V1TurnRepository as FileV1TurnRepository }
