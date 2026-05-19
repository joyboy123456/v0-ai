import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { AuthError, getCurrentUser } from '@/lib/server/auth'

export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'session_id'

export async function GET() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const user = await getCurrentUser(sessionId)
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }
    return NextResponse.json({ ok: true, user })
  } catch (error) {
    if (error instanceof AuthError && error.code === 'CONFIG_ERROR') {
      return NextResponse.json(
        { ok: false, error: 'CONFIG_ERROR', message: error.message },
        { status: 500 },
      )
    }
    // eslint-disable-next-line no-console
    console.error('[auth/me] unexpected error:', error)
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
