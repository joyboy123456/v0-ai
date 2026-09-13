import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import {
  createGarmentCutoutSession,
  toCutoutSessionErrorBody,
  type CutoutSessionDto,
} from '@/lib/server/cutout-session-service'
import type { CutoutScene } from '@/lib/types'

/** 本期只支持 garment 场景；person/product 结构预留（PRD §39.1）。 */
const SUPPORTED_SCENES: readonly CutoutScene[] = ['garment']

interface CutoutSessionsRouteDependencies {
  authenticate: (
    request: NextRequest,
  ) => Promise<{ userId: string } | NextResponse>
  createSession: (userId: string, assetId: string) => Promise<CutoutSessionDto>
}

const defaultDependencies: CutoutSessionsRouteDependencies = {
  authenticate: requireUser,
  createSession: createGarmentCutoutSession,
}

function readJsonBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

export function createCutoutSessionsPostHandler(
  dependencies: CutoutSessionsRouteDependencies = defaultDependencies,
) {
  return async function POST(request: NextRequest) {
    const userResult = await dependencies.authenticate(request)
    if (userResult instanceof NextResponse) return userResult

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      rawBody = null
    }
    const payload = readJsonBody(rawBody)
    if (!payload) {
      return NextResponse.json(
        {
          error: '请求体必须是 JSON 对象',
          code: 'invalid_json',
          advice: '请刷新页面后重试',
          retryable: false,
        },
        { status: 400 },
      )
    }

    const assetId = typeof payload.assetId === 'string' ? payload.assetId.trim() : ''
    if (!assetId) {
      return NextResponse.json(
        {
          error: '缺少要抠图的 assetId',
          code: 'missing_asset_id',
          advice: '请重新选择图片后重试',
          retryable: false,
        },
        { status: 400 },
      )
    }

    const scene = payload.scene === undefined ? 'garment' : payload.scene
    if (
      typeof scene !== 'string' ||
      !(SUPPORTED_SCENES as readonly string[]).includes(scene)
    ) {
      return NextResponse.json(
        {
          error: '暂不支持的抠图场景，本期仅支持 garment（服饰智能分层）',
          code: 'unsupported_scene',
          advice: '请使用服饰场景重新进入智能抠图',
          retryable: false,
        },
        { status: 400 },
      )
    }

    try {
      const session = await dependencies.createSession(
        userResult.userId,
        assetId,
      )
      return NextResponse.json({ session })
    } catch (error) {
      const mapped = toCutoutSessionErrorBody(error)
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
  }
}
