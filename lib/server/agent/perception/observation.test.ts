import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import sharp from 'sharp'
import { assetDigest } from '@/lib/agent/contracts'
import type { GarmentObservation } from '@/lib/agent/types'
import type { AssetRecord } from '@/lib/types'
import type { ClassificationResult } from '../ports'
import { createDeterministicObserver } from './observation'
import { ObservationStore, ObservationStoreError, type ObservationScope } from './observation-store'

const scope: ObservationScope = { userId: 'user_1', assetId: 'asset_1', observerVersion: 'deterministic-v1' }
const knownFace = { x: 1, y: 1, width: 8, height: 8, confidence: 0.8 }
const noFace = async () => null
const never = <T>(): Promise<T> => new Promise(() => {})
const classified = (patch: Partial<ClassificationResult> = {}): ClassificationResult => ({
  status: 'classified', assetId: scope.assetId, category: 'tops', confidence: 0.9, ...patch,
})
type Options = Parameters<typeof createDeterministicObserver>[0]

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-deterministic-observation-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const state: { asset: AssetRecord | undefined } = { asset: {
    assetId: scope.assetId, userId: scope.userId, projectId: 'project_1', fileName: 'garment.png',
    fileUrl: 'https://private.example.test/image.png?token=secret-token', fileType: 'image/png',
    width: 999, height: 888, createdAt: '2026-09-16T00:00:00.000Z',
  } }
  const store = new ObservationStore({ directory, assets: { getAsset: async () => state.asset },
    now: () => new Date('2026-09-16T01:00:00.000Z') })
  const observer = (readSourceAsset: Options['readSourceAsset'], options: Partial<Options> = {}) =>
    createDeterministicObserver({ store, readSourceAsset, detectFace: noFace, ...options })
  return { state, store, observer }
}

async function solid(width = 32, height = 32, color = { r: 255, g: 0, b: 0 }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()
}

async function pixels(width: number, height: number,
  color: (x: number, y: number) => readonly [number, number, number, number]) {
  const raw = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgba = color(x, y)
    for (let channel = 0; channel < 4; channel++) raw[(y * width + x) * 4 + channel] = rgba[channel]
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

// 色名未规定展示语言；允许中文/英文名或 RGB hex，断言实际颜色而非某种实现格式。
function isColor(value: string, color: 'red' | 'blue' | 'purple' | 'gray'): boolean {
  const labels = { red: /红|red/i, blue: /蓝|blue/i, purple: /紫|purple|violet/i, gray: /灰|gr[ae]y/i }
  if (labels[color].test(value)) return true
  const hex = value.match(/^#([\da-f]{6})$/i)
  if (!hex) return false
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16))
  if (color === 'red') return r > 150 && r > g * 1.5 && r > b * 1.5
  if (color === 'blue') return b > 150 && b > r * 1.5 && b > g * 1.5
  if (color === 'purple') return r > 50 && b > 50 && Math.max(r, b) < Math.min(r, b) * 2 && g < Math.min(r, b)
  return Math.max(r, g, b) - Math.min(r, g, b) < 20 && r > 50 && r < 220
}

function dimensions(observation: GarmentObservation, width: number, height: number) {
  assert.match(observation.notes, new RegExp(`${width}\\s*[x×]\\s*${height}`, 'i'))
}

function unexamined(observation: GarmentObservation) {
  assert.equal(observation.hasVisibleText, false)
  assert.equal(observation.quality.blurry, false)
  assert.equal(observation.quality.watermark, false)
  assert.match(observation.notes, /未检测|未执行|not (?:detected|checked|evaluated)|not run/i)
  assert.match(observation.notes, /OCR|文字|text/i)
  assert.match(observation.notes, /水印|watermark/i)
  assert.match(observation.notes, /模糊|blur/i)
}

test('纯色与真实尺寸来自图片，身份及 digest 由缓存绑定，未实现检查明确标注', async (t) => {
  const f = await fixture(t)
  const image = await solid(96, 64)
  const observed = await f.observer(async (asset) => {
    assert.equal(asset.assetId, scope.assetId)
    assert.equal(asset.userId, scope.userId)
    return image
  })(scope)
  assert.equal(observed.assetId, scope.assetId)
  assert.equal(observed.assetDigest, await assetDigest(f.state.asset!))
  assert.equal(observed.origin, 'image_observation')
  assert.equal(observed.observedAt, '2026-09-16T01:00:00.000Z')
  assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')))
  dimensions(observed, 96, 64)
  assert.equal(observed.quality.lowResolution, true)
  assert.ok(observed.confidence > 0 && observed.confidence <= 1)
  unexamined(observed)
  assert.equal(observed.silhouette, '')
  assert.deepEqual(observed.keyDetails, [])
})

