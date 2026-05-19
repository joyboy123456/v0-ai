import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  AuthError,
  loginWithPassword,
  SESSION_TTL_SECONDS,
} from '@/lib/server/auth'

export const runtime = 'nodejs'

// TODO(PR5): IP-based KV rate limit（防止暴力破解 5 个测试账号）。
// 5 人内测期可不做，但上线前要在 middleware 或本路由前加一层。

const SESSION_COOKIE_NAME = 'session_id'

const bodySchema = z.object({
  username: z.string().min(1, '用户名不能为空').max(64),
  password: z.string().min(1, '密码不能为空').max(128),
})

export async function POST(request: Request) {
  let parsed
  try {
    const json = await request.json()
    parsed = bodySchema.safeParse(json)
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY' },
      { status: 400 },
    )
  }

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY' },
      { status: 400 },
    )
  }

  const { username, password } = parsed.data
  try {
    const { sessionId, user } = await loginWithPassword(username, password)
    const response = NextResponse.json({ ok: true, user })

    const isProduction = process.env.NODE_ENV === 'production'
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionId,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    return response
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === 'INVALID_CREDENTIALS') {
        return NextResponse.json(
          { ok: false, error: 'INVALID_CREDENTIALS' },
          { status: 401 },
        )
      }
      if (error.code === 'CONFIG_ERROR') {
        return NextResponse.json(
          { ok: false, error: 'CONFIG_ERROR', message: error.message },
          { status: 500 },
        )
      }
    }
    // eslint-disable-next-line no-console
    console.error('[auth/login] unexpected error:', error)
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
