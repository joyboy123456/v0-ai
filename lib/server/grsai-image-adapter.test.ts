import assert from 'node:assert/strict'
import test from 'node:test'
import type { Mock } from 'node:test'

// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { runGrsaiImageEdit, resolveGrsaiGptImageAspectRatio } from './grsai-image-adapter.ts'
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { GoogleImageError } from './google-image-retry.ts'

// 避免 adapter 内的 scheduler/throttle 在测试里等待或限流
process.env.GOOGLE_IMAGE_IPM = '999999'
process.env.GOOGLE_IMAGE_RPM = '999999'

interface FetchCall {
  url: string
  init: RequestInit
}

function mockFetchReturning(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = []
  const original = globalThis.fetch
  const mocked = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }
  globalThis.fetch = mocked as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function baseInput(overrides: Partial<Parameters<typeof runGrsaiImageEdit>[0]> = {}) {
  return {
    userId: 'test-user',
    taskId: 'test-task',
    apiKey: 'sk-test-key',
    baseUrl: 'https://grsai.dakka.com.cn',
    model: 'nano-banana-2',
    timeoutMs: 10_000,
    prompt: '一只穿着宇航服的猫',
    inputImages: [],
    count: 1,
    aspectRatio: '1:1',
    imageSize: '1K',
    maxIpm: 999_999,
    maxRpm: 999_999,
    ...overrides,
  }
}

test('Grsai adapter 成功路径：解析 succeeded + results', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-1',
    status: 'succeeded',
    progress: 100,
    results: [{ url: 'https://file.example.com/result.png' }],
  })

  try {
    const results = await runGrsaiImageEdit(baseInput())
    assert.equal(results.length, 1)
    assert.equal(results[0].url, 'https://file.example.com/result.png')
    assert.equal(results[0].assetId, 'result_test-task_1')

    // 验证请求体构造
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://grsai.dakka.com.cn/v1/api/generate')
    const body = JSON.parse(calls[0].init.body as string)
    assert.equal(body.model, 'nano-banana-2')
    assert.equal(body.prompt, '一只穿着宇航服的猫')
    assert.equal(body.aspectRatio, '1:1')
    assert.equal(body.imageSize, '1K')
    assert.equal(body.replyType, 'json')
    assert.equal(body.images, undefined) // 无参考图时不传 images
    assert.equal(
      (calls[0].init.headers as Record<string, string>).authorization,
      'Bearer sk-test-key',
    )
  } finally {
    restore()
  }
})

test('Grsai adapter 图生图：inputImages 透传到 images 字段', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-2',
    status: 'succeeded',
    results: [{ url: 'https://file.example.com/edit.png' }],
  })

  try {
    await runGrsaiImageEdit(
      baseInput({ inputImages: ['data:image/png;base64,abc', 'https://x.com/ref.jpg'] }),
    )
    const body = JSON.parse(calls[0].init.body as string)
    assert.deepEqual(body.images, ['data:image/png;base64,abc', 'https://x.com/ref.jpg'])
  } finally {
    restore()
  }
})

test('Grsai adapter 违规：status=violation 抛 safety_block 且不重试', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-3',
    status: 'violation',
    error: 'input_moderation',
  })

  try {
    await assert.rejects(
      runGrsaiImageEdit(baseInput()),
      (err: unknown) => {
        assert.ok(err instanceof GoogleImageError)
        assert.equal(err.category, 'safety_block')
        assert.equal(err.retryable, false)
        return true
      },
    )
    // safety_block 默认不重试，只调用一次
    assert.equal(calls.length, 1)
  } finally {
    restore()
  }
})

test('Grsai adapter 鉴权失败：HTTP 401 抛 auth_failed', async () => {
  // 用独立 key，避免 401 触发的 auth 熔断影响其它测试用例
  const { restore } = mockFetchReturning({ error: 'invalid api key' }, 401)

  try {
    await assert.rejects(
      runGrsaiImageEdit(baseInput({ apiKey: 'sk-test-auth-fail' })),
      (err: unknown) => {
        assert.ok(err instanceof GoogleImageError)
        assert.equal(err.category, 'auth_failed')
        assert.equal(err.retryable, false)
        return true
      },
    )
  } finally {
    restore()
  }
})

