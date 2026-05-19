import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { getTask } from '@/lib/server/task-store'

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
  // PR4：getTask 透传 userId 做 ownership 校验
  const task = await getTask(taskId, { userId })

  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }

  return NextResponse.json({
    downloadUrl: task.results[0]?.downloadUrl ?? '',
  })
}
