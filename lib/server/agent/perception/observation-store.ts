import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { OBSERVATION_TTL_MS } from '@/lib/agent/budget'
import { assetDigest, digest, toJsonValue } from '@/lib/agent/contracts'
import type { GarmentObservation } from '@/lib/agent/types'
import type { AssetRecord } from '@/lib/types'
import { writeJsonFileAtomic } from '@/lib/server/json-file-store'
import type { AssetQueryPort } from '../ports'

/** 身份来自服务端会话；observerVersion 由观察器配置决定，不能由模型提供。 */
export interface ObservationScope {
  userId: string
  assetId: string
  observerVersion: string
}

/** 观察器只返回描述；资产身份、来源和观察时间由存储层绑定。 */
export type ObservationContent = Omit<GarmentObservation, 'assetId' | 'assetDigest' | 'observedAt' | 'origin'>

export interface ObservationContext {
  readonly asset: Readonly<AssetRecord>
  readonly assetDigest: string
  readonly observerVersion: string
}

export interface ObservationStoreOptions {
  assets: AssetQueryPort
  directory?: string
  now?: () => Date
}

/** 缓存 miss 返回 null；归属、计算和存储故障不得伪装成缓存命中。 */
export class ObservationStoreError extends Error {
  constructor(readonly code: 'INVALID_SCOPE' | 'ASSET_NOT_FOUND' | 'ASSET_CHANGED'
    | 'INVALID_OBSERVATION' | 'CACHE_UNAVAILABLE') {
    super(`观察缓存不可用：${code}`)
    this.name = 'ObservationStoreError'
  }
}

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const scopeSchema = z.object({ userId: identifier, assetId: identifier,
  observerVersion: z.string().min(1).max(200).refine((value) => value.trim() === value && Boolean(value)),
}).strict()
const contentSchema = z.object({
  observerModel: z.string().min(1).max(200),
  subject: z.enum(['garment_flat', 'garment_on_model', 'person', 'detail_shot', 'other', 'unknown']),
  category: z.enum(['tops', 'coat', 'skirt', 'pants', 'bag', 'shoes', 'hat', 'dress', 'suit', 'accessory', 'unknown']),
  dominantColors: z.array(z.string().max(200)).max(32), silhouette: z.string().max(4000),
  keyDetails: z.array(z.string().max(2000)).max(64), hasVisibleText: z.boolean(), hasFace: z.boolean(),
  quality: z.object({ blurry: z.boolean(), lowResolution: z.boolean(), watermark: z.boolean() }).strict(),
  confidence: z.number().finite().min(0).max(1), notes: z.string().max(8000),
}).strict()
const observationSchema = contentSchema.extend({ assetId: identifier, assetDigest: hash,
  observedAt: z.string().datetime(), origin: z.literal('image_observation'),
})
const envelopeSchema = z.object({ schemaVersion: z.literal(1), userId: identifier, assetId: identifier,
  assetDigest: hash, observerVersion: scopeSchema.shape.observerVersion, expiresAt: z.string().datetime(),
  observation: observationSchema,
}).strict()

interface ResolvedObservation extends ObservationScope {
  asset: AssetRecord
  assetDigest: string
  fileName: string
}

// 单进程内跨实例合并同一键的“读 → 计算 → 写”；完成或失败后释放，不是长期内存缓存。
const pending = new Map<string, Promise<GarmentObservation>>()
const MAX_CACHE_BYTES = 1024 * 1024
const hasCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException)?.code === code

/** 缓存命中也必须重新鉴权；get 不触发观察，损坏缓存不会退回旧备份。 */
export class ObservationStore {
  private readonly directory: string
  private readonly now: () => Date

  constructor(private readonly options: ObservationStoreOptions) {
    this.directory = path.resolve(options.directory ?? path.join(process.cwd(), 'data', 'agent-beta', 'obs'))
    this.now = options.now ?? (() => new Date())
  }

  private async resolve(scope: ObservationScope): Promise<ResolvedObservation> {
    const parsed = scopeSchema.safeParse(scope)
    if (!parsed.success) throw new ObservationStoreError('INVALID_SCOPE')
    const input = parsed.data
    const asset = await this.options.assets.getAsset(input.assetId)
    if (!asset || asset.assetId !== input.assetId || asset.userId !== input.userId) {
      throw new ObservationStoreError('ASSET_NOT_FOUND')
    }
    const snapshot = structuredClone(asset)
    const version = await assetDigest(snapshot)
    const fileName = `${await digest({ schemaVersion: 1, ...input, assetDigest: version })}.json`
    return { ...input, asset: snapshot, assetDigest: version, fileName }
  }

