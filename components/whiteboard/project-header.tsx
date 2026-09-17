'use client'

import Link from 'next/link'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Cloudy, Download, Layers, Move, PanelRightClose, PanelRightOpen, Redo2, Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const projectName = '秋季上新 · 奶油色针织套装'

export function ProjectHeader({
  savedAt,
  panelOpen,
  onTogglePanel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onExport,
}: {
  savedAt: number | null
  panelOpen: boolean
  onTogglePanel: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onExport: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
      <Button asChild variant="ghost" size="icon" className="size-9" aria-label="返回工作台">
        <Link href="/">
          <ChevronLeft className="size-4" />
        </Link>
      </Button>
      <Button variant="ghost" size="icon" className="hidden size-9 sm:flex" asChild>
        <Link href="/" aria-label="项目列表">
          <ArrowLeft className="size-4" />
        </Link>
      </Button>
      <h1 className="truncate max-w-64 text-sm font-medium" title={projectName}>{projectName}</h1>
      <span className="hidden rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary lg:inline">
        {savedAt ? '已保存到本机' : '尚未保存'}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-9" onClick={onUndo} disabled={!canUndo} aria-label="撤销">
          <Undo2 className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-9" onClick={onRedo} disabled={!canRedo} aria-label="重做">
          <Redo2 className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onExport} className="gap-1.5" aria-label="导出">
          <Download className="size-4" />
          <span className="hidden sm:inline">导出</span>
        </Button>
        <Button variant="ghost" size="icon" className="size-9" onClick={onTogglePanel} aria-pressed={panelOpen} aria-label="右侧面板开关">
          {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </Button>
        <div className="ml-1 size-9 rounded-full bg-secondary text-center leading-9 text-xs font-semibold">U</div>
      </div>
    </header>
  )
}
