import { z } from 'zod'
import {
  approvalDigest as computeApprovalDigest,
  assetDigest,
  canonicalize,
  digest,
  paramsDigest,
  paramsDigestPayload,
  requestDigest,
  type ActionLedgerEntry,
  type ActionLedgerRecord,
  type GovernedAction,
  type ResultAdmission,
  type SubmissionState,
  type GateOutcome,
  type SideEffectState,
} from '@/lib/agent/contracts'
import {
  SELECTABLE_FASHION_MODELS,
  type AssetRecord,
  type FeatureType,
  type GenerationTask,
  type ResultAsset,
  type TaskStatus,
} from '@/lib/types'
import type {
  AdmittedResultView,
  AssetQueryPort,
  LockedResultAdmissionLedger,
  PaidGovernedAction,
  PostSubmitPort,
  ResultAdmissionDecision,
  ResultAdmissionPort,
  TaskQueryPort,
} from '../ports'
import type {
  StoredPreparationReference,
  TaskPreparationArtifactStorePort,
} from '../action/task-preparation'
import type { ApprovalEvidenceStorePort } from './approval-store'
import { DurableGovernanceTable, preparationArtifactKey } from './preparation-artifact-store'

export const RESULT_ADMISSION_EVIDENCE_FILE = 'result-admission-evidence.json'

const identifier = z.string().min(1).max(512)
const keySchema = z.string().min(1).max(2_048)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = z.string().datetime()
const taskStatusSchema = z.enum(['pending', 'running', 'success', 'partial', 'failed', 'cancelled'])
const reasonCode = z.string().regex(/^[a-z0-9_]+$/).max(128)
const evidenceSchema = z.object({
  schemaVersion: z.literal(1),
  evidenceRef: z.string().regex(/^c8:[a-f0-9]{64}$/),
  evidenceKind: z.enum(['post_submit', 'result_admission']),
  key: keySchema,
  userId: identifier,
  sessionId: identifier,
  messageId: identifier,
  taskId: identifier,
  actionKind: z.enum(['generate', 'retry_shots']),
  requestDigest: hash,
  approvalDigest: hash,
  taskStatus: taskStatusSchema.nullable(),
  outcome: z.enum(['accepted', 'blocked', 'pending', 'admitted', 'quarantined', 'unknown']),
  reasonCodes: z.array(reasonCode).max(128),
  resultAssetIds: z.array(identifier).max(256),
  resultDigest: hash.nullable(),
  createdAt: timestamp,
}).strict()

export type ResultAdmissionEvidence = z.infer<typeof evidenceSchema>
export type ResultAdmissionEvidenceObservation = Omit<ResultAdmissionEvidence, 'schemaVersion' | 'evidenceRef' | 'createdAt'>
export type ResultAdmissionEvidenceIdentity = Pick<
  ResultAdmissionEvidence,
  'key' | 'userId' | 'sessionId' | 'messageId' | 'taskId' | 'actionKind' | 'requestDigest' | 'approvalDigest'
>

/** 安全账只保存治理身份、摘要、状态、原因及结果 ID；URL/提示词不落表，稳定结果摘要明确排除可轮换 URL。 */
export interface ResultAdmissionEvidenceStorePort {
  record(observation: ResultAdmissionEvidenceObservation): Promise<ResultAdmissionEvidence>
  list(identity: ResultAdmissionEvidenceIdentity): Promise<ResultAdmissionEvidence[]>
}

function evidenceCore(entry: Omit<ResultAdmissionEvidence, 'evidenceRef' | 'createdAt'>): object {
  return {
    schemaVersion: 1,
    evidenceKind: entry.evidenceKind,
    key: entry.key,
    userId: entry.userId,
    sessionId: entry.sessionId,
    messageId: entry.messageId,
    taskId: entry.taskId,
    actionKind: entry.actionKind,
    requestDigest: entry.requestDigest,
    approvalDigest: entry.approvalDigest,
    taskStatus: entry.taskStatus,
    outcome: entry.outcome,
    reasonCodes: entry.reasonCodes,
    resultAssetIds: entry.resultAssetIds,
    resultDigest: entry.resultDigest,
  }
}

async function validateEvidence(value: unknown): Promise<ResultAdmissionEvidence> {
  const entry = evidenceSchema.parse(JSON.parse(canonicalize(value)))
  const { evidenceRef, createdAt: _createdAt, ...withoutVolatile } = entry
  if (evidenceRef !== `c8:${await digest(evidenceCore(withoutVolatile))}`) {
    throw new Error('c8_evidence_tampered: 证据摘要不一致')
  }
  if (new Set(entry.reasonCodes).size !== entry.reasonCodes.length
    || new Set(entry.resultAssetIds).size !== entry.resultAssetIds.length) {
    throw new Error('c8_evidence_tampered: 证据列表包含重复项')
  }
  return entry
}

function validTime(now: () => Date): string {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('c8_evidence_storage_unavailable: 时钟无效')
  }
  return value.toISOString()
}

/** 同一观察的 evidenceRef 与时间无关，因此并发/跨实例重复轮询只落一条证据。 */
export class FileResultAdmissionEvidenceStore implements ResultAdmissionEvidenceStorePort {
  private readonly table: DurableGovernanceTable<ResultAdmissionEvidence>
  private readonly now: () => Date

  constructor(directory: string, options: { now?: () => Date } = {}) {
    this.table = new DurableGovernanceTable(directory, RESULT_ADMISSION_EVIDENCE_FILE, validateEvidence)
    this.now = options.now ?? (() => new Date())
  }

  async record(raw: ResultAdmissionEvidenceObservation): Promise<ResultAdmissionEvidence> {
    const normalized = {
      ...raw,
      reasonCodes: [...new Set(raw.reasonCodes)].sort(),
      resultAssetIds: [...raw.resultAssetIds],
    }
    const parsed = evidenceSchema.omit({ evidenceRef: true, createdAt: true }).parse({
      schemaVersion: 1,
      ...JSON.parse(canonicalize(normalized)),
    })
    const evidenceRef = `c8:${await digest(evidenceCore(parsed))}`
    const candidate = await validateEvidence({ ...parsed, evidenceRef, createdAt: validTime(this.now) })
    return this.table.transaction(async (entries, save) => {
      const matches = entries.filter((entry) => entry.evidenceRef === evidenceRef)
      if (matches.length > 1) throw new Error('c8_evidence_conflict: 证据身份重复')
      if (matches[0]) {
        const { createdAt: _priorTime, ...priorStable } = matches[0]
        const { createdAt: _candidateTime, ...candidateStable } = candidate
        if (canonicalize(priorStable) !== canonicalize(candidateStable)) {
          throw new Error('c8_evidence_conflict: 摘要碰撞')
        }
        return matches[0]
      }
      entries.push(candidate)
      await save()
      return candidate
    })
  }

