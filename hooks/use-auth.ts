'use client'

/**
 * 当前登录用户 hook。
 *
 * 内部 fetch `/api/auth/me`，返回 `{ user, isLoading, error, logout, refresh }`。
 * 与项目其他 hooks 一致使用 useState + useEffect，避免引入 SWR / React Query。
 *
 * 注意：
 * - SSR 阶段不能调 fetch，先把 isLoading 置 true，挂载后再请求
 * - 401 视为「未登录」，不算 error，user = null
 * - logout 成功后内部 user 立即清空，调用方负责 router.push('/login')
 */

import { useCallback, useEffect, useState } from 'react'

export interface AuthUser {
  id: string
  username: string
  displayName: string | null
}

export interface UseAuthResult {
  user: AuthUser | null
  isLoading: boolean
  error: string | null
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMe = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    // 8 秒超时兜底：公网客户反复反馈「正在前往登录页」卡住，部分场景是 /api/auth/me
    // fetch 长时间没返回。这里用 AbortController 强制断开，避免 isLoading 永远挂住。
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (res.status === 401) {
        setUser(null)
        return
      }
      if (!res.ok) {
        setError(`auth me failed: HTTP ${res.status}`)
        setUser(null)
        return
      }
      const json = (await res.json()) as { ok: boolean; user?: AuthUser }
      if (json.ok && json.user) {
        setUser(json.user)
      } else {
        setUser(null)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('网络较慢，请检查网络或重试')
      } else {
        setError(err instanceof Error ? err.message : '获取登录态失败')
      }
      setUser(null)
    } finally {
      clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // 忽略网络错误，本地清空即可
    }
    setUser(null)
  }, [])

  return { user, isLoading, error, logout, refresh: fetchMe }
}
