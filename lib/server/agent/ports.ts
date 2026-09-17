import type { AssetRecord, GarmentDetailCategory, GenerationTask } from '@/lib/types'
import type { ApprovalReceipt, ActionLedgerRecord, CancelPayload, ClassifyPayload, CutoutPreparePayload,
  GovernedAction, PreviewArtifact, ResultAdmission, RetryPreviewArtifact } from '@/lib/agent/contracts'
import type { AgentPlanDraft, JsonValue } from '@/lib/agent/types'

/** 只读任务能力；调用方必须验证 taskId 与 userId，缺失不代表从未提交。 */
export interface TaskQueryPort {
  getTask(taskId: string): Promise<GenerationTask | undefined>
}

/** 只读资产能力；资产观察和结果准入必须重查归属。 */
export interface AssetQueryPort {
  getAsset(assetId: string): Promise<AssetRecord | undefined>
}

/** 组合根从当前可信会话提取成员关系；不接受模型提供的节点或 taskIds。 */
export interface SessionQueryRecord {
  sessionId: string
  userId: string
  nodes: Array<{ id: string; assetId: string; name: string; taskId?: string }>
  taskIds?: string[]
}

/** 只读会话能力；调用方仍须检查返回身份和资源当前归属。 */
export interface SessionQueryPort {
  getSession(sessionId: string): Promise<SessionQueryRecord | undefined>
}

/** 只读工具唯一依赖；观察 adapter 只能读取 B1 缓存，不得在 miss 时计算或调用供应商。 */
export interface QueryPort extends AssetQueryPort, TaskQueryPort, SessionQueryPort {
  getObservation?(scope: { userId: string; assetId: string; observerVersion: string }): Promise<{
    observerVersion: string
    observation: import('@/lib/agent/types').GarmentObservation
  } | null>
}

/** dry-run 输入可以受模型影响；服务端准备器必须重新绑定控制字段。 */
export interface UntrustedTaskProposal {
  toolName: string
  args: unknown
}

/** 身份、素材与模型选择来自服务端验证后的会话，不接受模型回填。 */
export interface PreparationContext {
  userId: string
  sessionId: string
  messageId: string
  proposalId: string
  version: number
  selectedAssetIds: string[]
  settings: JsonValue
}

/** 仅准备冻结预览，禁止创建任务或消耗图片额度。 */
export interface TaskPreparationPort {
  prepare(input: UntrustedTaskProposal, context: PreparationContext): Promise<PreviewArtifact>
  validatePrepared(preview: PreviewArtifact): Promise<void>
}

/** 仅治理层可持有；composition root 负责注入，不可交给 turn/action/reasoning。 */
export interface TaskCommandPort {
  createPreparedTask(preview: PreviewArtifact, idempotencyKey: string): Promise<GenerationTask>
  retryPreparedShots(preview: RetryPreviewArtifact, idempotencyKey: string): Promise<GenerationTask>
  cancelTask(taskId: string, userId: string): Promise<GenerationTask>
}

/** 分类可降级；不将供应商异常伪装成业务分类真值。 */
export interface ClassificationResult {
  status: 'classified' | 'fallback'
  assetId: string
  category: GarmentDetailCategory | null
  confidence: number | null
}

/** 抠图返回已有会话引用，图像由同源代理输出。 */
export interface CutoutPreparationResult {
  cutoutSessionId: string
  preparedImageUrl: string
}

/** 有供应商副作用的非生成命令同样仅交治理层。 */
export interface VendorActionPort {
  classify(payload: ClassifyPayload): Promise<ClassificationResult>
  prepareCutout(payload: CutoutPreparePayload): Promise<CutoutPreparationResult>
}

/** 动作结果按动作区分；任务提交响应不是最终结果准入。 */
export type GovernedActionResult =
  | { actionKind: 'generate' | 'retry_shots'; task: GenerationTask }
  | { actionKind: 'classify'; result: ClassificationResult }
  | { actionKind: 'cutout_prepare'; result: CutoutPreparationResult }
  | { actionKind: 'cancel'; task: GenerationTask; intent: CancelPayload['intent'] }

/** 仅消费已验证工件；付费动作需要服务端审批，其他动作使用冻结意图凭证。 */
export interface GovernedActionPort {
  execute(action: GovernedAction, approval?: ApprovalReceipt): Promise<GovernedActionResult>
}

