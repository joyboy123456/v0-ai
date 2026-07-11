import { getImageTaskSchedulingSnapshot } from '@/lib/server/image-work-scheduler'
import type {
  GenerationTask,
  PhotoFissionParams,
  PoseFissionParams,
} from '@/lib/types'

function countTaskUnits(task: GenerationTask): number {
  if (task.shotProgress?.length) return task.shotProgress.length

  if (task.featureType === 'photo-fission') {
    const shotPlan = (task.params as Partial<PhotoFissionParams>).shotPlan
    if (Array.isArray(shotPlan) && shotPlan.length > 0) return shotPlan.length
  }

  if (task.featureType === 'pose-fission') {
    const poses = (task.params as Partial<PoseFissionParams>).poses
    if (Array.isArray(poses) && poses.length > 0) return poses.length
  }

  const resultCount = (task.params as { resultCount?: unknown }).resultCount
  if (typeof resultCount === 'number' && resultCount > 0) {
    return Math.floor(resultCount)
  }

  return Math.max(task.results.length, 1)
}

function countCompletedUnits(task: GenerationTask, totalUnits: number): number {
  const completed = new Set(
    task.results.map((result) => result.shotId ?? result.assetId),
  ).size
  return Math.min(completed, totalUnits)
}

/**
 * 把进程内调度状态动态合并到任务响应，不写回持久化 store。
 * 历史任务和已结束任务仍保持完全兼容。
 */
export function withTaskScheduling(task: GenerationTask): GenerationTask {
  const totalUnits = countTaskUnits(task)
  const completedUnits = countCompletedUnits(task, totalUnits)
  const isInFlight = task.status === 'pending' || task.status === 'running'

  if (!isInFlight) {
    return { ...task, completedUnits, totalUnits, activeUnits: 0 }
  }

  const scheduling = getImageTaskSchedulingSnapshot(task.taskId)
  if (!scheduling) {
    return {
      ...task,
      completedUnits,
      totalUnits,
      activeUnits: 0,
      schedulerState:
        task.schedulerState ??
        (task.status === 'pending' ? 'queued' : undefined),
    }
  }

  return {
    ...task,
    queuePosition: scheduling.queuePosition,
    activeUnits: scheduling.activeUnits,
    completedUnits,
    totalUnits,
    schedulerState: scheduling.schedulerState,
  }
}
