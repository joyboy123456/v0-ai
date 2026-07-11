import type { PoseBodyPart, PoseFissionParams, PoseMainArmVisibility } from '../types.ts'

interface PosePromptInput {
  id?: string
  url?: string
  name: string
  bodyPart: PoseBodyPart
}

export function buildPoseFissionPrompt(params: PoseFissionParams, pose: PosePromptInput): string {
  const totalImageCount = 2 + Number(params.hasFrontDetail) + Number(params.hasBackDetail)
  const armVisibility = params.lowerBodyMainArmVisibility ?? 'hidden'
  return [
    getEditInstruction(pose.bodyPart, armVisibility), '', 'REFERENCE IMAGE ROLES',
    `This request contains ${totalImageCount} images in the following order:`,
    '- Image 1 — PRIMARY SOURCE OF TRUTH FOR ALL VISUAL APPEARANCE. Preserve the same person, identity, body proportions, outfit, footwear, socks, ordinary accessories, background, lighting, framing, camera distance, and photographic appearance.',
    ...(params.hasFrontDetail ? ['- Image 2 — FRONT GARMENT DETAIL ONLY. Use it only to verify visible front product colors, materials, patterns, embroidery, seams, and construction. It provides no pose, person, footwear, background, framing, or lighting information.'] : []),
    ...(params.hasBackDetail ? [params.hasFrontDetail
      ? '- Image 3 — BACK GARMENT DETAIL ONLY. Use it only to verify visible back product colors, materials, patterns, embroidery, seams, and construction. It provides no pose, person, footwear, background, framing, or lighting information.'
      : '- Image 2 — BACK GARMENT DETAIL ONLY. Use it only to verify visible back product colors, materials, patterns, embroidery, seams, and construction. It provides no pose, person, footwear, background, framing, or lighting information.'] : []),
    `- Image ${totalImageCount} — POSE GEOMETRY ONLY. ${getPoseNote(pose.bodyPart, armVisibility)}`,
    '', 'PRODUCT CONSISTENCY — HIGH PRIORITY',
    'Preserve exactly the same garment from Image 1: the same silhouette, fit, looseness, length, leg width, waistband, seams, cuffs, folded hems, embroidery, patterns, logos, colors, fabric, texture, and construction. Natural folds and occlusion caused by the new pose are allowed, but the product design, dimensions, silhouette, and construction must not change.',
    'Preserve exactly the same shoes and socks from Image 1, including shoe type, shape, color, sole, material, and visible details. Footwear visible in the pose reference is not pose information and must not appear in the output.',
    '', 'ACTION PROPS AND SCENE',
    'A physical prop required to perform the target action may be transferred from the pose reference, such as a chair, stool, step, railing, or hand-held action prop. Clothing, footwear, socks, jewelry, bags worn as styling, and ordinary accessories are never action props. Keep the background, lighting direction, color tone, framing, and camera distance from Image 1. Allow only the minimum repositioning or canvas extension required for the target pose.',
    '', 'FINAL OUTPUT CHECK',
    'Return one photorealistic ecommerce product image containing only the person from Image 1. The target pose must be anatomically natural with realistic balance. Every visible product and styling detail must still belong to Image 1, not to the pose reference.',
    `Target pose name: ${pose.name}.`,
  ].join('\n')
}

export function buildPoseFissionInputImageLabels(params: PoseFissionParams): string[] {
  return [
    'IMAGE 1 — PRIMARY SOURCE OF TRUTH FOR ALL VISUAL APPEARANCE: person, garment, footwear, accessories, background, lighting, and framing.',
    ...(params.hasFrontDetail ? ['FRONT GARMENT DETAIL ONLY — no pose, person, footwear, background, or framing information.'] : []),
    ...(params.hasBackDetail ? ['BACK GARMENT DETAIL ONLY — no pose, person, footwear, background, or framing information.'] : []),
    'POSE GEOMETRY ONLY — IGNORE ALL CLOTHING, FOOTWEAR, SOCKS, ORDINARY ACCESSORIES, PERSON IDENTITY, BODY PROPORTIONS, BACKGROUND, AND LIGHTING.',
  ]
}

function getEditInstruction(bodyPart: PoseBodyPart, arms: PoseMainArmVisibility): string {
  if (bodyPart === 'full') return 'Edit Image 1. Change only the full-body pose to match the pose geometry in the final pose-reference image: body orientation, head direction, limb joint positions, hand actions, foot placement, and weight distribution. Keep all visual appearance from Image 1.'
  if (bodyPart === 'upper') return 'Edit Image 1. Change only the upper-body pose to match the final pose-reference image: torso orientation, shoulders, arms, hands, and head direction. Keep the lower-body stance, leg pose, foot placement, and footwear from Image 1; allow only minimal hip, knee, or ankle adjustment required for physically realistic balance.'
  return arms === 'visible'
    ? 'Edit Image 1. Change only the lower-body pose to match the final pose-reference image: hip, knee, ankle, and foot positions and angles, stance or seated state, walking geometry, and weight distribution. Because the original Image 1 crop permits visible arms or hands, also match the number, position, and action of visible hands from the pose reference with only the minimum necessary arm adjustment. Keep all visual appearance from Image 1.'
    : 'Edit Image 1. Change only the lower-body pose to match the final pose-reference image: hip, knee, ankle, and foot positions and angles, stance or seated state, walking geometry, and weight distribution. Image 1 contains no visible arms or hands, so its upper crop boundary is fixed: do not extend upward or generate any arms, hands, head, face, or additional upper-body content. Ignore hands and hand-dependent props in the pose reference. Allow only minimal extension to the sides or bottom when required by the leg pose.'
}

function getPoseNote(bodyPart: PoseBodyPart, arms: PoseMainArmVisibility): string {
  if (bodyPart === 'full') return 'Use only its full-body joint geometry, orientation, action, and genuinely required action props. Ignore its person identity, body proportions, clothing, footwear, socks, ordinary accessories, background, and lighting.'
  if (bodyPart === 'upper') return 'Use only its upper-body joint geometry, head direction, hand action, and genuinely required action props. Even if it is a full-body image, ignore its lower-body pose and all visual appearance.'
  return arms === 'visible'
    ? 'Use only its hip, knee, ankle, and foot geometry, weight distribution, visible hand action, and genuinely required action props. Ignore its person identity, body proportions, clothing, footwear, socks, ordinary accessories, background, and lighting.'
    : 'Use only its hip, knee, ankle, and foot geometry, weight distribution, and required body-support props such as a chair, stool, or step. Ignore all hands, arms, hand-dependent props, person identity, body proportions, clothing, footwear, socks, ordinary accessories, background, and lighting.'
}