  async list(identity: ResultAdmissionEvidenceIdentity): Promise<ResultAdmissionEvidence[]> {
    const expected = z.object({
      key: keySchema,
      userId: identifier,
      sessionId: identifier,
      messageId: identifier,
      taskId: identifier,
      actionKind: z.enum(['generate', 'retry_shots']),
      requestDigest: hash,
      approvalDigest: hash,
    }).strict().parse(JSON.parse(canonicalize(identity)))
    return this.table.transaction(async (entries) => {
      if (new Set(entries.map((entry) => entry.evidenceRef)).size !== entries.length) {
        throw new Error('c8_evidence_conflict: 证据身份重复')
      }
      return entries.filter((entry) => entry.key === expected.key
        && entry.userId === expected.userId
        && entry.sessionId === expected.sessionId
        && entry.messageId === expected.messageId
        && entry.taskId === expected.taskId
        && entry.actionKind === expected.actionKind
        && entry.requestDigest === expected.requestDigest
        && entry.approvalDigest === expected.approvalDigest)
        .map((entry) => JSON.parse(canonicalize(entry)) as ResultAdmissionEvidence)
    })
  }
}

export function createResultAdmissionEvidenceStore(
  directory: string,
  options: { now?: () => Date } = {},
): ResultAdmissionEvidenceStorePort {
  return new FileResultAdmissionEvidenceStore(directory, options)
}

interface HistoricalEvidenceDependencies {
  artifacts: Pick<TaskPreparationArtifactStorePort, 'get'>
  approvals: ApprovalEvidenceStorePort
}

export interface PostSubmitVerifierDependencies extends HistoricalEvidenceDependencies {
  evidence: ResultAdmissionEvidenceStorePort
}

export interface ResultAdmissionDependencies extends HistoricalEvidenceDependencies {
  tasks: TaskQueryPort
  assets: AssetQueryPort
  evidence: ResultAdmissionEvidenceStorePort
  now?: () => Date
}

interface HistoricalActionEvidence {
  reference?: StoredPreparationReference
  reasonCodes: string[]
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => typeof value === 'string' && value === right[index])
}

function safeCanonicalEqual(left: unknown, right: unknown): boolean {
  try { return canonicalize(left) === canonicalize(right) } catch { return false }
}

/** 查询端口可能返回仓储 Map 中的活对象；只复制自有可枚举数据属性且绝不执行 getter。 */
function copyQuerySnapshot<T>(value: T): T {
  const ancestors = new Set<object>()
  function copy(current: unknown): unknown {
    if (current === undefined || current === null
      || typeof current === 'string' || typeof current === 'boolean') return current
    if (typeof current === 'number' && Number.isFinite(current)) return current
    if (typeof current !== 'object' || current === null) {
      throw new TypeError('result_admission_query_snapshot_invalid')
    }
    if (ancestors.has(current)) throw new TypeError('result_admission_query_snapshot_cyclic')
    ancestors.add(current)
    try {
      const array = Array.isArray(current)
      const keys: string[] = []
      for (const key of Reflect.ownKeys(current)) {
        if (array && key === 'length') continue
        if (typeof key !== 'string') throw new TypeError('result_admission_query_snapshot_symbol')
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('result_admission_query_snapshot_accessor')
        }
        keys.push(key)
      }
      if (array && (keys.length !== current.length
        || keys.some((key, index) => key !== String(index)))) {
        throw new TypeError('result_admission_query_snapshot_array_invalid')
      }
      const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null)
      for (const key of keys) {
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: copy(Object.getOwnPropertyDescriptor(current, key)!.value),
        })
      }
      return output
    } finally {
      ancestors.delete(current)
    }
  }
  return copy(value) as T
}

interface QuerySnapshot<T> {
  value?: T
  failed: boolean
}

async function readQuerySnapshot<T>(query: () => Promise<T | undefined>): Promise<QuerySnapshot<T>> {
  try {
    const value = await query()
    return value === undefined
      ? { failed: false }
      : { value: copyQuerySnapshot(value), failed: false }
  } catch {
    return { failed: true }
  }
}

/**
 * 跨查询只冻结当前 action 的治理事实。历史 attempt 的窗口由紧邻下一 attempt 的
 * priorResultAssetIds 截止，因此后续合法窗口、共享聚合状态与最新调用身份可继续推进。
 */
function actionAdmissionFacts(
  task: GenerationTask,
  inspection: AttemptInspection,
  candidates: CandidateResults,
): object {
  const execution = task.agentExecution
  const matching = inspection.matchingAttempt
  const next = inspection.attempts && inspection.matchingIndex !== undefined
    ? inspection.attempts[inspection.matchingIndex + 1]
    : undefined
  const historical = Boolean(next)
  return {
    schemaVersion: 2,
    common: {
      taskId: task.taskId,
      userId: task.userId,
      featureType: task.featureType,
      inputAssetIds: Array.isArray(task.inputAssetIds) ? [...task.inputAssetIds] : null,
      params: paramsDigestPayload(task.featureType, task.params),
      execution: execution ? {
        schemaVersion: execution.schemaVersion,
        paramsDigest: execution.paramsDigest,
        assetDigests: Array.isArray(execution.assetDigests) ? [...execution.assetDigests] : null,
        resolvedModelId: execution.resolvedModelId,
        promptTemplateVersion: execution.promptTemplateVersion,
        normalizationSeed: execution.normalizationSeed ?? null,
      } : null,
    },
    action: {
      historical,
      matchingIndex: inspection.matchingIndex ?? null,
      matchingAttempt: matching ? {
        actionKind: matching.actionKind,
        requestDigest: matching.requestDigest,
        idempotencyKey: matching.idempotencyKey,
        shotIds: Array.isArray(matching.shotIds) ? [...matching.shotIds] : null,
        attempt: matching.attempt,
        priorResultAssetIds: Array.isArray(matching.priorResultAssetIds)
          ? [...matching.priorResultAssetIds] : null,
      } : null,
      nextPriorResultAssetIds: next && Array.isArray(next.priorResultAssetIds)
        ? [...next.priorResultAssetIds] : null,
      candidateIds: [...candidates.candidateIds],
      candidateBindings: candidates.candidates.map((value) => {
        const item = asRecord(value)
        return item ? {
          assetId: typeof item.assetId === 'string' ? item.assetId : null,
          shotId: typeof item.shotId === 'string' ? item.shotId : null,
        } : null
      }),
      ...(historical ? {} : {
        latest: {
          status: task.status,
          requestDigest: execution?.requestDigest,
          idempotencyKey: execution?.idempotencyKey,
        },
      }),
    },
  }
}

function paidAction(reference: StoredPreparationReference): PaidGovernedAction {
  return {
    actionKind: reference.kind,
    payload: reference.artifact,
  } as PaidGovernedAction
}

