/**
 * 高清放大细节图（garment-detail）商品分类建议（PRD §7.2）。
 *
 * 链路：assetId → getAsset + userId 所有权校验（不存在/越权统一 404 语义）
 * → readAssetImageBuffer 读字节 → prepareAliyunCutoutInput（≤3MB JPEG）
 * → uploadViapiTemporaryInput（viapi 临时桶）→ 一次 SegmentCloth 调 7 类。
 *
 * SegmentCloth 不返回置信度（研究笔记 classify-and-shots.md §3），
 * 这里用「命中类别分割图前景像素面积占比」推导 score：
 * 下载有 ClassUrl 的类别结果图（并发，单类别失败跳过），alpha > 8 计前景。
 *
 * 降级契约：fallback 模式（合并图无法区分类别）或任何异常/超时 →
 * 返回 PRD §7.2 fallback 形态（HTTP 200），绝不抛错阻塞生成；
 * 但素材不存在/越权仍抛 404 语义错误（GarmentDetailAssetNotFoundError）。
 *
 * node --test 兼容性（AGENTS.md 约定）：本模块只允许 import type 级别的
 * 仓库内依赖 + npm 包（sharp）；运行时依赖全部经 dependencies 注入，
 * 缺省时在函数内懒加载动态 import——单测注入替身后不会触发动态 import。
 */

import sharp from 'sharp'

import type { AssetRecord, ClothCategory, GarmentDetailCategory } from '@/lib/types'
import type {
  AliyunCutoutConfig,
  PreparedAliyunCutoutInput,
  SegmentClothByClassResult,
} from './aliyun-cutout-adapter'

/**
 * 同步来源：aliyun-cutout-adapter.ts CLOTH_CLASSES（SegmentCloth ClothClass.1..7）。
 * 单独维护是因为 node --test 原生跑 TS 时无法解析本模块以外的运行时 import。
 */
const CLOTH_CLASSES: readonly ClothCategory[] = [
  'tops',
  'coat',
  'skirt',
  'pants',
  'bag',
  'shoes',
  'hat',
]

/** 灰度 mask 前景判定阈值（白 255 前景 / 黑 0 背景，取中值以上）。 */
const FOREGROUND_GRAY_THRESHOLD = 127

/** PRD §6.2：GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS，默认 15000（15s 超时降级）。 */
const DEFAULT_CLASSIFY_TIMEOUT_MS = 15_000

/** 低于该置信度时要求用户手动确认分类。 */
const CONFIRMATION_CONFIDENCE_THRESHOLD = 0.6

/** dress 判定：skirt 面积至少达到 tops 面积的 40%（近似 PRD「区域连续」）。 */
const DRESS_SKIRT_MIN_RATIO = 0.4

const FALLBACK_WARNING = '智能识别暂不可用，请手动确认商品分类'

export interface GarmentDetailClassifyCandidate {
  category: GarmentDetailCategory
  score: number
}

export interface GarmentDetailClassifyOk {
  status: 'ok'
  category: GarmentDetailCategory
  confidence: number
  needsConfirmation: boolean
  candidates: GarmentDetailClassifyCandidate[]
  source: 'aliyun-segment-cloth'
  requestId?: string
}

export interface GarmentDetailClassifyFallback {
  status: 'fallback'
  category: 'tops'
  confidence: 0
  needsConfirmation: true
  candidates: GarmentDetailClassifyCandidate[]
  source: 'fallback'
  warning: string
}

export type GarmentDetailClassifyResponse =
  | GarmentDetailClassifyOk
  | GarmentDetailClassifyFallback

/** 素材不存在或越权（404 语义，不暴露素材存在性）。 */
export class GarmentDetailAssetNotFoundError extends Error {
  code = 'ASSET_NOT_FOUND' as const
  status = 404
  retryable = false

  constructor(message = '素材不存在') {
    super(message)
    this.name = 'GarmentDetailAssetNotFoundError'
  }
}

