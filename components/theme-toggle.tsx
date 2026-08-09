'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

/**
 * 亮/暗/跟随系统 三态主题切换行（样式对齐 FeatureSidebar 底部菜单项）。
 * mounted 前渲染占位图标，避免水合不匹配。
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const order = ['light', 'dark', 'system'] as const
  const current = mounted && order.includes(theme as (typeof order)[number])
    ? (theme as (typeof order)[number])
    : 'system'
  const Icon = !mounted ? Monitor : current === 'dark' ? Moon : current === 'light' ? Sun : Monitor
  const label = current === 'dark' ? '暗色' : current === 'light' ? '亮色' : '跟随系统'

  return (
    <button
      type="button"
      onClick={() => {
        const next = order[(order.indexOf(current) + 1) % order.length]
        setTheme(next)
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        className,
      )}
      aria-label={`切换主题，当前：${label}`}
    >
      <Icon className="size-3.5" />
      <span className="flex-1 text-left">主题外观</span>
      <span className="text-[11px] text-muted-foreground/70">{label}</span>
    </button>
  )
}
