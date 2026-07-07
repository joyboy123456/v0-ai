import { NextResponse, type NextRequest } from 'next/server'
import { jsonErrorResponse } from '@/lib/server/api-error-response'
import { requireUser } from '@/lib/server/auth/require-user'
import { addPose, listPoses } from '@/lib/server/saved-pose-store'
import type { PoseBodyPart } from '@/lib/types'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  return NextResponse.json({ poses: await listPoses(userResult.userId) })
}

export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const assetId = readTrimmedString(body.assetId)
  const url = readTrimmedString(body.url)
  const name = readTrimmedString(body.name)
  const width = readPositiveNumber(body.width)
  const height = readPositiveNumber(body.height)
  const bodyPart = readPoseBodyPart(body.bodyPart)

  if (!assetId || !url || !name || width === null || height === null) {
    return NextResponse.json({ error: '姿势参数无效' }, { status: 400 })
  }

  try {
    const pose = await addPose(userId, {
      assetId,
      url,
      name,
      width,
      height,
      bodyPart,
    })
    return NextResponse.json(pose, { status: 201 })
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

function readPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

function readPoseBodyPart(value: unknown): PoseBodyPart {
  if (value === 'upper' || value === 'lower') {
    return value
  }
  return 'full'
}
