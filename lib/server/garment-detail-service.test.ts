import assert from 'node:assert/strict'
import test from 'node:test'

import type { GarmentDetailCategory, GarmentDetailParams } from '../types.ts'
import {
  buildGarmentDetailPrompt,
  buildGarmentDetailShotPlan,
  GarmentDetailParamsError,
  normalizeGarmentDetailParams,
  type GarmentDetailModelResolutionLike,
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
} from './garment-detail-service.ts'

// ---------------------------------------------------------------------------
// 测试替身：模型注册表解析（生产默认经动态 import 走真实注册表，测试注入）
// ---------------------------------------------------------------------------

const FAKE_MODEL_DEFINITIONS = {
  'std-v1': {
    algorithmModelId: 'std-v1',
    algorithmModelName: '标准版',
    tier: 'standard',
    resolutions: ['1k'],
  },
  'pro-v1': {
    algorithmModelId: 'pro-v1',
    algorithmModelName: '专业版',
    tier: 'professional',
    resolutions: ['2k', '4k'],
  },
} as const

function fakeResolveModel(alias: string): GarmentDetailModelResolutionLike {
  const definition =
    FAKE_MODEL_DEFINITIONS[alias as keyof typeof FAKE_MODEL_DEFINITIONS]
  if (!definition) {
    throw new GarmentDetailParamsError({
      code: 'INVALID_PARAMS',
      message: '模型档位无效，仅支持标准版（std-v1）或专业版（pro-v1）',
      retryable: false,
    })
  }
  return {
    definition: { ...definition, resolutions: [...definition.resolutions] },
    resolvedModelId:
      alias === 'std-v1' ? 'nano-banana-2-lite' : 'nano-banana-pro',
  }
}

const DEPS = { resolveModel: fakeResolveModel }

function rawParams(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: 'tops',
    algorithmModelId: 'pro-v1',
    // 以下字段均为客户端可伪造字段，服务端必须覆盖或剥离（PRD §6.4/§8.7）
    algorithmModelName: '客户端伪造模型名',
    modelTier: 'standard',
    resolution: '2k',
    imageRatio: '1:1',
    userPrompt: '柔和棚拍光，突出面料与走线',
    aiAppendDescription: false,
    referenceImageCount: 99,
    detailShots: [{ shotId: 'forged_1', label: '伪造镜头', referenceAssetId: null }],
    resultCount: 99,
    creditsCost: 5,
    mockRetryCount: 3,
    ...patch,
  }
}

function normalize(
  inputAssetIds: unknown,
  patch: Record<string, unknown> = {},
): Promise<GarmentDetailParams> {
  return normalizeGarmentDetailParams(rawParams(patch), inputAssetIds, DEPS)
}

async function assertInvalid(
  promise: Promise<unknown>,
  code: 'INVALID_PARAMS' | 'RESOLUTION_UNSUPPORTED' | 'MODEL_UNAVAILABLE',
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof GarmentDetailParamsError)
    assert.equal(error.code, code)
    return true
  })
}

// ---------------------------------------------------------------------------
// PRD §22.1 参数校验
// ---------------------------------------------------------------------------

test('仅 1 张主图时生成 1 个 Shot', async () => {
  const normalized = await normalize(['asset_main'])
  assert.equal(normalized.detailShots.length, 1)
  assert.equal(normalized.resultCount, 1)
  assert.equal(normalized.referenceImageCount, 0)
})

test('1 张参考图时生成 1 个 Shot', async () => {
  const normalized = await normalize(['asset_main', 'asset_ref_1'])
  assert.equal(normalized.detailShots.length, 1)
  assert.equal(normalized.detailShots[0].referenceAssetId, 'asset_ref_1')
})

test('2 张参考图时生成 2 个 Shot', async () => {
  const normalized = await normalize(['asset_main', 'asset_ref_1', 'asset_ref_2'])
  assert.equal(normalized.detailShots.length, 2)
  assert.equal(normalized.resultCount, 2)
})

test('3 张参考图时生成 3 个 Shot', async () => {
  const normalized = await normalize([
    'asset_main',
    'asset_ref_1',
    'asset_ref_2',
    'asset_ref_3',
  ])
  assert.equal(normalized.detailShots.length, 3)
  assert.equal(normalized.resultCount, 3)
})

