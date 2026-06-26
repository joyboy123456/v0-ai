import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { cancelTask } from '@/lib/server/task-store'

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

  try {
    const { taskId } = await context.params
    const task = await cancelTask(taskId, userId)
    return NextResponse.json(task)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取消任务失败' },
      { status: 400 },
    )
  }
}
