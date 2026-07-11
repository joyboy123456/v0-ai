/**
 * 用户仓储层：按 STORAGE_MODE 切换 local / oss。
 *
 * - local/oss 模式：返回配置的本地管理员账号。
 */

import bcrypt from 'bcryptjs'

import { readLocalSuperAdminUsername } from '@/lib/server/auth/local-auth-mode'
import { isLocal, isOss } from '@/lib/server/storage-mode'
import type { User } from '@/lib/types'

const DEV_LOCAL_ADMIN_PASSWORD = 'shixue123'

function readLocalAdminPassword(): string | null {
  const configured = process.env.LOCAL_ADMIN_PASSWORD
  if (configured) return configured

  if (process.env.NODE_ENV !== 'production') {
    return DEV_LOCAL_ADMIN_PASSWORD
  }

  console.error(
    '[auth/user-repo] LOCAL_ADMIN_PASSWORD 未配置，生产环境密码登录已禁用',
  )
  return null
}

const LOCAL_USERS: Map<string, User> = (() => {
  const map = new Map<string, User>()
  const password = readLocalAdminPassword()
  if (!password) return map

  const username = readLocalSuperAdminUsername()
  const passwordHash = bcrypt.hashSync(password, 10)
  const user01: User = {
    id: 'usr_local_user01',
    username,
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
