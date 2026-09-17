import { z } from 'zod'
import { assetDigest, toJsonValue } from '@/lib/agent/contracts'
import type { AssetRecord } from '@/lib/types'
import type {
  AssetQueryPort,
  ResultReviewCandidate,
  ResultReviewDecision,
  ResultReviewPort,
} from '../ports'
import type { AgentEventSink } from '../observability/events'
import { recordAgentEvent } from '../observability/events'
import {
  E1_POLICY_VERSION,
  evaluateAcceptancePolicy,
  type AcceptancePolicyOptions,
} from './acceptance-policy'
import {
  createUnavailableCritique,
  E1_REVIEWER_VERSION,
  inspectDeterministicImage,
  type Critique,
} from './critic'
import {
  resultReviewIdentityKey,
  type ResultReviewAdmission,
  type ResultReviewArtifact,
  type ResultReviewIdentity,
  type ResultReviewStorePort,
} from './review-store'

const identifier = z.string().min(1).max(512)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const scopeSchema = z.object({ userId: identifier, sessionId: identifier }).strict()
const c8AdmissionSchema = z.object({
  userId: identifier,
  sessionId: identifier,
  messageId: identifier,
  taskId: identifier,
  actionKey: z.string().min(1).max(2_048),
  actionKind: z.enum(['generate', 'retry_shots']),
  requestDigest: hash,
  approvalDigest: hash,
  evidenceRef: z.string().regex(/^c8:[a-f0-9]{64}$/),
  resultDigest: hash,
}).strict()
const candidateSchema = z.object({
  assetId: identifier,
  taskId: identifier,
  fileName: z.string().min(1).max(1_024),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
  c8: c8AdmissionSchema,
}).strict()

export class ResultReviewError extends Error {
  constructor(readonly code: 'INVALID_SCOPE' | 'INVALID_CANDIDATE' | 'ASSET_NOT_FOUND' | 'ASSET_CHANGED') {
    super(`结果影子评审不可用：${code}`)
    this.name = 'ResultReviewError'
  }
}

export interface ResultReviewDependencies {
  assets: AssetQueryPort
  readAssetBytes: (asset: Readonly<AssetRecord>) => Promise<Buffer>
  store: ResultReviewStorePort
  events?: AgentEventSink
  reviewerVersion?: string
  policy?: AcceptancePolicyOptions
}

interface ReviewEvaluation {
  critique: Critique
  decision: ReturnType<typeof evaluateAcceptancePolicy>
  /** 只有确定性结论能进计算缓存；读图等瞬时故障必须可被后续重评取代。 */
  outcomeKind: 'deterministic' | 'transient_unavailable'
}

function artifactDecision(artifact: ResultReviewArtifact, reused: boolean): ResultReviewDecision {
  return {
    assetId: artifact.assetId,
    taskId: artifact.taskId,
    assetDigest: artifact.assetDigest,
    reviewRef: artifact.reviewRef,
    disposition: artifact.decision.disposition,
    issueCodes: [...artifact.decision.issueCodes],
    reused,
  }
}

function parseCandidates(values: readonly ResultReviewCandidate[]): ResultReviewCandidate[] {
  let parsed: ResultReviewCandidate[]
  try { parsed = z.array(candidateSchema).max(256).parse(toJsonValue(values)) } catch {
    throw new ResultReviewError('INVALID_CANDIDATE')
  }
  const keys = parsed.map((entry) => `${entry.c8.actionKey}:${entry.c8.evidenceRef}:${entry.assetId}`)
  if (new Set(keys).size !== keys.length) throw new ResultReviewError('INVALID_CANDIDATE')
  return parsed
}

function assertC8Binding(scope: z.infer<typeof scopeSchema>, candidate: ResultReviewCandidate): ResultReviewAdmission {
  const admission = candidate.c8 as ResultReviewAdmission
  if (admission.userId !== scope.userId || admission.sessionId !== scope.sessionId
    || admission.taskId !== candidate.taskId) {
    throw new ResultReviewError('INVALID_CANDIDATE')
  }
  return admission
}

async function currentAsset(
  assets: AssetQueryPort,
  userId: string,
  candidate: ResultReviewCandidate,
): Promise<AssetRecord> {
  let asset: AssetRecord | undefined
  try { asset = await assets.getAsset(candidate.assetId) } catch {
    throw new ResultReviewError('ASSET_NOT_FOUND')
  }
  if (!asset || asset.assetId !== candidate.assetId || asset.userId !== userId
    || asset.taskId !== candidate.taskId || asset.fileName !== candidate.fileName
    || asset.width !== candidate.width || asset.height !== candidate.height
    || !asset.fileType.startsWith('image/')) {
    throw new ResultReviewError('ASSET_NOT_FOUND')
  }
  return structuredClone(asset)
}

/**
 * 只接收 C8 已强写 evidence 的 ADMITTED 投影，并在处理前后重查当前资产。
 * 评审不持有 TaskCommand/Vendor/Billing 能力，不能重试、重生、退款或改变 C8 状态。
 */
