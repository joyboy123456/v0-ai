import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import ts from 'typescript'
import * as types from '@/lib/types'
import * as contracts from '@/lib/agent/contracts'
import * as budget from '@/lib/agent/budget'
import * as recovery from '@/lib/server/task-recovery'
import { normalizeAiFashionPhotoParams } from '@/lib/server/ai-fashion-photo-service'
import type { PreviewArtifact, RetryPreviewArtifact } from '@/lib/agent/contracts'
import type { GenerationTask, AssetRecord, PhotoFissionParams } from '@/lib/types'

const root = process.cwd()
const nativeRequire = createRequire(import.meta.url)
const source = readFileSync(path.join(root, 'lib/server/task-store.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
const main: AssetRecord = { assetId: 'asset', userId: 'user', projectId: 'project', fileName: 'x.png', fileUrl: '/x.png', fileType: 'image/png', width: 80, height: 120, createdAt: '2026-09-17T00:00:00.000Z', taskId: null, dataUrl: 'data:image/png;base64,AA==' }

async function preview(): Promise<PreviewArtifact> {
  const params = normalizeAiFashionPhotoParams({ model: 'nano-banana-2', userPrompt: '保留原服装', promptMode: 'raw', referenceImageCount: 1, imageRatio: '3:4', resolution: '2k', resultCount: 1 }, 1)
  return { schemaVersion: 1, proposalId: 'proposal', version: 1, userId: 'user', sessionId: 'session', messageId: 'message', toolName: 'fashion_photo.create', featureType: 'ai-fashion-photo', normalizedParams: params, inputAssetIds: ['asset'], assetDigests: [await contracts.assetDigest(main)], paramsDigest: await contracts.paramsDigest('ai-fashion-photo', params), policyVersion: 'policy', estimatedResultCount: 1, normalizationSeed: 'seed', resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'ai-fashion-photo-v1', blockers: [], riskNotices: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }
}

/** 执行真实 task-store 源码，仅替换进程、临时数据根与供应商端口；不加载业务 data 或网络能力。 */
async function harness(t: { after(fn: () => Promise<void>): void }, tasks: GenerationTask[] = [], production = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-prepared-task-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'data'))
  const file = path.join(directory, 'data/fashion-mvp-store.json')
  await writeFile(file, JSON.stringify({ assets: [main], tasks }))
  const scheduled: Array<() => void> = []
  const pipelineCalls: Array<Record<string, unknown>> = []
  let normalizations = 0
  const forbidden = () => { throw new Error('意外供应商调用') }
  const modules: Record<string, unknown> = {
    '@/lib/types': types, '@/lib/agent/contracts': contracts, '@/lib/agent/budget': budget,
    '@/lib/server/task-recovery': recovery,
    '@/lib/server/third-party-image-adapter': { runThirdPartyWorkflow: async (input: Record<string, unknown>) => { pipelineCalls.push(input); return [] } },
    '@/lib/server/ai-fashion-photo-service': { normalizeAiFashionPhotoParams: (...args: Parameters<typeof normalizeAiFashionPhotoParams>) => { normalizations++; return normalizeAiFashionPhotoParams(...args) } },
    '@/lib/server/pose-fission-service': { normalizePoseFissionParams: forbidden, runPoseFissionPipeline: forbidden },
    '@/lib/server/photo-fission-service': { normalizePhotoFissionParams: forbidden, runPhotoFissionPipeline: forbidden, runPhotoFissionFaceRefine: forbidden },
    '@/lib/server/garment-detail-model-registry': { isGarmentDetailBackendEnabled: () => true, resolveGarmentDetailModel: forbidden },
    '@/lib/server/garment-detail-service': { normalizeGarmentDetailParams: forbidden, runGarmentDetailPipeline: forbidden },
    '@/lib/server/auth/local-auth-mode': { isLocalSuperAdminEnabled: () => true },
    '@/lib/server/image-work-scheduler': { cancelScheduledTask: () => undefined },
    '@/lib/server/safe-remote-image': { downloadSafeRemoteImage: forbidden },
    '@/lib/server/storage': { getTaskRepo: () => ({ insertTask: async () => undefined, updateTask: async () => undefined }), getStorageAdapter: forbidden },
    '@/lib/server/log': { logImageEvent: () => undefined },
  }
  const isolatedGlobal = {} as { fashionMvpStore: { tasks: Map<string, GenerationTask>; assets: Map<string, AssetRecord> } }
  const exports = {} as typeof import('@/lib/server/task-store') & { flush: () => Promise<void> }
  const evaluate = runInThisContext(`(function(exports, require, process, globalThis, setTimeout, console) { ${compiled}\nexports.flush = () => persistChain;\n})`)
  evaluate(exports, (id: string) => {
    if (Object.hasOwn(modules, id)) return modules[id]
    if (id.startsWith('node:') || id === 'sharp') return nativeRequire(id)
    throw new Error(`未隔离依赖：${id}`)
  }, { cwd: () => directory, env: { NODE_ENV: production ? 'production' : 'test' }, on: () => undefined }, isolatedGlobal,
  (fn: () => void, delay: number) => { if (delay === 0) scheduled.push(fn); else queueMicrotask(fn); return 0 },
  { log: () => undefined, error: () => undefined, warn: () => undefined })
  await exports.listTasks()
  return { api: exports, file, scheduled, pipelineCalls, state: isolatedGlobal.fashionMvpStore, normalizations: () => normalizations }
}

