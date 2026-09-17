import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { AiFashionPhotoParams, AssetRecord, PhotoFissionParams } from '@/lib/types'
import { normalizeAiFashionPhotoParams } from '@/lib/server/ai-fashion-photo-service'
import { normalizePhotoFissionParams } from '@/lib/server/photo-fission-service'
import { normalizePoseFissionParams } from '@/lib/server/pose-fission-service'
import { normalizeGarmentDetailParams } from '@/lib/server/garment-detail-service'
import { approvalDigest, assetDigest, canonicalize, digest, paramsDigest, paramsDigestPayload, requestDigest,
  toJsonValue, type ApprovalReceipt, type GovernedAction, type PreviewArtifact } from './contracts'

const params: AiFashionPhotoParams = {
  prompt: '保留服装款式', userPrompt: '保留服装款式', finalPrompt: '保留服装款式', promptMode: 'raw',
  model: 'nano-banana-2', referenceImageCount: 1, imageRatio: '3:4', resolution: '2k', resultCount: 1, creditsCost: 35,
}

async function previewFixture(): Promise<PreviewArtifact> {
  return {
    schemaVersion: 1, proposalId: 'proposal_1', version: 1, userId: 'user_1', sessionId: 'session_1',
    messageId: 'message_1', toolName: 'fashion_photo.create', featureType: 'ai-fashion-photo',
    normalizedParams: structuredClone(params), inputAssetIds: ['asset_1'], assetDigests: ['asset_digest_1'],
    paramsDigest: await paramsDigest('ai-fashion-photo', params), policyVersion: 'policy-v1',
    estimatedResultCount: 1, normalizationSeed: 'seed-1', blockers: [], riskNotices: [],
    createdAt: '2026-09-16T00:00:00.000Z', expiresAt: '2026-09-16T00:30:00.000Z',
  }
}

async function receiptFor(preview: PreviewArtifact): Promise<ApprovalReceipt> {
  return {
    schemaVersion: 1, approvalId: 'approval_1', userId: preview.userId, proposalId: preview.proposalId,
    previewVersion: preview.version, paramsDigest: preview.paramsDigest, assetDigests: preview.assetDigests,
    requestDigest: await requestDigest({ actionKind: 'generate', payload: preview }),
    approvedAt: '2026-09-16T00:01:00.000Z',
  }
}

test('canonical 递归排序、保留数组顺序，SHA-256 使用 UTF-8 小写 hex', async () => {
  const left = { schemaVersion: 1, data: { z: ['中文', { b: 2, a: 1 }], a: true } }
  const right = { data: { a: true, z: ['中文', { a: 1, b: 2 }] }, schemaVersion: 1 }
  assert.equal(canonicalize(left), canonicalize(right))
  assert.equal(await digest(left), await digest(right))
  assert.notEqual(await digest({ schemaVersion: 1, list: [1, 2] }), await digest({ schemaVersion: 1, list: [2, 1] }))
  assert.equal(await digest(left), createHash('sha256').update(canonicalize(left), 'utf8').digest('hex'))
  assert.match(await digest(left), /^[a-f0-9]{64}$/)
  assert.equal(canonicalize({ '2': 2, '10': 10 }), '{"10":10,"2":2}')
  const shared = { safe: 1 }
  assert.equal(canonicalize([shared, shared]), '[{"safe":1},{"safe":1}]')
})

test('canonical 拒绝非法值、循环、隐藏行为和稀疏数组且不执行 getter', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  let executed = 0
  const accessor = { get attack() { executed++; return 'hidden' } }
  const toJSON = { toJSON() { executed++; return {} } }
  const hidden = Object.defineProperty({}, 'secret', { value: 1 })
  const withSymbol = { [Symbol('hidden')]: 1 }
  const extraArray = Object.assign([1], { extra: 2 })
  const invalid = [undefined, () => 1, NaN, Infinity, -Infinity, BigInt(1), Symbol('bad'), cycle,
    new Date(), new Map(), new Set(), new Number(1), new (class { field = 1 })(), accessor, toJSON,
    hidden, withSymbol, extraArray, Array(2), [undefined], { value: undefined }]
  for (const value of invalid) assert.throws(() => canonicalize(value), TypeError)
  assert.equal(executed, 0)
})

