import type {
  GarmentDetailParams,
  GenerationTask,
  PhotoFissionParams,
  PoseFissionParams,
} from '@/lib/types'

export type TaskRecoveryDecision =
  | { kind: 'ignore' }
  | { kind: 'complete' }
  | { kind: 'fail'; reason: string }
  | {
      kind: 'recover'
      attempt: number
      executionKey: string
      targetUnitIds: string[]
    }

/**
 * 中断任务恢复只能在生产进程的真实冷启动执行一次。
 * 开发环境的 HMR 不是服务重启，不得消耗恢复次数或修改任务状态。
 */
export function shouldStartInterruptedTaskRecovery(
  nodeEnv: string | undefined,
  alreadyStarted: boolean,
): boolean {
  return nodeEnv === 'production' && !alreadyStarted
}

function normalizeAttempts(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : 0
}

function getPlannedUnitIds(task: GenerationTask): string[] | null {
  if (task.featureType === 'photo-fission') {
    const params = task.params as PhotoFissionParams
    if (!Array.isArray(params.shotPlan) || params.shotPlan.length === 0) {
      return null
    }
    return params.shotPlan.map((shot) => shot.shotId?.trim()).filter(Boolean)
  }

  if (task.featureType === 'pose-fission') {
    const params = task.params as PoseFissionParams
    if (!Array.isArray(params.poses) || params.poses.length === 0) return null
    return params.poses.map((pose) => pose.id?.trim()).filter(Boolean)
  }

  // garment-detail：最小生成单元 = detailShots[].shotId（detail_1 ~ detail_3，PRD §15）。
  if (task.featureType === 'garment-detail') {
    const params = task.params as GarmentDetailParams
    if (!Array.isArray(params.detailShots) || params.detailShots.length === 0) {
      return null
    }
    return params.detailShots.map((shot) => shot.shotId?.trim()).filter(Boolean)
  }

  return null
}

/**
 * 只恢复能按稳定 shot/pose id 精确过滤的裂变任务。
 * 单张任务无法判断上游是否已经扣费但结果尚未落盘，因此宁可失败也不重复生成。
 */
export function decideInterruptedTaskRecovery(
  task: GenerationTask,
  maxAttempts: number,
): TaskRecoveryDecision {
  if (task.status !== 'pending' && task.status !== 'running') {
    return { kind: 'ignore' }
  }

  if (
    task.featureType !== 'photo-fission' &&
    task.featureType !== 'pose-fission' &&
    task.featureType !== 'garment-detail'
  ) {
    return {
      kind: 'fail',
      reason: '服务重启时无法安全判断单张任务是否已在上游生成，为避免重复扣费已停止自动恢复，请重新生成',
    }
  }

  const plannedUnitIds = getPlannedUnitIds(task)
  if (
    !plannedUnitIds ||
    plannedUnitIds.length === 0 ||
    new Set(plannedUnitIds).size !== plannedUnitIds.length
  ) {
    return {
      kind: 'fail',
      reason: '服务重启时任务缺少可安全恢复的镜头标识，已保留现有结果，请手动重试失败镜头',
    }
  }

  const completedUnitIds = new Set(
    task.results
      .map((result) => result.shotId?.trim())
      .filter((shotId): shotId is string => Boolean(shotId)),
  )
  const targetUnitIds = plannedUnitIds.filter(
    (unitId) => !completedUnitIds.has(unitId),
  )
  if (targetUnitIds.length === 0) return { kind: 'complete' }

  const attempts = normalizeAttempts(task.recoveryAttempts)
  if (attempts >= Math.max(0, maxAttempts)) {
    return {
      kind: 'fail',
      reason: `服务重启后已自动恢复 ${attempts} 次仍未完成，已保留现有结果，请手动重试失败镜头`,
    }
  }

  const attempt = attempts + 1
  return {
    kind: 'recover',
    attempt,
    executionKey: `${task.taskId}:recovery:${attempt}:${targetUnitIds.join(',')}`,
    targetUnitIds,
  }
}
