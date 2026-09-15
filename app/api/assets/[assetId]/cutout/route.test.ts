import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest, NextResponse } from 'next/server'

import {
  AssetCutoutError,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from '../../../../../lib/server/asset-cutout-service.ts'
import type { AssetRecord } from '../../../../../lib/types'
import {
  createCutoutPostHandler,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './handler.ts'

function derivedAsset(): AssetRecord {
  return {
    assetId: 'asset-cutout-1',
    userId: 'user-1',
    projectId: 'demo-project',
    fileName: 'coat-抠图.png',
    fileUrl: '/local-assets/assets/user-1/asset-cutout-1.png',
    fileType: 'image/png',
    width: 1200,
    height: 1600,
    createdAt: '2026-08-10T00:00:00.000Z',
    taskId: null,
  }
}

function request() {
  return new NextRequest('http://localhost/api/assets/asset-source/cutout', {
    method: 'POST',
  })
}

test('POST 成功响应只暴露约定的 { asset } DTO', async () => {
  const handler = createCutoutPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    cutoutAsset: async (assetId, userId) => {
      assert.equal(assetId, 'asset-source')
      assert.equal(userId, 'user-1')
      return {
        asset: derivedAsset(),
        sourceAssetId: 'asset-source',
        providerRequestId: 'request-1',
      }
    },
  })

  const response = await handler(request(), {
    params: Promise.resolve({ assetId: 'asset-source' }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    asset: {
      assetId: 'asset-cutout-1',
      url: '/local-assets/assets/user-1/asset-cutout-1.png',
      fileName: 'coat-抠图.png',
      fileType: 'image/png',
      width: 1200,
      height: 1600,
      sourceAssetId: 'asset-source',
    },
  })
})

test('POST 沿用认证响应并阻止未登录调用', async () => {
  let cutoutCalls = 0
  const handler = createCutoutPostHandler({
    authenticate: async () =>
      NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 }),
    cutoutAsset: async () => {
      cutoutCalls += 1
      return { asset: derivedAsset(), sourceAssetId: 'asset-source' }
    },
  })

  const response = await handler(request(), {
    params: Promise.resolve({ assetId: 'asset-source' }),
  })

  assert.equal(response.status, 401)
  assert.equal(cutoutCalls, 0)
  assert.deepEqual(await response.json(), { ok: false, error: 'UNAUTHORIZED' })
})

test('POST 将业务错误稳定映射为中文结构化错误', async () => {
  const handler = createCutoutPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    cutoutAsset: async () => {
      throw new AssetCutoutError({
        code: 'no_subject',
        status: 422,
        message: '没有识别到清晰主体',
        advice: '请换用主体更清晰的图片',
        retryable: false,
        requestId: 'request-no-subject',
      })
    },
  })

  const response = await handler(request(), {
    params: Promise.resolve({ assetId: 'asset-source' }),
  })

  assert.equal(response.status, 422)
  assert.deepEqual(await response.json(), {
    error: '没有识别到清晰主体',
    code: 'no_subject',
    advice: '请换用主体更清晰的图片',
    retryable: false,
    requestId: 'request-no-subject',
  })
})
