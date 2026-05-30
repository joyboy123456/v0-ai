import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { createAsset } from '@/lib/server/task-store'

export const runtime = 'nodejs'

// R6 输入预检：原始字节 > 7.5MB 时 base64 编码后约 10MB，接近 Google API 单图上限。
// 这里按原始字节 7.5MB 拒绝，避免 base64 inline_data 超过 Google ~10MB 软上限触发 400。
const MAX_RAW_BYTES = Math.floor(7.5 * 1024 * 1024)
const MAX_BASE64_BYTES = 10 * 1024 * 1024
const MAX_REMOTE_URL_LENGTH = 2048
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

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) {
    return handleRemoteImageUrlUpload(request, userId)
  }

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

interface RemoteImageUploadBody {
  fileUrl?: unknown
  fileName?: unknown
  fileType?: unknown
  width?: unknown
  height?: unknown
}

async function handleRemoteImageUrlUpload(request: NextRequest, userId: string) {
  let body: RemoteImageUploadBody
  try {
    body = (await request.json()) as RemoteImageUploadBody
  } catch {
    return NextResponse.json({ error: '请求 JSON 格式错误' }, { status: 400 })
  }

  if (typeof body.fileUrl !== 'string' || !body.fileUrl.trim()) {
    return NextResponse.json({ error: '缺少公网图片 URL' }, { status: 400 })
  }

  const fileUrl = body.fileUrl.trim()
  const urlError = validateRemoteImageUrl(fileUrl)
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 })
  }

  const fileType = readRemoteImageFileType(body.fileType, fileUrl)
  const asset = await createAsset({
    fileName: readRemoteImageFileName(body.fileName, fileUrl),
    fileType,
    fileUrl,
    width: readPositiveDimensionValue(body.width) ?? 1024,
    height: readPositiveDimensionValue(body.height) ?? 1365,
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

function validateRemoteImageUrl(fileUrl: string): string | null {
  if (fileUrl.length > MAX_REMOTE_URL_LENGTH) {
    return '公网图片 URL 过长'
  }

  let parsed: URL
  try {
    parsed = new URL(fileUrl)
  } catch {
    return '公网图片 URL 格式无效'
  }

  if (parsed.protocol !== 'https:') {
    return '公网图片 URL 必须使用 https://'
  }

  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.startsWith('169.254.')
  ) {
    return '公网图片 URL 不能是 localhost 或内网地址'
  }

  return null
}

function readRemoteImageFileType(value: unknown, fileUrl: string) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized.startsWith(ALLOWED_MIME_PREFIX) && ALLOWED_MIME_TYPES.has(normalized)) {
      return normalized
    }
  }

  const pathname = new URL(fileUrl).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

function readRemoteImageFileName(value: unknown, fileUrl: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  const pathname = new URL(fileUrl).pathname
  const lastSegment = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '')
  return lastSegment || 'remote-image.jpg'
}

function readImageDimensions(formData: FormData) {
  const width = readPositiveDimension(formData.get('width'))
  const height = readPositiveDimension(formData.get('height'))

  if (width === undefined || height === undefined) return {}
  return { width, height }
}

function readPositiveDimension(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return undefined
  return readPositiveDimensionValue(value)
}

function readPositiveDimensionValue(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined

  const rounded = Math.round(parsed)
  return rounded >= 1 ? rounded : undefined
}