async function verifyHistoricalSources(
  action: PaidGovernedAction,
  expectedApprovalDigest: string,
  dependencies: HistoricalEvidenceDependencies,
): Promise<HistoricalActionEvidence> {
  const reasons: string[] = []
  let reference: StoredPreparationReference | undefined
  let fullDigest: string | undefined
  try { fullDigest = await requestDigest(action) } catch { reasons.push('request_digest_unverifiable') }
  try {
    reference = await dependencies.artifacts.get(preparationArtifactKey(
      action.payload.userId,
      action.payload.proposalId,
      action.payload.version,
    ))
  } catch {
    reasons.push('artifact_unverifiable')
  }
  if (!reference) reasons.push('artifact_missing')
  else {
    let referenceDigestMatches = false
    try {
      const { referenceDigest, artifact: _artifact, ...referenceBase } = reference
      referenceDigestMatches = referenceDigest === await digest(referenceBase)
    } catch { referenceDigestMatches = false }
    if (!referenceDigestMatches
      || reference.kind !== action.actionKind
      || reference.key !== preparationArtifactKey(action.payload.userId, action.payload.proposalId, action.payload.version)
      || reference.requestDigest !== fullDigest
      || !safeCanonicalEqual(reference.artifact, action.payload)) {
      reasons.push('artifact_mismatch')
    }
    if (action.actionKind === 'generate') {
      if (!sameStrings(reference.inputAssetIds, action.payload.inputAssetIds)
        || reference.sourceTaskId !== null || reference.sourceTaskStateDigest !== null) {
        reasons.push('artifact_asset_binding_mismatch')
      }
    } else if (reference.sourceTaskId !== action.payload.taskId
      || !reference.sourceTaskStateDigest
      || reference.inputAssetIds.length === 0) {
      reasons.push('artifact_task_binding_mismatch')
    }
  }
  if (!reasons.length) {
    try {
      const approval = await dependencies.approvals.verifyHistoricalApproval(action, expectedApprovalDigest)
      if (await computeApprovalDigest(approval) !== expectedApprovalDigest
        || approval.userId !== action.payload.userId
        || approval.proposalId !== action.payload.proposalId
        || approval.previewVersion !== action.payload.version
        || approval.paramsDigest !== action.payload.paramsDigest
        || !sameStrings(approval.assetDigests, action.payload.assetDigests)
        || approval.requestDigest !== fullDigest) {
        reasons.push('approval_mismatch')
      }
    } catch {
      reasons.push('approval_unverifiable')
    }
  }
  return { reference, reasonCodes: [...new Set(reasons)].sort() }
}

type ExecutionAttempt = NonNullable<NonNullable<GenerationTask['agentExecution']>['attempts']>[number]

interface AttemptInspection {
  attempts: ExecutionAttempt[] | undefined
  matchingAttempt?: ExecutionAttempt
  matchingIndex?: number
  reasonCodes: string[]
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function uniqueNonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length
}

function startsWithStrings(values: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= values.length && prefix.every((value, index) => values[index] === value)
}

function inspectAttempts(
  task: GenerationTask,
  action: PaidGovernedAction,
  key: string,
  fullDigest: string | undefined,
): AttemptInspection {
  const raw = task.agentExecution?.attempts
  if (raw === undefined) return { attempts: undefined, reasonCodes: [] }
  if (!Array.isArray(raw)) return { attempts: undefined, reasonCodes: ['task_attempts_invalid'] }
  const reasons: string[] = []
  const attempts: ExecutionAttempt[] = []
  for (const candidate of raw as unknown[]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      reasons.push('task_attempts_invalid')
      continue
    }
    const item = candidate as Partial<ExecutionAttempt>
    if (!['generate', 'retry_shots'].includes(String(item.actionKind))
      || !isHash(item.requestDigest)
      || typeof item.idempotencyKey !== 'string' || !item.idempotencyKey
      || !uniqueNonEmptyStrings(item.shotIds)
      || (item.attempt !== null && (!Number.isSafeInteger(item.attempt) || Number(item.attempt) <= 0))
      || !uniqueNonEmptyStrings(item.priorResultAssetIds)) {
      reasons.push('task_attempts_invalid')
      continue
    }
    attempts.push(item as ExecutionAttempt)
  }
  if (reasons.length || attempts.length !== raw.length) return { attempts, reasonCodes: [...new Set(reasons)] }
  const matches = attempts.map((attempt, index) => ({ attempt, index })).filter(({ attempt }) =>
    attempt.actionKind === action.actionKind
    && attempt.requestDigest === fullDigest
    && attempt.idempotencyKey === key)
  if (matches.length !== 1) {
    return { attempts, reasonCodes: [matches.length ? 'task_attempt_conflict' : 'task_attempt_missing'] }
  }
  const match = matches[0]
  if (action.actionKind === 'generate') {
    if (match.attempt.attempt !== null || match.attempt.priorResultAssetIds.length !== 0) {
      reasons.push('task_attempt_metadata_mismatch')
    }
  } else if (!sameStrings(match.attempt.shotIds, action.payload.shotIds)
    || match.attempt.attempt !== action.payload.attempt) {
    reasons.push('task_attempt_metadata_mismatch')
  }
  return {
    attempts,
    matchingAttempt: match.attempt,
    matchingIndex: match.index,
    reasonCodes: [...new Set(reasons)],
  }
}

interface TaskBindingInspection extends AttemptInspection {
  fullDigest?: string
}

