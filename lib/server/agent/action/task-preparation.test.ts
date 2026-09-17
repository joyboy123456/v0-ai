import assert from 'node:assert/strict'
import test from 'node:test'
import { PREVIEW_TTL_MS } from '@/lib/agent/budget'
import { paramsDigest, requestDigest, type PreviewArtifact } from '@/lib/agent/contracts'
import type { JsonValue } from '@/lib/agent/types'
import type { AssetRecord, GenerationTask, PhotoFissionParams } from '@/lib/types'
import { ToolRegistry } from './tool-registry'
import {
  CREATE_TASK_TOOL_METADATA,
  InMemoryTaskPreparationArtifactStore,
  MULTIPLE_RESULTS_BLOCKER,
  POSE_PROMPT_NOT_SUPPORTED_BLOCKER,
  TASK_PREPARATION_TOOL_METADATA,
  TaskPreparationError,
  createTaskPreparation,
  retryShotsToolMetadata,
  type TaskFrozenControlResolver,
  type TaskPreparationArtifactStorePort,
  type TaskPreparationNormalizers,
} from './task-preparation'
import { createLocalPreparationNormalizers } from './preparation-normalizers'

function asset(assetId: string, userId = 'user-1'): AssetRecord {
  return {
    assetId,
    userId,
    projectId: 'project-1',
    fileName: `${assetId}.png`,
    fileUrl: `/assets/${assetId}.png`,
    fileType: 'image/png',
    width: 800,
    height: 1_200,
    createdAt: '2026-09-16T00:00:00.000Z',
    taskId: null,
  }
}

function context(
  proposalId: string,
  settings: JsonValue,
  selectedAssetIds: string[] = ['main'],
  version = 1,
) {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    messageId: `message-${proposalId}`,
    proposalId,
    version,
    selectedAssetIds,
    settings,
  }
}

const aiSettings = {
  model: 'nano-banana-2',
  imageRatio: '3:4',
  resolution: '2k',
  resultCount: 1,
  promptMode: 'enhanced',
} satisfies JsonValue

const photoSettings = {
  model: 'nano-banana-2',
  category: 'childrens',
  childrensCategory: 'dress',
  hasFrontDetail: false,
  hasSideDetail: false,
  hasBackDetail: false,
  imageRatio: '3:4',
  resolution: '2k',
  resultCount: 2,
  plannerReasoningEnabled: false,
} satisfies JsonValue

const pantsSettings = {
  ...photoSettings,
  childrensCategory: 'pants',
  pantsMainHandVisibility: 'hidden',
} satisfies JsonValue

const poseSettings = {
  model: 'nano-banana-2',
  poseIds: ['pose-a', 'pose-b'],
  hasFrontDetail: false,
  hasBackDetail: false,
  lowerBodyMainArmVisibility: 'hidden',
  imageRatio: '3:4',
  resolution: '2k',
} satisfies JsonValue

const garmentSettings = {
  category: 'tops',
  algorithmModelId: 'detail-pro',
  resolution: '2k',
  imageRatio: '1:1',
  aiAppendDescription: true,
} satisfies JsonValue

interface FixtureOptions {
  normalizers?: TaskPreparationNormalizers
  store?: TaskPreparationArtifactStorePort
  taskControls?: TaskFrozenControlResolver | false
}

