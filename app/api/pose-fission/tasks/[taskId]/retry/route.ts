import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { jsonErrorResponse } from '@/lib/server/api-error-response'
import { retryPoseFissionShots } from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    taskId: string
  }>
}

export const runtime = 'nodejs'

/**
 * POST /api/pose-fission/tasks/:taskId/retry
 * Body: { templateIds: string[] }
 *
 * 重跑 pose-fission 任务中失败的姿势。仅 partial/failed 状态可用，
 * 复用原 inputAssetIds 与 poseTemplateSnapshots，流式持久化合并回原 task。
 *
 * 与 photo-fission 的 /api/tasks/:taskId/retry-shots 形态保持一致：
 * 区别仅在路由前缀（按 feature 分组）和 body 字段名（templateIds vs shotIds）。
 *
 * PR4：加 userId 鉴权 + ownership 校验。
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

  const templateIdsRaw = (body as { templateIds?: unknown }).templateIds
  if (!Array.isArray(templateIdsRaw) || !templateIdsRaw.length) {
    return NextResponse.json(
      { error: '请传入要重跑的 templateIds 数组' },
      { status: 400 },
    )
  }

  const templateIds = templateIdsRaw.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
  if (!templateIds.length) {
    return NextResponse.json({ error: 'templateIds 不能为空' }, { status: 400 })
  }

  try {
    const task = await retryPoseFissionShots(taskId, templateIds, userId)
    return NextResponse.json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    // 任务不存在 / 状态不允许 / 姿势无效统一 400；上游 API 调用错误也归 400 让前端展示
    const status =
      message.includes('任务不存在') || message.includes('丢失') ? 404 : 400
    return jsonErrorResponse(error, status)
  }
}
