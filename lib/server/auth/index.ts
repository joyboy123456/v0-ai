/**
 * 认证服务编排层：UI / API 路由都从这里调，不要直接 import user-repo / session。
 *
 * 错误统一通过 `AuthError`：
 *   - `INVALID_CREDENTIALS` 用户名或密码错误
 *   - `SESSION_EXPIRED` session 不存在或已过期
 *   - `CONFIG_ERROR` 后端配置缺失（cloud 模式 env 不全等）
 *
 * 用户响应里**禁止**包含 passwordHash。`toPublicUser` 是唯一允许暴露给前端
 * 的脱敏 shape。
 */

import bcrypt from 'bcryptjs'

import { CloudflareError } from '@/lib/server/cloudflare'
import type { User } from '@/lib/types'

import {
  createSession,
  destroySession,
  getSession,
  SESSION_TTL_SECONDS,
} from './session'
import { findUserById, findUserByUsername } from './user-repo'

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'SESSION_EXPIRED'
  | 'CONFIG_ERROR'

export class AuthError extends Error {
  code: AuthErrorCode

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'AuthError'
    this.code = code
  }
}

export interface PublicUser {
  id: string
  username: string
  displayName: string | null
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
  }
}

export interface LoginResult {
  sessionId: string
  expiresAt: number
  user: PublicUser
}

export async function loginWithPassword(
  username: string,
  password: string,
): Promise<LoginResult> {
  if (!username || !password) {
    throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不能为空')
  }

  let user: User | null
  try {
    user = await findUserByUsername(username)
  } catch (error) {
    if (error instanceof CloudflareError) {
      throw new AuthError('CONFIG_ERROR', error.message)
    }
    throw error
  }
  if (!user) {
    throw new AuthError('INVALID_CREDENTIALS')
  }

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) {
    throw new AuthError('INVALID_CREDENTIALS')
  }

  let session
  try {
    session = await createSession(user.id)
  } catch (error) {
    if (error instanceof CloudflareError) {
      throw new AuthError('CONFIG_ERROR', error.message)
    }
    throw error
  }

  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    user: toPublicUser(user),
  }
}

export async function logout(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return
  try {
    await destroySession(sessionId)
  } catch (error) {
    // logout 失败不应该卡住用户，但记录日志
    // eslint-disable-next-line no-console
    console.warn('[auth] destroySession failed:', error)
  }
}

/**
 * 拿当前登录用户。
 *
 * 5 人内测场景下用户名稳定，简单实现：
 * - 先 `getSession(sessionId)` 拿 userId
 * - 再 `findUserById(userId)` 拿当前 user 行
 * 这样用户名 / displayName 变更后第一次访问就能反映出来。
 */
export async function getCurrentUser(
  sessionId: string | null | undefined,
): Promise<PublicUser | null> {
  if (!sessionId) return null
  let session
  try {
    session = await getSession(sessionId)
  } catch (error) {
    if (error instanceof CloudflareError) {
      throw new AuthError('CONFIG_ERROR', error.message)
    }
    throw error
  }
  if (!session) return null

  let user
  try {
    user = await findUserById(session.userId)
  } catch (error) {
    if (error instanceof CloudflareError) {
      throw new AuthError('CONFIG_ERROR', error.message)
    }
    throw error
  }
  if (!user) return null
  return toPublicUser(user)
}

export { SESSION_TTL_SECONDS }
