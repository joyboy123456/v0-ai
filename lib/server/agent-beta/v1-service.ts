import { createHash } from 'node:crypto'
import { assetDigest, canonicalize, digest, type GovernedAction, type UserIntentReceipt } from '@/lib/agent/contracts'
import type { AgentTurnResult, AgentTurnToolTraceEntry } from '@/lib/agent/turn-types'
import type { GarmentObservation, JsonValue } from '@/lib/agent/types'
import type {
  AgentBetaMessage,
  AgentBetaMessageInput,
  AgentBetaPlan,
  AgentBetaPreviewAssetView,
  AgentBetaPreviewView,
  AgentBetaToolTraceView,
} from '@/lib/agent-beta/types'
import type { AssetRecord, FeatureType, GenerationTask, TaskStatus } from '@/lib/types'
import { routeAgentRequest } from '../agent/reasoning/router'
import type { AgentEventStore } from '../agent/observability/event-store'
import type { AgentModelPort, GovernedActionPort, QueryPort, SessionQueryRecord } from '../agent/ports'
import type { ToolRegistry } from '../agent/action/tool-registry'
import type { TaskPreparationWithRetryPort } from '../agent/action/task-preparation'
import type { CurrentTaskPreparationArtifactStorePort } from '../agent/governance/preparation-artifact-store'
import type { ApprovalStore, AuthenticatedActionScope, AuthenticatedUserIntent } from '../agent/governance/approval-store'
import { preparationArtifactKey } from '../agent/governance/preparation-artifact-store'
import { createAgentTurnRuntime, type AgentTurnInput } from '../agent/turn'
import { AgentBetaError } from './validation'
import type {
  AgentBetaV1ActionScope,
  AgentBetaV1BridgePort,
  AgentBetaV1ConfirmCommand,
  AgentBetaV1RepreviewCommand,
  AgentBetaV1TurnProjection,
  AgentBetaV1TurnScope,
} from './v1-bridge'
import {
  V1TurnRepositoryError,
  computeAgentTurnInputDigest,
  type V1TurnRecord,
  type V1TurnRepositoryPort,
} from './v1-turn-repository'

const OBSERVER_VERSION = 'deterministic-v1'
const TOKEN_BUDGET = 20_000
const AI_FEATURE: FeatureType = 'ai-fashion-photo'
const USER_GOAL_NOTICE_PREFIX = '用户目标：'
const HASH_LENGTH = 32

export interface AgentBetaV1StoredSession {
  id: string
  messages: AgentBetaMessage[]
  nodes: Array<{ id: string; assetId: string; taskId?: string }>
}

export interface AgentBetaV1SessionSource {
  getSession(userId: string, sessionId: string): Promise<AgentBetaV1StoredSession | undefined>
}

export interface AgentBetaV1PlannerSelection {
  model: string
  parameters: Record<string, JsonValue>
}

export interface AgentBetaV1GovernanceContext {
  approvals: Pick<ApprovalStore, 'issueApproval' | 'issueIntent'>
  actions: GovernedActionPort
}

export interface AgentBetaV1BridgeDependencies {
  enabled?: () => boolean
  turns: V1TurnRepositoryPort
  sessions: AgentBetaV1SessionSource
  queries: Pick<QueryPort, 'getAsset' | 'getTask'> & Partial<Pick<QueryPort, 'getObservation'>>
  observe(scope: { userId: string; assetId: string; observerVersion: string }): Promise<GarmentObservation>
  preparation: TaskPreparationWithRetryPort
  artifacts: CurrentTaskPreparationArtifactStorePort
  registry: ToolRegistry
  observability: AgentEventStore
  model: AgentModelPort
  resolvePlanner(selection?: string): AgentBetaV1PlannerSelection
  governance(
    scope: AuthenticatedActionScope,
    intent?: AuthenticatedUserIntent,
    query?: QueryPort,
  ): AgentBetaV1GovernanceContext
  now?: () => Date
}

interface CurrentNode {
  id: string
  assetId: string
  taskId?: string
  digest: string
}

interface CurrentTaskProjection {
  taskId: string
  userId?: string
  featureType: FeatureType
  status: TaskStatus
  resolvedModelId?: string
}

