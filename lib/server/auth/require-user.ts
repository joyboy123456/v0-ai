/**
 * 业务 API 统一鉴权入口：从 `NextRequest` 解出当前 userId。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR4 引入。
 *
 * 设计要点（参考任务说明 §1）：
 * 1. 优先读 middleware 注入的 `x-user-id` header（cloud 模式 middleware
 *    已校验过 session 并写入），无需再调 KV/D1。
 * 2. local super-admin 模式直接返回本地超管用户（仅 `STORAGE_MODE=local`）。
 * 3. 否则 fallback 到 cookie `session_id` → `getCurrentUser()` → `findUserById()`。
 * 4. 拿不到用户时严格返回 null。
 *
 * 使用示例：
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const userResult = await requireUser(request)
 *   if (userResult instanceof NextResponse) return userResult
 *   const { userId } = userResult
 *   // 后续业务用 userId
 * }
 * ```
 */

import { NextResponse, type NextRequest } from 'next/server'

import { getLocalSuperAdminUser } from '@/lib/server/auth/local-super-admin'
import { findUserById } from '@/lib/server/auth/user-repo'
import { getSession } from '@/lib/server/auth/session'
import type { User } from '@/lib/types'

const SESSION_COOKIE_NAME = 'session_id'

export interface RequestUser {
  userId: string
  user: User
}

/**
 * 拿到当前请求对应的 user，拿不到返回 null（调用方应回 401）。
 *
 * 解析顺序：
 * 1. middleware 注入的 `x-user-id` header
 * 2. local super-admin 模式 → 本地超管用户
 * 3. cookie session_id → getSession → findUserById
 * 4. 严格返回 null
 */
export async function getRequestUser(
  request: NextRequest,
): Promise<RequestUser | null> {
  // 1. 优先用 middleware 注入的 x-user-id（cloud 模式才会有；local 模式 middleware 不注入）
  const headerUserId = request.headers.get('x-user-id')
  if (headerUserId) {
    const user = await findUserById(headerUserId)
    if (user) {
      return { userId: user.id, user }
    }
  }

  // 2. local 内网演示：无需账号密码，统一按本地超管用户执行。
  const localSuperAdmin = await getLocalSuperAdminUser()
  if (localSuperAdmin) {
    return { userId: localSuperAdmin.id, user: localSuperAdmin }
  }

  // 3. fallback：从 cookie session_id 反查
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (sessionId) {
    try {
      const session = await getSession(sessionId)
      if (session) {
        const user = await findUserById(session.userId)
        if (user) {
          return { userId: user.id, user }
        }
      }
    } catch {
      // session/D1 不可达：严格返回 null，让调用方 401。
    }
  }

  return null
}

/**
 * 业务 API 用：拿不到 user 直接返回 401 NextResponse；拿到则返回 RequestUser。
 *
 * 调用模式：
 * ```ts
 * const userResult = await requireUser(request)
 * if (userResult instanceof NextResponse) return userResult
 * const { userId, user } = userResult
 * ```
 */
export async function requireUser(
  request: NextRequest,
): Promise<RequestUser | NextResponse> {
  const result = await getRequestUser(request)
  if (!result) {
    return NextResponse.json(
      { ok: false, error: 'UNAUTHORIZED' },
      { status: 401 },
    )
  }
  return result
}
