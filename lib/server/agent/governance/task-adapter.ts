import { AGENT_BUDGET } from '@/lib/agent/budget'
import { assetDigest, canonicalize, paramsDigest, type ClassifyPayload, type CutoutPreparePayload, type PreviewArtifact, type RetryPreviewArtifact } from '@/lib/agent/contracts'
import { SELECTABLE_FASHION_MODELS, type GenerationTask } from '@/lib/types'
import type { AssetQueryPort, ClassificationResult, CutoutPreparationResult, TaskCommandPort, TaskQueryPort, VendorActionPort } from '../ports'
import type { TaskFrozenControlResolver, TaskPreparationAvailabilityPort, TaskPreparationWithRetryPort } from '../action/task-preparation'
import { FEATURE_PROMPT_TEMPLATE_VERSIONS } from '../action/task-preparation'

/** 仅治理层持有原始写能力；测试注入本地替身，真实组装采用下方惰性入口。 */
export interface TaskAdapterDependencies {
  preparation: TaskPreparationWithRetryPort
  queries: AssetQueryPort & TaskQueryPort
  commands: TaskCommandPort
  availability: TaskPreparationAvailabilityPort
}

function copy<T>(value: T): T { return JSON.parse(canonicalize(value)) as T }

function assertExecutable(preview: PreviewArtifact | RetryPreviewArtifact): void {
  if (preview.blockers.length) throw new Error(`预览尚不可执行：${preview.blockers.join(',')}`)
  if (preview.estimatedResultCount !== AGENT_BUDGET.maxResultsPerApproval) throw new Error('decision_gate:multiple_results_not_enabled')
  if (!preview.resolvedModelId || !SELECTABLE_FASHION_MODELS.some((model) => model.provider === 'grsai' && model.id === preview.resolvedModelId)) {
    throw new Error('Agent 只允许冻结的 Grsai 模型')
  }
  if (preview.promptTemplateVersion !== FEATURE_PROMPT_TEMPLATE_VERSIONS[preview.featureType]) {
    throw new Error('已批准模板版本当前不可执行，请重新预览')
  }
}

/** C7 消费 C4 冻结工件；不重新规划、不改模型、不把供应商积分当本地计费。 */
export function createTaskAdapter(dependencies: TaskAdapterDependencies): TaskCommandPort {
  async function available(preview: PreviewArtifact | RetryPreviewArtifact): Promise<void> {
    assertExecutable(preview)
    if (!await dependencies.availability.isFeatureAvailable(preview.featureType)
      || !await dependencies.availability.isModelAvailable(preview.featureType, preview.resolvedModelId!)) {
      throw new Error('已批准功能或模型当前不可用，请重新预览')
    }
  }
  return {
    async createPreparedTask(input, key) {
      const preview = copy(input)
      await dependencies.preparation.validatePrepared(preview)
      await available(preview)
      return dependencies.commands.createPreparedTask(preview, key)
    },
    async retryPreparedShots(input, key) {
      const preview = copy(input)
      await dependencies.preparation.validateRetry(preview)
      await available(preview)
      const task = await dependencies.queries.getTask(preview.taskId)
      if (!task || task.userId !== preview.userId || task.featureType !== preview.featureType
        || await paramsDigest(task.featureType, task.params) !== preview.paramsDigest) throw new Error('原任务不存在或已变化')
      return dependencies.commands.retryPreparedShots(preview, key)
    },
    async cancelTask(taskId, userId) {
      const task = await dependencies.queries.getTask(taskId)
      if (!task || task.taskId !== taskId || task.userId !== userId) throw new Error('任务不存在')
      return dependencies.commands.cancelTask(taskId, userId)
    },
  }
}