function fixture(options: FixtureOptions = {}) {
  const assets = new Map<string, AssetRecord>([
    ['main', asset('main')],
    ['ref-1', asset('ref-1')],
    ['ref-2', asset('ref-2')],
    ['other-user', asset('other-user', 'user-2')],
  ])
  const tasks = new Map<string, GenerationTask>()
  const frozenTaskControls = new Map<string, {
    resolvedModelId: string
    promptTemplateVersion: string
  }>()
  const unavailableModels = new Set<string>()
  const unavailableFeatures = new Set<string>()
  let nowMs = Date.parse('2026-09-17T00:00:00.000Z')
  let imageRequests = 0
  let garmentModelResolutions = 0

  const localNormalizers = createLocalPreparationNormalizers({
    poses: {
      async getPoseTemplate(poseId) {
        const poses = {
          'pose-a': { id: 'pose-a', url: '/poses/a.png', name: '正面站姿', bodyPart: 'full' as const },
          'pose-b': { id: 'pose-b', url: '/poses/b.png', name: '侧身站姿', bodyPart: 'full' as const },
        }
        return poses[poseId as keyof typeof poses]
      },
    },
    async resolveGarmentDetailModel(algorithmModelId) {
      garmentModelResolutions += 1
      assert.equal(algorithmModelId, 'detail-pro')
      return {
        definition: {
          algorithmModelId,
          algorithmModelName: '细节专业版',
          tier: 'professional' as const,
          resolutions: ['1k', '2k', '4k'] as const,
        },
        resolvedModelId: 'nano-banana-2',
      }
    },
    promptTemplateVersions: {
      'garment-detail': 'garment-detail-test-v3',
    },
  })

  const fixtureTaskControls: TaskFrozenControlResolver | undefined = options.taskControls === false
    ? undefined
    : options.taskControls ?? {
      async resolve(task) {
        const controls = frozenTaskControls.get(task.taskId)
        if (!controls) throw new Error(`任务 ${task.taskId} 没有测试冻结控制证据`)
        return controls
      },
    }

  const preparation = createTaskPreparation({
    assets: {
      async getAsset(assetId) {
        return assets.get(assetId)
      },
    },
    tasks: {
      async getTask(taskId) {
        return tasks.get(taskId)
      },
    },
    normalizers: options.normalizers ?? localNormalizers,
    availability: {
      async isFeatureAvailable(featureType) {
        return !unavailableFeatures.has(featureType)
      },
      async isModelAvailable(_featureType, modelId) {
        return !unavailableModels.has(modelId)
      },
    },
    store: options.store,
    taskControls: fixtureTaskControls,
    now: () => new Date(nowMs),
  })

  return {
    assets,
    tasks,
    bindTask(task: GenerationTask, preview: PreviewArtifact) {
      if (!preview.resolvedModelId || !preview.promptTemplateVersion) {
        throw new Error('源预览缺少冻结控制字段')
      }
      tasks.set(task.taskId, task)
      frozenTaskControls.set(task.taskId, {
        resolvedModelId: preview.resolvedModelId,
        promptTemplateVersion: preview.promptTemplateVersion,
      })
    },
    unavailableModels,
    unavailableFeatures,
    localNormalizers,
    preparation,
    get imageRequests() { return imageRequests },
    requestImage() { imageRequests += 1 },
    get garmentModelResolutions() { return garmentModelResolutions },
    advance(ms: number) { nowMs += ms },
  }
}

async function rejectsCode(promise: Promise<unknown>, code: TaskPreparationError['code']): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TaskPreparationError)
    assert.equal(error.code, code)
    return true
  })
}

function photoTask(preview: PreviewArtifact): GenerationTask {
  return {
    taskId: 'task-photo-1',
    userId: 'user-1',
    featureType: 'photo-fission',
    workflowId: 'photo_fission_v1',
    inputAssetIds: [...preview.inputAssetIds],
    params: preview.normalizedParams,
    status: 'partial',
    progress: 50,
    message: '一个镜头失败',
    resultAssetIds: ['result-shot-2'],
    results: [{
      assetId: 'result-shot-2',
      url: '/results/shot-2.png',
      downloadUrl: '/results/shot-2.png',
      width: 800,
      height: 1_200,
      shotId: 'shot_2',
    }],
    shotProgress: [
      { shotId: 'shot_1', label: '镜头一', status: 'failed', message: '失败', retryAttempt: 2 },
      { shotId: 'shot_2', label: '镜头二', status: 'success', message: '完成' },
    ],
    createdAt: '2026-09-16T23:00:00.000Z',
    creditsUsed: 0,
  }
}

