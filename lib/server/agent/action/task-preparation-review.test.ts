import assert from 'node:assert/strict'
import test from 'node:test'
import { paramsDigest, type PreviewArtifact } from '@/lib/agent/contracts'
import type { JsonValue } from '@/lib/agent/types'
import type { AssetRecord, GenerationTask, PhotoFissionParams } from '@/lib/types'
import { createLocalPreparationNormalizers } from './preparation-normalizers'
import { createTaskPreparation, TaskPreparationError } from './task-preparation'

const photoSettings = {
  model: 'nano-banana-2', category: 'childrens', childrensCategory: 'dress',
  hasFrontDetail: false, hasSideDetail: false, hasBackDetail: false,
  imageRatio: '3:4', resolution: '2k', resultCount: 2, plannerReasoningEnabled: false,
} satisfies JsonValue

function context(proposalId: string, settings: JsonValue = photoSettings, selectedAssetIds = ['main']) {
  return {
    userId: 'review-user', sessionId: 'review-session', messageId: `message-${proposalId}`,
    proposalId, version: 1, selectedAssetIds, settings,
  }
}

function asset(assetId: string): AssetRecord {
  return {
    assetId, userId: 'review-user', projectId: 'review-project', fileName: `${assetId}.png`,
    fileUrl: `/assets/${assetId}.png`, fileType: 'image/png', width: 800, height: 1200,
    createdAt: '2026-09-16T00:00:00.000Z', taskId: null,
  }
}

function fixture(options: { garmentModel?: string; historicalControls?: boolean } = {}) {
  const assets = new Map(['main', 'mask', 'detail'].map((id) => [id, asset(id)]))
  const tasks = new Map<string, GenerationTask>()
  const preparation = createTaskPreparation({
    assets: { async getAsset(id) { return assets.get(id) } },
    tasks: { async getTask(id) { return tasks.get(id) } },
    normalizers: createLocalPreparationNormalizers({
      poses: { async getPoseTemplate() { return undefined } },
      async resolveGarmentDetailModel(algorithmModelId) {
        return {
          definition: {
            algorithmModelId, algorithmModelName: '独立测试模型', tier: 'professional',
            resolutions: ['1k', '2k', '4k'],
          },
          resolvedModelId: options.garmentModel ?? 'nano-banana-2',
        }
      },
    }),
    availability: {
      async isFeatureAvailable() { return true },
      async isModelAvailable() { return true },
    },
    taskControls: options.historicalControls === false ? undefined : {
      async resolve(task) {
        return {
          resolvedModelId: (task.params as PhotoFissionParams).model,
          promptTemplateVersion: 'historical-frozen-photo-template-v7',
        }
      },
    },
    now: () => new Date('2026-09-17T00:00:00.000Z'),
  })
  return { assets, tasks, preparation }
}

const proposal = { toolName: 'photo_fission.create', args: { prompt: '保持原服装生成套图' } }

function failedTask(preview: PreviewArtifact): GenerationTask {
  return {
    taskId: 'original-task', userId: 'review-user', featureType: 'photo-fission',
    workflowId: 'photo_fission_v1', inputAssetIds: [...preview.inputAssetIds],
    params: preview.normalizedParams, status: 'failed', progress: 100, message: '生成失败',
    resultAssetIds: [], results: [], creditsUsed: 0, createdAt: '2026-09-16T00:00:00.000Z',
    shotProgress: [{ shotId: 'shot_1', label: '第一镜头', status: 'failed', message: '失败' }],
  }
}

test('独立验收：同用户的错误素材记录不能替代请求素材，预览重放也重新核验', async () => {
  const f = fixture()
  const preview = await f.preparation.prepare(proposal, context('asset-valid'))
  f.assets.set('main', asset('different-asset'))
  await assert.rejects(f.preparation.prepare(proposal, context('asset-mismatch')), TaskPreparationError)
  await assert.rejects(f.preparation.validatePrepared(preview), TaskPreparationError)
})

test('独立验收：同用户的错误 taskId 不能作为原任务创建或验证重试预览', async () => {
  const f = fixture()
  const generated = await f.preparation.prepare(proposal, context('task-source'))
  f.tasks.set('original-task', failedTask(generated))
  const input = { taskId: 'original-task', shotIds: ['shot_1'] }
  const retry = await f.preparation.prepareRetry(input, context('retry-valid', {}))
  f.tasks.set('original-task', { ...failedTask(generated), taskId: 'different-task' })
  await assert.rejects(f.preparation.prepareRetry(input, context('task-mismatch', {})), TaskPreparationError)
  await assert.rejects(f.preparation.validateRetry(retry), TaskPreparationError)
})

