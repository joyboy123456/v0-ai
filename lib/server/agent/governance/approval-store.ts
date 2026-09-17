import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  approvalDigest as computeApprovalDigest, canonicalize, requestDigest,
  type ApprovalReceipt, type GovernedAction, type UserIntentReceipt,
} from '@/lib/agent/contracts'
import type { ClassificationResult, CutoutPreparationResult, PaidGovernedAction } from '../ports'
import type { TaskPreparationWithRetryPort } from '../action/task-preparation'
import { DurableGovernanceTable, preparationArtifactKey, type CurrentTaskPreparationArtifactStorePort } from './preparation-artifact-store'

export interface AuthenticatedActionScope { userId: string; sessionId: string; messageId: string }
export type AuthenticatedUserIntent = Pick<UserIntentReceipt, 'actionKind' | 'targetId'>
export interface ApprovalStoreDependencies {
  /** 只由已鉴权路由/组合根注入；不得从模型参数或客户端 receipt 中返回身份。 */
  authenticate: () => Promise<AuthenticatedActionScope>
  /** 从当前已认证 HTTP 用户请求取得明确意图；未获授权应抛错，不接收模型布尔值。 */
  readAuthenticatedIntent: () => Promise<AuthenticatedUserIntent>
  artifacts: CurrentTaskPreparationArtifactStorePort
  preparation: TaskPreparationWithRetryPort
  now?: () => Date
}

const text = z.string().min(1).max(256)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = z.string().datetime()
const scopeSchema = z.object({ userId: text, sessionId: text, messageId: text }).strict()
const confirmationSchema = z.object({ proposalId: text, version: z.number().int().positive().safe(), paramsDigest: hash }).strict()
const approvalSchema = z.object({
  schemaVersion: z.literal(1), approvalId: text, userId: text, proposalId: text,
  previewVersion: z.number().int().positive().safe(), paramsDigest: hash, assetDigests: z.array(hash),
  requestDigest: hash, approvedAt: timestamp,
}).strict()
const intentSchema = z.object({
  schemaVersion: z.literal(1), intentId: text, ...scopeSchema.shape,
  actionKind: z.enum(['classify', 'cutout_prepare', 'cancel']), targetId: text, verifiedAt: timestamp,
}).strict()
const classificationSchema = z.object({
  status: z.enum(['classified', 'fallback']), assetId: text,
  category: z.enum(['tops', 'bottoms', 'dress', 'accessory', 'shoes-bags']).nullable(),
  confidence: z.number().finite().min(0).max(1).nullable(),
}).strict().superRefine((result, context) => {
  if ((result.status === 'classified' && (result.category === null || result.confidence === null))
    || (result.status === 'fallback' && (result.category !== null || result.confidence !== null))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '分类状态与证据不一致' })
  }
})
const cutoutSchema = z.object({
  cutoutSessionId: text.regex(/^[a-zA-Z0-9_-]+$/),
  preparedImageUrl: z.string().regex(/^\/api\/cutout-sessions\/[^/?#]+\/image(?:\?[^#]*)?$/),
}).strict().superRefine((result, context) => {
  if (result.preparedImageUrl.split('/')[3] !== encodeURIComponent(result.cutoutSessionId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '抠图代理地址与会话不一致' })
  }
})
const vendorResultSchema = z.discriminatedUnion('actionKind', [
  z.object({ actionKind: z.literal('classify'), result: classificationSchema }).strict(),
  z.object({ actionKind: z.literal('cutout_prepare'), result: cutoutSchema }).strict(),
])
export type StoredVendorResult =
  | { actionKind: 'classify'; result: ClassificationResult }
  | { actionKind: 'cutout_prepare'; result: CutoutPreparationResult }

const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approval'), id: text, receipt: approvalSchema }).strict(),
  z.object({ kind: z.literal('intent'), id: text, receipt: intentSchema }).strict(),
  z.object({ kind: z.literal('vendor_result'), id: z.string().min(1), userId: text,
    requestDigest: hash, response: vendorResultSchema }).strict(),
])
type Entry = z.infer<typeof entrySchema>

export function validateVendorResult(value: unknown): StoredVendorResult {
  return vendorResultSchema.parse(JSON.parse(canonicalize(value)))
}

/** C8 只读历史证据端口：核验已落盘原件，不签发审批，也不检查当前预览或 TTL。 */
export interface ApprovalEvidenceStorePort {
  verifyHistoricalApproval(action: PaidGovernedAction, expectedApprovalDigest: string): Promise<ApprovalReceipt>
}

