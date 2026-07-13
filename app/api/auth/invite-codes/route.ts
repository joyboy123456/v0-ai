import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import {
  AuthError,
  createInviteCodesForAdmin,
  listInviteCodesForAdmin,
} from '@/lib/server/auth'
import { requireUser } from '@/lib/server/auth/require-user'

export const runtime = 'nodejs'

const createSchema = z.object({
  count: z.number().int().min(1).max(20).optional(),
  expiresInDays: z.number().int().min(0).max(365).nullable().optional(),
})

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  try {
    const codes = await listInviteCodesForAdmin(userResult.user)
    return NextResponse.json({ ok: true, codes })
  } catch (error) {
    if (error instanceof AuthError && error.code === 'FORBIDDEN') {
      return NextResponse.json(
        { ok: false, error: 'FORBIDDEN', message: error.message },
        { status: 403 },
      )
    }
    console.error('[auth/invite-codes] list failed:', error)
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  let parsed
  try {
    const body = await request.json().catch(() => ({}))
    parsed = createSchema.safeParse(body)
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY' },
      { status: 400 },
    )
  }

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INVALID_BODY',
        message: parsed.error.issues[0]?.message ?? '参数不正确',
      },
      { status: 400 },
    )
  }

  try {
    const codes = await createInviteCodesForAdmin(userResult.user, {
      count: parsed.data.count,
      expiresInDays: parsed.data.expiresInDays,
    })
    return NextResponse.json({ ok: true, codes })
  } catch (error) {
    if (error instanceof AuthError && error.code === 'FORBIDDEN') {
      return NextResponse.json(
        { ok: false, error: 'FORBIDDEN', message: error.message },
        { status: 403 },
      )
    }
    console.error('[auth/invite-codes] create failed:', error)
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
