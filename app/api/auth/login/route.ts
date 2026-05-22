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

/**
 * 决定 session cookie 是否设置 Secure 标志。
 *
 * 浏览器规则：HTTP 站点会丢弃带 Secure 的 cookie。Mac mini 走 IP+HTTP 部署
 * 时如果固定 secure=true，客户登录后浏览器拿不到 cookie，会卡在「正在进入
 * 工作台 请稍候…」死循环（middleware 看不到 cookie 又踢回 /login）。
 *
 * 优先级（从高到低）：
 * 1. 显式环境变量 `COOKIE_SECURE=true|false`（HTTPS / IP 明文场景的硬开关）
 * 2. `X-Forwarded-Proto` header（VPS nginx 反代时由 nginx 注入）
 * 3. `request.url` 自身协议（直连 HTTPS 场景）
 * 4. 兜底回 `NODE_ENV === 'production'`（保守保护开发以外环境）
 */
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
