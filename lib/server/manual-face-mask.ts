import sharp from 'sharp'

const MASK_FEATHER_SIGMA = 12
const MASK_EXPAND_GAIN = 2.2
const FACE_REGION_BLUR_SIGMA = 36
const MIN_MASKED_PIXELS = 80

async function readImageSource(source: string): Promise<Buffer> {
  const match = source.match(/^data:image\/[\w.+-]+;base64,(.+)$/)
  if (match) {
    return Buffer.from(match[1], 'base64')
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`图片读取失败：HTTP ${response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  throw new Error('无效的图片来源')
}

/**
 * 将用户手动涂抹的脸部 mask 应用到图片上，但不把可见笔刷传给生图模型。
 * mask 支持透明底+亮色笔刷或黑白图；亮色区域表示“弱化原脸细节”。
 */
export async function applyManualFaceMask(
  imageSource: string,
  maskSource: string,
): Promise<string> {
  const imageBuffer = await readImageSource(imageSource)
  const maskBuffer = await readImageSource(maskSource)

  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width <= 0 || height <= 0) {
    throw new Error('主图尺寸无效，无法应用人脸 mask')
  }

  const maskRaw = await sharp(maskBuffer)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const alpha = Buffer.alloc(width * height)
  let maskedPixels = 0
  for (let i = 0, pixel = 0; i < maskRaw.data.length; i += 4, pixel += 1) {
    const colorCoverage = Math.max(
      maskRaw.data[i],
      maskRaw.data[i + 1],
      maskRaw.data[i + 2],
    )
    const coverage = Math.round((colorCoverage * maskRaw.data[i + 3]) / 255)
    alpha[pixel] = coverage
    if (coverage > 12) maskedPixels += 1
  }

  if (maskedPixels < MIN_MASKED_PIXELS) {
    throw new Error('人脸 mask 为空，请先涂抹主图五官区域')
  }

  const softAlpha = await sharp(alpha, {
    raw: { width, height, channels: 1 },
  })
    .blur(MASK_FEATHER_SIGMA)
    .linear(MASK_EXPAND_GAIN, 0)
    .raw()
    .toBuffer()

  const blurredRgb = await sharp(imageBuffer)
    .resize(width, height, { fit: 'fill' })
    .blur(FACE_REGION_BLUR_SIGMA)
    .removeAlpha()
    .raw()
    .toBuffer()

  const overlayRgba = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const src = pixel * 3
    const dst = pixel * 4
    overlayRgba[dst] = blurredRgb[src]
    overlayRgba[dst + 1] = blurredRgb[src + 1]
    overlayRgba[dst + 2] = blurredRgb[src + 2]
    overlayRgba[dst + 3] = softAlpha[pixel]
  }

  const overlay = await sharp(overlayRgba, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer()

  const result = await sharp(imageBuffer)
    .resize(width, height, { fit: 'fill' })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 6 })
    .toBuffer()

  return `data:image/png;base64,${result.toString('base64')}`
}
