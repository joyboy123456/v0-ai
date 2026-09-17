'use client'

import {
  Copy, Download, Edit3, FolderPlus, MoreHorizontal, AlignHorizontal, AlignHorizontalDistribute, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export function SelectionToolbar({
  multi,
  onReference,
  onGenerateSet,
  onPose,
  onEdit,
  onDownload,
  onCopy,
  onDelete,
  onAlign,
  onDistribute,
  onGroup,
}: {
  multi: boolean
  onReference: () => void
  onGenerateSet: () => void
  onPose: () => void
  onEdit: () => void
  onDownload: () => void
  onCopy: () => void
  onDelete: () => void
  onAlign: (mode: 'left' | 'top' | 'middle' | 'center') => void
  onDistribute: () => void
  onGroup: () => void
}) {
  if (multi) {
    return (
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1.5 shadow-md backdrop-blur">
        <Button size="sm" onClick={onReference}>引用所选</Button>
        <span className="h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={() => onAlign('left')} aria-label="左对齐">
          <AlignHorizontal className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDistribute} aria-label="等距分布">
          <AlignHorizontalDistribute className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onGroup}>分组</Button>
        <Button size="sm" variant="ghost" onClick={onDownload}>批量导出</Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1.5 shadow-md backdrop-blur">
      <Button size="sm" onClick={onReference}>用作参考</Button>
      <Button size="sm" onClick={onGenerateSet}>生成套图</Button>
      <Button size="sm" onClick={onPose}>换姿势</Button>
      <Button size="sm" onClick={onEdit}>编辑</Button>
      <Button size="sm" onClick={onDownload} aria-label="下载">
        <Download className="size-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label="更多">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onCopy}><Copy className="size-4" />复制</DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-destructive"><Trash2 className="size-4" />删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