function garmentTask(preview: PreviewArtifact): GenerationTask {
  const params = preview.normalizedParams as unknown as {
    detailShots: Array<{ shotId: string; label: string }>
  }
  const shot = params.detailShots[0]
  if (!shot) throw new Error('服装细节预览缺少输出位')
  return {
    taskId: 'task-garment-1',
    userId: 'user-1',
    featureType: 'garment-detail',
    workflowId: 'garment_detail_v1',
    inputAssetIds: [...preview.inputAssetIds],
    params: preview.normalizedParams,
    status: 'failed',
    progress: 100,
    message: '细节镜头失败',
    resultAssetIds: [],
    results: [],
    shotProgress: [{ shotId: shot.shotId, label: shot.label, status: 'failed', message: '失败' }],
    createdAt: '2026-09-16T23:00:00.000Z',
    creditsUsed: 0,
  }
}

test('四个 create 与 retry 元数据名称精确、schema strict 且治理轴一致', () => {
  const registry = new ToolRegistry(TASK_PREPARATION_TOOL_METADATA)
  assert.deepEqual(registry.list().map((tool) => [tool.name, tool.featureType]), [
    ['fashion_photo.create', 'ai-fashion-photo'],
    ['photo_fission.create', 'photo-fission'],
    ['pose_fission.create', 'pose-fission'],
    ['garment_detail.create', 'garment-detail'],
    ['task.retry_shots', undefined],
  ])
  for (const tool of CREATE_TASK_TOOL_METADATA) {
    assert.equal(tool.costClass, 'paid_generation')
    assert.equal(tool.approvalPolicy, 'preview_confirmation')
    const parsed = tool.inputSchema.parse({ prompt: '生成商品图' }) as { prompt: string }
    assert.equal(parsed.prompt, '生成商品图')
    assert.throws(() => tool.inputSchema.parse({ prompt: '生成', model: '伪造模型' }))
    assert.throws(() => tool.inputSchema.parse({ prompt: '生成', normalizedParams: {} }))
    assert.throws(() => tool.inputSchema.parse({ prompt: '生成', resultCount: 99 }))
  }
  assert.equal(retryShotsToolMetadata.costClass, 'paid_generation')
  assert.equal(retryShotsToolMetadata.approvalPolicy, 'preview_confirmation')
  assert.equal(retryShotsToolMetadata.featureType, undefined)
  assert.deepEqual(retryShotsToolMetadata.inputSchema.parse({}), {})
  assert.throws(() => retryShotsToolMetadata.inputSchema.parse({ taskId: 'model-forged' }))
  assert.throws(() => retryShotsToolMetadata.inputSchema.parse({ shotIds: ['shot_1'] }))
})

test('四个真实业务 normalizer 只生成冻结预览且不发起图片请求', async () => {
  const f = fixture()
  const fashion = await f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '红色风衣棚拍' } },
    context('fashion', aiSettings),
  )
  const photo = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '生成童装套图' } },
    context('photo', photoSettings),
  )
  const pose = await f.preparation.prepare(
    { toolName: 'pose_fission.create', args: { prompt: '保持服装并更换姿势' } },
    context('pose', poseSettings),
  )
  const detail = await f.preparation.prepare(
    { toolName: 'garment_detail.create', args: { prompt: '突出细密走线' } },
    context('detail', garmentSettings, ['main', 'ref-1', 'ref-2']),
  )

  assert.equal(fashion.featureType, 'ai-fashion-photo')
  assert.match((fashion.normalizedParams as { finalPrompt: string }).finalPrompt, /红色风衣棚拍/)
  assert.equal(fashion.estimatedResultCount, 1)
  assert.deepEqual(fashion.blockers, [])

  assert.equal(photo.featureType, 'photo-fission')
  assert.equal((photo.normalizedParams as { shotPlan: unknown[] }).shotPlan.length, 2)
  assert.deepEqual(photo.blockers, [MULTIPLE_RESULTS_BLOCKER])

  assert.equal(pose.featureType, 'pose-fission')
  assert.deepEqual(
    (pose.normalizedParams as { poses: Array<{ id: string }> }).poses.map((item) => item.id),
    ['pose-a', 'pose-b'],
  )
  assert.deepEqual(pose.blockers, [MULTIPLE_RESULTS_BLOCKER, POSE_PROMPT_NOT_SUPPORTED_BLOCKER])
  assert.ok(pose.riskNotices.some((notice) => notice.includes('保持服装并更换姿势')))

  assert.equal(detail.featureType, 'garment-detail')
  assert.equal((detail.normalizedParams as { userPrompt: string }).userPrompt, '突出细密走线')
  assert.equal((detail.normalizedParams as { detailShots: unknown[] }).detailShots.length, 2)
  assert.equal(detail.resolvedModelId, 'nano-banana-2')
  assert.equal(detail.promptTemplateVersion, 'garment-detail-test-v3')
  assert.deepEqual(detail.blockers, [MULTIPLE_RESULTS_BLOCKER])

  for (const preview of [fashion, photo, pose, detail]) await f.preparation.validatePrepared(preview)
  assert.equal(f.imageRequests, 0)
  assert.equal(f.garmentModelResolutions, 1)
})

