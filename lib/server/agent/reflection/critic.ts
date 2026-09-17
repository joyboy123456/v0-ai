import sharp from 'sharp'
import { z } from 'zod'
import { canonicalize, toJsonValue } from '@/lib/agent/contracts'

export const E1_REVIEWER_VERSION = 'e1-deterministic-v2'

export const REVIEW_CHECK_IDS = [
  'image_decodable',
  'dimension_match',
  'resolution',
  'aspect_ratio',
  'visible_content',
  'blank_border',
  'edge_crop',
  'visible_text',
  'watermark',
  'blur',
  'color_fidelity',
  'silhouette_fidelity',
  'body_anatomy',
  'aesthetic_quality',
  'multimodal_quality',
] as const

export type ReviewCheckId = typeof REVIEW_CHECK_IDS[number]
export type ReviewCheckStatus = 'passed' | 'failed' | 'unknown' | 'unsupported'
export type ReviewSeverity = 'blocker' | 'warning' | 'info'

const evidenceScalarSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export const reviewEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  values: z.array(z.object({
    name: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
    value: evidenceScalarSchema,
  }).strict()).min(1).max(24),
}).strict().superRefine((value, context) => {
  if (new Set(value.values.map((entry) => entry.name)).size !== value.values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'evidence names must be unique' })
  }
})

export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>

export const reviewCheckSchema = z.object({
  checkId: z.enum(REVIEW_CHECK_IDS),
  status: z.enum(['passed', 'failed', 'unknown', 'unsupported']),
  source: z.enum(['deterministic', 'not_configured']),
  confidence: z.number().finite().min(0).max(1),
  evidence: reviewEvidenceSchema,
}).strict()

export type ReviewCheck = z.infer<typeof reviewCheckSchema>

const issueCodeSchema = z.string().min(1).max(96).regex(/^[a-z][a-z0-9_]*$/)

export const reviewIssueSchema = z.object({
  code: issueCodeSchema,
  severity: z.enum(['blocker', 'warning', 'info']),
  confidence: z.number().finite().min(0).max(1),
  check: reviewCheckSchema,
  evidence: reviewEvidenceSchema,
}).strict()

export type ReviewIssue = z.infer<typeof reviewIssueSchema>

export const droppedReviewIssueSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  code: issueCodeSchema.optional(),
  reason: z.enum([
    'invalid_issue',
    'missing_evidence',
    'unknown_check',
    'check_not_failed',
    'policy_escalation',
    'evidence_mismatch',
    'low_confidence',
    'duplicate_issue',
  ]),
}).strict()

export type DroppedReviewIssue = z.infer<typeof droppedReviewIssueSchema>

export const critiqueSchema = z.object({
  schemaVersion: z.literal(1),
  reviewerVersion: z.string().min(1).max(160),
  checks: z.array(reviewCheckSchema).min(1).max(REVIEW_CHECK_IDS.length),
  issues: z.array(reviewIssueSchema).max(REVIEW_CHECK_IDS.length),
  droppedIssues: z.array(droppedReviewIssueSchema).max(128),
}).strict().superRefine((value, context) => {
  if (new Set(value.checks.map((check) => check.checkId)).size !== value.checks.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'check ids must be unique' })
  }
  const issueKeys = value.issues.map((issue) => `${issue.check.checkId}:${issue.code}`)
  if (new Set(issueKeys).size !== issueKeys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'issues must be unique' })
  }
})

export type Critique = z.infer<typeof critiqueSchema>

interface ProposedIssue {
  code: string
  severity: ReviewSeverity
  confidence: number
  check: { checkId: string; status: string }
  evidence?: unknown
}

const proposedIssueSchema = z.object({
  code: issueCodeSchema,
  severity: z.enum(['blocker', 'warning', 'info']),
  confidence: z.number().finite().min(0).max(1),
  check: z.object({
    checkId: z.string().min(1).max(80),
    status: z.string().min(1).max(32),
  }).strict(),
  evidence: z.unknown().optional(),
}).strict()