export function createResultReview(dependencies: ResultReviewDependencies): ResultReviewPort {
  if (typeof dependencies.readAssetBytes !== 'function') throw new TypeError('readAssetBytes 必须注入')
  const reviewerVersion = dependencies.reviewerVersion ?? E1_REVIEWER_VERSION
  const policyVersion = dependencies.policy?.policyVersion ?? E1_POLICY_VERSION
  const pendingEvaluation = new Map<string, Promise<ReviewEvaluation>>()

  const assertCurrent = async (
    userId: string,
    candidate: ResultReviewCandidate,
    expectedDigest: string,
  ): Promise<void> => {
    const asset = await currentAsset(dependencies.assets, userId, candidate)
    if (await assetDigest(asset) !== expectedDigest) throw new ResultReviewError('ASSET_CHANGED')
  }

  const emitIssued = async (
    scope: z.infer<typeof scopeSchema>,
    artifact: ResultReviewArtifact,
  ): Promise<void> => {
    if (!dependencies.events) return
    await recordAgentEvent(dependencies.events, {
      userId: scope.userId,
      sessionId: scope.sessionId,
      turnId: `review_${artifact.reviewRef.slice(3)}`,
      name: 'critique.issued',
      data: {
        reviewRef: artifact.reviewRef,
        assetId: artifact.assetId,
        taskId: artifact.taskId,
        assetDigest: artifact.assetDigest,
        reviewerVersion: artifact.reviewerVersion,
        policyVersion: artifact.policyVersion,
        c8EvidenceRef: artifact.c8Admission.evidenceRef,
        c8ResultDigest: artifact.c8Admission.resultDigest,
        c8ActionKey: artifact.c8Admission.actionKey,
        disposition: artifact.decision.disposition,
        issueCodes: artifact.decision.issueCodes,
        droppedIssueCount: artifact.critique.droppedIssues.length,
      },
    })
  }

  const reviewOne = async (
    scope: z.infer<typeof scopeSchema>,
    candidate: ResultReviewCandidate,
  ): Promise<ResultReviewDecision> => {
    const admission = assertC8Binding(scope, candidate)
    const asset = await currentAsset(dependencies.assets, scope.userId, candidate)
    const version = await assetDigest(asset)
    const identity: ResultReviewIdentity = { assetDigest: version, reviewerVersion, policyVersion }
    const exact = await dependencies.store.get(identity, admission)
    if (exact) {
      await assertCurrent(scope.userId, candidate, version)
      return artifactDecision(exact, true)
    }

    let evaluation: ReviewEvaluation | undefined
    let reused = false
    const cachedEvaluation = await dependencies.store.getEvaluation(identity)
    if (cachedEvaluation) {
      evaluation = {
        critique: cachedEvaluation.critique,
        decision: cachedEvaluation.decision,
        outcomeKind: 'deterministic',
      }
      reused = true
    } else {
      const key = await resultReviewIdentityKey(identity)
      let operation = pendingEvaluation.get(key)
      if (operation) reused = true
      else {
        operation = (async () => {
          let critique: Critique
          let outcomeKind: ReviewEvaluation['outcomeKind'] = 'deterministic'
          try {
            const source = await dependencies.readAssetBytes(structuredClone(asset))
            critique = await inspectDeterministicImage({
              source,
              expectedWidth: candidate.width,
              expectedHeight: candidate.height,
              reviewerVersion,
            })
          } catch {
            // 读图失败是 E1 侧的瞬时故障，不是这张图的质量事实。
            critique = createUnavailableCritique('source_unavailable', reviewerVersion)
            outcomeKind = 'transient_unavailable'
          }
          return {
            critique,
            decision: evaluateAcceptancePolicy(critique, dependencies.policy),
            outcomeKind,
          }
        })()
        pendingEvaluation.set(key, operation)
      }
      try { evaluation = await operation } finally {
        if (pendingEvaluation.get(key) === operation) pendingEvaluation.delete(key)
      }
    }

    await assertCurrent(scope.userId, candidate, version)
    const recorded = await dependencies.store.record({
      userId: scope.userId,
      assetId: candidate.assetId,
      taskId: candidate.taskId,
      assetDigest: version,
      reviewerVersion,
      policyVersion,
      c8Admission: admission,
      critique: evaluation!.critique,
      decision: evaluation!.decision,
      outcomeKind: evaluation!.outcomeKind,
    })
    await assertCurrent(scope.userId, candidate, version)
    if (recorded.created) await emitIssued(scope, recorded.artifact)
    return artifactDecision(recorded.artifact, reused || !recorded.created)
  }

  return {
    async reviewAdmittedResults(rawScope, rawCandidates) {
      let scope: z.infer<typeof scopeSchema>
      try { scope = scopeSchema.parse(toJsonValue(rawScope)) } catch {
        throw new ResultReviewError('INVALID_SCOPE')
      }
      const candidates = parseCandidates(rawCandidates)
      const decisions: ResultReviewDecision[] = []
      // 当前产品只开放单任务单张；仍顺序处理防止未来多图同时解码放大内存峰值。
      for (const candidate of candidates) decisions.push(await reviewOne(scope, candidate))
      return { decisions }
    },
  }
}
