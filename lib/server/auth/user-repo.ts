/**
 * 用户仓储层：按 STORAGE_MODE 切换 local / oss。
 *
 * - local/oss 模式：返回一个内置 mock user（仅 user01），方便开发。
 */

import bcrypt from 'bcryptjs'

import { isLocal, isOss } from '@/lib/server/storage-mode'
import type { User } from '@/lib/types'

/**
 * 本地 mock：只内置 user01 / shixue123。
 *
 * 用 `bcrypt.hashSync` 在模块加载时生成 hash，确保启动后内存里有一份现成的；
 * 重启进程会重新 hash 一次，password 不会泄露。
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

  // cloud 模式已移除
  return null
}

export async function findUserById(userId: string): Promise<User | null> {
  if (!userId) return null

  if (isLocal() || isOss()) {
    for (const user of LOCAL_USERS.values()) {
      if (user.id === userId) return user
    }
    return null
  }

  // cloud 模式已移除
  return null
}
