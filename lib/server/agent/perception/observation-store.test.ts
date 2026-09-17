import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { OBSERVATION_TTL_MS } from '@/lib/agent/budget'
import { assetDigest } from '@/lib/agent/contracts'
import type { AssetRecord } from '@/lib/types'
import { ObservationStore, ObservationStoreError, type ObservationContent, type ObservationScope } from './observation-store'

const initialTime = Date.parse('2026-09-16T00:00:00.000Z')
const scope: ObservationScope = { userId: 'user_1', assetId: 'asset_1', observerVersion: 'deterministic-v1' }

function assetFixture(): AssetRecord {
  return { assetId: scope.assetId, userId: scope.userId, projectId: 'project_1', fileName: 'garment.png',
    fileUrl: 'https://assets.example.test/garment.png?signature=old', fileType: 'image/png',
    width: 800, height: 1200, createdAt: '2026-09-15T00:00:00.000Z' }
}

function contentFixture(): ObservationContent {
  return { observerModel: 'local-deterministic', subject: 'garment_flat', category: 'tops',
    dominantColors: ['蓝色'], silhouette: '直筒', keyDetails: ['圆领'], hasVisibleText: false, hasFace: false,
    quality: { blurry: false, lowResolution: false, watermark: false }, confidence: 0.8, notes: '本地模拟观察' }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const errorCode = (code: ObservationStoreError['code']) =>
  (error: unknown) => error instanceof ObservationStoreError && error.code === code

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-observation-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'observations')
  const state: { asset: AssetRecord | undefined; queryError?: Error; queries: string[]; now: number } = {
    asset: assetFixture(), queries: [], now: initialTime,
  }
  const assets = { getAsset: async (assetId: string) => {
    state.queries.push(assetId)
    if (state.queryError) throw state.queryError
    return state.asset ? structuredClone(state.asset) : undefined
  } }
  const newStore = (targetDirectory = directory) => new ObservationStore({ assets, directory: targetDirectory,
    now: () => new Date(state.now) })
  const store = newStore()
  async function cachePath() {
    const files = (await readdir(directory)).filter((name) => name.endsWith('.json'))
    assert.equal(files.length, 1, '夹具当前应只有一条主缓存')
    return path.join(directory, files[0])
  }
  async function files() {
    try { return (await readdir(directory)).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  return { root, directory, state, store, newStore, cachePath, files }
}

test('缓存 miss 不计算；观察身份、来源与完成时间由存储层绑定', async (t) => {
  const f = await fixture(t)
  assert.equal(await f.store.get(scope), null)
  assert.deepEqual(await f.files(), [])
  const expectedDigest = await assetDigest(assetFixture())
  const output = await f.store.getOrCompute(scope, async (context) => {
    assert.deepEqual(context.asset, assetFixture())
    assert.equal(context.assetDigest, expectedDigest)
    assert.equal(context.observerVersion, scope.observerVersion)
    // 观察器拿到的是独立快照，修改它不会回写资产仓储。
    ;(context.asset as AssetRecord).width = 1
    f.state.now += 1_000
    return contentFixture()
  })
  assert.equal(f.state.asset?.width, 800)
  assert.deepEqual(output, { ...contentFixture(), assetId: scope.assetId, assetDigest: expectedDigest,
    observedAt: '2026-09-16T00:00:01.000Z', origin: 'image_observation' })
  assert.deepEqual(await f.store.get(scope), output)
})

test('同进程跨实例并发只计算一次，等待者拿到独立可变副本', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t)
  const started = deferred(); const release = deferred()
  let calls = 0
  const observe = async () => {
    calls++
    started.resolve()
    await release.promise
    return contentFixture()
  }
  const operations = Array.from({ length: 12 }, (_, index) =>
    (index % 2 ? f.newStore() : f.store).getOrCompute(scope, observe))
  await started.promise
  release.resolve()
  const observations = await Promise.all(operations)
  assert.equal(calls, 1)
  for (const observation of observations) assert.deepEqual(observation, observations[0])
  assert.notEqual(observations[0], observations[1])
  observations[0].dominantColors.push('未保存的颜色')
  observations[0].quality.blurry = true
  assert.deepEqual(observations[1].dominantColors, ['蓝色'])
  assert.equal(observations[1].quality.blurry, false)
  assert.deepEqual(await f.store.get(scope), observations[1])
})

test('新实例从磁盘复用缓存，调用方修改返回值不会污染后续读取', async (t) => {
  const f = await fixture(t)
  const original = await f.store.getOrCompute(scope, async () => contentFixture())
  const restarted = f.newStore()
  let calls = 0
  const cached = await restarted.getOrCompute(scope, async () => { calls++; return contentFixture() })
  assert.equal(calls, 0)
  assert.deepEqual(cached, original)
  cached.keyDetails.push('调用方临时修改')
  const firstRead = await restarted.get(scope)
  assert.deepEqual(firstRead, original)
  firstRead!.quality.watermark = true
  assert.deepEqual(await f.newStore().get(scope), original)
})

