import { NextResponse } from 'next/server'
import { hideCaseShot } from '@/lib/server/photo-fission-case-store'

interface RouteContext {
  params: Promise<{
    caseId: string
  }>
}

interface DeleteShotBody {
  shotUrl?: string
}

/**
 * 软隐藏 photo-fission 案例中的某张 shot。
 *
 * Body: { shotUrl: string }
 *   shotUrl 是 PHOTO_FISSION_CASES[caseId].resultImageUrls 中的某条 URL。
 *   server 据此反查原始下标，避免前端因过滤后下标偏移导致误删。
 *
 * 400：缺少 shotUrl
 * 404：caseId 不存在或 shotUrl 不属于该 case
 * 200：成功（含幂等）
 */
export async function DELETE(request: Request, context: RouteContext) {
  const { caseId } = await context.params

  let body: DeleteShotBody
  try {
    body = (await request.json()) as DeleteShotBody
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  if (!body.shotUrl || typeof body.shotUrl !== 'string') {
    return NextResponse.json({ error: '缺少 shotUrl' }, { status: 400 })
  }

  const ok = await hideCaseShot(caseId, body.shotUrl)
  if (!ok) {
    return NextResponse.json(
      { error: '案例或镜头不存在' },
      { status: 404 },
    )
  }
  return NextResponse.json({ success: true })
}
