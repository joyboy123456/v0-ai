import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { jsonErrorResponse } from '@/lib/server/api-error-response'
import {
  getTask,
  retryGarmentDetailShots,
  retryPhotoFissionShots,
} from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    taskId: string
  }>
}

export const runtime = 'nodejs'

/**
 * POST /api/tasks/:taskId/retry-shots
 * Body: { shotIds: string[] }
 *
 * 重跑 photo-fission 任务中失败的镜头 / garment-detail 任务中失败的细节图。
 * 仅 partial/failed 状态可用，复用原 inputAssetIds 与 shotPlan/detailShots，
 * 流式持久化合并回原 task（PRD §14）。
 *
 * PR4：加 userId 鉴权 + ownership 校验（task-store 内部按「任务不存在」处理越权）。
 * garment-detail：按 task.featureType 分流到 retryGarmentDetailShots，
 * 越权/不存在仍统一 404 语义（getTask 按 userId 过滤后返回 undefined）。
 */
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

  const shotIdsRaw = (body as { shotIds?: unknown }).shotIds
  if (!Array.isArray(shotIdsRaw) || !shotIdsRaw.length) {
    return NextResponse.json({ error: '请传入要重跑的 shotIds 数组' }, { status: 400 })
  }

  const shotIds = shotIdsRaw.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
  if (!shotIds.length) {
    return NextResponse.json({ error: 'shotIds 不能为空' }, { status: 400 })
  }

  // 分流前先取 featureType；getTask 带 userId 过滤，越权返回 undefined → 404。
  const existing = await getTask(taskId, { userId })
  if (!existing) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }

  try {
    const task =
      existing.featureType === 'garment-detail'
        ? await retryGarmentDetailShots(taskId, shotIds, userId)
        : await retryPhotoFissionShots(taskId, shotIds, userId)
    return NextResponse.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    // 任务不存在 / 状态不允许 / 镜头无效统一 400；上游 API 调用错误也归 400 让前端展示
    const status =
      message.includes('任务不存在') || message.includes('丢失') ? 404 : 400
    return jsonErrorResponse(error, status)
  }
}
