/**
 * Session 服务：在 local/oss 模式走进程内 Map。
 *
 * Session payload 形状极简：`{ userId, expiresAt }`。30 天有效期。
 *
 * 注意：
 * - sessionId 用 `crypto.randomUUID()`，36 字符 + 4 dash，足够防猜测
 * - 进程内 Map 重启即丢，但 STORAGE_MODE=local/oss 是本地/私有云用，可接受
 * - Next.js 会把不同 route handler 打到不同 server bundle；模块级 Map 在
 *   bundle 间不共享，所以这里挂到 globalThis，保证 auth/me 与业务 API
 *   看到同一份登录态
 */

import { randomUUID } from 'node:crypto'

import { isLocal, isOss } from '@/lib/server/storage-mode'

export interface SessionRecord {
  userId: string
  expiresAt: number
}

export interface CreatedSession extends SessionRecord {
  sessionId: string
}

/** 30 天，单位秒（同步给 cookie maxAge 使用） */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

const globalForSessions = globalThis as typeof globalThis & {
  __yibaiLocalSessions?: Map<string, SessionRecord>
}

const LOCAL_SESSIONS =
  globalForSessions.__yibaiLocalSessions ?? new Map<string, SessionRecord>()

globalForSessions.__yibaiLocalSessions = LOCAL_SESSIONS

function makeSessionId(): string {
  return `sess_${randomUUID()}`
}

export async function createSession(userId: string): Promise<CreatedSession> {
  if (!userId) throw new Error('createSession: userId 不能为空')
  const sessionId = makeSessionId()
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000
  const record: SessionRecord = { userId, expiresAt }

  LOCAL_SESSIONS.set(sessionId, record)

  return { sessionId, ...record }
}

export async function getSession(
  sessionId: string,
): Promise<SessionRecord | null> {
  if (!sessionId) return null

  const record = LOCAL_SESSIONS.get(sessionId)
  if (!record) return null
  if (record.expiresAt <= Date.now()) {
    LOCAL_SESSIONS.delete(sessionId)
    return null
  }
  return record
}

export async function destroySession(sessionId: string): Promise<void> {
  if (!sessionId) return
  LOCAL_SESSIONS.delete(sessionId)
}
