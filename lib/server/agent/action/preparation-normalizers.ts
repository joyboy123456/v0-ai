import { z } from 'zod'
import { canonicalize } from '@/lib/agent/contracts'
import type { JsonValue } from '@/lib/agent/types'
import {
  DEFAULT_FASHION_MODEL,
  SELECTABLE_FASHION_MODELS,
  type FashionModelId,
  type FeatureType,
  type PoseBodyPart,
} from '@/lib/types'
import {
  normalizeAiFashionPhotoParams,
} from '@/lib/server/ai-fashion-photo-service'
import { normalizePhotoFissionParams } from '@/lib/server/photo-fission-service'
import { normalizePoseFissionParams } from '@/lib/server/pose-fission-service'
import {
  normalizeGarmentDetailParams,
  type GarmentDetailModelResolutionLike,
} from '@/lib/server/garment-detail-service'
import {
  FEATURE_PROMPT_TEMPLATE_VERSIONS,
  type FeaturePreparationNormalizer,
  type TaskPreparationNormalizers,
} from './task-preparation'

const grsaiModels = SELECTABLE_FASHION_MODELS.filter((model) => model.provider === 'grsai')
const grsaiModelIds = new Set(grsaiModels.map((model) => model.id))

const modelSchema = z.string().refine(
  (value): value is FashionModelId => grsaiModelIds.has(value as FashionModelId),
  '只接受服务端注册的 Grsai 模型',
)
const resolutionSchema = z.enum(['2k', '4k'])

const aiFashionSettingsSchema = z.object({
  model: modelSchema.default(DEFAULT_FASHION_MODEL),
  imageRatio: z.enum(['1:1', '3:2', '2:3', '3:4', '4:3']),
  resolution: resolutionSchema,
  resultCount: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  promptMode: z.enum(['enhanced', 'raw']).default('enhanced'),
}).strict()

const photoFissionSettingsSchema = z.object({
  model: modelSchema.default(DEFAULT_FASHION_MODEL),
  category: z.literal('childrens').default('childrens'),
  childrensCategory: z.enum(['dress', 'suit', 'pants']).default('dress'),
  hasFrontDetail: z.boolean().default(false),
  hasSideDetail: z.boolean().default(false),
  hasBackDetail: z.boolean().default(false),
  frontDetailCount: z.number().int().min(0).max(2).optional(),
  sideDetailCount: z.number().int().min(0).max(2).optional(),
  backDetailCount: z.number().int().min(0).max(2).optional(),
  pantsMainHandVisibility: z.enum(['hidden', 'visible']).default('hidden'),
  imageRatio: z.enum(['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']),
  resolution: resolutionSchema,
  resultCount: z.union([z.literal(2), z.literal(4), z.literal(9), z.literal(10)]).default(9),
  plannerReasoningEnabled: z.boolean().default(false),
  faceIdModelId: z.string().trim().min(1).max(256).nullable().optional(),
  faceMaskAssetId: z.string().trim().min(1).max(256).nullable().optional(),
}).strict()

const poseFissionSettingsSchema = z.object({
  model: modelSchema.default(DEFAULT_FASHION_MODEL),
  poseIds: z.array(z.string().trim().min(1).max(256)).min(1).max(9)
    .refine((items) => new Set(items).size === items.length, '姿势不可重复'),
  hasFrontDetail: z.boolean().default(false),
  hasBackDetail: z.boolean().default(false),
  lowerBodyMainArmVisibility: z.enum(['hidden', 'visible']).default('hidden'),
  imageRatio: z.enum(['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']),
  resolution: resolutionSchema,
}).strict()

const garmentDetailSettingsSchema = z.object({
  category: z.enum(['tops', 'bottoms', 'dress', 'accessory', 'shoes-bags']),
  algorithmModelId: z.string().trim().min(1).max(256),
  resolution: z.enum(['1k', '2k', '4k']),
  imageRatio: z.enum(['1:1', '3:4', '4:3']),
  aiAppendDescription: z.boolean().default(false),
}).strict()

export interface PreparationPoseTemplate {
  id: string
  url: string
  name: string
  bodyPart: PoseBodyPart
}

