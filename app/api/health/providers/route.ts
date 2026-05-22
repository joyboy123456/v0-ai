/**
 * /api/health/providers
 *
 * 返回每个图像生成 provider 的当前健康状态（可用性、熔断剩余时间、权重等），
 * 方便一行 curl 就能看出哪个渠道在抽风。Public 路由（middleware 已白名单 /api/health/*）。
 *
 * Why: 七牛云中转偶尔 502/429 抽风时，pool 会熔断该 provider 30s。
 *      没有这个接口时，需要去 tail 日志才能知道当前熔断状态——太麻烦。
 */

import { NextResponse } from 'next/server'

import { getProviderHealthSnapshot } from '@/lib/server/image-provider-pool'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const providers = getProviderHealthSnapshot()
  const summary = {
    total: providers.length,
    available: providers.filter((p) => p.available).length,
    circuitOpen: providers.filter((p) => p.circuitOpenUntil !== null).length,
    disabled: providers.filter((p) => !p.enabled).length,
  }
  return NextResponse.json(
    {
      ok: true,
      timestamp: Date.now(),
      summary,
      providers,
    },
    { status: 200 },
  )
}
