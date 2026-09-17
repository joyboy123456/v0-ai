import { z } from 'zod'
import { canonicalize, digest, toJsonValue } from '@/lib/agent/contracts'
import type { ResultReviewC8Admission } from '../ports'
import {
  parseAcceptancePolicyDecision,
  type AcceptancePolicyDecision,
} from './acceptance-policy'
import { parseCritique, type Critique } from './critic'
import { DurableGovernanceTable } from '../governance/preparation-artifact-store'

export const RESULT_REVIEW_FILE = 'result-reviews.json'

const identifier = z.string().min(1).max(512)
const actionKey = z.string().min(1).max(2_048)
const version = z.string().min(1).max(160)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const reviewRefSchema = z.string().regex(/^e1:[a-f0-9]{64}$/)
const c8EvidenceRef = z.string().regex(/^c8:[a-f0-9]{64}$/)

const admissionSchema = z.object({
  userId: identifier,
  sessionId: identifier,
  messageId: identifier,
  taskId: identifier,
  actionKey,
  actionKind: z.enum(['generate', 'retry_shots']),
  requestDigest: hash,
  approvalDigest: hash,
  evidenceRef: c8EvidenceRef,
  resultDigest: hash,
}).strict()

const storedReviewSchema = z.object({
  schemaVersion: z.literal(1),
  reviewRef: reviewRefSchema,
  identityKey: hash,
  admissionKey: hash,
  userId: identifier,
  assetId: identifier,
  taskId: identifier,
  assetDigest: hash,
  reviewerVersion: version,
  policyVersion: version,
  c8Admission: admissionSchema,
  critique: z.unknown(),
  decision: z.unknown(),
  /** 旧记录没有该字段时按 deterministic 读，保持既有 receipt 摘要不变。 */
  outcomeKind: z.enum(['deterministic', 'transient_unavailable']).optional(),
  createdAt: z.string().datetime(),
}).strict()

export interface ResultReviewIdentity {
  assetDigest: string
  reviewerVersion: string
  policyVersion: string
}

export type ResultReviewAdmission = z.infer<typeof admissionSchema>

/**
 * deterministic：同一字节必然复现的结论，可作为计算缓存。
 * transient_unavailable：E1 侧读图等瞬时故障，只留痕，不得复用、不得阻止后续重评。
 */
export type ResultReviewOutcomeKind = 'deterministic' | 'transient_unavailable'

export interface ResultReviewObservation {
  userId: string
  assetId: string
  taskId: string
  assetDigest: string
  reviewerVersion: string
  policyVersion: string
  c8Admission: ResultReviewAdmission
  critique: Critique
  decision: AcceptancePolicyDecision
  outcomeKind?: ResultReviewOutcomeKind
}

export interface ResultReviewArtifact extends ResultReviewObservation {
  outcomeKind: ResultReviewOutcomeKind
  schemaVersion: 1
  reviewRef: string
  identityKey: string
  admissionKey: string
  createdAt: string
}

export interface ResultReviewStorePort {
  /** 读取同一 C8 ADMITTED receipt；仅 URL 轮换时命中。瞬时失败留痕不算命中。 */
  get(identity: ResultReviewIdentity, admission: ResultReviewAdmission): Promise<ResultReviewArtifact | null>
  /** 读取同一 immutable asset/reviewer/policy 的确定性计算缓存；允许有多个 C8 receipt。 */
  getEvaluation(identity: ResultReviewIdentity): Promise<ResultReviewArtifact | null>
  /** created=false 代表并发/重放命中同一 admission receipt。 */
  record(observation: ResultReviewObservation): Promise<{ artifact: ResultReviewArtifact; created: boolean }>
}

function identityPayload(identity: ResultReviewIdentity): object {
  return {
    schemaVersion: 1,
    assetDigest: identity.assetDigest,
    reviewerVersion: identity.reviewerVersion,
    policyVersion: identity.policyVersion,
  }
}

function admissionPayload(admission: ResultReviewAdmission): object {
  return { schemaVersion: 1, ...admission }
}

export async function resultReviewIdentityKey(identity: ResultReviewIdentity): Promise<string> {
  const parsed = z.object({ assetDigest: hash, reviewerVersion: version, policyVersion: version })
    .strict().parse(toJsonValue(identity))
  return digest(identityPayload(parsed))
}

export async function resultReviewAdmissionKey(admission: ResultReviewAdmission): Promise<string> {
  return digest(admissionPayload(admissionSchema.parse(toJsonValue(admission))))
}