/** 姿势由服务端注册表按 id 读取，模型不能提供 URL、名称或身体范围。 */
export interface PreparationPoseTemplateQueryPort {
  getPoseTemplate(poseId: string, userId: string): Promise<PreparationPoseTemplate | undefined>
}

export interface LocalPreparationNormalizerDependencies {
  poses: PreparationPoseTemplateQueryPort
  resolveGarmentDetailModel(
    algorithmModelId: string,
  ): GarmentDetailModelResolutionLike | Promise<GarmentDetailModelResolutionLike>
  promptTemplateVersions?: Partial<Record<FeatureType, string>>
}

function parseSettings<T>(schema: z.ZodType<T>, settings: JsonValue): T {
  // settings 虽来自可信服务层，仍先拒绝 getter、原型对象与非 JSON 值。
  return schema.parse(JSON.parse(canonicalize(settings)))
}

function templateVersion(
  dependencies: LocalPreparationNormalizerDependencies,
  featureType: FeatureType,
): string {
  const version = dependencies.promptTemplateVersions?.[featureType]
    ?? FEATURE_PROMPT_TEMPLATE_VERSIONS[featureType]
  if (!version.trim()) throw new Error(`${featureType} 缺少 prompt 模板版本`)
  return version
}

function assertFashionModelCapacity(
  modelId: FashionModelId,
  resolution: '2k' | '4k',
  inputAssetCount: number,
): void {
  const model = grsaiModels.find((candidate) => candidate.id === modelId)
  if (!model) throw new Error('模型不属于服务端 Grsai 注册表')
  if (inputAssetCount > model.maxInputImages) throw new Error('素材数量超出模型支持范围')
  const requested = Number.parseInt(resolution, 10)
  const supported = Number.parseInt(model.maxResolutionLabel, 10)
  if (requested > supported) throw new Error('分辨率超出模型支持范围')
}

function assertPoseTemplate(template: PreparationPoseTemplate | undefined, expectedId: string): PreparationPoseTemplate {
  if (!template || template.id !== expectedId || !template.url.trim() || !template.name.trim()
    || !['full', 'upper', 'lower'].includes(template.bodyPart)) {
    throw new Error(`服务端姿势 ${expectedId} 不存在或已变化`)
  }
  return {
    id: template.id,
    url: template.url,
    name: template.name,
    bodyPart: template.bodyPart,
  }
}

function aiFashionNormalizer(
  dependencies: LocalPreparationNormalizerDependencies,
): FeaturePreparationNormalizer {
  return {
    async normalize(input) {
      const settings = parseSettings(aiFashionSettingsSchema, input.settings)
      assertFashionModelCapacity(
        (settings.model ?? DEFAULT_FASHION_MODEL) as FashionModelId,
        settings.resolution,
        input.inputAssetIds.length,
      )
      const normalizedParams = normalizeAiFashionPhotoParams({
        userPrompt: input.prompt,
        promptMode: settings.promptMode,
        model: settings.model,
        referenceImageCount: input.inputAssetIds.length,
        imageRatio: settings.imageRatio,
        resolution: settings.resolution,
        resultCount: settings.resultCount,
      }, input.inputAssetIds.length)
      return {
        normalizedParams,
        resolvedModelId: normalizedParams.model,
        promptTemplateVersion: templateVersion(dependencies, 'ai-fashion-photo'),
        estimatedResultCount: normalizedParams.resultCount,
      }
    },
  }
}

function photoFissionNormalizer(
  dependencies: LocalPreparationNormalizerDependencies,
): FeaturePreparationNormalizer {
  return {
    async normalize(input) {
      const settings = parseSettings(photoFissionSettingsSchema, input.settings)
      assertFashionModelCapacity(
        (settings.model ?? DEFAULT_FASHION_MODEL) as FashionModelId,
        settings.resolution,
        input.inputAssetIds.length,
      )
      const normalized = normalizePhotoFissionParams(
        settings,
        input.inputAssetIds.length,
        input.inputAssetIds,
        { normalizationSeed: input.normalizationSeed },
      )
      const userRequestSection = [
        '',
        '',
        '【用户创作要求】',
        input.prompt,
        '【执行约束】用户要求仅作补充，不得覆盖前述服装保持、构图与安全约束。',
      ].join('\n')
      // 用户目标写入每个真实输出位；固定 seed 由现有 normalizer 一次性完成规划。
      const shotPlan = normalized.shotPlan.map((shot) => {
        const prompt = `${shot.prompt}${userRequestSection}`
        if (prompt.length > 32_000) throw new Error(`服装大片裂变用户要求过长（shot=${shot.shotId}）`)
        return { ...shot, prompt }
      })
      const normalizedParams = { ...normalized, shotPlan }
      return {
        normalizedParams,
        resolvedModelId: normalized.model,
        promptTemplateVersion: templateVersion(dependencies, 'photo-fission'),
        estimatedResultCount: normalized.resultCount,
      }
    },
  }
}

