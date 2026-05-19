/**
 * 业务 API 统一鉴权入口：从 `NextRequest` 解出当前 userId。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR4 引入。
 *
 * 设计要点（参考任务说明 §1）：
 * 1. 优先读 middleware 注入的 `x-user-id` header（cloud 模式 middleware
 *    已校验过 session 并写入），无需再调 KV/D1。
 * 2. 否则 fallback 到 cookie `session_id` → `getCurrentUser()` → `findUserById()`。
 * 3. **local 模式**：若上述两路都拿不到 userId，**fallback 到 user01**
 *    （本地 mock 默认用户）。原因：local 模式 middleware 在 Edge runtime
 *    放行（PR2 已知 trade-off），且 in-memory session 跨进程不通；如果不
 *    fallback，本地启动后 API 全部 401，开发体验崩溃。同时打 `console.warn`
 *    提醒开发者，避免线上误把 cloud 模式当 local 跑。
 * 4. **cloud 模式**：严格 null。让调用方返回 401。
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

import { findUserById } from '@/lib/server/auth/user-repo'
import { getSession } from '@/lib/server/auth/session'
import { isLocal } from '@/lib/server/storage-mode'
import type { User } from '@/lib/types'

const SESSION_COOKIE_NAME = 'session_id'
const LOCAL_FALLBACK_USERNAME = 'user01'
const LOCAL_FALLBACK_USER_ID = 'usr_local_user01'

let localFallbackWarned = false

export interface RequestUser {
  userId: string
  user: User
}

/**
 * 拿到当前请求对应的 user，拿不到返回 null（调用方应回 401）。
 *
 * 解析顺序：
 * 1. middleware 注入的 `x-user-id` header
 * 2. cookie session_id → getSession → findUserById
 * 3. local 模式兜底：返回 user01
 * 4. cloud 模式兜底：返回 null
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

  // 2. fallback：从 cookie session_id 反查
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
      // session/D1 不可达：cloud 模式严格 null，local 模式继续往下走 fallback
    }
  }

  // 3. local 模式兜底：返回 user01
  if (isLocal()) {
    const user = await findUserById(LOCAL_FALLBACK_USER_ID)
    if (user) {
      if (!localFallbackWarned) {
        console.warn(
          `[auth] local-mode anonymous fallback to ${LOCAL_FALLBACK_USERNAME}`,
        )
        localFallbackWarned = true
      }
      return { userId: user.id, user }
    }
  }

  // 4. cloud 模式：严格 null
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
