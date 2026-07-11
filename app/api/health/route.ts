/**
 * Health check endpoint —— 让运维同学一行 curl 就能确认整个系统活着。
 *
 * 设计要点：
 * - **公开端点**：不走 requireUser，middleware 白名单已加 `/api/health`。
 * - **依赖异常返回 503**：让看门狗只检查 HTTP 状态码也能发现 OSS 故障。
 * - **STORAGE_MODE=local**：services 全部 `'skipped'`。
 * - **STORAGE_MODE=oss**：
 *   - oss: 检查 OSS 连通性
 */

import { NextResponse } from 'next/server'

import { STORAGE_MODE } from '@/lib/server/storage-mode'
import { getStorageAdapter } from '@/lib/server/storage/storage-adapter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ServiceStatus = 'ok' | 'skipped' | string

interface HealthResponse {
  ok: boolean
  storageMode: 'local' | 'oss'
  services: {
    oss: ServiceStatus
  }
  providers?: {
    id: string
    type: string
    enabled: boolean
    available: boolean
  }[]
  timestamp: number
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `error: ${error.message.slice(0, 200)}`
  }
  return `error: ${String(error).slice(0, 200)}`
}

async function probeOss(): Promise<ServiceStatus> {
  try {
    const adapter = getStorageAdapter()
    // 尝试获取一个不存在的 key来测试连接
    await adapter.getImage('__health__/probe')
    // 不存在返回 null 是正常的，说明连接正常
    return 'ok'
  } catch (error) {
    const msg = String(error)
    // NOT_FOUND 是正常的，说明连接正常
    if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
      return 'ok'
    }
    return formatError(error)
  }
}

export async function GET() {
  const payload: HealthResponse = {
    ok: true,
    storageMode: STORAGE_MODE,
    services: {
      oss: 'skipped',
    },
    timestamp: Date.now(),
  }

  if (STORAGE_MODE === 'oss') {
    payload.services.oss = await probeOss()
    payload.ok = payload.services.oss === 'ok'
  }

  // 获取 provider 健康状态（延迟加载以避免循环依赖）
  try {
    const { getProviderHealthSnapshot } = await import('@/lib/server/image-provider-pool')
    payload.providers = getProviderHealthSnapshot().map((p) => ({
      id: p.id,
      type: p.type,
      enabled: p.enabled,
      available: p.available,
    }))
  } catch {
    // provider pool 加载失败不影响 health 状态
  }

  return NextResponse.json(payload, { status: payload.ok ? 200 : 503 })
}
