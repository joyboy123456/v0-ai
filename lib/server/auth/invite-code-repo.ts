/**
 * 邀请码仓储：持久化到 data/invite-codes.json（与 users.json 同风格）。
 */

import { randomBytes } from 'node:crypto'
import path from 'node:path'

import {
  loadJsonFileWithRecovery,
  writeJsonFileAtomic,
} from '@/lib/server/json-file-store'

export interface InviteCode {
  code: string
  createdAt: number
  createdByUserId: string
  expiresAt: number | null
  usedAt: number | null
  usedByUserId: string | null
}

export type InviteCodeErrorCode =
  | 'INVALID_INVITE_CODE'
  | 'INVITE_CODE_USED'
  | 'INVITE_CODE_EXPIRED'

export class InviteCodeError extends Error {
  code: InviteCodeErrorCode

  constructor(code: InviteCodeErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'InviteCodeError'
    this.code = code
  }
}

const DEFAULT_EXPIRES_IN_DAYS = 7
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const inviteCodesFilePath = path.join(process.cwd(), 'data', 'invite-codes.json')

const globalForInviteCodes = globalThis as typeof globalThis & {
  __yibaiInviteCodes?: Map<string, InviteCode>
  __yibaiInviteCodesLoaded?: Promise<void>
  __yibaiInviteCodesChain?: Promise<unknown>
}

const INVITE_CODES =
  globalForInviteCodes.__yibaiInviteCodes ?? new Map<string, InviteCode>()
globalForInviteCodes.__yibaiInviteCodes = INVITE_CODES

function parseInviteCodes(value: unknown): InviteCode[] {
  if (!Array.isArray(value)) {
    throw new Error('invite-codes.json must contain an array')
  }
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as InviteCode).code !== 'string' ||
      typeof (item as InviteCode).createdAt !== 'number' ||
      typeof (item as InviteCode).createdByUserId !== 'string' ||
      ((item as InviteCode).expiresAt !== null &&
        typeof (item as InviteCode).expiresAt !== 'number') ||
      ((item as InviteCode).usedAt !== null &&
        typeof (item as InviteCode).usedAt !== 'number') ||
      ((item as InviteCode).usedByUserId !== null &&
        typeof (item as InviteCode).usedByUserId !== 'string')
    ) {
      throw new Error('invite-codes.json contains an invalid invite code')
    }
    return item as InviteCode
  })
}

async function loadInviteCodes(): Promise<void> {
  const codes = await loadJsonFileWithRecovery({
    filePath: inviteCodesFilePath,
    label: 'auth/invite-codes',
    parse: parseInviteCodes,
  })
  if (!codes) return
  for (const code of codes) {
    INVITE_CODES.set(normalizeInviteCode(code.code), {
      ...code,
      code: normalizeInviteCode(code.code),
    })
  }
}

function ensureInviteCodesLoaded(): Promise<void> {
  if (!globalForInviteCodes.__yibaiInviteCodesLoaded) {
    globalForInviteCodes.__yibaiInviteCodesLoaded = loadInviteCodes()
  }
  return globalForInviteCodes.__yibaiInviteCodesLoaded
}

async function persistInviteCodes(): Promise<void> {
  await writeJsonFileAtomic(
    inviteCodesFilePath,
    Array.from(INVITE_CODES.values()).sort((a, b) => b.createdAt - a.createdAt),
    'auth/invite-codes',
  )
}

function withInviteCodesLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalForInviteCodes.__yibaiInviteCodesChain ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(fn)
  globalForInviteCodes.__yibaiInviteCodesChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, '')
}

export function formatInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code)
  if (normalized.length === 8) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
  }
  return normalized
}

function generateRawInviteCode(): string {
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return code
}

function assertInviteUsable(invite: InviteCode | undefined, now: number): InviteCode {
  if (!invite) {
    throw new InviteCodeError('INVALID_INVITE_CODE', '邀请码无效')
  }
  if (invite.usedAt !== null || invite.usedByUserId !== null) {
    throw new InviteCodeError('INVITE_CODE_USED', '邀请码已被使用')
  }
  if (invite.expiresAt !== null && invite.expiresAt <= now) {
    throw new InviteCodeError('INVITE_CODE_EXPIRED', '邀请码已过期')
  }
  return invite
}

export async function createInviteCodes({
  createdByUserId,
  count = 1,
  expiresInDays = DEFAULT_EXPIRES_IN_DAYS,
}: {
  createdByUserId: string
  count?: number
  expiresInDays?: number | null
}): Promise<InviteCode[]> {
  const safeCount = Math.min(20, Math.max(1, Math.floor(count)))
  const now = Date.now()
  const expiresAt =
    expiresInDays === null || expiresInDays === undefined
      ? now + DEFAULT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
      : expiresInDays <= 0
        ? null
        : now + expiresInDays * 24 * 60 * 60 * 1000

  return withInviteCodesLock(async () => {
    await ensureInviteCodesLoaded()
    const created: InviteCode[] = []
    for (let i = 0; i < safeCount; i++) {
      let code = generateRawInviteCode()
      while (INVITE_CODES.has(code)) {
        code = generateRawInviteCode()
      }
      const invite: InviteCode = {
        code,
        createdAt: now,
        createdByUserId,
        expiresAt,
        usedAt: null,
        usedByUserId: null,
      }
      INVITE_CODES.set(code, invite)
      created.push(invite)
    }
    await persistInviteCodes()
    return created
  })
}

export async function listInviteCodes(): Promise<InviteCode[]> {
  await ensureInviteCodesLoaded()
  return Array.from(INVITE_CODES.values()).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 预占邀请码（注册流程第一步）。建号成功后调用 finalize；失败则 restore。
 */
export async function reserveInviteCode(rawCode: string): Promise<InviteCode> {
  const code = normalizeInviteCode(rawCode)
  if (!code) {
    throw new InviteCodeError('INVALID_INVITE_CODE', '邀请码不能为空')
  }

  return withInviteCodesLock(async () => {
    await ensureInviteCodesLoaded()
    const now = Date.now()
    const invite = assertInviteUsable(INVITE_CODES.get(code), now)
    const reserved: InviteCode = {
      ...invite,
      usedAt: now,
      usedByUserId: 'pending',
    }
    INVITE_CODES.set(code, reserved)
    await persistInviteCodes()
    return reserved
  })
}

export async function finalizeInviteCode(
  rawCode: string,
  usedByUserId: string,
): Promise<void> {
  const code = normalizeInviteCode(rawCode)
  if (!code || !usedByUserId) return

  await withInviteCodesLock(async () => {
    await ensureInviteCodesLoaded()
    const invite = INVITE_CODES.get(code)
    if (!invite) return
    INVITE_CODES.set(code, {
      ...invite,
      usedAt: invite.usedAt ?? Date.now(),
      usedByUserId,
    })
    await persistInviteCodes()
  })
}

export async function restoreInviteCode(rawCode: string): Promise<void> {
  const code = normalizeInviteCode(rawCode)
  if (!code) return

  await withInviteCodesLock(async () => {
    await ensureInviteCodesLoaded()
    const invite = INVITE_CODES.get(code)
    if (!invite) return
    if (invite.usedByUserId && invite.usedByUserId !== 'pending') return
    INVITE_CODES.set(code, {
      ...invite,
      usedAt: null,
      usedByUserId: null,
    })
    await persistInviteCodes()
  })
}

export { DEFAULT_EXPIRES_IN_DAYS }
