import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import sharp from 'sharp'

import {
  ALIYUN_CUTOUT_MAX_EDGE,
  ALIYUN_CUTOUT_MAX_INPUT_BYTES,
  AliyunCutoutProviderError,
  aliyunPercentEncode,
  buildAliyunRpcSignature,
  buildSegmentCommonImageParameters,
  buildViapiTempObjectName,
  callAliyunRpc,
  CLOTH_CLASSES,
  maskPngToGrayscaleAlphaPng,
  parseSegmentClothClassUrls,
  prepareAliyunCutoutInput,
  readSourceCanvasDimensions,
  refineMask,
  restoreCutoutToOriginalCanvas,
  segmentClothByClass,
  segmentSkin,
  type AliyunCutoutConfig,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './aliyun-cutout-adapter.ts'

test('阿里云 POP 编码覆盖 encodeURIComponent 默认遗漏的特殊字符', () => {
  assert.equal(
    aliyunPercentEncode("!*'() ~+/"),
    '%21%2A%27%28%29%20~%2B%2F',
  )
})

test('阿里云 POP HMAC-SHA1 签名与固定向量一致', () => {
  const signed = buildAliyunRpcSignature({
    method: 'POST',
    accessKeySecret: 'testsecret',
    parameters: {
      AccessKeyId: 'testid',
      Action: 'SegmentCommonImage',
      Format: 'JSON',
      ImageURL: 'https://example.com/a b!*()+~.jpg?x=1&y=2',
      RegionId: 'cn-shanghai',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: 'nonce-1',
      SignatureVersion: '1.0',
      Timestamp: '2026-08-10T00:00:00Z',
      Version: '2019-12-30',
    },
  })

  assert.equal(signed.signature, 'XdmF5xlxoJsGM6XNVq763XzVIco=')
  assert.match(
    signed.canonicalQuery,
    /ImageURL=https%3A%2F%2Fexample\.com%2Fa%20b%21%2A%28%29%2B~\.jpg/,
  )
  assert.ok(signed.signedQuery.endsWith('Signature=XdmF5xlxoJsGM6XNVq763XzVIco%3D'))
})

test('VIAPI 临时对象 key 以长期 AccessKeyId 分区', () => {
  assert.equal(
    buildViapiTempObjectName('long-term-access-key', 'nonce-1'),
    'long-term-access-key/nonce-1-cutout-input.jpg',
  )
})

test('SegmentCommonImage 不传 crop，保持四通道 PNG 原画布语义', () => {
  assert.deepEqual(
    buildSegmentCommonImageParameters('https://example.com/input.jpg'),
    { ImageURL: 'https://example.com/input.jpg' },
  )
})

test('RPC 请求固定使用 POST、签名查询串并解析 RequestId', async () => {
  let calledUrl = ''
  let calledInit: RequestInit | undefined
  const result = await callAliyunRpc({
    endpoint: 'https://imageseg.cn-shanghai.aliyuncs.com',
    action: 'SegmentCommonImage',
    version: '2019-12-30',
    accessKeyId: 'testid',
    accessKeySecret: 'testsecret',
    parameters: { ImageURL: 'https://example.com/input.jpg' },
    timeoutMs: 1_000,
    now: new Date('2026-08-10T00:00:00.000Z'),
    nonce: 'nonce-1',
    fetchImpl: async (url, init) => {
      calledUrl = String(url)
      calledInit = init
      return new Response(
        JSON.stringify({
          RequestId: 'request-1',
          Data: { ImageURL: 'https://example.com/result.png' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })

  assert.equal(calledInit?.method, 'POST')
  assert.match(calledUrl, /Action=SegmentCommonImage/)
  assert.match(calledUrl, /Signature=/)
  assert.equal(result.requestId, 'request-1')
})

test('RPC 鉴权错误映射为不可重试的 provider auth 错误', async () => {
  await assert.rejects(
    callAliyunRpc({
      endpoint: 'https://imageseg.cn-shanghai.aliyuncs.com',
      action: 'SegmentCommonImage',
      version: '2019-12-30',
      accessKeyId: 'bad-id',
      accessKeySecret: 'bad-secret',
      timeoutMs: 1_000,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            RequestId: 'request-auth',
            Code: 'AuthFailed',
            Message: 'denied',
          }),
          { status: 403 },
        ),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AliyunCutoutProviderError)
      assert.equal(error.category, 'auth')
      assert.equal(error.retryable, false)
      assert.equal(error.requestId, 'request-auth')
      return true
    },
  )
})

test('服务端预处理把大图压到普通接口的 1999 像素和 3 MB 边界内', async () => {
  const width = 2000
  const height = 2000
  const noisyPng = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer()

  const prepared = await prepareAliyunCutoutInput({
    sourceBuffer: noisyPng,
    originalWidth: 2500,
    originalHeight: 2500,
  })
  const metadata = await sharp(prepared.buffer).metadata()

  assert.equal(prepared.width, ALIYUN_CUTOUT_MAX_EDGE)
  assert.equal(prepared.height, ALIYUN_CUTOUT_MAX_EDGE)
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, ALIYUN_CUTOUT_MAX_EDGE)
  assert.equal(metadata.height, ALIYUN_CUTOUT_MAX_EDGE)
  assert.ok(prepared.buffer.byteLength <= ALIYUN_CUTOUT_MAX_INPUT_BYTES)
})

test('真实画布尺寸按 EXIF 方向校正，不信任资产登记的默认宽高', async () => {
  const source = await sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: '#ffffff',
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer()

  assert.deepEqual(await readSourceCanvasDimensions(source), {
    width: 20,
    height: 40,
  })
})

test('抠图 alpha 回贴原始像素并恢复原图画布尺寸', async () => {
  const source = await sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: { r: 240, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer()
  const providerPixels = Buffer.alloc(10 * 5 * 4)
  for (let pixel = 0; pixel < 10 * 5; pixel += 1) {
    const offset = pixel * 4
    providerPixels[offset] = 240
    providerPixels[offset + 1] = 20
    providerPixels[offset + 2] = 30
    providerPixels[offset + 3] = pixel % 10 < 5 ? 255 : 0
  }
  const providerResult = await sharp(providerPixels, {
    raw: { width: 10, height: 5, channels: 4 },
  })
    .png()
    .toBuffer()

  const output = await restoreCutoutToOriginalCanvas({
    sourceBuffer: source,
    providerResultBuffer: providerResult,
    originalWidth: 40,
    originalHeight: 20,
  })
  const rendered = await sharp(output).raw().toBuffer({ resolveWithObject: true })

  assert.equal(rendered.info.width, 40)
  assert.equal(rendered.info.height, 20)
  assert.equal(rendered.info.channels, 4)
  assert.equal(rendered.data[0], 240)
  assert.equal(rendered.data[3], 255)
  assert.equal(rendered.data[(40 * 20 - 1) * 4 + 3], 0)
})

const TEST_CUTOUT_CONFIG: AliyunCutoutConfig = {
  accessKeyId: 'test-id',
  accessKeySecret: 'test-secret',
  imagesegEndpoint: 'https://imageseg.cn-shanghai.aliyuncs.com',
  viapiUtilsEndpoint: 'https://viapiutils.cn-shanghai.aliyuncs.com',
  timeoutMs: 1_000,
}

test('服饰分层类别常量固定为 7 类，顺序稳定', () => {
  assert.deepEqual([...CLOTH_CLASSES], [
    'tops',
    'coat',
    'skirt',
    'pants',
    'bag',
    'shoes',
    'hat',
  ])
})

test('segmentClothByClass 解析 ClassUrl 映射并按类别返回 URL', async () => {
  const result = await segmentClothByClass(
    'https://example.com/input.jpg',
    TEST_CUTOUT_CONFIG,
    CLOTH_CLASSES,
    {
      callRpc: async (input) => {
        assert.equal(input.action, 'SegmentCloth')
        assert.equal(input.parameters?.OutMode, '1')
        assert.equal(input.parameters?.['ClothClass.1'], 'tops')
        assert.equal(input.parameters?.['ClothClass.7'], 'hat')
        return {
          requestId: 'request-cloth',
          payload: {
            RequestId: 'request-cloth',
            Data: {
              Elements: [
                {
                  ClassUrl: {
                    tops: 'https://example.com/tops.png',
                    pants: 'https://example.com/pants.png',
                  },
                  ImageURL: 'https://example.com/merged.png',
                },
                {
                  ClassUrl: { shoes: 'https://example.com/shoes.png' },
                  ImageURL: 'https://example.com/merged.png',
                },
              ],
            },
          },
        }
      },
    },
  )

  assert.equal(result.requestId, 'request-cloth')
  assert.equal(result.classUrls.tops, 'https://example.com/tops.png')
  assert.equal(result.classUrls.pants, 'https://example.com/pants.png')
  assert.equal(result.classUrls.shoes, 'https://example.com/shoes.png')
  assert.equal(result.fallback, undefined)
})

test('segmentClothByClass 在 ClassUrl 缺失时回退 Elements[].ImageURL 合并图', async () => {
  const result = await segmentClothByClass(
    'https://example.com/input.jpg',
    TEST_CUTOUT_CONFIG,
    CLOTH_CLASSES,
    {
      callRpc: async () => ({
        requestId: 'request-fallback',
        payload: {
          Data: {
            Elements: [{ ImageURL: 'https://example.com/merged.png' }],
          },
        },
      }),
    },
  )

  assert.equal(result.fallback, true)
  assert.equal(result.requestId, 'request-fallback')
  for (const clothClass of CLOTH_CLASSES) {
    assert.equal(result.classUrls[clothClass], 'https://example.com/merged.png')
  }
})

test('parseSegmentClothClassUrls 对空 Elements 返回空映射', () => {
  assert.deepEqual(parseSegmentClothClassUrls({ Elements: [] }, 'request-1', [
    ...CLOTH_CLASSES,
  ]), { classUrls: {}, requestId: 'request-1' })
})

test('segmentSkin 使用 SegmentSkin Action 并解析 Data.ImageURL', async () => {
  const result = await segmentSkin('https://example.com/input.jpg', TEST_CUTOUT_CONFIG, {
    callRpc: async (input) => {
      assert.equal(input.action, 'SegmentSkin')
      assert.deepEqual(input.parameters, {
        ImageURL: 'https://example.com/input.jpg',
      })
      return {
        requestId: 'request-skin',
        payload: { Data: { ImageURL: 'https://example.com/skin.png' } },
      }
    },
  })

  assert.deepEqual(result, {
    imageUrl: 'https://example.com/skin.png',
    requestId: 'request-skin',
  })
})

test('refineMask 传 ImageURL + MaskImageURL 并解析 Data.ImageURL', async () => {
  const result = await refineMask(
    'https://example.com/img.jpg',
    'https://example.com/mask.png',
    TEST_CUTOUT_CONFIG,
    {
      callRpc: async (input) => {
        assert.equal(input.action, 'RefineMask')
        assert.deepEqual(input.parameters, {
          ImageURL: 'https://example.com/img.jpg',
          MaskImageURL: 'https://example.com/mask.png',
        })
        return {
          requestId: 'request-refine',
          payload: { Data: { ImageURL: 'https://example.com/refined.png' } },
        }
      },
    },
  )

  assert.deepEqual(result, {
    imageUrl: 'https://example.com/refined.png',
    requestId: 'request-refine',
  })
})

test('maskPngToGrayscaleAlphaPng 提取四通道 PNG 的 alpha 转黑白灰度', async () => {
  const pixels = Buffer.alloc(20 * 10 * 4)
  for (let pixel = 0; pixel < 20 * 10; pixel += 1) {
    const offset = pixel * 4
    pixels[offset] = 100
    pixels[offset + 1] = 120
    pixels[offset + 2] = 140
    pixels[offset + 3] = pixel % 2 === 0 ? 255 : 0
  }
  const png = await sharp(pixels, {
    raw: { width: 20, height: 10, channels: 4 },
  })
    .png()
    .toBuffer()

  const grayscale = await maskPngToGrayscaleAlphaPng(png)
  const rendered = await sharp(grayscale)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })

  assert.equal(rendered.info.width, 20)
  assert.equal(rendered.info.height, 10)
  assert.equal(rendered.info.channels, 1)
  assert.equal(rendered.data[0], 255)
  assert.equal(rendered.data[1], 0)
})

test('maskPngToGrayscaleAlphaPng 对无 alpha 的灰度图取红色通道', async () => {
  const pixels = Buffer.alloc(20 * 10 * 3)
  for (let pixel = 0; pixel < 20 * 10; pixel += 1) {
    const offset = pixel * 3
    const value = pixel % 2 === 0 ? 255 : 0
    pixels[offset] = value
    pixels[offset + 1] = value
    pixels[offset + 2] = value
  }
  const png = await sharp(pixels, {
    raw: { width: 20, height: 10, channels: 3 },
  })
    .png()
    .toBuffer()

  const grayscale = await maskPngToGrayscaleAlphaPng(png)
  const rendered = await sharp(grayscale)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })

  assert.equal(rendered.info.channels, 1)
  assert.equal(rendered.data[0], 255)
  assert.equal(rendered.data[1], 0)
})