interface CurrentContext {
  session: AgentBetaV1StoredSession
  query: QueryPort
  nodes: CurrentNode[]
  selected: CurrentNode[]
  task?: CurrentTaskProjection
  failedShotIds: string[]
}

function flagEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.AGENT_RUNTIME_V1_ENABLED === 'true'
}

export function isAgentRuntimeV1Enabled(environment: Record<string, string | undefined> = process.env): boolean {
  return flagEnabled(environment)
}

function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalize(value)) as T
}

function stableId(prefix: string, values: readonly string[]): string {
  return `${prefix}_${createHash('sha256').update(canonicalize(values)).digest('hex').slice(0, HASH_LENGTH)}`
}

function readNow(now: () => Date): Date {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AgentBetaError('服务端时钟不可用', 503, 'AGENT_BETA_RUNTIME_UNAVAILABLE')
  }
  return value
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function taskStatus(value: CurrentTaskProjection | undefined, failedShotCount: number): {
  taskId: string
  status: TaskStatus | 'unknown'
  failedShotCount?: number
} | undefined {
  if (!value) return undefined
  return {
    taskId: value.taskId,
    status: value.status,
    ...(failedShotCount ? { failedShotCount } : {}),
  }
}

function publicTrace(entries: readonly AgentTurnToolTraceEntry[]): AgentBetaToolTraceView[] {
  return entries.map((entry) => ({
    step: entry.step,
    toolName: entry.toolName,
    status: entry.status,
    ...(entry.target ? { target: entry.target } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  }))
}

function promptFromPreview(result: NonNullable<AgentTurnResult['preview']>): string {
  const notice = result.riskNotices.find((value) => value.startsWith(USER_GOAL_NOTICE_PREFIX))
  const prompt = notice?.slice(USER_GOAL_NOTICE_PREFIX.length).trim()
  if (!prompt) throw new AgentBetaError('预览缺少可编辑要求，请重新发送消息', 409, 'AGENT_BETA_PREVIEW_INVALID')
  return prompt
}

function previewSettings(preview: NonNullable<AgentTurnResult['preview']>): Record<string, JsonValue> {
  if (preview.featureType !== AI_FEATURE || preview.toolName !== 'fashion_photo.create'
    || !('normalizedParams' in preview)) {
    throw new AgentBetaError('该功能的参数尚不能在 Beta 画布中安全编辑，请重新说明需求', 409, 'AGENT_BETA_FEATURE_NEEDS_INPUT')
  }
  const params = preview.normalizedParams as unknown as Record<string, unknown>
  if (typeof params.model !== 'string' || typeof params.imageRatio !== 'string' || typeof params.resolution !== 'string') {
    throw new AgentBetaError('预览参数不可用，请重新发送消息', 409, 'AGENT_BETA_PREVIEW_INVALID')
  }
  return {
    model: params.model,
    imageRatio: params.imageRatio,
    resolution: params.resolution,
    resultCount: 1,
    promptMode: 'raw',
  }
}

function assertPreviewIdentity(
  reference: Awaited<ReturnType<CurrentTaskPreparationArtifactStorePort['get']>>,
  command: AgentBetaV1ConfirmCommand | AgentBetaV1RepreviewCommand,
): asserts reference is NonNullable<typeof reference> {
  if (!reference
    || reference.artifact.userId !== command.userId
    || reference.artifact.sessionId !== command.sessionId
    || reference.artifact.messageId !== command.messageId
    || reference.artifact.proposalId !== command.proposalId
    || reference.artifact.version !== command.previewVersion
    || reference.requestDigest !== command.previewDigest) {
    throw new AgentBetaError('预览版本或身份不一致，请刷新后重试', 409, 'AGENT_BETA_PREVIEW_CONFLICT')
  }
}

function isPaidResult(
  result: Awaited<ReturnType<GovernedActionPort['execute']>>,
): result is Extract<typeof result, { actionKind: 'generate' | 'retry_shots' }> {
  return result.actionKind === 'generate' || result.actionKind === 'retry_shots'
}

export class AgentBetaV1Bridge implements AgentBetaV1BridgePort {
  readonly #now: () => Date

  constructor(private readonly dependencies: AgentBetaV1BridgeDependencies) {
    this.#now = dependencies.now ?? (() => new Date())
  }

  isEnabledForNewProposals(): boolean {
    return (this.dependencies.enabled ?? flagEnabled)()
  }

  async hasTurn(scope: AgentBetaV1TurnScope): Promise<boolean> {
    return Boolean(await this.dependencies.turns.get(scope))
  }

  async #session(userId: string, sessionId: string): Promise<AgentBetaV1StoredSession> {
    const session = await this.dependencies.sessions.getSession(userId, sessionId)
    if (!session || session.id !== sessionId) {
      throw new AgentBetaError('会话不存在', 404, 'AGENT_BETA_SESSION_NOT_FOUND')
    }
    return cloneCanonical(session)
  }

  #query(
    scope: Pick<AgentBetaV1ActionScope, 'userId' | 'sessionId'>,
    visibleNodeIds?: readonly string[],
  ): QueryPort {
    const sessions = this.dependencies.sessions
    const queries = this.dependencies.queries
    const visible = visibleNodeIds ? new Set(visibleNodeIds) : undefined
    return {
      async getAsset(assetId) { return queries.getAsset(assetId) },
      async getTask(taskId) { return queries.getTask(taskId) },
      async getSession(sessionId) {
        if (sessionId !== scope.sessionId) return undefined
        const session = await sessions.getSession(scope.userId, sessionId)
        if (!session || session.id !== sessionId) return undefined
        const nodes: SessionQueryRecord['nodes'] = []
        const taskIds = new Set<string>()
        for (const node of session.nodes) {
          if (visible && !visible.has(node.id)) continue
          const asset = await queries.getAsset(node.assetId)
          if (!asset || asset.assetId !== node.assetId || asset.userId !== scope.userId) continue
          nodes.push({ id: node.id, assetId: node.assetId, name: asset.fileName, ...(node.taskId ? { taskId: node.taskId } : {}) })
          if (node.taskId) taskIds.add(node.taskId)
        }
        for (const message of session.messages) if (message.plan?.task?.taskId) taskIds.add(message.plan.task.taskId)
        return { sessionId, userId: scope.userId, nodes, taskIds: [...taskIds] }
      },
      ...(queries.getObservation ? {
        async getObservation(input) { return queries.getObservation!(input) },
      } : {}),
    }
  }

  async #context(
    userId: string,
    sessionId: string,
    referenceNodeIds: readonly string[],
    text: string,
    visibleNodeIds: readonly string[],
  ): Promise<CurrentContext> {
    const session = await this.#session(userId, sessionId)
    if (new Set(referenceNodeIds).size !== referenceNodeIds.length
      || new Set(visibleNodeIds).size !== visibleNodeIds.length) {
      throw new AgentBetaError('参考图或安全节点列表不能重复')
    }
    const visible = new Set(visibleNodeIds)
    const query = this.#query({ userId, sessionId }, visibleNodeIds)
    const nodes: CurrentNode[] = []
    for (const node of session.nodes) {
      if (!visible.has(node.id)) continue
      const asset = await query.getAsset(node.assetId)
      if (!asset || asset.assetId !== node.assetId || asset.userId !== userId || !asset.fileUrl || asset.fileUrl.startsWith('data:')) {
        if (referenceNodeIds.includes(node.id)) {
          throw new AgentBetaError('素材不存在或无权访问', 404, 'AGENT_BETA_ASSET_NOT_FOUND')
        }
        continue
      }
      nodes.push({ ...node, digest: await assetDigest(asset) })
    }
    const selected = referenceNodeIds.map((nodeId) => {
      const node = nodes.find((candidate) => candidate.id === nodeId)
      if (!node) throw new AgentBetaError('参考图不属于当前会话', 400, 'AGENT_BETA_ASSET_NOT_FOUND')
      return node
    })

    const selectedTaskIds = [...new Set(selected.flatMap((node) => node.taskId ? [node.taskId] : []))]
    const latestTaskId = [...session.messages].reverse().find((message) => message.plan?.task)?.plan?.task?.taskId
    const candidateTaskId = selectedTaskIds.length === 1 ? selectedTaskIds[0]
      : selectedTaskIds.length === 0 ? latestTaskId : undefined
    let task: CurrentTaskProjection | undefined
    let failedShotIds: string[] = []
    if (candidateTaskId) {
      const current = await query.getTask(candidateTaskId)
      if (current?.taskId === candidateTaskId && current.userId === userId) {
        task = {
          taskId: current.taskId,
          userId: current.userId,
          featureType: current.featureType,
          status: current.status,
          ...(current.agentExecution?.resolvedModelId
            ? { resolvedModelId: current.agentExecution.resolvedModelId } : {}),
        }
        failedShotIds = current.shotProgress?.filter((shot) => shot.status === 'failed'
          && !current.results.some((result) => result.shotId === shot.shotId)).map((shot) => shot.shotId) ?? []
      }
    }

    // 对多个不同任务的选择不猜测目标；C10 会要求用户明确选择。
    if (selectedTaskIds.length > 1 && /重试|取消|停止|任务/u.test(text)) task = undefined
    return { session, query, nodes, selected, task, failedShotIds }
  }

  async #issueIntent(
    scope: AuthenticatedActionScope,
    route: ReturnType<typeof routeAgentRequest>,
    context: CurrentContext,
  ): Promise<Partial<Record<UserIntentReceipt['actionKind'], UserIntentReceipt>> | undefined> {
    let intent: AuthenticatedUserIntent | undefined
    if (route.costClass === 'vendor_api' && route.risk === 'read_only' && context.selected.length === 1) {
      intent = { actionKind: 'classify', targetId: context.selected[0].assetId }
    } else if (route.costClass === 'vendor_api' && route.risk === 'write_reversible' && context.selected.length === 1) {
      intent = { actionKind: 'cutout_prepare', targetId: context.selected[0].assetId }
    } else if (route.costClass === 'free_text' && route.risk === 'write_reversible' && context.task) {
      intent = { actionKind: 'cancel', targetId: context.task.taskId }
    }
    if (!intent) return undefined
    const governance = this.dependencies.governance(scope, intent, context.query)
    const receipt = await governance.approvals.issueIntent()
    return { [receipt.actionKind]: receipt }
  }

  async #buildTurn(
    scope: Omit<AgentBetaV1TurnScope, 'clientMessageId'>,
    input: AgentBetaMessageInput,
    visibleNodeIds: readonly string[],
  ): Promise<V1TurnRecord> {
    const createdAt = readNow(this.#now).toISOString()
    const messageId = stableId('v1msg', [scope.userId, scope.sessionId, input.clientMessageId])
    const turnId = stableId('v1turn', [scope.userId, scope.sessionId, input.clientMessageId])
    const proposalId = stableId('v1proposal', [scope.userId, scope.sessionId, input.clientMessageId])
    const goalId = stableId('v1goal', [scope.userId, scope.sessionId, input.clientMessageId])
    const context = await this.#context(
      scope.userId,
      scope.sessionId,
      input.referenceNodeIds,
      input.text,
      visibleNodeIds,
    )
    const selectedAssetIds = context.selected.map((node) => node.assetId)
    const initialTask = taskStatus(context.task, context.failedShotIds.length)
    const initialRoute = routeAgentRequest({
      text: input.text,
      selectedAssetIds,
      featureType: AI_FEATURE,
      resolvedModelId: input.settings.model,
      task: initialTask,
      hasPlan: context.session.messages.some((message) => message.plan?.status === 'proposed'),
    })
    const taskOperation = initialRoute.intent === 'retry'
      || (initialRoute.intent === 'edit' && initialRoute.costClass === 'free_text')
    const featureType = taskOperation && context.task ? context.task.featureType : AI_FEATURE
    const resolvedModelId = taskOperation
      ? context.task?.resolvedModelId ?? input.settings.model
      : input.settings.model
    const route = routeAgentRequest({
      text: input.text,
      selectedAssetIds,
      featureType,
      resolvedModelId,
      task: initialTask,
      hasPlan: context.session.messages.some((message) => message.plan?.status === 'proposed'),
    })
    const actionAssetIds = route.intent === 'retry'
      || (route.intent === 'edit' && route.costClass === 'free_text') ? [] : selectedAssetIds
    const planner = this.dependencies.resolvePlanner(input.settings.plannerLlm)
    if (!planner.model.trim()) {
      throw new AgentBetaError('规划模型当前不可用', 503, 'AGENT_BETA_MODEL_UNAVAILABLE')
    }

    const observations = new Map<string, GarmentObservation>()
    await Promise.all(context.selected.map(async (node) => {
      const observation = await this.dependencies.observe({
        userId: scope.userId,
        assetId: node.assetId,
        observerVersion: OBSERVER_VERSION,
      })
      if (observation.assetId !== node.assetId || observation.assetDigest !== node.digest
        || observation.origin !== 'image_observation') {
        throw new AgentBetaError('素材观察已变化，请重试', 409, 'AGENT_BETA_ASSET_CHANGED')
      }
      observations.set(node.assetId, cloneCanonical(observation))
    }))

    const intentScope = { userId: scope.userId, sessionId: scope.sessionId, messageId }
    const intents = await this.#issueIntent(intentScope, route, context)
    const historyTaskIds = [...new Set(context.nodes.flatMap((node) => node.taskId ? [node.taskId] : []))]
    const inputMessages = context.session.messages.slice(-20).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    }))
    inputMessages.push({ id: input.clientMessageId, role: 'user', content: input.text, createdAt })
    const generation = route.costClass === 'paid_generation' && route.intent !== 'retry' ? {
      model: { value: input.settings.model, origin: 'user_selection' as const },
      imageRatio: { value: input.settings.imageRatio, origin: 'user_selection' as const },
      resolution: { value: input.settings.resolution, origin: 'user_selection' as const },
      resultCount: { value: 1, origin: 'system_policy' as const },
    } : undefined
    const turnInput: AgentTurnInput = {
      identity: { userId: scope.userId, sessionId: scope.sessionId, messageId, turnId },
      text: input.text,
      model: planner.model,
      parameters: cloneCanonical(planner.parameters),
      triage: {
        userId: scope.userId,
        sessionId: scope.sessionId,
        observerVersion: OBSERVER_VERSION,
        tokenBudget: TOKEN_BUDGET,
        goal: {
          goalId,
          userGoal: input.text,
          constraints: ['保持服装主体和用户明确要求；不得绕过预览、批准或结果安全核验'],
        },
        taskStatus: context.task ? {
          summary: `当前任务状态为 ${context.task.status}`,
          currentStepId: context.task.taskId,
          status: context.task.status,
        } : {
          summary: '当前没有可验证的选中任务',
          currentStepId: 'turn',
          status: 'TODO',
        },
        failureEvidence: context.task && ['failed', 'partial'].includes(context.task.status)
          ? context.failedShotIds.map((shotId) => `镜头 ${shotId} 当前失败`) : [],
        platformRules: [
          '付费生成只能返回冻结预览，必须由用户另行确认后提交。',
          '任务状态不等于结果可发布，只有安全准入结果可以加入画布。',
          '当前 Beta 只可配置单张 AI 服装生图；其他功能缺少参数时必须澄清。',
        ],
        settings: {
          featureType,
          model: input.settings.model,
          imageRatio: input.settings.imageRatio,
          resolution: input.settings.resolution,
          resultCount: 1,
        },
        nodes: context.nodes.map((node) => ({
          nodeId: node.id,
          assetId: node.assetId,
          assetDigest: node.digest,
          selected: context.selected.some((selected) => selected.id === node.id),
          ...(observations.has(node.assetId) ? { observation: observations.get(node.assetId)! } : {}),
        })),
        messages: inputMessages,
        historyTaskIds,
      },
      route: {
        featureType,
        resolvedModelId,
        ...(initialTask ? { task: initialTask } : {}),
        hasPlan: context.session.messages.some((message) => message.plan?.status === 'proposed'),
      },
      authorization: {
        allowed: true,
        allowedToolNames: this.dependencies.registry.list()
          .filter((tool) => !['photo_fission.create', 'pose_fission.create', 'garment_detail.create'].includes(tool.name))
          .map((tool) => tool.name),
        purpose: route.costClass === 'vendor_api' && route.risk === 'write_reversible' ? 'cutout' : 'general',
      },
      binding: {
        userId: scope.userId,
        sessionId: scope.sessionId,
        messageId,
        idempotencyKey: `agent-beta:${scope.sessionId}:${messageId}`,
        assetIds: { value: actionAssetIds, origin: actionAssetIds.length ? 'user_selection' : 'system_policy' },
        ...(context.task && taskOperation ? {
          taskId: { value: context.task.taskId, origin: 'user_selection' },
        } : {}),
        ...(route.intent === 'retry' && context.failedShotIds.length ? {
          shotIds: { value: context.failedShotIds, origin: 'system_policy' },
        } : {}),
        ...(generation ? { generation } : {}),
      },
      preparation: {
        userId: scope.userId,
        sessionId: scope.sessionId,
        messageId,
        proposalId,
        version: 1,
        selectedAssetIds: actionAssetIds,
        settings: generation ? {
          model: input.settings.model,
          imageRatio: input.settings.imageRatio,
          resolution: input.settings.resolution,
          resultCount: 1,
          promptMode: 'raw',
        } : {},
      },
      ...(intents ? { intents } : {}),
      ...(intents?.cutout_prepare ? { cutoutScene: 'garment' as const } : {}),
    }
    const inputDigest = await computeAgentTurnInputDigest(turnInput)
    const requestFingerprint = await digest({ schemaVersion: 1, input })
    try {
      return await this.dependencies.turns.saveIfAbsent({
        userId: scope.userId,
        sessionId: scope.sessionId,
        clientMessageId: input.clientMessageId,
        messageId,
        turnId,
        requestFingerprint,
        inputDigest,
        input: turnInput,
        createdAt,
      })
    } catch (error) {
      // 并发实例可能基于不同观察时间构造候选；同请求始终采用先强写的冻结输入。
      if (!(error instanceof V1TurnRepositoryError) || error.code !== 'TURN_CONFLICT') throw error
      const winner = await this.dependencies.turns.get({
        userId: scope.userId,
        sessionId: scope.sessionId,
        clientMessageId: input.clientMessageId,
      })
      if (!winner || winner.requestFingerprint !== requestFingerprint) throw error
      return winner
    }
  }

  async #projectPreview(
    scope: Pick<AgentBetaV1ActionScope, 'userId' | 'sessionId'>,
    reference: NonNullable<Awaited<ReturnType<CurrentTaskPreparationArtifactStorePort['get']>>>,
  ): Promise<AgentBetaPreviewView> {
    const session = await this.#session(scope.userId, scope.sessionId)
    const assets: AgentBetaPreviewAssetView[] = []
    for (const assetId of reference.inputAssetIds) {
      const node = session.nodes.find((candidate) => candidate.assetId === assetId)
      const asset = await this.dependencies.queries.getAsset(assetId)
      if (!node || !asset || asset.assetId !== assetId || asset.userId !== scope.userId) {
        throw new AgentBetaError('预览素材不存在或已变化', 409, 'AGENT_BETA_ASSET_CHANGED')
      }
      assets.push({ nodeId: node.id, assetId, name: asset.fileName })
    }
    const preview = reference.artifact
    if (typeof preview.resolvedModelId !== 'string' || !preview.resolvedModelId.trim()) {
      throw new AgentBetaError('预览缺少冻结模型，请重新发送消息', 409, 'AGENT_BETA_PREVIEW_INVALID')
    }
    return {
      schemaVersion: 1,
      proposalId: preview.proposalId,
      version: preview.version,
      digest: reference.requestDigest,
      featureType: preview.featureType,
      toolName: preview.toolName,
      resolvedModelId: preview.resolvedModelId,
      estimatedResultCount: preview.estimatedResultCount,
      assets,
      blockers: [...preview.blockers],
      riskNotices: [...preview.riskNotices],
      createdAt: preview.createdAt,
      expiresAt: preview.expiresAt,
      confirmable: preview.blockers.length === 0
        && preview.estimatedResultCount === 1
        && readNow(this.#now).getTime() < Date.parse(preview.expiresAt),
    }
  }

  async #projection(record: V1TurnRecord, result: AgentTurnResult, settings: AgentBetaMessageInput['settings'], referenceNodeIds: string[]): Promise<AgentBetaV1TurnProjection> {
    const trace = publicTrace(result.toolTrace)
    const userMessage: AgentBetaMessage = {
      id: record.clientMessageId,
      role: 'user',
      content: record.input.text,
      createdAt: record.createdAt,
      referenceNodeIds: [...referenceNodeIds],
    }
    let plan: AgentBetaPlan | undefined
    if (result.preview) {
      const reference = await this.dependencies.artifacts.get(preparationArtifactKey(
        record.userId,
        result.preview.proposalId,
        result.preview.version,
      ))
      if (!reference || canonicalize(reference.artifact) !== canonicalize(result.preview)) {
        throw new AgentBetaError('冻结预览不可用，请重新发送消息', 409, 'AGENT_BETA_PREVIEW_INVALID')
      }
      plan = {
        id: result.preview.proposalId,
        prompt: 'taskId' in result.preview ? record.input.text : promptFromPreview(result.preview),
        referenceNodeIds: [...referenceNodeIds],
        settings: cloneCanonical(settings),
        status: 'proposed',
        protocol: 'agent-runtime-v1',
        preview: await this.#projectPreview(record, reference),
        toolTrace: trace,
        resultAdmission: { state: 'not_submitted' },
      }
    }
    return {
      userMessage,
      assistantMessage: {
        id: record.messageId,
        role: 'assistant',
        content: result.content,
        createdAt: record.createdAt,
        referenceNodeIds: [...referenceNodeIds],
        toolTrace: trace,
        ...(plan ? { plan } : {}),
      },
      replayed: result.replayed,
    }
  }

  async runTurn(
    scope: Omit<AgentBetaV1TurnScope, 'clientMessageId'>,
    input: AgentBetaMessageInput,
    visibleNodeIds: readonly string[],
  ): Promise<AgentBetaV1TurnProjection> {
    const requestFingerprint = await digest({ schemaVersion: 1, input })
    let record = await this.dependencies.turns.get({
      userId: scope.userId,
      sessionId: scope.sessionId,
      clientMessageId: input.clientMessageId,
    })
    if (record && record.requestFingerprint !== requestFingerprint) {
      throw new AgentBetaError('同一条消息的参数冲突', 409, 'AGENT_BETA_MESSAGE_CONFLICT')
    }
    record ??= await this.#buildTurn(scope, input, visibleNodeIds)
    const frozenVisibleNodeIds = record.input.triage.nodes.map((node) => node.nodeId)
    const query = this.#query(record, frozenVisibleNodeIds)
    const governance = this.dependencies.governance({
      userId: record.userId,
      sessionId: record.sessionId,
      messageId: record.messageId,
    }, undefined, query)
    const frozenTurnTime = new Date(record.createdAt)
    const runtime = createAgentTurnRuntime({
      query,
      preparation: this.dependencies.preparation,
      governedActions: governance.actions,
      registry: this.dependencies.registry,
      model: this.dependencies.model,
      observability: this.dependencies.observability,
      telemetry: this.dependencies.observability,
      now: () => new Date(frozenTurnTime),
    })
    const result = await runtime.runTurn(record.input)
    return this.#projection(record, result, input.settings, input.referenceNodeIds)
  }

  async repreview(command: AgentBetaV1RepreviewCommand): Promise<{ prompt: string; preview: AgentBetaPreviewView }> {
    const key = preparationArtifactKey(command.userId, command.proposalId, command.previewVersion)
    const reference = await this.dependencies.artifacts.get(key)
    assertPreviewIdentity(reference, command)
    if (reference.kind !== 'generate') {
      throw new AgentBetaError('重试预览不支持修改提示词，请重新发起重试请求', 409, 'AGENT_BETA_REPREVIEW_UNSUPPORTED')
    }
    const latest = await this.dependencies.artifacts.getLatest(command.userId, command.proposalId)
    if (!latest || latest.artifact.version !== command.previewVersion || latest.requestDigest !== command.previewDigest) {
      throw new AgentBetaError('预览已有更新版本，请刷新后重试', 409, 'AGENT_BETA_PREVIEW_CONFLICT')
    }
    const prompt = command.prompt.trim()
    if (!prompt) throw new AgentBetaError('生成要求不能为空')
    const next = await this.dependencies.preparation.prepare({
      toolName: reference.artifact.toolName,
      args: { prompt },
    }, {
      userId: command.userId,
      sessionId: command.sessionId,
      messageId: command.messageId,
      proposalId: command.proposalId,
      version: command.previewVersion + 1,
      selectedAssetIds: [...reference.inputAssetIds],
      settings: previewSettings(reference.artifact),
    })
    await this.dependencies.preparation.validatePrepared(next)
    const stored = await this.dependencies.artifacts.get(preparationArtifactKey(command.userId, next.proposalId, next.version))
    if (!stored || canonicalize(stored.artifact) !== canonicalize(next)) {
      throw new AgentBetaError('新版预览未能持久化', 503, 'AGENT_BETA_PREVIEW_STORAGE_FAILED')
    }
    return { prompt, preview: await this.#projectPreview(command, stored) }
  }

  async confirm(command: AgentBetaV1ConfirmCommand): Promise<{ task: GenerationTask }> {
    const reference = await this.dependencies.artifacts.get(preparationArtifactKey(
      command.userId,
      command.proposalId,
      command.previewVersion,
    ))
    assertPreviewIdentity(reference, command)
    const latest = await this.dependencies.artifacts.getLatest(command.userId, command.proposalId)
    if (!latest || latest.artifact.version !== command.previewVersion || latest.requestDigest !== command.previewDigest) {
      throw new AgentBetaError('预览已有更新版本，请刷新后重试', 409, 'AGENT_BETA_PREVIEW_CONFLICT')
    }
    const scope = { userId: command.userId, sessionId: command.sessionId, messageId: command.messageId }
    const query = this.#query(scope)
    const governance = this.dependencies.governance(scope, undefined, query)
    const receipt = await governance.approvals.issueApproval({
      proposalId: command.proposalId,
      version: command.previewVersion,
      paramsDigest: reference.artifact.paramsDigest,
    })
    const action = { actionKind: reference.kind, payload: reference.artifact } as GovernedAction
    const result = await governance.actions.execute(action, receipt)
    if (!isPaidResult(result) || result.actionKind !== reference.kind) {
      throw new AgentBetaError('提交结果身份不一致，请人工核实', 409, 'AGENT_BETA_ACTION_VERIFICATION_REQUIRED')
    }
    return { task: result.task }
  }

  async cancel(scope: AgentBetaV1ActionScope, taskId: string): Promise<{ task: GenerationTask }> {
    const query = this.#query(scope)
    const intent: AuthenticatedUserIntent = { actionKind: 'cancel', targetId: taskId }
    const governance = this.dependencies.governance(scope, intent, query)
    const receipt = await governance.approvals.issueIntent()
    const result = await governance.actions.execute({
      actionKind: 'cancel',
      payload: { schemaVersion: 1, ...scope, taskId, intent: receipt },
    })
    if (result.actionKind !== 'cancel' || result.task.taskId !== taskId) {
      throw new AgentBetaError('取消状态无法核实，请刷新后重试', 409, 'AGENT_BETA_ACTION_VERIFICATION_REQUIRED')
    }
    return { task: result.task }
  }

  async refreshPreview(scope: AgentBetaV1ActionScope, plan: AgentBetaPlan): Promise<AgentBetaPreviewView | undefined> {
    if (plan.protocol !== 'agent-runtime-v1' || !plan.preview) return undefined
    const latest = await this.dependencies.artifacts.getLatest(scope.userId, plan.preview.proposalId)
    if (!latest) return undefined
    if (latest.artifact.userId !== scope.userId || latest.artifact.sessionId !== scope.sessionId
      || latest.artifact.messageId !== scope.messageId) {
      throw new AgentBetaError('预览身份不一致', 409, 'AGENT_BETA_PREVIEW_CONFLICT')
    }
    return this.#projectPreview(scope, latest)
  }
}

export function createAgentBetaV1Bridge(dependencies: AgentBetaV1BridgeDependencies): AgentBetaV1BridgePort {
  return new AgentBetaV1Bridge(dependencies)
}
