import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { canonicalize } from '@/lib/agent/contracts'
import {
  assertGroundedCritique,
  createCritique,
  createUnavailableCritique,
  inspectDeterministicImage,
  parseCritique,
} from './critic'

async function centeredSubject(width = 800, height = 1_000): Promise<Buffer> {
  const subjectWidth = Math.round(width * 0.75)
  const subjectHeight = Math.round(height * 0.8)
  const subject = await sharp({
    create: { width: subjectWidth, height: subjectHeight, channels: 4, background: '#20242a' },
  }).png().toBuffer()
  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite([{ input: subject, left: Math.floor((width - subjectWidth) / 2), top: Math.floor((height - subjectHeight) / 2) }])
    .png()
    .toBuffer()
}

test('确定性 Critic 只声明真正执行的像素检查，未接能力显式 unsupported', async () => {
  const critique = await inspectDeterministicImage({
    source: await centeredSubject(),
    expectedWidth: 800,
    expectedHeight: 1_000,
  })
  assert.deepEqual(critique.issues, [])
  for (const checkId of ['image_decodable', 'dimension_match', 'resolution', 'aspect_ratio', 'visible_content', 'blank_border', 'edge_crop']) {
    assert.equal(critique.checks.find((check) => check.checkId === checkId)?.status, 'passed')
  }
  for (const checkId of ['visible_text', 'watermark', 'blur', 'color_fidelity',
    'silhouette_fidelity', 'body_anatomy', 'aesthetic_quality', 'multimodal_quality']) {
    const check = critique.checks.find((candidate) => candidate.checkId === checkId)
    assert.equal(check?.status, 'unsupported')
    assert.equal(check?.source, 'not_configured')
  }
})

test('透明空图、损坏图和低分辨率分别产生 grounded blocker/warning', async () => {
  const transparent = await sharp({
    create: { width: 800, height: 1_000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer()
  const empty = await inspectDeterministicImage({ source: transparent, expectedWidth: 800, expectedHeight: 1_000 })
  assert.equal(empty.issues.some((issue) => issue.code === 'empty_visible_content' && issue.severity === 'blocker'), true)

  const damaged = await inspectDeterministicImage({ source: Buffer.from('not-an-image'), expectedWidth: 800, expectedHeight: 1_000 })
  assert.equal(damaged.issues.some((issue) => issue.code === 'image_unreadable' && issue.severity === 'blocker'), true)
  assert.equal(damaged.checks.find((check) => check.checkId === 'resolution')?.status, 'unknown')

  const small = await inspectDeterministicImage({
    source: await centeredSubject(400, 500),
    expectedWidth: 400,
    expectedHeight: 500,
  })
  assert.equal(small.issues.some((issue) => issue.code === 'low_resolution' && issue.severity === 'warning'), true)
})

test('外部 proposals 只能追加：空 proposals 不能吞掉已失败检查的确定性 issue', async () => {
  const baseline = await inspectDeterministicImage({
    source: await centeredSubject(400, 500),
    expectedWidth: 400,
    expectedHeight: 500,
  })
  assert.equal(baseline.checks.find((check) => check.checkId === 'resolution')?.status, 'failed')
  const suppressed = createCritique(baseline.checks, [])
  assert.deepEqual(suppressed.issues.map((issue) => issue.code), ['low_resolution'])
  assert.deepEqual(suppressed.droppedIssues, [])
})

test('同一字节重复检查产生逐字节相同的 critique（结论不依赖墙钟）', async () => {
  const source = await centeredSubject(900, 1_200)
  const first = await inspectDeterministicImage({ source, expectedWidth: 900, expectedHeight: 1_200 })
  const second = await inspectDeterministicImage({ source, expectedWidth: 900, expectedHeight: 1_200 })
  assert.equal(canonicalize(first), canonicalize(second))
})

test('未 grounded 的伪造 issue 在解析边界即 fail closed', async () => {
  const baseline = await inspectDeterministicImage({
    source: await centeredSubject(),
    expectedWidth: 800,
    expectedHeight: 1_000,
  })
  const decodable = baseline.checks.find((check) => check.checkId === 'image_decodable')!
  const forged = {
    schemaVersion: 1,
    reviewerVersion: baseline.reviewerVersion,
    checks: baseline.checks,
    droppedIssues: [],
    issues: [{
      code: 'image_unreadable',
      severity: 'blocker',
      confidence: 1,
      check: { ...decodable, status: 'failed' },
      evidence: decodable.evidence,
    }],
  }
  assert.throws(() => parseCritique(forged), /ungrounded_issue_check_mismatch/)
  assert.throws(() => assertGroundedCritique(forged as never), /ungrounded_issue/)
})

test('裸分、缺 evidence、未知/未失败 check 和 severity 升级全部 dropped 留痕', async () => {
  const baseline = await inspectDeterministicImage({
    source: await centeredSubject(400, 500),
    expectedWidth: 400,
    expectedHeight: 500,
  })
  const resolution = baseline.checks.find((check) => check.checkId === 'resolution')!
  const dimension = baseline.checks.find((check) => check.checkId === 'dimension_match')!
  const valid = {
    code: 'low_resolution',
    severity: 'warning',
    confidence: 1,
    check: { checkId: 'resolution', status: 'failed' },
    evidence: resolution.evidence,
  }
  const critique = createCritique(baseline.checks, [
    { score: 0.01 },
    { code: 'low_resolution', severity: 'warning', confidence: 1,
      check: { checkId: 'resolution', status: 'failed' } },
    { ...valid, check: { checkId: 'imaginary_check', status: 'failed' } },
    { code: 'dimension_mismatch', severity: 'blocker', confidence: 1,
      check: { checkId: 'dimension_match', status: 'passed' }, evidence: dimension.evidence },
    { ...valid, severity: 'blocker' },
    { ...valid, evidence: { schemaVersion: 1, values: [{ name: 'short_edge', value: 1 }] } },
    valid,
    valid,
  ])
  assert.deepEqual(critique.issues.map((issue) => issue.code), ['low_resolution'])
  // 确定性候选先入列，因此两条合法 proposal 都只能作为 duplicate 留痕。
  assert.deepEqual(critique.droppedIssues.map((issue) => issue.reason), [
    'invalid_issue',
    'missing_evidence',
    'unknown_check',
    'check_not_failed',
    'policy_escalation',
    'evidence_mismatch',
    'duplicate_issue',
    'duplicate_issue',
  ])
})

test('读图不可用是 UNREVIEWED 前置事实，不伪装成未发现问题', () => {
  const critique = createUnavailableCritique('source_unavailable')
  assert.equal(critique.issues.length, 0)
  assert.equal(critique.checks.find((check) => check.checkId === 'image_decodable')?.status, 'unknown')
})