test('Grsai adapter lite 模型：imageSize 2K 被过滤为不传', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-4',
    status: 'succeeded',
    results: [{ url: 'https://file.example.com/lite.png' }],
  })

  try {
    await runGrsaiImageEdit(
      baseInput({ model: 'nano-banana-2-lite', imageSize: '2K' }),
    )
    const body = JSON.parse(calls[0].init.body as string)
    assert.equal(body.model, 'nano-banana-2-lite')
    // lite 模型不支持 2K，imageSize 应被丢弃
    assert.equal(body.imageSize, undefined)
  } finally {
    restore()
  }
})

test('Grsai adapter lite 模型：imageSize 1K 正常透传', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-5',
    status: 'succeeded',
    results: [{ url: 'https://file.example.com/lite1k.png' }],
  })

  try {
    await runGrsaiImageEdit(
      baseInput({ model: 'nano-banana-2-lite', imageSize: '1K' }),
    )
    const body = JSON.parse(calls[0].init.body as string)
    assert.equal(body.imageSize, '1K')
  } finally {
    restore()
  }
})

test('Grsai adapter count>1：并发循环生成多张', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-6',
    status: 'succeeded',
    results: [{ url: 'https://file.example.com/multi.png' }],
  })

  try {
    const results = await runGrsaiImageEdit(baseInput({ count: 3 }))
    assert.equal(results.length, 3)
    assert.equal(calls.length, 3)
    // 每次请求的 assetId 递增
    assert.equal(results[0].assetId, 'result_test-task_1')
    assert.equal(results[2].assetId, 'result_test-task_3')
  } finally {
    restore()
  }
})

test('Grsai adapter gpt-image-2.5-sunburst：像素尺寸映射 + 请求体构造', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-7',
    status: 'succeeded',
    results: [{ url: 'https://file.example.com/gpt25.png' }],
  })

  try {
    const results = await runGrsaiImageEdit(
      baseInput({ model: 'gpt-image-2.5-sunburst', aspectRatio: '3:4', imageSize: '4K' }),
    )
    assert.equal(results.length, 1)
    assert.equal(calls.length, 1)
    const body = JSON.parse(calls[0].init.body as string)
    // 裸模型名直发（不加 openai/ 前缀），grsai 已注册该名字
    assert.equal(body.model, 'gpt-image-2.5-sunburst')
    // sunburst 不接受 '3:4'，必须映射为像素值
    assert.equal(body.aspectRatio, '2480x3312')
    assert.equal(body.imageSize, '4K')
    assert.equal(body.replyType, 'json')
  } finally {
    restore()
  }
})

test('Grsai adapter nano 模型不受像素映射影响：比例字符串原样透传', async () => {
  const { calls, restore } = mockFetchReturning({
    id: 'task-8',
    status: 'succeeded',
    results: [{ url: 'https://file.example.com/nb.png' }],
  })

  try {
    await runGrsaiImageEdit(baseInput({ aspectRatio: '1:1', imageSize: '2K' }))
    const body = JSON.parse(calls[0].init.body as string)
    assert.equal(body.model, 'nano-banana-2')
    assert.equal(body.aspectRatio, '1:1')
  } finally {
    restore()
  }
})

test('resolveGrsaiGptImageAspectRatio 像素值换算', () => {
  assert.equal(resolveGrsaiGptImageAspectRatio('gpt-image-2.5-sunburst', '1:1', '2K'), '2048x2048')
  assert.equal(resolveGrsaiGptImageAspectRatio('gpt-image-2.5-flare', '3:4', '4K'), '2480x3312')
  assert.equal(resolveGrsaiGptImageAspectRatio('gpt-image-2.5-sunburst', '1:1', '4K'), '2880x2880')
  assert.equal(resolveGrsaiGptImageAspectRatio('gpt-image-2.5-sunburst', '3:4', undefined), '1536x2048')
  assert.equal(resolveGrsaiGptImageAspectRatio('gpt-image-2.5-sunburst', '9:9', '2K'), '2048x2048') // 未知比例回退 1:1
  assert.equal(resolveGrsaiGptImageAspectRatio('gpt-image-2.5-sunburst', '2048x1536', '4K'), '2048x1536') // 已是像素值透传
  assert.equal(resolveGrsaiGptImageAspectRatio('nano-banana-2', '1:1', '2K'), '1:1') // 非 gpt 模型不动
  assert.equal(resolveGrsaiGptImageAspectRatio('gpt-image-2.5-sunburst', undefined, '2K'), undefined) // more 场景透传
})