test('冻结创建落盘后才启动，重放保持同一任务且不再归一化', async (t) => {
  const h = await harness(t)
  const p = await preview()
  const [first, replay] = await Promise.all([h.api.createPreparedTask(p, 'key'), h.api.createPreparedTask(p, 'key')])
  assert.equal(first.taskId, replay.taskId)
  assert.deepEqual(first.params, p.normalizedParams)
  assert.equal(h.normalizations(), 0)
  assert.equal(h.scheduled.length, 1)
  const disk = JSON.parse(await readFile(h.file, 'utf8'))
  assert.equal(disk.tasks[0].agentExecution.requestDigest, await contracts.requestDigest({ actionKind: 'generate', payload: p }))
  assert.equal(disk.tasks[0].status, 'pending')
})

test('旧表单仍先 normalize，且不携带 Agent 冻结标记', async (t) => {
  const h = await harness(t)
  const p = await preview()
  const task = await h.api.createTask({ featureType: p.featureType, params: p.normalizedParams, inputAssetIds: ['asset'], userId: 'user', idempotencyKey: 'old' })
  assert.equal(h.normalizations(), 1)
  assert.equal(task.agentExecution, undefined)
})

for (const scenario of ['changed_asset', 'deleted_asset', 'other_owner', 'changed_params', 'blocker', 'expired', 'other_model', 'multiple_results'] as const) {
  test(`冻结创建拒绝 ${scenario}，不创建任务或调度`, async (t) => {
    const h = await harness(t)
    const p = await preview()
    if (scenario === 'changed_asset') h.state.assets.set('asset', { ...main, width: 81 })
    if (scenario === 'deleted_asset') h.state.assets.delete('asset')
    if (scenario === 'other_owner') h.state.assets.set('asset', { ...main, userId: 'another' })
    if (scenario === 'changed_params') (p.normalizedParams as types.AiFashionPhotoParams).userPrompt = '替换要求'
    if (scenario === 'blocker') p.blockers.push('decision_gate:test')
    if (scenario === 'expired') p.expiresAt = '2020-01-01T00:00:00.000Z'
    if (scenario === 'other_model') p.resolvedModelId = 'gemini-old'
    if (scenario === 'multiple_results') p.estimatedResultCount = 2
    await assert.rejects(h.api.createPreparedTask(p, 'key'))
    assert.equal(h.state.tasks.size, 0)
    assert.equal(h.scheduled.length, 0)
  })
}

test('同键不同参数不能覆盖已保存的工件', async (t) => {
  const h = await harness(t)
  const p = await preview()
  await h.api.createPreparedTask(p, 'key')
  p.normalizationSeed = 'different'
  await assert.rejects(h.api.createPreparedTask(p, 'key'), /冲突/)
  assert.equal(h.scheduled.length, 1)
})

