'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import type { WhiteboardImage } from '@/lib/whiteboard/types'

export function ExportDialog({
  open,
  onOpenChange,
  images,
  selectedIds,
  onExport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  images: WhiteboardImage[]
  selectedIds: string[]
  onExport: (item: WhiteboardImage, format: 'original' | 'png' | 'jpeg') => void
}) {
  const [format, setFormat] = useState<'original' | 'png' | 'jpeg'>('original')
  const [naming, setNaming] = useState('image')
  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const targets = scope === 'selected' ? images.filter((image) => selectedIds.includes(image.id)) : images
  const count = targets.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4">
        <DialogTitle className="text-base">导出</DialogTitle>
        <DialogDescription className="sr-only">选择导出范围、格式和命名。</DialogDescription>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-16 text-muted-foreground">范围</label>
            <Select value={scope} onValueChange={(v: 'selected' | 'all') => setScope(v)} aria-label="范围">
              <SelectTrigger className="h-9 w-36">
                <SelectValue placeholder="选中图片" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selected">选中图片</SelectItem>
                <SelectItem value="all">全部图片</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm">{count} 张</span>
          </div>
          <div>
            <label htmlFor="export-format" className="mb-1 text-muted-foreground">格式</label>
            <Select value={format} onValueChange={(v: any) => setFormat(v)} aria-label="格式">
              <SelectTrigger id="export-format" className="h-9">
                <SelectValue placeholder="原始格式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">原始格式（标注演示）</SelectItem>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="jpeg">JPEG</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="export-name" className="mb-1 text-muted-foreground">命名</label>
            <Input id="export-name" value={naming} onChange={(e) => setNaming(e.target.value)} className="h-9" aria-label="命名" />
          </div>
          <Button
            onClick={() => {
              targets.forEach((image) => onExport(image, format))
              onOpenChange(false)
            }}
            className="w-full"
          >
            开始导出 {count} 张
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
