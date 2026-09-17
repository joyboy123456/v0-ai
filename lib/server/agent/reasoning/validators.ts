import { z } from 'zod'
import { AGENT_BUDGET, PREVIEW_TTL_MS } from '@/lib/agent/budget'
import { canonicalize, digest, paramsDigest, requestDigest } from '@/lib/agent/contracts'
import type { PreviewArtifact, RetryPreviewArtifact } from '@/lib/agent/contracts'
import { isFieldOriginAllowed, type FieldOrigin, type GovernedField } from '@/lib/agent/provenance'
import type { AgentPlanDraft, AgentToolMeta, JsonValue } from '@/lib/agent/types'
import { SELECTABLE_FASHION_MODELS } from '@/lib/types'
import type { StoredPreparationReference } from '../action/task-preparation'

export const PLAN_VALIDATOR_VERSION = 'agent-plan-validator-v1'
const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/)
const strings = z.array(z.string().min(1).max(256)).max(64)
export const agentPlanDraftSchema = z.object({
  kind: z.enum(['clarify', 'plan']), content: z.string().trim().min(1).max(8000),
  claims: z.array(z.object({
    id: identifier, kind: z.enum(['observe', 'derive', 'verify', 'decide']),
    claim: z.string().trim().min(1).max(1000), dependsOn: z.array(identifier).max(64),
    evidenceRefs: strings, validator: identifier.optional(),
    status: z.enum(['draft', 'passed', 'failed', 'needs_review']),
  }).strict()).max(64),
  proposedToolCalls: z.array(z.object({ tool: identifier,
    // 保留所有数据键交后续准入检查，避免 record 解析器忽略 __proto__ 等恶意键。
    args: z.custom<Record<string, unknown>>((value) => value !== null && typeof value === 'object' && !Array.isArray(value)),
    dryRun: z.literal(true),
  }).strict()).max(16),
  blockers: strings,
}).strict()

/** 只解析业务命题；未声明字段（包括思维链、审批凭证）直接拒绝。 */
export function parseAgentPlanDraft(input: unknown): AgentPlanDraft {
  try { return agentPlanDraftSchema.parse(JSON.parse(canonicalize(input))) }
  catch { throw new TypeError('invalid_agent_plan') }
}

type Claim = AgentPlanDraft['claims'][number]
type Outcome = Exclude<Claim['status'], 'draft'>
export interface PlanValidationIssue { code: string; claimId?: string; toolCallIndex?: number }

/** 由服务端查询结果投影而来；不得把模型 evidence 对象或文本直接强转成此类型。 */
export interface PlanEvidence {
  ref: string
  userId: string
  sessionId: string
  /** 受信任适配器对事实生成的原子断言；验证器仅接受逐字相等的命题。 */
  assertion: string
  claimKind: Claim['kind']
  kind: 'fact' | 'observation' | 'control' | 'preview' | 'handle'
  origin: FieldOrigin
  observedAt: string
  expiresAt: string
  assetId?: string
  assetDigest?: string
  field?: GovernedField
  value?: JsonValue
}

export interface PlanPreviewBinding {
  ref: string
  reference: StoredPreparationReference
  candidate: PreviewArtifact | RetryPreviewArtifact
}

export interface PlanToolBinding {
  callIndex: number
  args: Record<string, JsonValue>
  origins: Record<string, FieldOrigin>
}

/** 无查询/供应商/审批端口。身份、当前时间、素材与控制值均由服务端调用者绑定。 */
export interface PlanValidationContext {
  userId: string
  sessionId: string
  messageId: string
  now: string
  evidence: readonly PlanEvidence[]
  assets: readonly { assetId: string; assetDigest: string }[]
  controls: Partial<Record<GovernedField, { value: JsonValue; origin: FieldOrigin }>>
  tools: readonly AgentToolMeta[]
  toolBindings?: readonly PlanToolBinding[]
  previews?: readonly PlanPreviewBinding[]
}

