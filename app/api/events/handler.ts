import { NextResponse, type NextRequest } from 'next/server'

import { requireUser } from '@/lib/server/auth/require-user'

/**
 * 智能抠图埋点事件白名单（PRD §31）。
 * 前端通过 POST /api/events 上报，落服务端结构化日志（pm2 日志体系）。
 */
const CUTOUT_EVENT_NAMES = [
  'cutout_open',
  'cutout_prepare_success',
  'cutout_prepare_failed',
  'cutout_auto_select',
  'cutout_add_select',
  'cutout_subtract_select',
  'cutout_paint',
  'cutout_erase',
  'cutout_invert',
  'cutout_undo',
  'cutout_redo',
  'cutout_complete',
  'cutout_export_failed',
  'cutout_cancel',
] as const

type CutoutEventName = (typeof CUTOUT_EVENT_NAMES)[number]

/** 日志里保留的键不允许被客户端 payload 覆盖。 */
const RESERVED_LOG_KEYS = new Set(['userId', 'event', 'ts'])

interface EventsRouteDependencies {
  authenticate: (
    request: NextRequest,
  ) => Promise<{ userId: string } | NextResponse>
}

const defaultDependencies: EventsRouteDependencies = {
  authenticate: requireUser,
}

function readJsonBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

/** payload 只允许基本类型（string/number/boolean/null）的扁平对象。 */
function isBasicPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (item) =>
      item === null ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean',
  )
}

export function createEventsPostHandler(
  dependencies: EventsRouteDependencies = defaultDependencies,
) {
  return async function POST(request: NextRequest) {
    const userResult = await dependencies.authenticate(request)
    if (userResult instanceof NextResponse) return userResult

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

    const event = payload.event
    if (
      typeof event !== 'string' ||
      !(CUTOUT_EVENT_NAMES as readonly string[]).includes(event)
    ) {
      return NextResponse.json(
        {
          error: '非法埋点事件名',
          code: 'invalid_event',
          advice: '请使用受支持的抠图事件名',
          retryable: false,
        },
        { status: 400 },
      )
    }

    let eventPayload: Record<string, unknown> = {}
    if (payload.payload !== undefined) {
      if (!isBasicPayload(payload.payload)) {
        return NextResponse.json(
          {
            error: '埋点 payload 只允许基本类型字段',
            code: 'invalid_payload',
            advice: '请只上报字符串、数字、布尔值或 null',
            retryable: false,
          },
          { status: 400 },
        )
      }
      const rawPayload = payload.payload as Record<string, unknown>
      for (const [key, value] of Object.entries(rawPayload)) {
        if (!RESERVED_LOG_KEYS.has(key)) eventPayload[key] = value
      }
    }

    console.info('[cutout-event] 智能抠图埋点', {
      userId: userResult.userId,
      event: event as CutoutEventName,
      ts: new Date().toISOString(),
      ...eventPayload,
    })
    return NextResponse.json({ ok: true })
  }
}
