import { isLocal, isOss } from '@/lib/server/storage-mode'

export type LocalAuthMode = 'super-admin' | 'password'

const DEFAULT_LOCAL_SUPER_ADMIN_USERNAME = 'user01'

export function readLocalAuthMode(): LocalAuthMode {
  if (!(isLocal() || isOss())) return 'password'
  const raw = process.env.LOCAL_AUTH_MODE?.trim().toLowerCase()
  return raw === 'password' ? 'password' : 'super-admin'
}

export function isLocalSuperAdminEnabled(): boolean {
  return readLocalAuthMode() === 'super-admin'
}

export function readLocalSuperAdminUsername(): string {
  return (
    process.env.LOCAL_SUPER_ADMIN_USERNAME?.trim().toLowerCase() ||
    DEFAULT_LOCAL_SUPER_ADMIN_USERNAME
  )
}
