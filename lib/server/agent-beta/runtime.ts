import path from 'node:path'
import { AgentBetaRepository } from './repository'
import { AgentBetaService } from './service'
import { resolveAgentBetaLlmConfig } from './llm-config'
import { AgentModelAdapter } from './model-adapter'
import { V1TurnRepository } from './v1-turn-repository'
import { createAgentBetaV1Bridge } from './v1-service'
import { plannerOutputSchema } from './validation'
import { createUnknownReconciler } from '../agent/governance/unknown-reconciler'
import { ActionLedgerStore } from '../agent/governance/action-ledger'
import {
  ApprovalStore,
  createApprovalEvidenceStore,
  type AuthenticatedActionScope,
  type AuthenticatedUserIntent,
} from '../agent/governance/approval-store'
import { FileTaskPreparationArtifactStore } from '../agent/governance/preparation-artifact-store'
import {
  createPostSubmitVerifier,
  createResultAdmission,
  createResultAdmissionEvidenceStore,
} from '../agent/governance/result-admission'
import { createGovernanceGateway } from '../agent/governance/gateway'
import { createTaskPreparation } from '../agent/action/task-preparation'
import { createLocalPreparationNormalizers } from '../agent/action/preparation-normalizers'
import {
  createLiveTaskAdapter,
  createLiveVendorActionAdapter,
  preparedTaskControls,
} from '../agent/governance/task-adapter'
import { ToolRegistry } from '../agent/action/tool-registry'
import { READ_TOOL_METADATA } from '../agent/action/read-tool-runner'
import { GOVERNED_TOOL_METADATA } from '../agent/action/governed-tool-actions'
import { TASK_PREPARATION_TOOL_METADATA } from '../agent/action/task-preparation'
import { AgentEventStore } from '../agent/observability/event-store'
import { ObservationStore } from '../agent/perception/observation-store'
import { createDeterministicObserver } from '../agent/perception/observation'
import { createResultReviewStore } from '../agent/reflection/review-store'
import { createResultReview } from '../agent/reflection/result-review'
import type { JsonValue } from '@/lib/agent/types'
import type { FeatureType } from '@/lib/types'

const globalBeta = globalThis as typeof globalThis & { agentBetaService?: Promise<AgentBetaService> }
const DEFAULT_TEXT_MODEL = 'deepseek-chat'

function plannerSelection(selection?: string): { model: string; parameters: Record<string, JsonValue> } {
  const config = resolveAgentBetaLlmConfig(selection)
  const protocol = config?.protocol ?? 'openai'
  const model = config?.model?.trim()
    || (protocol === 'openai' ? process.env.TEXT_LLM_MODEL?.trim() || DEFAULT_TEXT_MODEL : config?.id)
  if (!model) throw new Error('agent-model-config-unavailable')
  return protocol === 'anthropic'
    ? { model, parameters: { temperature: 0, max_tokens: 4_096 } }
    : { model, parameters: { temperature: 0, stream: false, response_format: { type: 'json_object' } } }
}