test('删除、转属、错误资产记录及查询故障不能读取旧缓存或触发计算', async (t) => {
  const cases = ['deleted', 'owner_changed', 'wrong_asset', 'query_failed'] as const
  for (const scenario of cases) await t.test(scenario, async (child) => {
    const f = await fixture(child)
    await f.store.getOrCompute(scope, async () => contentFixture())
    const file = await f.cachePath()
    const before = await readFile(file, 'utf8')
    const lookupError = new Error('asset lookup unavailable')
    if (scenario === 'deleted') f.state.asset = undefined
    if (scenario === 'owner_changed') f.state.asset!.userId = 'user_2'
    if (scenario === 'wrong_asset') f.state.asset!.assetId = 'different_asset'
    if (scenario === 'query_failed') f.state.queryError = lookupError
    const expected = scenario === 'query_failed' ? (error: unknown) => error === lookupError : errorCode('ASSET_NOT_FOUND')
    let calls = 0
    await assert.rejects(f.store.get(scope), expected)
    await assert.rejects(f.newStore().getOrCompute(scope, async () => { calls++; return contentFixture() }), expected)
    assert.equal(calls, 0)
    assert.equal(await readFile(file, 'utf8'), before)
    assert.ok(f.state.queries.every((id) => id === scope.assetId))
  })
})

test('其他用户即使知道资产 ID 也不能读取缓存', async (t) => {
  const f = await fixture(t)
  await f.store.getOrCompute(scope, async () => contentFixture())
  const otherUser = { ...scope, userId: 'user_2' }
  let calls = 0
  await assert.rejects(f.store.get(otherUser), errorCode('ASSET_NOT_FOUND'))
  await assert.rejects(f.store.getOrCompute(otherUser, async () => { calls++; return contentFixture() }), errorCode('ASSET_NOT_FOUND'))
  assert.equal(calls, 0)
})

test('签名 URL 轮换保留命中，资产摘要变化使旧缓存失效', async (t) => {
  const f = await fixture(t)
  const original = await f.store.getOrCompute(scope, async () => contentFixture())
  f.state.asset!.fileUrl = 'https://assets.example.test/garment.png?signature=new'
  let calls = 0
  assert.deepEqual(await f.store.get(scope), original)
  assert.deepEqual(await f.store.getOrCompute(scope, async () => { calls++; return contentFixture() }), original)
  assert.equal(calls, 0)
  f.state.asset!.width = 1600
  assert.equal(await f.store.get(scope), null)
  const updated = await f.store.getOrCompute(scope, async (context) => {
    calls++
    assert.equal(context.asset.width, 1600)
    return contentFixture()
  })
  assert.equal(calls, 1)
  assert.notEqual(updated.assetDigest, original.assetDigest)
  assert.deepEqual(await f.newStore().get(scope), updated)
})

test('observerVersion 独立隔离，同名模型不能复用另一版本观察', async (t) => {
  const f = await fixture(t)
  const original = await f.store.getOrCompute(scope, async () => contentFixture())
  const upgraded = { ...scope, observerVersion: 'deterministic-v2' }
  assert.equal(await f.store.get(upgraded), null)
  let calls = 0
  const updated = await f.store.getOrCompute(upgraded, async (context) => {
    calls++
    assert.equal(context.observerVersion, upgraded.observerVersion)
    return { ...contentFixture(), notes: 'v2 算法观察' }
  })
  assert.equal(calls, 1)
  assert.equal(updated.observerModel, original.observerModel)
  assert.deepEqual(await f.store.get(scope), original)
  assert.deepEqual(await f.store.get(upgraded), updated)
  assert.equal((await f.files()).filter((file) => file.endsWith('.json')).length, 2)
})

test('TTL 为 24 小时，边界即过期且命中不会续期', async (t) => {
  const f = await fixture(t)
  const original = await f.store.getOrCompute(scope, async () => contentFixture())
  const file = await f.cachePath()
  const before = await readFile(file, 'utf8')
  for (const elapsed of [60 * 60_000, OBSERVATION_TTL_MS - 1]) {
    f.state.now = initialTime + elapsed
    assert.deepEqual(await f.newStore().get(scope), original)
    assert.equal(await readFile(file, 'utf8'), before)
  }
  f.state.now = initialTime + OBSERVATION_TTL_MS
  assert.equal(await f.store.get(scope), null)
  f.state.now++
  assert.equal(await f.store.get(scope), null)
  assert.equal(await readFile(file, 'utf8'), before)
  let calls = 0
  const refreshed = await f.store.getOrCompute(scope, async () => { calls++; return contentFixture() })
  assert.equal(calls, 1)
  assert.equal(refreshed.observedAt, new Date(f.state.now).toISOString())
  assert.deepEqual(await f.store.get(scope), refreshed)
})

