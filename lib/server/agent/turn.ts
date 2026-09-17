import { AGENT_BUDGET } from '@/lib/agent/budget'
import { canonicalize, digest, toJsonValue } from '@/lib/agent/contracts'
import type { GovernedAction, PreviewArtifact, UserIntentReceipt } from '@/lib/agent/contracts'
import type {
  AgentTurnBudget,
  AgentTurnResult,
  AgentTurnStopReason,
  AgentTurnToolResult,
  AgentTurnToolTraceEntry,
} from '@/lib/agent/turn-types'
import type { AgentPlanDraft, AgentRouteDecision, JsonValue } from '@/lib/agent/types'
import type { FieldOrigin, GovernedField } from '@/lib/agent/provenance'
import type { CutoutScene } from '@/lib/types'
import { bindGovernedToolAction } from './action/governed-tool-actions'
import type { BoundToolProposal, ServerBindingContext } from './action/provenance'
import { ReadToolRunner } from './action/read-tool-runner'
import type { TaskPreparationWithRetryPort } from './action/task-preparation'
import { ToolDispatcher } from './action/tool-dispatch'
import { selectToolFrontier, type ToolFrontierContext } from './action/tool-frontier'
import type { ToolRegistry } from './action/tool-registry'
import {
  AgentObservabilityError,
  recordThenInvoke,
  type AgentEventStore,
  type RecordModelRequestInput,
  type TurnCompletionRecord,
} from './observability/event-store'
import { recordAgentEvent, type AgentEventSink } from './observability/events'
import { buildContextSnapshot, type TriageInput } from './perception/context-triage'
import type { AgentModelPort, GovernedActionPort, PreparationContext, QueryPort } from './ports'
import { parseAgentPlanOutput } from './reasoning/plan-adapter'
import { routeAgentRequest, type AgentRouteInput } from './reasoning/router'
import { parseToolResultStageOutput, parseUnderstandingStageOutput } from './reasoning/stage-outputs'
import { buildStagedPrompt, type PromptStage, type StagedPromptToolResult } from './reasoning/staged-prompts'
import {
  PLAN_VALIDATOR_REGISTRY,
  validateAgentPlanDraft,
  type PlanEvidence,
  type PlanPreviewBinding,
  type PlanToolBinding,
  type PlanValidationContext,
} from './reasoning/validators'

const IDENTIFIER = /^[a-zA-Z0-9_-]+$/
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_.-]*$/
const CREATE_TOOLS = new Set([
  'fashion_photo.create',
  'photo_fission.create',
  'pose_fission.create',
  'garment_detail.create',
])
const MAX_COMPLETION_OUTCOME_BYTES = 48 * 1024
const TURN_IDENTITY_EVIDENCE_REF = 'server:turn_identity'
const TURN_IDENTITY_ASSERTION = '当前请求身份已由服务端绑定。'

type RouteFacts = Omit<AgentRouteInput, 'text' | 'selectedAssetIds'>

/** 全部字段由已认证服务端组合根构造；C13 才负责把产品协议适配到此输入。 */
export interface AgentTurnInput {
  identity: { userId: string; sessionId: string; messageId: string; turnId: string }
  text: string
  model: string
  parameters?: Record<string, JsonValue>
  triage: TriageInput
  route?: RouteFacts
  authorization: {
    allowed: boolean
    allowedToolNames: string[]
    purpose?: ToolFrontierContext['purpose']
  }
  binding: ServerBindingContext
  preparation: PreparationContext
  intents?: Partial<Record<UserIntentReceipt['actionKind'], UserIntentReceipt>>
  cutoutScene?: CutoutScene
  validation?: {
    evidence?: PlanEvidence[]
    previews?: PlanPreviewBinding[]
  }
}

export interface AgentTurnRuntimeLimits {
  /** 只能收紧 A1 共享上限；任何更大值都按共享上限执行。 */
  maxModelCalls?: number
  maxToolCalls?: number
  maxElapsedMs?: number
}

export interface AgentTurnObservabilityPort extends Pick<AgentEventStore,
  'recordModelRequest' | 'reconstructRequest' | 'recordTurnCompletion' | 'getTurnCompletion' | 'withTurnLock'> {}

export interface AgentTurnDependencies {
  query: QueryPort
  preparation: TaskPreparationWithRetryPort
  governedActions: GovernedActionPort
  registry: ToolRegistry
  model: AgentModelPort
  observability: AgentTurnObservabilityPort
  telemetry?: AgentEventSink
  limits?: AgentTurnRuntimeLimits
  now?: () => Date
  monotonicNow?: () => number
}

interface NormalizedLimits {
  maxModelCalls: number
  maxToolCalls: number
  maxElapsedMs: number
}

interface ExecutionState {
  route: AgentRouteDecision
  inputDigest: string
  startedAt: string
  startedMs: number
  limits: NormalizedLimits
  modelCalls: number
  toolAttempts: number
  toolCalls: number
  requestIds: string[]
  toolTrace: AgentTurnToolTraceEntry[]
  toolResults: AgentTurnToolResult[]
}

interface StageSuccess {
  ok: true
  value: JsonValue
}

interface StageFailure {
  ok: false
  reason: AgentTurnStopReason
}

type StageResult = StageSuccess | StageFailure

class DeadlineExceeded extends Error {}

function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalize(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.length > 160) {
    throw new TypeError(`agent-turn: invalid ${label}`)
  }
}

function assertKeys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError(`agent-turn: invalid ${label}`)
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeLimit(value: number | undefined, maximum: number, label: string): number {
  if (value === undefined) return maximum
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`agent-turn: invalid ${label}`)
  return Math.min(value, maximum)
}

function normalizeLimits(input: AgentTurnRuntimeLimits | undefined): NormalizedLimits {
  return Object.freeze({
    maxModelCalls: normalizeLimit(input?.maxModelCalls, AGENT_BUDGET.maxModelCallsPerTurn, 'maxModelCalls'),
    maxToolCalls: normalizeLimit(input?.maxToolCalls, AGENT_BUDGET.maxReadToolCallsPerTurn, 'maxToolCalls'),
    maxElapsedMs: normalizeLimit(input?.maxElapsedMs, AGENT_BUDGET.maxLatencyMsPerTurn, 'maxElapsedMs'),
  })
}