test('已批准任务重启后不走旧自动恢复，取消也强写磁盘', async (t) => {
  const h = await harness(t)
  const task = await h.api.createPreparedTask(await preview(), 'key')
  const restart = await harness(t, [task], true)
  assert.equal(restart.scheduled.length, 0)
  assert.equal((await restart.api.getTask(task.taskId))?.status, 'pending')
  await restart.api.cancelPreparedTask(task.taskId, 'user')
  assert.equal(JSON.parse(await readFile(restart.file, 'utf8')).tasks[0].status, 'cancelled')
})

test('重试保留原裤装分镜、摘要和缺失 seed，只调度选中镜头一次', async (t) => {
  const p = await preview()
  const params = { model: 'nano-banana-2', shotPlan: [{ shotId: 's1', order: 1, label: '原镜头', prompt: '原提示词' }, { shotId: 's2', order: 2, label: '已成功', prompt: '原二' }], resultCount: 2 } as PhotoFissionParams
  const task: GenerationTask = { taskId: 'original', userId: 'user', featureType: 'photo-fission', workflowId: 'flow', inputAssetIds: ['asset'], params, status: 'partial', progress: 100, message: '', results: [{ assetId: 'r2', shotId: 's2', url: '/r.png', downloadUrl: '/r.png', width: 1, height: 1 }], resultAssetIds: ['r2'], shotProgress: [{ shotId: 's1', label: '原镜头', status: 'failed', message: '' }, { shotId: 's2', label: '已成功', status: 'success', message: '' }], creditsUsed: 0, createdAt: p.createdAt }
  const h = await harness(t, [task])
  const { normalizedParams: _params, normalizationSeed: _seed, inputAssetIds: _ids, ...base } = p
  const retry: RetryPreviewArtifact = { ...base, toolName: 'task.retry_shots', featureType: 'photo-fission', taskId: 'original', shotIds: ['s1'], attempt: 1, promptTemplateVersion: 'photo-fission-v1', paramsDigest: await contracts.paramsDigest('photo-fission', params) }
  const result = await h.api.retryPreparedShots(retry, 'retry-key')
  await h.api.retryPreparedShots(retry, 'retry-key')
  assert.deepEqual(result.params, params)
  assert.equal(result.agentExecution?.normalizationSeed, null)
  assert.equal(result.shotProgress?.[0].retryAttempt, 1)
  assert.equal(result.shotProgress?.[1].status, 'success')
  assert.equal(h.scheduled.length, 1)
  assert.equal(JSON.parse(await readFile(h.file, 'utf8')).tasks[0].status, 'pending')
  await assert.rejects(h.api.retryPhotoFissionShots('original', ['s1'], 'user'), /原批准链路/)
  h.scheduled[0]()
  for (let i = 0; i < 30 && h.pipelineCalls.length === 0; i++) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.pipelineCalls.length, 1)
  assert.equal(h.pipelineCalls[0].preparedPlan, true)
  assert.deepEqual(h.pipelineCalls[0].targetShotIds, ['s1'])
  assert.deepEqual(h.pipelineCalls[0].params, params)
  for (let i = 0; i < 100 && h.state.tasks.get('original')?.status === 'running'; i++) await new Promise((resolve) => setImmediate(resolve))
  await h.api.flush()
})

test('冻结任务落盘失败时不启动任何图片任务', async (t) => {
  const h = await harness(t)
  await mkdir(`${h.file}.tmp-write`)
  await assert.rejects(h.api.createPreparedTask(await preview(), 'key'))
  assert.equal(h.state.tasks.size, 0)
  assert.equal(h.scheduled.length, 0)
})

