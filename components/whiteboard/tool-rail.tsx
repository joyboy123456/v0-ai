'use client'

import { useRef } from 'react'
import { Bookmark, Boxes, ImagePlus, MousePointer2, Move, Sparkles, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WhiteboardImage } from '@/lib/whiteboard/types'

const BASIC: Array<{ id: string; label: string; Icon: typeof Boxes; toggle?: boolean }> = [
  { id: 'select', label: '选择', Icon: MousePointer2 },
  { id: 'pan', label: '平移', Icon: Move },
]

export function ToolRail({
  activeTool,
  onTool,
  onUpload,
  onAssets,
  assetsOpen,
  onToolbox,
  toolboxOpen,
}: {
  activeTool: 'select' | 'pan'
  onTool: (t: 'select' | 'pan') => void
  onUpload: () => void
  onAssets: () => void
  assetsOpen: boolean
  onToolbox: () => void
  toolboxOpen: boolean
}) {
  return (
    <TooltipProvider>
      <aside className="flex w-14 flex-col items-center gap-1 border-r border-border bg-card py-2">
        {BASIC.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={item.label}
                aria-pressed={activeTool === item.id}
                onClick={() => onTool(item.id as 'select' | 'pan')}
                className={cn(
                  'flex size-10 items-center justify-center rounded transition-colors',
                  activeTool === item.id ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary',
                )}
              >
                <item.Icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
        <div className="my-1 h-px w-6 bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="上传" onClick={onUpload} className="flex size-10 items-center justify-center rounded hover:bg-secondary">
              <ImagePlus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">上传图片</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="素材库"
              aria-pressed={assetsOpen}
              onClick={onAssets}
              className={cn(
                'flex size-10 items-center justify-center rounded',
                assetsOpen ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary',
              )}
            >
              <Bookmark className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">素材库</TooltipContent>
        </Tooltip>
        <div className="my-1 h-px w-6 bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="AI 工具箱" onClick={onToolbox} className={cn('flex size-10 items-center justify-center rounded hover:bg-secondary', toolboxOpen && 'bg-primary text-primary-foreground')}>
              <Sparkles className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">AI 工具箱</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="图层" className="flex size-10 items-center justify-center rounded hover:bg-secondary" disabled>
              <Layers className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">图层（即将上线）</TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  )
}