async function inspectTaskBinding(
  task: GenerationTask,
  action: PaidGovernedAction,
  key: string,
  expectedTaskId: string,
  reference: StoredPreparationReference | undefined,
  mode: 'post_submit' | 'result_admission',
): Promise<TaskBindingInspection> {
  const reasons: string[] = []
  let fullDigest: string | undefined
  try { fullDigest = await requestDigest(action) } catch { reasons.push('request_digest_unverifiable') }
  if (!expectedTaskId || task.taskId !== expectedTaskId
    || (action.actionKind === 'retry_shots' && expectedTaskId !== action.payload.taskId)) {
    reasons.push('task_id_mismatch')
  }
  if (task.userId !== action.payload.userId) reasons.push('task_owner_mismatch')
  if (task.featureType !== action.payload.featureType) reasons.push('task_feature_mismatch')
  if (!action.payload.resolvedModelId || !SELECTABLE_FASHION_MODELS.some((model) =>
    model.id === action.payload.resolvedModelId && model.provider === 'grsai')) {
    reasons.push('task_execution_model_not_allowed')
  }
  if (!Object.hasOwn(taskStatusSchema.enum, task.status)) reasons.push('task_status_invalid')

  let currentParamsDigest: string | undefined
  try { currentParamsDigest = await paramsDigest(task.featureType, task.params) } catch {
    reasons.push('task_params_digest_unverifiable')
  }
  if (currentParamsDigest !== action.payload.paramsDigest) reasons.push('task_params_digest_mismatch')

  const expectedInputs = action.actionKind === 'generate'
    ? action.payload.inputAssetIds
    : reference?.inputAssetIds
  if (!sameStrings(task.inputAssetIds, expectedInputs)) reasons.push('task_input_assets_mismatch')

  const execution = task.agentExecution
  if (!execution || execution.schemaVersion !== 1) reasons.push('task_execution_missing')
  else {
    if (execution.paramsDigest !== action.payload.paramsDigest) reasons.push('task_execution_params_digest_mismatch')
    if (!sameStrings(execution.assetDigests, action.payload.assetDigests)) reasons.push('task_execution_asset_digests_mismatch')
    if (!action.payload.resolvedModelId || execution.resolvedModelId !== action.payload.resolvedModelId) {
      reasons.push('task_execution_model_mismatch')
    }
    if (!action.payload.promptTemplateVersion
      || execution.promptTemplateVersion !== action.payload.promptTemplateVersion) {
      reasons.push('task_execution_template_mismatch')
    }
    if (action.actionKind === 'generate' && execution.normalizationSeed !== action.payload.normalizationSeed) {
      reasons.push('task_execution_seed_mismatch')
    }
    if (mode === 'post_submit' || execution.attempts === undefined) {
      if (execution.requestDigest !== fullDigest) reasons.push('task_execution_request_digest_mismatch')
      if (execution.idempotencyKey !== key) reasons.push('task_execution_idempotency_key_mismatch')
    }
  }

  const attempts = execution ? inspectAttempts(task, action, key, fullDigest)
    : { attempts: undefined, reasonCodes: [] } satisfies AttemptInspection
  reasons.push(...attempts.reasonCodes)
  if (action.actionKind === 'retry_shots' && mode === 'result_admission' && !attempts.matchingAttempt) {
    reasons.push('retry_attempt_evidence_missing')
  }
  if (attempts.matchingAttempt && Array.isArray(task.resultAssetIds)
    && !startsWithStrings(task.resultAssetIds, attempts.matchingAttempt.priorResultAssetIds)) {
    reasons.push('task_attempt_baseline_mismatch')
  }
  if (mode === 'post_submit' && task.status === 'pending' && attempts.matchingAttempt
    && !sameStrings(task.resultAssetIds, attempts.matchingAttempt.priorResultAssetIds)) {
    reasons.push('task_attempt_baseline_mismatch')
  }
  return { ...attempts, fullDigest, reasonCodes: [...new Set(reasons)].sort() }
}

function evidenceIdentity(input: {
  key: string
  action: PaidGovernedAction
  taskId: string
  requestDigest: string
  approvalDigest: string
}): ResultAdmissionEvidenceIdentity {
  return {
    key: input.key,
    userId: input.action.payload.userId,
    sessionId: input.action.payload.sessionId,
    messageId: input.action.payload.messageId,
    taskId: input.taskId,
    actionKind: input.action.actionKind,
    requestDigest: input.requestDigest,
    approvalDigest: input.approvalDigest,
  }
}

/** TOOL 返回后立即核验任务快照；任何 accepted/blocked 结论都先强写独立 C8 证据。 */
export function createPostSubmitVerifier(dependencies: PostSubmitVerifierDependencies): PostSubmitPort {
  return Object.freeze({
    async postSubmit(input: Parameters<PostSubmitPort['postSubmit']>[0]) {
      const task = copyQuerySnapshot(input.task)
      const source = await verifyHistoricalSources(input.action, input.approvalDigest, dependencies)
      const binding = await inspectTaskBinding(
        task,
        input.action,
        input.key,
        input.expectedTaskId,
        source.reference,
        'post_submit',
      )
      const reasonCodes = [...new Set([...source.reasonCodes, ...binding.reasonCodes])].sort()
      const outcome = reasonCodes.length ? 'blocked' as const : 'accepted' as const
      const fullDigest = binding.fullDigest ?? '0'.repeat(64)
      const evidence = await dependencies.evidence.record({
        evidenceKind: 'post_submit',
        ...evidenceIdentity({
          key: input.key,
          action: input.action,
          taskId: input.expectedTaskId || task.taskId,
          requestDigest: fullDigest,
          approvalDigest: input.approvalDigest,
        }),
        taskStatus: taskStatusSchema.safeParse(task.status).success ? task.status : null,
        outcome,
        reasonCodes,
        resultAssetIds: [],
        resultDigest: null,
      })
      return {
        outcome,
        ...(taskStatusSchema.safeParse(task.status).success ? { taskStatus: task.status } : {}),
        confirmedTask: outcome === 'accepted',
        evidenceRef: evidence.evidenceRef,
        reasonCodes,
      }
    },
  })
}

interface ApprovedShot {
  shotId: string
  label?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readApprovedShots(
  action: PaidGovernedAction,
  task: GenerationTask,
): { shots: ApprovedShot[] | null; reasonCodes: string[] } {
  if (action.actionKind === 'retry_shots') {
    if (action.payload.estimatedResultCount !== action.payload.shotIds.length
      || !uniqueNonEmptyStrings(action.payload.shotIds)) {
      return { shots: [], reasonCodes: ['approved_shot_scope_invalid'] }
    }
  }
  const params = action.actionKind === 'generate' ? action.payload.normalizedParams : task.params
  const record = asRecord(params)
  if (!record) return { shots: [], reasonCodes: ['approved_shot_scope_invalid'] }
  let raw: unknown[] | undefined
  let idField = 'shotId'
  let labelField = 'label'
  if (action.payload.featureType === 'photo-fission') raw = Array.isArray(record.shotPlan) ? record.shotPlan : undefined
  else if (action.payload.featureType === 'pose-fission') {
    raw = Array.isArray(record.poses) ? record.poses : undefined
    idField = 'id'; labelField = 'name'
  } else if (action.payload.featureType === 'garment-detail') raw = Array.isArray(record.detailShots) ? record.detailShots : undefined
  else return { shots: null, reasonCodes: [] }
  if (!raw) return { shots: [], reasonCodes: ['approved_shot_scope_invalid'] }
  const all: ApprovedShot[] = []
  for (const value of raw) {
    const item = asRecord(value)
    if (!item || typeof item[idField] !== 'string' || !(item[idField] as string)) {
      return { shots: [], reasonCodes: ['approved_shot_scope_invalid'] }
    }
    all.push({
      shotId: item[idField] as string,
      ...(typeof item[labelField] === 'string' && item[labelField] ? { label: item[labelField] as string } : {}),
    })
  }
  if (new Set(all.map((shot) => shot.shotId)).size !== all.length) {
    return { shots: [], reasonCodes: ['approved_shot_scope_invalid'] }
  }
  if (action.actionKind === 'generate') {
    if (all.length !== action.payload.estimatedResultCount) {
      return { shots: [], reasonCodes: ['approved_result_count_invalid'] }
    }
    return { shots: all, reasonCodes: [] }
  }
  const byId = new Map(all.map((shot) => [shot.shotId, shot]))
  const selected = action.payload.shotIds.map((shotId) => byId.get(shotId))
  if (selected.some((shot) => !shot)) return { shots: [], reasonCodes: ['approved_shot_scope_invalid'] }
  return { shots: selected as ApprovedShot[], reasonCodes: [] }
}

interface CandidateResults {
  candidates: ResultAsset[]
  candidateIds: string[]
  reasonCodes: string[]
}

function candidateResults(
  task: GenerationTask,
  action: PaidGovernedAction,
  attempts: AttemptInspection,
): CandidateResults {
  const reasons: string[] = []
  if (!Array.isArray(task.results) || !Array.isArray(task.resultAssetIds)) {
    return { candidates: [], candidateIds: [], reasonCodes: ['result_arrays_invalid'] }
  }
  const resultIds: string[] = []
  for (const result of task.results as unknown[]) {
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || typeof (result as ResultAsset).assetId !== 'string' || !(result as ResultAsset).assetId) {
      reasons.push('result_identity_invalid')
      continue
    }
    resultIds.push((result as ResultAsset).assetId)
  }
  if (!uniqueNonEmptyStrings(task.resultAssetIds)
    || resultIds.length !== task.results.length
    || !sameStrings(resultIds, task.resultAssetIds)) {
    reasons.push('result_arrays_mismatch')
  }
  if (new Set(resultIds).size !== resultIds.length) reasons.push('result_asset_duplicate')
  if (reasons.length) {
    return { candidates: [], candidateIds: [], reasonCodes: [...new Set(reasons)] }
  }

