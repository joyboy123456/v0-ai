import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { createAsset } from '@/lib/server/task-store'

export const runtime = 'nodejs'

// R6 输入预检：原始字节 > 7.5MB 时 base64 编码后约 10MB，接近 Google API 单图上限。
// 这里按原始字节 7.5MB 拒绝，避免 base64 inline_data 超过 Google ~10MB 软上限触发 400。
const MAX_RAW_BYTES = Math.floor(7.5 * 1024 * 1024)
const MAX_BASE64_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME_PREFIX = 'image/'
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: '请上传图片文件' }, { status: 400 })
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: '文件为空，请重新选择' }, { status: 400 })
  }

  if (file.size > MAX_RAW_BYTES) {
    const maxMb = (MAX_RAW_BYTES / 1024 / 1024).toFixed(1)
    return NextResponse.json(
      {
        error: `参考图过大，请压缩到 ${maxMb}MB 以内（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`,
      },
      { status: 413 },
    )
  }

  const mimeType = (file.type || '').toLowerCase()
  if (!mimeType.startsWith(ALLOWED_MIME_PREFIX) || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: '仅支持 PNG / JPG / WEBP / GIF 图片格式' },
      { status: 415 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const base64 = buffer.toString('base64')
  // 双层防护：原始字节通过后，再检查 base64 字符串字节数是否 > 10MB
  if (Buffer.byteLength(base64, 'utf8') > MAX_BASE64_BYTES) {
    const maxMb = (MAX_BASE64_BYTES / 1024 / 1024).toFixed(0)
    return NextResponse.json(
      { error: `参考图编码后超过 ${maxMb}MB，请压缩后重试` },
      { status: 413 },
    )
  }

  const dataUrl = `data:${mimeType};base64,${base64}`
  const dimensions = readImageDimensions(formData)

  // PR4：把 userId 传给 createAsset，cloud 模式下 R2 路径前缀
  // `users/{userId}/assets/...` 实现数据隔离。
  const asset = await createAsset({
    fileName: file.name,
    fileType: mimeType,
    fileUrl: dataUrl,
    dataUrl,
    width: dimensions.width,
    height: dimensions.height,
    userId,
  })

  return NextResponse.json({
    assetId: asset.assetId,
    url: asset.fileUrl,
    fileName: asset.fileName,
    width: asset.width,
    height: asset.height,
  })
}

function readImageDimensions(formData: FormData) {
  const width = readPositiveDimension(formData.get('width'))
  const height = readPositiveDimension(formData.get('height'))

  if (width === undefined || height === undefined) return {}
  return { width, height }
}

function readPositiveDimension(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return undefined

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined

  const rounded = Math.round(parsed)
  return rounded >= 1 ? rounded : undefined
}