const ISSUE_POLICY: Readonly<Partial<Record<ReviewCheckId, { code: string; severity: ReviewSeverity }>>> = Object.freeze({
  image_decodable: { code: 'image_unreadable', severity: 'blocker' },
  dimension_match: { code: 'dimension_mismatch', severity: 'blocker' },
  resolution: { code: 'low_resolution', severity: 'warning' },
  aspect_ratio: { code: 'extreme_aspect_ratio', severity: 'warning' },
  visible_content: { code: 'empty_visible_content', severity: 'blocker' },
  blank_border: { code: 'excessive_blank_border', severity: 'warning' },
  edge_crop: { code: 'content_touches_edge', severity: 'warning' },
})

const MIN_ISSUE_CONFIDENCE = 0.5

function evidence(values: Array<[string, string | number | boolean | null]>): ReviewEvidence {
  return reviewEvidenceSchema.parse({
    schemaVersion: 1,
    values: values.map(([name, value]) => ({ name, value })),
  })
}

function check(
  checkId: ReviewCheckId,
  status: ReviewCheckStatus,
  confidence: number,
  values: Array<[string, string | number | boolean | null]>,
  source: ReviewCheck['source'] = 'deterministic',
): ReviewCheck {
  return reviewCheckSchema.parse({ checkId, status, source, confidence, evidence: evidence(values) })
}

