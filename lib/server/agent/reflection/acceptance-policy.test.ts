import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { E1_MIN_SCORE, evaluateAcceptancePolicy } from './acceptance-policy'
import { createUnavailableCritique, inspectDeterministicImage } from './critic'

async function image(width: number, height: number, background: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer()
}

async function centeredSubject(width = 800, height = 1_000): Promise<Buffer> {
  const subject = await sharp({
    create: {
      width: Math.round(width * 0.75),
      height: Math.round(height * 0.8),
      channels: 4,
      background: '#20242a',
    },
  }).png().toBuffer()
  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite([{ input: subject, left: Math.round(width * 0.125), top: Math.round(height * 0.1) }])
    .png()
    .toBuffer()
}

test('AcceptancePolicy 只按 grounded issue 确定性裁决 shadow 状态', async () => {
  const cleanCanvas = await image(800, 1_000, '#222222')
  const clean = await inspectDeterministicImage({ source: cleanCanvas, expectedWidth: 800, expectedHeight: 1_000 })
  const cleanDecision = evaluateAcceptancePolicy(clean)
  assert.equal(cleanDecision.disposition, 'SHADOW_WOULD_WARN', '主体铺满边缘应产生确定性裁切 warning')
  assert.equal(cleanDecision.reasonCodes[0], 'grounded_warning')

  const transparent = await sharp({
    create: { width: 800, height: 1_000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer()
  const blocked = evaluateAcceptancePolicy(await inspectDeterministicImage({
    source: transparent,
    expectedWidth: 800,
    expectedHeight: 1_000,
  }))
  assert.equal(blocked.disposition, 'SHADOW_WOULD_BLOCK')
  assert.equal(blocked.reasonCodes.includes('grounded_blocker'), true)

  const unavailable = evaluateAcceptancePolicy(createUnavailableCritique('source_unavailable'))
  assert.equal(unavailable.disposition, 'UNREVIEWED')
  assert.deepEqual(unavailable.issueCodes, [])
})

test('minimum score 只由多个 grounded warning 推导，外部不能直接提交分数', async () => {
  const narrow = await inspectDeterministicImage({
    source: await image(200, 1_000, '#222222'),
    expectedWidth: 200,
    expectedHeight: 1_000,
  })
  const decision = evaluateAcceptancePolicy(narrow)
  assert.equal(decision.disposition, 'SHADOW_WOULD_BLOCK')
  assert.equal(decision.reasonCodes.includes('minimum_score_not_met'), true)
  assert.equal(decision.score < decision.minimumScore, true)
})

test('SHADOW_PASS 必须同时暴露未评审维度，不能被读成质量通过', async () => {
  const clean = await inspectDeterministicImage({
    source: await centeredSubject(),
    expectedWidth: 800,
    expectedHeight: 1_000,
  })
  const decision = evaluateAcceptancePolicy(clean)
  assert.equal(decision.disposition, 'SHADOW_PASS')
  assert.equal(decision.reasonCodes.includes('supported_checks_passed'), true)
  assert.equal(decision.reasonCodes.includes('unsupported_checks_present'), true)
  assert.deepEqual(decision.unsupportedCheckIds, [
    'aesthetic_quality',
    'blur',
    'body_anatomy',
    'color_fidelity',
    'multimodal_quality',
    'silhouette_fidelity',
    'visible_text',
    'watermark',
  ])
})

test('同一 critique 与同一 policyVersion 必然得到同一结论，阈值不可外部改写', async () => {
  const narrow = await inspectDeterministicImage({
    source: await image(200, 1_000, '#222222'),
    expectedWidth: 200,
    expectedHeight: 1_000,
  })
  const first = evaluateAcceptancePolicy(narrow)
  const second = evaluateAcceptancePolicy(narrow, { policyVersion: first.policyVersion })
  assert.deepEqual(first, second)
  assert.equal(first.minimumScore, E1_MIN_SCORE)
  // 选项里不存在 minimumScore；即使调用方硬塞也不能改变裁决。
  const forcedOptions = { policyVersion: first.policyVersion, minimumScore: 0.01 } as never
  assert.deepEqual(evaluateAcceptancePolicy(narrow, forcedOptions), first)
})

test('未 grounded 的伪造 blocker 不能借 policy 边界生效', async () => {
  const clean = await inspectDeterministicImage({
    source: await centeredSubject(),
    expectedWidth: 800,
    expectedHeight: 1_000,
  })
  const decodable = clean.checks.find((check) => check.checkId === 'image_decodable')!
  const forged = {
    ...clean,
    issues: [{
      code: 'image_unreadable',
      severity: 'blocker' as const,
      confidence: 1,
      check: { ...decodable, status: 'failed' as const },
      evidence: decodable.evidence,
    }],
  }
  assert.throws(() => evaluateAcceptancePolicy(forged), /ungrounded_issue/)
})