async function verifyHistoricalApprovalFromTable(
  table: DurableGovernanceTable<Entry>,
  action: PaidGovernedAction,
  expectedApprovalDigest: string,
): Promise<ApprovalReceipt> {
  const expected = hash.parse(expectedApprovalDigest)
  const fullDigest = await requestDigest(action)
  return table.transaction(async (entries) => {
    const approvals = entries.filter((entry): entry is Extract<Entry, { kind: 'approval' }> => entry.kind === 'approval')
    const matches: Array<Extract<Entry, { kind: 'approval' }>> = []
    for (const entry of approvals) {
      if (await computeApprovalDigest(entry.receipt) === expected) matches.push(entry)
    }
    if (matches.length !== 1) throw new Error('approval_evidence_not_found')
    const candidate = matches[0].receipt
    const preview = action.payload
    if (candidate.userId !== preview.userId
      || candidate.proposalId !== preview.proposalId
      || candidate.previewVersion !== preview.version
      || candidate.paramsDigest !== preview.paramsDigest
      || canonicalize(candidate.assetDigests) !== canonicalize(preview.assetDigests)
      || candidate.requestDigest !== fullDigest) {
      throw new Error('approval_evidence_mismatch')
    }
    return approvalSchema.parse(JSON.parse(canonicalize(candidate)))
  })
}

/** 无签发能力的审批历史视图，供结果准入按原 proposal/version 核验。 */
export class ApprovalEvidenceStore implements ApprovalEvidenceStorePort {
  private readonly table: DurableGovernanceTable<Entry>
  constructor(directory: string) {
    this.table = new DurableGovernanceTable(directory, 'approvals.json', async (value) => entrySchema.parse(value))
  }
  verifyHistoricalApproval(action: PaidGovernedAction, expectedApprovalDigest: string): Promise<ApprovalReceipt> {
    return verifyHistoricalApprovalFromTable(this.table, action, expectedApprovalDigest)
  }
}

export function createApprovalEvidenceStore(directory: string): ApprovalEvidenceStorePort {
  return new ApprovalEvidenceStore(directory)
}

/** 只有服务端签发接口可写回执；execute 提交的回执必须与持久化原件逐字一致。 */
export class ApprovalStore implements ApprovalEvidenceStorePort {
  private readonly table: DurableGovernanceTable<Entry>
  private readonly now: () => Date
  constructor(directory: string, private readonly dependencies: ApprovalStoreDependencies) {
    this.table = new DurableGovernanceTable(directory, 'approvals.json', async (value) => entrySchema.parse(value))
    this.now = dependencies.now ?? (() => new Date())
  }

  async issueApproval(clientInput: unknown): Promise<ApprovalReceipt> {
    const input = confirmationSchema.parse(JSON.parse(canonicalize(clientInput)))
    const scope = scopeSchema.parse(await this.dependencies.authenticate())
    const reference = await this.dependencies.artifacts.get(preparationArtifactKey(scope.userId, input.proposalId, input.version))
    if (!reference) throw new Error('approval_missing_preview: 找不到服务端预览')
    const latest = await this.dependencies.artifacts.getLatest(scope.userId, input.proposalId)
    if (!latest || latest.artifact.version !== input.version) throw new Error('preview_superseded: 预览已有更新版本')
    const preview = reference.artifact
    if (preview.userId !== scope.userId || preview.sessionId !== scope.sessionId || preview.messageId !== scope.messageId
      || preview.proposalId !== input.proposalId || preview.version !== input.version || preview.paramsDigest !== input.paramsDigest) {
      throw new Error('approval_scope_mismatch: 确认身份或摘要不一致')
    }
    if (reference.kind === 'generate') await this.dependencies.preparation.validatePrepared(preview as Parameters<TaskPreparationWithRetryPort['validatePrepared']>[0])
    else await this.dependencies.preparation.validateRetry(preview as Parameters<TaskPreparationWithRetryPort['validateRetry']>[0])
    const fullDigest = await requestDigest({ actionKind: reference.kind, payload: preview } as GovernedAction)
    if (fullDigest !== reference.requestDigest) throw new Error('approval_digest_mismatch')
    return this.table.transaction(async (entries, save) => {
      const current = await this.dependencies.artifacts.getLatest(scope.userId, input.proposalId)
      if (!current || current.artifact.version !== input.version) throw new Error('preview_superseded')
      const prior = entries.find((entry) => entry.kind === 'approval' && entry.receipt.userId === scope.userId
        && entry.receipt.proposalId === input.proposalId && entry.receipt.previewVersion === input.version)
      if (prior?.kind === 'approval') {
        if (prior.receipt.requestDigest !== fullDigest) throw new Error('approval_conflict')
        return prior.receipt
      }
      const receipt: ApprovalReceipt = approvalSchema.parse({
        schemaVersion: 1, approvalId: `approval_${randomUUID()}`, userId: scope.userId,
        proposalId: input.proposalId, previewVersion: input.version, paramsDigest: input.paramsDigest,
        assetDigests: [...preview.assetDigests], requestDigest: fullDigest, approvedAt: this.now().toISOString(),
      })
      entries.push({ kind: 'approval', id: receipt.approvalId, receipt })
      await save()
      return receipt
    })
  }