export interface PlanValidationResult {
  version: typeof PLAN_VALIDATOR_VERSION
  plan: AgentPlanDraft
  issues: PlanValidationIssue[]
  /** 仅表示业务计划的确定性检查完成，永远不代表用户批准或可直接执行。 */
  status: 'passed' | 'failed' | 'needs_review'
  authorization: 'not_granted'
}

interface ValidatorInput { claim: Claim; evidence: PlanEvidence[]; context: PlanValidationContext }
interface ValidatorResult { status: Outcome; codes: string[] }
type Validator = (input: ValidatorInput) => Promise<ValidatorResult> | ValidatorResult
const fail = (...codes: string[]): ValidatorResult => ({ status: 'failed', codes })
const review = (...codes: string[]): ValidatorResult => ({ status: 'needs_review', codes })
const pass = (): ValidatorResult => ({ status: 'passed', codes: [] })

/** 保守语法门：它不声称解决自然语言原子性；复杂/含歧义命题交人审或拆分。 */
export function isCompositeClaim(text: string): boolean {
  const withoutTerminal = text.trim().replace(/[。.!！?？]$/, '')
  return /[。!?！？;；，,：\n]|\.(?:\s|$)|并且|而且|同时|以及|且|并|和|及|与|或者|或是|然后|因此|所以|故而|从而|既.+又|不仅|既然|因为|\b(?:and|or|but|then|therefore|because|also)\b/i.test(withoutTerminal)
}

function assertsAuthority(text: string): boolean {
  return /(?:已|已经|无需|不需|免|跳过).{0,8}(?:批准|审批|授权|确认|验证|校验)|(?:批准|审批|授权|验证|校验).{0,8}(?:通过|成功|完成)|\b(?:approved|authorized|verified|validated|skip\s+approval)\b/i.test(text)
}

function evidenceValidator({ claim, evidence }: ValidatorInput): ValidatorResult {
  if (!evidence.length) return review('evidence_required')
  if (claim.kind === 'decide') return review('decision_requires_review')
  if (evidence.some((item) => item.kind !== 'fact' && item.kind !== 'observation')) return fail('evidence_kind_mismatch')
  if (evidence.some((item) => item.kind === 'observation' || item.origin === 'image_observation' || item.origin === 'model_inference')) {
    return review('observation_is_weak_signal')
  }
  if (evidence.some((item) => item.origin !== 'system_policy' && item.origin !== 'provider_response')) return review('unverified_fact_source')
  return pass()
}

function controlValidator({ evidence, context }: ValidatorInput): ValidatorResult {
  if (!evidence.length) return review('evidence_required')
  for (const item of evidence) {
    if (item.kind !== 'control' || !item.field || item.value === undefined
      || !isFieldOriginAllowed(item.field, item.origin)) return fail('control_origin_forbidden')
    const bound = context.controls[item.field]
    if (!bound || !isFieldOriginAllowed(item.field, bound.origin)
      || bound.origin !== item.origin || canonicalize(bound.value) !== canonicalize(item.value)) return fail('control_value_mismatch')
  }
  return pass()
}