function validateTrustedInput(input: AgentTurnInput): void {
  assertKeys(input, [
    'identity', 'text', 'model', 'parameters', 'triage', 'route', 'authorization', 'binding',
    'preparation', 'intents', 'cutoutScene', 'validation',
  ], 'input')
  assertKeys(input.identity, ['userId', 'sessionId', 'messageId', 'turnId'], 'identity')
  for (const [key, value] of Object.entries(input.identity)) assertIdentifier(value, `identity.${key}`)
  if (typeof input.text !== 'string' || input.text.length > 8_000) throw new TypeError('agent-turn: invalid text')
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200) throw new TypeError('agent-turn: invalid model')
  if (input.parameters !== undefined && !isRecord(input.parameters)) throw new TypeError('agent-turn: invalid parameters')
  assertKeys(input.authorization, ['allowed', 'allowedToolNames', 'purpose'], 'authorization')
  if (typeof input.authorization.allowed !== 'boolean' || !Array.isArray(input.authorization.allowedToolNames)
    || input.authorization.allowedToolNames.length > 64
    || new Set(input.authorization.allowedToolNames).size !== input.authorization.allowedToolNames.length
    || input.authorization.allowedToolNames.some((name) => typeof name !== 'string' || !TOOL_NAME.test(name) || name.length > 100)) {
    throw new TypeError('agent-turn: invalid authorization')
  }
  if (input.authorization.purpose !== undefined
    && !['cutout', 'consult', 'general'].includes(input.authorization.purpose)) {
    throw new TypeError('agent-turn: invalid authorization purpose')
  }
  if (input.triage.userId !== input.identity.userId || input.triage.sessionId !== input.identity.sessionId) {
    throw new TypeError('agent-turn: triage identity mismatch')
  }
  if (input.binding.userId !== input.identity.userId || input.binding.sessionId !== input.identity.sessionId
    || input.binding.messageId !== input.identity.messageId) {
    throw new TypeError('agent-turn: binding identity mismatch')
  }
  if (input.preparation.userId !== input.identity.userId || input.preparation.sessionId !== input.identity.sessionId
    || input.preparation.messageId !== input.identity.messageId) {
    throw new TypeError('agent-turn: preparation identity mismatch')
  }
  assertIdentifier(input.preparation.proposalId, 'preparation.proposalId')
  if (!Number.isSafeInteger(input.preparation.version) || input.preparation.version < 1
    || !Array.isArray(input.preparation.selectedAssetIds)
    || input.preparation.selectedAssetIds.some((assetId) => typeof assetId !== 'string' || !assetId.trim())
    || new Set(input.preparation.selectedAssetIds).size !== input.preparation.selectedAssetIds.length) {
    throw new TypeError('agent-turn: invalid preparation')
  }
  const selected = input.binding.assetIds?.value
  if (selected !== undefined && (!Array.isArray(selected) || !sameStrings(selected, input.preparation.selectedAssetIds))) {
    throw new TypeError('agent-turn: selected assets mismatch')
  }
  if (input.route?.task && input.binding.taskId && input.route.task.taskId !== input.binding.taskId.value) {
    throw new TypeError('agent-turn: selected task mismatch')
  }
  if (input.intents !== undefined) {
    assertKeys(input.intents, ['classify', 'cutout_prepare', 'cancel'], 'intents')
  }
  if (input.cutoutScene !== undefined && !['garment', 'person', 'product'].includes(input.cutoutScene)) {
    throw new TypeError('agent-turn: invalid cutout scene')
  }
  if (input.validation !== undefined) {
    assertKeys(input.validation, ['evidence', 'previews'], 'validation')
    if (input.validation.evidence !== undefined && !Array.isArray(input.validation.evidence)) {
      throw new TypeError('agent-turn: invalid evidence')
    }
    if (input.validation.previews !== undefined && !Array.isArray(input.validation.previews)) {
      throw new TypeError('agent-turn: invalid previews')
    }
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

function routeStage(route: AgentRouteDecision): ToolFrontierContext['stage'] {
  if (route.intent === 'retry') return 'finish'
  if (route.risk === 'write_reversible' && route.costClass === 'free_text') return 'waiting'
  return 'plan'
}

function narrowedAllowedTools(
  input: AgentTurnInput,
  route: AgentRouteDecision,
  registry: ToolRegistry,
): string[] {
  const featureType = input.route?.featureType
  return input.authorization.allowedToolNames.filter((name) => {
    if (!CREATE_TOOLS.has(name) || !featureType || !route.costClass.startsWith('paid_')) return true
    return registry.get(name)?.featureType === featureType
  })
}

type InputWithRegistryFeatures = AgentTurnInput

function frontierFor(
  registry: ToolRegistry,
  input: InputWithRegistryFeatures,
  route: AgentRouteDecision,
): readonly ReturnType<ToolRegistry['list']>[number][] {
  const allowedToolNames = narrowedAllowedTools(input, route, registry)
  return selectToolFrontier(registry, {
    allowed: input.authorization.allowed,
    allowedToolNames,
    purpose: input.authorization.purpose,
    stage: routeStage(route),
    route,
  })
}

function bindingWithSelectedAssets(input: AgentTurnInput): ServerBindingContext {
  if (input.binding.assetIds !== undefined) return input.binding
  return {
    ...input.binding,
    assetIds: { value: [...input.preparation.selectedAssetIds], origin: 'system_policy' },
  }
}

function validationControls(input: AgentTurnInput, binding: ServerBindingContext): PlanValidationContext['controls'] {
  const controls: Partial<Record<GovernedField, { value: JsonValue; origin: FieldOrigin }>> = {
    userId: { value: input.identity.userId, origin: 'system_policy' },
    idempotencyKey: { value: binding.idempotencyKey, origin: 'system_policy' },
  }
  if (input.route?.featureType) controls.featureType = { value: input.route.featureType, origin: 'system_policy' }
  if (binding.assetIds) controls.assetIds = { value: [...binding.assetIds.value], origin: binding.assetIds.origin }
  if (binding.taskId) controls.taskId = { value: binding.taskId.value, origin: binding.taskId.origin }
  if (binding.shotIds) controls.shotIds = { value: [...binding.shotIds.value], origin: binding.shotIds.origin }
  if (binding.generation?.model) controls.model = { value: binding.generation.model.value, origin: binding.generation.model.origin }
  if (binding.generation?.imageRatio) controls.imageRatio = { value: binding.generation.imageRatio.value, origin: binding.generation.imageRatio.origin }
  if (binding.generation?.resolution) controls.resolution = { value: binding.generation.resolution.value, origin: binding.generation.resolution.origin }
  if (binding.generation?.resultCount) controls.resultCount = { value: binding.generation.resultCount.value, origin: binding.generation.resultCount.origin }
  return controls
}

function toolBindings(
  calls: Array<{ tool: string }>,
  binding: ServerBindingContext,
): PlanToolBinding[] {
  const output: PlanToolBinding[] = []
  calls.forEach((call, callIndex) => {
    if (call.tool === 'asset.inspect' || call.tool === 'garment.classify') {
      if (binding.assetIds?.value.length === 1) output.push({
        callIndex,
        args: { assetId: binding.assetIds.value[0] },
        origins: { assetId: binding.assetIds.origin },
      })
    } else if (call.tool === 'task.get_status' && binding.taskId) {
      output.push({
        callIndex,
        args: { taskId: binding.taskId.value },
        origins: { taskId: binding.taskId.origin },
      })
    }
  })
  return output
}

function planEvidence(input: AgentTurnInput, state: ExecutionState): PlanEvidence[] {
  const started = Date.parse(state.startedAt)
  return [{
    ref: TURN_IDENTITY_EVIDENCE_REF,
    userId: input.identity.userId,
    sessionId: input.identity.sessionId,
    assertion: TURN_IDENTITY_ASSERTION,
    claimKind: 'derive',
    kind: 'fact',
    origin: 'system_policy',
    observedAt: state.startedAt,
    expiresAt: new Date(started + Math.max(state.limits.maxElapsedMs, 1) + 1_000).toISOString(),
  }, ...(input.validation?.evidence ?? [])]
}

function planWithServerIdentityClaim(plan: AgentPlanDraft): AgentPlanDraft {
  if (plan.kind !== 'plan' || plan.claims.length || !plan.proposedToolCalls.length) return plan
  return {
    ...plan,
    claims: [{
      id: 'server_turn_identity',
      kind: 'derive',
      claim: TURN_IDENTITY_ASSERTION,
      dependsOn: [],
      evidenceRefs: [TURN_IDENTITY_EVIDENCE_REF],
      validator: 'evidence.matches',
      status: 'draft',
    }],
  }
}

function evidenceAssertions(evidence: readonly PlanEvidence[]) {
  return evidence.filter((item) => item.kind !== 'handle').map((item) => ({
    ref: item.ref,
    assertion: item.assertion,
    claimKind: item.claimKind,
    validator: item.kind === 'control' ? 'control.matches'
      : item.kind === 'preview' ? 'preview.integrity' : 'evidence.matches',
  }))
}

function modelProposal(call: { tool: string; args: unknown }): { toolName: string; prompt?: string } {
  const args = isRecord(call.args) ? call.args : {}
  return typeof args.prompt === 'string' ? { toolName: call.tool, prompt: args.prompt } : { toolName: call.tool }
}

function generationSettings(settings: JsonValue, proposal: Extract<BoundToolProposal, { kind: 'generation' }>): JsonValue {
  if (!isRecord(settings)) throw new TypeError('agent-turn: generation settings must be an object')
  const output: Record<string, JsonValue> = cloneCanonical(settings) as Record<string, JsonValue>
  const controls = {
    model: proposal.model,
    imageRatio: proposal.imageRatio,
    resolution: proposal.resolution,
    resultCount: proposal.resultCount,
  }
  const controlledKeys: ReadonlyArray<keyof typeof controls> = proposal.featureType === 'garment-detail'
    ? ['imageRatio', 'resolution']
    : proposal.featureType === 'pose-fission'
      ? ['model', 'imageRatio', 'resolution']
      : ['model', 'imageRatio', 'resolution', 'resultCount']
  for (const key of controlledKeys) {
    const value = controls[key]
    if (Object.hasOwn(output, key) && canonicalize(output[key]) !== canonicalize(value)) {
      throw new TypeError(`agent-turn: preparation ${key} mismatch`)
    }
    output[key] = value
  }
  return output
}

function assertPreparedGenerationBinding(
  preview: PreviewArtifact,
  proposal: Extract<BoundToolProposal, { kind: 'generation' }>,
  routeModel: string | null | undefined,
): void {
  if (preview.toolName !== proposal.toolName
    || preview.featureType !== proposal.featureType
    || preview.resolvedModelId !== proposal.model
    || preview.estimatedResultCount !== proposal.resultCount
    || (routeModel !== undefined && routeModel !== null && routeModel !== proposal.model)) {
    throw new TypeError('agent-turn: prepared generation controls mismatch')
  }
}

function exactDataRecord(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(input) || Reflect.ownKeys(input).some((key) => typeof key !== 'string')) {
    throw new TypeError('agent-turn: invalid governed result')
  }
  const keys = Object.keys(input)
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) {
    throw new TypeError('agent-turn: invalid governed result')
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('agent-turn: invalid governed result')
    }
  }
  return input
}