test('并发与顺序重放只归一化一次并返回相同完整请求摘要', async () => {
  const initial = fixture()
  let calls = 0
  const wrapped: TaskPreparationNormalizers = {
    ...initial.localNormalizers,
    'ai-fashion-photo': {
      async normalize(input) {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return initial.localNormalizers['ai-fashion-photo'].normalize(input)
      },
    },
  }
  const f = fixture({ normalizers: wrapped })
  const proposal = { toolName: 'fashion_photo.create', args: { prompt: '稳定重放' } }
  const ctx = context('replay', aiSettings)
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => f.preparation.prepare(proposal, ctx)))
  const sequential = await f.preparation.prepare(proposal, ctx)
  const digests = await Promise.all([...concurrent, sequential]
    .map((preview) => requestDigest({ actionKind: 'generate', payload: preview })))

  assert.equal(new Set(digests).size, 1)
  assert.ok(concurrent.every((preview) => assert.deepEqual(preview, sequential) === undefined))
  assert.equal(calls, 1)
})

test('裤装 proposal seed 直接注入现有 normalizer，跨 preparation 实例也返回同一工件', async (t) => {
  t.mock.method(Math, 'random', () => { throw new Error('冻结准备不得再次随机规划') })
  const f = fixture()
  const store = new InMemoryTaskPreparationArtifactStore()
  const dependencies = {
    assets: { getAsset: async (id: string) => f.assets.get(id) },
    tasks: { getTask: async (id: string) => f.tasks.get(id) },
    normalizers: f.localNormalizers,
    availability: {
      isFeatureAvailable: async () => true,
      isModelAvailable: async () => true,
    },
    store,
    now: () => new Date('2026-09-17T00:00:00.000Z'),
  }
  const left = createTaskPreparation(dependencies)
  const right = createTaskPreparation(dependencies)
  const proposal = { toolName: 'photo_fission.create', args: { prompt: '裤装动作套图' } }
  const ctx = context('pants-replay', pantsSettings)
  const [first, second] = await Promise.all([left.prepare(proposal, ctx), right.prepare(proposal, ctx)])
  const params = first.normalizedParams as { pantsPoseDrawSeed: string; shotPlan: unknown[] }

  assert.equal(params.pantsPoseDrawSeed, first.normalizationSeed)
  assert.equal(params.shotPlan.length, 2)
  assert.deepEqual(first, second)
  assert.equal(
    await requestDigest({ actionKind: 'generate', payload: first }),
    await requestDigest({ actionKind: 'generate', payload: second }),
  )
})

test('同 proposal/version 的提示词冲突；编辑提示词必须新版本且摘要变化', async () => {
  const f = fixture()
  const originalContext = context('prompt-edit', aiSettings)
  const first = await f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '白色背景' } },
    originalContext,
  )
  await rejectsCode(f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '户外草地' } },
    originalContext,
  ), 'proposal_conflict')

  const edited = await f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '户外草地' } },
    { ...originalContext, version: 2 },
  )
  assert.notEqual(first.normalizationSeed, edited.normalizationSeed)
  assert.notEqual(
    await requestDigest({ actionKind: 'generate', payload: first }),
    await requestDigest({ actionKind: 'generate', payload: edited }),
  )
})