/** 只读取已落盘的真实模板/模型证据；历史任务缺字段时不以当前常量补造。 */
export const preparedTaskControls: TaskFrozenControlResolver = {
  async resolve(task: GenerationTask) {
    const controls = task.agentExecution
    if (!controls && 'promptTemplateVersion' in task.params && 'resolvedModelId' in task.params
      && task.params.promptTemplateVersion?.trim() && task.params.resolvedModelId?.trim()) {
      return { resolvedModelId: task.params.resolvedModelId, promptTemplateVersion: task.params.promptTemplateVersion }
    }
    if (!controls || controls.schemaVersion !== 1
      || controls.paramsDigest !== await paramsDigest(task.featureType, task.params)) throw new Error('任务缺少真实冻结凭证')
    return { resolvedModelId: controls.resolvedModelId, promptTemplateVersion: controls.promptTemplateVersion }
  },
}

/** 分类与抠图只暴露业务结果；供应商临时图片 URL 不返回浏览器。 */
export interface VendorAdapterDependencies {
  assets: AssetQueryPort
  classify(payload: ClassifyPayload): Promise<ClassificationResult>
  prepareCutout(payload: CutoutPreparePayload): Promise<CutoutPreparationResult>
}

export function createVendorActionAdapter(dependencies: VendorAdapterDependencies): VendorActionPort {
  async function check(payload: ClassifyPayload): Promise<void> {
    const asset = await dependencies.assets.getAsset(payload.assetId)
    if (!asset || asset.assetId !== payload.assetId || asset.userId !== payload.userId
      || await assetDigest(asset) !== payload.assetDigest) throw new Error('素材不存在或已变化')
  }
  return {
    async classify(input) {
      const payload = copy(input)
      await check(payload)
      const result = await dependencies.classify(payload)
      if (result.assetId !== payload.assetId) throw new Error('分类返回素材身份不一致')
      return result
    },
    async prepareCutout(input) {
      const payload = copy(input)
      if (payload.scene !== 'garment') throw new Error('Agent 当前只支持服装智能分层')
      await check(payload)
      const result = await dependencies.prepareCutout(payload)
      if (!result.cutoutSessionId.trim()) throw new Error('抠图会话身份缺失')
      return { cutoutSessionId: result.cutoutSessionId,
        preparedImageUrl: `/api/cutout-sessions/${encodeURIComponent(result.cutoutSessionId)}/image` }
    },
  }
}

/** 默认能力仅在服务端组装时加载；本轮没有从旧 Beta 主循环启用此入口。 */
export async function createLiveTaskAdapter(preparation: TaskPreparationWithRetryPort): Promise<TaskCommandPort> {
  const tasks = await import('@/lib/server/task-store')
  const registry = await import('@/lib/server/garment-detail-model-registry')
  const pool = await import('@/lib/server/image-provider-pool')
  return createTaskAdapter({ preparation, queries: tasks,
    commands: { createPreparedTask: tasks.createPreparedTask, retryPreparedShots: tasks.retryPreparedShots, cancelTask: tasks.cancelPreparedTask },
    availability: {
      async isFeatureAvailable(feature) { return feature !== 'garment-detail' || registry.isGarmentDetailBackendEnabled() },
      async isModelAvailable(_feature, model) { return pool.getAvailableProvidersForModel(model).some((provider) => provider.type === 'grsai') },
    },
  })
}

export async function createLiveVendorActionAdapter(): Promise<VendorActionPort> {
  const assets = await import('@/lib/server/task-store')
  return createVendorActionAdapter({ assets,
    async classify(payload) {
      const classifier = await import('@/lib/server/garment-detail-classifier')
      const result = await classifier.classifyGarmentDetailAsset({ userId: payload.userId, assetId: payload.assetId })
      return result.status === 'ok'
        ? { status: 'classified', assetId: payload.assetId, category: result.category, confidence: result.confidence }
        : { status: 'fallback', assetId: payload.assetId, category: null, confidence: null }
    },
    async prepareCutout(payload) {
      const cutout = await import('@/lib/server/cutout-session-service')
      const result = await cutout.createGarmentCutoutSession(payload.userId, payload.assetId)
      return { cutoutSessionId: result.sessionId, preparedImageUrl: `/api/cutout-sessions/${encodeURIComponent(result.sessionId)}/image` }
    },
  })
}