export type PaidGovernedAction = Extract<GovernedAction, { actionKind: 'generate' | 'retry_shots' }>

/** TOOL 返回后同步核对任务；实现必须先强写C8证据，调用方再更新 ActionLedger。 */
export interface PostSubmitPort {
  postSubmit(input: {
    action: PaidGovernedAction
    key: string
    expectedTaskId: string
    approvalDigest: string
    task: GenerationTask
  }): Promise<{
    outcome: 'accepted' | 'blocked'
    taskStatus?: GenerationTask['status']
    confirmedTask: boolean
    evidenceRef: string
    reasonCodes: string[]
  }>
}

/** 结果准入返回的唯一可发布视图；URL和尺寸来自本次已鉴权 AssetRecord。 */
export interface AdmittedResultView {
  assetId: string
  taskId: string
  shotId?: string
  label?: string
  fileName: string
  url: string
  downloadUrl: string
  width: number
  height: number
}

/** 仅由 C8 的 ADMITTED 结果证据签发；E1 必须拒绝没有该绑定的结果。 */
export interface C8AdmittedResultEvidence {
  evidenceRef: string
  resultDigest: string
}

export interface ResultAdmissionDecision {
  key: string
  messageId: string
  taskId: string
  taskStatus?: GenerationTask['status']
  resultAdmission: ResultAdmission
  results: AdmittedResultView[]
  /** 仅在本次 decision 是 C8 ADMITTED 且结果摘要已强写时存在。 */
  c8Evidence?: C8AdmittedResultEvidence
}

/** 调用方已持有 ActionLedger 锁；实现不得再次获取同一本账的锁。 */
export interface LockedResultAdmissionLedger {
  readonly entries: ActionLedgerRecord[]
  save(): Promise<void>
}

/** 仅由已鉴权服务端会话适配器调用；不接受模型或客户端提供的 approval/status。 */
export interface ResultAdmissionPort {
  admitResults(
    scope: { userId: string; sessionId: string },
    ledger: LockedResultAdmissionLedger,
  ): Promise<{ decisions: ResultAdmissionDecision[] }>
}

/** E1 与 C8 安全状态分离的质量轴；本版本只有 shadow 语义。 */
export type ShadowReviewDisposition =
  | 'UNREVIEWED'
  | 'SHADOW_PASS'
  | 'SHADOW_WOULD_WARN'
  | 'SHADOW_WOULD_BLOCK'

/**
 * C8 在已持 ActionLedger 锁时冻结的输入凭证。它不是客户端协议；
 * reviewRef 必须包含该绑定，避免陈旧 action/retry/结果窗口混为同一张评审收据。
 */
export interface ResultReviewC8Admission {
  userId: string
  sessionId: string
  messageId: string
  taskId: string
  actionKey: string
  actionKind: 'generate' | 'retry_shots'
  requestDigest: string
  approvalDigest: string
  evidenceRef: string
  resultDigest: string
}

/** 只能由服务端从本次 C8 ADMITTED 安全视图和证据投影，不能接受客户端或模型构造。 */
export interface ResultReviewCandidate {
  assetId: string
  taskId: string
  fileName: string
  width: number
  height: number
  c8: ResultReviewC8Admission
}

export interface ResultReviewDecision {
  assetId: string
  taskId: string
  assetDigest: string
  reviewRef: string
  disposition: ShadowReviewDisposition
  issueCodes: string[]
  /** true 表示复用不可变资产的既有评审，或复用同一 admission receipt。 */
  reused: boolean
}

/** 只读影子评审端口；不得持有任务命令、供应商、计费或自动重试能力。 */
export interface ResultReviewPort {
  reviewAdmittedResults(
    scope: { userId: string; sessionId: string },
    results: readonly ResultReviewCandidate[],
  ): Promise<{ decisions: ResultReviewDecision[] }>
}

/** C9 模型端口只接收已由 A2 强写并重建的模型可见快照；传输凭据不属于端口参数。 */
export interface AgentModelPort {
  invoke(request: import('./observability/event-store').ModelRequestSnapshot): Promise<JsonValue>
}

/** 规划端口无命令能力；调用前由 observability 持久化模型可见请求。 */
export interface PlannerPort {
  plan(request: JsonValue): Promise<AgentPlanDraft>
}
