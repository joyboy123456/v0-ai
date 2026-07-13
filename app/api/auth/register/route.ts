import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  AuthError,
  registerWithPassword,
  SESSION_TTL_SECONDS,
} from '@/lib/server/auth'

export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'session_id'
const REGISTER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const REGISTER_RATE_LIMIT_MAX_ATTEMPTS = 10
const REGISTER_RATE_LIMIT_MAX_KEYS = 10_000

interface RegisterRateLimitEntry {
  attempts: number
  resetAt: number
}

const registerRateLimits = new Map<string, RegisterRateLimitEntry>()

function getClientIp(request: Request): string {
  const forwardedIp =
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]
  return forwardedIp?.trim().slice(0, 128) || 'unknown'
}

function getRetryAfterSeconds(key: string, now: number): number | null {
  const entry = registerRateLimits.get(key)
  if (!entry) return null
  if (entry.resetAt <= now) {
    registerRateLimits.delete(key)
    return null
  }
  if (entry.attempts < REGISTER_RATE_LIMIT_MAX_ATTEMPTS) return null
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
}

function recordRegistrationAttempt(key: string, now: number): void {
  const current = registerRateLimits.get(key)
  if (current && current.resetAt > now) {
    current.attempts += 1
    return
  }

  if (registerRateLimits.size >= REGISTER_RATE_LIMIT_MAX_KEYS) {
    for (const [entryKey, entry] of registerRateLimits) {
      if (entry.resetAt <= now) registerRateLimits.delete(entryKey)
    }
    if (registerRateLimits.size >= REGISTER_RATE_LIMIT_MAX_KEYS) {
      const oldestKey = registerRateLimits.keys().next().value
      if (oldestKey) registerRateLimits.delete(oldestKey)
    }
  }

  registerRateLimits.set(key, {
    attempts: 1,
    resetAt: now + REGISTER_RATE_LIMIT_WINDOW_MS,
  })
}

function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: 'TOO_MANY_ATTEMPTS',
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfterSeconds),
      },
    },
  )
}

function detectSecureCookie(request: Request): boolean {
  const explicit = process.env.COOKIE_SECURE?.trim().toLowerCase()
  if (explicit === 'true') return true
  if (explicit === 'false') return false

  const xfProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase()
  if (xfProto === 'https') return true
  if (xfProto === 'http') return false

  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return process.env.NODE_ENV === 'production'
  }
}

const bodySchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少需要 3 个字符')
    .max(32, '用户名最多 32 个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '用户名只能包含字母、数字、下划线和连字符'),
  password: z
    .string()
    .min(6, '密码至少需要 6 个字符')
    .max(128, '密码最多 128 个字符'),
  displayName: z.string().max(64, '昵称最多 64 个字符').optional(),
  inviteCode: z
    .string()
    .min(4, '请填写邀请码')
    .max(64, '邀请码格式不正确'),
})

export async function POST(request: Request) {
  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY', message: '请求内容格式不正确' },
      { status: 400 },
    )
  }

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const inviteIssue = parsed.error.issues.find((item) =>
      item.path.includes('inviteCode'),
    )
    return NextResponse.json(
      {
        ok: false,
        error: inviteIssue ? 'INVALID_INVITE_CODE' : 'INVALID_BODY',
        message:
          inviteIssue?.message ??
          issue?.message ??
          '用户名、密码或邀请码格式不正确',
      },
      { status: 400 },
    )
  }

  const rateLimitKey = getClientIp(request)
  const now = Date.now()
  const retryAfterSeconds = getRetryAfterSeconds(rateLimitKey, now)
  if (retryAfterSeconds !== null) {
    return rateLimitedResponse(retryAfterSeconds)
  }
  recordRegistrationAttempt(rateLimitKey, now)

  try {
    const { sessionId, user } = await registerWithPassword(
      parsed.data.username,
      parsed.data.password,
      parsed.data.displayName,
      parsed.data.inviteCode,
    )
    const response = NextResponse.json({ ok: true, user })
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionId,
      httpOnly: true,
      sameSite: 'lax',
      secure: detectSecureCookie(request),
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    return response
  } catch (error) {
    if (error instanceof AuthError && error.code === 'USERNAME_TAKEN') {
      return NextResponse.json(
        { ok: false, error: 'USERNAME_TAKEN' },
        { status: 409 },
      )
    }
    if (
      error instanceof AuthError &&
      (error.code === 'INVALID_INVITE_CODE' ||
        error.code === 'INVITE_CODE_USED' ||
        error.code === 'INVITE_CODE_EXPIRED')
    ) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: 400 },
      )
    }
    if (error instanceof AuthError && error.code === 'INVALID_CREDENTIALS') {
      return NextResponse.json(
        { ok: false, error: 'INVALID_BODY' },
        { status: 400 },
      )
    }
    console.error('[auth/register] unexpected error:', error)
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