test('真实裂变执行函数：冻结模式不调用 Planner；旧表单模式仍调用', async () => {
  const file = path.join(root, 'lib/server/photo-fission-service.ts')
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const localRequire = createRequire(file)
  let plannerCalls = 0
  let providerLookups = 0
  class PlannerError extends Error {}
  const injected: Record<string, unknown> = {
    '@/lib/types': types,
    './image-provider-pool': { getAvailableProvidersForModel: () => { providerLookups++; return [] }, getNoAvailableProviderMessage: () => 'test:no-provider' },
    './photo-fission-shot-planner': { ShotPlannerError: PlannerError, invokeShotPlanner: async () => { plannerCalls++; throw new PlannerError('test:planner') } },
    './photo-fission-rule-engine': { buildPlannerRulePlan: () => ({ systemPrompt: 'test', userPrompt: 'test' }) },
    './provider-image-router': { runImageEditViaProvider: () => { throw new Error('不允许真实图片调用') } },
    './log': { logImageEvent: () => undefined },
  }
  const exports = {} as typeof import('@/lib/server/photo-fission-service')
  runInThisContext(`(function(exports, require) { ${code}\n})`)(exports, (id: string) => Object.hasOwn(injected, id) ? injected[id] : localRequire(id))
  const params = { model: 'nano-banana-2', category: 'childrens', childrensCategory: 'dress', resolution: '2k', imageRatio: '3:4', resultCount: 2, shotPlan: [{ shotId: 's', prompt: '批准原分镜', label: '原镜头', order: 1 }] } as PhotoFissionParams
  const before = JSON.stringify(params)
  const input = { userId: 'user', taskId: 'task', params, inputImages: ['test-image'], apiKey: '', timeoutMs: 10 }
  await assert.rejects(exports.runPhotoFissionPipeline({ ...input, preparedPlan: true }), /test:no-provider/)
  assert.equal(plannerCalls, 0)
  assert.equal(providerLookups, 1)
  assert.equal(JSON.stringify(params), before)
  await assert.rejects(exports.runPhotoFissionPipeline(input))
  assert.equal(plannerCalls, 1)
})

test('Local TaskRepo 的 row 往返与状态更新保留 Agent 冻结执行凭证', async () => {
  const file = path.join(root, 'lib/server/storage/task-repo.local.ts')
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {} as typeof import('@/lib/server/storage/task-repo.local')
  runInThisContext(`(function(exports, globalThis) { ${code}\n})`)(exports, {})
  const repo = exports.createLocalTaskRepo()
  const agentExecution = { schemaVersion: 1, paramsDigest: 'a'.repeat(64), assetDigests: [], resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'ai-fashion-photo-v1', normalizationSeed: 'seed', requestDigest: 'b'.repeat(64), idempotencyKey: 'key' }
  await repo.insertTask({ id: 't', userId: 'u', type: 'ai-fashion-photo', status: 'pending', payloadJson: JSON.stringify({ agentExecution }), resultJson: null, createdAt: 0, updatedAt: 0 })
  assert.deepEqual(JSON.parse((await repo.getTask('t'))!.payloadJson!).agentExecution, agentExecution)
  const retry = { ...agentExecution, idempotencyKey: 'retry' }
  await repo.updateTask('t', { payloadJson: JSON.stringify({ agentExecution: retry }), status: 'running' })
  assert.deepEqual(JSON.parse((await repo.getTask('t'))!.payloadJson!).agentExecution, retry)
})


type RetryEvidenceFixtureOptions = {
  agentExecution?: GenerationTask['agentExecution']
  retryAttempt?: number
  results?: GenerationTask['results']
  resultAssetIds?: string[]
}

