'use client'

/**
 * /login 页面：「生成之墙」沉浸式登录。
 *
 * 设计：整页一块交互画布——平台真实生成图组成三列纵向无限滚动的图片墙，
 * 鼠标视差（framer-motion spring 物理）驱动墙 / 文案 / 登录卡三层景深；
 * 实验性排版（描边大字 + 等宽小号 kicker）叠加在压暗的画布上。
 *
 * 素材均为本平台 OSS 真实生成结果；图片墙遵守 prefers-reduced-motion。
 * 图标统一 Lucide，无表情符号。
 */

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion'
import {
  Aperture,
  ArrowRight,
  Eye,
  EyeOff,
  Images,
  LayoutGrid,
  LockKeyhole,
  PersonStanding,
} from 'lucide-react'

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
import { getOssThumbnailUrl } from '@/lib/utils'

/** 图片墙素材：平台真实生成结果（OSS 公网地址，加载时走实时缩略图）。 */
const OSS_PREFIX =
  'https://heinimumu.oss-cn-hangzhou.aliyuncs.com/yibai/results/usr_local_user01'

const WALL_COLUMNS: Array<{
  images: string[]
  durationSec: number
  reverse?: boolean
  className?: string
}> = [
  {
    images: [
      `${OSS_PREFIX}/result_task_1784973566502_qk4lvn_1.png`, // 户外黄外套
      `${OSS_PREFIX}/result_task_1785160293926_awo8b6_1.png`, // 薄荷开衫
      `${OSS_PREFIX}/result_task_1784806364055_55dogr_1.png`, // 黑钻阔腿裤
    ],
    durationSec: 46,
  },
  {
    images: [
      `${OSS_PREFIX}/result_task_1786184952394_m7rzkx_1.png`, // 车内藏青外套
      `${OSS_PREFIX}/result_task_1785752663046_zg6g2p_1.png`, // 灰红棒球服
      `${OSS_PREFIX}/result_task_1784370137443_uq0quk_1.png`, // 白色牛仔裤
    ],
    durationSec: 38,
    reverse: true,
  },
  {
    images: [
      `${OSS_PREFIX}/result_task_1786112944010_d2r13p_1.png`, // 公园粉外套
      `${OSS_PREFIX}/result_task_1784299810164_1urdyc_1.png`, // 格纹花苞裤
      `${OSS_PREFIX}/result_task_1784109768985_81tmwh_1.png`, // 黑卫衣挥手
    ],
    durationSec: 54,
  },
  {
    images: [
      `${OSS_PREFIX}/result_task_1786183727393_2pi6iv_1.png`, // 黑运动套装
      `${OSS_PREFIX}/result_task_1786182916708_7joupc_1.png`, // 腰绑格纹衬衫
      `${OSS_PREFIX}/result_task_1786182915204_fjzx5j_1.png`, // 报纸印花卫衣
    ],
    durationSec: 42,
    reverse: true,
    className: 'hidden xl:block',
  },
]

const FEATURE_CHIPS = [
  { icon: Images, label: 'AI 服装大片', desc: '参考图直出模特图' },
  { icon: PersonStanding, label: '姿势裂变', desc: '一键换多种姿势' },
  { icon: LayoutGrid, label: '套装分镜', desc: '9 张叙事套图' },
] as const

/** 图片墙单列：内容复制两份，CSS 动画在 -50% 处无缝循环。 */
function MarqueeColumn({
  images,
  durationSec,
  reverse,
}: {
  images: string[]
  durationSec: number
  reverse?: boolean
}) {
  return (
    <div
      className="login-marquee-y flex flex-col"
      style={{
        animationDuration: `${durationSec}s`,
        animationDirection: reverse ? 'reverse' : 'normal',
      }}
    >
      {[...images, ...images].map((src, index) => (
        <img
          key={index}
          src={getOssThumbnailUrl(src, 640)}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          // 装饰性背景图：低网络优先级，不与首屏关键资源争抢带宽
          // （optimize-image-priority 指南：首屏内的装饰图用 fetchpriority=low）
          fetchPriority="low"
          draggable={false}
          className="mb-4 aspect-[3/4] w-full select-none rounded-xl object-cover"
        />
      ))}
    </div>
  )
}