test('损坏 JSON 旁有有效备份也返回 null，只在显式计算后修复缓存', async (t) => {
  const f = await fixture(t)
  await f.store.getOrCompute(scope, async () => contentFixture())
  const file = await f.cachePath()
  assert.equal(await readFile(`${file}.bak`, 'utf8'), await readFile(file, 'utf8'))
  await writeFile(file, '{broken json')
  assert.equal(await f.newStore().get(scope), null)
  assert.equal(await readFile(file, 'utf8'), '{broken json')
  let calls = 0
  const repaired = await f.store.getOrCompute(scope, async () => { calls++; return contentFixture() })
  assert.equal(calls, 1)
  assert.deepEqual(await f.newStore().get(scope), repaired)
})

test('有效 JSON 超过 1 MiB 也视为损坏，不能从备份恢复命中', async (t) => {
  const f = await fixture(t)
  const observed = await f.store.getOrCompute(scope, async () => contentFixture())
  const file = await f.cachePath()
  const original = await readFile(file, 'utf8')
  const limit = 1024 * 1024
  // 用合法 JSON 空白填充，避免让结构校验失败掩盖文件大小检查缺失。
  const atLimit = ' '.repeat(limit - Buffer.byteLength(original, 'utf8')) + original
  assert.equal(Buffer.byteLength(atLimit, 'utf8'), limit)
  await writeFile(file, atLimit)
  assert.deepEqual(await f.store.get(scope), observed)
  await writeFile(file, ` ${atLimit}`)
  assert.equal(await f.newStore().get(scope), null)
  assert.equal(await readFile(`${file}.bak`, 'utf8'), original)
})

test('缓存结构、身份、来源和时间篡改均降级为 null', async (t) => {
  const f = await fixture(t)
  await f.store.getOrCompute(scope, async () => contentFixture())
  const file = await f.cachePath()
  const original = await readFile(file, 'utf8')
  type Document = { observation: Record<string, unknown>; [key: string]: unknown }
  const cases: [string, (document: Document) => void][] = [
    ['错误 schemaVersion', (value) => { value.schemaVersion = 2 }],
    ['缺少观察字段', (value) => { delete value.observation.quality }],
    ['额外控制字段', (value) => { value.observation.model = 'injected-model' }],
    ['错误 envelope 用户', (value) => { value.userId = 'user_2' }],
    ['错误 envelope 资产', (value) => { value.assetId = 'asset_2' }],
    ['错误 envelope 摘要', (value) => { value.assetDigest = '0'.repeat(64) }],
    ['错误观察器版本', (value) => { value.observerVersion = 'another-version' }],
    ['错误 observation 资产', (value) => { value.observation.assetId = 'asset_2' }],
    ['错误 observation 摘要', (value) => { value.observation.assetDigest = '0'.repeat(64) }],
    ['伪造来源', (value) => { value.observation.origin = 'system_policy' }],
    ['越界置信度', (value) => { value.observation.confidence = 1.1 }],
    ['无效观察时间', (value) => { value.observation.observedAt = 'not-a-date' }],
    ['未来观察时间', (value) => {
      value.observation.observedAt = new Date(initialTime + 1).toISOString()
      value.expiresAt = new Date(initialTime + 1 + OBSERVATION_TTL_MS).toISOString()
    }],
    ['延长有效期', (value) => { value.expiresAt = new Date(initialTime + OBSERVATION_TTL_MS + 1).toISOString() }],
  ]
  for (const [label, mutate] of cases) {
    const value = JSON.parse(original) as Document
    mutate(value)
    const changed = JSON.stringify(value)
    await writeFile(file, changed)
    assert.equal(await f.newStore().get(scope), null, label)
    assert.equal(await readFile(file, 'utf8'), changed, `${label} 不自动恢复旧备份`)
  }
})

