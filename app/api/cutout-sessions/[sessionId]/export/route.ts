import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import {
  exportCutoutSession,
  toCutoutSessionErrorBody,
  type CutoutExportResult,
} from '@/lib/server/cutout-session-service'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{
    sessionId: string
  }>
}

interface CutoutExportRouteDependencies {
  authenticate: (
    request: NextRequest,
  ) => Promise<{ userId: string } | NextResponse>
  exportSession: (
    sessionId: string,
    userId: string,
    finalMask: Buffer,
    options: { refine: boolean },
  ) => Promise<CutoutExportResult>
}

const defaultDependencies: CutoutExportRouteDependencies = {
  authenticate: requireUser,
  exportSession: exportCutoutSession,
}

function readJsonBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

/** 把 dataURL 解成 Buffer 传给服务层（服务层也兼容直接收 Buffer）。 */
function decodeMaskDataUrl(dataUrl: string): Buffer | null {
  const match = dataUrl.match(
    /^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/,
  )
  if (!match) return null
  const buffer = Buffer.from(match[1], 'base64')
  return buffer.byteLength > 0 ? buffer : null
}

export function createCutoutExportPostHandler(
  dependencies: CutoutExportRouteDependencies = defaultDependencies,
) {
  return async function POST(request: NextRequest, context: RouteContext) {
    const userResult = await dependencies.authenticate(request)
    if (userResult instanceof NextResponse) return userResult

    const { sessionId } = await context.params
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

    const maskDataUrl =
      typeof payload.maskDataUrl === 'string' ? payload.maskDataUrl : ''
    const maskBuffer = decodeMaskDataUrl(maskDataUrl)
    if (!maskBuffer) {
      return NextResponse.json(
        {
          error: '蒙版 dataURL 无效，请重新完成选区后导出',
          code: 'invalid_mask_data',
          advice: '请重新完成选区后再次导出',
          retryable: false,
        },
        { status: 400 },
      )
    }

    try {
      const result = await dependencies.exportSession(
        sessionId,
        userResult.userId,
        maskBuffer,
        { refine: payload.refine === true },
      )
      return NextResponse.json(result)
    } catch (error) {
      const mapped = toCutoutSessionErrorBody(error)
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
  }
}

export const POST = createCutoutExportPostHandler()
