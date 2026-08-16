import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import {
  classifyGarmentDetailAsset,
  GarmentDetailAssetNotFoundError,
  type GarmentDetailClassifyResponse,
} from '@/lib/server/garment-detail-classifier'

export const runtime = 'nodejs'

interface ClassifyRouteDependencies {
  authenticate: (request: NextRequest) => Promise<{ userId: string } | NextResponse>
  classify: (input: {
    assetId: string
    userId: string
  }) => Promise<GarmentDetailClassifyResponse>
}

const defaultDependencies: ClassifyRouteDependencies = {
  authenticate: requireUser,
  classify: classifyGarmentDetailAsset,
}

function fallbackBody(): GarmentDetailClassifyResponse {
  return {
    status: 'fallback',
    category: 'tops',
    confidence: 0,
    needsConfirmation: true,
    candidates: [],
    source: 'fallback',
    warning: '智能识别暂不可用，请手动确认商品分类',
  }
}

/**
 * POST /api/garment-detail/classify（PRD §7.2）
 * Body: { assetId: string }
 *
 * - 素材不存在或越权统一 404（不暴露素材存在性）；
 * - 分类成功返回 status='ok'；分类服务故障返回 status='fallback'（HTTP 200，
 *   不阻塞用户手动确认后生成）；
 * - 只接受 assetId，不接受任意公网 URL。
 *
 * 仿 cutout-sessions 路由的依赖注入工厂模式，便于测试。
 */
export function createClassifyPostHandler(
  dependencies: ClassifyRouteDependencies = defaultDependencies,
) {
  return async function POST(request: NextRequest) {
    const userResult = await dependencies.authenticate(request)
    if (userResult instanceof NextResponse) return userResult
    const { userId } = userResult

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      rawBody = null
    }
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json(
        { error: '请求体必须是 JSON 对象', code: 'INVALID_PARAMS', retryable: false },
        { status: 400 },
      )
    }

    const assetId = (rawBody as { assetId?: unknown }).assetId
    if (typeof assetId !== 'string' || !assetId.trim()) {
      return NextResponse.json(
        { error: '缺少要识别的 assetId', code: 'INVALID_PARAMS', retryable: false },
        { status: 400 },
      )
    }

    try {
      const result = await dependencies.classify({
        assetId: assetId.trim(),
        userId,
      })
      // fallback 也是 200（分类失败不阻塞生成）。
      return NextResponse.json(result)
    } catch (error) {
      if (error instanceof GarmentDetailAssetNotFoundError) {
        return NextResponse.json(
          { error: '素材不存在', code: 'ASSET_NOT_FOUND', retryable: false },
          { status: 404 },
        )
      }
      // 分类服务意外故障同样不阻塞用户：降级为 fallback 响应。
      console.error('[garment-detail/classify] 分类服务意外失败，降级处理', error)
      return NextResponse.json(fallbackBody())
    }
  }
}

export const POST = createClassifyPostHandler()
