import {
  getPantsAngleLabel,
  getPantsReferenceAngleForView,
  getPantsShotReferenceAngles,
  getPantsShotReferenceSlots,
} from './pants-reference-policy'
import {
  getPantsPoseViewLabel,
  type PantsPoseView,
} from './prompt-templates/pants-pose-library'

export interface FlatDetailReferenceLockParams {
  hasFrontDetail: boolean
  hasSideDetail?: boolean
  hasBackDetail: boolean
  frontDetailCount?: number
  sideDetailCount?: number
  backDetailCount?: number
  category?: string
  childrensCategory?: string
  pantsView?: PantsPoseView
}

/**
 * 追加平铺细节图锁定规则。
 *
 * 适用于 photo-fission / pose-fission：平铺图只锁定服装细节，不参与姿势、
 * 动作、表情、场景或构图，避免细节参考图污染当前生成目标。
 */
export function appendFlatDetailReferenceLock(
  prompt: string,
  params: FlatDetailReferenceLockParams,
  shotLabel: string,
): string {
  const isPantsTask =
    params.category === 'childrens' && params.childrensCategory === 'pants'
  if (!isPantsTask && !params.hasFrontDetail && !params.hasBackDetail) {
    return prompt
  }

  const lines = buildFlatDetailReferenceLockLines(params, shotLabel)
  if (!lines.length) {
    return prompt
  }

  return `${prompt.trim()}\n\n${lines.join('\n')}`
}

function buildFlatDetailReferenceLockLines(
  params: FlatDetailReferenceLockParams,
  shotLabel: string,
): string[] {
  const isPantsTask =
    params.category === 'childrens' && params.childrensCategory === 'pants'
  if (isPantsTask) {
    return buildPantsDetailReferenceLockLines(params)
  }

  const lines = [
    '服装细节锁定：图1是穿着主图，用于锁定同一位模特、穿着效果、整体画面风格和光线；后续平铺细节图只用于锁定服装本身的实际颜色、材质类别、主要图案和结构，不参与姿势、动作、表情、场景或构图设计。',
  ]
  let nextIndex = 2
  const frontIndex = params.hasFrontDetail ? nextIndex : null
  if (params.hasFrontDetail) nextIndex += 1
  const backIndex = params.hasBackDetail ? nextIndex : null

  if (frontIndex) {
    lines.push(
      `图${frontIndex}是服装正面平铺细节图，用于锁定正面实际存在的服装主色、拼色关系、色块边界、印花颜色、刺绣线色、主要图案印花、刺绣文字、数字、logo、领口、袖口、腰线、下摆、拼接和装饰位置。`,
    )
  }

  if (backIndex) {
    lines.push(
      `图${backIndex}是服装背面平铺细节图，用于锁定背面实际存在的服装主色、拼色关系、色块边界、印花颜色、刺绣线色、主要图案印花、刺绣文字、数字、肩线、后片剪裁、背部结构和装饰位置。`,
    )
  }

  lines.push(
    '生成时只提取平铺细节图中的服装信息；平铺背景、桌面、衣架、吊牌摆放、未穿着角度和额外褶皱不作为最终画面内容来源。',
    '服装实际颜色以平铺细节图中可见的衣物颜色、拼色、刺绣线色和印花色为准；但整体光线、阴影、白平衡、肤色和画面氛围沿用图1穿着主图，不把平铺图的拍摄色偏、桌面颜色或背景颜色带入最终画面。',
    '材质类别和可识别材质特征以参考图中真实存在的内容为准；参考图中确实存在的针织、牛仔、蕾丝、刺绣、纱层、提花等结构才保留，参考图没有的棉麻肌理、纱层、粗织纹、针织纹或额外纹理不得新增。',
    '服装版型、拼布色块、主要图案、领口、腰线和下摆保持清晰；绝对禁止把参考图中的像素级拍摄瑕疵（布料经纬线噪声、相机锐化噪声、JPEG 压缩纹、密集平行线、横向摩尔纹、扫描线、水波纹、屏幕纹或条带伪影）当作真实材质复刻到生成图中。生成的服装表面应当干净自然，只保留真实织物肌理，不复制数字伪影。',
    '服装上实际存在且清晰可读的刺绣文字、数字和图案边界按参考图保持；小字不可读时保留为真实刺绣或织物表面感，不编造新文字、新数字或新 logo。',
  )

  const shotText = shotLabel.trim()
  if (backIndex && /背面|背后|侧后|背部|后片/.test(shotText)) {
    lines.push(`当前镜头露出背面或侧后结构时，优先以图${backIndex}校准背面颜色、背面拼色、背面剪裁、肩线、后片、背部刺绣和背面图案。`)
  } else if (frontIndex && /正面|侧前|三分之二|胸前|领口|前身|近全身|全身/.test(shotText)) {
    lines.push(`当前镜头露出正面或侧前结构时，优先以图${frontIndex}校准正面颜色、正面拼色、领口、胸前结构、正面刺绣、数字、logo、主要图案和真实材质类别。`)
  } else if (frontIndex && backIndex) {
    lines.push(`当前镜头按可见角度同时参考图${frontIndex}和图${backIndex}，正面颜色与细节以图${frontIndex}为准，背面或侧后颜色与细节以图${backIndex}为准。`)
  }

  return lines
}