function safeProposedIssue(value: unknown): ProposedIssue | null {
  try {
    const parsed = proposedIssueSchema.safeParse(toJsonValue(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function safeIssueCode(value: unknown): string | undefined {
  try {
    if (typeof value !== 'object' || value === null) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, 'code')
    if (!descriptor || !('value' in descriptor)) return undefined
    const parsed = issueCodeSchema.safeParse(descriptor.value)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/**
 * grounded 契约必须在解析边界强制，而不是依赖调用方先走 createCritique。
 * 任何 issue 都要绑定同一份 checks 里确实 failed 的检查，且 code/severity/evidence/置信度一致。
 */
export function assertGroundedCritique(critique: Critique): Critique {
  const byId = new Map(critique.checks.map((entry) => [entry.checkId, entry] as const))
  for (const issue of critique.issues) {
    const boundCheck = byId.get(issue.check.checkId)
    if (!boundCheck) throw new TypeError('ungrounded_issue_unknown_check')
    if (canonicalize(toJsonValue(issue.check)) !== canonicalize(toJsonValue(boundCheck))) {
      throw new TypeError('ungrounded_issue_check_mismatch')
    }
    if (boundCheck.status !== 'failed') throw new TypeError('ungrounded_issue_check_not_failed')
    const policy = ISSUE_POLICY[boundCheck.checkId]
    if (!policy || issue.code !== policy.code || issue.severity !== policy.severity) {
      throw new TypeError('ungrounded_issue_policy_escalation')
    }
    if (canonicalize(toJsonValue(issue.evidence)) !== canonicalize(toJsonValue(boundCheck.evidence))) {
      throw new TypeError('ungrounded_issue_evidence_mismatch')
    }
    if (issue.confidence < MIN_ISSUE_CONFIDENCE || issue.confidence > boundCheck.confidence) {
      throw new TypeError('ungrounded_issue_confidence')
    }
  }
  return critique
}

export function parseCritique(value: unknown): Critique {
  return assertGroundedCritique(critiqueSchema.parse(toJsonValue(value)))
}

/**
 * Critic 只把 issue 绑定到已失败的检查事实；issue 自身没有放行权。
 * 模型或调用方提供的裸分、升级 severity、缺 check/evidence 均 dropped 留痕。
 */
export function createCritique(
  rawChecks: readonly ReviewCheck[],
  proposedIssues?: readonly unknown[],
  reviewerVersion = E1_REVIEWER_VERSION,
): Critique {
  const checks = rawChecks.map((entry) => reviewCheckSchema.parse(toJsonValue(entry)))
  if (new Set(checks.map((entry) => entry.checkId)).size !== checks.length) {
    throw new TypeError('duplicate_review_check')
  }
  const byId = new Map(checks.map((entry) => [entry.checkId, entry] as const))
  // 确定性候选永远先入列；外部 proposals 只能追加，不能顶掉已失败检查的 issue。
  const deterministic: unknown[] = checks.flatMap((entry) => {
    const policy = ISSUE_POLICY[entry.checkId]
    return entry.status === 'failed' && policy ? [{
      ...policy,
      confidence: entry.confidence,
      check: { checkId: entry.checkId, status: entry.status },
      evidence: entry.evidence,
    }] : []
  })
  const candidates: readonly unknown[] = [...deterministic, ...(proposedIssues ?? [])]
  const issues: ReviewIssue[] = []
  const droppedIssues: DroppedReviewIssue[] = []
  const accepted = new Set<string>()

  const drop = (candidateIndex: number, raw: unknown, reason: DroppedReviewIssue['reason']) => {
    droppedIssues.push(droppedReviewIssueSchema.parse({
      candidateIndex,
      ...(safeIssueCode(raw) ? { code: safeIssueCode(raw) } : {}),
      reason,
    }))
  }

  for (const [candidateIndex, raw] of candidates.entries()) {
    const candidate = safeProposedIssue(raw)
    if (!candidate) {
      drop(candidateIndex, raw, 'invalid_issue')
      continue
    }
    if (candidate.evidence === undefined) {
      drop(candidateIndex, raw, 'missing_evidence')
      continue
    }
    const boundCheck = byId.get(candidate.check.checkId as ReviewCheckId)
    if (!boundCheck) {
      drop(candidateIndex, raw, 'unknown_check')
      continue
    }
    if (boundCheck.status !== 'failed' || candidate.check.status !== 'failed') {
      drop(candidateIndex, raw, 'check_not_failed')
      continue
    }
    const policy = ISSUE_POLICY[boundCheck.checkId]
    if (!policy || candidate.code !== policy.code || candidate.severity !== policy.severity) {
      drop(candidateIndex, raw, 'policy_escalation')
      continue
    }
    const parsedEvidence = (() => {
      try { return reviewEvidenceSchema.safeParse(toJsonValue(candidate.evidence)) } catch { return null }
    })()
    if (!parsedEvidence || !parsedEvidence.success
      || canonicalize(parsedEvidence.data) !== canonicalize(boundCheck.evidence)) {
      drop(candidateIndex, raw, 'evidence_mismatch')
      continue
    }
    const confidence = Math.min(candidate.confidence, boundCheck.confidence)
    if (confidence < MIN_ISSUE_CONFIDENCE) {
      drop(candidateIndex, raw, 'low_confidence')
      continue
    }
    const key = `${boundCheck.checkId}:${policy.code}`
    if (accepted.has(key)) {
      drop(candidateIndex, raw, 'duplicate_issue')
      continue
    }
    accepted.add(key)
    issues.push(reviewIssueSchema.parse({
      code: policy.code,
      severity: policy.severity,
      confidence,
      check: boundCheck,
      evidence: boundCheck.evidence,
    }))
  }

  return parseCritique({ schemaVersion: 1, reviewerVersion, checks, issues, droppedIssues })
}

const MAX_SOURCE_BYTES = 40 * 1024 * 1024
const MAX_SOURCE_PIXELS = 40_000_000
const ANALYSIS_SIZE = 512
const MIN_RESOLUTION = 512
const MAX_ASPECT_RATIO = 4
const MIN_FOREGROUND_RATIO = 0.0005
const MIN_CONTENT_BOUNDS_RATIO = 0.35
const MAX_EDGE_FOREGROUND_RATIO = 0.08

class InspectionFailure extends Error {
  constructor(readonly reason: string) { super(reason) }
}

function unsupportedChecks(): ReviewCheck[] {
  return [
    check('visible_text', 'unsupported', 0, [['reason', 'ocr_not_configured']], 'not_configured'),
    check('watermark', 'unsupported', 0, [['reason', 'watermark_detection_not_configured']], 'not_configured'),
    check('blur', 'unsupported', 0, [['reason', 'blur_detection_not_configured']], 'not_configured'),
    // 缺失维度必须显式留痕：receipt 里「没提到」会被误读成「没问题」。
    check('color_fidelity', 'unsupported', 0, [['reason', 'color_fidelity_not_configured']], 'not_configured'),
    check('silhouette_fidelity', 'unsupported', 0, [['reason', 'silhouette_fidelity_not_configured']], 'not_configured'),
    check('body_anatomy', 'unsupported', 0, [['reason', 'body_anatomy_not_configured']], 'not_configured'),
    check('aesthetic_quality', 'unsupported', 0, [['reason', 'aesthetic_quality_not_configured']], 'not_configured'),
    check('multimodal_quality', 'unsupported', 0, [['reason', 'q3_multimodal_channel_not_approved']], 'not_configured'),
  ]
}

function unavailableChecks(
  reason: string,
  decodableStatus: Extract<ReviewCheckStatus, 'failed' | 'unknown'>,
): ReviewCheck[] {
  const unavailable = (checkId: ReviewCheckId) => check(checkId, 'unknown', 0, [['reason', reason]])
  return [
    check('image_decodable', decodableStatus, decodableStatus === 'failed' ? 1 : 0, [['reason', reason]]),
    unavailable('dimension_match'),
    unavailable('resolution'),
    unavailable('aspect_ratio'),
    unavailable('visible_content'),
    unavailable('blank_border'),
    unavailable('edge_crop'),
    ...unsupportedChecks(),
  ]
}

/** 只用于 E1 侧读图等瞬时不可用；调用方必须把结果标记为 transient，不能写进计算缓存。 */
export function createUnavailableCritique(
  reason: 'source_unavailable',
  reviewerVersion = E1_REVIEWER_VERSION,
): Critique {
  return createCritique(unavailableChecks(reason, 'unknown'), undefined, reviewerVersion)
}

interface PixelAnalysis {
  decodedWidth: number
  decodedHeight: number
  analysisWidth: number
  analysisHeight: number
  visibleRatio: number
  foregroundRatio: number
  contentBoundsRatio: number
  edgeForegroundRatio: number
}

async function inspectPixels(source: Buffer): Promise<PixelAnalysis> {
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'warning' }).metadata()
  } catch {
    throw new InspectionFailure('decode_failed')
  }
  const swapped = (metadata.orientation ?? 1) >= 5 && (metadata.orientation ?? 1) <= 8
  const decodedWidth = swapped ? metadata.height ?? 0 : metadata.width ?? 0
  const decodedHeight = swapped ? metadata.width ?? 0 : metadata.height ?? 0
  if (!Number.isSafeInteger(decodedWidth) || !Number.isSafeInteger(decodedHeight)
    || decodedWidth <= 0 || decodedHeight <= 0 || decodedWidth * decodedHeight > MAX_SOURCE_PIXELS) {
    throw new InspectionFailure('pixel_limit_or_dimensions_invalid')
  }

  let raw: { data: Buffer; info: sharp.OutputInfo }
  try {
    raw = await sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'warning' })
      .rotate()
      .toColourspace('srgb')
      .resize({ width: ANALYSIS_SIZE, height: ANALYSIS_SIZE, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw new InspectionFailure('decode_failed')
  }

  const { width, height, channels } = raw.info
  if (channels !== 4 || width <= 0 || height <= 0) throw new InspectionFailure('pixel_output_invalid')
  const total = width * height
  const edgeDepth = Math.max(1, Math.floor(Math.min(width, height) * 0.02))
  let edgePixels = 0
  let edgeForeground = 0
  let visible = 0
  let foreground = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels
      const r = raw.data[offset]
      const g = raw.data[offset + 1]
      const b = raw.data[offset + 2]
      const alpha = raw.data[offset + 3]
      const isVisible = alpha > 8
      const isForeground = isVisible && !(r >= 248 && g >= 248 && b >= 248)
      const isEdge = x < edgeDepth || y < edgeDepth || x >= width - edgeDepth || y >= height - edgeDepth
      if (isVisible) visible++
      if (isEdge) edgePixels++
      if (!isForeground) continue
      foreground++
      if (isEdge) edgeForeground++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  const boundsArea = foreground > 0 ? (maxX - minX + 1) * (maxY - minY + 1) : 0
  return {
    decodedWidth,
    decodedHeight,
    analysisWidth: width,
    analysisHeight: height,
    visibleRatio: visible / total,
    foregroundRatio: foreground / total,
    contentBoundsRatio: boundsArea / total,
    edgeForegroundRatio: edgePixels > 0 ? edgeForeground / edgePixels : 0,
  }
}

export interface DeterministicCriticInput {
  source: Buffer
  expectedWidth: number
  expectedHeight: number
  reviewerVersion?: string
}

/** 只解码已注入的结果字节，不读取 URL、不调用供应商；失败状态不会伪装成“未发现”。 */
export async function inspectDeterministicImage(input: DeterministicCriticInput): Promise<Critique> {
  if (!Number.isSafeInteger(input.expectedWidth) || input.expectedWidth <= 0
    || !Number.isSafeInteger(input.expectedHeight) || input.expectedHeight <= 0) {
    throw new TypeError('invalid_expected_dimensions')
  }
  const reviewerVersion = input.reviewerVersion ?? E1_REVIEWER_VERSION
  if (!Buffer.isBuffer(input.source) || input.source.length === 0 || input.source.length > MAX_SOURCE_BYTES) {
    return createCritique(unavailableChecks('source_bytes_invalid', 'failed'), undefined, reviewerVersion)
  }

  let pixels: PixelAnalysis
  try {
    // 结论不得由墙钟决定：输入字节与像素上限已经界定最坏解码代价，
    // 超时判定只会让同一字节在不同负载下给出不同 verdict，并让瞬时抖动进入缓存。
    pixels = await inspectPixels(input.source)
  } catch (error) {
    const reason = error instanceof InspectionFailure ? error.reason : 'decode_failed'
    return createCritique(unavailableChecks(reason, 'failed'), undefined, reviewerVersion)
  }

  const ratio = Math.max(pixels.decodedWidth / pixels.decodedHeight, pixels.decodedHeight / pixels.decodedWidth)
  const dimensionMatch = pixels.decodedWidth === input.expectedWidth && pixels.decodedHeight === input.expectedHeight
  const lowResolution = Math.min(pixels.decodedWidth, pixels.decodedHeight) < MIN_RESOLUTION
  const hasVisibleContent = pixels.visibleRatio > 0.005 && pixels.foregroundRatio > MIN_FOREGROUND_RATIO
  const excessiveBlankBorder = hasVisibleContent && pixels.contentBoundsRatio < MIN_CONTENT_BOUNDS_RATIO
  const touchesEdge = hasVisibleContent && pixels.edgeForegroundRatio > MAX_EDGE_FOREGROUND_RATIO
  const checks: ReviewCheck[] = [
    check('image_decodable', 'passed', 1, [
      ['decoded_width', pixels.decodedWidth],
      ['decoded_height', pixels.decodedHeight],
      ['analysis_width', pixels.analysisWidth],
      ['analysis_height', pixels.analysisHeight],
    ]),
    check('dimension_match', dimensionMatch ? 'passed' : 'failed', 1, [
      ['decoded_width', pixels.decodedWidth],
      ['decoded_height', pixels.decodedHeight],
      ['expected_width', input.expectedWidth],
      ['expected_height', input.expectedHeight],
    ]),
    check('resolution', lowResolution ? 'failed' : 'passed', 1, [
      ['short_edge', Math.min(pixels.decodedWidth, pixels.decodedHeight)],
      ['minimum_short_edge', MIN_RESOLUTION],
    ]),
    check('aspect_ratio', ratio > MAX_ASPECT_RATIO ? 'failed' : 'passed', 1, [
      ['aspect_ratio', Number(ratio.toFixed(6))],
      ['maximum_aspect_ratio', MAX_ASPECT_RATIO],
    ]),
    check('visible_content', hasVisibleContent ? 'passed' : 'failed', 0.98, [
      ['visible_ratio', Number(pixels.visibleRatio.toFixed(6))],
      ['foreground_ratio', Number(pixels.foregroundRatio.toFixed(6))],
      ['minimum_foreground_ratio', MIN_FOREGROUND_RATIO],
    ]),
    check('blank_border', excessiveBlankBorder ? 'failed' : 'passed', 0.8, [
      ['content_bounds_ratio', Number(pixels.contentBoundsRatio.toFixed(6))],
      ['minimum_content_bounds_ratio', MIN_CONTENT_BOUNDS_RATIO],
    ]),
    check('edge_crop', touchesEdge ? 'failed' : 'passed', 0.75, [
      ['edge_foreground_ratio', Number(pixels.edgeForegroundRatio.toFixed(6))],
      ['maximum_edge_foreground_ratio', MAX_EDGE_FOREGROUND_RATIO],
    ]),
    ...unsupportedChecks(),
  ]
  return createCritique(checks, undefined, reviewerVersion)
}
