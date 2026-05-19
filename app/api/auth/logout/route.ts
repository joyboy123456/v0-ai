import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { logout } from '@/lib/server/auth'

export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'session_id'

export async function POST() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (sessionId) {
    await logout(sessionId)
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