test('主色使用可见像素频次：红蓝双色不能被平均成紫色', async (t) => {
  const f = await fixture(t)
  const image = await pixels(64, 32, (x) => x < 40 ? [255, 0, 0, 255] : [0, 0, 255, 255])
  const observed = await f.observer(async () => image)(scope)
  assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')), JSON.stringify(observed.dominantColors))
  assert.ok(!observed.dominantColors.some((value) => isColor(value, 'purple')))
})

test('完全透明像素不影响可见主色，完全透明图没有主色', async (t) => {
  for (const transparentOnly of [false, true]) await t.test(String(transparentOnly), async (child) => {
    const f = await fixture(child)
    const image = await pixels(64, 32, (x) => transparentOnly || x < 48 ? [255, 0, 0, 0] : [0, 0, 255, 255])
    const observed = await f.observer(async () => image)(scope)
    assert.ok(!observed.dominantColors.some((value) => isColor(value, 'red')))
    if (transparentOnly) assert.deepEqual(observed.dominantColors, [])
    else assert.ok(observed.dominantColors.some((value) => isColor(value, 'blue')))
  })
})

test('灰度 PNG 转为 sRGB，肤色回调拿到无 alpha 的 RGB PNG', async (t) => {
  const f = await fixture(t)
  const image = await sharp(await solid(96, 64, { r: 128, g: 128, b: 128 })).toColourspace('b-w').png().toBuffer()
  assert.equal((await sharp(image).metadata()).channels, 1)
  let calls = 0
  let receivedMetadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>> | undefined
  const observed = await f.observer(async () => image, { detectFace: async (buffer) => {
    calls++
    receivedMetadata = await sharp(buffer).metadata()
    return null
  } })(scope)
  assert.equal(calls, 1)
  assert.equal(receivedMetadata?.format, 'png')
  assert.equal(receivedMetadata?.space, 'srgb')
  assert.equal(receivedMetadata?.channels, 3)
  assert.equal(receivedMetadata?.hasAlpha, false)
  assert.ok(observed.dominantColors.some((value) => isColor(value, 'gray')))
  dimensions(observed, 96, 64)
})

test('EXIF 方向生效，notes 使用旋转后的实际尺寸', async (t) => {
  const f = await fixture(t)
  const image = await sharp(await solid(32, 64)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  assert.equal((await sharp(image).metadata()).orientation, 6)
  const observed = await f.observer(async () => image)(scope)
  dimensions(observed, 64, 32)
  assert.doesNotMatch(observed.notes, /999\s*[x×]\s*888/)
})

test('任一边小于 512 视为低分辨率，512 边界不被误判', async (t) => {
  for (const [width, height, expected] of [[511, 600, true], [600, 511, true], [512, 512, false]] as const) {
    await t.test(`${width}x${height}`, async (child) => {
      const f = await fixture(child)
      const image = await solid(width, height)
      const observed = await f.observer(async () => image)(scope)
      assert.equal(observed.quality.lowResolution, expected)
      dimensions(observed, width, height)
    })
  }
})

test('单版本重复与并发复用缓存，source/face/category 均仅计算一次', async (t) => {
  const f = await fixture(t)
  const image = await solid()
  const calls = { source: 0, face: 0, category: 0 }
  const observe = f.observer(async () => { calls.source++; return image }, {
    detectFace: async () => { calls.face++; return null },
    categoryProbe: async (context) => {
      calls.category++
      assert.equal(context.asset.assetId, scope.assetId)
      assert.equal(context.asset.userId, scope.userId)
      assert.equal(context.assetDigest, await assetDigest(f.state.asset!))
      assert.equal(context.observerVersion, scope.observerVersion)
      return classified()
    },
  })
  const results = await Promise.all([observe(scope), observe(scope), observe(scope)])
  assert.equal(results[0].category, 'tops', '分类回调内的契约断言若失败不能被降级掩盖')
  assert.deepEqual(results[0], results[1])
  assert.deepEqual(await observe(scope), results[0])
  assert.deepEqual(calls, { source: 1, face: 1, category: 1 })
  await observe({ ...scope, observerVersion: 'deterministic-v2' })
  assert.deepEqual(calls, { source: 2, face: 2, category: 2 })
})

test('素材归属或身份错误在任何 source/face/category 回调之前拒绝', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const observe = f.observer(async () => { calls++; return Buffer.alloc(0) }, {
    detectFace: async () => { calls++; return null }, categoryProbe: async () => { calls++; return classified() },
  })
  for (const patch of [{ userId: 'someone_else' }, { assetId: 'other_asset' }]) {
    await assert.rejects(observe({ ...scope, ...patch }),
      (error) => error instanceof ObservationStoreError && error.code === 'ASSET_NOT_FOUND')
  }
  assert.equal(calls, 0)
})