test('digest 要求根版本且版本变化改变摘要', async () => {
  for (const value of [{}, [], { schemaVersion: 0 }, { schemaVersion: 1.2 }, { schemaVersion: '1' }]) {
    await assert.rejects(digest(value), /schemaVersion/)
  }
  assert.notEqual(await digest({ schemaVersion: 1, a: 1 }), await digest({ schemaVersion: 2, a: 1 }))
})

test('资产摘要忽略签名 URL 但绑定身份、尺寸、时间与 taskId', async () => {
  const asset: AssetRecord = {
    assetId: 'asset_1', userId: 'user_1', projectId: 'project_1', fileName: 'input.png',
    fileUrl: 'https://example.test/a?sig=old', fileType: 'image/png', width: 800, height: 1000,
    createdAt: '2026-09-16T00:00:00.000Z',
  }
  const original = await assetDigest(asset)
  assert.equal(original, await assetDigest({ ...asset, fileUrl: 'https://example.test/a?sig=new' } as AssetRecord))
  assert.equal(original, await assetDigest({ ...asset, taskId: null }))
  for (const patch of [{ assetId: 'other' }, { userId: 'other' }, { width: 801 }, { height: 1001 },
    { createdAt: '2026-09-16T00:01:00.000Z' }, { taskId: 'task_1' }]) {
    assert.notEqual(original, await assetDigest({ ...asset, ...patch }))
  }
})

test('完整请求与批准绑定模型、张数、素材、版本、策略、seed 和有效期', async () => {
  const original = await previewFixture()
  const originalReceipt = await receiptFor(original)
  const originalApproval = await approvalDigest(originalReceipt)
  const patches: Partial<PreviewArtifact>[] = [
    { normalizedParams: { ...params, model: 'nano-banana-pro' } },
    { normalizedParams: { ...params, resultCount: 2 } },
    { normalizedParams: { ...params, userPrompt: '新的提示词' } },
    { inputAssetIds: ['asset_2'] }, { assetDigests: ['changed'] }, { version: 2 },
    { policyVersion: 'policy-v2' }, { estimatedResultCount: 2 }, { normalizationSeed: 'seed-2' },
    { resolvedModelId: 'nano-banana-pro' }, { promptTemplateVersion: 'template-v2' },
    { expiresAt: '2026-09-16T00:31:00.000Z' }, { blockers: ['approval_required'] },
  ]
  for (const patch of patches) {
    const receipt = await receiptFor({ ...original, ...patch })
    assert.notEqual(receipt.requestDigest, originalReceipt.requestDigest)
    assert.notEqual(await approvalDigest(receipt), originalApproval)
  }
  assert.notEqual(await approvalDigest({ ...originalReceipt, approvalId: 'another' }), originalApproval)
  assert.notEqual(await approvalDigest({ ...originalReceipt, approvedAt: '2026-09-16T00:02:00.000Z' }), originalApproval)
})

test('已声明可选字段缺失和 undefined 补 null，必需字段 undefined 仍拒绝', async () => {
  const preview = await previewFixture()
  assert.equal(await requestDigest({ actionKind: 'generate', payload: preview }),
    await requestDigest({ actionKind: 'generate', payload: { ...preview, resolvedModelId: undefined, promptTemplateVersion: undefined } }))
  await assert.rejects(requestDigest({ actionKind: 'generate', payload: { ...preview, policyVersion: undefined } } as unknown as GovernedAction))
  await assert.rejects(paramsDigest('ai-fashion-photo', { ...params, model: undefined } as unknown as AiFashionPhotoParams))
  let called = false
  const injected = Object.defineProperty({ ...preview }, 'normalizedParams', { enumerable: true, get() { called = true; return params } })
  await assert.rejects(requestDigest({ actionKind: 'generate', payload: injected }), /accessors/)
  assert.equal(called, false)
})

