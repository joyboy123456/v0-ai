import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import sharp from 'sharp'

import {
  maskPngToGrayscaleAlphaPng,
  type AliyunCutoutConfig,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './aliyun-cutout-adapter.ts'
import {
  CUTOUT_SESSION_TTL_MS,
  CutoutSessionError,
  createGarmentCutoutSession,
  deriveCutoutExportAssetId,
  deriveCutoutSessionId,
  exportCutoutSession,
  getCategoryMask,
  getCutoutSession,
  type CutoutSessionDependencies,
  type CutoutSessionDto,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './cutout-session-service.ts'
import type { AssetRecord, ClothCategory, CutoutCategory } from '../types'

const ORIGINAL_WIDTH = 80
const ORIGINAL_HEIGHT = 40
const PREPARED_WIDTH = 40
const PREPARED_HEIGHT = 20

const TEST_CONFIG: AliyunCutoutConfig = {
  accessKeyId: 'test-id',
  accessKeySecret: 'test-secret',
  imagesegEndpoint: 'https://imageseg.cn-shanghai.aliyuncs.com',
  viapiUtilsEndpoint: 'https://viapiutils.cn-shanghai.aliyuncs.com',
  timeoutMs: 1_000,
}

/** 每个用例使用独立 userId，避免共享全局会话注册表导致跨用例复用。 */
let userSequence = 0
function freshUserId(): string {
  userSequence += 1
  return `user-${userSequence}`
}

function sourceAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    assetId: 'asset-source',
    userId: 'user-1',
    projectId: 'demo_project',
    fileName: 'coat.jpg',
    fileUrl: '/local-assets/assets/user-1/asset-source.jpg',
    fileType: 'image/jpeg',
    width: ORIGINAL_WIDTH,
    height: ORIGINAL_HEIGHT,
    createdAt: '2026-08-10T00:00:00.000Z',
    taskId: null,
    ...overrides,
  }
}

async function makeSourcePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 50, b: 60 },
    },
  })
    .png()
    .toBuffer()
}

/** 四通道 PNG：alpha = pattern(x,y) ? 255 : 0，RGB 恒定。 */
async function makeMaskPng(
  width: number,
  height: number,
  pattern: (x: number, y: number) => boolean,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const foreground = pattern(x, y)
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = foreground ? 255 : 0
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
}

interface TestDeps {
  deps: CutoutSessionDependencies
  clock: { now: number }
  owner: string
  segmentClothCalls: () => number
  /** persistAsset 落库的 body，key = assetId，用于校验合成像素。 */
  persistedBodies: Map<string, Buffer>
}

