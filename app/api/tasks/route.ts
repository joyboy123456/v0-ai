import { NextResponse } from 'next/server'
import { createTask, listTasks } from '@/lib/server/task-store'
import { FEATURES, type FeatureType, type TaskParams } from '@/lib/types'

interface CreateTaskBody {
  featureType?: string
  inputAssetIds?: string[]
  params?: TaskParams
}

const featureIds = new Set<FeatureType>(FEATURES.map((feature) => feature.id))

export async function GET() {
  return NextResponse.json({
    tasks: await listTasks(),
  })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateTaskBody

    if (!body.featureType || !body.inputAssetIds?.length || !body.params) {
      return NextResponse.json(
        { error: '缺少 featureType、inputAssetIds 或 params' },
        { status: 400 },
      )
    }

    if (!featureIds.has(body.featureType as FeatureType)) {
      return NextResponse.json({ error: '不支持的功能类型' }, { status: 400 })
    }

    const task = await createTask({
      featureType: body.featureType as FeatureType,
      inputAssetIds: body.inputAssetIds,
      params: body.params,
    })

    return NextResponse.json({
      taskId: task.taskId,
      status: task.status,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 400 },
    )
  }
}