  /** 无参数：待签发动作只能来自路由注入的当前用户意图解析器。 */
  async issueIntent(): Promise<UserIntentReceipt> {
    const scope = scopeSchema.parse(await this.dependencies.authenticate())
    const intent = z.object({ actionKind: intentSchema.shape.actionKind, targetId: text }).strict()
      .parse(await this.dependencies.readAuthenticatedIntent())
    return this.table.transaction(async (entries, save) => {
      const prior = entries.find((entry) => entry.kind === 'intent' && entry.receipt.userId === scope.userId
        && entry.receipt.sessionId === scope.sessionId && entry.receipt.messageId === scope.messageId
        && entry.receipt.actionKind === intent.actionKind && entry.receipt.targetId === intent.targetId)
      if (prior?.kind === 'intent') return prior.receipt
      const receipt: UserIntentReceipt = intentSchema.parse({ schemaVersion: 1, intentId: `intent_${randomUUID()}`,
        ...scope, ...intent, verifiedAt: this.now().toISOString() })
      entries.push({ kind: 'intent', id: receipt.intentId, receipt })
      await save()
      return receipt
    })
  }

  /** 结果准入仅按历史原件核验；不会读取 latest、TTL，也不会补签审批。 */
  verifyHistoricalApproval(action: PaidGovernedAction, expectedApprovalDigest: string): Promise<ApprovalReceipt> {
    return verifyHistoricalApprovalFromTable(this.table, action, expectedApprovalDigest)
  }

  async verifyApproval(action: Extract<GovernedAction, { actionKind: 'generate' | 'retry_shots' }>, receipt: ApprovalReceipt | undefined): Promise<ApprovalReceipt> {
    const candidate = approvalSchema.parse(JSON.parse(canonicalize(receipt)))
    const preview = action.payload
    if (candidate.userId !== preview.userId || candidate.proposalId !== preview.proposalId
      || candidate.previewVersion !== preview.version || candidate.paramsDigest !== preview.paramsDigest
      || canonicalize(candidate.assetDigests) !== canonicalize(preview.assetDigests)
      || candidate.requestDigest !== await requestDigest(action)) throw new Error('approval_mismatch')
    await this.table.transaction(async (entries) => {
      const matches = entries.filter((entry) => entry.kind === 'approval' && entry.id === candidate.approvalId)
      if (matches.length !== 1 || matches[0].kind !== 'approval'
        || canonicalize(matches[0].receipt) !== canonicalize(candidate)) throw new Error('approval_not_issued')
    })
    return candidate
  }

  async verifyIntent(action: Exclude<GovernedAction, { actionKind: 'generate' | 'retry_shots' }>): Promise<UserIntentReceipt> {
    const candidate = intentSchema.parse(JSON.parse(canonicalize(action.payload.intent)))
    const targetId = action.actionKind === 'cancel' ? action.payload.taskId : action.payload.assetId
    if (candidate.actionKind !== action.actionKind || candidate.targetId !== targetId
      || candidate.userId !== action.payload.userId || candidate.sessionId !== action.payload.sessionId
      || candidate.messageId !== action.payload.messageId) throw new Error('intent_mismatch')
    await this.table.transaction(async (entries) => {
      const matches = entries.filter((entry) => entry.kind === 'intent' && entry.id === candidate.intentId)
      if (matches.length !== 1 || matches[0].kind !== 'intent'
        || canonicalize(matches[0].receipt) !== canonicalize(candidate)) throw new Error('intent_not_issued')
    })
    return candidate
  }

  async saveVendorResult(userId: string, key: string, fullDigest: string, raw: StoredVendorResult): Promise<void> {
    const candidate = entrySchema.parse({ kind: 'vendor_result', id: key, userId, requestDigest: fullDigest, response: validateVendorResult(raw) })
    await this.table.transaction(async (entries, save) => {
      const prior = entries.find((entry) => entry.kind === 'vendor_result' && entry.id === key && entry.userId === userId)
      if (prior) {
        if (canonicalize(prior) !== canonicalize(candidate)) throw new Error('vendor_result_conflict')
        return
      }
      entries.push(candidate)
      await save()
    })
  }

  async getVendorResult(userId: string, key: string, fullDigest: string): Promise<StoredVendorResult | undefined> {
    return this.table.transaction(async (entries) => {
      const matches = entries.filter((entry) => entry.kind === 'vendor_result' && entry.id === key && entry.userId === userId)
      if (matches.length > 1) throw new Error('vendor_result_conflict')
      const entry = matches[0]
      if (entry?.kind !== 'vendor_result') return undefined
      if (entry.requestDigest !== fullDigest) throw new Error('vendor_result_conflict')
      return entry.response
    })
  }
}