test('photo 提示词追加到每个冻结镜头，编辑会改变真实 shot 参数并保留模板约束', async () => {
  const f = fixture()
  const originalContext = context('photo-prompt-edit', photoSettings)
  const first = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '背景增加柔和晨光' } },
    originalContext,
  )
  const edited = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '背景改为室内暖光' } },
    { ...originalContext, version: 2 },
  )
  const firstShots = (first.normalizedParams as PhotoFissionParams).shotPlan
  const editedShots = (edited.normalizedParams as PhotoFissionParams).shotPlan
  const marker = '\n\n【用户创作要求】\n'

  assert.ok(firstShots.every((shot) => shot.prompt.includes(`${marker}背景增加柔和晨光\n`)))
  assert.ok(editedShots.every((shot) => shot.prompt.includes(`${marker}背景改为室内暖光\n`)))
  assert.deepEqual(
    firstShots.map((shot) => shot.prompt.split(marker)[0]),
    editedShots.map((shot) => shot.prompt.split(marker)[0]),
  )
  assert.notDeepEqual(firstShots, editedShots)
  assert.notEqual(first.paramsDigest, edited.paramsDigest)
})

test('pose 自由提示词保留为可见目标并返回确定性不可执行 blocker，不伪造 TaskParams 字段', async () => {
  const f = fixture()
  const prompt = '模特轻轻抬起左手并保持衣摆完整'
  const preview = await f.preparation.prepare(
    { toolName: 'pose_fission.create', args: { prompt } },
    context('pose-prompt-limit', { ...poseSettings, poseIds: ['pose-a'] } as JsonValue),
  )
  const params = preview.normalizedParams as unknown as Record<string, unknown>

  assert.equal(Object.hasOwn(params, 'prompt'), false)
  assert.deepEqual(preview.blockers, [POSE_PROMPT_NOT_SUPPORTED_BLOCKER])
  assert.ok(preview.riskNotices.includes(`用户目标：${prompt}`))
  assert.ok(preview.riskNotices.some((notice) => notice.includes('尚未接入') && notice.includes('不能执行')))
  await f.preparation.validatePrepared(preview)
})

test('过期重放被拒绝且不会覆盖原工件', async () => {
  const f = fixture()
  const proposal = { toolName: 'fashion_photo.create', args: { prompt: '过期测试' } }
  const ctx = context('expiry', aiSettings)
  await f.preparation.prepare(proposal, ctx)
  f.advance(PREVIEW_TTL_MS)
  await rejectsCode(f.preparation.prepare(proposal, ctx), 'preview_expired')
})

test('模型只能提供 prompt；伪造控制字段和越界服务端 settings 均被拒绝', async () => {
  const f = fixture()
  await rejectsCode(f.preparation.prepare({
    toolName: '__proto__',
    args: { prompt: '伪造工具' },
  }, context('prototype-tool', aiSettings)), 'unsupported_tool')
  await rejectsCode(f.preparation.prepare({
    toolName: 'fashion_photo.create',
    args: { prompt: '生成', model: 'nano-banana-pro', resultCount: 4 },
  }, context('spoof-args', aiSettings)), 'invalid_proposal')
  await rejectsCode(f.preparation.prepare({
    toolName: 'fashion_photo.create',
    args: { prompt: '生成', normalizedParams: { resultCount: 1 } },
  }, context('spoof-normalized', aiSettings)), 'invalid_proposal')
  await rejectsCode(f.preparation.prepare({
    toolName: 'fashion_photo.create',
    args: { prompt: '生成' },
  }, context('bad-settings', { ...aiSettings, resultCount: 3 } as JsonValue)), 'invalid_settings')
  await rejectsCode(f.preparation.prepare({
    toolName: 'fashion_photo.create',
    args: { prompt: '生成' },
  }, context('settings-spoof', { ...aiSettings, normalizedParams: {} } as JsonValue)), 'invalid_settings')
})

