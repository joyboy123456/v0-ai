import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest, NextResponse } from 'next/server'

import {
  createEventsPostHandler,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './route.ts'

function request(body: unknown) {
  return new NextRequest('http://localhost/api/events', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

test('POST 合法事件写入结构化日志并返回 ok', async () => {
  const logs: unknown[][] = []
  const originalInfo = console.info
  console.info = (...args: unknown[]) => {
    logs.push(args)
  }
  try {
    const handler = createEventsPostHandler({
      authenticate: async () => ({ userId: 'user-1' }),
    })
    const response = await handler(
      request({ event: 'cutout_open', payload: { imageWidth: 800 } }),
    )

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(logs.length, 1)
    const [tag, record] = logs[0] as [string, Record<string, unknown>]
    assert.equal(tag, '[cutout-event] 智能抠图埋点')
    assert.equal(record.event, 'cutout_open')
    assert.equal(record.userId, 'user-1')
    assert.equal(record.imageWidth, 800)
    assert.ok(typeof record.ts === 'string')
  } finally {
    console.info = originalInfo
  }
})

test('POST 非法事件名返回 400', async () => {
  const handler = createEventsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
  })
  const response = await handler(request({ event: 'bogus_event' }))

  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.code, 'invalid_event')
  assert.equal(body.retryable, false)
})

test('POST payload 只允许基本类型，嵌套对象返回 400', async () => {
  const handler = createEventsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
  })
  const response = await handler(
    request({ event: 'cutout_complete', payload: { nested: { a: 1 } } }),
  )

  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'invalid_payload')
})

test('POST payload 拒绝数组', async () => {
  const handler = createEventsPostHandler({
    authenticate: async () => ({ userId: 'user-1' }),
  })
  const response = await handler(
    request({ event: 'cutout_complete', payload: [1, 2] }),
  )

  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'invalid_payload')
})

test('POST 未登录返回 401', async () => {
  const handler = createEventsPostHandler({
    authenticate: async () =>
      NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 }),
  })
  const response = await handler(request({ event: 'cutout_open' }))

  assert.equal(response.status, 401)
})
