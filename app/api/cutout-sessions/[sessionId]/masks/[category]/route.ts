import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'
import {
  getCategoryMask,
  toCutoutSessionErrorBody,
} from '@/lib/server/cutout-session-service'
import type { CutoutCategory } from '@/lib/types'

/** 类别白名单：与 lib/types.ts 的 CutoutCategory 一致。 */
const CATEGORY_WHITELIST: readonly CutoutCategory[] = [
  'tops',
  'coat',
  'skirt',
  'pants',
  'bag',
  'shoes',
  'hat',
  'skin',
  'hair',
  'body',
  'common',
]

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{
    sessionId: string
    category: string
  }>
}

interface CategoryMaskRouteDependencies {
  authenticate: (
    request: NextRequest,
  ) => Promise<{ userId: string } | NextResponse>
  getMask: (
    sessionId: string,
    userId: string,
    category: CutoutCategory,
  ) => Promise<Buffer>
}

const defaultDependencies: CategoryMaskRouteDependencies = {
  authenticate: requireUser,
  getMask: getCategoryMask,
}

export function createCategoryMaskGetHandler(
  dependencies: CategoryMaskRouteDependencies = defaultDependencies,
) {
  return async function GET(request: NextRequest, context: RouteContext) {
    const userResult = await dependencies.authenticate(request)
    if (userResult instanceof NextResponse) return userResult

    const { sessionId, category: rawCategory } = await context.params
    if (!(CATEGORY_WHITELIST as readonly string[]).includes(rawCategory)) {
      return NextResponse.json(
        {
          error: '类别无效，仅支持服饰七类与皮肤/头发/人体/通用主体',
          code: 'invalid_category',
          advice: '请刷新页面后重试',
          retryable: false,
        },
        { status: 400 },
      )
    }

    try {
      const buffer = await dependencies.getMask(
        sessionId,
        userResult.userId,
        rawCategory as CutoutCategory,
      )
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'cache-control': 'private, max-age=300',
        },
      })
    } catch (error) {
      const mapped = toCutoutSessionErrorBody(error)
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
  }
}

export const GET = createCategoryMaskGetHandler()