test('准备和校验都重查素材所有权、删除与不可变摘要', async () => {
  const crossUser = fixture()
  await rejectsCode(crossUser.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '越权素材' } },
    context('cross-user', aiSettings, ['other-user']),
  ), 'asset_forbidden')

  const changed = fixture()
  const changedPreview = await changed.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '摘要变化' } },
    context('asset-change', aiSettings),
  )
  changed.assets.get('main')!.width += 1
  await rejectsCode(changed.preparation.validatePrepared(changedPreview), 'asset_changed')

  const deleted = fixture()
  const deletedPreview = await deleted.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '删除素材' } },
    context('asset-delete', aiSettings),
  )
  deleted.assets.delete('main')
  await rejectsCode(deleted.preparation.validatePrepared(deletedPreview), 'asset_not_found')

  const mismatched = fixture()
  mismatched.assets.set('main', asset('different-asset-id'))
  await rejectsCode(mismatched.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '错误查询记录' } },
    context('asset-id-mismatch', aiSettings),
  ), 'asset_not_found')
})

test('五官蒙版冻结为主图和细节图之后的最后素材，并参与预览与重试摘要校验', async () => {
  const f = fixture()
  const settings = {
    ...photoSettings,
    hasFrontDetail: true,
    frontDetailCount: 1,
    faceIdModelId: 'face-model',
    faceMaskAssetId: 'ref-2',
  } satisfies JsonValue
  const preview = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '锁定五官并展示正面细节' } },
    context('face-mask-valid', settings, ['main', 'ref-1', 'ref-2']),
  )

  assert.deepEqual(preview.inputAssetIds, ['main', 'ref-1', 'ref-2'])
  assert.equal(preview.assetDigests.length, 3)
  assert.equal((preview.normalizedParams as PhotoFissionParams).faceMaskAssetId, 'ref-2')
  await f.preparation.validatePrepared(preview)

  const invalidHistoricalTask = photoTask(preview)
  invalidHistoricalTask.params = {
    ...(invalidHistoricalTask.params as PhotoFissionParams),
    faceMaskAssetId: 'ref-1',
  }
  f.bindTask(invalidHistoricalTask, preview)
  await rejectsCode(f.preparation.prepareRetry(
    { taskId: invalidHistoricalTask.taskId, shotIds: ['shot_1'] },
    context('face-mask-retry-invalid', {}, []),
  ), 'artifact_tampered')
})

test('冻结模型不可用时阻断准备或校验，不切换模型', async () => {
  const f = fixture()
  f.unavailableModels.add('nano-banana-2')
  await rejectsCode(f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '模型不可用' } },
    context('model-down-before', aiSettings),
  ), 'model_unavailable')

  f.unavailableModels.delete('nano-banana-2')
  const preview = await f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '固定模型' } },
    context('model-down-after', aiSettings),
  )
  assert.equal(preview.resolvedModelId, 'nano-banana-2')
  f.unavailableModels.add('nano-banana-2')
  await rejectsCode(f.preparation.validatePrepared(preview), 'model_unavailable')
  assert.equal(preview.resolvedModelId, 'nano-banana-2')
})

test('availability=true 也不能放行 normalizer 返回的不可选旧渠道模型', async () => {
  const baseline = fixture()
  const normalizers: TaskPreparationNormalizers = {
    ...baseline.localNormalizers,
    'ai-fashion-photo': {
      async normalize(input) {
        const normalized = await baseline.localNormalizers['ai-fashion-photo'].normalize(input)
        return {
          ...normalized,
          normalizedParams: {
            ...normalized.normalizedParams,
            model: 'gemini-3-pro-image-preview',
          },
          resolvedModelId: 'gemini-3-pro-image-preview',
        }
      },
    },
  }
  const f = fixture({ normalizers })
  await rejectsCode(f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '不得走旧渠道' } },
    context('model-policy-override', aiSettings),
  ), 'model_unavailable')
})

