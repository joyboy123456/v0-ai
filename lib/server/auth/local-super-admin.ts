import {
  isLocalSuperAdminEnabled,
  readLocalSuperAdminUsername,
} from '@/lib/server/auth/local-auth-mode'
import type { User } from '@/lib/types'

import { findUserByUsername } from './user-repo'

export async function getLocalSuperAdminUser(): Promise<User | null> {
  if (!isLocalSuperAdminEnabled()) return null
  return findUserByUsername(readLocalSuperAdminUsername())
}
