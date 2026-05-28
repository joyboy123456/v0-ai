/**
 * 用户仓储层：按 STORAGE_MODE 切换 local / cloud。
 *
 * - `isLocal()` 路径返回一个内置 mock user（仅 user01），方便无网开发。
 *   user02-05 在 cloud 模式下由 D1 提供，本地开发只需 user01 已足够（PRD §STORAGE_MODE 注释）。
 * - `isCloud()` 路径调用 D1 REST API，SELECT users 表并 mapping 成 `User`。
 *
 * 注意：DB 列为 snake_case（password_hash / display_name / created_at），
 * 由本模块统一翻译成 camelCase 接口，避免业务层散落处理。
 */

import bcrypt from 'bcryptjs'

import { executeD1Query } from '@/lib/server/cloudflare'
import { isLocal, isOss } from '@/lib/server/storage-mode'
import type { User } from '@/lib/types'

interface UserRow {
  id: string
  username: string
  password_hash: string
  display_name: string | null
  created_at: number
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name ?? null,
    createdAt: Number(row.created_at) || 0,
  }
}

/**
 * 本地 mock：只内置 user01 / shixue123。
 *
 * 用 `bcrypt.hashSync` 在模块加载时生成 hash，确保启动后内存里有一份现成的；
 * 重启进程会重新 hash 一次，password 不会泄露。
 *
 * 注意：进程内 Map 不能跨进程共享，middleware 跑在 Edge runtime 看不见本 Map，
 * 这是 PR2 已知 trade-off（见任务说明）。
 */
const LOCAL_USERS: Map<string, User> = (() => {
  const map = new Map<string, User>()
  const passwordHash = bcrypt.hashSync('shixue123', 10)
  const user01: User = {
    id: 'usr_local_user01',
    username: 'user01',
    passwordHash,
    displayName: '本地测试账号 01',
    createdAt: Date.now(),
  }
  map.set(user01.username, user01)
  return map
})()

export async function findUserByUsername(
  username: string,
): Promise<User | null> {
  const normalized = username.trim().toLowerCase()
  if (!normalized) return null

  if (isLocal() || isOss()) {
    return LOCAL_USERS.get(normalized) ?? null
  }

  const { results } = await executeD1Query<UserRow>(
    'SELECT id, username, password_hash, display_name, created_at FROM users WHERE username = ? LIMIT 1',
    [normalized],
  )
  const row = results[0]
  return row ? rowToUser(row) : null
}

export async function findUserById(userId: string): Promise<User | null> {
  if (!userId) return null

  if (isLocal() || isOss()) {
    for (const user of LOCAL_USERS.values()) {
      if (user.id === userId) return user
    }
    return null
  }

  const { results } = await executeD1Query<UserRow>(
    'SELECT id, username, password_hash, display_name, created_at FROM users WHERE id = ? LIMIT 1',
    [userId],
  )
  const row = results[0]
  return row ? rowToUser(row) : null
}