test('即使攻击者同步重算 paramsDigest，篡改工件仍不匹配服务端引用', async () => {
  const f = fixture()
  const preview = await f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '不可篡改' } },
    context('tamper', aiSettings),
  )
  const tampered = structuredClone(preview)
  const params = tampered.normalizedParams as { prompt: string; userPrompt: string; finalPrompt: string }
  params.prompt = '攻击者提示词'
  params.userPrompt = '攻击者提示词'
  params.finalPrompt = '攻击者提示词'
  tampered.paramsDigest = await paramsDigest(tampered.featureType, tampered.normalizedParams)
  await rejectsCode(f.preparation.validatePrepared(tampered), 'artifact_tampered')
})

test('预览存储失败时 fail closed，不返回未保存工件', async () => {
  const failingStore: TaskPreparationArtifactStorePort = {
    async get() { return undefined },
    async saveIfAbsent() { throw new Error('disk full') },
  }
  const f = fixture({ store: failingStore })
  await rejectsCode(f.preparation.prepare(
    { toolName: 'fashion_photo.create', args: { prompt: '不得泄漏未保存预览' } },
    context('store-fail', aiSettings),
  ), 'storage_failure')
  assert.equal(f.imageRequests, 0)
})

test('重试预览绑定原任务失败镜头、可信轮次、参数、素材、模型和模板', async () => {
  const f = fixture()
  const original = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '原始裂变' } },
    context('retry-source-preview', photoSettings),
  )
  const task = photoTask(original)
  f.bindTask(task, original)
  const before = JSON.stringify(task)
  const retry = await f.preparation.prepareRetry(
    { taskId: task.taskId, shotIds: ['shot_1'] },
    context('retry-one', {}, []),
  )

  assert.equal(retry.taskId, task.taskId)
  assert.deepEqual(retry.shotIds, ['shot_1'])
  assert.equal(retry.attempt, 3)
  assert.equal(retry.paramsDigest, original.paramsDigest)
  assert.deepEqual(retry.assetDigests, original.assetDigests)
  assert.equal(retry.resolvedModelId, original.resolvedModelId)
  assert.equal(retry.promptTemplateVersion, original.promptTemplateVersion)
  assert.deepEqual(retry.blockers, [])
  assert.equal(JSON.stringify(task), before)
  await f.preparation.validateRetry(retry)
  assert.equal(f.imageRequests, 0)
})

test('非内嵌模板的历史任务缺少 taskControls 证据时拒绝重试', async () => {
  const f = fixture({ taskControls: false })
  const original = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '历史模板不可补造' } },
    context('retry-missing-controls-source', photoSettings),
  )
  const task = photoTask(original)
  f.tasks.set(task.taskId, task)

  await rejectsCode(f.preparation.prepareRetry(
    { taskId: task.taskId, shotIds: ['shot_1'] },
    context('retry-missing-controls', {}, []),
  ), 'retry_state_changed')
})

test('garment 重试使用参数内嵌模板版本，并拒绝与 taskControls 矛盾的证据', async () => {
  const withoutResolver = fixture({ taskControls: false })
  const embeddedPreview = await withoutResolver.preparation.prepare(
    { toolName: 'garment_detail.create', args: { prompt: '保留袖口走线' } },
    context('garment-embedded-source', garmentSettings, ['main', 'ref-1']),
  )
  const embeddedTask = garmentTask(embeddedPreview)
  withoutResolver.tasks.set(embeddedTask.taskId, embeddedTask)
  const shotId = embeddedTask.shotProgress![0].shotId
  const retry = await withoutResolver.preparation.prepareRetry(
    { taskId: embeddedTask.taskId, shotIds: [shotId] },
    context('garment-embedded-retry', {}, []),
  )
  assert.equal(retry.promptTemplateVersion, embeddedPreview.promptTemplateVersion)

  const contradictoryControls: TaskFrozenControlResolver = {
    async resolve(task) {
      const params = task.params as unknown as { resolvedModelId: string }
      return {
        resolvedModelId: params.resolvedModelId,
        promptTemplateVersion: 'contradictory-template-v99',
      }
    },
  }
  const contradictory = fixture({ taskControls: contradictoryControls })
  const contradictoryPreview = await contradictory.preparation.prepare(
    { toolName: 'garment_detail.create', args: { prompt: '保留领口纹理' } },
    context('garment-contradiction-source', garmentSettings, ['main', 'ref-1']),
  )
  const contradictoryTask = garmentTask(contradictoryPreview)
  contradictory.tasks.set(contradictoryTask.taskId, contradictoryTask)
  await rejectsCode(contradictory.preparation.prepareRetry(
    { taskId: contradictoryTask.taskId, shotIds: [contradictoryTask.shotProgress![0].shotId] },
    context('garment-contradiction-retry', {}, []),
  ), 'retry_state_changed')
})

