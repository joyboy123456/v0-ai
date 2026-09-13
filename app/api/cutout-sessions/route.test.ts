import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest, NextResponse } from 'next/server'

import {
  CutoutSessionError,
  type CutoutSessionDto,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from '../../../lib/server/cutout-session-service.ts'
import {
  createCutoutSessionsPostHandler,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './handler.ts'

function sessionDto(): CutoutSessionDto {
  return {
    sessionId: 'cutout_session_0123456789abcdef01234567',
    scene: 'garment',
    imageUrl: 'https://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/x.jpg',
    imageWidth: 1200,
    imageHeight: 1600,
    originalWidth: 2400,
    originalHeight: 3200,
    scale: 0.5,
    categories: [
      { category: 'tops', width: 1200, height: 1600 },
      { category: 'pants', width: 1200, height: 1600 },
    ],
    createdAt: '2026-08-15T00:00:00.000Z',
  }
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/cutout-sessions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

test('POST 成功创建会话并返回会话 DTO', async () => {
  let seenAssetId = ''
  let seenUserId = ''
  const handler = createCutoutSessionsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    createSession: async (userId, assetId) => {
      seenUserId = userId
      seenAssetId = assetId
      return sessionDto()
    },
  })

  const response = await handler(
    request({ assetId: 'asset-source', scene: 'garment' }),
  )

  assert.equal(response.status, 200)
  assert.equal(seenUserId, 'user-1')
  assert.equal(seenAssetId, 'asset-source')
  assert.deepEqual(await response.json(), { session: sessionDto() })
})

test('POST scene 缺省按 garment 处理', async () => {
  let seenScene = 'unset'
  const handler = createCutoutSessionsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    createSession: async () => {
      seenScene = 'called'
      return sessionDto()
    },
  })

  const response = await handler(request({ assetId: 'asset-source' }))
  assert.equal(response.status, 200)
  assert.equal(seenScene, 'called')
})

test('POST 拒绝不支持的场景且不调用业务层', async () => {
  let createCalls = 0
  const handler = createCutoutSessionsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    createSession: async () => {
      createCalls += 1
      return sessionDto()
    },
  })

  const response = await handler(
    request({ assetId: 'asset-source', scene: 'person' }),
  )

  assert.equal(response.status, 400)
  assert.equal(createCalls, 0)
  const body = await response.json()
  assert.equal(body.code, 'unsupported_scene')
  assert.equal(body.retryable, false)
})

test('POST 缺少 assetId 返回 400', async () => {
  const handler = createCutoutSessionsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    createSession: async () => sessionDto(),
  })

  const response = await handler(request({}))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'missing_asset_id')
})

test('POST 未登录返回 401 且不调用业务层', async () => {
  let createCalls = 0
  const handler = createCutoutSessionsPostHandler({
    authenticate: async () =>
      NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 }),
    createSession: async () => {
      createCalls += 1
      return sessionDto()
    },
  })

  const response = await handler(request({ assetId: 'asset-source' }))
  assert.equal(response.status, 401)
  assert.equal(createCalls, 0)
  assert.deepEqual(await response.json(), { ok: false, error: 'UNAUTHORIZED' })
})

test('POST 业务错误稳定映射为结构化错误', async () => {
  const handler = createCutoutSessionsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    createSession: async () => {
      throw new CutoutSessionError({
        code: 'asset_not_found',
        status: 404,
        message: '未找到对应的图片资产或无权操作',
        advice: '请刷新页面后重新选择图片',
        retryable: false,
      })
    },
  })

  const response = await handler(request({ assetId: 'asset-gone' }))
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: '未找到对应的图片资产或无权操作',
    code: 'asset_not_found',
    advice: '请刷新页面后重新选择图片',
    retryable: false,
  })
})
