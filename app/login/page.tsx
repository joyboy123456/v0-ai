'use client'

/**
 * /login 页面：极简用户名 + 密码登录。
 *
 * 遵守 frontend/component-guidelines.md / quality-guidelines.md：
 * - 使用 shadcn 组件 Card / Input / Button / Label，不自造容器
 * - useState + useEffect，没有 localStorage（无需考虑 SSR hydration）
 * - 支持 ?next=<path> 登录后跳回原路径，参考 middleware 的 redirect 设计
 *
 * Out of scope：注册 / 忘记密码 / 邮箱验证 / 验证码 / 记住我（PRD §Out of Scope）。
 */

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginResponse {
  ok: boolean
  error?: string
  user?: { id: string; username: string; displayName: string | null }
}

function sanitizeNextPath(raw: string | null): string {
  if (!raw) return '/'
  // 防止开放重定向：只允许同站相对路径
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = sanitizeNextPath(searchParams.get('next'))

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)

    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      setError('请输入用户名和密码')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: trimmedUsername, password }),
      })
      const json = (await res.json().catch(() => ({}))) as LoginResponse
      if (!res.ok || !json.ok) {
        if (json.error === 'INVALID_CREDENTIALS') {
          setError('用户名或密码错误')
        } else if (json.error === 'CONFIG_ERROR') {
          setError('后端配置异常，请联系管理员')
        } else {
          setError('登录失败，请稍后重试')
        }
        return
      }
      // 登录成功：跳到 next 或 /
      router.push(nextPath)
      router.refresh()
    } catch {
      setError('网络异常，请检查连接')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">登录</CardTitle>
          <CardDescription>请使用管理员分配的账号登录</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            {error ? (
              <p
                role="alert"
                className="text-sm text-destructive"
                data-testid="login-error"
              >
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="mt-6 flex flex-col gap-2">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '登录中…' : '登录'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  // useSearchParams 必须在 Suspense 边界内（Next.js 16 App Router）
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  )
}

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">登录</CardTitle>
          <CardDescription>请稍候…</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
