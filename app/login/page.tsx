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

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LockKeyhole, ShieldCheck } from 'lucide-react'

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
import { useAuth } from '@/hooks/use-auth'

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
  const { user, isLoading: checkingAuth } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    setRedirecting(true)
    router.replace(nextPath)
    router.refresh()
  }, [nextPath, router, user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      setRedirecting(true)
      router.replace(nextPath)
      router.refresh()
    } catch {
      setError('网络异常，请检查连接')
    } finally {
      setSubmitting(false)
    }
  }

  if (checkingAuth || redirecting) {
    return (
      <LoginFallback
        title={redirecting ? '正在进入工作台' : '正在检查登录状态'}
        description="请稍候…"
      />
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 lg:grid-cols-[1fr_420px]">
        <section className="hidden min-h-screen flex-col justify-between border-r border-border/70 px-10 py-10 lg:flex">
          <div>
            <div className="mb-12 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight">内部测试入口</p>
                <p className="text-xs text-muted-foreground">商拍生成工作台</p>
              </div>
            </div>
            <div className="max-w-lg">
              <p className="mb-4 inline-flex rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                5 席内测
              </p>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight">
                进入工作台前请先登录
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
                使用管理员分配的账号进入工作台。每个账号只会看到自己的任务与素材。
              </p>
              <div className="mt-8 grid max-w-md grid-cols-3 gap-3">
                <div className="rounded-md border border-border/80 bg-card/60 p-3">
                  <p className="text-xs font-medium text-foreground">账号隔离</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">任务按用户分开</p>
                </div>
                <div className="rounded-md border border-border/80 bg-card/60 p-3">
                  <p className="text-xs font-medium text-foreground">云端素材</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">上传与结果分区</p>
                </div>
                <div className="rounded-md border border-border/80 bg-card/60 p-3">
                  <p className="text-xs font-medium text-foreground">公网内测</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">仅限分配账号</p>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            公网访问开启前请确认 Cloud 模式与账号隔离验证已通过。
          </p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <div className="flex size-9 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">内部测试入口</p>
                <p className="text-xs text-muted-foreground">商拍生成工作台</p>
              </div>
            </div>

            <Card className="border-border/80 bg-card/95 shadow-none">
              <CardHeader className="gap-1">
                <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                  <LockKeyhole className="size-4" />
                </div>
                <CardTitle className="text-xl">账号登录</CardTitle>
                <CardDescription>请输入管理员分配的用户名和密码</CardDescription>
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
                      className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      data-testid="login-error"
                    >
                      {error}
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="mt-6 flex flex-col gap-3">
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? '登录中…' : '登录'}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    忘记账号请联系管理员
                  </p>
                </CardFooter>
              </form>
            </Card>
          </div>
        </section>
      </div>
    </main>
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

function LoginFallback({
  title = '登录',
  description = '请稍候…',
}: {
  title?: string
  description?: string
}) {
  return <LoginFallbackContent title={title} description={description} />
}

function LoginFallbackContent({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
