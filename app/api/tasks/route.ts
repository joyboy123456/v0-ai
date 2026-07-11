import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import {
  assertImageQueueCapacity,
  ImageQueueFullError,
} from '@/lib/server/image-work-scheduler'
import { createTask, listTasks } from '@/lib/server/task-store'
import { withTaskScheduling } from '@/lib/server/task-scheduling-view'
import { FEATURES, type FeatureType, type TaskParams } from '@/lib/types'

interface CreateTaskBody {
  featureType?: string
  inputAssetIds?: string[]
  params?: TaskParams
}

const featureIds = new Set<FeatureType>(FEATURES.map((feature) => feature.id))

function estimateTaskUnits(featureType: FeatureType, params: TaskParams): number {
  if (featureType === 'photo-fission') {
    const shotPlan = (params as { shotPlan?: unknown }).shotPlan
    if (Array.isArray(shotPlan) && shotPlan.length > 0) return shotPlan.length
  }

  if (featureType === 'pose-fission') {
    const poses = (params as { poses?: unknown }).poses
    if (Array.isArray(poses) && poses.length > 0) return poses.length
  }

  const count =
    'resultCount' in params
      ? params.resultCount
      : 'generateCount' in params
        ? params.generateCount
        : 1
  return typeof count === 'number' && count > 0 ? Math.floor(count) : 1
}

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  return NextResponse.json({
    tasks: (await listTasks({ userId })).map(withTaskScheduling),
  })
}

export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

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

    const featureType = body.featureType as FeatureType
    assertImageQueueCapacity(estimateTaskUnits(featureType, body.params))

    const task = await createTask({
      featureType,
      inputAssetIds: body.inputAssetIds,
      params: body.params,
      userId,
    })

    return NextResponse.json({
      taskId: task.taskId,
      status: task.status,
    })
  } catch (error) {
    if (error instanceof ImageQueueFullError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: error.status,
          headers: { 'Retry-After': String(error.retryAfterSeconds) },
        },
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 400 },
    )
  }
}
