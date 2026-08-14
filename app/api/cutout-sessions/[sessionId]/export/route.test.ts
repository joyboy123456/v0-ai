import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest, NextResponse } from 'next/server'

import {
  CutoutSessionError,
  type CutoutExportResult,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from '../../../../../lib/server/cutout-session-service.ts'
import {
  createCutoutExportPostHandler,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './route.ts'

function exportResult(): CutoutExportResult {
  return {
    asset: {
      assetId: 'cutout_png_0123456789abcdef01234567',
      url: '/local-assets/assets/user-1/cutout_png_0123456789abcdef01234567.png',
      fileName: 'coat-服饰分层.png',
      fileType: 'image/png',
      width: 2400,
      height: 3200,
      sourceAssetId: 'asset-source',
    },
    mask: {
      assetId: 'cutout_mask_0123456789abcdef01234567',
      url: '/local-assets/assets/user-1/cutout_mask_0123456789abcdef01234567.png',
      width: 2400,
      height: 3200,
    },
    boundingBox: { x: 100, y: 200, width: 800, height: 1200 },
  }
}

function request(sessionId: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/cutout-sessions/${sessionId}/export`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  )
}

const MASK_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

test('POST 导出成功返回 DTO，refine 缺省为 false', async () => {
  let seenRefine: boolean | undefined
  const handler = createCutoutExportPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    exportSession: async (sessionId, userId, finalMask, options) => {
      assert.equal(sessionId, 'cutout_session_1')
      assert.equal(userId, 'user-1')
      assert.ok(Buffer.isBuffer(finalMask))
      assert.deepEqual(finalMask, MASK_PNG)
      seenRefine = options.refine
      return exportResult()
    },
  })

  const response = await handler(
    request('cutout_session_1', {
      maskDataUrl: `data:image/png;base64,${MASK_PNG.toString('base64')}`,
    }),
    { params: Promise.resolve({ sessionId: 'cutout_session_1' }) },
  )

  assert.equal(response.status, 200)
  assert.equal(seenRefine, false)
  assert.deepEqual(await response.json(), exportResult())
})

test('POST refine=true 透传给业务层', async () => {
  let seenRefine: boolean | undefined
  const handler = createCutoutExportPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    exportSession: async (_s, _u, _m, options) => {
      seenRefine = options.refine
      return exportResult()
    },
  })

  await handler(
    request('cutout_session_1', {
      maskDataUrl: `data:image/png;base64,${MASK_PNG.toString('base64')}`,
      refine: true,
    }),
    { params: Promise.resolve({ sessionId: 'cutout_session_1' }) },
  )

  assert.equal(seenRefine, true)
})

test('POST 非法 maskDataURL 返回 400 且不调用业务层', async () => {
  let exportCalls = 0
  const handler = createCutoutExportPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    exportSession: async () => {
      exportCalls += 1
      return exportResult()
    },
  })

  const response = await handler(
    request('cutout_session_1', { maskDataUrl: 'not-a-data-url' }),
    { params: Promise.resolve({ sessionId: 'cutout_session_1' }) },
  )

  assert.equal(response.status, 400)
  assert.equal(exportCalls, 0)
  assert.equal((await response.json()).code, 'invalid_mask_data')
})

test('POST 空选区错误映射为 422 empty_mask', async () => {
  const handler = createCutoutExportPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    exportSession: async () => {
      throw new CutoutSessionError({
        code: 'empty_mask',
        status: 422,
        message: '当前选区为空，无法导出透明图层',
        advice: '请先点击图片中需要保留的区域，或使用涂抹选区补充后再导出',
        retryable: false,
      })
    },
  })

  const response = await handler(
    request('cutout_session_1', {
      maskDataUrl: `data:image/png;base64,${MASK_PNG.toString('base64')}`,
    }),
    { params: Promise.resolve({ sessionId: 'cutout_session_1' }) },
  )

  assert.equal(response.status, 422)
  const body = await response.json()
  assert.equal(body.code, 'empty_mask')
  assert.match(body.advice, /涂抹选区/)
})

test('POST 未登录返回 401', async () => {
  const handler = createCutoutExportPostHandler({
    authenticate: async () =>
      NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 }),
    exportSession: async () => exportResult(),
  })

  const response = await handler(
    request('cutout_session_1', {
      maskDataUrl: `data:image/png;base64,${MASK_PNG.toString('base64')}`,
    }),
    { params: Promise.resolve({ sessionId: 'cutout_session_1' }) },
  )

  assert.equal(response.status, 401)
})
