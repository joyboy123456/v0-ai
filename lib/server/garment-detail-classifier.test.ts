import assert from 'node:assert/strict'
import test from 'node:test'

import sharp from 'sharp'

import type { AssetRecord, ClothCategory } from '../types.ts'
import type {
  AliyunCutoutConfig,
  PreparedAliyunCutoutInput,
  SegmentClothByClassResult,
} from './aliyun-cutout-adapter.ts'
import {
  classifyGarmentDetailAsset,
  GarmentDetailAssetNotFoundError,
  type GarmentDetailClassifyDependencies,
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
} from './garment-detail-classifier.ts'

// ---------------------------------------------------------------------------
// 测试替身（仿 cutout-session-service 的 dependencies 模式，不连真阿里云）
// ---------------------------------------------------------------------------

const OWNER_USER_ID = 'user_1'

const ownedAsset: AssetRecord = {
  assetId: 'asset_main',
  userId: OWNER_USER_ID,
  projectId: 'demo_project',
  fileName: 'main.jpg',
  fileUrl: 'https://oss.example.com/yibai/assets/main.jpg',
  fileType: 'image/jpeg',
  width: 1200,
  height: 1600,
  createdAt: new Date().toISOString(),
}

const fakeConfig: AliyunCutoutConfig = {
  accessKeyId: 'test-key-id',
  accessKeySecret: 'test-key-secret',
  imagesegEndpoint: 'https://imageseg.example.com',
  viapiUtilsEndpoint: 'https://viapiutils.example.com',
  timeoutMs: 60_000,
}

const fakePrepared: PreparedAliyunCutoutInput = {
  buffer: Buffer.from('prepared'),
  width: 100,
  height: 100,
  originalWidth: 1200,
  originalHeight: 1600,
}

/** 生成一张 width×height 单通道灰度 PNG mask（对齐上游真实格式：前景白 255，背景黑 0）。 */
async function makeMaskPng(
  width: number,
  height: number,
  foregroundPixels: number,
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height)
  for (let index = 0; index < foregroundPixels; index += 1) {
    raw[index] = 255
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer()
}

interface FakeClassifyOverrides {
  getAssetById?: GarmentDetailClassifyDependencies['getAssetById']
  classUrls?: Record<string, string>
  fallback?: boolean
  requestId?: string
  segmentError?: Error
  configError?: Error
  /** url → 该类别分割图前景像素数（画布固定 10×10=100 像素）。 */
  foregroundByUrl?: Record<string, number>
  downloadErrorUrls?: string[]
}

function makeDeps(
  overrides: FakeClassifyOverrides = {},
): GarmentDetailClassifyDependencies {
  return {
    getAssetById:
      overrides.getAssetById ??
      (async (assetId: string) =>
        assetId === ownedAsset.assetId ? ownedAsset : undefined),
    readSourceAsset: async () => Buffer.from('source-bytes'),
    readCanvasDimensions: async () => ({ width: 1200, height: 1600 }),
    prepareInput: async () => fakePrepared,
    readConfig: () => {
      if (overrides.configError) throw overrides.configError
      return fakeConfig
    },
    uploadInput: async () => 'https://viapi-temp.example.com/input.jpg',
    segmentCloth: async (): Promise<SegmentClothByClassResult> => {
      if (overrides.segmentError) throw overrides.segmentError
      return {
        classUrls: overrides.classUrls ?? {},
        requestId: overrides.requestId ?? 'req_test_1',
        fallback: overrides.fallback,
      }
    },
    downloadResult: async (url: string) => {
      if (overrides.downloadErrorUrls?.includes(url)) {
        throw new Error('下载失败')
      }
      const foreground = overrides.foregroundByUrl?.[url] ?? 50
      return makeMaskPng(10, 10, foreground)
    },
  }
}

function classify(
  deps: GarmentDetailClassifyDependencies,
  assetId = ownedAsset.assetId,
  userId = OWNER_USER_ID,
) {
  return classifyGarmentDetailAsset({ assetId, userId }, deps)
}

function classUrl(clothClass: ClothCategory): string {
  return `https://viapi-temp.example.com/${clothClass}.png`
}

// ---------------------------------------------------------------------------
// 安全：素材不存在 / 越权统一 404 语义（抛错，不降级）
// ---------------------------------------------------------------------------

test('素材不存在抛 404 语义错误', async () => {
  await assert.rejects(
    classify(makeDeps(), 'asset_missing'),
    (error: unknown) => {
      assert.ok(error instanceof GarmentDetailAssetNotFoundError)
      assert.equal(error.code, 'ASSET_NOT_FOUND')
      assert.equal(error.status, 404)
      return true
    },
  )
})

test('越权访问他人素材抛同样的 404 语义错误（不暴露存在性）', async () => {
  await assert.rejects(
    classify(makeDeps(), ownedAsset.assetId, 'user_other'),
    GarmentDetailAssetNotFoundError,
  )
})

// ---------------------------------------------------------------------------
// 映射表五类（PRD §7.2：tops/coat→tops、pants/skirt→bottoms、
// bag/shoes→shoes-bags、hat→accessory）
// ---------------------------------------------------------------------------

