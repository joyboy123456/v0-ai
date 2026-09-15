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

  if (featureType === 'garment-detail') {
    // 估算发生在 createTask 归一化之前，客户端可能伪造超大 resultCount；
    // garment-detail 单任务上限 3 个输出位，这里上限 4 防御（1 主图 + 3 参考图）。
    const detailShots = (params as { detailShots?: unknown }).detailShots
    const resultCount = (params as { resultCount?: unknown }).resultCount
    const raw =
      Array.isArray(detailShots) && detailShots.length > 0
        ? detailShots.length
        : typeof resultCount === 'number' && resultCount > 0
          ? Math.floor(resultCount)
          : 1
    return Math.min(raw, 4)
  }

  if (featureType === 'ai-fashion-photo') {
    // 估算发生在 createTask 归一化之前，客户端可能伪造超大 resultCount 占满队列；
    // 白名单只有 1/2/4，这里同样上限 4 防御，非法值降级 1（归一化阶段会再校验）。
    const resultCount = (params as { resultCount?: unknown }).resultCount
    if (typeof resultCount === 'number' && resultCount > 0) {
      return Math.min(Math.floor(resultCount), 4)
    }
    return 1
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

/** 历史任务分页：默认每页 20，上限 100。 */
const TASKS_PAGE_DEFAULT_LIMIT = 20
const TASKS_PAGE_MAX_LIMIT = 100

export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  // 分页 + 按功能过滤：历史任务可能有几千个，全量返回会导致首屏 JSON 十几 MB
  const { searchParams } = request.nextUrl
  const featureType = searchParams.get('featureType')
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0)
  const limit = Math.min(
    TASKS_PAGE_MAX_LIMIT,
    Math.max(
      1,
      parseInt(searchParams.get('limit') ?? String(TASKS_PAGE_DEFAULT_LIMIT), 10) ||
        TASKS_PAGE_DEFAULT_LIMIT,
    ),
  )

  let tasks = await listTasks({ userId })
  if (featureType && featureIds.has(featureType as FeatureType)) {
    tasks = tasks.filter((task) => task.featureType === featureType)
  }

  const total = tasks.length
  const page = tasks.slice(offset, offset + limit)
  return NextResponse.json({
    tasks: page.map(withTaskScheduling),
    total,
    hasMore: offset + page.length < total,
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

    const structured = error as (Error & { code?: string; retryable?: boolean }) | null
    // PRD §16：garment-detail 归一化错误携带业务 code/retryable，透传给前端；
    // 其余错误保持原有 { error } 形态不变。
    return NextResponse.json(
      {
        error: structured instanceof Error ? structured.message : '创建任务失败',
        ...(typeof structured?.code === 'string' ? { code: structured.code } : {}),
        ...(typeof structured?.retryable === 'boolean'
          ? { retryable: structured.retryable }
          : {}),
      },
      { status: 400 },
    )
  }
}
