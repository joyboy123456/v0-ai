import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isRetiredImageProvider,
  getAvailableProvidersForModel,
  beginProviderRequest,
  isGrsaiOnlyGptImageModel,
  isGrsaiImageModel,
  isImageProviderModelCompatible,
  isLaozhangImageModel,
  isQiniuImageModel,
  type ImageProvider,
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
} from './image-provider-pool.ts'

function makeProvider(overrides: Partial<ImageProvider> & Pick<ImageProvider, 'type'>): ImageProvider {
  return {
    id: `provider-${overrides.type}`,
    apiKey: 'sk-test',
    maxIpm: 999_999,
    maxRpm: 999_999,
    weight: 1,
    enabled: true,
    timeoutMs: 10_000,
    ...overrides,
  }
}

test('isGrsaiOnlyGptImageModel 精确匹配 gpt-image-2.5 系列', () => {
  assert.equal(isGrsaiOnlyGptImageModel('gpt-image-2.5'), true)
  assert.equal(isGrsaiOnlyGptImageModel('gpt-image-2.5-sunburst'), true)
  assert.equal(isGrsaiOnlyGptImageModel('openai/gpt-image-2.5-flare'), true)
  assert.equal(isGrsaiOnlyGptImageModel('GPT-Image-2.5-Sunburst'), true)
  assert.equal(isGrsaiOnlyGptImageModel('gpt-image-2'), false)
  assert.equal(isGrsaiOnlyGptImageModel('gpt-image-2-vip'), false)
  assert.equal(isGrsaiOnlyGptImageModel(undefined), false)
})

test('isGrsaiImageModel 放行 nano-banana 与 gpt-image-2.5 系列', () => {
  assert.equal(isGrsaiImageModel('nano-banana-2'), true)
  assert.equal(isGrsaiImageModel('nano-banana-pro'), true)
  assert.equal(isGrsaiImageModel('gpt-image-2.5-sunburst'), true)
  assert.equal(isGrsaiImageModel('gpt-image-2.5'), true)
  // 旧 gpt-image-2 尚未迁移到 grsai，不能放行
  assert.equal(isGrsaiImageModel('gpt-image-2'), false)
  assert.equal(isGrsaiImageModel('gemini-3.1-flash-image-preview'), false)
})

test('isQiniuImageModel / isLaozhangImageModel 排除 gpt-image-2.5（防止 failover 误打已废渠道）', () => {
  assert.equal(isQiniuImageModel('gpt-image-2'), true)
  assert.equal(isQiniuImageModel('gpt-image-2.5-sunburst'), false)
  assert.equal(isQiniuImageModel('gemini-3.1-flash-image-preview'), true)

  assert.equal(isLaozhangImageModel('gpt-image-2'), true)
  assert.equal(isLaozhangImageModel('gpt-image-2.5-sunburst'), false)
  assert.equal(isLaozhangImageModel('gemini-3-pro-image-preview'), true)
})

test('isImageProviderModelCompatible 路由矩阵：gpt-image-2.5-sunburst 只兼容 grsai', () => {
  const model = 'gpt-image-2.5-sunburst'
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'grsai' }), model), true)
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'laozhang' }), model), false)
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'openai' }), model), false)
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'google' }), model), false)
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'volces' }), model), false)
})

test('isImageProviderModelCompatible 停用老张且保留其他模型路由', () => {
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'grsai' }), 'nano-banana-2'), true)
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'laozhang' }), 'gpt-image-2'), false)
  assert.equal(
    isImageProviderModelCompatible(makeProvider({ type: 'google' }), 'gemini-3.1-flash-image-preview'),
    true,
  )
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'grsai' }), 'gpt-image-2'), false)
})

test('停用老张，包括 google 兼容渠道，Grsai 保持可用', () => {
  for (const provider of [
    makeProvider({ type: 'laozhang' }),
    makeProvider({ type: 'google', id: 'laozhang-gemini-1' }),
    makeProvider({ type: 'google', baseUrl: 'https://api.laozhang.ai/v1beta' }),
  ]) {
    assert.equal(isRetiredImageProvider(provider), true)
    assert.equal(isImageProviderModelCompatible(provider, 'gemini-3.1-flash-image-preview'), false)
  }
  assert.equal(isRetiredImageProvider(makeProvider({ type: 'grsai' })), false)
  assert.equal(isImageProviderModelCompatible(makeProvider({ type: 'grsai' }), 'nano-banana-2'), true)
})

test('渠道池排除老张，旧任务无法直接请求，NB2 仅选择 Grsai', () => {
  const previous = process.env.IMAGE_PROVIDERS
  process.env.IMAGE_PROVIDERS = JSON.stringify([
    makeProvider({ id: 'laozhang-gemini-1', type: 'google' }),
    makeProvider({ id: 'grsai-1', type: 'grsai' }),
  ])
  try {
    assert.deepEqual(getAvailableProvidersForModel('nano-banana-2').map(p => p.id), ['grsai-1'])
    assert.deepEqual(getAvailableProvidersForModel('gemini-3.1-flash-image-preview'), [])
    assert.equal(beginProviderRequest('laozhang-gemini-1'), null)
  } finally {
    if (previous === undefined) delete process.env.IMAGE_PROVIDERS
    else process.env.IMAGE_PROVIDERS = previous
  }
})
