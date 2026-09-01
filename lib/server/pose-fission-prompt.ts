import type { PoseBodyPart, PoseFissionParams, PoseMainArmVisibility } from '../types.ts'

interface PosePromptInput {
  id?: string
  url?: string
  name: string
  bodyPart: PoseBodyPart
}

export function buildPoseFissionPrompt(params: PoseFissionParams, pose: PosePromptInput): string {
  const inputImageLabels = buildPoseFissionInputImageLabels(params)
  const armVisibility = params.lowerBodyMainArmVisibility ?? 'hidden'

  return [
    'TASK: POSE-ONLY IMAGE EDIT',
    '',
    'REFERENCE MAP — EACH IMAGE HAS EXACTLY ONE ROLE',
    `This request contains ${inputImageLabels.length} images in the following order:`,
    ...inputImageLabels.map((label) => `- ${label}`),
    '',
    'EDIT INSTRUCTION — THE ONLY ALLOWED CHANGE',
    getEditInstruction(pose.bodyPart, armVisibility),
    getPoseScope(pose.bodyPart, armVisibility),
    'Make the person from Image 1 perform the complete target pose from Image 2 within the editable body region. Do not average, blend, or compromise between the original pose in Image 1 and the target pose in Image 2.',
    'Match anatomical left and right exactly as shown in Image 2. Do not mirror, reverse, or swap the target pose.',
    '',
    'PRESERVATION BOUNDARY — EVERYTHING OUTSIDE THE EDITABLE POSE REGION COMES FROM IMAGE 1',
    'Preserve the person from Image 1: the exact same identity, face, expression, hairstyle, skin tone, body build, and body proportions.',
    'Preserve the scene and photography from Image 1: the same environment, lighting direction and color, existing environment shadows, color tone, camera viewpoint, lens perspective, framing, aspect ratio, and photographic style. If the target pose physically requires a missing support or contacting surface, restore that support into Image 1\'s scene instead of leaving the person floating.',
    'Preserve exactly the same garment from Image 1: the same silhouette, fit, looseness, length, leg width, waistband, seams, cuffs, folded hems, embroidery, patterns, logos, colors, fabric, texture, and construction.',
    'Preserve exactly the same shoes, socks, jewelry, bags, and ordinary accessories from Image 1, including their type, shape, color, material, and visible details.',
    'Allow only the natural garment folds, tension, occlusion, hair movement, contact shadows, and minimum subject repositioning or canvas extension physically required by the new pose. These necessary physical effects must not redesign the person or the garment.',
    '',
    'ATTRIBUTE SOURCES AND CONFLICT RULES',
    '- Appearance, identity, body proportions, garment, footwear, accessories, camera, lighting, framing, and style: Image 1 always wins.',
    '- Pose geometry inside the editable body region: Image 2 always wins.',
    '- Supporting objects and contacting surfaces required to perform that pose: restore them from Image 2\'s pose, then light and style them to belong in Image 1.',
    '- Garment details hidden or unclear in Image 1: the optional garment evidence images may clarify the same product only; Image 1 wins if they conflict.',
    '- Clothing, footwear, socks, ordinary accessories, person identity, body proportions, camera, lighting, color, and style from Image 2 must not appear in the output. Pose supports are the exception and must be restored as specified below.',
    '',
    'ACTION SUPPORTS',
    getActionSupportRule(pose.bodyPart, armVisibility),
    '',
    'OUTPUT',
    'Return one seamless photorealistic ecommerce image of the person from Image 1, not a collage, comparison, split screen, or text explanation. Do not replace Image 1\'s environment with Image 2\'s room. The target pose must be anatomically natural with realistic balance, including any restored supports.',
    'FINAL RULE: Image 1 supplies the person, garment, camera, lighting, and environment. Image 2 supplies the target pose and any support that pose needs. Restore those supports so the pose is physically complete.',
    `Target pose name: ${pose.name}.`,
  ].join('\n')
}

export function buildPoseFissionInputImageLabels(params: PoseFissionParams): string[] {
  const labels = [
    'IMAGE 1 — BASE MASTER IMAGE / PRIMARY SOURCE OF TRUTH FOR EVERYTHING EXCEPT THE EDITABLE POSE REGION: person identity, face, expression, hairstyle, body proportions, garment, footwear, socks, accessories, background, lighting, camera, framing, photographic style, and pose outside the editable body region.',
    'IMAGE 2 — TARGET POSE ONLY: within the editable body region defined below, use its body orientation, joint positions, limb placement, hand and foot actions, weight distribution, balance, and any supporting object or contacting surface the pose physically requires. Ignore clothing, identity, and scene styling.',
  ]

  if (params.hasFrontDetail) {
    labels.push(`IMAGE ${labels.length + 1} — FRONT GARMENT EVIDENCE ONLY: use only to clarify visible details of the same product from Image 1; it provides no pose, person, footwear, accessories, background, camera, lighting, or style information.`)
  }
  if (params.hasBackDetail) {
    labels.push(`IMAGE ${labels.length + 1} — BACK GARMENT EVIDENCE ONLY: use only to clarify visible details of the same product from Image 1; it provides no pose, person, footwear, accessories, background, camera, lighting, or style information.`)
  }

  return labels
}

