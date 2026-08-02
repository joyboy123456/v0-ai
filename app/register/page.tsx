'use client'

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { BrandLoader } from '@/components/ui/brand-loader'
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

interface RegisterResponse {
  ok: boolean
  error?: string
  message?: string
  user?: { id: string; username: string; displayName: string | null }
}

function sanitizeNextPath(raw: string | null): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = sanitizeNextPath(searchParams.get('next'))
  const { user, isLoading: checkingAuth } = useAuth()

  const [inviteCode, setInviteCode] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
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

    const trimmedInviteCode = inviteCode.trim()
    const trimmedUsername = username.trim()
    const trimmedDisplayName = displayName.trim()
    if (!trimmedInviteCode) {
      setError('请填写管理员提供的邀请码')
      return
    }
    if (!trimmedUsername || password.length < 6) {
      setError('用户名或密码格式不正确')
      return
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          inviteCode: trimmedInviteCode,
          username: trimmedUsername,
          password,
          ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as RegisterResponse
      if (!res.ok || !json.ok) {
        if (json.error === 'USERNAME_TAKEN') {
          setError('该用户名已被注册')
        } else if (json.error === 'INVALID_INVITE_CODE') {
          setError(json.message || '邀请码无效')
        } else if (json.error === 'INVITE_CODE_USED') {
          setError('邀请码已被使用')
        } else if (json.error === 'INVITE_CODE_EXPIRED') {
          setError('邀请码已过期，请联系管理员重新获取')
        } else if (json.error === 'INVALID_BODY') {
          setError(json.message || '用户名或密码格式不正确')
        } else if (json.error === 'TOO_MANY_ATTEMPTS') {
          setError('注册过于频繁，请稍后重试')
        } else {
          setError('注册失败，请稍后重试')
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
      <RegisterFallback
        title={redirecting ? '正在进入工作台' : '正在检查登录状态'}
        description="请稍候…"
      />
    )
  }

  const loginPath =
    nextPath === '/'
      ? '/login'
      : `/login?next=${encodeURIComponent(nextPath)}`

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
                邀请制注册
              </p>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight">
                使用邀请码创建账号
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
                请向管理员获取邀请码。每个账号只会看到自己的任务与素材。
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            没有邀请码将无法注册，也无法调用生成能力。
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
                <CardTitle className="text-xl">注册账号</CardTitle>
                <CardDescription>需要管理员发放的邀请码</CardDescription>
              </CardHeader>
              <form onSubmit={handleSubmit}>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="invite-code">邀请码</Label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="invite-code"
                        name="inviteCode"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        disabled={submitting}
                        placeholder="例如 ABCD-EFGH"
                        className="pl-9 font-mono tracking-wider"
                        maxLength={64}
                        required
                      />
                    </div>
                  </div>
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
                      minLength={3}
                      maxLength={32}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="password">密码</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      minLength={6}
                      maxLength={128}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="confirm-password">确认密码</Label>
                    <Input
                      id="confirm-password"
                      name="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={submitting}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="display-name">昵称（可选）</Label>
                    <Input
                      id="display-name"
                      name="displayName"
                      type="text"
                      autoComplete="nickname"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={submitting}
                      maxLength={64}
                    />
                  </div>
                  {error ? (
                    <p
                      role="alert"
                      className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      data-testid="register-error"
                    >
                      {error}
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="mt-6 flex flex-col gap-3">
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? '注册中…' : '注册'}
                  </Button>
                  <a
                    href={loginPath}
                    className="text-center text-xs text-primary hover:underline"
                  >
                    已有账号？去登录
                  </a>
                </CardFooter>
              </form>
            </Card>
          </div>
        </section>
      </div>
    </main>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterForm />
    </Suspense>
  )
}

function RegisterFallback({
  title = '注册',
  description = '请稍候…',
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <BrandLoader title={title} description={description} />
    </div>
  )
}
