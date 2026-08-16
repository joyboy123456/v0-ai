import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { listAvailableGarmentDetailModels } from '@/lib/server/garment-detail-model-registry'

export const runtime = 'nodejs'

/**
 * GET /api/garment-detail/models（PRD §7.1）
 *
 * 返回当前有可用上游渠道的模型档位（std-v1 / pro-v1）；
 * 全部不可用时返回 503 MODEL_UNAVAILABLE（retryable）。
 * 响应不暴露候选上游模型 ID、Provider 凭证与渠道地址。
 */
export async function GET(request: NextRequest) {
  const userResult = await requireUser(request)
  if (userResult instanceof NextResponse) return userResult

  const models = listAvailableGarmentDetailModels()
  if (!models.length) {
    return NextResponse.json(
      {
        error: '细节图模型暂不可用，请稍后重试',
        code: 'MODEL_UNAVAILABLE',
        retryable: true,
      },
      { status: 503 },
    )
  }

  return NextResponse.json({ models })
}