export interface GarmentDetailClassifyDependencies {
  getAssetById?: (assetId: string) => Promise<AssetRecord | undefined>
  readSourceAsset?: (asset: AssetRecord) => Promise<Buffer>
  readCanvasDimensions?: (
    sourceBuffer: Buffer,
  ) => Promise<{ width: number; height: number }>
  prepareInput?: (input: {
    sourceBuffer: Buffer
    originalWidth: number
    originalHeight: number
  }) => Promise<PreparedAliyunCutoutInput>
  readConfig?: () => AliyunCutoutConfig
  uploadInput?: (
    input: PreparedAliyunCutoutInput,
    config: AliyunCutoutConfig,
  ) => Promise<string>
  segmentCloth?: (
    imageUrl: string,
    config: AliyunCutoutConfig,
    classes: readonly ClothCategory[],
  ) => Promise<SegmentClothByClassResult>
  downloadResult?: (url: string, timeoutMs: number) => Promise<Buffer>
}

type ResolvedDependencies = Required<GarmentDetailClassifyDependencies>

/**
 * 缺省依赖经懒加载动态 import 解析（extensionless 说明符由 Next/webpack/tsc 解析；
 * node --test 单测总是注入替身，永远不会走到这里）。
 */
async function resolveDependencies(
  injected: GarmentDetailClassifyDependencies,
): Promise<ResolvedDependencies> {
  const taskStore = injected.getAssetById ? null : await import('./task-store')
  const cutoutService = injected.readSourceAsset
    ? null
    : await import('./asset-cutout-service')
  const needsAdapter =
    !injected.readCanvasDimensions ||
    !injected.prepareInput ||
    !injected.readConfig ||
    !injected.uploadInput ||
    !injected.segmentCloth ||
    !injected.downloadResult
  const adapter = needsAdapter ? await import('./aliyun-cutout-adapter') : null

  return {
    getAssetById: injected.getAssetById ?? taskStore!.getAsset,
    readSourceAsset: injected.readSourceAsset ?? cutoutService!.readAssetImageBuffer,
    readCanvasDimensions:
      injected.readCanvasDimensions ?? adapter!.readSourceCanvasDimensions,
    prepareInput: injected.prepareInput ?? adapter!.prepareAliyunCutoutInput,
    readConfig: injected.readConfig ?? adapter!.readAliyunCutoutConfig,
    uploadInput: injected.uploadInput ?? adapter!.uploadViapiTemporaryInput,
    segmentCloth: injected.segmentCloth ?? adapter!.segmentClothByClass,
    downloadResult: injected.downloadResult ?? adapter!.downloadCutoutResult,
  }
}

function readClassifyTimeoutMs(): number {
  const raw = Number(process.env.GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS)
  return Number.isFinite(raw) && raw >= 1000
    ? Math.floor(raw)
    : DEFAULT_CLASSIFY_TIMEOUT_MS
}

function buildFallbackResponse(): GarmentDetailClassifyFallback {
  return {
    status: 'fallback',
    category: 'tops',
    confidence: 0,
    needsConfirmation: true,
    candidates: [],
    source: 'fallback',
    warning: FALLBACK_WARNING,
  }
}

/**
 * 统计分割结果图的前景像素占比。
 *
 * 实测（2026-08-16 测试站）：SegmentCloth 按类返回的是 1 通道灰度 PNG mask
 * （前景白 255 / 背景黑 0，无 alpha），因此必须按灰度值计前景——不能用
 * ensureAlpha() 读 alpha 通道（会给无 alpha 的图补全 255 不透明通道，ratio 恒 1）。
 * 另外 sharp 的 raw() 会把 1 通道灰度转成 3 通道，必须先 toColourspace('b-w')
 * （AGENTS.md 记录的 sharp 灰度坑）。
 */
async function measureForegroundRatio(
  pngBuffer: Buffer,
): Promise<{ foreground: number; total: number }> {
  const { data, info } = await sharp(pngBuffer)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const total = info.width * info.height
  if (total <= 0) return { foreground: 0, total: 0 }
  let foreground = 0
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] > FOREGROUND_GRAY_THRESHOLD) foreground += 1
  }
  return { foreground, total }
}

