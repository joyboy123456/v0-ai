/**
 * 人脸区域遮挡处理。
 *
 * 用于"五官锁定"功能：当选了人像小卡时，对主图的脸部区域做完全遮挡，
 * 防止图像生成模型从主图读取面部特征，强制其只能从人像小卡获取五官信息。
 *
 * 策略：使用 sharp 在脸部区域绘制一个与肤色接近的纯色椭圆遮挡块，
 * 边缘做高斯模糊过渡，让遮挡区域看起来自然但不包含任何可辨识的五官信息。
 */

import sharp from 'sharp'

/** 遮挡块的边缘模糊强度 */
const EDGE_BLUR_SIGMA = 12

/**
 * 完全遮挡图像中的人脸区域。
 *
 * 与之前的"模糊"策略不同，本函数使用纯色椭圆遮挡+边缘模糊的方式，
 * 彻底消除脸部区域的五官信息，同时保持与周围区域的自然过渡。
 *
 * @param imageUrl - data URL 格式的图像
 * @returns 处理后的 data URL
 */
export async function blurFaceRegion(imageUrl: string): Promise<string> {
  const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) {
    throw new Error('无效的 data URL 格式')
  }

  const mime = match[1]
  const base64Data = match[2]
  const buffer = Buffer.from(base64Data, 'base64')

  try {
    const image = sharp(buffer)
    const metadata = await image.metadata()

    const width = metadata.width || 1024
    const height = metadata.height || 1024

    // 人脸区域：图片上方中心
    // 竖版电商图：人脸通常在上方 8%~55%，水平居中 40%
    const faceWidth = Math.round(width * 0.42)
    const faceHeight = Math.round(height * 0.42)
    const faceX = Math.round((width - faceWidth) / 2)
    const faceY = Math.round(height * 0.06)

    // 扩大 15% 作为遮挡边界，确保完全覆盖
    const padding = Math.round(Math.min(faceWidth, faceHeight) * 0.15)
    const maskX = Math.max(0, faceX - padding)
    const maskY = Math.max(0, faceY - padding)
    const maskW = Math.min(width - maskX, faceWidth + padding * 2)
    const maskH = Math.min(height - maskY, faceHeight + padding * 2)

    // 采样脸部周围区域的平均色作为遮挡色
    const sampleRegion = await image
      .extract({
        left: Math.max(0, Math.round(width * 0.3)),
        top: Math.round(height * 0.55),
        width: Math.round(width * 0.4),
        height: Math.round(height * 0.1),
      })
      .resize(1, 1)
      .raw()
      .toBuffer()

    const avgR = sampleRegion[0] || 200
    const avgG = sampleRegion[1] || 180
    const avgB = sampleRegion[2] || 170

    // 创建纯色遮挡椭圆 SVG
    const ellipseRx = maskW / 2
    const ellipseRy = maskH / 2
    const svgMask = Buffer.from(`<svg width="${maskW}" height="${maskH}">
      <ellipse cx="${maskW / 2}" cy="${maskH / 2}" rx="${ellipseRx}" ry="${ellipseRy}" fill="rgb(${avgR},${avgG},${avgB})" />
    </svg>`)

    // 创建遮挡层：先画椭圆再做边缘模糊
    const coverLayer = await sharp(svgMask)
      .resize(maskW, maskH)
      .blur(EDGE_BLUR_SIGMA)
      .png()
      .toBuffer()

    // 合成到原图
    const result = await sharp(buffer)
      .composite([{
        input: coverLayer,
        left: maskX,
        top: maskY,
      }])
      .jpeg({ quality: 95 })
      .toBuffer()

    return `data:image/jpeg;base64,${result.toString('base64')}`
  } catch (error) {
    throw new Error(
      `图像处理失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