test('重试拒绝成功镜头、未知镜头、错误 taskId 和缺少 userId 的历史任务', async () => {
  const f = fixture()
  const original = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '重试限制' } },
    context('retry-restriction-source', photoSettings),
  )
  const task = photoTask(original)
  f.bindTask(task, original)

  await rejectsCode(f.preparation.prepareRetry(
    { taskId: task.taskId, shotIds: ['shot_2'] },
    context('retry-success', {}, []),
  ), 'retry_shot_not_failed')
  await rejectsCode(f.preparation.prepareRetry(
    { taskId: task.taskId, shotIds: ['shot_missing'] },
    context('retry-unknown', {}, []),
  ), 'retry_shot_unknown')

  f.tasks.set('requested-task', { ...task, taskId: 'different-task' })
  await rejectsCode(f.preparation.prepareRetry(
    { taskId: 'requested-task', shotIds: ['shot_1'] },
    context('retry-task-id-mismatch', {}, []),
  ), 'task_not_found')

  f.tasks.set('task-ownerless', { ...task, taskId: 'task-ownerless', userId: undefined })
  await rejectsCode(f.preparation.prepareRetry(
    { taskId: 'task-ownerless', shotIds: ['shot_1'] },
    context('retry-ownerless', {}, []),
  ), 'task_owner_missing')
})

test('多失败镜头重试加入确定性 blocker，镜头状态变化后旧预览失效', async () => {
  const f = fixture()
  const original = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '多镜头重试' } },
    context('retry-multiple-source', photoSettings),
  )
  const task = photoTask(original)
  task.status = 'failed'
  task.results = []
  task.resultAssetIds = []
  task.shotProgress![1] = {
    shotId: 'shot_2',
    label: '镜头二',
    status: 'failed',
    message: '也失败',
    retryAttempt: 1,
  }
  f.bindTask(task, original)
  const retry = await f.preparation.prepareRetry(
    { taskId: task.taskId, shotIds: ['shot_1', 'shot_2'] },
    context('retry-multiple', {}, []),
  )
  assert.equal(retry.estimatedResultCount, 2)
  assert.deepEqual(retry.blockers, [MULTIPLE_RESULTS_BLOCKER])

  task.shotProgress![0] = {
    shotId: 'shot_1',
    label: '镜头一',
    status: 'success',
    message: '后来成功',
    retryAttempt: 2,
  }
  await rejectsCode(f.preparation.validateRetry(retry), 'retry_shot_not_failed')
})

test('重试校验再次检查原任务素材摘要和当前模型可用性', async () => {
  const f = fixture()
  const original = await f.preparation.prepare(
    { toolName: 'photo_fission.create', args: { prompt: '重试新鲜度' } },
    context('retry-fresh-source', photoSettings),
  )
  const task = photoTask(original)
  f.bindTask(task, original)
  const retry = await f.preparation.prepareRetry(
    { taskId: task.taskId, shotIds: ['shot_1'] },
    context('retry-fresh', {}, []),
  )

  f.assets.get('main')!.height += 1
  await rejectsCode(f.preparation.validateRetry(retry), 'retry_state_changed')
  f.assets.get('main')!.height -= 1
  f.unavailableModels.add(retry.resolvedModelId!)
  await rejectsCode(f.preparation.validateRetry(retry), 'model_unavailable')
})