async function retryEvidenceFixture(options: RetryEvidenceFixtureOptions = {}) {
  const p = await preview()
  const retryAttempt = options.retryAttempt ?? 0
  const params: PhotoFissionParams = {
    model: 'nano-banana-2', category: 'childrens', childrensCategory: 'pants',
    hasFrontDetail: true, hasBackDetail: true, imageRatio: '3:4', resolution: '2k',
    shotPlan: [
      { shotId: 's1', order: 1, label: '待重试', prompt: '原提示词一' },
      { shotId: 's2', order: 2, label: '已成功二', prompt: '原提示词二' },
      { shotId: 's3', order: 3, label: '已成功三', prompt: '原提示词三' },
    ],
    resultCount: 4,
  }
  const results = options.results ?? [
    { assetId: 'r2', shotId: 's2', url: '/r2.png', downloadUrl: '/r2.png', width: 1, height: 1 },
    { assetId: 'r3', shotId: 's3', url: '/r3.png', downloadUrl: '/r3.png', width: 1, height: 1 },
  ]
  const task: GenerationTask = {
    taskId: 'original', userId: 'user', featureType: 'photo-fission', workflowId: 'flow',
    inputAssetIds: ['asset'], params, status: 'partial', progress: 100, message: '',
    results, resultAssetIds: options.resultAssetIds ?? results.map((result) => result.assetId),
    shotProgress: [
      { shotId: 's1', label: '待重试', status: 'failed', message: '', retryAttempt },
      { shotId: 's2', label: '已成功二', status: 'success', message: '' },
      { shotId: 's3', label: '已成功三', status: 'success', message: '' },
    ],
    creditsUsed: 0, createdAt: p.createdAt,
    ...(options.agentExecution ? { agentExecution: options.agentExecution } : {}),
  }
  const { normalizedParams: _params, normalizationSeed: _seed, inputAssetIds: _ids, ...base } = p
  const retry: RetryPreviewArtifact = {
    ...base, toolName: 'task.retry_shots', featureType: 'photo-fission', taskId: task.taskId,
    shotIds: ['s1'], attempt: retryAttempt + 1, promptTemplateVersion: 'photo-fission-v1',
    paramsDigest: await contracts.paramsDigest('photo-fission', params),
  }
  return { task, retry }
}

test('C8 冻结创建写入唯一 generate attempt，并经 JSON store 完整往返', async (t) => {
  const h = await harness(t)
  const p = await preview()
  const digest = await contracts.requestDigest({ actionKind: 'generate', payload: p })
  const task = await h.api.createPreparedTask(p, 'generate-key')
  const expected = [{
    actionKind: 'generate', requestDigest: digest, idempotencyKey: 'generate-key',
    shotIds: [], attempt: null, priorResultAssetIds: [],
  }]
  assert.equal(task.agentExecution?.requestDigest, digest)
  assert.equal(task.agentExecution?.idempotencyKey, 'generate-key')
  assert.deepEqual(task.agentExecution?.attempts, expected)
  const disk = JSON.parse(await readFile(h.file, 'utf8'))
  assert.deepEqual(disk.tasks[0].agentExecution.attempts, expected)

  const restarted = await harness(t, disk.tasks)
  assert.deepEqual((await restarted.api.getTask(task.taskId))?.agentExecution?.attempts, expected)
})

test('C8 重试保留历史 attempts，记录多张旧结果基线，同键并发只追加一次', async (t) => {
  const originalExecution: NonNullable<GenerationTask['agentExecution']> = {
    schemaVersion: 1, paramsDigest: 'a'.repeat(64), assetDigests: ['asset-digest'],
    resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'photo-fission-v1',
    normalizationSeed: 'seed', requestDigest: 'b'.repeat(64), idempotencyKey: 'generate-key',
    attempts: [{
      actionKind: 'generate', requestDigest: 'b'.repeat(64), idempotencyKey: 'generate-key',
      shotIds: [], attempt: null, priorResultAssetIds: [],
    }],
  }
  const { task, retry } = await retryEvidenceFixture({ agentExecution: originalExecution })
  const h = await harness(t, [task])
  const digest = await contracts.requestDigest({ actionKind: 'retry_shots', payload: retry })
  const [first, replay] = await Promise.all([
    h.api.retryPreparedShots(retry, 'retry-key'),
    h.api.retryPreparedShots(retry, 'retry-key'),
  ])
  const expectedRetry = {
    actionKind: 'retry_shots', requestDigest: digest, idempotencyKey: 'retry-key',
    shotIds: ['s1'], attempt: 1, priorResultAssetIds: ['r2', 'r3'],
  }
  assert.equal(first.taskId, replay.taskId)
  assert.equal(first.agentExecution?.requestDigest, digest)
  assert.equal(first.agentExecution?.idempotencyKey, 'retry-key')
  assert.deepEqual(first.agentExecution?.attempts, [originalExecution.attempts![0], expectedRetry])
  assert.deepEqual(replay.agentExecution?.attempts, first.agentExecution?.attempts)
  assert.deepEqual(h.state.tasks.get(task.taskId)?.agentExecution?.attempts, first.agentExecution?.attempts)
  assert.equal(h.scheduled.length, 1)
  assert.deepEqual(JSON.parse(await readFile(h.file, 'utf8')).tasks[0].agentExecution.attempts,
    [originalExecution.attempts![0], expectedRetry])

  h.scheduled[0]()
  for (let i = 0; i < 30 && h.pipelineCalls.length === 0; i++) await new Promise((resolve) => setImmediate(resolve))
  const onRetryAttempt = h.pipelineCalls[0]?.onShotProgress
  assert.equal(typeof onRetryAttempt, 'function')
  ;(onRetryAttempt as (shotId: string, message: string, attempt: number) => void)('s1', '供应商内部重试', 9)
  assert.equal(h.state.tasks.get(task.taskId)?.shotProgress?.[0].retryAttempt, 9)
  assert.deepEqual(h.state.tasks.get(task.taskId)?.agentExecution?.attempts?.at(-1), expectedRetry)
  await h.api.flush()
})