async function checkPreview(binding: PlanPreviewBinding, context: PlanValidationContext): Promise<ValidatorResult> {
  const { reference, candidate } = binding
  try {
    if (reference.schemaVersion !== 1 || await digest({
      schemaVersion: 1, key: reference.key, kind: reference.kind, inputDigest: reference.inputDigest,
      requestDigest: reference.requestDigest, inputAssetIds: reference.inputAssetIds,
      sourceTaskId: reference.sourceTaskId, sourceTaskStateDigest: reference.sourceTaskStateDigest,
    }) !== reference.referenceDigest) return fail('preview_reference_digest_mismatch')
    if (canonicalize(candidate) !== canonicalize(reference.artifact)) return fail('preview_changed')
    const preview = candidate
    if (preview.userId !== context.userId || preview.sessionId !== context.sessionId
      || preview.messageId !== context.messageId) return fail('preview_scope_mismatch')
    const now = Date.parse(context.now), created = Date.parse(preview.createdAt), expires = Date.parse(preview.expiresAt)
    if (![created, expires].every(Number.isFinite) || created > now || expires <= now
      || expires - created !== PREVIEW_TTL_MS) return fail('preview_expired')
    if (preview.schemaVersion !== 1 || !Number.isSafeInteger(preview.version) || preview.version < 1
      || !preview.policyVersion || !preview.promptTemplateVersion
      || !SELECTABLE_FASHION_MODELS.some((model) => model.id === preview.resolvedModelId && model.provider === 'grsai')) return fail('preview_controls_invalid')
    if (!reference.inputAssetIds.length || reference.inputAssetIds.length !== preview.assetDigests.length
      || new Set(reference.inputAssetIds).size !== reference.inputAssetIds.length
      || reference.inputAssetIds.some((assetId, index) => !context.assets.some((asset) => asset.assetId === assetId && asset.assetDigest === preview.assetDigests[index]))) return fail('preview_assets_changed')
    const expectedFeature = ({ 'fashion_photo.create': 'ai-fashion-photo', 'photo_fission.create': 'photo-fission',
      'pose_fission.create': 'pose-fission', 'garment_detail.create': 'garment-detail' } as Record<string, string>)[preview.toolName]
    if (reference.kind === 'generate') {
      const generated = candidate as PreviewArtifact
      if (expectedFeature !== preview.featureType || !generated.normalizationSeed
        || canonicalize(generated.inputAssetIds) !== canonicalize(reference.inputAssetIds)
        || reference.sourceTaskId !== null || reference.sourceTaskStateDigest !== null) return fail('preview_controls_invalid')
      if (await paramsDigest(generated.featureType, generated.normalizedParams) !== generated.paramsDigest) return fail('preview_params_digest_mismatch')
      if (await requestDigest({ actionKind: 'generate', payload: generated }) !== reference.requestDigest) return fail('preview_request_digest_mismatch')
    } else if (reference.kind === 'retry_shots') {
      const retry = candidate as RetryPreviewArtifact
      if (retry.toolName !== 'task.retry_shots' || retry.taskId !== reference.sourceTaskId || !reference.sourceTaskStateDigest
        || !Array.isArray(retry.shotIds) || retry.shotIds.length === 0 || new Set(retry.shotIds).size !== retry.shotIds.length
        || retry.estimatedResultCount !== retry.shotIds.length || !Number.isSafeInteger(retry.attempt) || retry.attempt < 1) return fail('preview_controls_invalid')
      if (await requestDigest({ actionKind: 'retry_shots', payload: retry }) !== reference.requestDigest) return fail('preview_request_digest_mismatch')
    } else return fail('preview_controls_invalid')
    if (!Number.isSafeInteger(preview.estimatedResultCount) || preview.estimatedResultCount < 1) return fail('preview_controls_invalid')
    const blockers = [...preview.blockers]
    if (preview.estimatedResultCount > AGENT_BUDGET.maxResultsPerApproval) blockers.push('decision_gate:multiple_results_not_enabled')
    if (reference.kind === 'generate' && preview.featureType === 'pose-fission') blockers.push('decision_gate:pose_prompt_not_supported')
    return blockers.length ? fail(...new Set(blockers)) : pass()
  } catch { return fail('preview_invalid') }
}

async function previewValidator({ claim, evidence, context }: ValidatorInput): Promise<ValidatorResult> {
  if (claim.kind !== 'verify') return fail('preview_claim_kind_invalid')
  if (!evidence.length) return review('evidence_required')
  for (const item of evidence) {
    if (item.kind !== 'preview' || item.origin !== 'system_policy') return fail('evidence_kind_mismatch')
    const bindings = context.previews?.filter((preview) => preview.ref === item.ref) ?? []
    if (bindings.length !== 1) return fail('preview_reference_missing')
    const result = await checkPreview(bindings[0], context)
    if (result.status !== 'passed') return result
  }
  return pass()
}

