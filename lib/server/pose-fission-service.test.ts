import assert from 'node:assert/strict'
import test from 'node:test'

import type { PoseFissionParams } from '../types.ts'
// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { buildPoseFissionPrompt, buildPoseFissionProviderInputs } from './pose-fission-prompt.ts'

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

test('四种姿势分支都明确只编辑 Image 1 的姿势', () => {
  const prompts = [prompt('full'), prompt('upper'), prompt('lower'), prompt('lower', true)]
  for (const value of prompts) {
    assert.match(value, /^TASK: POSE-ONLY IMAGE EDIT/)
    assert.match(value, /EDIT INSTRUCTION — THE ONLY ALLOWED CHANGE\nEdit Image 1\./)
    assert.match(value, /Image 1 supplies the person, garment, camera, lighting, and environment/)
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
  assert.match(value, /Preserve exactly the same shoes, socks, jewelry, bags, and ordinary accessories from Image 1/)
  assert.match(value, /Pose supports are the exception and must be restored/)
  assert.match(value, /natural garment folds, tension, occlusion, hair movement, contact shadows/)
  assert.match(value, /must not redesign the person or the garment/)
})

test('姿势需要支撑时还原道具，服装鞋子和普通配饰仍跟主图', () => {
  const value = prompt('full')
  assert.match(value, /restore that support so the pose is complete/)
  assert.match(value, /A seated pose needs a seat/)
  assert.match(value, /A lean needs the wall, pillar, or surface/)
  assert.doesNotMatch(value, /chair, stool, step, or railing/)
  assert.match(value, /Keep clothing, footwear, socks, jewelry, bags, and ordinary accessories from Image 1/)
  assert.match(value, /Those are not pose supports/)
})

test('禁止混合原姿势或镜像目标姿势', () => {
  const value = prompt('full')
  assert.match(value, /Do not average, blend, or compromise between the original pose in Image 1 and the target pose in Image 2/)
  assert.match(value, /Do not mirror, reverse, or swap the target pose/)
})

test('锁定图1环境光影，同时允许新姿势必需的接触阴影', () => {
  const value = prompt('full')
  assert.match(value, /lighting direction and color, existing environment shadows/)
  assert.match(value, /contact shadows.*physically required by the new pose/)
  assert.doesNotMatch(value, /exact same shadows/)
})

test('四种素材组合的 Provider 图片、标签和 Prompt 角色逐项一致', () => {
  const combinations = [
    {
      front: false,
      back: false,
      taskImages: ['main'],
      providerImages: ['main', 'pose'],
      evidenceRoles: [],
    },
    {
      front: true,
      back: false,
      taskImages: ['main', 'front'],
      providerImages: ['main', 'pose', 'front'],
      evidenceRoles: ['FRONT GARMENT EVIDENCE ONLY'],
    },
    {
      front: false,
      back: true,
      taskImages: ['main', 'back'],
      providerImages: ['main', 'pose', 'back'],
      evidenceRoles: ['BACK GARMENT EVIDENCE ONLY'],
    },
    {
      front: true,
      back: true,
      taskImages: ['main', 'front', 'back'],
      providerImages: ['main', 'pose', 'front', 'back'],
      evidenceRoles: ['FRONT GARMENT EVIDENCE ONLY', 'BACK GARMENT EVIDENCE ONLY'],
    },
  ]
  for (const item of combinations) {
    const input = params({ hasFrontDetail: item.front, hasBackDetail: item.back })
    const value = buildPoseFissionPrompt(input, {
      id: 'pose_1', url: '/pose.jpg', name: 'test pose', bodyPart: 'lower',
    })
    const providerRequest = buildPoseFissionProviderInputs(input, item.taskImages, 'pose')
    const labels = providerRequest.inputImageLabels

    assert.deepEqual(providerRequest.inputImages, item.providerImages)
    assert.equal(labels.length, providerRequest.inputImages.length)
    assert.match(labels[0], /^IMAGE 1 — BASE MASTER IMAGE/)
    assert.match(labels[1], /^IMAGE 2 — TARGET POSE ONLY/)
    assert.match(labels[1], /supporting object or contacting surface/)
    assert.deepEqual(
      labels.slice(2).map((label) => label.match(/— ([A-Z ]+):/)?.[1]),
      item.evidenceRoles,
    )
    labels.forEach((label) => assert.ok(value.includes(`- ${label}`)))
  }
})

test('输入图片与细节标记不一致时拒绝发送错位的 Provider 请求', () => {
  assert.throws(
    () => buildPoseFissionProviderInputs(
      params({ hasFrontDetail: true, hasBackDetail: true }),
      ['main', 'front'],
      'pose',
    ),
    /输入图片与服装细节标记不一致/,
  )
})

test('下半身隐藏手臂分支还原腿部接触支撑、不还原手持物', () => {
  const hiddenLower = prompt('lower')
  const visibleLower = prompt('lower', true)

  assert.match(hiddenLower, /Do not restore handheld objects/)
  assert.match(hiddenLower, /A seated pose needs a seat/)
  assert.match(hiddenLower, /A lean needs the wall, pillar, or surface/)
  assert.match(visibleLower, /A hold or brace needs the object the hands or body use/)
  assert.doesNotMatch(visibleLower, /Do not restore handheld objects/)
})
