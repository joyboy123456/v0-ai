import { NextResponse } from 'next/server'
import { getPoseFissionCase } from '@/lib/server/pose-fission-service'

interface RouteContext {
  params: Promise<{
    caseId: string
  }>
}

/**
 * 获取单个姿势裂变案例详情（供「做同款」回填使用）。
 *
 * 与 photo-fission 既有 `cases/[caseId]/route.ts` 同模式：
 * - 404：caseId 不在 POSE_FISSION_CASES 中
 * - 200：返回完整 PoseFissionCase 对象
 */
export async function GET(_request: Request, context: RouteContext) {
  const { caseId } = await context.params
  const poseCase = getPoseFissionCase(caseId)
  if (!poseCase) {
    return NextResponse.json({ error: '案例不存在' }, { status: 404 })
  }
  return NextResponse.json(poseCase)
}
