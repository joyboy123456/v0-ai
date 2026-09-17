import { z } from 'zod'
import type { ShadowReviewDisposition } from '../ports'
import { parseCritique, type Critique, type ReviewSeverity } from './critic'

export const E1_POLICY_VERSION = 'e1-shadow-policy-v2'
export const E1_MIN_SCORE = 0.7

const PENALTY: Readonly<Record<ReviewSeverity, number>> = Object.freeze({
  blocker: 1,
  warning: 0.2,
  info: 0.05,
})

export const acceptancePolicyDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  policyVersion: z.string().min(1).max(160),
  disposition: z.enum(['UNREVIEWED', 'SHADOW_PASS', 'SHADOW_WOULD_WARN', 'SHADOW_WOULD_BLOCK']),
  score: z.number().finite().min(0).max(1),
  minimumScore: z.number().finite().min(0).max(1),
  issueCodes: z.array(z.string().min(1).max(96).regex(/^[a-z][a-z0-9_]*$/)).max(64),
  reasonCodes: z.array(z.string().min(1).max(96).regex(/^[a-z][a-z0-9_]*$/)).max(64),
  /** 本次完全没有评审的维度；旧记录没有该字段时按空数组读。 */
  unsupportedCheckIds: z.array(z.string().min(1).max(96)).max(64).optional(),
}).strict().superRefine((value, context) => {
  for (const values of [value.issueCodes, value.reasonCodes, value.unsupportedCheckIds ?? []]) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'decision codes must be unique' })
    }
  }
})

export type AcceptancePolicyDecision = z.infer<typeof acceptancePolicyDecisionSchema>

export function parseAcceptancePolicyDecision(value: unknown): AcceptancePolicyDecision {
  return acceptancePolicyDecisionSchema.parse(value)
}

/** 只允许覆盖版本号；阈值必须由版本唯一决定，否则缓存 key 不足以复现结论。 */
export interface AcceptancePolicyOptions {
  policyVersion?: string
}

/**
 * 纯确定性 shadow 策略：分数只由 grounded issue 推导，Critic 自身没有放行权。
 * 本版本故意不暴露 hard mode；一周误杀率数据和单独开关评审完成前不能隔离 C8 结果。
 */
export function evaluateAcceptancePolicy(
  value: Critique,
  options: AcceptancePolicyOptions = {},
): AcceptancePolicyDecision {
  const critique = parseCritique(value)
  const policyVersion = options.policyVersion ?? E1_POLICY_VERSION
  const minimumScore = E1_MIN_SCORE
  if (!policyVersion.trim() || policyVersion.length > 160) throw new TypeError('invalid_policy_version')

  const score = Number(Math.max(0, 1 - critique.issues.reduce(
    (total, issue) => total + PENALTY[issue.severity] * issue.confidence,
    0,
  )).toFixed(6))
  const issueCodes = [...new Set(critique.issues.map((issue) => issue.code))].sort()
  const reasonCodes: string[] = []
  const decodable = critique.checks.find((check) => check.checkId === 'image_decodable')
  const hasBlocker = critique.issues.some((issue) => issue.severity === 'blocker')
  const hasWarning = critique.issues.some((issue) => issue.severity === 'warning')
  const unsupportedCheckIds = critique.checks
    .filter((check) => check.status === 'unsupported')
    .map((check) => check.checkId)
    .sort()

  let disposition: ShadowReviewDisposition
  if (!decodable || decodable.status === 'unknown' || decodable.status === 'unsupported') {
    disposition = 'UNREVIEWED'
    reasonCodes.push('required_check_unknown')
  } else if (hasBlocker) {
    disposition = 'SHADOW_WOULD_BLOCK'
    reasonCodes.push('grounded_blocker')
  } else if (score < minimumScore) {
    disposition = 'SHADOW_WOULD_BLOCK'
    reasonCodes.push('minimum_score_not_met')
  } else if (hasWarning) {
    disposition = 'SHADOW_WOULD_WARN'
    reasonCodes.push('grounded_warning')
  } else {
    disposition = 'SHADOW_PASS'
    reasonCodes.push('supported_checks_passed')
  }
  // SHADOW_PASS 只代表「已支持的确定性检查全通过」。未评审维度必须随决定一起暴露，
  // 任何消费者都不能把它读成「质量通过」。
  if (unsupportedCheckIds.length) reasonCodes.push('unsupported_checks_present')

  return acceptancePolicyDecisionSchema.parse({
    schemaVersion: 1,
    policyVersion,
    disposition,
    score,
    minimumScore,
    issueCodes,
    reasonCodes,
    unsupportedCheckIds,
  })
}
