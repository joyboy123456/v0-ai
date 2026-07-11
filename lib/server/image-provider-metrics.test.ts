import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeProviderSelectionScore,
  percentile,
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
} from './image-provider-metrics.ts'

test('百分位计算稳定', () => {
  assert.equal(percentile([400, 100, 300, 200], 0.5), 200)
  assert.equal(percentile([400, 100, 300, 200], 0.95), 400)
  assert.equal(percentile([], 0.95), null)
})

test('评分优先健康、低延迟且未饱和的 Provider', () => {
  const healthy = computeProviderSelectionScore({
    weight: 1, active: 0, limit: 2, successRate: 1, p95DurationMs: 30_000,
  })
  const degraded = computeProviderSelectionScore({
    weight: 1, active: 1, limit: 2, successRate: 0.5, p95DurationMs: 120_000,
  })
  assert.ok(healthy > degraded)
  assert.equal(computeProviderSelectionScore({
    weight: 10, active: 2, limit: 2, successRate: 1, p95DurationMs: 1,
  }), 0)
})