test('4 张参考图（共 5 个素材）被拒绝', async () => {
  await assertInvalid(
    normalize(['a0', 'a1', 'a2', 'a3', 'a4']),
    'INVALID_PARAMS',
  )
})

test('空素材列表被拒绝', async () => {
  await assertInvalid(normalize([]), 'INVALID_PARAMS')
})

test('非法分类被拒绝', async () => {
  await assertInvalid(normalize(['asset_main'], { category: 'hat' }), 'INVALID_PARAMS')
})

test('非法比例被拒绝', async () => {
  await assertInvalid(
    normalize(['asset_main'], { imageRatio: '16:9' }),
    'INVALID_PARAMS',
  )
})

test('标准版选择 2K/4K 被拒绝（RESOLUTION_UNSUPPORTED，不静默降级）', async () => {
  await assertInvalid(
    normalize(['asset_main'], { algorithmModelId: 'std-v1', resolution: '2k' }),
    'RESOLUTION_UNSUPPORTED',
  )
  await assertInvalid(
    normalize(['asset_main'], { algorithmModelId: 'std-v1', resolution: '4k' }),
    'RESOLUTION_UNSUPPORTED',
  )
})

test('专业版选择 1K 被拒绝', async () => {
  await assertInvalid(
    normalize(['asset_main'], { algorithmModelId: 'pro-v1', resolution: '1k' }),
    'RESOLUTION_UNSUPPORTED',
  )
})

test('超过 103 个 Unicode 字符的提示词被拒绝（emoji 按 1 字计）', async () => {
  const within = '👗'.repeat(103)
  const beyond = '👗'.repeat(104)
  const ok = await normalize(['asset_main'], { userPrompt: within })
  assert.equal(ok.userPrompt, within)
  await assertInvalid(
    normalize(['asset_main'], { userPrompt: beyond }),
    'INVALID_PARAMS',
  )
})

test('服务端覆盖客户端伪造的 resultCount / referenceImageCount', async () => {
  const normalized = await normalize(['asset_main', 'asset_ref_1', 'asset_ref_2'])
  assert.equal(normalized.resultCount, 2)
  assert.equal(normalized.referenceImageCount, 2)
  assert.deepEqual(
    normalized.detailShots.map((shot) => shot.shotId),
    ['detail_1', 'detail_2'],
  )
})

test('服务端覆盖客户端伪造的 creditsCost / algorithmModelName 并剥离 mockRetryCount', async () => {
  const normalized = await normalize(['asset_main'])
  assert.equal(normalized.creditsCost, 0)
  assert.equal(normalized.algorithmModelName, '专业版')
  assert.equal(normalized.modelTier, 'professional')
  assert.equal(normalized.resolvedModelId, 'nano-banana-pro')
  assert.equal('mockRetryCount' in normalized, false)
  assert.equal(normalized.promptTemplateVersion, 'garment-detail-v1')
})

test('重复 assetId 被拒绝', async () => {
  await assertInvalid(
    normalize(['asset_main', 'asset_ref_1', 'asset_ref_1']),
    'INVALID_PARAMS',
  )
})

// 注：PRD §22.1「越权素材被拒绝」由 createTask 的素材存在性 + userId 所有权
// 校验统一执行（task-store.ts 对所有 feature 生效），不属于 normalize 的职责。

// ---------------------------------------------------------------------------
// PRD §22.1 Shot 规划
// ---------------------------------------------------------------------------

test('五类商品输出标签正确（与 PRD §5.3 表格一致）', () => {
  const expected: Record<GarmentDetailCategory, string[]> = {
    tops: ['领口细节', '袖口细节', '面料纹理'],
    bottoms: ['腰头细节', '走线细节', '面料纹理'],
    dress: ['领口细节', '裙摆细节', '面料纹理'],
    accessory: ['材质特写', '工艺细节', '质感纹理'],
    'shoes-bags': ['五金细节', '走线细节', '材质特写'],
  }
  for (const [category, labels] of Object.entries(expected)) {
    const shots = buildGarmentDetailShotPlan(category as GarmentDetailCategory, [
      'ref_1',
      'ref_2',
      'ref_3',
    ])
    assert.deepEqual(
      shots.map((shot) => shot.label),
      labels,
    )
  }
})