test('C8 旧任务缺少 attempts 时只记录当前 retry，不从顶层或 shotProgress 补造历史', async (t) => {
  const legacyExecution: NonNullable<GenerationTask['agentExecution']> = {
    schemaVersion: 1, paramsDigest: 'a'.repeat(64), assetDigests: ['legacy'],
    resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'photo-fission-v1',
    normalizationSeed: null, requestDigest: 'b'.repeat(64), idempotencyKey: 'legacy-key',
  }
  const { task, retry } = await retryEvidenceFixture({ agentExecution: legacyExecution, retryAttempt: 2 })
  const h = await harness(t, [task])
  const digest = await contracts.requestDigest({ actionKind: 'retry_shots', payload: retry })
  const result = await h.api.retryPreparedShots(retry, 'retry-third')
  assert.deepEqual(result.agentExecution?.attempts, [{
    actionKind: 'retry_shots', requestDigest: digest, idempotencyKey: 'retry-third',
    shotIds: ['s1'], attempt: 3, priorResultAssetIds: ['r2', 'r3'],
  }])
  assert.equal(h.scheduled.length, 1)
})

for (const scenario of ['result_order_mismatch', 'duplicate_result_ids'] as const) {
  test(`C8 重试拒绝损坏结果数组 ${scenario}，不调度、不落盘也不改任务`, async (t) => {
    const duplicateResults: GenerationTask['results'] = [
      { assetId: 'r2', shotId: 's2', url: '/r2.png', downloadUrl: '/r2.png', width: 1, height: 1 },
      { assetId: 'r2', shotId: 's3', url: '/r3.png', downloadUrl: '/r3.png', width: 1, height: 1 },
    ]
    const { task, retry } = scenario === 'result_order_mismatch'
      ? await retryEvidenceFixture({ resultAssetIds: ['r3', 'r2'] })
      : await retryEvidenceFixture({ results: duplicateResults, resultAssetIds: ['r2', 'r2'] })
    const h = await harness(t, [task])
    const beforeTask = JSON.stringify(h.state.tasks.get(task.taskId))
    const beforeDisk = await readFile(h.file, 'utf8')
    await assert.rejects(h.api.retryPreparedShots(retry, 'retry-key'), /任务结果基线已损坏/)
    assert.equal(JSON.stringify(h.state.tasks.get(task.taskId)), beforeTask)
    assert.equal(await readFile(h.file, 'utf8'), beforeDisk)
    assert.equal(h.scheduled.length, 0)
    assert.equal(h.pipelineCalls.length, 0)
  })
}