function poseFissionNormalizer(
  dependencies: LocalPreparationNormalizerDependencies,
): FeaturePreparationNormalizer {
  return {
    async normalize(input) {
      const settings = parseSettings(poseFissionSettingsSchema, input.settings)
      assertFashionModelCapacity(
        (settings.model ?? DEFAULT_FASHION_MODEL) as FashionModelId,
        settings.resolution,
        input.inputAssetIds.length,
      )
      const poses = await Promise.all(settings.poseIds.map(async (poseId) =>
        assertPoseTemplate(await dependencies.poses.getPoseTemplate(poseId, input.userId), poseId)))
      const normalizedParams = normalizePoseFissionParams({
        model: settings.model,
        poses,
        hasFrontDetail: settings.hasFrontDetail,
        hasBackDetail: settings.hasBackDetail,
        lowerBodyMainArmVisibility: settings.lowerBodyMainArmVisibility,
        imageRatio: settings.imageRatio,
        resolution: settings.resolution,
      }, input.inputAssetIds.length)
      return {
        normalizedParams,
        resolvedModelId: normalizedParams.model,
        promptTemplateVersion: templateVersion(dependencies, 'pose-fission'),
        estimatedResultCount: normalizedParams.resultCount,
      }
    },
  }
}

function garmentDetailNormalizer(
  dependencies: LocalPreparationNormalizerDependencies,
): FeaturePreparationNormalizer {
  return {
    async normalize(input) {
      const settings = parseSettings(garmentDetailSettingsSchema, input.settings)
      const normalized = await normalizeGarmentDetailParams({
        category: settings.category,
        algorithmModelId: settings.algorithmModelId,
        resolution: settings.resolution,
        imageRatio: settings.imageRatio,
        userPrompt: input.prompt,
        aiAppendDescription: settings.aiAppendDescription,
      }, input.inputAssetIds, {
        resolveModel: dependencies.resolveGarmentDetailModel,
      })
      const frozenTemplateVersion = dependencies.promptTemplateVersions?.['garment-detail']
        ?? normalized.promptTemplateVersion
        ?? FEATURE_PROMPT_TEMPLATE_VERSIONS['garment-detail']
      const normalizedParams = {
        ...normalized,
        promptTemplateVersion: frozenTemplateVersion,
      }
      if (!normalizedParams.resolvedModelId?.trim()
        || !grsaiModelIds.has(normalizedParams.resolvedModelId as FashionModelId)
        || !frozenTemplateVersion.trim()) {
        throw new Error('服装细节图缺少服务端注册的真实 Grsai 模型或模板版本')
      }
      return {
        normalizedParams,
        resolvedModelId: normalizedParams.resolvedModelId,
        promptTemplateVersion: frozenTemplateVersion,
        estimatedResultCount: normalizedParams.resultCount,
      }
    },
  }
}

/** 适配四个现有业务 normalizer；依赖只包含本地姿势查询和模型解析，不包含图片执行器。 */
export function createLocalPreparationNormalizers(
  dependencies: LocalPreparationNormalizerDependencies,
): TaskPreparationNormalizers {
  return Object.freeze({
    'ai-fashion-photo': aiFashionNormalizer(dependencies),
    'photo-fission': photoFissionNormalizer(dependencies),
    'pose-fission': poseFissionNormalizer(dependencies),
    'garment-detail': garmentDetailNormalizer(dependencies),
  })
}

export const createLocalTaskPreparationNormalizers = createLocalPreparationNormalizers