/** 在服务端总门禁通过后加载业务依赖；v1 flag 只影响新提案，不卸载已有 v1 的安全处理能力。 */
export function getAgentBetaService(): Promise<AgentBetaService> {
  globalBeta.agentBetaService ??= (async () => {
    const [tasks, scheduler, planner, providerPool, garmentModels, savedPoses, cutoutSource] = await Promise.all([
      import('@/lib/server/task-store'),
      import('@/lib/server/image-work-scheduler'),
      import('@/lib/server/fission-prompt-planner'),
      import('@/lib/server/image-provider-pool'),
      import('@/lib/server/garment-detail-model-registry'),
      import('@/lib/server/saved-pose-store'),
      import('@/lib/server/asset-cutout-service'),
    ])
    const repository = new AgentBetaRepository(undefined, { getTask: tasks.getTask })
    const taskQuery = { getTask: tasks.getTask }
    const assetQuery = { getAsset: tasks.getAsset }
    const baseQueries = { ...taskQuery, ...assetQuery }
    const reconcileExecutions = createUnknownReconciler({ ledger: repository, tasks: taskQuery })
    const artifacts = new FileTaskPreparationArtifactStore(repository.directory)
    const availability = {
      async isFeatureAvailable(feature: FeatureType) {
        return feature !== 'garment-detail' || garmentModels.isGarmentDetailBackendEnabled()
      },
      async isModelAvailable(_feature: FeatureType, model: string) {
        return providerPool.getAvailableProvidersForModel(model).some((provider) => provider.type === 'grsai')
      },
    }
    const normalizers = createLocalPreparationNormalizers({
      poses: {
        async getPoseTemplate(poseId, userId) {
          const pose = (await savedPoses.listPoses(userId)).find((candidate) => candidate.id === poseId)
          return pose ? { id: pose.id, url: pose.url, name: pose.name, bodyPart: pose.bodyPart } : undefined
        },
      },
      resolveGarmentDetailModel: garmentModels.resolveGarmentDetailModel,
    })
    const preparation = createTaskPreparation({
      assets: assetQuery,
      tasks: taskQuery,
      normalizers,
      availability,
      store: artifacts,
      taskControls: preparedTaskControls,
    })
    const commands = await createLiveTaskAdapter(preparation)
    const vendors = await createLiveVendorActionAdapter()
    const approvalEvidence = createApprovalEvidenceStore(repository.directory)
    const admissionEvidence = createResultAdmissionEvidenceStore(repository.directory)
    const postSubmit = createPostSubmitVerifier({
      artifacts,
      approvals: approvalEvidence,
      evidence: admissionEvidence,
    })
    const resultAdmission = createResultAdmission({
      tasks: taskQuery,
      assets: assetQuery,
      artifacts,
      approvals: approvalEvidence,
      evidence: admissionEvidence,
    })
    const ledger = new ActionLedgerStore(repository.directory, taskQuery)
    const eventStore = new AgentEventStore(repository.directory)
    const reviewStore = createResultReviewStore(repository.directory)
    const resultReview = createResultReview({
      assets: assetQuery,
      readAssetBytes: cutoutSource.readAssetImageBuffer,
      store: reviewStore,
      events: eventStore,
    })
    const turnRepository = new V1TurnRepository(repository.directory)
    const observationStore = new ObservationStore({
      assets: assetQuery,
      directory: path.join(repository.directory, 'observations'),
    })
    const observe = createDeterministicObserver({
      store: observationStore,
      readSourceAsset: cutoutSource.readAssetImageBuffer,
    })
    const registry = new ToolRegistry([
      ...READ_TOOL_METADATA,
      ...GOVERNED_TOOL_METADATA,
      ...TASK_PREPARATION_TOOL_METADATA,
    ])
    const model = new AgentModelAdapter()
    const sessions = {
      async getSession(userId: string, sessionId: string) {
        const file = await repository.readUser(userId)
        const session = file.sessions.find((candidate) => candidate.id === sessionId)
        return session ? {
          id: session.id,
          nodes: session.nodes.map((node) => ({ ...node })),
          messages: session.messages.map((message) => structuredClone(message)),
        } : undefined
      },
    }
    const v1 = createAgentBetaV1Bridge({
      turns: turnRepository,
      sessions,
      queries: {
        ...baseQueries,
        async getObservation(scope) {
          const observation = await observationStore.get(scope)
          return observation ? { observerVersion: scope.observerVersion, observation } : null
        },
      },
      observe,
      preparation,
      artifacts,
      registry,
      observability: eventStore,
      model,
      resolvePlanner: plannerSelection,
      governance(scope: AuthenticatedActionScope, intent?: AuthenticatedUserIntent, query = undefined) {
        const authenticated = Object.freeze({ ...scope })
        const authenticatedIntent = intent ? Object.freeze({ ...intent }) : undefined
        const approvals = new ApprovalStore(repository.directory, {
          authenticate: async () => ({ ...authenticated }),
          readAuthenticatedIntent: async () => {
            if (!authenticatedIntent) throw new Error('authenticated_intent_missing')
            return { ...authenticatedIntent }
          },
          artifacts,
          preparation,
        })
        if (!query) throw new Error('request_scoped_query_missing')
        const actions = createGovernanceGateway({
          queries: query,
          commands,
          vendors,
          preparation,
          artifacts,
          approvals,
          ledger,
          postSubmit,
          authenticate: async () => ({ ...authenticated }),
          getTaskId: tasks.getIdempotentTaskId,
          assertQueueCapacity: () => scheduler.assertImageQueueCapacity(1),
          isTaskExecutionActive: tasks.isTaskExecutionActive,
          contentPolicy: async (action) => ({
            allowed: ['generate', 'retry_shots', 'classify', 'cutout_prepare', 'cancel'].includes(action.actionKind),
          }),
        })
        return { approvals, actions }
      },
    })
    return new AgentBetaService(repository, {
      getAsset: tasks.getAsset,
      getTask: tasks.getTask,
      createTask: tasks.createTask,
      cancelTask: tasks.cancelTask,
      getTaskId: tasks.getIdempotentTaskId,
      isTaskExecutionActive: tasks.isTaskExecutionActive,
      assertQueueCapacity: () => scheduler.assertImageQueueCapacity(1),
      reconcileExecutions,
      resultAdmission,
      resultReview,
      v1,
      plan: (input) => planner.invokeFissionPromptPlanner({
        ...input,
        outputSchema: plannerOutputSchema,
        feature: 'agent-beta',
        plannerName: '服饰创作助手',
        temperature: 0.4,
        reasoningEnabled: false,
        retryOnSchemaFailure: false,
        // legacy 规划保留原接入；v1 模型请求只走 AgentModelAdapter 且不自动重试。
        llm: resolveAgentBetaLlmConfig(input.plannerLlm),
      }),
    })
  })()
  return globalBeta.agentBetaService
}
