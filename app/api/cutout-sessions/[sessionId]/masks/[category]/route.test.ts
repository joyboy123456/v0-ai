import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest, NextResponse } from 'next/server'

import {
  CutoutSessionError,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from '../../../../../../lib/server/cutout-session-service.ts'
import {
  createCategoryMaskGetHandler,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './route.ts'

function request(sessionId: string, category: string) {
  return new NextRequest(
    `http://localhost/api/cutout-sessions/${sessionId}/masks/${category}`,
    { method: 'GET' },
  )
}

const MASK_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('GET 返回类别 Mask 二进制与私有缓存头', async () => {
  let seenCategory = ''
  const handler = createCategoryMaskGetHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    getMask: async (_sessionId, _userId, category) => {
      seenCategory = category
      return MASK_BYTES
    },
  })

  const response = await handler(
    request('cutout_session_1', 'tops'),
    { params: Promise.resolve({ sessionId: 'cutout_session_1', category: 'tops' }) },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(response.headers.get('cache-control'), 'private, max-age=300')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), MASK_BYTES)
  assert.equal(seenCategory, 'tops')
})

test('GET 拒绝白名单外的类别且不调用业务层', async () => {
  let getCalls = 0
  const handler = createCategoryMaskGetHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    getMask: async () => {
      getCalls += 1
      return MASK_BYTES
    },
  })

  const response = await handler(
    request('cutout_session_1', 'bogus'),
    { params: Promise.resolve({ sessionId: 'cutout_session_1', category: 'bogus' }) },
  )

  assert.equal(response.status, 400)
  assert.equal(getCalls, 0)
  assert.equal((await response.json()).code, 'invalid_category')
})

test('GET 会话过期映射为 410 session_expired', async () => {
  const handler = createCategoryMaskGetHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    getMask: async () => {
      throw new CutoutSessionError({
        code: 'session_expired',
        status: 410,
        message: '抠图会话已过期，请重新进入智能抠图',
        advice: '请重新打开编辑器后再试',
        retryable: false,
      })
    },
  })

  const response = await handler(
    request('cutout_session_1', 'tops'),
    { params: Promise.resolve({ sessionId: 'cutout_session_1', category: 'tops' }) },
  )

  assert.equal(response.status, 410)
  const body = await response.json()
  assert.equal(body.code, 'session_expired')
  assert.equal(body.retryable, false)
})

test('GET 未登录返回 401', async () => {
  const handler = createCategoryMaskGetHandler({
    authenticate: async () =>
      NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 }),
    getMask: async () => MASK_BYTES,
  })

  const response = await handler(
    request('cutout_session_1', 'tops'),
    { params: Promise.resolve({ sessionId: 'cutout_session_1', category: 'tops' }) },
  )

  assert.equal(response.status, 401)
})