/**
 * 并发下载各类别分割图并测量前景面积占比；单类别失败只跳过该类别。
 * 返回 类别 → 前景像素占该类别结果图画布的比例（0~1）。
 */
async function measureClassRatios(
  classUrls: Record<string, string>,
  dependencies: ResolvedDependencies,
  timeoutMs: number,
): Promise<Partial<Record<ClothCategory, number>>> {
  const entries = Object.entries(classUrls).filter(
    (entry): entry is [ClothCategory, string] =>
      (CLOTH_CLASSES as readonly string[]).includes(entry[0]) && Boolean(entry[1]),
  )
  const measured = await Promise.all(
    entries.map(async ([clothClass, url]) => {
      try {
        const buffer = await dependencies.downloadResult(url, timeoutMs)
        const { foreground, total } = await measureForegroundRatio(buffer)
        if (total <= 0) return null
        return { clothClass, ratio: foreground / total }
      } catch (error) {
        console.warn(
          '[garment-detail-classify] 类别分割图下载/测量失败，跳过该类别',
          {
            clothClass,
            error: error instanceof Error ? error.message : String(error),
          },
        )
        return null
      }
    }),
  )

  const ratios: Partial<Record<ClothCategory, number>> = {}
  for (const item of measured) {
    if (!item) continue
    ratios[item.clothClass] = item.ratio
  }
  return ratios
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 按 PRD §7.2 映射表把 7 类分割结果归并到 5 个业务分类：
 * tops/coat→tops、pants/skirt→bottoms、bag/shoes→shoes-bags、hat→accessory；
 * tops+skirt 同命中 → dress（置信度取两者较低者，并强制 needsConfirmation）。
 */
function buildCategoryDecision(
  ratios: Partial<Record<ClothCategory, number>>,
  requestId: string,
): GarmentDetailClassifyResponse {
  const topsRaw = (ratios.tops ?? 0) + (ratios.coat ?? 0)
  const bottomsRaw = (ratios.pants ?? 0) + (ratios.skirt ?? 0)
  const shoesBagsRaw = (ratios.bag ?? 0) + (ratios.shoes ?? 0)
  const accessoryRaw = ratios.hat ?? 0

  // SegmentCloth 不给置信度，单类面积占比的分母是整张画布（含背景），
  // 绝对值普遍很小（实测上装约 0.1~0.2）。归一化为「占全部命中服饰面积
  // 的份额」，让 confidence 落到 PRD §7.2 示例的 0~1 语义区间。
  const total = topsRaw + bottomsRaw + shoesBagsRaw + accessoryRaw
  if (total <= 0) return buildFallbackResponse()
  const normalize = (raw: number) => raw / total

  const sorted: GarmentDetailClassifyCandidate[] = (
    [
      { category: 'tops', score: normalize(topsRaw) },
      { category: 'bottoms', score: normalize(bottomsRaw) },
      { category: 'shoes-bags', score: normalize(shoesBagsRaw) },
      { category: 'accessory', score: normalize(accessoryRaw) },
    ] satisfies GarmentDetailClassifyCandidate[]
  )
    .filter((candidate) => candidate.score > 0)
    .map((candidate) => ({ ...candidate, score: roundScore(candidate.score) }))
    .sort((left, right) => right.score - left.score)

  const hasTops = (ratios.tops ?? 0) > 0
  const hasSkirt = (ratios.skirt ?? 0) > 0
  const candidates = [...sorted]
  // PRD 规则原文是「tops + skirt 且区域连续 → dress」。面积数据里真正的连衣裙
  // 裙摆面积与上身相当；普通上衣的下摆常被误分割出一小条 skirt。用
  // 「skirt 面积 ≥ tops 面积 × 0.4」近似区域连续判定，避免所有上装都被建议成 dress。
  const topsArea = ratios.tops ?? 0
  const skirtArea = ratios.skirt ?? 0
  if (hasTops && hasSkirt && skirtArea >= topsArea * DRESS_SKIRT_MIN_RATIO) {
    // 连衣裙会被同时分割出 tops + skirt；dress 固定置顶为建议分类，
    // 置信度取两者较低者的归一化份额（info.md 分类器设计）。
    candidates.unshift({
      category: 'dress',
      score: roundScore(normalize(Math.min(topsArea, skirtArea))),
    })
  }

  if (!candidates.length) return buildFallbackResponse()

  const top = candidates[0]
  return {
    status: 'ok',
    category: top.category,
    confidence: top.score,
    needsConfirmation:
      top.category === 'dress' ||
      top.score < CONFIRMATION_CONFIDENCE_THRESHOLD,
    candidates,
    source: 'aliyun-segment-cloth',
    requestId,
  }
}

function logClassifyEvent(payload: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ evt: 'garment_detail.classify', ...payload }))
  } catch {
    // 日志失败忽略
  }
}