// 入场动效：父级 stagger，子级弹簧升起 + 去模糊
const entranceStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } },
}
const riseIn = {
  hidden: { opacity: 0, y: 28, filter: 'blur(6px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 90, damping: 18 },
  },
}

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
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 鼠标视差：归一化 -1..1，弹簧平滑后按层分配位移（墙 > 文案 > 卡片）
  const reduceMotion = useReducedMotion()
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const springConfig = { stiffness: 60, damping: 20, mass: 0.8 }
  const smoothX = useSpring(mouseX, springConfig)
  const smoothY = useSpring(mouseY, springConfig)
  const wallX = useTransform(smoothX, (v) => (reduceMotion ? 0 : v * -18))
  const wallY = useTransform(smoothY, (v) => (reduceMotion ? 0 : v * -12))
  const headlineX = useTransform(smoothX, (v) => (reduceMotion ? 0 : v * 6))
  const cardX = useTransform(smoothX, (v) => (reduceMotion ? 0 : v * 10))
  const cardY = useTransform(smoothY, (v) => (reduceMotion ? 0 : v * 8))

  function handleMouseMove(event: React.MouseEvent<HTMLElement>) {
    if (reduceMotion) return
    mouseX.set((event.clientX / window.innerWidth - 0.5) * 2)
    mouseY.set((event.clientY / window.innerHeight - 0.5) * 2)
  }

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
    <main
      className="relative min-h-screen overflow-hidden bg-background bg-gradient-to-br from-[#F8FCFF] via-[#EAF8FF] to-[#DDF5FF] text-foreground dark:bg-none"
      onMouseMove={handleMouseMove}
    >
      {/* 生成之墙：三/四列真实案例纵向无限滚动，倾斜铺满整个画布 */}
      <motion.div
        aria-hidden
        className="absolute -inset-x-24 -inset-y-24"
        style={{ x: wallX, y: wallY }}
      >
        <div className="flex h-full rotate-[-6deg] gap-4">
          {WALL_COLUMNS.map((column, index) => (
            <div key={index} className={`min-w-0 flex-1 ${column.className ?? ''}`}>
              <MarqueeColumn
                images={column.images}
                durationSec={column.durationSec}
                reverse={column.reverse}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* 左清右糊：左侧基本不罩（图片墙主角），右侧登录卡区域罩厚 + 高斯模糊托底 */}
      <div className="absolute inset-0 bg-white/10 dark:bg-black/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-white/40 to-[#EAF8FF]/80 dark:from-black/20 dark:via-black/40 dark:to-background/80" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#F8FCFF]/55 via-transparent to-[#DDF5FF]/65 dark:from-background/55 dark:to-background/65" />
      <div className="absolute inset-0 backdrop-blur-[3px] [mask-image:linear-gradient(to_left,black_25%,transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_18%_22%,rgba(56,189,248,0.14),transparent)]" />

      {/* 顶部品牌条 */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 90, damping: 18 }}
        className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-6 lg:px-10"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-primary/25 bg-card/70 text-primary backdrop-blur-sm">
            <Aperture className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">商拍生成工作台</p>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Yibai AI Fashion Studio
            </p>
          </div>
        </div>
        <p className="hidden rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary backdrop-blur-sm sm:block">
          5 席内测
        </p>
      </motion.header>

      {/* 主体：左文案 + 右悬浮登录卡（同一画布，无分割边框） */}
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-4 pb-16 pt-24 lg:flex-row lg:items-center lg:justify-between lg:gap-12 lg:px-10">
        <motion.section
          variants={entranceStagger}
          initial="hidden"
          animate="show"
          style={{ x: headlineX }}
          className="hidden max-w-xl lg:block"
        >
          <motion.p
            variants={riseIn}
            className="mb-6 text-[11px] uppercase tracking-[0.35em] text-muted-foreground [text-shadow:0_1px_8px_rgba(255,255,255,0.9)]"
          >
            AI Fashion Studio — Internal Beta
          </motion.p>
          <motion.h1 variants={riseIn} className="text-6xl font-semibold leading-[1.05] tracking-tight text-foreground [text-shadow:0_1px_14px_rgba(255,255,255,0.8)] xl:text-7xl">
            <span className="block">一键生成</span>
            <span className="block text-transparent [-webkit-text-stroke:1.5px_rgba(2,132,199,0.7)] [text-shadow:none]">
              商拍级
            </span>
            <span className="block">
              服装大片<span className="text-primary">。</span>
            </span>
          </motion.h1>
          <motion.p
            variants={riseIn}
            className="mt-6 max-w-sm text-sm leading-6 text-muted-foreground [text-shadow:0_1px_8px_rgba(255,255,255,0.9)]"
          >
            上传服装参考图，AI 自动生成模特大片、姿势裂变与套装分镜。
            身后这面墙上的每一张图，都由本平台生成。
          </motion.p>
          <motion.div variants={riseIn} className="mt-10 grid max-w-md grid-cols-3 gap-3">
            {FEATURE_CHIPS.map((chip) => (
              <div
                key={chip.label}
                className="rounded-md border border-border bg-card/70 p-3 shadow-card backdrop-blur-md"
              >
                <chip.icon className="mb-2 size-4 text-primary" />
                <p className="text-xs font-medium text-foreground">{chip.label}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{chip.desc}</p>
              </div>
            ))}
          </motion.div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 32, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ type: 'spring', stiffness: 80, damping: 18, delay: 0.35 }}
          style={{ x: cardX, y: cardY }}
          className="mx-auto w-full max-w-sm lg:mx-0"
        >
          {/* 移动端精简标题（大屏由左侧大标题承担） */}
          <div className="mb-6 text-center lg:hidden">
            <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              AI Fashion Studio — Internal Beta
            </p>
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              一键生成商拍级服装大片
            </p>
          </div>

          <Card className="border-border bg-card/85 shadow-2xl backdrop-blur-xl">
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
                    // 移动端键盘回车键提示（sign-in-form 指南）
                    enterKeyHint="next"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="current-password">密码</Label>
                  <div className="relative">
                    <Input
                      // MANDATORY：登录密码框使用 id="current-password"
                      // + autocomplete="current-password"，密码管理器才能正确识别
                      // 当前密码并自动填充（sign-in-form 指南）
                      id="current-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      enterKeyHint="go"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={submitting}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      aria-pressed={showPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
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
                <Button type="submit" className="group w-full" disabled={submitting}>
                  {submitting ? '登录中…' : '登录'}
                  {!submitting && (
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                  )}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  忘记账号请联系管理员
                </p>
                <a
                  href={
                    nextPath === '/'
                      ? '/register'
                      : `/register?next=${encodeURIComponent(nextPath)}`
                  }
                  className="text-center text-xs text-primary hover:underline"
                >
                  有邀请码？去注册
                </a>
              </CardFooter>
            </form>
          </Card>
          <p className="mt-6 text-center text-xs text-muted-foreground lg:text-left">
            每个账号只会看到自己的任务与素材 · 仅限分配账号
          </p>
        </motion.section>
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
      <BrandLoader title={title} description={description} />
    </div>
  )
}
