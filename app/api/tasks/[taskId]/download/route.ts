import { NextResponse } from 'next/server'
import { getTask } from '@/lib/server/task-store'

interface RouteContext {
  params: Promise<{
    taskId: string
  }>
}

export async function POST(_request: Request, context: RouteContext) {
  const { taskId } = await context.params
  const task = await getTask(taskId)

  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }

  return NextResponse.json({
    downloadUrl: task.results[0]?.downloadUrl ?? '',
  })
}