  if (!attempts.attempts || attempts.matchingIndex === undefined || !attempts.matchingAttempt) {
    if (action.actionKind === 'retry_shots') {
      return { candidates: [], candidateIds: [], reasonCodes: ['retry_attempt_evidence_missing'] }
    }
    return { candidates: task.results, candidateIds: task.resultAssetIds, reasonCodes: [] }
  }

  const ordered = attempts.attempts
  let previous: readonly string[] = []
  for (const attempt of ordered) {
    if (!startsWithStrings(task.resultAssetIds, attempt.priorResultAssetIds)
      || !startsWithStrings(attempt.priorResultAssetIds, previous)) {
      reasons.push('task_attempt_baseline_mismatch')
      break
    }
    previous = attempt.priorResultAssetIds
  }
  const start = attempts.matchingAttempt.priorResultAssetIds.length
  const next = ordered[attempts.matchingIndex + 1]
  const end = next ? next.priorResultAssetIds.length : task.resultAssetIds.length
  if (end < start || (next && !startsWithStrings(next.priorResultAssetIds, attempts.matchingAttempt.priorResultAssetIds))) {
    reasons.push('task_attempt_baseline_mismatch')
  }
  return {
    candidates: task.results.slice(start, end),
    candidateIds: task.resultAssetIds.slice(start, end),
    reasonCodes: [...new Set(reasons)],
  }
}

function validateCandidateScope(
  candidates: readonly ResultAsset[],
  action: PaidGovernedAction,
  approvedShots: readonly ApprovedShot[] | null,
  requireComplete: boolean,
): string[] {
  const reasons: string[] = []
  const expectedCount = action.payload.estimatedResultCount
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || candidates.length > expectedCount) {
    reasons.push('result_count_exceeded')
  }
  if (requireComplete && candidates.length !== expectedCount) reasons.push('result_count_incomplete')
  if (approvedShots === null) {
    if (candidates.some((result) => result.shotId !== undefined)) reasons.push('result_shot_unapproved')
    return [...new Set(reasons)]
  }
  const approved = new Set(approvedShots.map((shot) => shot.shotId))
  const candidateShotIds: string[] = []
  for (const result of candidates) {
    if (typeof result.shotId !== 'string' || !approved.has(result.shotId)) reasons.push('result_shot_unapproved')
    else candidateShotIds.push(result.shotId)
  }
  if (new Set(candidateShotIds).size !== candidateShotIds.length) reasons.push('result_shot_duplicate')
  if (requireComplete && (candidateShotIds.length !== approved.size
    || [...approved].some((shotId) => !candidateShotIds.includes(shotId)))) {
    reasons.push('result_shot_incomplete')
  }
  return [...new Set(reasons)]
}

function safeAssetUrl(value: string): boolean {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)
    || /(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(value)) return false
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return false
    try {
      const parsed = new URL(value, 'https://agent.local')
      return parsed.origin === 'https://agent.local' && parsed.pathname.startsWith('/')
    } catch { return false }
  }
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && Boolean(parsed.hostname) && !parsed.username && !parsed.password
  } catch { return false }
}

function validAssetRecord(asset: AssetRecord, assetId: string, userId: string, taskId: string): string[] {
  const reasons: string[] = []
  if (asset.assetId !== assetId) reasons.push('result_asset_id_mismatch')
  if (asset.userId !== userId) reasons.push('result_asset_owner_mismatch')
  if (asset.taskId !== taskId) reasons.push('result_asset_task_mismatch')
  if (!safeAssetUrl(asset.fileUrl)) reasons.push('result_asset_url_unsafe')
  if (!Number.isSafeInteger(asset.width) || asset.width <= 0
    || !Number.isSafeInteger(asset.height) || asset.height <= 0) {
    reasons.push('result_asset_dimensions_invalid')
  }
  if (!asset.fileName || asset.fileName !== asset.fileName.trim()
    || asset.fileName === '.' || asset.fileName === '..'
    || /[\u0000-\u001f\u007f/\\]/.test(asset.fileName)) reasons.push('result_asset_filename_invalid')
  if (typeof asset.fileType !== 'string' || !asset.fileType.toLowerCase().startsWith('image/')) {
    reasons.push('result_asset_type_invalid')
  }
  return reasons
}

interface SafeResults {
  views: AdmittedResultView[]
  resultDigest?: string
  reasonCodes: string[]
}

async function safeResults(
  candidates: readonly ResultAsset[],
  candidateIds: readonly string[],
  approvedShots: readonly ApprovedShot[] | null,
  task: GenerationTask,
  dependencies: Pick<ResultAdmissionDependencies, 'assets'>,
): Promise<SafeResults> {
  const reasons: string[] = []
  const views: AdmittedResultView[] = []
  const digestRecords: object[] = []
  const labels = approvedShots === null ? new Map<string, string | undefined>()
    : new Map(approvedShots.map((shot) => [shot.shotId, shot.label]))
  for (let index = 0; index < candidateIds.length; index += 1) {
    const assetId = candidateIds[index]
    const observed = await readQuerySnapshot(() => dependencies.assets.getAsset(assetId))
    if (observed.failed) {
      reasons.push('result_asset_query_unverifiable')
      continue
    }
    const asset = observed.value
    if (!asset) {
      reasons.push('result_asset_missing')
      continue
    }
    const assetReasons = validAssetRecord(asset, assetId, task.userId!, task.taskId)
    reasons.push(...assetReasons)
    if (assetReasons.length) continue
    let immutableAssetDigest: string | undefined
    try { immutableAssetDigest = await assetDigest(asset) } catch {
      reasons.push('result_asset_digest_unverifiable')
      continue
    }
    const result = candidates[index]
    const label = result.shotId ? labels.get(result.shotId) : undefined
    const view: AdmittedResultView = {
      assetId: asset.assetId,
      taskId: task.taskId,
      ...(result.shotId ? { shotId: result.shotId } : {}),
      ...(label ? { label } : {}),
      fileName: asset.fileName,
      url: asset.fileUrl,
      downloadUrl: asset.fileUrl,
      width: asset.width,
      height: asset.height,
    }
    views.push(view)
    digestRecords.push({
      assetId: asset.assetId,
      assetDigest: immutableAssetDigest,
      fileName: asset.fileName,
      fileType: asset.fileType,
      shotId: result.shotId ?? null,
      label: label ?? null,
    })
  }
  if (reasons.length) return { views: [], reasonCodes: [...new Set(reasons)].sort() }
  return {
    views,
    // URL 只用于本次安全视图；稳定摘要绑定共享资产身份和有序 shot，不绑定可轮换签名。
    resultDigest: await digest({ schemaVersion: 2, taskId: task.taskId, results: digestRecords }),
    reasonCodes: [],
  }
}

