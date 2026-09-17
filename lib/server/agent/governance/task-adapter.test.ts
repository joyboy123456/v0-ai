import assert from 'node:assert/strict'
import test from 'node:test'
import { assetDigest, paramsDigest, type PreviewArtifact, type ClassifyPayload } from '@/lib/agent/contracts'
import type { AssetRecord, GenerationTask } from '@/lib/types'
import type { TaskCommandPort } from '../ports'
import type { TaskPreparationWithRetryPort } from '../action/task-preparation'
import { createTaskAdapter, createVendorActionAdapter, preparedTaskControls } from './task-adapter'

const asset: AssetRecord = { assetId: 'a', userId: 'u', projectId: 'p', fileName: 'a.png', fileUrl: '/a.png', fileType: 'image/png', width: 1, height: 1, createdAt: '2026-09-17T00:00:00Z', taskId: null }
const p = { schemaVersion: 1, userId: 'u', featureType: 'ai-fashion-photo', normalizedParams: {}, blockers: [], estimatedResultCount: 1, resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'ai-fashion-photo-v1' } as unknown as PreviewArtifact

function adapter(options: { valid?: boolean; available?: boolean; blockers?: string[] } = {}) {
  const calls: string[] = []
  const commands: TaskCommandPort = {
    async createPreparedTask(value, key) { calls.push(`create:${key}`); return { params: value.normalizedParams } as GenerationTask },
    async retryPreparedShots() { calls.push('retry'); return {} as GenerationTask },
    async cancelTask() { calls.push('cancel'); return {} as GenerationTask },
  }
  const preparation = {
    async validatePrepared() { calls.push('validate'); if (options.valid === false) throw new Error('invalid') },
    async validateRetry() { throw new Error('invalid retry') },
  } as unknown as TaskPreparationWithRetryPort
  const port = createTaskAdapter({ preparation, commands,
    queries: { getAsset: async () => asset, getTask: async () => ({ taskId: 't', userId: 'u' } as GenerationTask) },
    availability: { isFeatureAvailable: async () => options.available !== false, isModelAvailable: async () => options.available !== false },
  })
  return { port, calls, preview: { ...p, blockers: options.blockers ?? [] } }
}

test('任务适配器只在验证冻结工件和当前可用性后调用写端口', async () => {
  const h = adapter()
  await h.port.createPreparedTask(h.preview, 'key')
  assert.deepEqual(h.calls, ['validate', 'create:key'])
})
for (const options of [{ valid: false }, { available: false }, { blockers: ['decision_gate:pose_prompt_not_supported'] }]) {
  test(`任务适配器 fail closed ${JSON.stringify(options)}`, async () => {
    const h = adapter(options)
    await assert.rejects(h.port.createPreparedTask(h.preview, 'key'))
    assert.ok(!h.calls.some((call) => call.startsWith('create')))
  })
}
test('历史模型与多张预览不能从适配器直接提交', async () => {
  const h = adapter()
  await assert.rejects(h.port.createPreparedTask({ ...h.preview, resolvedModelId: 'gemini-3.1-flash-image-preview' }, 'k'))
  await assert.rejects(h.port.createPreparedTask({ ...h.preview, estimatedResultCount: 2 }, 'k'))
  await assert.rejects(h.port.createPreparedTask({ ...h.preview, promptTemplateVersion: 'old-template-v0' }, 'k'))
  assert.ok(!h.calls.some((call) => call.startsWith('create')))
})
test('取消适配器不继承本地超管跨用户权限', async () => {
  const h = adapter()
  await assert.rejects(h.port.cancelTask('t', 'other'))
  assert.deepEqual(h.calls, [])
  await h.port.cancelTask('t', 'u')
  assert.deepEqual(h.calls, ['cancel'])
})
test('模板证据只读已持久化快照，不以当前模板为旧任务补证', async () => {
  const task = { featureType: 'ai-fashion-photo', params: {}, agentExecution: undefined } as unknown as GenerationTask
  await assert.rejects(preparedTaskControls.resolve(task), /真实冻结凭证/)
  const hash = await paramsDigest(task.featureType, task.params)
  task.agentExecution = { schemaVersion: 1, paramsDigest: hash, assetDigests: [], resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'historical-v3', normalizationSeed: null, requestDigest: 'hash', idempotencyKey: 'key' }
  assert.deepEqual(await preparedTaskControls.resolve(task), { resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'historical-v3' })
  task.agentExecution.paramsDigest = 'changed'
  await assert.rejects(preparedTaskControls.resolve(task))
})
test('分类/抠图每次重查归属与摘要，返回图片只能是同源会话地址', async () => {
  let current: AssetRecord | undefined = asset
  let calls = 0
  const port = createVendorActionAdapter({ assets: { getAsset: async () => current },
    classify: async (payload) => { calls++; return { status: 'fallback', assetId: payload.assetId, category: null, confidence: null } },
    prepareCutout: async () => { calls++; return { cutoutSessionId: 'cutout_1', preparedImageUrl: 'https://vendor-temp/secret' } },
  })
  const input: ClassifyPayload = { schemaVersion: 1, userId: 'u', sessionId: 's', messageId: 'm', assetId: 'a', assetDigest: await assetDigest(asset), intent: { schemaVersion: 1, intentId: 'i', userId: 'u', sessionId: 's', messageId: 'm', actionKind: 'classify', targetId: 'a', verifiedAt: '2026-09-17T00:00:00Z' } }
  assert.equal((await port.classify(input)).category, null)
  assert.equal((await port.prepareCutout({ ...input, scene: 'garment' })).preparedImageUrl, '/api/cutout-sessions/cutout_1/image')
  await assert.rejects(port.prepareCutout({ ...input, scene: 'person' }))
  current = { ...asset, width: 2 }
  await assert.rejects(port.classify(input))
  current = { ...asset, userId: 'another' }
  await assert.rejects(port.prepareCutout({ ...input, scene: 'garment' }))
  current = undefined
  await assert.rejects(port.classify(input))
  assert.equal(calls, 2)
})