  private async assertCurrent(resolved: ResolvedObservation): Promise<void> {
    const current = await this.resolve({ userId: resolved.userId, assetId: resolved.assetId, observerVersion: resolved.observerVersion })
    if (current.assetDigest !== resolved.assetDigest) throw new ObservationStoreError('ASSET_CHANGED')
  }

  private async read(resolved: ResolvedObservation): Promise<GarmentObservation | null> {
    let raw: string
    try {
      const handle = await open(path.join(this.directory, resolved.fileName), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const metadata = await handle.stat()
        if (!metadata.isFile() || metadata.size > MAX_CACHE_BYTES) return null
        raw = await handle.readFile('utf8')
      } finally { await handle.close() }
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ELOOP')) return null
      throw new ObservationStoreError('CACHE_UNAVAILABLE')
    }
    try {
      const parsed = envelopeSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return null
      const entry = parsed.data
      const observedAt = Date.parse(entry.observation.observedAt)
      const expiresAt = Date.parse(entry.expiresAt)
      const now = this.now().getTime()
      if (!Number.isFinite(now) || observedAt > now || expiresAt !== observedAt + OBSERVATION_TTL_MS || now >= expiresAt
        || entry.userId !== resolved.userId || entry.assetId !== resolved.assetId
        || entry.assetDigest !== resolved.assetDigest || entry.observerVersion !== resolved.observerVersion
        || entry.observation.assetId !== resolved.assetId || entry.observation.assetDigest !== resolved.assetDigest) return null
      return entry.observation
    } catch { return null }
  }

  /** 只读取，miss/损坏/过期返回 null；读取不续期，归属失效直接拒绝。 */
  async get(scope: ObservationScope): Promise<GarmentObservation | null> {
    const resolved = await this.resolve(scope)
    const observation = await this.read(resolved)
    if (observation) {
      try { await this.assertCurrent(resolved) } catch (error) {
        if (error instanceof ObservationStoreError && error.code === 'ASSET_CHANGED') return null
        throw error
      }
    }
    return observation
  }

  private async writableDirectory(): Promise<string> {
    try {
      await mkdir(this.directory, { recursive: true })
      if (!(await lstat(this.directory)).isDirectory()) throw new Error('缓存目录不是普通目录')
      return await realpath(this.directory)
    } catch { throw new ObservationStoreError('CACHE_UNAVAILABLE') }
  }

  private async compute(resolved: ResolvedObservation, directory: string,
    observe: (context: ObservationContext) => Promise<ObservationContent>): Promise<GarmentObservation> {
    const cached = await this.read(resolved)
    if (cached) return cached
    await this.assertCurrent(resolved)
    const result = await observe({ asset: structuredClone(resolved.asset), assetDigest: resolved.assetDigest,
      observerVersion: resolved.observerVersion })
    let content: ObservationContent
    try { content = contentSchema.parse(toJsonValue(result)) } catch { throw new ObservationStoreError('INVALID_OBSERVATION') }
    await this.assertCurrent(resolved)
    const observation: GarmentObservation = { ...content, assetId: resolved.assetId, assetDigest: resolved.assetDigest,
      observedAt: this.now().toISOString(), origin: 'image_observation' }
    const entry = envelopeSchema.parse({ schemaVersion: 1, userId: resolved.userId, assetId: resolved.assetId,
      assetDigest: resolved.assetDigest, observerVersion: resolved.observerVersion,
      expiresAt: new Date(Date.parse(observation.observedAt) + OBSERVATION_TTL_MS).toISOString(), observation })
    const filePath = path.join(directory, resolved.fileName)
    try {
      // 固定临时文件由上面的整键去重串行保护；不沿用缓存目录内的符号链接。
      for (const candidate of [filePath, `${filePath}.tmp-write`, `${filePath}.bak`, `${filePath}.bak.tmp-write`]) {
        try { if (!(await lstat(candidate)).isFile()) throw new Error('缓存文件不是普通文件') }
        catch (error) { if (!hasCode(error, 'ENOENT')) throw error }
      }
      await writeJsonFileAtomic(filePath, entry, 'agent-observation-cache')
    } catch { throw new ObservationStoreError('CACHE_UNAVAILABLE') }
    return observation
  }

  /** observe 仅由可信服务端注入；B1 不加载图片、不调用视觉或生图供应商，也不自动重试。 */
  async getOrCompute(scope: ObservationScope, observe: (context: ObservationContext) => Promise<ObservationContent>): Promise<GarmentObservation> {
    const resolved = await this.resolve(scope)
    const directory = await this.writableDirectory()
    const key = path.join(directory, resolved.fileName)
    let operation = pending.get(key)
    if (!operation) {
      operation = this.compute(resolved, directory, observe)
      pending.set(key, operation)
    }
    try {
      const observation = await operation
      await this.assertCurrent(resolved)
      return structuredClone(observation)
    } finally {
      if (pending.get(key) === operation) pending.delete(key)
    }
  }
}