type PaidLedgerEntry = Extract<ActionLedgerEntry, { approvalEvidence: 'receipt' }>

function isPaidLedgerEntry(record: ActionLedgerRecord): record is PaidLedgerEntry {
  return record.recordKind === 'v1'
    && (record.actionKind === 'generate' || record.actionKind === 'retry_shots')
}

function entryActionIdentity(
  entry: PaidLedgerEntry,
  action: PaidGovernedAction,
  fullDigest: string,
): string[] {
  const reasons: string[] = []
  if (entry.actionKind !== action.actionKind) reasons.push('ledger_action_mismatch')
  if (entry.userId !== action.payload.userId
    || entry.sessionId !== action.payload.sessionId
    || entry.messageId !== action.payload.messageId) reasons.push('ledger_scope_mismatch')
  if (entry.proposalId !== action.payload.proposalId
    || entry.previewVersion !== action.payload.version
    || entry.featureType !== action.payload.featureType
    || entry.requestDigest !== fullDigest
    || !sameStrings(entry.assetDigests, action.payload.assetDigests)) reasons.push('ledger_artifact_mismatch')
  if (action.actionKind === 'retry_shots' && entry.taskId !== action.payload.taskId) reasons.push('ledger_task_mismatch')
  return reasons
}

interface EntryPatch {
  submissionState?: SubmissionState
  taskStatus?: TaskStatus | null
  gateOutcome?: GateOutcome
  sideEffectState?: SideEffectState
  resultAdmission?: ResultAdmission
}

function timestampNow(now: () => Date): string {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('result_admission_clock_invalid')
  return value.toISOString()
}

async function persistDecision(
  entry: PaidLedgerEntry,
  ledger: LockedResultAdmissionLedger,
  evidenceStore: ResultAdmissionEvidenceStorePort,
  now: () => Date,
  input: {
    outcome: ResultAdmissionEvidence['outcome']
    taskStatus?: TaskStatus
    reasonCodes: string[]
    resultAssetIds?: string[]
    resultDigest?: string
    patch: EntryPatch
    views?: AdmittedResultView[]
  },
): Promise<{ decision: ResultAdmissionDecision }> {
  const evidence = await evidenceStore.record({
    evidenceKind: 'result_admission',
    key: entry.key,
    userId: entry.userId,
    sessionId: entry.sessionId,
    messageId: entry.messageId,
    taskId: entry.taskId,
    actionKind: entry.actionKind as 'generate' | 'retry_shots',
    requestDigest: entry.requestDigest,
    approvalDigest: entry.approvalDigest as string,
    taskStatus: input.taskStatus ?? null,
    outcome: input.outcome,
    reasonCodes: [...new Set(input.reasonCodes)].sort(),
    resultAssetIds: input.resultAssetIds ?? [],
    resultDigest: input.resultDigest ?? null,
  })
  const snapshot = {
    submissionState: entry.submissionState,
    taskStatus: entry.taskStatus,
    gateOutcome: entry.gateOutcome,
    sideEffectState: entry.sideEffectState,
    resultAdmission: entry.resultAdmission,
    evidenceRefs: [...entry.evidenceRefs],
    updatedAt: entry.updatedAt,
  }
  if (input.patch.submissionState) entry.submissionState = input.patch.submissionState
  if (input.patch.taskStatus === null) delete entry.taskStatus
  else if (input.patch.taskStatus !== undefined) entry.taskStatus = input.patch.taskStatus
  if (input.patch.gateOutcome) entry.gateOutcome = input.patch.gateOutcome
  if (input.patch.sideEffectState) entry.sideEffectState = input.patch.sideEffectState
  if (input.patch.resultAdmission) entry.resultAdmission = input.patch.resultAdmission
  entry.evidenceRefs = [...new Set([...entry.evidenceRefs, evidence.evidenceRef])]
  const comparableBefore = {
    submissionState: snapshot.submissionState,
    taskStatus: snapshot.taskStatus ?? null,
    gateOutcome: snapshot.gateOutcome,
    sideEffectState: snapshot.sideEffectState,
    resultAdmission: snapshot.resultAdmission,
    evidenceRefs: snapshot.evidenceRefs,
  }
  const comparableAfter = {
    submissionState: entry.submissionState,
    taskStatus: entry.taskStatus ?? null,
    gateOutcome: entry.gateOutcome,
    sideEffectState: entry.sideEffectState,
    resultAdmission: entry.resultAdmission,
    evidenceRefs: entry.evidenceRefs,
  }
  const changed = canonicalize(comparableBefore) !== canonicalize(comparableAfter)
  if (changed) {
    entry.updatedAt = timestampNow(now)
    try { await ledger.save() } catch (error) {
      entry.submissionState = snapshot.submissionState
      if (snapshot.taskStatus === undefined) delete entry.taskStatus
      else entry.taskStatus = snapshot.taskStatus
      entry.gateOutcome = snapshot.gateOutcome
      entry.sideEffectState = snapshot.sideEffectState
      entry.resultAdmission = snapshot.resultAdmission
      entry.evidenceRefs = snapshot.evidenceRefs
      entry.updatedAt = snapshot.updatedAt
      throw error
    }
  }
  return {
    decision: {
      key: entry.key,
      messageId: entry.messageId,
      taskId: entry.taskId,
      ...(entry.taskStatus ? { taskStatus: entry.taskStatus } : {}),
      resultAdmission: entry.resultAdmission,
      results: input.views ?? [],
      ...(input.outcome === 'admitted' && evidence.resultDigest ? {
        c8Evidence: { evidenceRef: evidence.evidenceRef, resultDigest: evidence.resultDigest },
      } : {}),
    },
  }
}

