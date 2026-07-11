import assert from 'node:assert/strict'
import test from 'node:test'

import type { PoseFissionParams } from '../types.ts'
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { buildPoseFissionInputImageLabels, buildPoseFissionPrompt } from './pose-fission-prompt.ts'

function params(patch: Partial<PoseFissionParams> = {}): PoseFissionParams {
  return {
    model: 'gemini-3.1-flash-image-preview',
    poses: [],
    hasFrontDetail: false,
    hasBackDetail: false,
    lowerBodyMainArmVisibility: 'hidden',
    imageRatio: '3:4',
    resolution: '4k',
    resultCount: 1,
    creditsCost: 0,
    ...patch,
  }
}

function prompt(bodyPart: 'full' | 'upper' | 'lower', visible = false): string {
  return buildPoseFissionPrompt(
    params({ lowerBodyMainArmVisibility: visible ? 'visible' : 'hidden' }),
    { id: 'pose_1', url: '/pose.jpg', name: 'test pose', bodyPart },
  )
}

test('四种姿势分支都以局部编辑 Image 1 开头', () => {
  const prompts = [prompt('full'), prompt('upper'), prompt('lower'), prompt('lower', true)]
  for (const value of prompts) {
    assert.match(value, /^Edit Image 1\./)
    assert.doesNotMatch(value, /儿童|童装/)
  }
  assert.match(prompts[1], /Keep the lower-body stance/)
  assert.match(prompts[2], /do not extend upward or generate any arms/)
  assert.match(prompts[3], /match the number, position, and action of visible hands/)
})

test('裤型、裤脚刺绣和主图鞋子属于高优先级硬锁定', () => {
  const value = prompt('lower')
  assert.match(value, /same silhouette, fit, looseness, length, leg width/)
  assert.match(value, /cuffs, folded hems, embroidery/)
  assert.match(value, /Preserve exactly the same shoes and socks from Image 1/)
  assert.match(value, /Footwear visible in the pose reference is not pose information/)
  assert.match(value, /Natural folds and occlusion.*are allowed/)
  assert.match(value, /product design, dimensions, silhouette, and construction must not change/)
})

test('允许必要动作道具，但服装鞋子和普通配饰永远不是动作道具', () => {
  const value = prompt('full')
  assert.match(value, /chair, stool, step, railing, or hand-held action prop/)
  assert.match(value, /Clothing, footwear, socks, jewelry, bags worn as styling, and ordinary accessories are never action props/)
})

test('正背细节图组合与姿势图编号严格匹配输入顺序', () => {
  const combinations = [
    { front: false, back: false, poseIndex: 2 },
    { front: true, back: false, poseIndex: 3 },
    { front: false, back: true, poseIndex: 3 },
    { front: true, back: true, poseIndex: 4 },
  ]
  for (const item of combinations) {
    const input = params({ hasFrontDetail: item.front, hasBackDetail: item.back })
    const value = buildPoseFissionPrompt(input, {
      id: 'pose_1', url: '/pose.jpg', name: 'test pose', bodyPart: 'lower',
    })
    const labels = buildPoseFissionInputImageLabels(input)
    assert.equal(labels.length, item.poseIndex)
    assert.match(value, new RegExp(`Image ${item.poseIndex} — POSE GEOMETRY ONLY`))
    assert.match(labels.at(-1) ?? '', /POSE GEOMETRY ONLY — IGNORE ALL CLOTHING, FOOTWEAR/)
  }
})
