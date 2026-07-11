import assert from 'node:assert/strict'
import test from 'node:test'

import type { GenerationTask, PhotoFissionParams, PoseFissionParams } from '../types.ts'
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { decideInterruptedTaskRecovery, shouldStartInterruptedTaskRecovery } from './task-recovery.ts'

function baseTask(patch: Partial<GenerationTask> = {}): GenerationTask {
  return {
    taskId: 'task_1',
    featureType: 'photo-fission',
    workflowId: 'workflow',
    inputAssetIds: ['asset_1'],
    params: {
      shotPlan: [
        { shotId: 'shot_1', label: '1', prompt: '1', order: 1 },
        { shotId: 'shot_2', label: '2', prompt: '2', order: 2 },
      ],
      resultCount: 2,
    } as PhotoFissionParams,
    status: 'running',
    progress: 72,
    message: 'running',
    resultAssetIds: [],
    results: [],
    createdAt: new Date(0).toISOString(),
    creditsUsed: 0,
    ...patch,
  }
}

test('只恢复裂变任务中尚未落盘的镜头', () => {
  const task = baseTask({
    results: [{
      assetId: 'result_1',
      url: '/1.png',
      downloadUrl: '/1.png',
      width: 1,
      height: 1,
      shotId: 'shot_1',
    }],
  })
  assert.deepEqual(decideInterruptedTaskRecovery(task, 2), {
    kind: 'recover',
    attempt: 1,
    executionKey: 'task_1:recovery:1:shot_2',
    targetUnitIds: ['shot_2'],
  })
})

test('开发 HMR 永久跳过中断任务恢复，生产冷启动只执行一次', () => {
  assert.equal(shouldStartInterruptedTaskRecovery('development', false), false)
  assert.equal(shouldStartInterruptedTaskRecovery('test', false), false)
  assert.equal(shouldStartInterruptedTaskRecovery('production', false), true)
  assert.equal(shouldStartInterruptedTaskRecovery('production', true), false)
})

test('姿势裂变按 pose id 过滤，达到恢复上限后明确失败', () => {
  const task = baseTask({
    featureType: 'pose-fission',
    params: {
      poses: [
        { id: 'pose_1', url: '/1.png', name: '1', bodyPart: 'full' },
        { id: 'pose_2', url: '/2.png', name: '2', bodyPart: 'full' },
      ],
      resultCount: 2,
      creditsCost: 0,
    } as PoseFissionParams,
    recoveryAttempts: 2,
  })
  const decision = decideInterruptedTaskRecovery(task, 2)
  assert.equal(decision.kind, 'fail')
  if (decision.kind === 'fail') assert.match(decision.reason, /已自动恢复 2 次/)
})

test('已有全部结果时直接完成，终态任务不参与恢复', () => {
  const completed = baseTask({
    results: ['shot_1', 'shot_2'].map((shotId) => ({
      assetId: `result_${shotId}`,
      url: '/done.png',
      downloadUrl: '/done.png',
      width: 1,
      height: 1,
      shotId,
    })),
  })
  assert.deepEqual(decideInterruptedTaskRecovery(completed, 2), { kind: 'complete' })
  assert.deepEqual(
    decideInterruptedTaskRecovery({ ...completed, status: 'cancelled' }, 2),
    { kind: 'ignore' },
  )
})

test('单张任务为避免重复扣费不自动恢复', () => {
  const task = baseTask({
    featureType: 'ai-fashion-photo',
    params: {} as GenerationTask['params'],
  })
  const decision = decideInterruptedTaskRecovery(task, 2)
  assert.equal(decision.kind, 'fail')
  if (decision.kind === 'fail') assert.match(decision.reason, /避免重复扣费/)
})

test('重复或缺失镜头 id 的历史任务不会被盲目重跑', () => {
  const task = baseTask({
    params: {
      shotPlan: [
        { shotId: 'same', label: '1', prompt: '1', order: 1 },
        { shotId: 'same', label: '2', prompt: '2', order: 2 },
      ],
      resultCount: 2,
    } as PhotoFissionParams,
  })
  assert.equal(decideInterruptedTaskRecovery(task, 2).kind, 'fail')
})