/** 只读任务/资产与历史证据；账本锁必须由调用方持有，本实现不获取 ActionLedger 锁。 */
export function createResultAdmission(dependencies: ResultAdmissionDependencies): ResultAdmissionPort {
  const now = dependencies.now ?? (() => new Date())
  return Object.freeze({
    async admitResults(
      scope: Parameters<ResultAdmissionPort['admitResults']>[0],
      ledger: Parameters<ResultAdmissionPort['admitResults']>[1],
    ) {
      if (!scope.userId?.trim() || !scope.sessionId?.trim()) throw new TypeError('result admission requires authenticated scope')
      const decisions: Array<Awaited<ReturnType<typeof persistDecision>>['decision']> = []
      for (const record of ledger.entries) {
        if (!isPaidLedgerEntry(record)
          || record.userId !== scope.userId || record.sessionId !== scope.sessionId) continue
        const entry = record
        const noResults = () => ({
          key: entry.key,
          messageId: entry.messageId,
          taskId: entry.taskId,
          ...(entry.taskStatus ? { taskStatus: entry.taskStatus } : {}),
          resultAdmission: entry.resultAdmission,
          results: [] as AdmittedResultView[],
        })

        if (entry.resultAdmission === 'QUARANTINED') { decisions.push(noResults()); continue }
        if (['STARTING', 'UNKNOWN', 'VERIFYING'].includes(entry.submissionState)) {
          if (entry.resultAdmission === 'ADMITTED') {
            const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
              outcome: 'quarantined', reasonCodes: ['admitted_submission_became_unknown'],
              patch: { gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
            })
            decisions.push(persisted.decision)
          } else decisions.push(noResults())
          continue
        }
        if (entry.gateOutcome === 'BLOCKED_POST_SUBMIT' || entry.gateOutcome === 'BLOCKED_RESULT') {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', reasonCodes: ['prior_gate_block'], patch: { resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }
        if (entry.submissionState !== 'SUBMITTED' || entry.sideEffectState !== 'CONFIRMED'
          || entry.gateOutcome !== 'PASSED_PRE') {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'unknown', reasonCodes: ['submission_not_verifiable'],
            patch: { submissionState: 'UNKNOWN', taskStatus: null, resultAdmission: 'PENDING' },
          })
          decisions.push(persisted.decision)
          continue
        }

        let reference: StoredPreparationReference | undefined
        try {
          reference = await dependencies.artifacts.get(preparationArtifactKey(entry.userId, entry.proposalId, entry.previewVersion))
        } catch {
          reference = undefined
        }
        let action: PaidGovernedAction | undefined
        let sourceReasons: string[] = []
        if (!reference) sourceReasons.push('artifact_unverifiable')
        else {
          action = paidAction(reference)
          let fullDigest: string | undefined
          try { fullDigest = await requestDigest(action) } catch { sourceReasons.push('request_digest_unverifiable') }
          if (fullDigest) sourceReasons.push(...entryActionIdentity(entry, action, fullDigest))
          const historical = await verifyHistoricalSources(paidAction(reference), entry.approvalDigest, dependencies)
          sourceReasons.push(...historical.reasonCodes)
        }
        if (!action || sourceReasons.length) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', reasonCodes: [...new Set(sourceReasons.length ? sourceReasons : ['artifact_unverifiable'])],
            patch: { gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        const cleanAction = paidAction(reference!)
        const actionDigest = await requestDigest(cleanAction)
        const identity = evidenceIdentity({
          key: entry.key,
          action: cleanAction,
          taskId: entry.taskId,
          requestDigest: actionDigest,
          approvalDigest: entry.approvalDigest,
        })
        const priorEvidence = await dependencies.evidence.list(identity)
        const postEvidence = priorEvidence.filter((evidence) => evidence.evidenceKind === 'post_submit')
        if (!postEvidence.some((evidence) => evidence.outcome === 'accepted')
          || postEvidence.some((evidence) => evidence.outcome === 'blocked')) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', reasonCodes: ['post_submit_evidence_missing_or_blocked'],
            patch: { gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }
        if (priorEvidence.some((evidence) => evidence.evidenceKind === 'result_admission'
          && evidence.outcome === 'quarantined')) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', reasonCodes: ['prior_quarantine_evidence'],
            patch: { gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        const queriedTask = await readQuerySnapshot(() => dependencies.tasks.getTask(entry.taskId))
        const task = queriedTask.value
        const taskQueryFailed = queriedTask.failed
        if (!task) {
          if (entry.resultAdmission === 'ADMITTED') {
            const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
              outcome: 'quarantined', reasonCodes: [taskQueryFailed ? 'task_query_failed_after_admission' : 'task_missing_after_admission'],
              patch: { submissionState: 'UNKNOWN', taskStatus: null, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
            })
            decisions.push(persisted.decision)
          } else {
            const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
              outcome: 'unknown', reasonCodes: [taskQueryFailed ? 'task_query_unverifiable' : 'task_missing'],
              patch: { submissionState: 'UNKNOWN', taskStatus: null, resultAdmission: 'PENDING' },
            })
            decisions.push(persisted.decision)
          }
          continue
        }

        const binding = await inspectTaskBinding(task, cleanAction, entry.key, entry.taskId, reference, 'result_admission')
        if (binding.reasonCodes.length) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: taskStatusSchema.safeParse(task.status).success ? task.status : undefined,
            reasonCodes: binding.reasonCodes,
            resultAssetIds: uniqueNonEmptyStrings(task.resultAssetIds) ? task.resultAssetIds : [],
            patch: {
              gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED',
              ...(taskStatusSchema.safeParse(task.status).success ? { taskStatus: task.status } : {}),
            },
          })
          decisions.push(persisted.decision)
          continue
        }

        const historicalAttempt = binding.attempts !== undefined && binding.matchingIndex !== undefined
          && binding.matchingIndex < binding.attempts.length - 1
        let admissionTaskStatus: TaskStatus = task.status
        if (historicalAttempt) {
          if (entry.resultAdmission !== 'ADMITTED') {
            const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
              outcome: 'pending', reasonCodes: ['historical_attempt_status_unavailable'],
              patch: { resultAdmission: 'PENDING' },
            })
            decisions.push(persisted.decision)
            continue
          }
          const historicalStatuses = new Set(priorEvidence
            .filter((evidence) => evidence.evidenceKind === 'result_admission'
              && evidence.outcome === 'admitted'
              && evidence.taskStatus !== null
              && !['pending', 'running'].includes(evidence.taskStatus))
            .map((evidence) => evidence.taskStatus as TaskStatus))
          if (historicalStatuses.size !== 1) {
            const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
              outcome: 'quarantined', reasonCodes: ['historical_attempt_status_unverifiable'],
              patch: { gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
            })
            decisions.push(persisted.decision)
            continue
          }
          admissionTaskStatus = [...historicalStatuses][0]
        }

        if (!historicalAttempt && (task.status === 'pending' || task.status === 'running')) {
          if (entry.resultAdmission === 'ADMITTED') {
            const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
              outcome: 'quarantined', taskStatus: task.status, reasonCodes: ['task_status_regressed_after_admission'],
              patch: { taskStatus: task.status, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
            })
            decisions.push(persisted.decision)
          } else {
            const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
              outcome: 'pending', taskStatus: task.status, reasonCodes: ['task_not_terminal'],
              patch: { taskStatus: task.status, resultAdmission: 'PENDING' },
            })
            decisions.push(persisted.decision)
          }
          continue
        }

        const approved = readApprovedShots(cleanAction, task)
        const candidates = candidateResults(task, cleanAction, binding)
        const requireComplete = admissionTaskStatus === 'success'
        const resultReasons = [
          ...approved.reasonCodes,
          ...candidates.reasonCodes,
          ...validateCandidateScope(candidates.candidates, cleanAction, approved.shots, requireComplete),
        ]
        if (resultReasons.length) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: admissionTaskStatus,
            reasonCodes: [...new Set(resultReasons)], resultAssetIds: candidates.candidateIds,
            patch: { taskStatus: admissionTaskStatus, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        const safe = await safeResults(candidates.candidates, candidates.candidateIds, approved.shots, task, dependencies)
        if (safe.reasonCodes.length || !safe.resultDigest) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: admissionTaskStatus,
            reasonCodes: safe.reasonCodes.length ? safe.reasonCodes : ['result_digest_unverifiable'],
            resultAssetIds: candidates.candidateIds,
            patch: { taskStatus: admissionTaskStatus, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        const initialActionFacts = actionAdmissionFacts(task, binding, candidates)
        const refreshedTaskQuery = await readQuerySnapshot(() => dependencies.tasks.getTask(entry.taskId))
        const refreshedTask = refreshedTaskQuery.value
        if (!refreshedTask) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: admissionTaskStatus,
            reasonCodes: [refreshedTaskQuery.failed
              ? 'task_recheck_unverifiable' : 'task_missing_during_result_admission'],
            resultAssetIds: candidates.candidateIds,
            patch: { taskStatus: admissionTaskStatus, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        const refreshedBinding = await inspectTaskBinding(
          refreshedTask, cleanAction, entry.key, entry.taskId, reference, 'result_admission',
        )
        const refreshedApproved = readApprovedShots(cleanAction, refreshedTask)
        const refreshedCandidates = candidateResults(refreshedTask, cleanAction, refreshedBinding)
        const refreshedReasons = [
          ...refreshedBinding.reasonCodes,
          ...refreshedApproved.reasonCodes,
          ...refreshedCandidates.reasonCodes,
          ...validateCandidateScope(
            refreshedCandidates.candidates,
            cleanAction,
            refreshedApproved.shots,
            requireComplete,
          ),
        ]
        const refreshedActionFacts = actionAdmissionFacts(
          refreshedTask, refreshedBinding, refreshedCandidates,
        )
        if (!safeCanonicalEqual(initialActionFacts, refreshedActionFacts)) {
          refreshedReasons.push('task_snapshot_changed_during_result_admission')
        }
        if (refreshedReasons.length) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: admissionTaskStatus,
            reasonCodes: [...new Set(refreshedReasons)],
            resultAssetIds: refreshedCandidates.candidateIds,
            patch: { taskStatus: admissionTaskStatus, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        // 第二轮读取资产；稳定身份必须与首轮一致，但安全 URL 可轮换且以本轮值返回。
        const refreshedSafe = await safeResults(
          refreshedCandidates.candidates,
          refreshedCandidates.candidateIds,
          refreshedApproved.shots,
          refreshedTask,
          dependencies,
        )
        if (refreshedSafe.reasonCodes.length || !refreshedSafe.resultDigest
          || refreshedSafe.resultDigest !== safe.resultDigest) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: admissionTaskStatus,
            reasonCodes: refreshedSafe.reasonCodes.length
              ? refreshedSafe.reasonCodes
              : [refreshedSafe.resultDigest ? 'result_snapshot_changed_during_admission' : 'result_digest_unverifiable'],
            resultAssetIds: refreshedCandidates.candidateIds,
            patch: { taskStatus: admissionTaskStatus, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        // 资产二次读取包含 await；写证据前再确认任务绑定/窗口仍与首轮一致。
        const finalTaskQuery = await readQuerySnapshot(() => dependencies.tasks.getTask(entry.taskId))
        const finalTask = finalTaskQuery.value
        let finalTaskReasons: string[] = []
        if (!finalTask) {
          finalTaskReasons = [finalTaskQuery.failed
            ? 'task_final_recheck_unverifiable' : 'task_missing_during_result_admission']
        } else {
          const finalBinding = await inspectTaskBinding(
            finalTask, cleanAction, entry.key, entry.taskId, reference, 'result_admission',
          )
          const finalApproved = readApprovedShots(cleanAction, finalTask)
          const finalCandidates = candidateResults(finalTask, cleanAction, finalBinding)
          finalTaskReasons = [
            ...finalBinding.reasonCodes,
            ...finalApproved.reasonCodes,
            ...finalCandidates.reasonCodes,
            ...validateCandidateScope(
              finalCandidates.candidates,
              cleanAction,
              finalApproved.shots,
              requireComplete,
            ),
          ]
          const finalActionFacts = actionAdmissionFacts(finalTask, finalBinding, finalCandidates)
          if (!safeCanonicalEqual(initialActionFacts, finalActionFacts)) {
            finalTaskReasons.push('task_snapshot_changed_during_result_admission')
          }
        }
        if (finalTaskReasons.length) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: admissionTaskStatus,
            reasonCodes: [...new Set(finalTaskReasons)],
            resultAssetIds: refreshedCandidates.candidateIds,
            patch: { taskStatus: admissionTaskStatus, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        const admittedDigests = new Set(priorEvidence.filter((evidence) => evidence.evidenceKind === 'result_admission'
          && evidence.outcome === 'admitted' && evidence.resultDigest).map((evidence) => evidence.resultDigest))
        if (admittedDigests.size > 1
          || (admittedDigests.size === 1 && !admittedDigests.has(refreshedSafe.resultDigest))) {
          const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
            outcome: 'quarantined', taskStatus: admissionTaskStatus, reasonCodes: ['admitted_result_changed'],
            resultAssetIds: refreshedCandidates.candidateIds, resultDigest: refreshedSafe.resultDigest,
            patch: { taskStatus: admissionTaskStatus, gateOutcome: 'BLOCKED_RESULT', resultAdmission: 'QUARANTINED' },
          })
          decisions.push(persisted.decision)
          continue
        }

        const persisted = await persistDecision(entry, ledger, dependencies.evidence, now, {
          outcome: 'admitted', taskStatus: admissionTaskStatus, reasonCodes: ['terminal_results_valid'],
          resultAssetIds: refreshedCandidates.candidateIds, resultDigest: refreshedSafe.resultDigest,
          patch: { taskStatus: admissionTaskStatus, resultAdmission: 'ADMITTED' }, views: refreshedSafe.views,
        })
        decisions.push(persisted.decision)
      }
      return { decisions }
    },
  })
}