test('计算期间资产改变、删除或转属时不发布缓存，失败后可重新计算', { timeout: 10_000 }, async (t) => {
  for (const scenario of ['changed', 'deleted', 'owner_changed'] as const) await t.test(scenario, async (child) => {
    const f = await fixture(child)
    const started = deferred(); const release = deferred()
    let calls = 0
    const operation = f.store.getOrCompute(scope, async () => {
      calls++
      started.resolve()
      await release.promise
      return contentFixture()
    })
    await started.promise
    if (scenario === 'changed') f.state.asset!.height++
    if (scenario === 'deleted') f.state.asset = undefined
    if (scenario === 'owner_changed') f.state.asset!.userId = 'user_2'
    release.resolve()
    await assert.rejects(operation, errorCode(scenario === 'changed' ? 'ASSET_CHANGED' : 'ASSET_NOT_FOUND'))
    assert.equal(calls, 1)
    assert.deepEqual(await f.files(), [])
    f.state.asset = assetFixture()
    const recovered = await f.newStore().getOrCompute(scope, async () => { calls++; return contentFixture() })
    assert.equal(calls, 2)
    assert.deepEqual(await f.store.get(scope), recovered)
  })
})

test('计算异常不缓存也不自动重试，后续显式调用可以恢复', async (t) => {
  const f = await fixture(t)
  const failure = new Error('observer unavailable')
  let calls = 0
  await assert.rejects(f.store.getOrCompute(scope, async () => { calls++; throw failure }), (error) => error === failure)
  assert.equal(calls, 1)
  assert.deepEqual(await f.files(), [])
  assert.equal(await f.store.get(scope), null)
  const recovered = await f.newStore().getOrCompute(scope, async () => { calls++; return contentFixture() })
  assert.equal(calls, 2)
  assert.deepEqual(await f.store.get(scope), recovered)
})

test('非法观察内容及回调伪造的身份字段不落缓存', async (t) => {
  const invalid: [string, Record<string, unknown>][] = [
    ['assetId', { assetId: 'asset_2' }], ['assetDigest', { assetDigest: '0'.repeat(64) }],
    ['observedAt', { observedAt: '2026-09-15T00:00:00.000Z' }], ['origin', { origin: 'system_policy' }],
    ['NaN confidence', { confidence: NaN }], ['out-of-range confidence', { confidence: -1 }],
    ['undefined required field', { observerModel: undefined }], ['unknown category', { category: 'forged' }],
  ]
  for (const [label, patch] of invalid) await t.test(label, async (child) => {
    const f = await fixture(child)
    await assert.rejects(f.store.getOrCompute(scope, async () => ({ ...contentFixture(), ...patch }) as ObservationContent),
      errorCode('INVALID_OBSERVATION'))
    assert.deepEqual(await f.files(), [])
    assert.equal(await f.store.get(scope), null)
    const valid = await f.newStore().getOrCompute(scope, async () => contentFixture())
    assert.deepEqual(await f.store.get(scope), valid)
  })
})

test('缓存目录不可读取或写入时拒绝，不以缓存 miss 发起计算', async (t) => {
  const f = await fixture(t)
  const blocked = path.join(f.root, 'file-instead-of-directory')
  await writeFile(blocked, 'blocker')
  const store = f.newStore(blocked)
  let calls = 0
  await assert.rejects(store.get(scope), errorCode('CACHE_UNAVAILABLE'))
  await assert.rejects(store.getOrCompute(scope, async () => { calls++; return contentFixture() }), errorCode('CACHE_UNAVAILABLE'))
  assert.equal(calls, 0)
  assert.equal(await readFile(blocked, 'utf8'), 'blocker')
})

test('原子写入临时路径故障不能返回成功或复用备份，修复后可显式再算', async (t) => {
  const f = await fixture(t)
  await f.store.getOrCompute(scope, async () => contentFixture())
  const file = await f.cachePath()
  await rm(file)
  const blocker = `${file}.tmp-write`
  await mkdir(blocker)
  assert.equal(await f.store.get(scope), null)
  let calls = 0
  await assert.rejects(f.store.getOrCompute(scope, async () => { calls++; return contentFixture() }), errorCode('CACHE_UNAVAILABLE'))
  assert.equal(calls, 1)
  assert.equal(await f.store.get(scope), null)
  await rm(blocker, { recursive: true })
  const recovered = await f.store.getOrCompute(scope, async () => { calls++; return contentFixture() })
  assert.equal(calls, 2)
  assert.deepEqual(await f.newStore().get(scope), recovered)
})

test('observerVersion 中的目录片段只能参与键，不进入文件路径', async (t) => {
  const f = await fixture(t)
  const versioned = { ...scope, observerVersion: '../../outside/observer-v1' }
  const observed = await f.store.getOrCompute(versioned, async (context) => {
    assert.equal(context.observerVersion, versioned.observerVersion)
    return contentFixture()
  })
  assert.deepEqual(await readdir(f.root), ['observations'])
  for (const file of await f.files()) assert.match(file, /^[a-f0-9]{64}\.json(?:\.bak)?$/)
  assert.deepEqual(await f.newStore().get(versioned), observed)
})
