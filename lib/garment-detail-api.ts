/**
 * 高清放大细节图（garment-detail）前端 API 客户端。
 *
 * 纯浏览器端模块：只封装 fetch 调用与纯函数，不得 import 任何 lib/server/*。
 * 对应 PRD §7 API 契约：
 * - §7.1 GET  /api/garment-detail/models   模型版本列表
 * - §7.2 POST /api/garment-detail/classify 商品分类建议
 * - §7.3 创建任务复用 POST /api/tasks（在 left-panel 的通用提交链路中）
 */
import type {
  GarmentDetailCategory,
  GarmentDetailResolution,
  GarmentDetailShot,
  GarmentDetailTier,
} from './types'

// ---------------------------------------------------------------------------
// 模型版本列表（PRD §7.1）
// ---------------------------------------------------------------------------

export interface GarmentDetailModelOption {
  algorithmModelId: string
  algorithmModelName: string
  tier: GarmentDetailTier
  resolutions: GarmentDetailResolution[]
  recommended: boolean
  defaultSelected: boolean
  description: string
  costLabel: string
  /** 展示用预计耗时（秒），对应 PRD §18 标准版 ≤60s / 专业版 ≤90s */
  estimatedSeconds: number
}

/**
 * 拉取模型版本列表。非 2xx（含 503 MODEL_UNAVAILABLE）抛错，由调用方兜底展示。
 */
export async function fetchGarmentDetailModels(): Promise<GarmentDetailModelOption[]> {
  const response = await fetch('/api/garment-detail/models', { cache: 'no-store' })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `模型版本列表加载失败：HTTP ${response.status}`)
  }
  const data = (await response.json()) as { models?: GarmentDetailModelOption[] }
  return Array.isArray(data.models) ? data.models : []
}

// ---------------------------------------------------------------------------
// 商品分类建议（PRD §7.2）
// ---------------------------------------------------------------------------

export interface GarmentDetailClassifyCandidate {
  category: GarmentDetailCategory
  score: number
}

/**
 * 分类响应双形态：
 * - ok：分类服务正常返回（needsConfirmation 为 true 时前端提示用户确认）
 * - fallback：分类服务降级（附 warning，前端保持表单可用、不阻塞提交）
 */
export interface GarmentDetailClassifyResult {
  status: 'ok' | 'fallback'
  category: GarmentDetailCategory
  confidence: number
  needsConfirmation: boolean
  candidates: GarmentDetailClassifyCandidate[]
  source: string
  warning?: string
}

/**
 * 主图上传成功后请求分类建议。
 * 网络错误 / 非 2xx 会抛错，由调用方兜底（按 fallback 同等处理，不阻塞表单）。
 */
export async function classifyGarmentDetail(
  assetId: string,
): Promise<GarmentDetailClassifyResult> {
  const response = await fetch('/api/garment-detail/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetId }),
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `商品分类识别失败：HTTP ${response.status}`)
  }
  return (await response.json()) as GarmentDetailClassifyResult
}

// ---------------------------------------------------------------------------
// 细节输出位规划（供 getParams 组装 detailShots；服务端会按同规则重建并覆盖）
// ---------------------------------------------------------------------------

const DETAIL_PART_LABELS: Record<GarmentDetailCategory, string[]> = {
  tops: ['领口细节', '袖口细节', '面料纹理'],
  bottoms: ['腰头细节', '走线细节', '面料纹理'],
  dress: ['领口细节', '裙摆细节', '面料纹理'],
  accessory: ['材质特写', '工艺细节', '质感纹理'],
  'shoes-bags': ['五金细节', '走线细节', '材质特写'],
}

/**
 * 输出数量 = 参考图数量（无参考图时输出 1 张）。
 * 每个输出位对应一个细节部位标签，按分类循环取；shotId 从 detail_1 开始，
 * 第 N 个输出位绑定第 N 张参考图。规则需与服务端 normalize 保持一致（PRD §5.3）。
 */
export function buildGarmentDetailShots(
  category: GarmentDetailCategory,
  referenceAssetIds: (string | null)[],
): GarmentDetailShot[] {
  const parts = DETAIL_PART_LABELS[category]
  if (referenceAssetIds.length === 0) {
    return [{ shotId: 'detail_1', label: parts[0], referenceAssetId: null }]
  }
  return referenceAssetIds.map((assetId, index) => ({
    shotId: `detail_${index + 1}`,
    label: parts[index % parts.length],
    referenceAssetId: assetId,
  }))
}
