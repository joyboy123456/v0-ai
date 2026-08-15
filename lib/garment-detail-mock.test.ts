import assert from 'node:assert/strict'
import test from 'node:test'

import {
  advanceGarmentDetailMockTask,
  buildGarmentDetailShots,
  cancelGarmentDetailMockTask,
  createGarmentDetailMockTask,
  isGarmentDetailMockTaskId,
  retryGarmentDetailMockTask,
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
} from './garment-detail-mock.ts'
import type { GarmentDetailParams, UploadedImage } from './types.ts'

const T0 = 1_700_000_000_000

function makeImage(assetId: string, name = `${assetId}.jpg`): UploadedImage {
  return { assetId, preview: `/uploads/${name}`, name, width: 3000, height: 4000 }
}

function makeParams(overrides: Partial<GarmentDetailParams> = {}): GarmentDetailParams {
  const detailShots = buildGarmentDetailShots('tops', ['ref-1', 'ref-2'])
  return {
    category: 'tops',
    algorithmModelId: 'std-v1',
    algorithmModelName: '标准版',
    modelTier: 'standard',
    resolution: '1k',
    imageRatio: '1:1',
    userPrompt: '',
    aiAppendDescription: false,
    referenceImageCount: 2,
    detailShots,
    resultCount: detailShots.length,
    creditsCost: 0,
    ...overrides,
  }
}

function makeTask(params = makeParams()) {
  return createGarmentDetailMockTask(
    {
      params,
      mainImage: makeImage('main-1'),
      referenceImages: [makeImage('ref-1'), makeImage('ref-2')],
    },
    T0,
  )
}

test('buildGarmentDetailShots：无参考图输出 1 张，有参考图一一对应', () => {
  const empty = buildGarmentDetailShots('tops', [])
  assert.equal(empty.length, 1)
  assert.equal(empty[0].referenceAssetId, null)
  assert.equal(empty[0].label, '领口细节')

  const three = buildGarmentDetailShots('bottoms', ['a', 'b', 'c'])
  assert.equal(three.length, 3)
  assert.deepEqual(
    three.map((shot) => shot.referenceAssetId),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    three.map((shot) => shot.label),
    ['腰头细节', '走线细节', '面料纹理'],
  )
})

test('createGarmentDetailMockTask：初始为排队态且素材完整', () => {
  const task = makeTask()
  assert.ok(isGarmentDetailMockTaskId(task.taskId))
  assert.equal(task.featureType, 'garment-detail')
  assert.equal(task.status, 'pending')
  assert.equal(task.schedulerState, 'queued')
  assert.deepEqual(task.inputAssetIds, ['main-1', 'ref-1', 'ref-2'])
  assert.equal(task.inputAssets?.length, 3)
  assert.equal(task.shotProgress?.length, 2)
  assert.equal(task.results.length, 0)
})

test('advance：按时间轴推进 排队 → 识别 → 规划 → 逐张生成 → 成功', () => {
  const task = makeTask()

  const queued = advanceGarmentDetailMockTask(task, T0 + 1_000)
  assert.equal(queued.status, 'pending')

  const classifying = advanceGarmentDetailMockTask(task, T0 + 2_000)
  assert.equal(classifying.status, 'running')
  assert.equal(classifying.progress, 12)
  assert.match(classifying.message, /识别服装类型/)

  const planning = advanceGarmentDetailMockTask(task, T0 + 4_000)
  assert.equal(planning.status, 'running')
  assert.match(planning.message, /上装/)

  // 第一张生成中（PLAN_MS=5500 之后、第一张完成前）
  const generating = advanceGarmentDetailMockTask(task, T0 + 6_000)
  assert.equal(generating.status, 'running')
  assert.equal(generating.results.length, 0)
  assert.equal(generating.shotProgress?.[0].status, 'generating')
  assert.equal(generating.shotProgress?.[1].status, 'prompting')

  // 第一张完成、第二张生成中（PER_SHOT_MS=3500）
  const halfDone = advanceGarmentDetailMockTask(task, T0 + 9_500)
  assert.equal(halfDone.results.length, 1)
  assert.equal(halfDone.results[0].shotId, 'detail_1')
  assert.equal(halfDone.results[0].label, '领口细节')
  assert.equal(halfDone.shotProgress?.[1].status, 'generating')

  // 全部完成
  const done = advanceGarmentDetailMockTask(task, T0 + 13_000)
  assert.equal(done.status, 'success')
  assert.equal(done.progress, 100)
  assert.equal(done.results.length, 2)
  assert.equal(done.resultAssetIds.length, 2)
  assert.ok(done.finishedAt)
  // 3:4 比例时宽度 = 高度的 3/4
  const ratioTask = makeTask(makeParams({ imageRatio: '3:4', detailShots: buildGarmentDetailShots('tops', []), resultCount: 1, referenceImageCount: 0 }))
  const ratioDone = advanceGarmentDetailMockTask(ratioTask, T0 + 10_000)
  assert.equal(ratioDone.results[0].width, 768)
  assert.equal(ratioDone.results[0].height, 1024)

  // 终态不再变化
  assert.equal(advanceGarmentDetailMockTask(done, T0 + 99_000), done)
})

test('失败演示：提示词含「失败」→ 审核拒绝；重试后成功', () => {
  const failParams = makeParams({ userPrompt: '这条会失败' })
  const task = makeTask(failParams)

  const failed = advanceGarmentDetailMockTask(task, T0 + 6_000)
  assert.equal(failed.status, 'failed')
  assert.match(failed.errorMessage ?? '', /AUDIT_REJECTED/)
  assert.equal(failed.results.length, 0)

  const retried = retryGarmentDetailMockTask(failed, T0 + 60_000)
  assert.equal(retried.status, 'pending')
  assert.equal((retried.params as GarmentDetailParams).mockRetryCount, 1)
  assert.equal(retried.errorMessage, undefined)

  const done = advanceGarmentDetailMockTask(retried, T0 + 60_000 + 13_000)
  assert.equal(done.status, 'success')
  assert.equal(done.results.length, 2)
})

test('取消：保留已生成结果，未完成输出位标记为已取消', () => {
  const task = makeTask()
  const halfDone = advanceGarmentDetailMockTask(task, T0 + 9_500)
  assert.equal(halfDone.results.length, 1)

  const cancelled = cancelGarmentDetailMockTask(halfDone, T0 + 10_000)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.results.length, 1)
  assert.equal(cancelled.shotProgress?.[0].status, 'success')
  assert.equal(cancelled.shotProgress?.[1].status, 'cancelled')
  assert.match(cancelled.message, /保留已生成图片/)
})
