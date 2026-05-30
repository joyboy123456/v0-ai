/**
 * 全局认证 proxy（Edge Runtime）。
 *
 * 设计要点：
 * - 跳过登录页 / auth API / 静态资源 / API auth 子树
 * - local super-admin 模式：内网演示直接放行，不要求 cookie
 * - local password 模式：Edge runtime 看不见 Node.js 进程内 session Map，所以只做
 *   cookie 存在性拦截；真正有效性由 nodejs route / useAuth 再校验
 * - oss 模式：同 local password 模式处理
 * - 失效或缺失：API → 401 JSON；页面 → 302 /login?next=<原始 path>
 * - 有效：通过 `x-user-id` header 把 userId 注入到下游
 *
 * ⚠️ proxy 不能 import `bcryptjs` / `node:crypto`（Edge runtime 限制），
 *     这里只做基本校验，真正认证逻辑在 Node.js runtime 的 route 中处理。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { isLocalSuperAdminEnabled } from '@/lib/server/auth/local-auth-mode'

const SESSION_COOKIE_NAME = 'session_id'

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/health',
  '/_next',
  '/favicon.ico',
  '/icon',
  '/apple-icon',
  '/placeholder',
  '/poses',
  '/cases',
  '/generated',
  '/local-assets',
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

function readStorageMode(): 'local' | 'oss' {
  const raw = process.env.STORAGE_MODE?.trim().toLowerCase()
  return raw === 'oss' ? 'oss' : 'local'
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

function redirectLocalSuperAdminLogin(request: NextRequest): NextResponse {
  const rawNext = request.nextUrl.searchParams.get('next')
  const nextPath =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : '/'
  return NextResponse.redirect(new URL(nextPath, request.url))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const mode = readStorageMode()

  if (
    (mode === 'local' || mode === 'oss') &&
    isLocalSuperAdminEnabled() &&
    pathname === '/login'
  ) {
    return redirectLocalSuperAdminLogin(request)
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value

  // local / oss 模式处理
  if (mode === 'local' || mode === 'oss') {
    if (isLocalSuperAdminEnabled()) {
      return NextResponse.next()
    }

    if (!sessionId) {
      return rejectUnauthorized(request)
    }
    // local/oss 模式：cookie 存在性由 route 层校验
    return NextResponse.next()
  }

  // 不应该到达这里（cloud 模式已移除）
  return rejectUnauthorized(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