test('C8 JSON store 对无 attempts 的旧 agentExecution 保持原样', async (t) => {
  const p = await preview()
  const legacyExecution: NonNullable<GenerationTask['agentExecution']> = {
    schemaVersion: 1, paramsDigest: p.paramsDigest, assetDigests: [...p.assetDigests],
    resolvedModelId: p.resolvedModelId!, promptTemplateVersion: p.promptTemplateVersion!,
    normalizationSeed: p.normalizationSeed, requestDigest: 'c'.repeat(64), idempotencyKey: 'legacy-key',
  }
  const task: GenerationTask = {
    taskId: 'legacy-json', userId: 'user', featureType: p.featureType, workflowId: 'flow',
    inputAssetIds: ['asset'], params: p.normalizedParams, status: 'pending', progress: 0, message: '',
    resultAssetIds: [], results: [], creditsUsed: 0, createdAt: p.createdAt, agentExecution: legacyExecution,
  }
  const h = await harness(t, [task])
  assert.equal(JSON.stringify((await h.api.getTask(task.taskId))?.agentExecution), JSON.stringify(legacyExecution))
  await h.api.cancelPreparedTask(task.taskId, 'user')
  const diskExecution = JSON.parse(await readFile(h.file, 'utf8')).tasks[0].agentExecution
  assert.equal(JSON.stringify(diskExecution), JSON.stringify(legacyExecution))
  assert.equal(Object.hasOwn(diskExecution, 'attempts'), false)
})

test('C8 Local TaskRepo insert/update/get 完整往返 attempts 且兼容旧记录', async () => {
  const file = path.join(root, 'lib/server/storage/task-repo.local.ts')
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {} as typeof import('@/lib/server/storage/task-repo.local')
  runInThisContext(`(function(exports, globalThis) { ${code}\n})`)(exports, {})
  const repo = exports.createLocalTaskRepo()
  const generateAttempt = {
    actionKind: 'generate' as const, requestDigest: 'b'.repeat(64), idempotencyKey: 'generate-key',
    shotIds: [], attempt: null, priorResultAssetIds: [],
  }
  const execution: NonNullable<GenerationTask['agentExecution']> = {
    schemaVersion: 1, paramsDigest: 'a'.repeat(64), assetDigests: [],
    resolvedModelId: 'nano-banana-2', promptTemplateVersion: 'ai-fashion-photo-v1',
    normalizationSeed: 'seed', requestDigest: generateAttempt.requestDigest,
    idempotencyKey: generateAttempt.idempotencyKey, attempts: [generateAttempt],
  }
  await repo.insertTask({
    id: 'with-attempts', userId: 'u', type: 'ai-fashion-photo', status: 'pending',
    payloadJson: JSON.stringify({ agentExecution: execution }), resultJson: null, createdAt: 0, updatedAt: 0,
  })
  assert.deepEqual(JSON.parse((await repo.getTask('with-attempts'))!.payloadJson!).agentExecution, execution)

  const retryAttempt = {
    actionKind: 'retry_shots' as const, requestDigest: 'd'.repeat(64), idempotencyKey: 'retry-key',
    shotIds: ['s1'], attempt: 1, priorResultAssetIds: ['r2', 'r3'],
  }
  const updated: NonNullable<GenerationTask['agentExecution']> = {
    ...execution, requestDigest: retryAttempt.requestDigest, idempotencyKey: retryAttempt.idempotencyKey,
    attempts: [generateAttempt, retryAttempt],
  }
  await repo.updateTask('with-attempts', {
    payloadJson: JSON.stringify({ agentExecution: updated }), status: 'running',
  })
  assert.deepEqual(JSON.parse((await repo.getTask('with-attempts'))!.payloadJson!).agentExecution, updated)

  const legacy: NonNullable<GenerationTask['agentExecution']> = {
    ...execution, requestDigest: 'e'.repeat(64), idempotencyKey: 'legacy-key', attempts: undefined,
  }
  delete legacy.attempts
  await repo.insertTask({
    id: 'legacy', userId: 'u', type: 'ai-fashion-photo', status: 'pending',
    payloadJson: JSON.stringify({ agentExecution: legacy }), resultJson: null, createdAt: 0, updatedAt: 0,
  })
  const legacyRoundTrip = JSON.parse((await repo.getTask('legacy'))!.payloadJson!).agentExecution
  assert.equal(JSON.stringify(legacyRoundTrip), JSON.stringify(legacy))
  assert.equal(Object.hasOwn(legacyRoundTrip, 'attempts'), false)
})