function dataValue(input: unknown, key: string): unknown {
  if (!isRecord(input)) throw new TypeError('agent-turn: invalid governed result')
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError('agent-turn: invalid governed result')
  }
  return descriptor.value
}

function projectGovernedResult(action: GovernedAction, rawResult: unknown): JsonValue {
  const result = exactDataRecord(rawResult, action.actionKind === 'cancel'
    ? ['actionKind', 'task', 'intent'] : ['actionKind', 'result'])
  if (dataValue(result, 'actionKind') !== action.actionKind) {
    throw new TypeError('agent-turn: governed action kind mismatch')
  }
  if (action.actionKind === 'classify') {
    const classified = exactDataRecord(dataValue(result, 'result'), ['status', 'assetId', 'category', 'confidence'])
    const status = dataValue(classified, 'status')
    const assetId = dataValue(classified, 'assetId')
    const category = dataValue(classified, 'category')
    const confidence = dataValue(classified, 'confidence')
    const categories = ['tops', 'bottoms', 'dress', 'accessory', 'shoes-bags']
    if (!['classified', 'fallback'].includes(String(status)) || assetId !== action.payload.assetId
      || (category !== null && !categories.includes(String(category)))
      || (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence)
        || confidence < 0 || confidence > 1))
      || (status === 'classified' && (category === null || confidence === null))
      || (status === 'fallback' && (category !== null || confidence !== null))) {
      throw new TypeError('agent-turn: classification result mismatch')
    }
    return { actionKind: 'classify', status: status as string, assetId, category: category as string | null, confidence }
  }
  if (action.actionKind === 'cutout_prepare') {
    const cutout = exactDataRecord(dataValue(result, 'result'), ['cutoutSessionId', 'preparedImageUrl'])
    const cutoutSessionId = dataValue(cutout, 'cutoutSessionId')
    const preparedImageUrl = dataValue(cutout, 'preparedImageUrl')
    if (typeof cutoutSessionId !== 'string' || !IDENTIFIER.test(cutoutSessionId)
      || typeof preparedImageUrl !== 'string'
      || !/^\/api\/cutout-sessions\/[^/?#]+\/image$/.test(preparedImageUrl)
      || preparedImageUrl.split('/')[3] !== encodeURIComponent(cutoutSessionId)) {
      throw new TypeError('agent-turn: cutout result mismatch')
    }
    return { actionKind: 'cutout_prepare', cutoutSessionId, preparedImageUrl }
  }
  if (action.actionKind === 'cancel') {
    const task = dataValue(result, 'task')
    const returnedIntent = dataValue(result, 'intent')
    const taskId = dataValue(task, 'taskId')
    const userId = dataValue(task, 'userId')
    const taskStatus = dataValue(task, 'status')
    const progress = dataValue(task, 'progress')
    if (taskId !== action.payload.taskId || userId !== action.payload.userId
      || !['pending', 'running', 'success', 'failed', 'partial', 'cancelled'].includes(String(taskStatus))
      || typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 100
      || canonicalize(returnedIntent) !== canonicalize(action.payload.intent)) {
      throw new TypeError('agent-turn: cancel result mismatch')
    }
    return { actionKind: 'cancel', taskId, taskStatus: taskStatus as string, progress }
  }
  throw new TypeError('agent-turn: paid action result is forbidden in the model loop')
}