function buildPantsDetailReferenceLockLines(
  params: FlatDetailReferenceLockParams,
): string[] {
  const lines = [
    '裤子参考优先级：图1主图锁定穿着版型、宽松度、裤长基准、裤脚宽度、身体比例、腿长、人物大小、画面边界、上衣、鞋子款式、配饰、背景和光线；细节图只锁定图中清楚可见的颜色、材质、纹理、logo、刺绣、贴布、拼接、口袋、裤脚或侧缝等商品局部证据，不控制腿脚站姿、身体朝向、构图边界、人物大小或完整裤身轮廓。裤脚垂坠、自然褶皱、鞋子露出程度和鞋脚遮挡关系允许随本镜头唯一指定姿势真实变化。',
  ]

  const availability = {
    hasFrontDetail: params.hasFrontDetail,
    hasSideDetail: Boolean(params.hasSideDetail),
    hasBackDetail: params.hasBackDetail,
    frontDetailCount: params.frontDetailCount,
    sideDetailCount: params.sideDetailCount,
    backDetailCount: params.backDetailCount,
  }
  const pantsView = params.pantsView ?? 'front'
  const targetAngle = getPantsReferenceAngleForView(pantsView)
  const targetLabel = getPantsPoseViewLabel(pantsView)
  const referenceSlots = getPantsShotReferenceSlots(availability, pantsView)

  if (referenceSlots.length === 0) {
    lines.push(
      `当前镜头没有可用细节参考，${targetLabel}可见内容以图1主图为准。`,
    )
  } else {
    referenceSlots.forEach((slot, index) => {
      const imageIndex = index + 2
      const angleLabel = getPantsAngleLabel(slot.angle)
      if (slot.angle === targetAngle) {
        lines.push(
          `图${imageIndex}是${angleLabel}细节${slot.ordinal}，只作为当前${targetLabel}镜头的商品局部证据；只锁定图中实际可见的颜色、材质、纹理、图案、logo、刺绣、贴布、拼接、口袋、裤脚、侧缝和真实商品结构。该图可以是局部放大图：局部放大只证明拍到的局部存在，不能扩展成另一条腿、另一侧、背面或整条裤子的结构。`,
        )
      } else {
        lines.push(
          `图${imageIndex}是${angleLabel}细节${slot.ordinal}，只作为当前${targetLabel}镜头的辅助商品证据；不得把${angleLabel}独有的 logo、图案、刺绣、贴布、拼接、口袋或侧缝迁移到${targetLabel}。`,
        )
      }
    })
  }

  const targetReferenceCount = referenceSlots.filter(
    (slot) => slot.angle === targetAngle,
  ).length
  if (targetReferenceCount > 0) {
    lines.push(
      `当前${targetLabel}镜头已上传 ${targetReferenceCount} 张${targetLabel}细节图；${targetLabel}商品细节只按这些参考和图1共同清楚可见的证据呈现，图1或其它角度出现的独有结构不能覆盖、迁移、镜像或补全到${targetLabel}。`,
    )
    if (targetAngle === 'back') {
      lines.push(
        '背面结构排他锁定：逐项检查全部背面参考共同显示的后腰、后片、口袋、袋口、袋盖、贴袋轮廓和缝线。背面参考没有显示的结构等于明确不存在；若没有后袋证据，背面必须保持连续整片面料，禁止新增任何对称后袋、贴袋、袋盖、袋口或口袋缝线，也禁止从主图或侧面经验迁移口袋。',
      )
    }
  } else {
    lines.push(
      `当前没有${targetLabel}细节图，${targetLabel}商品元素只按图1清楚可见证据保守呈现；其它角度参考不能代替${targetLabel}结构证据。`,
    )
  }

  const referenceAngles = getPantsShotReferenceAngles(availability, pantsView)
  lines.push(
    '各细节图只约束自己对应的可见区域，不改变图1的裤子穿着版型、裤长基准、裤脚宽度、人物比例、腿长、上衣、鞋子款式、配饰、构图、背景和光线；腿脚姿势只按本镜头唯一指定姿势执行，裤脚垂坠和鞋脚遮挡可随姿势自然变化。',
    `同角度细节图必须联合使用，不能只看其中一张；只有局部放大图时，只按放大图锁定该局部外观，不推断整面位置或其它面结构。只复现实际参考图中清楚存在的商品元素和真实结构，不新增、不删除、不改位置，不换腿、不换面、不镜像，不凭常见裤装经验补结构；平铺背景、桌面、衣架、吊牌和额外褶皱不进入最终画面。当前共使用 ${referenceAngles.length} 张细节参考。`,
  )

  return lines
}
