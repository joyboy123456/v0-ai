import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import {
  syncModels,
  type ModelLibrary,
} from '@/lib/server/company-model-store'

export const runtime = 'nodejs'

const MAX_BATCH = 2000

/**
 * POST /api/models/sync
 * Body: { library: 'company'|'faceId', models: CompanyModel[] }
 *
 * 存量迁移：把老用户浏览器 localStorage 里的模特列表合并到服务端。
 * 以服务端为准、按 assetId 去重合并，幂等。返回合并后的列表，前端据此覆盖本地 state
 * 并清除 legacy localStorage 键。
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
  if (!library || !Array.isArray(body.models)) {
    return NextResponse.json(
      { error: '缺少 library / models 字段或类型错误' },
      { status: 400 },
    )
  }

  const legacy = body.models.slice(0, MAX_BATCH)
  const models = await syncModels(userId, library, legacy)
  return NextResponse.json({ models })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readLibrary(value: unknown): ModelLibrary | null {
  if (value === 'company' || value === 'faceId') return value
  return null
}