function makeDependencies(
  overrides: Partial<CutoutSessionDependencies> = {},
): TestDeps {
  const clock = { now: 1_000_000 }
  const owner = freshUserId()
  const persistedBodies = new Map<string, Buffer>()
  let clothCalls = 0
  const deps: CutoutSessionDependencies = {
    getAssetById: async (assetId) =>
      assetId === 'asset-source' ? sourceAsset({ userId: owner }) : undefined,
    readSourceAsset: async () => makeSourcePng(ORIGINAL_WIDTH, ORIGINAL_HEIGHT),
    readCanvasDimensions: async () => ({
      width: ORIGINAL_WIDTH,
      height: ORIGINAL_HEIGHT,
    }),
    prepareInput: async ({ sourceBuffer, originalWidth, originalHeight }) => ({
      buffer: sourceBuffer,
      width: PREPARED_WIDTH,
      height: PREPARED_HEIGHT,
      originalWidth,
      originalHeight,
    }),
    readConfig: () => TEST_CONFIG,
    uploadInput: async () =>
      'https://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/test/input.jpg',
    segmentClothByClass: async (_url, _config, classes) => {
      clothCalls += 1
      const classUrls: Record<string, string> = {}
      for (const clothClass of classes) {
        classUrls[clothClass] = `https://viapi.example.com/${clothClass}.png`
      }
      return { classUrls, requestId: 'request-cloth' }
    },
    segmentSkinImage: async () => ({
      imageUrl: 'https://viapi.example.com/skin.png',
      requestId: 'request-skin',
    }),
    segmentHairImage: async () => ({
      imageUrl: 'https://viapi.example.com/hair.png',
      requestId: 'request-hair',
    }),
    segmentBodyImage: async () => ({
      imageUrl: 'https://viapi.example.com/body.png',
      requestId: 'request-body',
    }),
    segmentCommonImage: async () => ({
      imageUrl: 'https://viapi.example.com/common.png',
      requestId: 'request-common',
    }),
    downloadResult: async (url) => {
      const name = url.split('/').pop()?.split('.')[0] ?? 'common'
      return makeMaskPng(PREPARED_WIDTH, PREPARED_HEIGHT, (x, y) =>
        name === 'common' ? x >= PREPARED_WIDTH / 2 : x < PREPARED_WIDTH / 2,
      )
    },
    maskToGrayscaleAlphaPng: maskPngToGrayscaleAlphaPng,
    refineMaskImage: async () => ({
      imageUrl: 'https://viapi.example.com/refined.png',
      requestId: 'request-refine',
    }),
    persistAsset: async (input) => {
      if (input.body) {
        persistedBodies.set(input.assetId as string, input.body as Buffer)
      }
      return sourceAsset({
        assetId: input.assetId as string,
        userId: input.userId,
        fileName: input.fileName,
        fileUrl: `/local-assets/assets/user-1/${input.assetId}.png`,
        fileType: input.fileType,
        width: input.width,
        height: input.height,
      })
    },
    now: () => clock.now,
    ...overrides,
  }
  return { deps, clock, owner, segmentClothCalls: () => clothCalls, persistedBodies }
}

async function createSession(
  testDeps: TestDeps,
  userId?: string,
): Promise<CutoutSessionDto> {
  return createGarmentCutoutSession(
    userId ?? testDeps.owner,
    'asset-source',
    testDeps.deps,
  )
}

/** 导出测试用的最终蒙版区域：prepared 坐标 x 10..29 / y 5..14。 */
function finalMaskPattern(x: number, y: number): boolean {
  return x >= 10 && x < 30 && y >= 5 && y < 15
}

test('会话 id 由 userId+assetId+scene 稳定派生', () => {
  const first = deriveCutoutSessionId('user-1', 'asset-source', 'garment')
  assert.equal(first, deriveCutoutSessionId('user-1', 'asset-source', 'garment'))
  assert.match(first, /^cutout_session_[0-9a-f]{24}$/)
  assert.notEqual(
    first,
    deriveCutoutSessionId('user-2', 'asset-source', 'garment'),
  )
  assert.notEqual(first, deriveCutoutSessionId('user-1', 'asset-other', 'garment'))
})

test('prepare 幂等：同用户同图复用未过期会话，不重复调用上游', async () => {
  const testDeps = makeDependencies()
  const first = await createSession(testDeps)
  const second = await createSession(testDeps)

  assert.equal(first.sessionId, second.sessionId)
  assert.equal(testDeps.segmentClothCalls(), 1)
  assert.deepEqual(first.categories.map((item) => item.category).sort(), [
    'bag',
    'body',
    'coat',
    'common',
    'hair',
    'hat',
    'pants',
    'shoes',
    'skin',
    'skirt',
    'tops',
  ])
})

test('prepare DTO 暴露工作图与原始尺寸信息', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  assert.equal(session.scene, 'garment')
  assert.equal(session.imageWidth, PREPARED_WIDTH)
  assert.equal(session.imageHeight, PREPARED_HEIGHT)
  assert.equal(session.originalWidth, ORIGINAL_WIDTH)
  assert.equal(session.originalHeight, ORIGINAL_HEIGHT)
  assert.equal(session.scale, PREPARED_WIDTH / ORIGINAL_WIDTH)
  assert.match(session.imageUrl, /^https:\/\/viapi-customer-temp/)
  assert.ok(session.categories.length > 0)
  for (const category of session.categories) {
    assert.equal(category.width, PREPARED_WIDTH)
    assert.equal(category.height, PREPARED_HEIGHT)
  }
})