test('独立验收：细节图解析出 Gemini 时，即使 availability 为真也不能通过 Agent 预览', async () => {
  const settings = {
    category: 'tops', algorithmModelId: 'detail-pro', resolution: '2k', imageRatio: '1:1',
    aiAppendDescription: false,
  }
  const input = { toolName: 'garment_detail.create', args: { prompt: '查看袖口走线' } }
  await fixture().preparation.prepare(input, context('detail-valid', settings))
  const f = fixture({ garmentModel: 'gemini-3-pro-image-preview' })
  await assert.rejects(f.preparation.prepare(input, context('detail-gemini', settings)), TaskPreparationError)
})

test('独立验收：旧任务冻结为非 Grsai 模型时不能借重试绕过限制', async () => {
  const f = fixture()
  const preview = await f.preparation.prepare(proposal, context('model-source'))
  const original = failedTask(preview)
  f.tasks.set(original.taskId, {
    ...original, params: { ...original.params as PhotoFissionParams, model: 'gemini-3-pro-image-preview' },
  })
  await assert.rejects(f.preparation.prepareRetry(
    { taskId: original.taskId, shotIds: ['shot_1'] }, context('model-retry', {}),
  ), TaskPreparationError)
})

test('独立验收：五官蒙版必须属于绑定素材，不能只传一个另有归属的标识', async () => {
  const f = fixture()
  await assert.rejects(f.preparation.prepare(proposal, context('missing-mask', {
    ...photoSettings, faceIdModelId: 'face-model', faceMaskAssetId: 'not-selected',
  }, ['main', 'mask'])), TaskPreparationError)
})

test('独立验收：五官蒙版必须位于主图及细节图之后，不能占用主图或细节图位置', async () => {
  const f = fixture()
  const settings = {
    ...photoSettings, faceIdModelId: 'face-model', faceMaskAssetId: 'mask',
    hasFrontDetail: true, frontDetailCount: 1,
  }
  for (const [index, selected] of [['mask', 'detail', 'main'], ['main', 'mask', 'detail']].entries()) {
    await assert.rejects(f.preparation.prepare(proposal, context(`mask-position-${index}`, settings, selected)), TaskPreparationError)
  }
})

test('独立验收：裤装首次准备不读取 Math.random，独立存储重算仍产生同一计划和摘要', async (t) => {
  t.mock.method(Math, 'random', () => { throw new Error('预览阶段禁止重新抽随机种子') })
  const settings = { ...photoSettings, childrensCategory: 'pants', pantsMainHandVisibility: 'hidden' }
  const selected = context('deterministic-pants', settings)
  const first = await fixture().preparation.prepare(proposal, selected)
  const second = await fixture().preparation.prepare(proposal, selected)
  assert.equal((first.normalizedParams as PhotoFissionParams).pantsPoseDrawSeed, first.normalizationSeed)
  assert.deepEqual(second.normalizedParams, first.normalizedParams)
  assert.equal(second.paramsDigest, first.paramsDigest)
})

test('独立验收：旧任务没有冻结模板证据时拒绝重试，不把当前模板冒充历史版本', async () => {
  const f = fixture({ historicalControls: false })
  const preview = await f.preparation.prepare(proposal, context('legacy-template-source'))
  const original = failedTask(preview)
  f.tasks.set(original.taskId, original)
  await assert.rejects(f.preparation.prepareRetry(
    { taskId: original.taskId, shotIds: ['shot_1'] }, context('legacy-template-retry', {}),
  ), TaskPreparationError)
})

test('独立验收：旧裤装任务有完整镜头计划和历史模板证据即可重试，不补造种子', async () => {
  const f = fixture()
  const preview = await f.preparation.prepare(proposal, context('legacy-pants-source', {
    ...photoSettings, childrensCategory: 'pants', pantsMainHandVisibility: 'hidden',
  }))
  const original = failedTask(preview)
  const originalParams = structuredClone(original.params) as PhotoFissionParams
  delete originalParams.pantsPoseDrawSeed
  original.params = originalParams
  const expectedDigest = await paramsDigest('photo-fission', originalParams)
  const originalPlan = structuredClone(originalParams.shotPlan)
  f.tasks.set(original.taskId, original)

  const retry = await f.preparation.prepareRetry(
    { taskId: original.taskId, shotIds: ['shot_1'] }, context('legacy-pants-retry', {}),
  )
  await f.preparation.validateRetry(retry)
  assert.equal(retry.paramsDigest, expectedDigest)
  assert.equal(retry.resolvedModelId, 'nano-banana-2')
  assert.equal(retry.promptTemplateVersion, 'historical-frozen-photo-template-v7')
  assert.equal(Object.hasOwn(retry, 'normalizationSeed'), false)
  assert.equal(Object.hasOwn(f.tasks.get(original.taskId)!.params, 'pantsPoseDrawSeed'), false)
  assert.deepEqual((original.params as PhotoFissionParams).shotPlan, originalPlan)
  assert.equal(await paramsDigest('photo-fission', original.params), expectedDigest)
})