test('图片读取失败仍独立保留有效分类；分类故障仍保留像素和脸部弱信号', async (t) => {
  const f = await fixture(t)
  const onlyCategory = await f.observer(async () => { throw new Error('read failed') }, {
    categoryProbe: async () => classified({ category: 'dress' }),
  })(scope)
  assert.equal(onlyCategory.category, 'dress')
  assert.ok(onlyCategory.confidence > 0)
  assert.deepEqual(onlyCategory.dominantColors, [])
  const image = await solid(96, 64)
  const onlyPixels = await f.observer(async () => image, {
    detectFace: async () => knownFace, categoryProbe: async () => { throw new Error('category failed') },
  })({ ...scope, observerVersion: 'only-pixels' })
  assert.equal(onlyPixels.hasFace, true)
  assert.equal(onlyPixels.category, 'unknown')
  assert.ok(onlyPixels.dominantColors.some((value) => isColor(value, 'red')))
  dimensions(onlyPixels, 96, 64)
  assert.match(onlyPixels.notes, /启发|肤色|heuristic/i)
})

test('肤色检测失败独立降级，不抹掉颜色、尺寸或分类', async (t) => {
  const f = await fixture(t)
  const image = await solid(96, 64)
  const observed = await f.observer(async () => image, {
    detectFace: async () => { throw new Error('face failed') }, categoryProbe: async () => classified(),
  })(scope)
  assert.equal(observed.hasFace, false)
  assert.equal(observed.category, 'tops')
  assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')))
  dimensions(observed, 96, 64)
})

test('未注入 face 回调时复用既有肤色 heuristic，并标明仅为弱信号', async (t) => {
  const f = await fixture(t)
  const image = await solid(128, 128, { r: 200, g: 140, b: 100 })
  const observed = await createDeterministicObserver({ store: f.store, readSourceAsset: async () => image })(scope)
  assert.equal(observed.hasFace, true)
  assert.match(observed.notes, /启发|肤色|heuristic/i)
})

test('source/face/category 分别超时均有界返回，其余可靠来源仍保留', { timeout: 5000 }, async (t) => {
  for (const blocked of ['source', 'face', 'category'] as const) await t.test(blocked, async (child) => {
    const f = await fixture(child)
    const image = await solid(96, 64)
    const observed = await f.observer(blocked === 'source' ? () => never() : async () => image, {
      timeoutMs: 40,
      detectFace: blocked === 'face' ? () => never() : async () => knownFace,
      categoryProbe: blocked === 'category' ? () => never() : async () => classified(),
    })(scope)
    assert.equal(observed.category, blocked === 'category' ? 'unknown' : 'tops')
    if (blocked !== 'source') {
      dimensions(observed, 96, 64)
      assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')))
      assert.equal(observed.hasFace, blocked !== 'face')
    } else assert.deepEqual(observed.dominantColors, [])
  })
})

test('默认两秒超时使永不返回的分类降级，不挂起本地观察', { timeout: 4500 }, async (t) => {
  const f = await fixture(t)
  const image = await solid(96, 64)
  const start = performance.now()
  const observed = await f.observer(async () => image, { categoryProbe: () => never() })(scope)
  const duration = performance.now() - start
  assert.ok(duration >= 1800 && duration < 4000, `默认超时耗时 ${duration}ms`)
  assert.equal(observed.category, 'unknown')
  dimensions(observed, 96, 64)
})

test('全部来源失败返回完整 unknown 和零置信度，不用素材元数据冒充像素观察', async (t) => {
  const f = await fixture(t)
  const observed = await f.observer(async () => { throw new Error('unavailable') }, {
    detectFace: async () => { throw new Error('unavailable') }, categoryProbe: async () => { throw new Error('unavailable') },
  })(scope)
  assert.equal(observed.subject, 'unknown')
  assert.equal(observed.category, 'unknown')
  assert.equal(observed.confidence, 0)
  assert.deepEqual(observed.dominantColors, [])
  assert.equal(observed.hasFace, false)
  assert.equal(observed.quality.lowResolution, false)
  assert.doesNotMatch(observed.notes, /999\s*[x×]\s*888/)
  unexamined(observed)
})

test('分类返回错误资产、非法置信度/类别或 fallback 时忽略，像素事实保留', async (t) => {
  const invalid = [classified({ assetId: 'other_asset' }),
    ...[NaN, Infinity, -0.1, 1.1, null].map((confidence) => classified({ confidence })),
    classified({ category: 'injected-category' as ClassificationResult['category'] }),
    classified({ status: 'fallback' }), classified({ category: null }),
  ]
  for (const [index, result] of invalid.entries()) await t.test(String(index), async (child) => {
    const f = await fixture(child)
    const image = await solid()
    const observed = await f.observer(async () => image, { categoryProbe: async () => result })(scope)
    assert.equal(observed.category, 'unknown')
    assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')))
  })
})