test('单个类别失败只跳过，不影响整个会话', async () => {
  const testDeps = makeDependencies({
    downloadResult: async (url) => {
      if (url.includes('/skin.png')) throw new Error('skin 下载失败')
      return makeMaskPng(PREPARED_WIDTH, PREPARED_HEIGHT, () => true)
    },
  })
  const session = await createSession(testDeps)
  const categories = session.categories.map((item) => item.category)
  assert.ok(!categories.includes('skin'))
  assert.ok(categories.includes('tops'))
  assert.ok(categories.includes('hair'))

  await assert.rejects(
    getCategoryMask(session.sessionId, testDeps.owner, 'skin', testDeps.deps),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'category_not_found')
      return true
    },
  )
})

test('全部类别失败才整体抛错', async () => {
  const testDeps = makeDependencies({
    segmentClothByClass: async () => {
      throw new Error('SegmentCloth 失败')
    },
    segmentSkinImage: async () => {
      throw new Error('skin 失败')
    },
    segmentHairImage: async () => {
      throw new Error('hair 失败')
    },
    segmentBodyImage: async () => {
      throw new Error('body 失败')
    },
    segmentCommonImage: async () => {
      throw new Error('common 失败')
    },
  })
  await assert.rejects(
    createGarmentCutoutSession(testDeps.owner, 'asset-source', testDeps.deps),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'prepare_failed')
      assert.equal(error.status, 502)
      assert.equal(error.retryable, true)
      return true
    },
  )
})

test('会话归属校验：他人 userId 看不到会话与蒙版', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  assert.throws(
    () => getCutoutSession(session.sessionId, 'user-other', testDeps.deps),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'session_not_found')
      return true
    },
  )
  await assert.rejects(
    getCategoryMask(session.sessionId, 'user-other', 'tops', testDeps.deps),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'session_not_found')
      return true
    },
  )
})

test('会话过期：超 TTL 后访问抛 session_expired，再次 prepare 会重建', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  testDeps.clock.now += CUTOUT_SESSION_TTL_MS + 1

  assert.throws(
    () => getCutoutSession(session.sessionId, testDeps.owner, testDeps.deps),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'session_expired')
      return true
    },
  )

  const rebuilt = await createSession(testDeps)
  assert.equal(rebuilt.sessionId, session.sessionId)
  assert.equal(testDeps.segmentClothCalls(), 2)
})

test('getCategoryMask 返回 prepared 尺寸黑白灰度 PNG', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  const mask = await getCategoryMask(
    session.sessionId,
    testDeps.owner,
    'tops',
    testDeps.deps,
  )
  const rendered = await sharp(mask)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert.equal(rendered.info.width, PREPARED_WIDTH)
  assert.equal(rendered.info.height, PREPARED_HEIGHT)
  assert.equal(rendered.info.channels, 1)
  assert.equal(rendered.data[0], 255)
  // (39,0) 在默认左半区掩码之外 → 黑
  assert.equal(rendered.data[PREPARED_WIDTH - 1], 0)
})

