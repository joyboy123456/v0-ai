import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest, NextResponse } from 'next/server'

import {
  CutoutSessionError,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from '../../../../../lib/server/cutout-session-service.ts'
import {
  createSessionImageGetHandler,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './route.ts'

function request(sessionId: string) {
  return new NextRequest(
    `http://localhost/api/cutout-sessions/${sessionId}/image`,
    { method: 'GET' },
  )
}

const PREPARED_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

test('GET 返回 prepared 工作图二进制与私有缓存头', async () => {
  let seenSessionId = ''
  let seenUserId = ''
  const handler = createSessionImageGetHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    getPreparedImage: async (sessionId, userId) => {
      seenSessionId = sessionId
      seenUserId = userId
      return { buffer: PREPARED_BYTES, contentType: 'image/jpeg' }
    },
  })

  const response = await handler(request('cutout_session_1'), {
    params: Promise.resolve({ sessionId: 'cutout_session_1' }),
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  assert.equal(response.headers.get('cache-control'), 'private, max-age=600')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PREPARED_BYTES)
  assert.equal(seenSessionId, 'cutout_session_1')
  assert.equal(seenUserId, 'user-1')
})

test('GET 未登录返回 401 且不调用业务层', async () => {
  let getCalls = 0
  const handler = createSessionImageGetHandler({
    authenticate: async () =>
      NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 }),
    getPreparedImage: async () => {
      getCalls += 1
      return { buffer: PREPARED_BYTES, contentType: 'image/jpeg' }
    },
  })

  const response = await handler(request('cutout_session_1'), {
    params: Promise.resolve({ sessionId: 'cutout_session_1' }),
  })

  assert.equal(response.status, 401)
  assert.equal(getCalls, 0)
})

test('GET 会话不存在映射为 404 session_not_found', async () => {
  const handler = createSessionImageGetHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    getPreparedImage: async () => {
      throw new CutoutSessionError({
        code: 'session_not_found',
        status: 404,
        message: '未找到对应的抠图会话或无权操作',
        advice: '请刷新页面后重新进入智能抠图',
        retryable: false,
      })
    },
  })

  const response = await handler(request('cutout_session_missing'), {
    params: Promise.resolve({ sessionId: 'cutout_session_missing' }),
  })

  assert.equal(response.status, 404)
  const body = await response.json()
  assert.equal(body.code, 'session_not_found')
  assert.equal(body.retryable, false)
})

test('GET 会话过期映射为 410 session_expired', async () => {
  const handler = createSessionImageGetHandler({
    authenticate: async () => ({ userId: 'user-1' }),
    getPreparedImage: async () => {
      throw new CutoutSessionError({
        code: 'session_expired',
        status: 410,
        message: '抠图会话已过期，请重新进入智能抠图',
        advice: '请重新打开编辑器后再试',
        retryable: false,
      })
    },
  })

  const response = await handler(request('cutout_session_1'), {
    params: Promise.resolve({ sessionId: 'cutout_session_1' }),
  })

  assert.equal(response.status, 410)
  const body = await response.json()
  assert.equal(body.code, 'session_expired')
  assert.equal(body.retryable, false)
})

test('GET 依赖注入：不触碰真实会话注册表，仅透传注入的 getPreparedImage', async () => {
  const seen: Array<{ sessionId: string; userId: string }> = []
  const handler = createSessionImageGetHandler({
    authenticate: async () => ({ userId: 'injected-user' }),
    getPreparedImage: async (sessionId, userId) => {
      seen.push({ sessionId, userId })
      return { buffer: PREPARED_BYTES, contentType: 'image/jpeg' }
    },
  })

  // 注入的 sessionId 是虚构的，若 handler 误走真实会话必然抛 session_not_found；
  // 200 即证明全程走注入依赖，未落真实会话。
  const response = await handler(request('fake_session_id'), {
    params: Promise.resolve({ sessionId: 'fake_session_id' }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(seen, [{ sessionId: 'fake_session_id', userId: 'injected-user' }])
})