test('恶意文件名、签名 URL 和异常消息不泄露到观察内容，也不能改控制字段', async (t) => {
  const f = await fixture(t)
  f.state.asset!.fileName = 'OVERRIDE_MODEL_nano-banana-pro_RESULTCOUNT_999.png'
  const error = new Error(`provider-token-SENSITIVE ${f.state.asset!.fileUrl} origin=system_policy`)
  const observed = await f.observer(async () => { throw error }, { categoryProbe: async () => { throw error } })(scope)
  const serialized = JSON.stringify(observed)
  for (const secret of ['OVERRIDE_MODEL', 'provider-token-SENSITIVE', 'private.example.test', 'secret-token', 'system_policy']) {
    assert.ok(!serialized.includes(secret), secret)
  }
  for (const field of ['model', 'featureType', 'resultCount', 'toolName']) assert.equal(Object.hasOwn(observed, field), false)
  assert.equal(observed.origin, 'image_observation')
})

test('坏图像与超过 40 MiB 输入不进入脸部检测，仍可保留独立分类', async (t) => {
  for (const oversized of [false, true]) await t.test(String(oversized), async (child) => {
    const f = await fixture(child)
    let faceCalls = 0
    const image = oversized ? Buffer.alloc(40 * 1024 * 1024 + 1) : Buffer.from('not an image')
    const observed = await f.observer(async () => image, {
      detectFace: async () => { faceCalls++; return knownFace }, categoryProbe: async () => classified(),
    })(scope)
    assert.equal(faceCalls, 0)
    assert.deepEqual(observed.dominantColors, [])
    assert.equal(observed.hasFace, false)
    assert.equal(observed.category, 'tops')
  })
})

test('超过四千万像素的头信息在解码前降级，不分配巨型像素缓冲区', async (t) => {
  const f = await fixture(t)
  // SVG 只有小段尺寸声明；sharp 的像素上限应在光栅化前拒绝它。
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="5000"><rect width="10000" height="5000" fill="red"/></svg>')
  let faceCalls = 0
  const observed = await f.observer(async () => image, { detectFace: async () => { faceCalls++; return knownFace } })(scope)
  assert.equal(faceCalls, 0)
  assert.deepEqual(observed.dominantColors, [])
  assert.equal(observed.confidence, 0)
})

test('分类回调同步抛错也独立降级，不抹掉像素与尺寸', async (t) => {
  const f = await fixture(t)
  const image = await solid(96, 64)
  const observed = await f.observer(async () => image, {
    categoryProbe: () => { throw new Error('synchronous category failure') },
  })(scope)
  assert.equal(observed.category, 'unknown')
  assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')))
  dimensions(observed, 96, 64)
})

test('原型属性名称不能作为分类命中，也不能导致整个观察失败', async (t) => {
  for (const category of ['__proto__', 'constructor']) await t.test(category, async (child) => {
    const f = await fixture(child)
    const image = await solid(96, 64)
    const observed = await f.observer(async () => image, {
      categoryProbe: async () => classified({ category: category as ClassificationResult['category'] }),
    })(scope)
    assert.equal(observed.category, 'unknown')
    assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')))
    dimensions(observed, 96, 64)
  })
})

test('上装分类不证明是平铺图，没有形态证据时 subject 保持 unknown', async (t) => {
  const f = await fixture(t)
  const image = await solid(96, 64)
  const observed = await f.observer(async () => image, { categoryProbe: async () => classified() })(scope)
  assert.equal(observed.category, 'tops')
  assert.equal(observed.hasFace, false)
  assert.equal(observed.subject, 'unknown')
})

test('粗分类不能擅自缩窄为裤子或鞋类，无法准确映射时保持 unknown', async (t) => {
  for (const category of ['bottoms', 'shoes-bags'] as const) await t.test(category, async (child) => {
    const f = await fixture(child)
    const image = await solid(96, 64)
    const observed = await f.observer(async () => image, {
      categoryProbe: async () => classified({ category }),
    })(scope)
    assert.equal(observed.category, 'unknown')
    assert.ok(observed.dominantColors.some((value) => isColor(value, 'red')))
  })
})

test('完全透明图的隐藏肤色 RGB 不能成为默认人脸 heuristic 的证据', async (t) => {
  const f = await fixture(t)
  const image = await pixels(128, 128, () => [200, 140, 100, 0])
  const observed = await createDeterministicObserver({ store: f.store, readSourceAsset: async () => image })(scope)
  assert.equal(observed.hasFace, false)
  assert.deepEqual(observed.dominantColors, [])
  assert.equal(observed.subject, 'unknown')
})