function safeResultSummary(results: readonly AgentTurnToolResult[]): string {
  for (const entry of results) {
    if (entry.toolName !== 'task.get_status' || !isRecord(entry.result)) continue
    const task = entry.result.task
    if (isRecord(task) && typeof task.status === 'string') {
      return `当前任务状态为 ${task.status}；图片结果只有在完成安全检查后才会显示。`
    }
  }
  if (results.some((entry) => entry.toolName === 'cutout.prepare')) {
    return '抠图素材已准备好，可以继续编辑；本轮没有创建生图任务。'
  }
  if (results.some((entry) => entry.toolName === 'task.cancel')) {
    return '取消请求已处理；当前显示的状态以任务记录为准。'
  }
  if (results.some((entry) => entry.toolName === 'garment.classify')) {
    return '服装分类已完成；如需继续操作，仍会单独检查当前素材和权限。'
  }
  return `已完成 ${results.length} 项信息检查；本轮没有创建付费生图任务。`
}

function trustedTaskSummary(input: AgentTurnInput): string | undefined {
  const task = input.route?.task
  if (task) return `当前任务状态为 ${task.status}；图片结果只有在完成安全检查后才会显示。`
  const state = input.triage.taskStatus.status.trim().toLowerCase()
  if (['pending', 'running', 'success', 'succeeded', 'partial', 'failed', 'cancelled',
    'submitted', 'starting', 'unknown', 'verifying'].includes(state)) {
    return `当前任务状态为 ${input.triage.taskStatus.status}；图片结果只有在完成安全检查后才会显示。`
  }
  return undefined
}

function admittedModelContent(
  input: AgentTurnInput,
  route: AgentRouteDecision,
  candidate: string,
  actionFallback: string,
): string {
  const taskSummary = trustedTaskSummary(input)
  if (taskSummary) return taskSummary
  if (route.costClass === 'paid_generation' || route.costClass === 'paid_regeneration'
    || route.risk === 'write_reversible') return actionFallback
  return candidate
}

function statusFor(reason: AgentTurnStopReason): AgentTurnResult['status'] {
  if (reason === 'completed') return 'completed'
  if (reason === 'awaiting_approval') return 'awaiting_approval'
  if (reason === 'action_verification_required') return 'verification_required'
  return 'stopped'
}

function parseReplay(record: TurnCompletionRecord, input: AgentTurnInput, inputDigest: string): AgentTurnResult {
  if (record.inputDigest !== inputDigest || !isRecord(record.outcome)) {
    throw new AgentObservabilityError('RECORD_CONFLICT')
  }
  const result = cloneCanonical(record.outcome) as unknown as AgentTurnResult
  if (result.schemaVersion !== 1 || result.userId !== input.identity.userId
    || result.sessionId !== input.identity.sessionId || result.messageId !== input.identity.messageId
    || result.turnId !== input.identity.turnId || result.stopReason !== record.stopReason
    || !Array.isArray(result.requestIds) || !sameStrings(result.requestIds, record.requestIds)) {
    throw new AgentObservabilityError('INTEGRITY_MISMATCH')
  }
  return freezeDeep({ ...result, replayed: true })
}

export class AgentTurnRuntime {
  readonly #dependencies: AgentTurnDependencies
  readonly #limits: NormalizedLimits
  readonly #pending = new Map<string, { inputDigest: string; promise: Promise<AgentTurnResult> }>()

  constructor(dependencies: AgentTurnDependencies) {
    this.#dependencies = dependencies
    this.#limits = normalizeLimits(dependencies.limits)
  }

  #clock(): number {
    const value = (this.#dependencies.monotonicNow ?? Date.now)()
    if (!Number.isFinite(value) || value < 0) throw new TypeError('agent-turn: invalid monotonic clock')
    return value
  }

