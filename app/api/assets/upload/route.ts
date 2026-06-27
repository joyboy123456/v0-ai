import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { createAsset } from '@/lib/server/task-store'
import sharp from 'sharp'

export const runtime = 'nodejs'

const ALLOWED_MIME_PREFIX = 'image/'

type ApiErrorSource =
  | 'upload_parser'
  | 'image_validation'
  | 'storage'

function errorResponse(
  status: number,
  error: string,
  source: ApiErrorSource,
  code: string,
  advice: string,
) {
  return NextResponse.json({ error, source, code, advice }, { status })
}

export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) {
    return handleRemoteImageUrlUpload(request, userId)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (error) {
    console.error('[assets/upload] 解析上传表单失败：', error)
    return errorResponse(
      400,
      '上传请求解析失败，请确认图片文件有效后重试',
      'upload_parser',
      'multipart_parse_failed',
      '请确认网络稳定后重试；如果图片较大，请检查代理或服务器请求体上限',
    )
  }

  const file = formData.get('file')

  if (!(file instanceof File)) {
    return errorResponse(
      400,
      '请上传图片文件',
      'image_validation',
      'missing_file',
      '请重新选择一张本地图片后上传',
    )
  }

  if (file.size <= 0) {
    return errorResponse(
      400,
      '文件为空，请重新选择',
      'image_validation',
      'empty_file',
      '请重新导出或重新选择有效图片',
    )
  }

  const mimeType = (file.type || '').toLowerCase()
  if (!mimeType.startsWith(ALLOWED_MIME_PREFIX)) {
    return errorResponse(
      415,
      '仅支持图片格式',
      'image_validation',
      'unsupported_image_type',
      '请上传图片格式文件，上游模型会自行校验具体格式是否支持',
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const imageMetadata = await readUploadedImageMetadata(buffer)

  const base64 = buffer.toString('base64')
  const dataUrl = `data:${mimeType};base64,${base64}`
  const dimensions = readImageDimensions(formData, imageMetadata ?? undefined)

  // PR4：把 userId 传给 createAsset，cloud 模式下 R2 路径前缀
  // `users/{userId}/assets/...` 实现数据隔离。
  let asset: Awaited<ReturnType<typeof createAsset>>
  try {
    asset = await createAsset({
      fileName: file.name,
      fileType: mimeType,
      fileUrl: dataUrl,
      dataUrl,
      width: dimensions.width,
      height: dimensions.height,
      userId,
    })
  } catch (error) {
    console.error('[assets/upload] 存储上传图片失败：', error)
    return errorResponse(
      500,
      '图片存储失败，请稍后重试',
      'storage',
      'asset_store_failed',
      '请稍后重试；如果持续失败，请联系管理员检查存储服务',
    )
  }

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
    if (normalized.startsWith(ALLOWED_MIME_PREFIX)) {
      return normalized
    }
  }

  const pathname = new URL(fileUrl).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.heic')) return 'image/heic'
  if (pathname.endsWith('.heif')) return 'image/heif'
  if (pathname.endsWith('.bmp')) return 'image/bmp'
  if (pathname.endsWith('.tiff') || pathname.endsWith('.tif')) return 'image/tiff'
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

function readImageDimensions(
  formData: FormData,
  metadata?: { width: number; height: number },
) {
  const width = metadata?.width ?? readPositiveDimension(formData.get('width'))
  const height = metadata?.height ?? readPositiveDimension(formData.get('height'))

  if (width === undefined || height === undefined) return {}
  return { width, height }
}

async function readUploadedImageMetadata(
  buffer: Buffer,
): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(buffer).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (width <= 0 || height <= 0) return null
    return { width, height }
  } catch {
    return null
  }
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
