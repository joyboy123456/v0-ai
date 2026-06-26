import {
  getPantsPoseViewLabel,
  type PantsPoseView,
} from './prompt-templates/pants-pose-library'

export type PantsReferenceAngle = 'front' | 'side' | 'back'

export interface PantsDetailAvailability {
  hasFrontDetail: boolean
  hasSideDetail: boolean
  hasBackDetail: boolean
  frontDetailCount?: number
  sideDetailCount?: number
  backDetailCount?: number
}

export interface PantsReferenceSlot {
  angle: PantsReferenceAngle
  ordinal: number
}

export function getPantsReferenceAngleForView(
  view: PantsPoseView,
): PantsReferenceAngle {
  if (view === 'front') return 'front'
  if (view === 'back') return 'back'
  return 'side'
}

export function getPantsShotDetailAvailability(
  availability: PantsDetailAvailability,
  view: PantsPoseView,
): PantsDetailAvailability {
  const slots = getPantsShotReferenceSlots(availability, view)
  const frontDetailCount = slots.filter((slot) => slot.angle === 'front').length
  const sideDetailCount = slots.filter((slot) => slot.angle === 'side').length
  const backDetailCount = slots.filter((slot) => slot.angle === 'back').length
  return {
    hasFrontDetail: frontDetailCount > 0,
    hasSideDetail: sideDetailCount > 0,
    hasBackDetail: backDetailCount > 0,
    frontDetailCount,
    sideDetailCount,
    backDetailCount,
  }
}

export function getPantsDetailCount(
  availability: PantsDetailAvailability,
  angle: PantsReferenceAngle,
): number {
  const explicitCount =
    angle === 'front'
      ? availability.frontDetailCount
      : angle === 'side'
        ? availability.sideDetailCount
        : availability.backDetailCount
  if (
    typeof explicitCount === 'number' &&
    Number.isInteger(explicitCount) &&
    explicitCount >= 0
  ) {
    return Math.min(explicitCount, 2)
  }
  if (angle === 'front') return availability.hasFrontDetail ? 1 : 0
  if (angle === 'side') return availability.hasSideDetail ? 1 : 0
  return availability.hasBackDetail ? 1 : 0
}

export function getPantsShotReferenceSlots(
  availability: PantsDetailAvailability,
  view: PantsPoseView,
): PantsReferenceSlot[] {
  const angle = getPantsReferenceAngleForView(view)
  const policy: Record<PantsReferenceAngle, PantsReferenceAngle[]> = {
    front: ['front'],
    side: ['side'],
    back: ['back'],
  }
  return policy[angle].flatMap((candidate) =>
    Array.from(
      { length: getPantsDetailCount(availability, candidate) },
      (_, index) => ({ angle: candidate, ordinal: index + 1 }),
    ),
  )
}

export function getPantsShotReferenceAngles(
  availability: PantsDetailAvailability,
  view: PantsPoseView,
): PantsReferenceAngle[] {
  return getPantsShotReferenceSlots(availability, view).map(
    (slot) => slot.angle,
  )
}

export function selectPantsShotInputImages(
  inputImages: readonly string[],
  availability: PantsDetailAvailability,
  view: PantsPoseView,
): string[] {
  const mainImage = inputImages[0]
  if (!mainImage) return []

  let nextIndex = 1
  const imagesByAngle: Record<PantsReferenceAngle, Array<string | undefined>> = {
    front: [],
    side: [],
    back: [],
  }
  for (const angle of ['front', 'side', 'back'] as const) {
    const count = getPantsDetailCount(availability, angle)
    imagesByAngle[angle] = Array.from(
      { length: count },
      () => inputImages[nextIndex++],
    )
  }
  const detailImages = getPantsShotReferenceSlots(availability, view)
    .map((slot) => imagesByAngle[slot.angle][slot.ordinal - 1])
    .filter((image): image is string => Boolean(image))

  return [mainImage, ...detailImages]
}

export function getPantsShotInputImageLabels(
  availability: PantsDetailAvailability,
  view: PantsPoseView,
): string[] {
  const targetAngle = getPantsReferenceAngleForView(view)
  const targetLabel = getPantsPoseViewLabel(view)
  const slots = getPantsShotReferenceSlots(availability, view)
  const hasTargetDetail = slots.some((slot) => slot.angle === targetAngle)
  const labels = [
    `图1 主图：负责人物比例、穿着版型、裤长基准、裤脚宽度、构图、背景、上衣范围和鞋子款式；不负责复制腿脚站姿，裤脚垂坠、褶皱和鞋脚遮挡关系允许随本镜头唯一指定姿势自然变化。${hasTargetDetail ? `${targetLabel}细节图只补充图中清楚可见的商品局部证据，不覆盖主图穿着版型、构图或姿势。` : `本镜头没有${targetLabel}细节图，${targetLabel}商品元素只按图1清楚可见证据保守呈现。`}`,
  ]
  slots.forEach((slot, index) => {
    const angleLabel = getPantsAngleLabel(slot.angle)
    labels.push(
      `图${index + 2} ${angleLabel}细节${slot.ordinal}：只作为当前${targetLabel}镜头的商品局部证据，锁定图中清楚可见的颜色、材质、纹理、logo、刺绣、贴布、拼接、口袋、裤脚或侧缝；不控制腿脚姿势、身体朝向、构图边界、人物大小或完整裤身轮廓。该图可能是局部放大图，只证明拍到的局部存在，不能扩展成其它面、另一条腿或整条裤子的结构。`,
    )
  })
  if (targetAngle === 'back' && hasTargetDetail) {
    labels.push(
      '背面结构排他规则：只复现背面参考共同显示的结构。背面参考没有显示后袋、袋口、袋盖、贴袋轮廓或对应缝线时，背面必须保持连续整片面料，禁止从主图或其它角度迁移口袋。',
    )
  }
  return labels
}

export function getPantsAngleLabel(angle: PantsReferenceAngle): string {
  return angle === 'front' ? '正面' : angle === 'side' ? '侧面' : '背面'
}

export function sanitizePantsPlannerReferenceText(
  text: string,
  activeAvailability: PantsDetailAvailability,
): string {
  const forbiddenPatterns = [
    activeAvailability.hasFrontDetail ? null : /正面(?:平铺)?细节图/,
    activeAvailability.hasSideDetail ? null : /(?:左侧|右侧|侧面)(?:平铺)?细节图/,
    activeAvailability.hasBackDetail ? null : /背面(?:平铺)?细节图/,
  ].filter((pattern): pattern is RegExp => pattern !== null)

  if (forbiddenPatterns.length === 0) return text.trim()

  return text
    .split(/(?<=[。！？；\n])/)
    .filter((sentence) => !forbiddenPatterns.some((pattern) => pattern.test(sentence)))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
