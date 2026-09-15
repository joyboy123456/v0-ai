'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera,
  DollarSign,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PersonStanding,
  Plus,
  Repeat2,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react'
import { CleanupDialog } from './cleanup-dialog'
import { InviteCodesDialog } from './invite-codes-dialog'
import { useAgentBetaAccess } from '@/components/agent-beta/use-agent-beta-access'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { AuthUser } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { FEATURES, FEATURE_LABELS, type FeatureType } from '@/lib/types'

const featureIcons = {
  'ai-fashion-photo': Camera,
  'photo-fission': Repeat2,
  'pose-fission': PersonStanding,
  'garment-detail': ZoomIn,
} satisfies Record<FeatureType, typeof Camera>

interface MobileShellProps {
  activeFeature: FeatureType
  onFeatureChange: (feature: FeatureType) => void
  user: AuthUser | null
  isAuthLoading: boolean
  onLogout: () => Promise<void>
  onRefreshTasks: () => void
  /** 创作表单滑层是否打开 */
  formOpen: boolean
  onFormOpenChange: (open: boolean) => void
  /** 表单是否已挂载过（懒挂载后为保留表单输入常驻 DOM） */
  formMounted: boolean
  /** LeftPanel 元素（由 Workbench 构造并透传全部业务 props） */
  form: ReactNode
  /** RightPanel 元素 */
  children: ReactNode
}

/**
 * 手机版工作台外壳（<768px）：顶部栏 + 功能 chips + 主内容 + 底部创作 CTA。
 * 业务状态全部在 Workbench，这里只是布局与导航；菜单项平移自桌面端 FeatureSidebar 底部。
 */
export function MobileShell({
  activeFeature,
  onFeatureChange,
  user,
  isAuthLoading,
  onLogout,
  onRefreshTasks,
  formOpen,
  onFormOpenChange,
  formMounted,
  form,
  children,
}: MobileShellProps) {
  const router = useRouter()
  const agentBetaEnabled = useAgentBetaAccess()
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const displayName = user?.displayName || user?.username || '未登录'
  const username = user?.username ?? '请先登录'
  const avatarLabel = (displayName || username).slice(0, 1).toUpperCase()
  const isAdmin = Boolean(user?.isAdmin)

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-ice-blue-gradient">
      {/* 顶部栏：品牌 + 当前功能 + 菜单入口 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/80 px-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_6px_var(--color-brand-primary)]" />
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
            <span className="font-bold text-primary">智能生成</span>工作台
          </h1>
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {FEATURE_LABELS[activeFeature]}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="打开菜单"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* 功能切换 chips（横向可滚动） */}
      <div className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2">
        {FEATURES.map((feature) => {
          const Icon = featureIcons[feature.id]
          const isActive = activeFeature === feature.id
          return (
            <button
              key={feature.id}
              type="button"
              onClick={() => onFeatureChange(feature.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                isActive
                  ? 'border-sky-100/50 bg-accent/80 text-primary shadow-sm'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {feature.name}
            </button>
          )
        })}
        {agentBetaEnabled ? (
          <button
            type="button"
            onClick={() => router.push('/beta/agent')}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-muted-foreground"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Agent画布
            <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">Beta</span>
          </button>
        ) : null}
      </div>

      {/* 主内容区：RightPanel 全宽独占 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* 底部创作 CTA（含 Home 指示条安全区） */}
      <div className="shrink-0 border-t border-border bg-card/90 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-md">
        <button
          type="button"
          onClick={() => onFormOpenChange(true)}
          className="btn-black flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold"
        >
          <Plus className="h-4 w-4" />
          创作新任务
        </button>
      </div>

      {/* 全屏创作表单滑层：懒挂载后常驻（translate 隐藏），保留表单输入状态 */}
      {formMounted && (
        <div
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-card transition-transform duration-300 ease-out',
            formOpen ? 'translate-y-0' : 'pointer-events-none translate-y-full',
          )}
          aria-hidden={!formOpen}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
            <h2 className="text-sm font-semibold text-foreground">
              {FEATURE_LABELS[activeFeature]}
            </h2>
            <button
              type="button"
              onClick={() => onFormOpenChange(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="收起创作面板"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{form}</div>
        </div>
      )}

      {/* 菜单抽屉：平移桌面端 FeatureSidebar 底部功能 */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="w-[280px] p-0">
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="text-sm">菜单</SheetTitle>
          </SheetHeader>
          <div className="space-y-1 p-3">
            {isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setInviteOpen(true)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <KeyRound className="size-4" />
                邀请码管理
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                router.push('/billing')
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <DollarSign className="size-4" />
              计费统计
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setCleanupOpen(true)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Trash2 className="size-4" />
              清理生成图
            </button>
            <ThemeToggle className="py-2.5 text-[13px] [&_svg]:size-4" />
          </div>
          <div className="mt-auto border-t border-border p-3">
            <div className="flex items-center gap-3 rounded-md bg-secondary/50 p-2.5">
              <Avatar className="size-8 border border-border bg-card shadow-sm">
                <AvatarFallback className="bg-secondary text-[11px] font-medium text-foreground">
                  {isAuthLoading ? '…' : avatarLabel}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {isAuthLoading ? '正在读取账号' : displayName}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {isAuthLoading ? '请稍候' : username}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-accent hover:text-primary"
                onClick={handleLogout}
                disabled={loggingOut || isAuthLoading}
                aria-label="退出登录"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <CleanupDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        onRefreshTasks={onRefreshTasks}
      />

      {isAdmin ? (
        <InviteCodesDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null}
    </div>
  )
}
