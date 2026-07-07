import { NextResponse, type NextRequest } from 'next/server'
import { jsonErrorResponse } from '@/lib/server/api-error-response'
import { requireUser } from '@/lib/server/auth/require-user'
import {
  deletePose,
  renamePose,
} from '@/lib/server/saved-pose-store'

interface RouteContext {
  params: Promise<{
    poseId: string
  }>
}

export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult
  const { poseId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const name = readTrimmedString(body.name)
  if (!name) {
    return NextResponse.json({ error: '姿势名称不能为空' }, { status: 400 })
  }

  try {
    const ok = await renamePose(userId, poseId, name)
    if (!ok) {
      return NextResponse.json({ error: '姿势不存在' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonErrorResponse(error, 400)
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult
  const { poseId } = await context.params

  try {
    const ok = await deletePose(userId, poseId)
    if (!ok) {
      return NextResponse.json({ error: '姿势不存在' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonErrorResponse(error, 400)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
