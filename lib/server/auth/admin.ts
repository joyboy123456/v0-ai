import { readLocalSuperAdminUsername } from '@/lib/server/auth/local-auth-mode'
import type { User } from '@/lib/types'

/**
 * 管理员判定：默认本地超管用户名（user01），可用 AUTH_ADMIN_USERNAMES 追加。
 * 例：AUTH_ADMIN_USERNAMES=user01,ops_admin
 */
export function readAdminUsernames(): Set<string> {
  const names = new Set<string>([readLocalSuperAdminUsername()])
  const raw = process.env.AUTH_ADMIN_USERNAMES?.trim()
  if (!raw) return names
  for (const part of raw.split(',')) {
    const normalized = part.trim().toLowerCase()
    if (normalized) names.add(normalized)
  }
  return names
}

export function isAdminUsername(username: string | null | undefined): boolean {
  if (!username) return false
  return readAdminUsernames().has(username.trim().toLowerCase())
}

export function isAdminUser(user: Pick<User, 'username'> | null | undefined): boolean {
  return isAdminUsername(user?.username)
}