/**
 * 分类建议主入口。只接受服务端 AssetRecord 对应的 assetId（不接受公网 URL）。
 * 素材不存在/越权抛 GarmentDetailAssetNotFoundError（404 语义）；
 * 其余任何异常/超时/降级都返回 fallback 响应（HTTP 200，不阻塞生成）。
 */
export async function classifyGarmentDetailAsset(
  input: { assetId: string; userId: string },
  dependencies: GarmentDetailClassifyDependencies = {},
): Promise<GarmentDetailClassifyResponse> {
  const startedAt = Date.now()
  const deps = await resolveDependencies(dependencies)

  const assetId = input.assetId.trim()
  const userId = input.userId.trim()
  if (!assetId || !userId) throw new GarmentDetailAssetNotFoundError()

  const asset = await deps.getAssetById(assetId)
  // 与 task-store createTask 一致：历史素材缺 userId 时按 demo_user 处理。
  if (!asset || (asset.userId ?? 'demo_user') !== userId) {
    throw new GarmentDetailAssetNotFoundError()
  }

  try {
    const sourceBuffer = await deps.readSourceAsset(asset)
    const dimensions = await deps.readCanvasDimensions(sourceBuffer)
    const prepared = await deps.prepareInput({
      sourceBuffer,
      originalWidth: dimensions.width,
      originalHeight: dimensions.height,
    })
    const config: AliyunCutoutConfig = {
      ...deps.readConfig(),
      timeoutMs: readClassifyTimeoutMs(),
    }
    const inputUrl = await deps.uploadInput(prepared, config)
    const cloth = await deps.segmentCloth(inputUrl, config, CLOTH_CLASSES)

    // fallback（合并图）模式下所有类别共用同一 URL，无法区分类别，直接降级。
    if (cloth.fallback === true) {
      const response = buildFallbackResponse()
      logClassifyEvent({
        assetId,
        userId,
        status: response.status,
        source: response.source,
        reason: 'segment_cloth_fallback',
        requestId: cloth.requestId,
        durationMs: Date.now() - startedAt,
      })
      return response
    }

    const ratios = await measureClassRatios(cloth.classUrls, deps, config.timeoutMs)
    const response = buildCategoryDecision(ratios, cloth.requestId)
    logClassifyEvent({
      assetId,
      userId,
      status: response.status,
      category: response.category,
      confidence: response.confidence,
      source: response.source,
      requestId: cloth.requestId,
      // 各类别前景面积占比（0~1），用于置信度推导的线上诊断；体量小、无敏感信息。
      classCount: Object.keys(cloth.classUrls).length,
      ratios,
      durationMs: Date.now() - startedAt,
    })
    return response
  } catch (error) {
    // 分类服务故障不得阻塞用户生成（PRD §7.2）：任何异常统一降级。
    console.warn('[garment-detail-classify] 分类失败，降级为手动确认', {
      assetId,
      error: error instanceof Error ? error.message : String(error),
    })
    const response = buildFallbackResponse()
    logClassifyEvent({
      assetId,
      userId,
      status: response.status,
      source: response.source,
      reason: 'exception',
      durationMs: Date.now() - startedAt,
    })
    return response
  }
}
