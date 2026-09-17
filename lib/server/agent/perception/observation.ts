import sharp from 'sharp'
import type { GarmentObservation } from '@/lib/agent/types'
import type { AssetRecord } from '@/lib/types'
import type { ClassificationResult } from '../ports'
import { detectFace as builtinDetectFace } from '../../face-detection'
import type { ObservationContent, ObservationContext, ObservationScope, ObservationStore } from './observation-store'

/** B2 确定性观察器：只做本地图像事实 + 已注入的分类回调，不调用任何供应商。 */
export interface DeterministicObserverOptions {
  store: ObservationStore
  /** 源资产字节必须由组合根注入；观察器不自行读路径或 import 资产服务。 */
  readSourceAsset: (asset: AssetRecord) => Promise<Buffer>
  detectFace?: typeof builtinDetectFace
  /** 仅接受已过 Gateway 的分类回调；未配置时类别保持 unknown。 */
  categoryProbe?: (context: ObservationContext) => Promise<ClassificationResult>
  timeoutMs?: number
}

const OBSERVER_MODEL = 'deterministic-v1'
const DEFAULT_TIMEOUT_MS = 2000
const MAX_SOURCE_BYTES = 40 * 1024 * 1024
const MAX_SOURCE_PIXELS = 40_000_000
const ANALYSIS_SIZE = 512
const NOT_DETECTED_NOTE = '未执行OCR/水印/模糊/风格检测，相关布尔字段为占位false'

interface CategoryMapping {
  category: GarmentObservation['category']
  coarseNote?: string
}

/** Map 不读取原型属性；粗类别只记安全说明，不硬缩窄到共享 schema 中的细类。 */
const CATEGORY_MAP: ReadonlyMap<string, CategoryMapping> = new Map([
  ['tops', { category: 'tops' }],
  ['bottoms', { category: 'unknown', coarseNote: '分类粗类：下装（裤或裙）' }],
  ['dress', { category: 'dress' }],
  ['accessory', { category: 'accessory' }],
  ['shoes-bags', { category: 'unknown', coarseNote: '分类粗类：鞋或包' }],
])

interface PixelFacts {
  width: number
  height: number
  dominantColors: string[]
  lowResolution: boolean
}

interface PixelInspection extends PixelFacts {
  /** 仅在存在可见像素时交给独立的人脸阶段。 */
  faceSource: Buffer | null
}

interface ImageFacts extends PixelFacts {
  hasFace: boolean
  faceNote: string | null
}

interface Guarded<T> {
  value: T | null
  note: string | null
}

/** 延迟调用以隔离同步抛错；超时、成功或失败都会清 timer，迟到拒绝也已有处理器。 */
function withTimeout<T>(task: () => T | PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(label))
    }, ms)
    Promise.resolve().then(task).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(label))
      },
    )
  })
}

async function guarded<T>(task: Promise<T>, note: string): Promise<Guarded<T>> {
  try { return { value: await task, note: null } } catch { return { value: null, note } }
}

interface ColorInspection {
  dominantColors: string[]
  hasVisiblePixels: boolean
}