test('导出：透明 PNG 与黑白 Mask 放大回原图尺寸，RGB/alpha 与 bbox 正确', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  const maskBuffer = await makeMaskPng(
    PREPARED_WIDTH,
    PREPARED_HEIGHT,
    finalMaskPattern,
  )

  const result = await exportCutoutSession(
    session.sessionId,
    testDeps.owner,
    maskBuffer,
    {},
    testDeps.deps,
  )

  assert.equal(result.asset.fileName, 'coat-服饰分层.png')
  assert.equal(result.asset.fileType, 'image/png')
  assert.equal(result.asset.width, ORIGINAL_WIDTH)
  assert.equal(result.asset.height, ORIGINAL_HEIGHT)
  assert.equal(result.asset.sourceAssetId, 'asset-source')
  assert.equal(result.mask.width, ORIGINAL_WIDTH)
  assert.equal(result.mask.height, ORIGINAL_HEIGHT)

  // bbox：prepared 区域 x 10..29 / y 5..14 放大 2 倍 → x 20..59 / y 10..29
  assert.deepEqual(result.boundingBox, {
    x: 20,
    y: 10,
    width: 40,
    height: 20,
  })

  // 透明 PNG：alpha 与源图 RGB 保留
  const transparentBody = testDeps.persistedBodies.get(result.asset.assetId)
  assert.ok(transparentBody)
  const transparent = await sharp(transparentBody)
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert.equal(transparent.info.width, ORIGINAL_WIDTH)
  assert.equal(transparent.info.height, ORIGINAL_HEIGHT)
  assert.equal(transparent.info.channels, 4)
  // (40,20) 为保留区中心（prepared (20,10) 深处）：alpha=255，RGB=源图色 (200,50,60)
  const keepOffset = (20 * ORIGINAL_WIDTH + 40) * 4
  assert.equal(transparent.data[keepOffset], 200)
  assert.equal(transparent.data[keepOffset + 1], 50)
  assert.equal(transparent.data[keepOffset + 2], 60)
  assert.equal(transparent.data[keepOffset + 3], 255)
  // (0,0) 为透明区：alpha=0
  assert.equal(transparent.data[3], 0)

  // 黑白 Mask：原图尺寸，白=保留，黑=透明
  const maskBody = testDeps.persistedBodies.get(result.mask.assetId)
  assert.ok(maskBody)
  const mask = await sharp(maskBody)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert.equal(mask.info.width, ORIGINAL_WIDTH)
  assert.equal(mask.info.height, ORIGINAL_HEIGHT)
  assert.equal(mask.info.channels, 1)
  assert.equal(mask.data[20 * ORIGINAL_WIDTH + 40], 255)
  assert.equal(mask.data[0], 0)
})

test('导出支持 dataURL 输入', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  const maskBuffer = await makeMaskPng(
    PREPARED_WIDTH,
    PREPARED_HEIGHT,
    finalMaskPattern,
  )
  const dataUrl = `data:image/png;base64,${maskBuffer.toString('base64')}`

  const result = await exportCutoutSession(
    session.sessionId,
    testDeps.owner,
    dataUrl,
    {},
    testDeps.deps,
  )
  assert.deepEqual(result.boundingBox, {
    x: 20,
    y: 10,
    width: 40,
    height: 20,
  })
})

test('导出幂等：同一会话同一蒙版生成稳定 assetId，重复导出复用', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  const maskBuffer = await makeMaskPng(
    PREPARED_WIDTH,
    PREPARED_HEIGHT,
    finalMaskPattern,
  )

  const gray = await sharp(maskBuffer).extractChannel('alpha').raw().toBuffer()
  const expectedDigest = createHash('sha256').update(gray).digest('hex')
  const expectedPngAssetId = deriveCutoutExportAssetId(
    'cutout_png',
    session.sessionId,
    expectedDigest,
  )
  const expectedMaskAssetId = deriveCutoutExportAssetId(
    'cutout_mask',
    session.sessionId,
    expectedDigest,
  )
  assert.match(expectedPngAssetId, /^cutout_png_[0-9a-f]{24}$/)
  assert.match(expectedMaskAssetId, /^cutout_mask_[0-9a-f]{24}$/)

  const first = await exportCutoutSession(
    session.sessionId,
    testDeps.owner,
    maskBuffer,
    {},
    testDeps.deps,
  )
  const second = await exportCutoutSession(
    session.sessionId,
    testDeps.owner,
    maskBuffer,
    {},
    testDeps.deps,
  )
  assert.equal(first.asset.assetId, expectedPngAssetId)
  assert.equal(first.mask.assetId, expectedMaskAssetId)
  assert.equal(first.asset.assetId, second.asset.assetId)
  assert.equal(first.mask.assetId, second.mask.assetId)
})

test('导出：全透明蒙版抛 empty_mask', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  const maskBuffer = await makeMaskPng(
    PREPARED_WIDTH,
    PREPARED_HEIGHT,
    () => false,
  )

  await assert.rejects(
    exportCutoutSession(
      session.sessionId,
      testDeps.owner,
      maskBuffer,
      {},
      testDeps.deps,
    ),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'empty_mask')
      assert.equal(error.status, 422)
      assert.match(error.advice, /涂抹选区/)
      return true
    },
  )
})