function stableEvaluation(observation: ResultReviewObservation, identityKey: string): object {
  const outcomeKind = observation.outcomeKind ?? 'deterministic'
  return {
    schemaVersion: 1,
    identityKey,
    ...(outcomeKind === 'deterministic' ? {} : { outcomeKind }),
    userId: observation.userId,
    assetId: observation.assetId,
    taskId: observation.taskId,
    assetDigest: observation.assetDigest,
    reviewerVersion: observation.reviewerVersion,
    policyVersion: observation.policyVersion,
    critique: observation.critique,
    decision: observation.decision,
  }
}

function stableArtifact(observation: ResultReviewObservation, identityKey: string, admissionKey: string): object {
  return {
    ...stableEvaluation(observation, identityKey),
    admissionKey,
    c8Admission: observation.c8Admission,
  }
}

async function normalizeObservation(value: ResultReviewObservation): Promise<ResultReviewObservation> {
  const base = z.object({
    userId: identifier,
    assetId: identifier,
    taskId: identifier,
    assetDigest: hash,
    reviewerVersion: version,
    policyVersion: version,
    c8Admission: z.unknown(),
    critique: z.unknown(),
    decision: z.unknown(),
    outcomeKind: z.enum(['deterministic', 'transient_unavailable']).optional(),
  }).strict().parse(toJsonValue(value))
  const c8Admission = admissionSchema.parse(base.c8Admission) as ResultReviewC8Admission
  if (c8Admission.userId !== base.userId || c8Admission.taskId !== base.taskId) {
    throw new Error('e1_review_admission_mismatch: C8 凭证身份不一致')
  }
  const critique = parseCritique(base.critique)
  const decision = parseAcceptancePolicyDecision(base.decision)
  if (critique.reviewerVersion !== base.reviewerVersion
    || decision.policyVersion !== base.policyVersion) {
    throw new Error('e1_review_identity_mismatch: 评审版本不一致')
  }
  return { ...base, c8Admission, critique, decision, outcomeKind: base.outcomeKind ?? 'deterministic' }
}

async function validateStoredReview(value: unknown): Promise<ResultReviewArtifact> {
  const parsed = storedReviewSchema.parse(toJsonValue(value))
  const observation = await normalizeObservation({
    userId: parsed.userId,
    assetId: parsed.assetId,
    taskId: parsed.taskId,
    assetDigest: parsed.assetDigest,
    reviewerVersion: parsed.reviewerVersion,
    policyVersion: parsed.policyVersion,
    c8Admission: parsed.c8Admission,
    critique: parsed.critique as Critique,
    decision: parsed.decision as AcceptancePolicyDecision,
    ...(parsed.outcomeKind ? { outcomeKind: parsed.outcomeKind } : {}),
  })
  const expectedIdentity = await resultReviewIdentityKey({
    assetDigest: observation.assetDigest,
    reviewerVersion: observation.reviewerVersion,
    policyVersion: observation.policyVersion,
  })
  const expectedAdmission = await resultReviewAdmissionKey(observation.c8Admission)
  if (parsed.identityKey !== expectedIdentity || parsed.admissionKey !== expectedAdmission) {
    throw new Error('e1_review_tampered: 评审身份摘要不一致')
  }
  const expectedRef = `e1:${await digest(stableArtifact(observation, expectedIdentity, expectedAdmission))}`
  if (parsed.reviewRef !== expectedRef) {
    throw new Error('e1_review_tampered: 评审证据摘要不一致')
  }
  return {
    ...observation,
    outcomeKind: observation.outcomeKind ?? 'deterministic',
    schemaVersion: 1,
    reviewRef: parsed.reviewRef,
    identityKey: parsed.identityKey,
    admissionKey: parsed.admissionKey,
    createdAt: parsed.createdAt,
  }
}

function validTime(now: () => Date): string {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('e1_review_storage_unavailable: 时钟无效')
  }
  return value.toISOString()
}

/** 瞬时失败之间可以互不相同，也可以与后来的确定性结论并存；只有确定性结论必须唯一。 */
function assertSingleEvaluation(entries: readonly ResultReviewArtifact[], identityKey: string): void {
  const matching = entries.filter((entry) => entry.identityKey === identityKey
    && entry.outcomeKind === 'deterministic')
  if (!matching.length) return
  const fingerprints = new Set(matching.map((entry) => canonicalize(stableEvaluation(entry, identityKey))))
  if (fingerprints.size !== 1) {
    throw new Error('e1_review_conflict: 同一评审身份产生不同计算结果')
  }
}

/**
 * 独立于 C8 的质量证据轴。质量计算缓存按 immutable asset identity 复用，
 * 但每个 C8 ADMITTED action/evidence/result window 都强写单独 receipt；损坏不回退备份。
 */