/** 封闭注册表：模型只能选择已有校验名称，不能提供代码、回调或自定义通过结果。 */
export const PLAN_VALIDATOR_REGISTRY: Readonly<Record<string, Validator>> = Object.freeze({
  'evidence.matches': evidenceValidator,
  'control.matches': controlValidator,
  'preview.integrity': previewValidator,
})

function validateTools(plan: AgentPlanDraft, context: PlanValidationContext): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  plan.proposedToolCalls.forEach((call, toolCallIndex) => {
    const reject = (code: string) => issues.push({ code, toolCallIndex })
    const tools = context.tools.filter((item) => item.name === call.tool)
    if (tools.length !== 1) { reject('unknown_tool'); return }
    const args = call.args
    if (!args || typeof args !== 'object' || Array.isArray(args)) { reject('invalid_tool_args'); return }
    // C5 原始提案只允许模型写 prompt；选择/身份/审批/摘要必须由服务端绑定。
    if (Object.entries(args).some(([key, value]) => key !== 'prompt' || typeof value !== 'string'
      || !isFieldOriginAllowed(key, 'model_inference'))) { reject('model_control_field_forbidden'); return }
    const bindings = context.toolBindings?.filter((item) => item.callIndex === toolCallIndex) ?? []
    if (bindings.length > 1) { reject('duplicate_tool_binding'); return }
    const binding = bindings[0]
    if (binding && Object.keys(binding.args).some((key) => Object.hasOwn(args, key)
      || !binding.origins[key] || !isFieldOriginAllowed(key, binding.origins[key]))) { reject('tool_binding_invalid'); return }
    try {
      const combined = JSON.parse(canonicalize({ ...args, ...binding?.args }))
      const parsed = tools[0].inputSchema.parse(combined)
      if (canonicalize(parsed) !== canonicalize(combined)) reject('tool_schema_invalid')
    } catch { reject('tool_schema_invalid') }
  })
  return issues
}

