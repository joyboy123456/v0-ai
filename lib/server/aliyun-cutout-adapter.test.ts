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
  prepareAliyunCutoutInput,
  readSourceCanvasDimensions,
  restoreCutoutToOriginalCanvas,
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
