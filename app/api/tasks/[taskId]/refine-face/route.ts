import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { refinePhotoFissionFace } from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    taskId: string
  }>
}

export const runtime = 'nodejs'

export async function POST(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  const { taskId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const assetId =
    typeof (body as { assetId?: unknown }).assetId === 'string'
      ? (body as { assetId: string }).assetId.trim()
      : ''
  const maskAssetId =
    typeof (body as { maskAssetId?: unknown }).maskAssetId === 'string'
      ? (body as { maskAssetId: string }).maskAssetId.trim()
      : ''

  if (!assetId || !maskAssetId) {
    return NextResponse.json(
      { error: '请传入要重修的 assetId 和 maskAssetId' },
      { status: 400 },
    )
  }

  try {
    const task = await refinePhotoFissionFace(taskId, assetId, maskAssetId, userId)
    return NextResponse.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    const status = message.includes('任务不存在') ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
