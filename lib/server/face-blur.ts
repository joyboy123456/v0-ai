/**
 * 人脸区域遮挡处理。
 *
 * 用于"五官锁定"功能：当选了人像小卡时，对主图的脸部区域做完全遮挡，
 * 防止图像生成模型从主图读取面部特征，强制其只能从人像小卡获取五官信息。
 *
 * 策略：
 * 1. 使用 face-api 自动检测人脸位置（适应不同身高和位置的模特）
 * 2. 在检测到的人脸区域绘制纯色椭圆遮挡块，边缘做高斯模糊过渡
 * 3. 如果检测失败，降级使用固定位置遮挡（兜底方案）
 *
 * 遮挡只服务"五官锁定"，不能伤到图1的帽子、发型、发饰、手持包和服装穿搭锚点。
 */

import sharp from 'sharp'
import { detectFace, calculateMaskRegion } from './face-detection'

/** 遮挡块的边缘模糊强度 */
const EDGE_BLUR_SIGMA = 6

/**
 * 将图像源解析为 Buffer。
 * 支持 data URL 和 HTTP/HTTPS URL（OSS 等远程存储）。
 */
async function resolveImageToBuffer(imageUrl: string): Promise<{ buffer: Buffer; mime: string }> {
  // data URL 格式
  const dataMatch = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (dataMatch) {
    return {
      buffer: Buffer.from(dataMatch[2], 'base64'),
      mime: dataMatch[1],
    }
  }

  // HTTP/HTTPS URL（OSS 等远程存储）
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`下载图片失败: HTTP ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    const mime = contentType.replace('image/', '').replace('jpeg', 'jpeg').replace('jpg', 'jpeg')
    return { buffer, mime }
  }

  throw new Error(`不支持的图片格式: ${imageUrl.slice(0, 60)}...`)
}

/**
 * 完全遮挡图像中的人脸区域。
 *
 * 使用肤色检测自动定位人脸位置，然后在检测到的区域绘制纯色椭圆遮挡。
 * 如果人脸检测失败，降级使用整图轻度模糊（5.30 下午 2:36 的兜底方案）。
 *
 * 遮挡区域只覆盖五官核心，不覆盖帽子、发型、发饰或肩颈服装。
 *
 * @param imageUrl - data URL 或 HTTP/HTTPS URL 格式的图像
 * @returns 处理后的 data URL
 */
export async function blurFaceRegion(imageUrl: string): Promise<string> {
  const { buffer, mime } = await resolveImageToBuffer(imageUrl)

  try {
    const image = sharp(buffer)
    const metadata = await image.metadata()

    const width = metadata.width || 1024
    const height = metadata.height || 1024

    // 尝试使用肤色检测定位人脸位置
    let useFallback = false

    try {
      const faceDetection = await detectFace(buffer)

      if (faceDetection && faceDetection.confidence > 0.15) {
        // 检测成功，使用检测到的人脸位置
        const maskRegion = calculateMaskRegion(faceDetection, width, height)

        console.log('[face-blur] 人脸检测成功，使用精准遮挡', {
          confidence: faceDetection.confidence.toFixed(2),
          face: faceDetection,
          mask: maskRegion,
        })

        // 采样脸部中心偏下区域的平均色作为遮挡色
        const sampleRegion = await image
          .extract({
            left: Math.max(0, Math.round(width * 0.43)),
            top: Math.round(height * 0.20),
            width: Math.round(width * 0.14),
            height: Math.round(height * 0.06),
          })
          .resize(1, 1)
          .raw()
          .toBuffer()

        const avgR = sampleRegion[0] || 200
        const avgG = sampleRegion[1] || 180
        const avgB = sampleRegion[2] || 170

        // 创建纯色遮挡椭圆 SVG
        const ellipseRx = maskRegion.width / 2
        const ellipseRy = maskRegion.height / 2
        const svgMask = Buffer.from(`<svg width="${maskRegion.width}" height="${maskRegion.height}">
          <ellipse cx="${maskRegion.width / 2}" cy="${maskRegion.height / 2}" rx="${ellipseRx}" ry="${ellipseRy}" fill="rgb(${avgR},${avgG},${avgB})" />
        </svg>`)

        // 创建遮挡层：先画椭圆再做边缘模糊
        const coverLayer = await sharp(svgMask)
          .resize(maskRegion.width, maskRegion.height)
          .blur(EDGE_BLUR_SIGMA)
          .png()
          .toBuffer()

        // 合成到原图
        const result = await sharp(buffer)
          .composite([{
            input: coverLayer,
            left: maskRegion.x,
            top: maskRegion.y,
          }])
          .jpeg({ quality: 95 })
          .toBuffer()

        return `data:image/jpeg;base64,${result.toString('base64')}`
      } else {
        // 检测失败或置信度太低，使用兜底方案
        console.log('[face-blur] 人脸检测失败或置信度低，降级使用整图轻度模糊（兜底方案）')
        useFallback = true
      }
    } catch (detectionError) {
      // 人脸检测异常，使用兜底方案
      console.error('[face-blur] 人脸检测异常，降级使用整图轻度模糊（兜底方案）', detectionError)
      useFallback = true
    }

    // 兜底方案：整图轻度模糊（5.30 下午 2:36 的旧版算法）
    if (useFallback) {
      const processedImage = await image
        .resize(Math.round(width), Math.round(height))
        .blur(15) // 高斯模糊，sigma=15

      const processedBuffer = await processedImage.toFormat(mime as 'jpeg').toBuffer()

      return `data:image/${mime};base64,${processedBuffer.toString('base64')}`
    }

    // 不应该到达这里
    throw new Error('未知错误')
  } catch (error) {
    throw new Error(
      `图像处理失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
