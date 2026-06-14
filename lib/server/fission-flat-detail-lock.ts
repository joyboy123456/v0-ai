export interface FlatDetailReferenceLockParams {
  hasFrontDetail: boolean
  hasBackDetail: boolean
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
  if (!params.hasFrontDetail && !params.hasBackDetail) {
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
