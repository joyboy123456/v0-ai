import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePhotoFissionParams } from '../../photo-fission-service'
import { paramsDigest } from '../../../agent/contracts'

const input = {
  model: 'nano-banana-2', category: 'childrens', childrensCategory: 'pants',
  hasFrontDetail: false, hasBackDetail: false,
  imageRatio: '3:4', resolution: '2k', resultCount: 9,
}

test('服务端冻结裤装 seed 后整个分镜和参数摘要可重放，客户端 seed 不生效', async (t) => {
  t.mock.method(Math, 'random', () => { throw new Error('冻结预览不得重新抽卡') })
  const first = normalizePhotoFissionParams(input, 1, ['asset_1'], { normalizationSeed: 'proposal_1:1' })
  const replay = normalizePhotoFissionParams({ ...input, pantsPoseDrawSeed: 'forged-seed' }, 1,
    ['asset_1'], { normalizationSeed: 'proposal_1:1' })
  assert.equal(first.pantsPoseDrawSeed, 'proposal_1:1')
  assert.deepEqual(first, replay)
  assert.equal(await paramsDigest('photo-fission', first), await paramsDigest('photo-fission', replay))
  assert.equal(first.shotPlan.length, first.resultCount)
})

test('旧表单仍独立抽卡；空的服务端 seed 不能悄悄回退随机规划', (t) => {
  const random = t.mock.method(Math, 'random', () => 0.5)
  const legacy = normalizePhotoFissionParams({ ...input, pantsPoseDrawSeed: 'client-seed' }, 1, ['asset_1'])
  assert.equal(legacy.pantsPoseDrawSeed, undefined)
  assert.ok(random.mock.callCount() > 0)
  assert.throws(() => normalizePhotoFissionParams(input, 1, ['asset_1'], { normalizationSeed: ' ' }), /种子无效/)
})