test('导出：非法 dataURL 抛 invalid_mask', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  await assert.rejects(
    exportCutoutSession(
      session.sessionId,
      testDeps.owner,
      'not-a-data-url',
      {},
      testDeps.deps,
    ),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'invalid_mask')
      return true
    },
  )
})

test('导出：refine 失败回退未细化蒙版，不阻断导出', async () => {
  const testDeps = makeDependencies({
    refineMaskImage: async () => {
      throw new Error('RefineMask 服务不可用')
    },
  })
  const session = await createSession(testDeps)
  const maskBuffer = await makeMaskPng(
    PREPARED_WIDTH,
    PREPARED_HEIGHT,
    finalMaskPattern,
  )

  const result = await exportCutoutSession(
    session.sessionId,
    testDeps.owner,
    maskBuffer,
    { refine: true },
    testDeps.deps,
  )
  assert.deepEqual(result.boundingBox, {
    x: 20,
    y: 10,
    width: 40,
    height: 20,
  })
})

test('导出：refine 成功时使用细化后的蒙版', async () => {
  const testDeps = makeDependencies({
    downloadResult: async (url) => {
      if (url.includes('/refined.png')) {
        // 细化结果：prepared 右半区（x>=20），与默认左半区相反
        return makeMaskPng(PREPARED_WIDTH, PREPARED_HEIGHT, (x) => x >= 20)
      }
      return makeMaskPng(PREPARED_WIDTH, PREPARED_HEIGHT, (x) => x < 20)
    },
  })
  const session = await createSession(testDeps)
  const maskBuffer = await makeMaskPng(
    PREPARED_WIDTH,
    PREPARED_HEIGHT,
    finalMaskPattern,
  )

  const result = await exportCutoutSession(
    session.sessionId,
    testDeps.owner,
    maskBuffer,
    { refine: true },
    testDeps.deps,
  )
  // 细化蒙版 prepared 右半区 x 20..39 / y 0..19 → 原图 x 40..79 / y 0..39
  assert.deepEqual(result.boundingBox, {
    x: 40,
    y: 0,
    width: 40,
    height: PREPARED_HEIGHT * 2,
  })
})

test('导出：非会话所有者被拒绝', async () => {
  const testDeps = makeDependencies()
  const session = await createSession(testDeps)
  const maskBuffer = await makeMaskPng(
    PREPARED_WIDTH,
    PREPARED_HEIGHT,
    finalMaskPattern,
  )
  await assert.rejects(
    exportCutoutSession(
      session.sessionId,
      'user-other',
      maskBuffer,
      {},
      testDeps.deps,
    ),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'session_not_found')
      return true
    },
  )
})

test('createGarmentCutoutSession 校验资产存在与归属', async () => {
  const missing = makeDependencies({
    getAssetById: async () => undefined,
  })
  await assert.rejects(
    createGarmentCutoutSession('user-1', 'asset-source', missing.deps),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'asset_not_found')
      return true
    },
  )

  const owned = makeDependencies()
  await assert.rejects(
    createGarmentCutoutSession('user-other', 'asset-source', owned.deps),
    (error: unknown) => {
      assert.ok(error instanceof CutoutSessionError)
      assert.equal(error.code, 'asset_not_found')
      return true
    },
  )
})

test('CutoutCategory 类型覆盖服饰七类与辅助类别', () => {
  const categories: CutoutCategory[] = [
    'tops',
    'coat',
    'skirt',
    'pants',
    'bag',
    'shoes',
    'hat',
    'skin',
    'hair',
    'body',
    'common',
  ]
  assert.equal(categories.length, 11)
  const clothClasses: ClothCategory[] = [
    'tops',
    'coat',
    'skirt',
    'pants',
    'bag',
    'shoes',
    'hat',
  ]
  assert.equal(clothClasses.length, 7)
})
