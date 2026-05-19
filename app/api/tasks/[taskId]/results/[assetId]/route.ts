import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { deleteResultFromTask } from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    taskId: string
    assetId: string
  }>
}

export const runtime = 'nodejs'

/**
 * 删除某个 task 下的单张生成结果。
 *
 * 用于 AI 服装大片瀑布流（右侧「案例库」Tab）里点垃圾桶删除「效果不好」的图。
 * 实际行为：从 task 中摘掉这张图；如果 task 删空了，整个 task 一起删。
 * 物理文件 best-effort 删除。
 *
 * 401：未登录
 * 404：task 不存在 / 不属于当前 user / 该 task 上没有这个 assetId
 * 200：删除成功 → { success: true }
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  const { taskId, assetId } = await context.params

  const ok = await deleteResultFromTask(taskId, assetId, userId)
  if (!ok) {
    return NextResponse.json(
      { error: '未找到对应的生成结果' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true })
}
