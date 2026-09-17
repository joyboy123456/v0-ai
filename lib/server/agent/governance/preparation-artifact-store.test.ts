import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { canonicalize } from '@/lib/agent/contracts'
import type { AssetRecord } from '@/lib/types'
import { createTaskPreparation } from '../action/task-preparation'
import { createLocalPreparationNormalizers } from '../action/preparation-normalizers'
import { FileTaskPreparationArtifactStore, preparationArtifactKey } from './preparation-artifact-store'

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-artifacts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const asset: AssetRecord = { assetId: 'main', userId: 'user', projectId: 'project', fileName: 'main.png',
    fileUrl: '/uploads/main.png', fileType: 'image/png', width: 10, height: 20, createdAt: '2026-09-17T00:00:00.000Z', taskId: null }
  const store = new FileTaskPreparationArtifactStore(directory)
  const normalizers = createLocalPreparationNormalizers({ poses: { getPoseTemplate: async () => undefined }, resolveGarmentDetailModel: async () => { throw new Error('unused') } })
  let normalizations = 0
  const normalize = normalizers['ai-fashion-photo'].normalize
  const dependencies = { assets: { getAsset: async () => asset }, tasks: { getTask: async () => undefined }, store,
    normalizers: { ...normalizers, 'ai-fashion-photo': { normalize: async (...args: Parameters<typeof normalize>) => { normalizations++; return normalize(...args) } } },
    availability: { isFeatureAvailable: async () => true, isModelAvailable: async () => true }, now: () => new Date('2026-09-17T00:00:00.000Z') }
  const preparation = createTaskPreparation(dependencies)
  const proposal = { toolName: 'fashion_photo.create', args: { prompt: '保留服装图案' } }
  const context = { userId: 'user', sessionId: 'session', messageId: 'message', proposalId: 'proposal', version: 1,
    selectedAssetIds: ['main'], settings: { model: 'nano-banana-2', resolution: '2k', imageRatio: '3:4', resultCount: 1 } }
  return { directory, store, dependencies, preparation, proposal, context, count: () => normalizations }
}

test('C4 精确引用摘要强写后新准备器重放，不重新 normalize/抽 seed', async (t) => {
  const f = await fixture(t)
  const first = await f.preparation.prepare(f.proposal, f.context)
  const restarted = createTaskPreparation({ ...f.dependencies, store: new FileTaskPreparationArtifactStore(f.directory) })
  const replay = await restarted.prepare(f.proposal, f.context)
  assert.deepEqual(replay, first); assert.equal(f.count(), 1)
  await restarted.validatePrepared(replay)
})

test('另一个 Node 进程可验证并读取冻结工件', async (t) => {
  const f = await fixture(t); const preview = await f.preparation.prepare(f.proposal, f.context)
  const modulePath = path.resolve('lib/server/agent/governance/preparation-artifact-store.ts')
  const script = `const {FileTaskPreparationArtifactStore,preparationArtifactKey}=require(${JSON.stringify(modulePath)}); new FileTaskPreparationArtifactStore(process.argv[1]).get(preparationArtifactKey('user','proposal',1)).then(r=>process.stdout.write(JSON.stringify(r.artifact))).catch(e=>{console.error(e);process.exit(1)})`
  const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', script, f.directory], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr); assert.equal(canonicalize(JSON.parse(child.stdout)), canonicalize(preview))
})

test('多个仓储实例并发 saveIfAbsent 返回同一工件，不能覆盖批准基础', async (t) => {
  const f = await fixture(t); await f.preparation.prepare(f.proposal, f.context)
  const key = preparationArtifactKey('user', 'proposal', 1); const reference = (await f.store.get(key))!
  const copies = await Promise.all(Array.from({ length: 8 }, () => new FileTaskPreparationArtifactStore(f.directory).saveIfAbsent(reference)))
  assert.ok(copies.every((copy) => copy.referenceDigest === reference.referenceDigest))
  const file = JSON.parse(await readFile(path.join(f.directory, 'preparation-artifacts.json'), 'utf8'))
  assert.equal(file.entries.length, 1)
  copies[0].artifact.blockers.push('tampered')
  assert.deepEqual((await f.store.get(key))!.artifact.blockers, [])
})

test('当前提案版本只取服务端最高版本，低版本晚到不能使批准倒退', async (t) => {
  const f = await fixture(t)
  await f.preparation.prepare(f.proposal, { ...f.context, version: 3 })
  await f.preparation.prepare(f.proposal, f.context)
  assert.equal((await f.store.getLatest('user', 'proposal'))!.artifact.version, 3)
  assert.equal(await f.store.getLatest('other', 'proposal'), undefined)
})

test('损坏主文件、缺失主文件且有备份均失败关闭，不自动回退', async (t) => {
  for (const kind of ['corrupt', 'missing']) {
    const f = await fixture(t); await f.preparation.prepare(f.proposal, f.context)
    const file = path.join(f.directory, 'preparation-artifacts.json')
    if (kind === 'corrupt') await writeFile(file, '{bad')
    else await rm(file)
    await assert.rejects(new FileTaskPreparationArtifactStore(f.directory).get(preparationArtifactKey('user', 'proposal', 1)))
  }
})

test('修改工件或引用摘要不能落盘', async (t) => {
  const f = await fixture(t); await f.preparation.prepare(f.proposal, f.context)
  const reference = (await f.store.get(preparationArtifactKey('user', 'proposal', 1)))!
  await assert.rejects(f.store.saveIfAbsent({ ...reference, referenceDigest: 'a'.repeat(64) }), /artifact_tampered/)
  await assert.rejects(f.store.saveIfAbsent({ ...reference, artifact: { ...reference.artifact, resolvedModelId: 'other' } }), /artifact_tampered/)
})

test('withCurrent 将版本保存与提交强写串行化，版本接受点不可穿越', async (t) => {
  const f = await fixture(t); await f.preparation.prepare(f.proposal, f.context)
  const reference = (await f.store.get(preparationArtifactKey('user', 'proposal', 1)))!
  let entered!: () => void; let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const events: string[] = []
  const accepting = f.store.withCurrent({ userId: 'user', proposalId: 'proposal', version: 1, requestDigest: reference.requestDigest }, async () => {
    events.push('accept-start'); entered(); await gate; events.push('strong-write')
  })
  await started
  const updating = f.preparation.prepare(f.proposal, { ...f.context, version: 2 }).then(() => events.push('v2-saved'))
  release()
  await Promise.all([accepting, updating])
  assert.deepEqual(events, ['accept-start', 'strong-write', 'v2-saved'])
  let invoked = false
  await assert.rejects(f.store.withCurrent({ userId: 'user', proposalId: 'proposal', version: 1, requestDigest: reference.requestDigest }, async () => { invoked = true }), /preview_superseded/)
  assert.equal(invoked, false)
})