/** RGBA 频次统计：4bit 量化取代表色（首个真实像素），忽略 alpha=0，不做平均。 */
function inspectColors(data: Buffer): ColorInspection {
  const buckets = new Map<number, { count: number; rgb: [number, number, number] }>()
  let hasVisiblePixels = false
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    hasVisiblePixels = true
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const entry = buckets.get(key)
    if (entry) entry.count += 1
    else buckets.set(key, { count: 1, rgb: [r, g, b] })
  }
  const dominantColors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(({ rgb }) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`)
  return { dominantColors, hasVisiblePixels }
}

/** 第一阶段只读取可信像素事实；成功结果不会再被后续 face 超时抹掉。 */
async function inspectPixels(context: ObservationContext,
  options: DeterministicObserverOptions): Promise<PixelInspection> {
  const source = await options.readSourceAsset(context.asset)
  if (!Buffer.isBuffer(source) || source.length === 0 || source.length > MAX_SOURCE_BYTES) {
    throw new Error('源资产字节不可用')
  }
  const metadata = await sharp(source).metadata()
  const swapped = (metadata.orientation ?? 1) >= 5
  const width = swapped ? metadata.height ?? 0 : metadata.width ?? 0
  const height = swapped ? metadata.width ?? 0 : metadata.height ?? 0
  if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) {
    throw new Error('源资产尺寸不可用')
  }
  const resized = { width: ANALYSIS_SIZE, height: ANALYSIS_SIZE, fit: 'inside' as const, withoutEnlargement: true }
  // gray 先转 sRGB；自动按 EXIF 旋转后再统计。
  const { data } = await sharp(source).rotate().toColourspace('srgb')
    .resize(resized).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { dominantColors, hasVisiblePixels } = inspectColors(data)
  return {
    width,
    height,
    dominantColors,
    lowResolution: width < ANALYSIS_SIZE || height < ANALYSIS_SIZE,
    faceSource: hasVisiblePixels ? source : null,
  }
}

/** 第二阶段独立准备 face 输入：显式 sRGB，并把透明区域合成到白底后输出 RGB PNG。 */
async function inspectFace(source: Buffer, options: DeterministicObserverOptions): Promise<boolean> {
  const resized = { width: ANALYSIS_SIZE, height: ANALYSIS_SIZE, fit: 'inside' as const, withoutEnlargement: true }
  const faceInput = await sharp(source).rotate().toColourspace('srgb').resize(resized)
    .flatten({ background: { r: 255, g: 255, b: 255 } }).removeAlpha().png().toBuffer()
  return Boolean(await (options.detectFace ?? builtinDetectFace)(faceInput))
}

/** 像素与 face 各自有独立时限；全透明图不进入 face 阶段。 */
async function inspectImage(context: ObservationContext, options: DeterministicObserverOptions,
  timeoutMs: number): Promise<Guarded<ImageFacts>> {
  const pixels = await guarded(
    withTimeout(() => inspectPixels(context, options), timeoutMs, '图像事实超时'),
    '源资产读取失败',
  )
  if (!pixels.value) return { value: null, note: pixels.note }

  const { faceSource, ...pixelFacts } = pixels.value
  if (!faceSource) return { value: { ...pixelFacts, hasFace: false, faceNote: null }, note: null }

  const face = await guarded(
    withTimeout(() => inspectFace(faceSource, options), timeoutMs, '人脸弱信号检测超时'),
    '人脸弱信号检测未完成',
  )
  return {
    value: { ...pixelFacts, hasFace: face.value ?? false, faceNote: face.note },
    note: null,
  }
}

interface ReadClassification {
  category: GarmentObservation['category']
  confidence: number
  note: string
}

/** 回调输出视为运行时不可信：身份、类别和置信度任一非法即整个忽略。 */
function readProbe(result: unknown, context: ObservationContext): ReadClassification | null {
  try {
    if (typeof result !== 'object' || result === null) return null
    const candidate = result as Partial<ClassificationResult>
    const status = candidate.status
    const assetId = candidate.assetId
    const rawCategory = candidate.category
    const confidence = candidate.confidence
    if (status !== 'classified' || assetId !== context.asset.assetId) return null
    if (typeof rawCategory !== 'string' || typeof confidence !== 'number'
      || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
    const mapping = CATEGORY_MAP.get(rawCategory)
    if (!mapping) return null
    const note = mapping.coarseNote
      ? `${mapping.coarseNote}；分类置信度：${confidence.toFixed(3)}`
      : `分类来源：已注入回调（${mapping.category}）`
    return { category: mapping.category, confidence, note }
  } catch {
    return null
  }
}

async function observeOnce(context: ObservationContext, options: DeterministicObserverOptions,
  timeoutMs: number): Promise<ObservationContent> {
  const categoryProbe = options.categoryProbe
  const imageTask = inspectImage(context, options, timeoutMs)
  const probeTask = categoryProbe
    ? guarded(withTimeout(() => categoryProbe(context), timeoutMs, '分类探测超时'), '分类探测失败')
    : Promise.resolve<Guarded<ClassificationResult>>({ value: null, note: '分类探测未配置' })
  const [image, probe] = await Promise.all([imageTask, probeTask])
  const facts = image.value
  const classified = readProbe(probe.value, context)

  // 分类和肤色检测都不证明主体布局；只保留明确类别与弱信号事实。
  const subject: ObservationContent['subject'] = 'unknown'
  const category: ObservationContent['category'] = classified?.category ?? 'unknown'
  const confidence = classified?.confidence ?? (facts ? 0.35 : 0)

  const notes: string[] = []
  if (facts) {
    notes.push(`${facts.width}x${facts.height}`)
    if (facts.lowResolution) notes.push('低分辨率（任一边<512）')
    if (facts.hasFace) notes.push('肤色启发式弱信号疑似人物，未确认主体或布局')
    if (facts.faceNote) notes.push(facts.faceNote)
  } else {
    notes.push(image.note ?? '图像事实不可用')
  }
  notes.push(classified?.note ?? probe.note ?? '分类结果无效，已忽略')
  notes.push(NOT_DETECTED_NOTE)

  return {
    observerModel: OBSERVER_MODEL,
    subject,
    category,
    dominantColors: facts?.dominantColors ?? [],
    silhouette: '',
    keyDetails: [],
    hasVisibleText: false,
    hasFace: facts?.hasFace ?? false,
    quality: { blurry: false, lowResolution: facts?.lowResolution ?? false, watermark: false },
    confidence,
    notes: notes.join('；'),
  }
}

/** 缓存与身份绑定交给 store；回调只产出描述内容，不自动重试。 */
export function createDeterministicObserver(
  options: DeterministicObserverOptions,
): (scope: ObservationScope) => Promise<GarmentObservation> {
  if (typeof options.readSourceAsset !== 'function') throw new TypeError('readSourceAsset 必须注入')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs 必须为正有限数')
  return (scope) => options.store.getOrCompute(scope, (context) => observeOnce(context, options, timeoutMs))
}
