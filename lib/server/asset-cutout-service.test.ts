import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AliyunCutoutProviderError,
  type AliyunCutoutResult,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './aliyun-cutout-adapter.ts'
import {
  AssetCutoutError,
  createCutoutDerivedAssetId,
  cutoutAssetForUser,
  type AssetCutoutDependencies,
// @ts-expect-error Node 原生 TypeScript 测试运行器要求显式扩展名。
} from './asset-cutout-service.ts'
import type { AssetRecord } from '../types'

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    assetId: 'asset-source',
    userId: 'user-1',
    projectId: 'demo_project',
    fileName: 'coat.jpg',
    fileUrl: '/local-assets/assets/user-1/asset-source.jpg',
    fileType: 'image/jpeg',
    width: 1200,
    height: 1600,
    createdAt: '2026-08-10T00:00:00.000Z',
    taskId: null,
    ...overrides,
  }
}

function providerResult(): AliyunCutoutResult {
  return {
    pngBuffer: Buffer.from('transparent-png'),
    requestId: 'aliyun-request-1',
    operation: 'SegmentCommonImage',
    outputWidth: 1200,
    outputHeight: 1600,
    inputWidth: 1200,
    inputHeight: 1600,
    inputBytes: 1234,
    durationMs: 50,
  }
}

function makeDependencies(
  source: AssetRecord,
  overrides: Partial<AssetCutoutDependencies> = {},
): AssetCutoutDependencies {
  return {
    getAssetById: async (assetId) =>
      assetId === source.assetId ? source : undefined,
    readSourceAsset: async () => Buffer.from('source-image'),
    runCutoutProvider: async () => providerResult(),
    persistAsset: async (input) =>
      asset({
        assetId: input.assetId,
        userId: input.userId,
        fileName: input.fileName,
        fileUrl: `/local-assets/assets/user-1/${input.assetId}.png`,
        fileType: input.fileType,
        width: input.width,
        height: input.height,
      }),
    ...overrides,
  }
}

test('不向非资产所有者暴露资产存在性', async () => {
  const source = asset()
  await assert.rejects(
    cutoutAssetForUser(source.assetId, 'user-2', makeDependencies(source)),
    (error: unknown) => {
      assert.ok(error instanceof AssetCutoutError)
      assert.equal(error.code, 'asset_not_found')
      assert.equal(error.status, 404)
      return true
    },
  )
})

test('稳定派生 assetId 让进程重启后的重复点击也能复用结果', async () => {
  const source = asset()
  const derivedId = createCutoutDerivedAssetId(source.userId, source.assetId)
  const existing = asset({
    assetId: derivedId,
    fileName: 'coat-抠图.png',
    fileUrl: `/local-assets/assets/user-1/${derivedId}.png`,
    fileType: 'image/png',
  })
  let providerCalls = 0
  const dependencies = makeDependencies(source, {
    getAssetById: async (assetId) => {
      if (assetId === source.assetId) return source
      if (assetId === derivedId) return existing
      return undefined
    },
    runCutoutProvider: async () => {
      providerCalls += 1
      return providerResult()
    },
  })

  const result = await cutoutAssetForUser(
    source.assetId,
    source.userId,
    dependencies,
  )

  assert.equal(result.asset, existing)
  assert.equal(result.sourceAssetId, source.assetId)
  assert.equal(providerCalls, 0)
})

test('同一用户同一资产的并发点击只调用一次供应商并只持久化一次', async () => {
  const source = asset({ assetId: 'asset-concurrent' })
  let providerCalls = 0
  let persistCalls = 0
  let releaseProvider: (() => void) | undefined
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve
  })
  const dependencies = makeDependencies(source, {
    runCutoutProvider: async () => {
      providerCalls += 1
      await providerGate
      return providerResult()
    },
    persistAsset: async (input) => {
      persistCalls += 1
      return asset({
        assetId: input.assetId,
        userId: input.userId,
        fileName: input.fileName,
        fileUrl: `/local-assets/assets/user-1/${input.assetId}.png`,
        fileType: 'image/png',
        width: input.width,
        height: input.height,
      })
    },
  })

  const first = cutoutAssetForUser(source.assetId, source.userId, dependencies)
  const second = cutoutAssetForUser(source.assetId, source.userId, dependencies)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(providerCalls, 1)
  releaseProvider?.()

  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.asset.assetId, secondResult.asset.assetId)
  assert.equal(providerCalls, 1)
  assert.equal(persistCalls, 1)
})

test('供应商无主体错误转换为可理解的中文业务错误', async () => {
  const source = asset({ assetId: 'asset-no-subject' })
  const dependencies = makeDependencies(source, {
    runCutoutProvider: async () => {
      throw new AliyunCutoutProviderError({
        category: 'no_subject',
        message: '没有识别到清晰主体，请换一张主体更完整的图片后重试',
        retryable: false,
        requestId: 'request-no-subject',
      })
    },
  })

  await assert.rejects(
    cutoutAssetForUser(source.assetId, source.userId, dependencies),
    (error: unknown) => {
      assert.ok(error instanceof AssetCutoutError)
      assert.equal(error.code, 'no_subject')
      assert.equal(error.status, 422)
      assert.equal(error.retryable, false)
      assert.equal(error.requestId, 'request-no-subject')
      assert.match(error.message, /没有识别到清晰主体/)
      return true
    },
  )
})