  #date(): Date {
    const value = (this.#dependencies.now ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('agent-turn: invalid clock')
    return value
  }

  async #emit(input: AgentTurnInput, name: Parameters<typeof recordAgentEvent>[1]['name'], data: JsonValue): Promise<void> {
    if (!this.#dependencies.telemetry) return
    await recordAgentEvent(this.#dependencies.telemetry, {
      userId: input.identity.userId,
      sessionId: input.identity.sessionId,
      turnId: input.identity.turnId,
      name,
      data,
    })
  }

  #elapsed(state: ExecutionState): number {
    return Math.max(0, Math.floor(this.#clock() - state.startedMs))
  }

  async #withinDeadline<T>(state: ExecutionState, operation: () => Promise<T>): Promise<T> {
    const remaining = state.limits.maxElapsedMs - this.#elapsed(state)
    if (remaining <= 0) throw new DeadlineExceeded()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new DeadlineExceeded()), Math.min(remaining, 2_147_483_647))
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async #finish(
    input: AgentTurnInput,
    state: ExecutionState,
    reason: AgentTurnStopReason,
    details: { content: string; blockers?: string[]; questions?: string[]; preview?: AgentTurnResult['preview'] },
  ): Promise<AgentTurnResult> {
    const budget: AgentTurnBudget = {
      limits: {
        maxModelCalls: state.limits.maxModelCalls,
        maxToolCalls: state.limits.maxToolCalls,
        maxElapsedMs: state.limits.maxElapsedMs,
      },
      usage: {
        modelCalls: state.modelCalls,
        toolAttempts: state.toolAttempts,
        toolCalls: state.toolCalls,
        elapsedMs: this.#elapsed(state),
      },
    }
    const buildResult = (
      finalReason: AgentTurnStopReason,
      finalDetails: typeof details,
      includeDynamicPayload: boolean,
    ): AgentTurnResult => freezeDeep({
      schemaVersion: 1 as const,
      ...input.identity,
      status: statusFor(finalReason),
      stopReason: finalReason,
      route: cloneCanonical(state.route),
      content: finalDetails.content,
      blockers: [...(finalDetails.blockers ?? [])],
      questions: [...(finalDetails.questions ?? [])],
      ...(includeDynamicPayload && finalDetails.preview ? { preview: cloneCanonical(finalDetails.preview) } : {}),
      toolResults: includeDynamicPayload ? cloneCanonical(state.toolResults) : [],
      toolTrace: cloneCanonical(state.toolTrace),
      requestIds: [...state.requestIds],
      budget,
      replayed: false,
    })
    const fallbackDetails = {
      content: '模型或工具输出超过安全完成记录边界，已停止且未据此授予任何权限。',
      blockers: ['completion_payload_rejected'],
      questions: [],
    }
    let finalReason = reason
    let result = buildResult(finalReason, details, true)
    let outcome: JsonValue
    try {
      outcome = toJsonValue(result)
      if (new TextEncoder().encode(canonicalize(outcome)).byteLength > MAX_COMPLETION_OUTCOME_BYTES) {
        finalReason = 'model_output_invalid'
        result = buildResult(finalReason, fallbackDetails, false)
        outcome = toJsonValue(result)
      }
    } catch {
      finalReason = 'model_output_invalid'
      result = buildResult(finalReason, fallbackDetails, false)
      outcome = toJsonValue(result)
    }
    const started = Date.parse(state.startedAt)
    const completed = this.#date()
    const completedAt = new Date(Math.max(started, completed.getTime())).toISOString()
    const completionInput = () => ({
      userId: input.identity.userId,
      sessionId: input.identity.sessionId,
      turnId: input.identity.turnId,
      inputDigest: state.inputDigest,
      route: cloneCanonical(state.route) as unknown as Record<string, JsonValue>,
      budgetUsage: {
        maxModelCalls: budget.limits.maxModelCalls,
        maxToolCalls: budget.limits.maxToolCalls,
        maxElapsedMs: budget.limits.maxElapsedMs,
        modelCalls: budget.usage.modelCalls,
        toolAttempts: budget.usage.toolAttempts,
        toolCalls: budget.usage.toolCalls,
        elapsedMs: budget.usage.elapsedMs,
      },
      toolTrace: cloneCanonical(state.toolTrace) as unknown as Record<string, JsonValue>[],
      stopReason: finalReason,
      requestIds: [...state.requestIds],
      outcome,
      startedAt: state.startedAt,
      completedAt,
    })
    try {
      await this.#dependencies.observability.recordTurnCompletion(completionInput())
    } catch (error) {
      if (!(error instanceof AgentObservabilityError) || error.code !== 'INVALID_RECORD'
        || finalReason === 'model_output_invalid') throw error
      finalReason = 'model_output_invalid'
      result = buildResult(finalReason, fallbackDetails, false)
      outcome = toJsonValue(result)
      await this.#dependencies.observability.recordTurnCompletion(completionInput())
    }
    await this.#emit(input, 'stop.reason', { reason: finalReason, modelCalls: state.modelCalls, toolCalls: state.toolCalls })
    await this.#emit(input, 'turn.finished', { reason: finalReason, status: result.status })
    return result
  }

  async #invokeStage(
    input: AgentTurnInput,
    snapshot: ReturnType<typeof buildContextSnapshot>,
    state: ExecutionState,
    stage: PromptStage,
    frontier: readonly ReturnType<ToolRegistry['list']>[number][],
  ): Promise<StageResult> {
    if (state.modelCalls >= state.limits.maxModelCalls) return { ok: false, reason: 'model_budget_exceeded' }
    if (this.#elapsed(state) >= state.limits.maxElapsedMs) return { ok: false, reason: 'elapsed_time_exceeded' }
    let prompt: ReturnType<typeof buildStagedPrompt>
    try {
      prompt = buildStagedPrompt({
        stage,
        snapshot,
        model: input.model,
        ...(input.parameters === undefined ? {} : { parameters: input.parameters }),
        availableTools: frontier.map((tool) => ({ name: tool.name, description: tool.description })),
        availableValidators: Object.keys(PLAN_VALIDATOR_REGISTRY),
        evidenceAssertions: evidenceAssertions(planEvidence(input, state)),
        route: state.route,
        toolResults: state.toolResults as StagedPromptToolResult[],
      })
    } catch {
      return { ok: false, reason: stage === 'planning' ? 'plan_validation_failed' : 'model_output_invalid' }
    }
    const requestId = `request_${String(state.requestIds.length + 1).padStart(2, '0')}_${stage}`
    let invoked = false
    const requestRecord: RecordModelRequestInput = {
      ...input.identity,
      requestId,
      request: prompt.request,
      promptVersion: prompt.promptVersion,
      route: toJsonValue(state.route),
      toolTrace: toJsonValue(state.toolTrace) as JsonValue[],
      createdAt: this.#date().toISOString(),
    }
    try {
      const value = await recordThenInvoke(this.#dependencies.observability, requestRecord, async (request) => {
        invoked = true
        state.requestIds.push(requestId)
        state.modelCalls += 1
        return this.#withinDeadline(state, () => this.#dependencies.model.invoke(request))
      })
      return { ok: true, value: toJsonValue(value) }
    } catch (error) {
      if (error instanceof DeadlineExceeded) return { ok: false, reason: 'elapsed_time_exceeded' }
      return { ok: false, reason: invoked ? 'model_unavailable' : 'model_request_record_failed' }
    }
  }

  async #execute(input: InputWithRegistryFeatures, inputDigest: string): Promise<AgentTurnResult> {
    const startedAt = this.#date().toISOString()
    const startedMs = this.#clock()
    const selectedAssetIds = [...(input.binding.assetIds?.value ?? input.preparation.selectedAssetIds)]
    const route = routeAgentRequest({
      text: input.text,
      selectedAssetIds,
      featureType: input.route?.featureType,
      resolvedModelId: input.route?.resolvedModelId,
      task: input.route?.task,
      evidenceState: input.route?.evidenceState,
      hasPlan: input.route?.hasPlan,
    })
    const limits: NormalizedLimits = Object.freeze({
      maxModelCalls: Math.min(this.#limits.maxModelCalls, route.budget.maxModelCalls, AGENT_BUDGET.maxModelCallsPerTurn),
      maxToolCalls: Math.min(this.#limits.maxToolCalls, route.budget.maxToolCalls, AGENT_BUDGET.maxReadToolCallsPerTurn),
      maxElapsedMs: Math.min(this.#limits.maxElapsedMs, route.budget.maxLatencyMs, AGENT_BUDGET.maxLatencyMsPerTurn),
    })
    const state: ExecutionState = {
      route,
      inputDigest,
      startedAt,
      startedMs,
      limits,
      modelCalls: 0,
      toolAttempts: 0,
      toolCalls: 0,
      requestIds: [],
      toolTrace: [],
      toolResults: [],
    }
    await this.#emit(input, 'turn.started', { routerVersion: route.routerVersion })
    await this.#emit(input, 'route.decided', {
      lane: route.lane,
      intent: route.intent,
      evidenceState: route.evidenceState,
      maxModelCalls: limits.maxModelCalls,
      maxToolCalls: limits.maxToolCalls,
    })
    if (!input.authorization.allowed) return this.#finish(input, state, 'permission_denied', {
      content: '当前账号或会话无权处理这项请求。',
      blockers: ['agent_not_allowed'],
    })
    if (route.lane === 'clarify_human_review') return this.#finish(input, state, 'clarification_required', {
      content: '当前请求缺少必要信息，或相关状态仍待核实，暂时无法继续。',
      blockers: route.blockers,
      questions: ['请补充缺失信息或等待当前状态核实后再继续。'],
    })
    if (limits.maxElapsedMs === 0) return this.#finish(input, state, 'elapsed_time_exceeded', {
      content: '本次处理时间已用完，未执行任何操作。',
    })

    const snapshot = buildContextSnapshot(input.triage)
    const binding = bindingWithSelectedAssets(input)
    const dispatcher = new ToolDispatcher({
      registry: this.#dependencies.registry,
      scope: input.identity,
      maxToolCalls: limits.maxToolCalls,
    })
    const runner = new ReadToolRunner({ query: this.#dependencies.query, registry: this.#dependencies.registry, now: () => this.#date() })

    const useUnderstanding = route.lane === 'direct_answer' || route.reasoningMode !== 'direct'
    if (useUnderstanding) {
      const called = await this.#invokeStage(input, snapshot, state, 'understanding', [])
      if (!called.ok) return this.#finish(input, state, called.reason, {
        content: '理解阶段未能安全完成，未执行任何工具。',
      })
      let understanding: ReturnType<typeof parseUnderstandingStageOutput>
      try { understanding = parseUnderstandingStageOutput(called.value) } catch {
        return this.#finish(input, state, 'model_output_invalid', { content: '理解阶段返回格式无效，未执行任何工具。' })
      }
      if (understanding.questions.length) return this.#finish(input, state, 'clarification_required', {
        content: admittedModelContent(input, route, understanding.content, '仍需补充必要信息；本轮未执行任何动作。'),
        questions: understanding.questions,
        blockers: understanding.uncertainties,
      })
      if (route.lane === 'direct_answer') return this.#finish(input, state, 'completed', {
        content: admittedModelContent(input, route, understanding.content, '本轮没有执行或发布任何动作结果。'),
        blockers: understanding.uncertainties,
      })
    }

    while (true) {
      const planningFrontier = frontierFor(this.#dependencies.registry, input, route)
      const called = await this.#invokeStage(input, snapshot, state, 'planning', planningFrontier)
      if (!called.ok) return this.#finish(input, state, called.reason, {
        content: called.reason === 'model_budget_exceeded'
          ? '模型调用预算已耗尽，未继续规划或执行工具。'
          : '规划阶段未能安全完成，未执行新的工具。',
      })
      const parsed = parseAgentPlanOutput(called.value, { format: 'structured_v1' })
      if (!parsed.ok) return this.#finish(input, state, 'model_output_invalid', {
        content: '规划阶段返回格式无效，未执行任何工具。',
        blockers: [parsed.error],
      })
      const evidence = planEvidence(input, state)
      const validationDraft = planWithServerIdentityClaim(parsed.plan)
      let validation: Awaited<ReturnType<typeof validateAgentPlanDraft>>
      try {
        validation = await validateAgentPlanDraft(validationDraft, {
          userId: input.identity.userId,
          sessionId: input.identity.sessionId,
          messageId: input.identity.messageId,
          now: this.#date().toISOString(),
          evidence,
          assets: input.triage.nodes.map((node) => ({ assetId: node.assetId, assetDigest: node.assetDigest })),
          controls: validationControls(input, binding),
          tools: this.#dependencies.registry.list(),
          toolBindings: toolBindings(validationDraft.proposedToolCalls, binding),
          previews: input.validation?.previews ?? [],
        })
      } catch {
        return this.#finish(input, state, 'plan_validation_failed', {
          content: '当前方案无法完成安全检查，未执行任何操作。',
        })
      }
      await this.#emit(input, 'plan.proposed', {
        status: validation.status,
        issueCodes: validation.issues.map((issue) => issue.code),
      })
      if (validation.status === 'failed') {
        const hallucinated = validation.issues.some((issue) => issue.code === 'unknown_tool')
        return this.#finish(input, state, hallucinated ? 'tool_hallucination' : 'plan_validation_failed', {
          content: '当前方案未通过安全检查，未执行任何操作。',
          blockers: validation.plan.blockers,
        })
      }
      if (validation.plan.kind === 'clarify') return this.#finish(input, state, 'clarification_required', {
        content: admittedModelContent(input, route, validation.plan.content, '规划仍需补充必要信息；本轮未执行任何动作。'),
        blockers: validation.plan.blockers,
        questions: [admittedModelContent(input, route, validation.plan.content, '规划仍需补充必要信息；本轮未执行任何动作。')],
      })
      if (validation.status !== 'passed') return this.#finish(input, state, 'plan_needs_review', {
        content: '当前方案还缺少可核实的信息，已暂停，请补充后继续。',
        blockers: validation.plan.blockers,
      })
      if (!validation.plan.proposedToolCalls.length) return this.#finish(input, state, 'completed', {
        content: '方案检查已完成；本轮没有执行操作或创建付费任务。',
      })

      const resultsBefore = state.toolResults.length
      for (const call of validation.plan.proposedToolCalls) {
        if (this.#elapsed(state) >= limits.maxElapsedMs) return this.#finish(input, state, 'elapsed_time_exceeded', {
          content: '本轮时间预算已耗尽，未继续工具步骤。',
        })
        state.toolAttempts += 1
        const callId = `call_${String(state.toolAttempts).padStart(2, '0')}`
        const frontier = frontierFor(this.#dependencies.registry, input, route)
        const dispatched = dispatcher.dispatch({
          proposal: modelProposal(call),
          context: binding,
          frontier,
        })
        if (dispatched.status === 'rejected') {
          const reason: AgentTurnStopReason = dispatched.reason === 'turn_budget_exceeded' ? 'tool_budget_exceeded'
            : dispatched.reason
          state.toolTrace.push({ step: state.toolAttempts, callId, toolName: call.tool, status: 'rejected', reason })
          await this.#emit(input, 'tool.rejected', { callId, toolName: call.tool, reason })
          return this.#finish(input, state, reason, {
            content: '这项操作不在当前可执行范围内，或已达到本轮使用上限。',
            blockers: [dispatched.reason],
          })
        }
        state.toolCalls += 1
        const target = dispatched.target
        await this.#emit(input, 'tool.admitted', { callId, toolName: call.tool, target })
        if (dispatched.status === 'awaiting_approval') {
          try {
            // C4 会持久化不可变工件且没有可确认的取消协议；一旦开始就等待其真实结果，绝不后台竞跑假失败。
            const preview = dispatched.proposal.toolName === 'task.retry_shots'
              ? await (async () => {
                  if (!dispatched.proposal.taskId || !dispatched.proposal.shotIds?.length) {
                    throw new TypeError('missing retry binding')
                  }
                  const prepared = await this.#dependencies.preparation.prepareRetry({
                    taskId: dispatched.proposal.taskId,
                    shotIds: dispatched.proposal.shotIds,
                  }, { ...input.preparation, selectedAssetIds: [], settings: {} })
                  await this.#dependencies.preparation.validateRetry(prepared)
                  return prepared
                })()
              : await (async () => {
                  if (dispatched.proposal.kind !== 'generation' || !dispatched.proposal.prompt) {
                    throw new TypeError('missing generation binding')
                  }
                  const prepared = await this.#dependencies.preparation.prepare({
                    toolName: dispatched.proposal.toolName,
                    args: { prompt: dispatched.proposal.prompt },
                  }, {
                    ...input.preparation,
                    selectedAssetIds: [...dispatched.proposal.assetIds],
                    settings: generationSettings(input.preparation.settings, dispatched.proposal),
                  })
                  await this.#dependencies.preparation.validatePrepared(prepared)
                  assertPreparedGenerationBinding(prepared, dispatched.proposal, input.route?.resolvedModelId)
                  return prepared
                })()
            state.toolTrace.push({
              step: state.toolAttempts,
              callId,
              toolName: call.tool,
              status: 'awaiting_approval',
              target: 'preview',
              reason: 'awaiting_approval',
            })
            return this.#finish(input, state, 'awaiting_approval', {
              content: '方案预览已准备好；尚未批准、未提交任务、未请求任何生成图片。',
              blockers: [...preview.blockers],
              preview,
            })
          } catch {
            state.toolTrace.push({
              step: state.toolAttempts,
              callId,
              toolName: call.tool,
              status: 'rejected',
              target: 'preview',
              reason: 'tool_execution_failed',
            })
            return this.#finish(input, state, 'tool_execution_failed', {
              content: '方案预览准备失败；未提交任务，也未请求付费生成。',
            })
          }
        }
        if (target === 'read_only') {
          try {
            const raw = await this.#withinDeadline(state, () => runner.runAdmitted(dispatched, {
              userId: input.identity.userId,
              sessionId: input.identity.sessionId,
              messageId: input.identity.messageId,
            }))
            const result = toJsonValue(raw)
            state.toolResults.push({ callId, toolName: call.tool, result })
            state.toolTrace.push({ step: state.toolAttempts, callId, toolName: call.tool, status: 'completed', target })
          } catch (error) {
            const reason: AgentTurnStopReason = error instanceof DeadlineExceeded
              ? 'elapsed_time_exceeded' : 'tool_execution_failed'
            state.toolTrace.push({ step: state.toolAttempts, callId, toolName: call.tool, status: 'rejected', target, reason })
            return this.#finish(input, state, reason, { content: '只读工具未能安全完成，未继续后续步骤。' })
          }
          continue
        }
        const intentKind = call.tool === 'garment.classify' ? 'classify'
          : call.tool === 'cutout.prepare' ? 'cutout_prepare' : call.tool === 'task.cancel' ? 'cancel' : undefined
        const intent = intentKind ? input.intents?.[intentKind] : undefined
        if (!intent) {
          state.toolTrace.push({
            step: state.toolAttempts,
            callId,
            toolName: call.tool,
            status: 'rejected',
            target: 'gateway',
            reason: 'trusted_intent_missing',
          })
          return this.#finish(input, state, 'trusted_intent_missing', {
            content: '当前请求缺少执行这项操作所需的有效确认，未发起处理。',
          })
        }
        let action: Awaited<ReturnType<typeof bindGovernedToolAction>>
        try {
          action = await this.#withinDeadline(state, () => bindGovernedToolAction(
            dispatched.proposal,
            {
              userId: input.identity.userId,
              sessionId: input.identity.sessionId,
              messageId: input.identity.messageId,
            },
            intent,
            this.#dependencies.query,
            call.tool === 'cutout.prepare' ? input.cutoutScene : undefined,
          ))
        } catch (error) {
          const reason: AgentTurnStopReason = error instanceof DeadlineExceeded
            ? 'elapsed_time_exceeded' : 'tool_execution_failed'
          state.toolTrace.push({ step: state.toolAttempts, callId, toolName: call.tool, status: 'rejected', target: 'gateway', reason })
          return this.#finish(input, state, reason, {
            content: '当前素材或任务状态无法核实，未发起处理。',
          })
        }
        try {
          const governed = await this.#withinDeadline(state, () => this.#dependencies.governedActions.execute(action))
          const result = projectGovernedResult(action, governed)
          state.toolResults.push({ callId, toolName: call.tool, result })
          state.toolTrace.push({ step: state.toolAttempts, callId, toolName: call.tool, status: 'completed', target: 'gateway' })
        } catch {
          state.toolTrace.push({
            step: state.toolAttempts,
            callId,
            toolName: call.tool,
            status: 'verification_required',
            target: 'gateway',
            reason: 'action_verification_required',
          })
          return this.#finish(input, state, 'action_verification_required', {
            content: '暂时无法确认本次操作状态。为避免重复处理，本轮不会再次提交，请稍后查看任务记录。',
            blockers: ['governed_action_state_unknown'],
          })
        }
      }

      if (state.toolResults.length === resultsBefore) return this.#finish(input, state, 'completed', {
        content: '本轮检查已完成，但没有可安全展示的新结果。',
      })
      if (state.modelCalls >= limits.maxModelCalls) return this.#finish(input, state, 'completed', {
        content: safeResultSummary(state.toolResults),
      })
      const summarized = await this.#invokeStage(input, snapshot, state, 'tool_result', [])
      if (!summarized.ok) return this.#finish(input, state, summarized.reason, {
        content: safeResultSummary(state.toolResults),
      })
      let output: ReturnType<typeof parseToolResultStageOutput>
      try { output = parseToolResultStageOutput(summarized.value) } catch {
        return this.#finish(input, state, 'model_output_invalid', {
          content: safeResultSummary(state.toolResults),
        })
      }
      if (output.next === 'clarify') return this.#finish(input, state, 'clarification_required', {
        content: admittedModelContent(input, route, output.content, '仍需补充必要信息；本轮未执行新的动作。'),
        blockers: [...output.blockers, ...output.uncertainties],
        questions: [admittedModelContent(input, route, output.content, '仍需补充必要信息；本轮未执行新的动作。')],
      })
      if (output.next === 'wait') return this.#finish(input, state, 'waiting_for_task', {
        content: safeResultSummary(state.toolResults),
        blockers: [...output.blockers, ...output.uncertainties],
      })
      if (output.next === 'plan') {
        if (state.modelCalls >= limits.maxModelCalls) return this.#finish(input, state, 'model_budget_exceeded', {
          content: safeResultSummary(state.toolResults),
          blockers: output.blockers,
        })
        continue
      }
      return this.#finish(input, state, 'completed', {
        content: state.toolResults.some((entry) => entry.toolName === 'task.get_status')
          ? safeResultSummary(state.toolResults)
          : admittedModelContent(input, route, output.content, safeResultSummary(state.toolResults)),
        blockers: [...output.blockers, ...output.uncertainties],
      })
    }
  }

  async runTurn(rawInput: AgentTurnInput): Promise<AgentTurnResult> {
    const input = cloneCanonical(rawInput) as InputWithRegistryFeatures
    validateTrustedInput(input)
    const inputDigest = await digest({ schemaVersion: 1, input })
    const key = `${input.identity.userId}:${input.identity.sessionId}:${input.identity.turnId}`
    const current = this.#pending.get(key)
    if (current) {
      if (current.inputDigest !== inputDigest) throw new AgentObservabilityError('RECORD_CONFLICT')
      return current.promise
    }
    const scope = {
      userId: input.identity.userId,
      sessionId: input.identity.sessionId,
      turnId: input.identity.turnId,
    }
    const promise = this.#dependencies.observability.withTurnLock(scope, async () => {
      const existing = await this.#dependencies.observability.getTurnCompletion(scope)
      if (existing) return parseReplay(existing, input, inputDigest)
      return this.#execute(input, inputDigest)
    })
    this.#pending.set(key, { inputDigest, promise })
    try { return await promise } finally {
      if (this.#pending.get(key)?.promise === promise) this.#pending.delete(key)
    }
  }
}

export function createAgentTurnRuntime(dependencies: AgentTurnDependencies): AgentTurnRuntime {
  return new AgentTurnRuntime(dependencies)
}

export async function runTurn(input: AgentTurnInput, dependencies: AgentTurnDependencies): Promise<AgentTurnResult> {
  return createAgentTurnRuntime(dependencies).runTurn(input)
}
