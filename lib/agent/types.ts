import type { ClothCategory, FeatureType } from '@/lib/types'

/** 只描述 JSON 数据；模型可见内容不得包含凭据、函数或原始思维链。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** 注册表由服务端写入，模型只能选择已开放的工具名。 */
export type CostClass = 'free' | 'vendor_api' | 'paid_generation'
export type SideEffectClass = 'none' | 'local_write' | 'external_reversible' | 'external_irreversible'
export type ApprovalPolicy = 'none' | 'explicit_user_intent' | 'preview_confirmation' | 'always'

/** schema 由注册表提供；parse 实现必须严格拒绝额外字段。 */
export interface AgentToolMeta {
  name: string
  featureType?: FeatureType
  description: string
  whenToUse: string
  whenNotToUse: string[]
  inputSchema: { parse(value: unknown): unknown }
  readOnly: boolean
  costClass: CostClass
  sideEffectClass: SideEffectClass
  approvalPolicy: ApprovalPolicy
  requiresFreshState: boolean
  quotaPerTurn: number
  rollbackCapability: 'none' | 'cancel_before_provider_accept' | 'local_polling_only' | 'irreversible_after_submit'
}

/** 感知模块写入、规划模块读取；观察只能影响 prompt，不能用作权限或控制参数真值。 */
export interface GarmentObservation {
  assetId: string
  assetDigest: string
  observedAt: string
  observerModel: string
  origin: 'image_observation'
  subject: 'garment_flat' | 'garment_on_model' | 'person' | 'detail_shot' | 'other' | 'unknown'
  category: ClothCategory | 'dress' | 'suit' | 'accessory' | 'unknown'
  dominantColors: string[]
  silhouette: string
  keyDetails: string[]
  hasVisibleText: boolean
  hasFace: boolean
  quality: { blurry: boolean; lowResolution: boolean; watermark: boolean }
  confidence: number
  notes: string
}

/** 确定性路由器写入，模型不能改写 lane 或预算以扩大能力。 */
export interface AgentRouteDecision {
  routerVersion: string
  intent: 'ask' | 'edit' | 'plan' | 'generate' | 'review' | 'retry' | 'unknown'
  evidenceState: 'ready' | 'missing' | 'stale' | 'conflict' | 'unknown'
  mechanicalReady: boolean
  risk: 'read_only' | 'draft' | 'write_reversible'
  costClass: 'free_text' | 'vendor_api' | 'paid_generation' | 'paid_regeneration'
  lane: 'direct_answer' | 'read_only_analysis' | 'structured_decision' | 'plan_execute' | 'clarify_human_review'
  reasoningMode: 'direct' | 'cot' | 'parallel' | 'iterative'
  humanGate: 'none' | 'before_plan_confirm' | 'before_generation' | 'always'
  budget: { maxModelCalls: number; maxToolCalls: number; maxLatencyMs: number }
  routeReason: string
  blockers: string[]
}

/** 模型提出的结构化业务命题；status 必须由确定性校验器重算，不存思维链。 */
export interface AgentPlanDraft {
  kind: 'clarify' | 'plan'
  content: string
  claims: Array<{
    id: string
    kind: 'observe' | 'derive' | 'verify' | 'decide'
    claim: string
    dependsOn: string[]
    evidenceRefs: string[]
    validator?: string
    status: 'draft' | 'passed' | 'failed' | 'needs_review'
  }>
  proposedToolCalls: Array<{ tool: string; args: unknown; dryRun: true }>
  blockers: string[]
}

/** 用户目标由服务端版本化；v1 只保留结构，不启用多步执行。 */
export interface GoalContract {
  goalId: string
  userGoal: string
  successCriteria: string[]
  nonGoals: string[]
  constraints: string[]
  version: number
}

/** 服务端写入的稳定步骤身份；模型提案不能覆盖已成功的步骤。 */
export interface AgentPlanStep {
  stepId: string
  featureType?: FeatureType
  toolName: string
  deps: string[]
  inputAssetRefs: string[]
  paramsDigest: string
  idempotencyKey: string
  requiresHuman: boolean
  status: 'TODO' | 'BLOCKED' | 'AWAITING_APPROVAL' | 'SUBMITTED' | 'WAITING_PROVIDER'
    | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'UNKNOWN' | 'VERIFYING'
  taskId?: string
  planVersion: number
}
