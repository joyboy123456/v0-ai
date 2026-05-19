/**
 * 全局认证 middleware（Edge Runtime）。
 *
 * 设计要点（任务说明 §7 / PRD D5）：
 * - 跳过登录页 / auth API / 静态资源 / API auth 子树
 * - cloud 模式：通过 KV REST API 校验 session（Edge runtime 能跑 fetch）
 * - local 模式：直接放行（local 用进程内 Map，middleware 在 Edge runtime
 *   隔离环境里看不见 Map，这是 PR2 的已知 trade-off，PR5 端到端时会用 cloud 模式实测）
 * - 失效或缺失：API → 401 JSON；页面 → 302 /login?next=<原始 path>
 * - 有效：通过 `x-user-id` header 把 userId 注入到下游
 *
 * ⚠️ middleware 不能 import `bcryptjs` / `node:crypto`（Edge runtime 限制），
 *     这里只读 KV，所以没问题。
 */

import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE_NAME = 'session_id'

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health', // PR5 健康检查端点，curl 一行验证整个系统活着
  '/_next',
  '/favicon.ico',
  '/icon',
  '/apple-icon',
  '/placeholder',
  '/poses',
  '/cases',
  '/generated', // public 静态资源（local 模式下生成的图片）
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return false
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true
  }
  // 静态文件后缀（图片 / CSS / 字体等）一律放行
  if (/\.(?:png|jpe?g|gif|svg|webp|ico|css|js|woff2?|map|txt)$/i.test(pathname)) {
    return true
  }
  return false
}

function readStorageMode(): 'local' | 'cloud' {
  const raw = process.env.STORAGE_MODE?.trim().toLowerCase()
  return raw === 'cloud' ? 'cloud' : 'local'
}

interface SessionPayload {
  userId: string
  expiresAt: number
}

async function verifyKvSession(
  sessionId: string,
): Promise<SessionPayload | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_D1_KV_TOKEN
  const namespaceId = process.env.KV_NAMESPACE_ID
  if (!accountId || !token || !namespaceId) {
    // cloud 模式但 env 缺失：拒绝所有请求（保险起见）
    return null
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(sessionId)}`

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.status === 404) return null
    if (!response.ok) return null
    const raw = await response.text()
    const parsed = JSON.parse(raw) as Partial<SessionPayload>
    if (!parsed.userId || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt <= Date.now()) return null
    return { userId: parsed.userId, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

function rejectUnauthorized(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const loginUrl = new URL('/login', request.url)
  const nextPath = `${pathname}${search ?? ''}`
  if (nextPath && nextPath !== '/login') {
    loginUrl.searchParams.set('next', nextPath)
  }
  return NextResponse.redirect(loginUrl)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const mode = readStorageMode()

  if (mode === 'local') {
    // local 模式：进程内 Map 在 Edge runtime 隔离环境不可见，
    // 此处放行不强制鉴权（PR2 已知 trade-off，仅本地开发用）。
    // 仍把 cookie 中的 sessionId 透传给下游路由，方便它们自己做软鉴权。
    const headers = new Headers(request.headers)
    if (sessionId) headers.set('x-session-id', sessionId)
    return NextResponse.next({ request: { headers } })
  }

  // cloud 模式：严格校验
  if (!sessionId) {
    return rejectUnauthorized(request)
  }
  const payload = await verifyKvSession(sessionId)
  if (!payload) {
    return rejectUnauthorized(request)
  }

  const headers = new Headers(request.headers)
  headers.set('x-user-id', payload.userId)
  headers.set('x-session-id', sessionId)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  // 排除 _next 静态资源（更彻底地降低 middleware 调用次数）。
  // 注意：API 路由仍走 middleware。
  matcher: ['/((?!_next/static|_next/image).*)'],
}
