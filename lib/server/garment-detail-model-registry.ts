/**
 * 高清放大细节图（garment-detail）服务端模型注册表（PRD §6）。
 *
 * 前端只识别两个稳定业务别名：std-v1（标准版）/ pro-v1（专业版），
 * 不感知实际供应商与上游模型。候选模型顺序通过环境变量配置：
 * - GARMENT_DETAIL_STANDARD_MODELS（默认 nano-banana-2-lite,gemini-3.1-flash-image-preview）
 * - GARMENT_DETAIL_PRO_MODELS（默认 nano-banana-pro,gemini-3-pro-image-preview,gpt-image-2）
 * - GARMENT_DETAIL_BACKEND_ENABLED=1 才开放后端真实链路（阶段开关，PRD §24）
 *
 * 解析规则（PRD §6.3）：按候选顺序取第一个在 Provider Pool 中有可用渠道的模型，
 * 固定到任务快照 resolvedModelId；全部不可用抛 code='MODEL_UNAVAILABLE' 的错误。
 */

import type { GarmentDetailResolution, GarmentDetailTier } from '@/lib/types'
import { getAvailableProvidersForModel } from './image-provider-pool'

/** PRD §16 业务错误码（模型注册表只可能抛出这两种）。 */
export type GarmentDetailModelErrorCode = 'INVALID_PARAMS' | 'MODEL_UNAVAILABLE'

export class GarmentDetailModelError extends Error {
  code: GarmentDetailModelErrorCode
  retryable: boolean

  constructor(input: { code: GarmentDetailModelErrorCode; message: string; retryable: boolean }) {
    super(input.message)
    this.name = 'GarmentDetailModelError'
    this.code = input.code
    this.retryable = input.retryable
  }
}

/** 档位静态描述（含内部候选模型链，不下发给前端）。 */
export interface GarmentDetailModelDefinition {
  algorithmModelId: 'std-v1' | 'pro-v1'
  algorithmModelName: string
  tier: GarmentDetailTier
  resolutions: GarmentDetailResolution[]
  recommended: boolean
  defaultSelected: boolean
  description: string
  costLabel: string
  estimatedSeconds: number
  /** 内部候选上游模型（按优先级排序），不得出现在 API 响应里（PRD §7.1 安全规则）。 */
  candidateModels: string[]
}

/** PRD §7.1 响应形态（与 mock 的 GarmentDetailModelOption 逐字段一致）。 */
export interface GarmentDetailModelOptionDto {
  algorithmModelId: string
  algorithmModelName: string
  tier: GarmentDetailTier
  resolutions: GarmentDetailResolution[]
  recommended: boolean
  defaultSelected: boolean
  description: string
  costLabel: string
  estimatedSeconds: number
}

export interface GarmentDetailModelResolution {
  definition: GarmentDetailModelDefinition
  resolvedModelId: string
}

const DEFAULT_STANDARD_MODELS = 'nano-banana-2-lite,gemini-3.1-flash-image-preview'
const DEFAULT_PRO_MODELS = 'nano-banana-pro,gemini-3-pro-image-preview,gpt-image-2'

function readCandidateModels(envValue: string | undefined, fallback: string): string[] {
  const raw = envValue?.trim() || fallback
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 档位静态描述。文案与前端已验收的档位展示对齐（原 lib/garment-detail-mock.ts
 * 的 GARMENT_DETAIL_MODELS，该 mock 已删除），响应形态见 PRD §7.1。
 */
function buildModelDefinitions(): GarmentDetailModelDefinition[] {
  return [
    {
      algorithmModelId: 'std-v1',
      algorithmModelName: '标准版',
      tier: 'standard',
      resolutions: ['1k'],
      recommended: false,
      defaultSelected: true,
      description: '细节稳定，适合常规放大出图',
      costLabel: '成本低',
      estimatedSeconds: 45,
      candidateModels: readCandidateModels(
        process.env.GARMENT_DETAIL_STANDARD_MODELS,
        DEFAULT_STANDARD_MODELS,
      ),
    },
    {
      algorithmModelId: 'pro-v1',
      algorithmModelName: '专业版',
      tier: 'professional',
      resolutions: ['2k', '4k'],
      recommended: true,
      defaultSelected: false,
      description: '文本控制灵活，适合指定细节/风格',
      costLabel: '成本高',
      estimatedSeconds: 75,
      candidateModels: readCandidateModels(
        process.env.GARMENT_DETAIL_PRO_MODELS,
        DEFAULT_PRO_MODELS,
      ),
    },
  ]
}

export function isGarmentDetailBackendEnabled(): boolean {
  return process.env.GARMENT_DETAIL_BACKEND_ENABLED === '1'
}

function toDto(definition: GarmentDetailModelDefinition): GarmentDetailModelOptionDto {
  return {
    algorithmModelId: definition.algorithmModelId,
    algorithmModelName: definition.algorithmModelName,
    tier: definition.tier,
    resolutions: [...definition.resolutions],
    recommended: definition.recommended,
    defaultSelected: definition.defaultSelected,
    description: definition.description,
    costLabel: definition.costLabel,
    estimatedSeconds: definition.estimatedSeconds,
  }
}

/** 档位是否有至少一个可用上游渠道（Provider Pool 可用 ∩ 模型兼容）。 */
function hasAvailableUpstream(definition: GarmentDetailModelDefinition): boolean {
  return definition.candidateModels.some(
    (modelId) => getAvailableProvidersForModel(modelId).length > 0,
  )
}

/**
 * GET /api/garment-detail/models 的数据源（PRD §7.1）：
 * 只返回至少有一个可用上游渠道的档位；全部不可用时返回空数组（路由层转 503）。
 * 响应不暴露候选上游模型 ID、Provider 凭证与渠道地址。
 */
export function listAvailableGarmentDetailModels(): GarmentDetailModelOptionDto[] {
  const definitions = buildModelDefinitions()
  const available = definitions.filter(hasAvailableUpstream).map(toDto)
  try {
    console.log(
      JSON.stringify({
        evt: 'garment_detail.models',
        requested: definitions.length,
        available: available.map((model) => model.algorithmModelId),
      }),
    )
  } catch {
    // 日志失败忽略
  }
  return available
}

/**
 * 创建任务时的模型解析（PRD §6.3）：
 * 1. 校验业务别名合法（仅 std-v1 / pro-v1）；
 * 2. 按候选模型顺序取第一个有可用渠道的真实模型；
 * 3. 全部不可用抛 code='MODEL_UNAVAILABLE'（retryable）的错误。
 */
export function resolveGarmentDetailModel(
  algorithmModelId: string,
): GarmentDetailModelResolution {
  const normalized = typeof algorithmModelId === 'string' ? algorithmModelId.trim() : ''
  const definition = buildModelDefinitions().find(
    (item) => item.algorithmModelId === normalized,
  )
  if (!definition) {
    throw new GarmentDetailModelError({
      code: 'INVALID_PARAMS',
      message: '模型档位无效，仅支持标准版（std-v1）或专业版（pro-v1）',
      retryable: false,
    })
  }

  for (const candidate of definition.candidateModels) {
    if (getAvailableProvidersForModel(candidate).length > 0) {
      return { definition, resolvedModelId: candidate }
    }
  }

  throw new GarmentDetailModelError({
    code: 'MODEL_UNAVAILABLE',
    message: `${definition.algorithmModelName}暂无可用上游模型，请稍后重试`,
    retryable: true,
  })
}
