/**
 * Health check endpoint —— 让运维同学一行 curl 就能确认整个系统活着。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR5 引入。
 *
 * 设计要点：
 * - **公开端点**：不走 requireUser，middleware 白名单已加 `/api/health`。
 * - **不抛 5xx**：哪怕底层服务挂了，本路由也返回 200 + `error: ...`。
 *   原因：health 是状态报告，不是 critical failure；curl/监控脚本看到 200
 *   再解析 services 子项，比看到 5xx 更稳定。
 * - **STORAGE_MODE=local**：services 全部 `'skipped'`，不调任何 Cloudflare API。
 * - **STORAGE_MODE=cloud**：
 *   - d1: `SELECT 1` via executeD1Query
 *   - kv: `kvGet('__health__')`（key 不存在返 null 仍是 ok）
 *   - r2: `r2Head('__health__/probe')`（key 不存在仍是 ok）
 */

import { NextResponse } from 'next/server'

import { executeD1Query, kvGet } from '@/lib/server/cloudflare'
import { r2Head } from '@/lib/server/storage/r2-client'
import { STORAGE_MODE } from '@/lib/server/storage-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ServiceStatus = 'ok' | 'skipped' | string

interface HealthResponse {
  ok: boolean
  storageMode: 'local' | 'cloud'
  services: {
    d1: ServiceStatus
    kv: ServiceStatus
    r2: ServiceStatus
  }
  timestamp: number
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `error: ${error.message.slice(0, 200)}`
  }
  return `error: ${String(error).slice(0, 200)}`
}

async function probeD1(): Promise<ServiceStatus> {
  try {
    const result = await executeD1Query<{ ok: number }>('SELECT 1 AS ok')
    if (result.success) return 'ok'
    return 'error: D1 returned success=false'
  } catch (error) {
    return formatError(error)
  }
}

async function probeKv(): Promise<ServiceStatus> {
  try {
    // 拉一个永远不存在的 key；只要 GET 不报网络/认证错就视为 ok。
    await kvGet('__health__')
    return 'ok'
  } catch (error) {
    return formatError(error)
  }
}

async function probeR2(): Promise<ServiceStatus> {
  try {
    // HEAD 一个永远不存在的 key；exists=false 也是 ok（说明签名/网络通畅）。
    await r2Head('__health__/probe')
    return 'ok'
  } catch (error) {
    return formatError(error)
  }
}

export async function GET() {
  const payload: HealthResponse = {
    ok: true,
    storageMode: STORAGE_MODE,
    services: {
      d1: 'skipped',
      kv: 'skipped',
      r2: 'skipped',
    },
    timestamp: Date.now(),
  }

  if (STORAGE_MODE === 'cloud') {
    const [d1Status, kvStatus, r2Status] = await Promise.all([
      probeD1(),
      probeKv(),
      probeR2(),
    ])
    payload.services.d1 = d1Status
    payload.services.kv = kvStatus
    payload.services.r2 = r2Status
  }

  return NextResponse.json(payload, { status: 200 })
}