/** 纯确定性验证：不存思维链，不授权，不执行工具；所有模型 status 均被丢弃后重算。 */
export async function validateAgentPlanDraft(input: unknown, inputContext: PlanValidationContext): Promise<PlanValidationResult> {
  const plan = parseAgentPlanDraft(input)
  // 先复制纯数据，摘要计算期间调用者再修改对象也不能改变本次验证事实。
  const { tools, ...data } = inputContext
  const context: PlanValidationContext = { ...JSON.parse(canonicalize(data)), tools }
  if (!context.userId || !context.sessionId || !context.messageId || !Number.isFinite(Date.parse(context.now))) throw new TypeError('invalid_plan_context')
  const issues = validateTools(plan, context)
  if (assertsAuthority(plan.content)) issues.push({ code: 'authority_content_forbidden' })
  // 已提供的冻结工件始终检查；模型删除 verify 命题不能隐藏决策 blocker。
  const previewRefs = new Set<string>()
  for (const preview of context.previews ?? []) {
    if (previewRefs.has(preview.ref)) issues.push({ code: 'duplicate_preview_reference' })
    previewRefs.add(preview.ref)
    const result = await checkPreview(preview, context)
    issues.push(...result.codes.map((code) => ({ code })))
  }
  const counts = new Map<string, number>()
  for (const claim of plan.claims) counts.set(claim.id, (counts.get(claim.id) ?? 0) + 1)
  const byId = new Map(plan.claims.map((claim) => [claim.id, claim]))
  const results = new Map<Claim, ValidatorResult>()
  for (const claim of plan.claims) {
    claim.status = 'draft'
    const codes: string[] = []
    if (counts.get(claim.id)! > 1) codes.push('duplicate_claim_id')
    if (isCompositeClaim(claim.claim)) codes.push('composite_claim')
    if (assertsAuthority(claim.claim)) codes.push('authority_claim_forbidden')
    if (new Set(claim.dependsOn).size !== claim.dependsOn.length) codes.push('duplicate_dependency')
    if (claim.dependsOn.includes(claim.id)) codes.push('self_dependency')
    if (claim.dependsOn.some((id) => !byId.has(id))) codes.push('missing_dependency')
    if (new Set(claim.evidenceRefs).size !== claim.evidenceRefs.length) codes.push('duplicate_evidence_ref')
    const evidence: PlanEvidence[] = []
    for (const ref of claim.evidenceRefs) {
      const matches = context.evidence.filter((item) => item.ref === ref)
      if (matches.length !== 1) { codes.push('evidence_not_found'); continue }
      const item = matches[0]
      if (item.userId !== context.userId || item.sessionId !== context.sessionId) codes.push('evidence_scope_mismatch')
      const at = Date.parse(item.observedAt), expires = Date.parse(item.expiresAt), now = Date.parse(context.now)
      if (![at, expires].every(Number.isFinite) || at > now || expires <= now || expires <= at) codes.push('evidence_stale')
      if (item.kind === 'handle') codes.push('evidence_not_resolved')
      if (item.assetId && (!item.assetDigest || !context.assets.some((asset) => asset.assetId === item.assetId && asset.assetDigest === item.assetDigest))) codes.push('evidence_asset_changed')
      if (!item.assetId && item.assetDigest) codes.push('evidence_asset_changed')
      if (item.assertion !== claim.claim || item.claimKind !== claim.kind) codes.push('evidence_assertion_mismatch')
      evidence.push(item)
    }
    if (codes.length) results.set(claim, fail(...codes))
    else if (!claim.validator) results.set(claim, review('validator_required'))
    else if (!Object.hasOwn(PLAN_VALIDATOR_REGISTRY, claim.validator)) results.set(claim, fail('unknown_validator'))
    else results.set(claim, await PLAN_VALIDATOR_REGISTRY[claim.validator]({ claim, evidence, context }))
  }
  const visiting = new Set<Claim>(), visited = new Set<Claim>()
  function visit(claim: Claim): void {
    if (visited.has(claim)) return
    if (visiting.has(claim)) { results.set(claim, fail(...results.get(claim)!.codes, 'cyclic_dependency')); return }
    visiting.add(claim)
    for (const id of claim.dependsOn) { const dependency = byId.get(id); if (dependency) visit(dependency) }
    visiting.delete(claim)
    const dependencies = claim.dependsOn.map((id) => byId.get(id)).filter((item): item is Claim => !!item)
    if (dependencies.some((item) => results.get(item)?.status === 'failed')) results.set(claim, fail(...results.get(claim)!.codes, 'dependency_failed'))
    else if (results.get(claim)!.status === 'passed' && dependencies.some((item) => results.get(item)?.status !== 'passed')) results.set(claim, review('dependency_needs_review'))
    visited.add(claim)
  }
  for (const claim of plan.claims) visit(claim)
  // 循环尾部或乱序共享依赖也必须传播至固定点；最多 64 个命题。
  for (let index = 0; index < plan.claims.length; index++) {
    let changed = false
    for (const claim of plan.claims) {
      if (results.get(claim)!.status !== 'failed' && claim.dependsOn.some((id) => results.get(byId.get(id)!)?.status === 'failed')) {
        results.set(claim, fail('dependency_failed')); changed = true
      }
    }
    if (!changed) break
  }
  for (const claim of plan.claims) {
    const result = results.get(claim)!
    claim.status = result.status
    issues.push(...[...new Set(result.codes)].map((code) => ({ code, claimId: claim.id })))
  }
  plan.blockers = [...new Set([...plan.blockers, ...issues.map((issue) => issue.code)])]
  const failed = issues.some((issue) => issue.claimId === undefined) || plan.claims.some((claim) => claim.status === 'failed')
  const status = failed ? 'failed' : plan.blockers.length || !plan.claims.length || plan.claims.some((claim) => claim.status !== 'passed') ? 'needs_review' : 'passed'
  return { version: PLAN_VALIDATOR_VERSION, plan, issues, status, authorization: 'not_granted' }
}
