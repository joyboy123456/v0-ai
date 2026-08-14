import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import {
  getSessionPreparedImage,
  toCutoutSessionErrorBody,
} from '@/lib/server/cutout-session-service'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{
    sessionId: string
  }>
}

interface SessionImageRouteDependencies {
  authenticate: (
    request: NextRequest,
  ) => Promise<{ userId: string } | NextResponse>
  getPreparedImage: (
    sessionId: string,
    userId: string,
  ) => Promise<{ buffer: Buffer; contentType: string }>
}

const defaultDependencies: SessionImageRouteDependencies = {
  authenticate: requireUser,
  getPreparedImage: getSessionPreparedImage,
}

export function createSessionImageGetHandler(
  dependencies: SessionImageRouteDependencies = defaultDependencies,
) {
  return async function GET(request: NextRequest, context: RouteContext) {
    const userResult = await dependencies.authenticate(request)
    if (userResult instanceof NextResponse) return userResult

    const { sessionId } = await context.params

    try {
      const { buffer, contentType } = await dependencies.getPreparedImage(
        sessionId,
        userResult.userId,
      )
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'private, max-age=600',
        },
      })
    } catch (error) {
      const mapped = toCutoutSessionErrorBody(error)
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
  }
}

export const GET = createSessionImageGetHandler()