/**
 * inputImages 的既有顺序是主图、可选正面细节、可选背面细节。
 * Provider 契约固定为主图、当前姿势图、可选服装细节图，标签与图片逐项绑定。
 * 放在本模块是为了让 Provider 顺序和 Prompt 中的角色表共享同一契约入口。
 */
export function buildPoseFissionProviderInputs(
  params: PoseFissionParams,
  inputImages: string[],
  poseReferenceImage: string,
): { inputImages: string[]; inputImageLabels: string[] } {
  const [mainImage, ...garmentEvidenceImages] = inputImages
  if (!mainImage) {
    throw new Error('姿势裂变缺少用户主图')
  }

  const expectedTaskImageCount =
    1 + Number(params.hasFrontDetail) + Number(params.hasBackDetail)
  if (inputImages.length !== expectedTaskImageCount) {
    throw new Error('姿势裂变输入图片与服装细节标记不一致')
  }

  const providerInputImages = [mainImage, poseReferenceImage, ...garmentEvidenceImages]
  const inputImageLabels = buildPoseFissionInputImageLabels(params)
  if (providerInputImages.length !== inputImageLabels.length) {
    throw new Error('姿势裂变 Provider 图片与标签数量不一致')
  }

  return { inputImages: providerInputImages, inputImageLabels }
}

function getEditInstruction(bodyPart: PoseBodyPart, arms: PoseMainArmVisibility): string {
  if (bodyPart === 'full') {
    return 'Edit Image 1. Change only its full-body pose to match Image 2: body orientation, head direction, torso and shoulder alignment, all limb joint positions, hand actions, foot placement, contact relationships, and weight distribution.'
  }
  if (bodyPart === 'upper') {
    return 'Edit Image 1. Change only its upper-body pose to match Image 2: head direction, torso orientation, shoulders, arms, and hands. Keep the lower-body stance, leg pose, foot placement, and footwear from Image 1; allow only the minimum hip, knee, or ankle adjustment required for physically realistic balance.'
  }
  return arms === 'visible'
    ? 'Edit Image 1. Change only its lower-body pose to match Image 2: hip, knee, ankle, and foot positions and angles, stance or seated state, walking geometry, and weight distribution. Because the original Image 1 crop includes visible arms or hands, also match the number, position, and action of visible hands from Image 2 with only the minimum necessary arm adjustment.'
    : 'Edit Image 1. Change only its lower-body pose to match Image 2: hip, knee, ankle, and foot positions and angles, stance or seated state, walking geometry, and weight distribution. Image 1 contains no visible arms or hands, so its upper crop boundary is fixed: do not extend upward or generate any arms, hands, head, face, or additional upper-body content. Ignore hands and hand-dependent supports in Image 2. Allow only minimal extension to the sides or bottom when required by the leg pose.'
}

function getPoseScope(bodyPart: PoseBodyPart, arms: PoseMainArmVisibility): string {
  if (bodyPart === 'full') {
    return 'For this full-body edit, Image 2 controls only full-body joint geometry, orientation, action, balance, and pose-contact geometry.'
  }
  if (bodyPart === 'upper') {
    return 'For this upper-body edit, Image 2 controls only head direction, torso and shoulder geometry, arm and hand joint geometry, action, balance, and pose-contact geometry. Ignore its lower-body pose.'
  }
  return arms === 'visible'
    ? 'For this lower-body edit, Image 2 controls only hip, knee, ankle, and foot geometry, weight distribution, visible hand action, and pose-contact geometry.'
    : 'For this lower-body edit, Image 2 controls only hip, knee, ankle, and foot geometry, weight distribution, and body-support contact geometry. Ignore all hands, arms, and hand-dependent supports.'
}

function getActionSupportRule(bodyPart: PoseBodyPart, arms: PoseMainArmVisibility): string {
  if (bodyPart === 'lower' && arms === 'hidden') {
    return [
      'KEEP from Image 1: the person, garment, footwear, ordinary accessories, camera, lighting, environment, and the existing upper crop with no arms or hands.',
      'CHANGE only what the lower-body pose physically requires. If that pose cannot sit, lean, rest, or stay balanced without a support contacted by the hips, legs, or feet, restore that support so the pose is complete. A seated pose needs a seat. A lean needs the wall, pillar, or surface the body rests against.',
      'Do not restore handheld objects; arms are out of frame. Render any restored support to match Image 1 lighting, color, and photographic style so it belongs in Image 1\'s scene. Use Image 2 only to know which support exists and where it contacts the body.',
      'Keep clothing, footwear, socks, jewelry, bags, and ordinary accessories from Image 1. Those are not pose supports.',
    ].join(' ')
  }

  return [
    'KEEP from Image 1: the person, garment, footwear, ordinary accessories, camera, lighting, and the existing environment.',
    'CHANGE only what the target pose physically requires. If Image 2\'s pose cannot stand, sit, lean, rest, hold, or stay balanced without a supporting object or contacting surface, restore that support so the pose is complete and anatomically natural. A seated pose needs a seat. A lean needs the wall, pillar, or surface the body rests against. A hold or brace needs the object the hands or body use.',
    'Render restored supports to match Image 1 lighting, color, and photographic style so they belong in Image 1\'s scene. Use Image 2 only to know which support exists and where it contacts the body, not to replace Image 1\'s room or set dressing.',
    'Keep clothing, footwear, socks, jewelry, bags, and ordinary accessories from Image 1. Those are not pose supports.',
  ].join(' ')
}
