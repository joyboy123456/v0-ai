import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { normalizeAiFashionPhotoParams } from './ai-fashion-photo-service.ts'

function params(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userPrompt: '生成一张电商服装大片',
    promptMode: 'enhanced',
    model: 'gemini-3.1-flash-image-preview',
    referenceImageCount: 1,
    imageRatio: '3:4',
    resolution: '4k',
    ...patch,
  }
}

test('resultCount 缺省时默认 1 张、35 积分（兼容旧客户端）', () => {
  const normalized = normalizeAiFashionPhotoParams(params(), 1)
  assert.equal(normalized.resultCount, 1)
  assert.equal(normalized.creditsCost, 35)
})

test('resultCount=2 → creditsCost=70', () => {
  const normalized = normalizeAiFashionPhotoParams(params({ resultCount: 2 }), 1)
  assert.equal(normalized.resultCount, 2)
  assert.equal(normalized.creditsCost, 70)
})

test('resultCount=4 → creditsCost=140', () => {
  const normalized = normalizeAiFashionPhotoParams(params({ resultCount: 4 }), 1)
  assert.equal(normalized.resultCount, 4)
  assert.equal(normalized.creditsCost, 140)
})

test('非白名单出图数量直接拒绝', () => {
  assert.throws(
    () => normalizeAiFashionPhotoParams(params({ resultCount: 3 }), 1),
    /AI服装大片出图数量无效/,
  )
  assert.throws(
    () => normalizeAiFashionPhotoParams(params({ resultCount: 100 }), 1),
    /AI服装大片出图数量无效/,
  )
  assert.throws(
    () => normalizeAiFashionPhotoParams(params({ resultCount: '2' }), 1),
    /AI服装大片出图数量无效/,
  )
})
