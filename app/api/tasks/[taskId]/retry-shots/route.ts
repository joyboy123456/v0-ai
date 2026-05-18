import { NextResponse } from 'next/server'
import { retryPhotoFissionShots } from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    taskId: string
  }>
}

/**
 * POST /api/tasks/:taskId/retry-shots
 * Body: { shotIds: string[] }
 *
 * 重跑 photo-fission 任务中失败的镜头。仅 partial/failed 状态可用，
 * 复用原 inputAssetIds 与 shotPlan，流式持久化合并回原 task。
 */
export async function POST(request: Request, context: RouteContext) {
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

  try {
    const task = await retryPhotoFissionShots(taskId, shotIds)
    return NextResponse.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    // 任务不存在 / 状态不允许 / 镜头无效统一 400；上游 API 调用错误也归 400 让前端展示
    const status =
      message.includes('任务不存在') || message.includes('丢失') ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