test('真实 normalizer 产物兼容 photo 嵌套可选字段、pose 与 garment-detail', async () => {
  const fashion = normalizeAiFashionPhotoParams({ prompt: '服装展示', promptMode: 'raw', model: 'nano-banana-2',
    referenceImageCount: 1, imageRatio: '3:4', resolution: '2k', resultCount: 1 }, 1)
  const photo = normalizePhotoFissionParams({ model: 'nano-banana-2', category: 'childrens', childrensCategory: 'dress',
    imageRatio: '3:4', resolution: '2k', resultCount: 9 }, 1, ['asset_1'])
  const pose = normalizePoseFissionParams({ model: 'nano-banana-2', imageRatio: '3:4', resolution: '2k',
    poses: [{ id: 'pose_1', url: '/poses/pose_1.png', name: '站姿', bodyPart: 'full' }] }, 1)
  const detail = await normalizeGarmentDetailParams({ category: 'tops', algorithmModelId: 'pro-v1',
    resolution: '2k', imageRatio: '1:1', userPrompt: '保留面料纹理' }, ['asset_1', 'detail_ref'], {
    resolveModel: () => ({ definition: { algorithmModelId: 'pro-v1', algorithmModelName: '专业版',
      tier: 'professional', resolutions: ['2k', '4k'] }, resolvedModelId: 'nano-banana-pro' }),
  })
  for (const [feature, normalized] of [
    ['ai-fashion-photo', fashion], ['photo-fission', photo], ['pose-fission', pose], ['garment-detail', detail],
  ] as const) {
    const original = await paramsDigest(feature, normalized)
    assert.match(original, /^[a-f0-9]{64}$/)
    assert.equal(original, await paramsDigest(feature, JSON.parse(JSON.stringify(normalized))))
  }
  const photoPayload = paramsDigestPayload('photo-fission', photo) as { normalizedParams: PhotoFissionParams }
  assert.equal(photoPayload.normalizedParams.pantsPoseDrawSeed, null)
  assert.equal(photoPayload.normalizedParams.shotPlan[0].pantsPoseCardId, null)
  const explicitOptional = structuredClone(photo)
  explicitOptional.shotPlan[0].pantsPoseCardId = undefined
  assert.equal(await paramsDigest('photo-fission', photo), await paramsDigest('photo-fission', explicitOptional))
  assert.notEqual(await paramsDigest('garment-detail', detail), await paramsDigest('garment-detail', { ...detail, resolvedModelId: 'other-model' }))
  assert.notEqual(await paramsDigest('pose-fission', pose), await paramsDigest('pose-fission', { ...pose, poses: [{ ...pose.poses[0], id: 'pose_2' }] }))
})

test('photo shotPlan 不能通过 map 属性和空洞执行隐藏行为', async () => {
  let executed = false
  const shots = Array(1)
  shots.map = () => { executed = true; return [] }
  await assert.rejects(paramsDigest('photo-fission', { shotPlan: shots } as PhotoFissionParams), /array properties/)
  assert.equal(executed, false)
})

test('非生成动作摘要独立绑定动作类型和已验证意图；重试绑定镜头及轮次', async () => {
  const intent = { schemaVersion: 1 as const, intentId: 'intent_1', userId: 'user_1', sessionId: 'session_1',
    messageId: 'message_1', actionKind: 'classify' as const, targetId: 'asset_1', verifiedAt: '2026-09-16T00:00:00.000Z' }
  const classify: GovernedAction = { actionKind: 'classify', payload: { schemaVersion: 1, userId: 'user_1',
    sessionId: 'session_1', messageId: 'message_1', assetId: 'asset_1', assetDigest: 'asset_digest', intent } }
  assert.notEqual(await requestDigest(classify), await requestDigest({ ...classify,
    payload: { ...classify.payload, intent: { ...intent, targetId: 'asset_2' } } }))
  const preview = await previewFixture()
  const { normalizedParams: _params, normalizationSeed: _seed, inputAssetIds: _assets, ...retryBase } = preview
  const retry: GovernedAction = { actionKind: 'retry_shots', payload: { ...retryBase, taskId: 'task_1', shotIds: ['shot_1'], attempt: 1 } }
  assert.notEqual(await requestDigest(retry), await requestDigest({ ...retry, payload: { ...retry.payload, attempt: 2 } }))
  assert.notEqual(await requestDigest(retry), await requestDigest({ ...retry, payload: { ...retry.payload, shotIds: ['shot_2'] } }))
  assert.notEqual(await requestDigest(retry), await requestDigest({ actionKind: 'generate', payload: preview }))
})

test('上下文复制保留 JSON 语义并拒绝含 undefined 的内容', () => {
  const value = { text: '你好', nested: [true, null, 1] }
  const cloned = toJsonValue(value)
  assert.deepEqual(cloned, value)
  assert.notEqual(cloned, value)
  assert.throws(() => toJsonValue({ hidden: undefined }), TypeError)
})