export class FileResultReviewStore implements ResultReviewStorePort {
  private readonly table: DurableGovernanceTable<ResultReviewArtifact>
  private readonly now: () => Date

  constructor(directory: string, options: { now?: () => Date } = {}) {
    this.table = new DurableGovernanceTable(directory, RESULT_REVIEW_FILE, validateStoredReview)
    this.now = options.now ?? (() => new Date())
  }

  async get(identity: ResultReviewIdentity, admission: ResultReviewAdmission): Promise<ResultReviewArtifact | null> {
    const identityKey = await resultReviewIdentityKey(identity)
    const admissionKey = await resultReviewAdmissionKey(admission)
    return this.table.transaction(async (entries) => {
      assertSingleEvaluation(entries, identityKey)
      // 瞬时失败留痕不能命中：否则一次抖动会永久替代这张图的真实评审。
      const matches = entries.filter((entry) => entry.identityKey === identityKey
        && entry.admissionKey === admissionKey && entry.outcomeKind === 'deterministic')
      if (matches.length > 1) throw new Error('e1_review_conflict: C8 准入 receipt 重复')
      return matches[0] ? structuredClone(matches[0]) : null
    })
  }

  async getEvaluation(identity: ResultReviewIdentity): Promise<ResultReviewArtifact | null> {
    const identityKey = await resultReviewIdentityKey(identity)
    return this.table.transaction(async (entries) => {
      assertSingleEvaluation(entries, identityKey)
      const found = entries.find((entry) => entry.identityKey === identityKey
        && entry.outcomeKind === 'deterministic')
      return found ? structuredClone(found) : null
    })
  }

  async record(raw: ResultReviewObservation): Promise<{ artifact: ResultReviewArtifact; created: boolean }> {
    const observation = await normalizeObservation(raw)
    const identityKey = await resultReviewIdentityKey({
      assetDigest: observation.assetDigest,
      reviewerVersion: observation.reviewerVersion,
      policyVersion: observation.policyVersion,
    })
    const admissionKey = await resultReviewAdmissionKey(observation.c8Admission)
    const reviewRef = `e1:${await digest(stableArtifact(observation, identityKey, admissionKey))}`
    const candidate = await validateStoredReview({
      ...stableArtifact(observation, identityKey, admissionKey),
      reviewRef,
      createdAt: validTime(this.now),
    })
    return this.table.transaction(async (entries, save) => {
      assertSingleEvaluation(entries, identityKey)
      const sameAdmission = entries.filter((entry) => entry.identityKey === identityKey
        && entry.admissionKey === admissionKey)
      const existingDeterministic = sameAdmission.filter((entry) => entry.outcomeKind === 'deterministic')
      if (existingDeterministic.length > 1) throw new Error('e1_review_conflict: C8 准入 receipt 重复')
      if (candidate.outcomeKind !== 'deterministic') {
        // 已有确定性结论时瞬时失败不再留新痕；否则同一 admission 只保留一条瞬时痕迹，避免无界增长。
        const reusable = existingDeterministic[0] ?? sameAdmission.find((entry) => entry.outcomeKind !== 'deterministic')
        if (reusable) return { artifact: structuredClone(reusable), created: false }
        entries.push(candidate)
        await save()
        return { artifact: structuredClone(candidate), created: true }
      }
      const cachedEvaluation = entries.find((entry) => entry.identityKey === identityKey
        && entry.outcomeKind === 'deterministic')
      if (cachedEvaluation
        && canonicalize(stableEvaluation(cachedEvaluation, identityKey))
          !== canonicalize(stableEvaluation(candidate, identityKey))) {
        throw new Error('e1_review_conflict: 同一评审身份产生不同计算结果')
      }
      if (existingDeterministic[0]) {
        if (existingDeterministic[0].reviewRef !== candidate.reviewRef) {
          throw new Error('e1_review_conflict: 同一 C8 准入凭证产生不同证据')
        }
        return { artifact: structuredClone(existingDeterministic[0]), created: false }
      }
      // 确定性结论取代同一 admission 早先的瞬时痕迹，保证重评后不留下误导性的 UNREVIEWED。
      for (const stale of sameAdmission) {
        const index = entries.indexOf(stale)
        if (index >= 0) entries.splice(index, 1)
      }
      entries.push(candidate)
      await save()
      return { artifact: structuredClone(candidate), created: true }
    })
  }
}

export function createResultReviewStore(
  directory: string,
  options: { now?: () => Date } = {},
): ResultReviewStorePort {
  return new FileResultReviewStore(directory, options)
}

export function sameReviewArtifact(left: ResultReviewArtifact, right: ResultReviewArtifact): boolean {
  return canonicalize(left) === canonicalize(right)
}
