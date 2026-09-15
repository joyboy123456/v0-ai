import { NextResponse, type NextRequest } from 'next/server'
import { jsonErrorResponse } from '@/lib/server/api-error-response'
import { requireUser } from '@/lib/server/auth/require-user'
import {
  deleteModel,
  hasModelInAnyLibrary,
  renameModel,
  type ModelLibrary,
} from '@/lib/server/company-model-store'
import { deleteAssetWithFile } from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    assetId: string
  }>
}

export const runtime = 'nodejs'

/**
 * PATCH /api/models/[assetId]
 * Body: { library: 'company'|'faceId', name }
 * 重命名指定库中的模特。
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult
  const { assetId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const library = readLibrary(body.library)
  const name = readTrimmedString(body.name)
  if (!library || !name) {
    return NextResponse.json({ error: '模特名称无效' }, { status: 400 })
  }

  try {
    const ok = await renameModel(userId, library, assetId, name)
    if (!ok) {
      return NextResponse.json({ error: '模特不存在' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonErrorResponse(error, 400)
  }
}

/**
 * DELETE /api/models/[assetId]?library=company|faceId
 *
 * 从指定库移除模特，并连带删除云端（OSS/local）图片文件——但有两道保护：
 * 1. 跨库保护：若该 assetId 仍在另一个库中（同一张图被两个库引用），保留文件；
 * 2. 引用保护（deleteAssetWithFile 内部）：若被历史生成任务引用，保留文件。
 * 无论是否删文件，列表项都会被移除。返回 fileDeleted / reason 供前端轻提示。
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult
  const { assetId } = await context.params

  const library = readLibrary(request.nextUrl.searchParams.get('library'))
  if (!library) {
    return NextResponse.json({ error: '缺少或非法的 library 参数' }, { status: 400 })
  }

  try {
    const removed = await deleteModel(userId, library, assetId)
    if (!removed) {
      return NextResponse.json({ error: '模特不存在' }, { status: 404 })
    }

    // 跨库保护：仍在另一库则不删物理文件。
    const stillInLibrary = await hasModelInAnyLibrary(userId, assetId)
    if (stillInLibrary) {
      return NextResponse.json({ ok: true, fileDeleted: false, reason: 'kept' })
    }

    const { fileDeleted, reason } = await deleteAssetWithFile(assetId, userId)
    return NextResponse.json({ ok: true, fileDeleted, reason })
  } catch (error) {
    return jsonErrorResponse(error, 400)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readLibrary(value: unknown): ModelLibrary | null {
  if (value === 'company' || value === 'faceId') return value
  return null
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
