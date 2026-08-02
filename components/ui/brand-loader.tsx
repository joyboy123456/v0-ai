'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

/**
 * BrandLoader — 页面级加载屏（工作台守卫 / 登录注册 fallback）。
 *
 * 构成：品牌图标 + 旋转弧线环 + 呼吸光晕，文案交叉淡入，三点加载指示。
 * 浅色冰蓝体系，动效克制；children 插槽用于放置「重试 / 去登录」等操作。
 */
function BrandLoader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center text-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        {/* 呼吸光晕 */}
        <div
          aria-hidden="true"
          className="animate-breathe absolute inset-1 rounded-2xl bg-brand-light/25 blur-md"
        />
        {/* 品牌图标底卡 */}
        <div className="absolute inset-0 rounded-2xl border border-border bg-white shadow-soft" />
        <Sparkles className="relative h-6 w-6 text-primary" />
        {/* 旋转弧线环 */}
        <svg
          aria-hidden="true"
          viewBox="0 0 88 88"
          fill="none"
          className="loader-arc absolute -inset-3 h-[88px] w-[88px]"
        >
          <circle
            cx="44"
            cy="44"
            r="40"
            stroke="var(--color-brand-soft)"
            strokeWidth="3"
          />
          <circle
            cx="44"
            cy="44"
            r="40"
            stroke="var(--color-brand-primary)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="72 180"
          />
        </svg>
      </div>

      {/* 文案交叉淡入（标题随状态切换） */}
      <div className="mt-6 flex min-h-[52px] flex-col items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="text-sm font-medium text-foreground"
          >
            {title}
          </motion.p>
        </AnimatePresence>
        {description ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {/* 三点加载指示 */}
      <div aria-hidden="true" className="mt-1 flex items-center gap-1.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="loading-dot h-1.5 w-1.5 rounded-full bg-brand-light"
            style={{ animationDelay: `${index * 0.15}s` }}
          />
        ))}
      </div>

      {children ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5"
        >
          {children}
        </motion.div>
      ) : null}
    </div>
  )
}

export { BrandLoader }
