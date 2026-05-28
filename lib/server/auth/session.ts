/**
 * Session 服务：在 `isLocal()` 走进程内 Map，`isCloud()` 走 KV REST API。
 *
 * Session payload 形状极简：`{ userId, expiresAt }`。30 天有效期（PRD D3）。
 *
 * 注意：
 * - sessionId 用 `crypto.randomUUID()`，36 字符 + 4 dash，足够防猜测
 * - 进程内 Map 重启即丢，但 STORAGE_MODE=local 是本地开发用，可接受
 * - cloud 模式 KV PUT 自带 expiration_ttl，KV 边缘自动过期；
 *   `getSession` 仍二次校验 `expiresAt`，防止时钟漂移和 KV 缓存层未及时清理
 */

import { randomUUID } from 'node:crypto'

import { kvDelete, kvGet, kvPut } from '@/lib/server/cloudflare'
import { isLocal, isOss } from '@/lib/server/storage-mode'

export interface SessionRecord {
  userId: string
  expiresAt: number
}

export interface CreatedSession extends SessionRecord {
  sessionId: string
}

/** 30 天，单位秒（同步给 KV TTL 与 cookie maxAge 使用） */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

const LOCAL_SESSIONS = new Map<string, SessionRecord>()

function makeSessionId(): string {
  return `sess_${randomUUID()}`
}

export async function createSession(userId: string): Promise<CreatedSession> {
  if (!userId) throw new Error('createSession: userId 不能为空')
  const sessionId = makeSessionId()
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000
  const record: SessionRecord = { userId, expiresAt }

  if (isLocal() || isOss()) {
    LOCAL_SESSIONS.set(sessionId, record)
  } else {
    await kvPut(sessionId, JSON.stringify(record), SESSION_TTL_SECONDS)
  }

  return { sessionId, ...record }
}

export async function getSession(
  sessionId: string,
): Promise<SessionRecord | null> {
  if (!sessionId) return null

  if (isLocal() || isOss()) {
    const record = LOCAL_SESSIONS.get(sessionId)
    if (!record) return null
    if (record.expiresAt <= Date.now()) {
      LOCAL_SESSIONS.delete(sessionId)
      return null
    }
    return record
  }

  const raw = await kvGet(sessionId)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SessionRecord>
    if (!parsed.userId || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt <= Date.now()) {
      // 提前过期但 KV 还没清，主动删一次（不阻塞主流程）
      void kvDelete(sessionId).catch(() => {})
      return null
    }
    return { userId: parsed.userId, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

export async function destroySession(sessionId: string): Promise<void> {
  if (!sessionId) return
  if (isLocal() || isOss()) {
    LOCAL_SESSIONS.delete(sessionId)
    return
  }
  await kvDelete(sessionId)
}