test('映射表：coat→tops、pants/skirt→bottoms、bag/shoes→shoes-bags、hat→accessory', async () => {
  const cases: Array<{ hit: ClothCategory; expected: string }> = [
    { hit: 'tops', expected: 'tops' },
    { hit: 'coat', expected: 'tops' },
    { hit: 'pants', expected: 'bottoms' },
    { hit: 'skirt', expected: 'bottoms' },
    { hit: 'bag', expected: 'shoes-bags' },
    { hit: 'shoes', expected: 'shoes-bags' },
    { hit: 'hat', expected: 'accessory' },
  ]
  for (const { hit, expected } of cases) {
    const response = await classify(
      makeDeps({
        classUrls: { [hit]: classUrl(hit) },
        foregroundByUrl: { [classUrl(hit)]: 80 },
      }),
    )
    assert.equal(response.status, 'ok', `${hit} 应识别成功`)
    assert.equal(response.category, expected, `${hit} 应映射到 ${expected}`)
    assert.equal(response.source, 'aliyun-segment-cloth')
    assert.equal(response.requestId, 'req_test_1')
  }
})

test('tops+skirt 同命中时建议 dress（置信度取较低者，需手动确认）', async () => {
  const response = await classify(
    makeDeps({
      classUrls: { tops: classUrl('tops'), skirt: classUrl('skirt') },
      foregroundByUrl: { [classUrl('tops')]: 60, [classUrl('skirt')]: 40 },
    }),
  )
  assert.equal(response.status, 'ok')
  assert.equal(response.category, 'dress')
  assert.equal(response.confidence, 0.4)
  assert.equal(response.needsConfirmation, true)
  // dress 置顶，其余候选仍按面积占比给出
  assert.deepEqual(
    response.status === 'ok' ? response.candidates.map((c) => c.category) : [],
    ['dress', 'tops', 'bottoms'],
  )
})

test('skirt 面积远小于 tops（上衣下摆误分割）不建议 dress', async () => {
  // 实测白T案例：tops 0.156 / skirt 0.057（skirt/tops ≈ 0.37 < 0.4）
  const response = await classify(
    makeDeps({
      classUrls: { tops: classUrl('tops'), skirt: classUrl('skirt') },
      foregroundByUrl: { [classUrl('tops')]: 78, [classUrl('skirt')]: 22 },
    }),
  )
  assert.equal(response.status, 'ok')
  assert.equal(response.category, 'tops')
  assert.deepEqual(
    response.status === 'ok' ? response.candidates.map((c) => c.category) : [],
    ['tops', 'bottoms'],
  )
})

// ---------------------------------------------------------------------------
// 降级路径
// ---------------------------------------------------------------------------

test('SegmentCloth fallback（合并图）模式降级为 fallback 响应', async () => {
  const response = await classify(
    makeDeps({
      classUrls: { tops: classUrl('tops') },
      fallback: true,
    }),
  )
  assert.equal(response.status, 'fallback')
  assert.equal(response.category, 'tops')
  assert.equal(response.confidence, 0)
  assert.equal(response.needsConfirmation, true)
  assert.equal(response.source, 'fallback')
  assert.match(response.warning, /智能识别暂不可用/)
})

test('SegmentCloth 调用异常时降级为 fallback，不抛错', async () => {
  const response = await classify(
    makeDeps({ segmentError: new Error('upstream timeout') }),
  )
  assert.equal(response.status, 'fallback')
  assert.equal(response.source, 'fallback')
})

test('分类配置缺失（无凭证）时降级为 fallback，不抛错', async () => {
  const response = await classify(
    makeDeps({ configError: new Error('抠图服务尚未配置') }),
  )
  assert.equal(response.status, 'fallback')
})

test('所有类别结果图下载失败时降级为 fallback', async () => {
  const response = await classify(
    makeDeps({
      classUrls: { tops: classUrl('tops') },
      downloadErrorUrls: [classUrl('tops')],
    }),
  )
  assert.equal(response.status, 'fallback')
})

// ---------------------------------------------------------------------------
// 面积占比排序（score = 命中类别分割图前景像素 / 画布总像素）
// ---------------------------------------------------------------------------

test('候选分类按前景像素面积占比降序排序，confidence 取最高值', async () => {
  const response = await classify(
    makeDeps({
      classUrls: { pants: classUrl('pants'), hat: classUrl('hat') },
      foregroundByUrl: { [classUrl('pants')]: 30, [classUrl('hat')]: 60 },
    }),
  )
  assert.equal(response.status, 'ok')
  if (response.status !== 'ok') return
  // hat(60/(30+60)=0.667) > pants→bottoms(0.333)：配饰应排在下装前
  assert.equal(response.category, 'accessory')
  assert.equal(response.confidence, 0.667)
  assert.deepEqual(
    response.candidates.map((c) => [c.category, c.score]),
    [
      ['accessory', 0.667],
      ['bottoms', 0.333],
    ],
  )
})

test('同类多命中类别面积合并（tops+coat 合并进 tops）', async () => {
  const response = await classify(
    makeDeps({
      classUrls: {
        tops: classUrl('tops'),
        coat: classUrl('coat'),
        bag: classUrl('bag'),
      },
      foregroundByUrl: {
        [classUrl('tops')]: 20,
        [classUrl('coat')]: 25,
        [classUrl('bag')]: 40,
      },
    }),
  )
  assert.equal(response.status, 'ok')
  if (response.status !== 'ok') return
  // tops = 20+25=45 > shoes-bags 40；归一化份额 45/85 = 0.529
  assert.equal(response.category, 'tops')
  assert.equal(response.confidence, 0.529)
})

test('高置信度（≥0.6）非 dress 分类无需手动确认', async () => {
  const response = await classify(
    makeDeps({
      classUrls: { tops: classUrl('tops') },
      foregroundByUrl: { [classUrl('tops')]: 86 },
    }),
  )
  assert.equal(response.status, 'ok')
  assert.equal(response.category, 'tops')
  // 唯一命中类别，归一化份额为 1
  assert.equal(response.confidence, 1)
  assert.equal(response.needsConfirmation, false)
})