test('Shot ID 稳定为 detail_1～detail_3', () => {
  const shots = buildGarmentDetailShotPlan('tops', ['ref_1', 'ref_2', 'ref_3'])
  assert.deepEqual(
    shots.map((shot) => shot.shotId),
    ['detail_1', 'detail_2', 'detail_3'],
  )
})

test('每个 Shot 仅绑定自己的参考图', () => {
  const shots = buildGarmentDetailShotPlan('dress', ['ref_a', 'ref_b'])
  assert.equal(shots[0].referenceAssetId, 'ref_a')
  assert.equal(shots[1].referenceAssetId, 'ref_b')
})

test('无参考图时只生成 1 个 Shot 且 referenceAssetId=null', () => {
  const shots = buildGarmentDetailShotPlan('bottoms', [])
  assert.equal(shots.length, 1)
  assert.equal(shots[0].shotId, 'detail_1')
  assert.equal(shots[0].label, '腰头细节')
  assert.equal(shots[0].referenceAssetId, null)
})

// ---------------------------------------------------------------------------
// PRD §22.1 Prompt
// ---------------------------------------------------------------------------

async function promptFixture(
  patch: Record<string, unknown> = {},
  referenceAssetIds: string[] = ['asset_ref_1'],
) {
  const normalized = await normalize(['asset_main', ...referenceAssetIds], patch)
  const shot = normalized.detailShots[0]
  return {
    params: normalized,
    shot,
    withReference: buildGarmentDetailPrompt(shot, normalized, true),
    withoutReference: buildGarmentDetailPrompt(shot, normalized, false),
  }
}

test('图 1 被声明为唯一商品事实来源', async () => {
  const { withReference, withoutReference } = await promptFixture()
  assert.match(withReference, /图1是唯一的商品事实来源。/)
  assert.match(withoutReference, /图1是唯一的商品事实来源。/)
})

test('有参考图时包含图 2 的限制规则', async () => {
  const { withReference } = await promptFixture()
  assert.match(withReference, /图2仅用于参考局部镜头、构图、光线、景深和背景表现。/)
  assert.match(withReference, /不得复制图2中的商品、颜色、材质、Logo、文字、印花、纽扣或五金。/)
  assert.match(withReference, /最终商品必须来自图1。/)
})

test('无参考图时不出现图 2，改用自行设计构图指令', async () => {
  const { withoutReference } = await promptFixture()
  assert.doesNotMatch(withoutReference, /图2/)
  assert.match(withoutReference, /本次没有构图参考图，请根据目标细节部位自行设计克制、真实的电商微距构图。/)
})

test('用户提示词放在低优先级区域；空提示词写「无」', async () => {
  const { withReference, params } = await promptFixture()
  const sectionIndex = withReference.indexOf('【用户附加要求】')
  assert.ok(sectionIndex > withReference.indexOf('【禁止】'))
  assert.ok(sectionIndex > withReference.indexOf('【必须保持】'))
  assert.match(
    withReference.slice(sectionIndex),
    new RegExp(`【用户附加要求】\\n${params.userPrompt}`),
  )

  const emptyPrompt = await promptFixture({ userPrompt: '   ' })
  const emptySectionIndex = emptyPrompt.withReference.indexOf('【用户附加要求】')
  assert.match(
    emptyPrompt.withReference.slice(emptySectionIndex),
    /【用户附加要求】\n无\n/,
  )
})

test('AI 追加描述开关正确控制观察指令', async () => {
  const enabled = await promptFixture({ aiAppendDescription: true })
  assert.match(enabled.withReference, /生成前先观察图1中与目标部位相关的可见事实/)
  assert.match(enabled.withReference, /不要将猜测当作商品事实。/)

  const disabled = await promptFixture({ aiAppendDescription: false })
  assert.doesNotMatch(disabled.withReference, /生成前先观察图1/)
})

test('分辨率不依赖 Prompt 词语传递', async () => {
  const { withReference } = await promptFixture({ resolution: '4k' })
  assert.doesNotMatch(withReference, /8K|ultra HD|masterpiece|hyper detailed/i)
  assert.doesNotMatch(withReference, /4K|2K|1K/)
})
