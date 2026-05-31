/**
 * 人脸检测模块（基于肤色检测的轻量级方案）
 *
 * 使用 sharp 进行图像分析，通过肤色区域检测来定位人脸位置。
 * 这是一个轻量级方案，不需要额外的 AI 模型，适合服务端快速处理。
 */

import sharp from 'sharp'

/**
 * 人脸检测结果
 */
export interface FaceDetectionResult {
  /** 人脸区域的 x 坐标 */
  x: number
  /** 人脸区域的 y 坐标 */
  y: number
  /** 人脸区域的宽度 */
  width: number
  /** 人脸区域的高度 */
  height: number
  /** 检测置信度 (0-1) */
  confidence: number
}

/**
 * 检测图像中的人脸位置（基于肤色检测）
 *
 * 策略：
 * 1. 将图像分成多个水平条带
 * 2. 分析每个条带的肤色像素占比
 * 3. 找到肤色占比最高的区域，推断为人脸位置
 *
 * @param imageBuffer - 图像 Buffer
 * @returns 人脸检测结果，如果未检测到人脸则返回 null
 */
export async function detectFace(imageBuffer: Buffer): Promise<FaceDetectionResult | null> {
  try {
    // 先获取元数据
    const metadata = await sharp(imageBuffer).metadata()
    const width = metadata.width || 1024
    const height = metadata.height || 1024

    // 最小尺寸保护
    if (width < 64 || height < 64) {
      console.log('[face-detection] 图片太小，跳过检测', { width, height })
      return null
    }

    // 全身站姿照片中，脸部一定在上部 8%~35% 区域
    // 限制搜索范围，避免把身体裸露皮肤误判为脸部
    const faceTop = Math.floor(height * 0.08)
    const faceBottom = Math.floor(height * 0.35)

    // 在脸部候选区域内分成 6 个条带分析
    const stripCount = 6
    const searchHeight = faceBottom - faceTop
    const stripHeight = Math.floor(searchHeight / stripCount)

    let maxSkinRatio = 0
    let bestStripIndex = -1

    // 只在顶部 8%~35% 区域搜索肤色
    for (let i = 0; i < stripCount; i++) {
      const stripY = faceTop + i * stripHeight
      const stripH = Math.min(stripHeight, height - stripY)

      // 跳过高度为 0 的条带
      if (stripH <= 0) continue

      // 每次 extract 都创建新的 sharp 实例，避免实例复用问题
      const stripBuffer = await sharp(imageBuffer)
        .extract({
          left: 0,
          top: stripY,
          width: width,
          height: stripH,
        })
        .raw()
        .toBuffer({ resolveWithObject: true })

      // 计算肤色像素占比
      const skinRatio = calculateSkinPixelRatio(
        stripBuffer.data,
        stripBuffer.info.width,
        stripBuffer.info.height,
      )

      if (skinRatio > maxSkinRatio) {
        maxSkinRatio = skinRatio
        bestStripIndex = i
      }
    }

    // 如果肤色占比太低，认为检测失败
    if (maxSkinRatio < 0.15 || bestStripIndex < 0) {
      return null
    }

    // 基于最佳条带位置推断人脸区域（偏移要加上 faceTop）
    const faceY = faceTop + bestStripIndex * stripHeight
    const faceHeight = stripHeight * 2 // 人脸高度约为 2 个条带
    const faceWidth = Math.round(faceHeight * 0.8) // 人脸宽高比约为 0.8
    const faceX = Math.round((width - faceWidth) / 2) // 假设人脸水平居中

    return {
      x: Math.max(0, faceX),
      y: Math.max(0, faceY),
      width: Math.min(faceWidth, width),
      height: Math.min(faceHeight, height - faceY),
      confidence: maxSkinRatio,
    }
  } catch (error) {
    console.error('人脸检测失败:', error)
    return null
  }
}

/**
 * 计算图像中肤色像素的占比
 *
 * 使用 YCbCr 色彩空间进行肤色检测，这是一个经典的肤色检测算法。
 *
 * @param buffer - 图像原始数据 (RGB)
 * @param width - 图像宽度
 * @param height - 图像高度
 * @returns 肤色像素占比 (0-1)
 */
function calculateSkinPixelRatio(buffer: Buffer, width: number, height: number): number {
  let skinPixelCount = 0
  const totalPixels = width * height

  for (let i = 0; i < buffer.length; i += 3) {
    const r = buffer[i]
    const g = buffer[i + 1]
    const b = buffer[i + 2]

    if (isSkinColor(r, g, b)) {
      skinPixelCount++
    }
  }

  return skinPixelCount / totalPixels
}

/**
 * 判断 RGB 颜色是否为肤色
 *
 * 使用 YCbCr 色彩空间的肤色检测规则：
 * - Y: 亮度
 * - Cb: 蓝色色度
 * - Cr: 红色色度
 *
 * 肤色在 YCbCr 空间中有明确的范围。
 */
function isSkinColor(r: number, g: number, b: number): boolean {
  // 转换到 YCbCr 色彩空间
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b

  // 肤色检测规则（经验值）
  return (
    y > 80 &&
    cb >= 77 && cb <= 127 &&
    cr >= 133 && cr <= 173
  )
}

/**
 * 计算遮挡区域
 *
 * 基于检测到的人脸位置，计算一个稍小的椭圆遮挡区域，
 * 确保完全覆盖五官，但不覆盖帽子和发型。
 *
 * @param face - 人脸检测结果
 * @param imageWidth - 图像宽度
 * @param imageHeight - 图像高度
 * @returns 遮挡区域坐标
 */
export function calculateMaskRegion(
  face: FaceDetectionResult,
  imageWidth: number,
  imageHeight: number,
): {
  x: number
  y: number
  width: number
  height: number
} {
  // 遮挡区域比检测到的人脸稍小，只覆盖五官核心
  // 避免覆盖额头（可能有帽子）和下巴（可能有服装）
  const maskWidth = Math.round(face.width * 0.75)  // 缩小到 75%
  const maskHeight = Math.round(face.height * 0.60) // 缩小到 60%

  // 遮挡区域向下偏移，避开额头和帽子
  const maskX = Math.round(face.x + (face.width - maskWidth) / 2)
  const maskY = Math.round(face.y + face.height * 0.25) // 从人脸顶部向下 25%

  // 确保遮挡区域在图像范围内
  return {
    x: Math.max(0, Math.min(maskX, imageWidth - maskWidth)),
    y: Math.max(0, Math.min(maskY, imageHeight - maskHeight)),
    width: Math.min(maskWidth, imageWidth - maskX),
    height: Math.min(maskHeight, imageHeight - maskY),
  }
}
