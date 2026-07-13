/**
 * 认证服务编排层：UI / API 路由都从这里调，不要直接 import user-repo / session。
 *
 * 错误统一通过 `AuthError`：
 *   - `INVALID_CREDENTIALS` 用户名或密码错误
 *   - `USERNAME_TAKEN` 用户名已被注册
 *   - `SESSION_EXPIRED` session 不存在或已过期
 *   - `INVALID_INVITE_CODE` / `INVITE_CODE_USED` / `INVITE_CODE_EXPIRED` 邀请码问题
 *   - `FORBIDDEN` 非管理员操作
 *
 * 用户响应里**禁止**包含 passwordHash。`toPublicUser` 是唯一允许暴露给前端
 * 的脱敏 shape。
 */

import bcrypt from 'bcryptjs'

import type { User } from '@/lib/types'

import { isAdminUsername } from './admin'
import {
  createInviteCodes,
  finalizeInviteCode,
  formatInviteCode,
  InviteCodeError,
  listInviteCodes,
  normalizeInviteCode,
  restoreInviteCode,
  reserveInviteCode,
  type InviteCode,
} from './invite-code-repo'
import {
  createSession,
  destroySession,
  getSession,
  SESSION_TTL_SECONDS,
} from './session'
import {
  createUser,
  findUserById,
  findUserByUsername,
  UserRepoError,
  usernameExists,
} from './user-repo'

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'USERNAME_TAKEN'
  | 'SESSION_EXPIRED'
  | 'INVALID_INVITE_CODE'
  | 'INVITE_CODE_USED'
  | 'INVITE_CODE_EXPIRED'
  | 'FORBIDDEN'

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
  isAdmin: boolean
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: isAdminUsername(user.username),
  }
}

export interface LoginResult {
  sessionId: string
  expiresAt: number
  user: PublicUser
}

export interface PublicInviteCode {
  code: string
  createdAt: number
  expiresAt: number | null
  usedAt: number | null
  usedByUserId: string | null
  status: 'available' | 'used' | 'expired' | 'pending'
}

function toPublicInviteCode(invite: InviteCode, now = Date.now()): PublicInviteCode {
  let status: PublicInviteCode['status'] = 'available'
  if (invite.usedByUserId === 'pending') status = 'pending'
  else if (invite.usedAt !== null || invite.usedByUserId !== null) status = 'used'
  else if (invite.expiresAt !== null && invite.expiresAt <= now) status = 'expired'

  return {
    code: formatInviteCode(invite.code),
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    usedAt: status === 'used' ? invite.usedAt : null,
    usedByUserId:
      status === 'used' && invite.usedByUserId ? invite.usedByUserId : null,
    status,
  }
}

function mapInviteError(error: InviteCodeError): AuthError {
  return new AuthError(error.code, error.message)
}

export async function loginWithPassword(
  username: string,
  password: string,
): Promise<LoginResult> {
  if (!username || !password) {
    throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不能为空')
  }

  const user = await findUserByUsername(username)
  if (!user) {
    throw new AuthError('INVALID_CREDENTIALS')
  }

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) {
    throw new AuthError('INVALID_CREDENTIALS')
  }

  const session = await createSession(user.id)

  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    user: toPublicUser(user),
  }
}

export async function registerWithPassword(
  username: string,
  password: string,
  displayName: string | undefined,
  inviteCode: string,
): Promise<LoginResult> {
  const normalizedUsername = username.trim().toLowerCase()
  if (!normalizedUsername || !password) {
    throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不能为空')
  }
  if (!normalizeInviteCode(inviteCode)) {
    throw new AuthError('INVALID_INVITE_CODE', '邀请码不能为空')
  }

  if (await usernameExists(normalizedUsername)) {
    throw new AuthError('USERNAME_TAKEN')
  }

  try {
    await reserveInviteCode(inviteCode)
  } catch (error) {
    if (error instanceof InviteCodeError) throw mapInviteError(error)
    throw error
  }

  let user: User
  try {
    user = await createUser({
      username: normalizedUsername,
      password,
      displayName,
    })
  } catch (error) {
    await restoreInviteCode(inviteCode).catch((restoreError) => {
      console.warn('[auth] restoreInviteCode failed:', restoreError)
    })
    if (error instanceof UserRepoError && error.code === 'USERNAME_TAKEN') {
      throw new AuthError('USERNAME_TAKEN')
    }
    throw error
  }

  try {
    await finalizeInviteCode(inviteCode, user.id)
  } catch (error) {
    console.warn('[auth] finalizeInviteCode failed:', error)
  }

  const session = await createSession(user.id)
  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    user: toPublicUser(user),
  }
}

export async function createInviteCodesForAdmin(
  adminUser: User,
  options?: { count?: number; expiresInDays?: number | null },
): Promise<PublicInviteCode[]> {
  if (!isAdminUsername(adminUser.username)) {
    throw new AuthError('FORBIDDEN', '仅管理员可生成邀请码')
  }
  const created = await createInviteCodes({
    createdByUserId: adminUser.id,
    count: options?.count,
    expiresInDays: options?.expiresInDays,
  })
  return created.map((code) => toPublicInviteCode(code))
}

export async function listInviteCodesForAdmin(
  adminUser: User,
): Promise<PublicInviteCode[]> {
  if (!isAdminUsername(adminUser.username)) {
    throw new AuthError('FORBIDDEN', '仅管理员可查看邀请码')
  }
  const codes = await listInviteCodes()
  return codes.map((code) => toPublicInviteCode(code))
}

export async function logout(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return
  try {
    await destroySession(sessionId)
  } catch (error) {
    // logout 失败不应该卡住用户，但记录日志
    console.warn('[auth] destroySession failed:', error)
  }
}

/**
 * 拿当前登录用户。
 *
 * 用户名稳定，简单实现：
 * - 先 `getSession(sessionId)` 拿 userId
 * - 再 `findUserById(userId)` 拿当前 user 行
 * 这样用户名 / displayName 变更后第一次访问就能反映出来。
 */
export async function getCurrentUser(
  sessionId: string | null | undefined,
): Promise<PublicUser | null> {
  if (!sessionId) return null

  const session = await getSession(sessionId)
  if (!session) return null

  const user = await findUserById(session.userId)
  if (!user) return null
  return toPublicUser(user)
}

export { SESSION_TTL_SECONDS, formatInviteCode, isAdminUsername }
