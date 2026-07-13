/**
 * 用户仓储层：按 STORAGE_MODE 切换 local / oss。
 *
 * - local/oss 模式：返回配置的本地管理员账号和持久化注册用户。
 */

import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { readLocalSuperAdminUsername } from '@/lib/server/auth/local-auth-mode'
import {
  loadJsonFileWithRecovery,
  writeJsonFileAtomic,
} from '@/lib/server/json-file-store'
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

export class UserRepoError extends Error {
  code: 'USERNAME_TAKEN'

  constructor(code: 'USERNAME_TAKEN') {
    super(code)
    this.name = 'UserRepoError'
    this.code = code
  }
}

const globalForUsers = globalThis as typeof globalThis & {
  __yibaiLocalUsers?: Map<string, User>
  __yibaiLocalUsersLoaded?: Promise<void>
}

const REGISTERED_USERS =
  globalForUsers.__yibaiLocalUsers ?? new Map<string, User>()
globalForUsers.__yibaiLocalUsers = REGISTERED_USERS

const usersFilePath = path.join(process.cwd(), 'data', 'users.json')

function parseUsers(value: unknown): User[] {
  if (!Array.isArray(value)) throw new Error('users.json must contain an array')
  return value.map((user) => {
    if (
      !user ||
      typeof user !== 'object' ||
      typeof (user as User).id !== 'string' ||
      typeof (user as User).username !== 'string' ||
      typeof (user as User).passwordHash !== 'string' ||
      (typeof (user as User).displayName !== 'string' &&
        (user as User).displayName !== null) ||
      typeof (user as User).createdAt !== 'number'
    ) {
      throw new Error('users.json contains an invalid user')
    }
    return user as User
  })
}

async function loadRegisteredUsers(): Promise<void> {
  const users = await loadJsonFileWithRecovery({
    filePath: usersFilePath,
    label: 'auth/users',
    parse: parseUsers,
  })
  if (!users) return
  for (const user of users) {
    REGISTERED_USERS.set(user.username.trim().toLowerCase(), user)
  }
}

function ensureRegisteredUsersLoaded(): Promise<void> {
  if (!globalForUsers.__yibaiLocalUsersLoaded) {
    globalForUsers.__yibaiLocalUsersLoaded = loadRegisteredUsers()
  }
  return globalForUsers.__yibaiLocalUsersLoaded
}

function isPasswordAuthAvailable(): boolean {
  return isLocal() || isOss()
}

export async function findUserByUsername(
  username: string,
): Promise<User | null> {
  const normalized = username.trim().toLowerCase()
  if (!normalized) return null

  if (!isPasswordAuthAvailable()) return null
  await ensureRegisteredUsersLoaded()

  return LOCAL_USERS.get(normalized) ?? REGISTERED_USERS.get(normalized) ?? null
}

export async function findUserById(userId: string): Promise<User | null> {
  if (!userId) return null

  if (!isPasswordAuthAvailable()) return null
  await ensureRegisteredUsersLoaded()

  for (const user of LOCAL_USERS.values()) {
    if (user.id === userId) return user
  }
  for (const user of REGISTERED_USERS.values()) {
    if (user.id === userId) return user
  }
  return null
}

export async function usernameExists(username: string): Promise<boolean> {
  return (await findUserByUsername(username)) !== null
}

export async function createUser({
  username,
  password,
  displayName,
}: {
  username: string
  password: string
  displayName?: string
}): Promise<User> {
  if (!isPasswordAuthAvailable()) {
    throw new Error('Password authentication is unavailable')
  }

  const normalized = username.trim().toLowerCase()
  await ensureRegisteredUsersLoaded()
  if (LOCAL_USERS.has(normalized) || REGISTERED_USERS.has(normalized)) {
    throw new UserRepoError('USERNAME_TAKEN')
  }

  const user: User = {
    id: `usr_${randomUUID()}`,
    username: normalized,
    passwordHash: bcrypt.hashSync(password, 10),
    displayName: displayName?.trim() || null,
    createdAt: Date.now(),
  }
  REGISTERED_USERS.set(normalized, user)
  await writeJsonFileAtomic(
    usersFilePath,
    Array.from(REGISTERED_USERS.values()),
    'auth/users',
  )
  return user
}
