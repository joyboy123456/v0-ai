import { NextResponse, type NextRequest } from 'next/server'
import { jsonErrorResponse } from '@/lib/server/api-error-response'
import { requireUser } from '@/lib/server/auth/require-user'
import {
  addModel,
  listModels,
  type ModelLibrary,
} from '@/lib/server/company-model-store'

export const runtime = 'nodejs'

/**
 * GET /api/models → { companyModels, faceIdModels }
 * 一次性返回当前登录用户的两个模特库列表（量级小，不分页）。
 */
export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  return NextResponse.json(await listModels(userResult.userId))
}

/**
 * POST /api/models
 * Body: { library: 'company'|'faceId', assetId, url, name, width, height }
 *
 * 上传组件先调 /api/assets/upload 落 OSS，再调本接口把这张图登记进用户的模特库列表。
 * url 落到 CompanyModel.preview（即 OSS 稳定地址，跨设备可展示）。
 */
export async function POST(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult
  const { userId } = userResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const library = readLibrary(body.library)
  const assetId = readTrimmedString(body.assetId)
  const url = readTrimmedString(body.url)
  const name = readTrimmedString(body.name)
  const width = readPositiveNumber(body.width)
  const height = readPositiveNumber(body.height)

  if (!library || !assetId || !url || !name || width === null || height === null) {
    return NextResponse.json({ error: '模特参数无效' }, { status: 400 })
  }

  try {
    const model = await addModel(userId, library, {
      assetId,
      preview: url,
      name,
      width,
      height,
    })
    return NextResponse.json(model, { status: 201 })
  } catch (error) {
    return jsonErrorResponse(error, 400)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readLibrary(value: unknown): ModelLibrary | null {
  if (value === 'company' || value === 'faceId') return value
  return null
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}
