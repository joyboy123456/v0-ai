'use client'

import { useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { WhiteboardImage } from '@/lib/whiteboard/types'
import { assetLibrary, DEMO_POSES } from '@/lib/whiteboard/initial-scene'

const CATEGORIES = ['全部', '服装素材', '姿势参考', '我的素材']

export function AssetDrawer({
  onUpload,
  onAddToCanvas,
}: {
  onUpload: (files: File[]) => void
  onAddToCanvas: (image: WhiteboardImage) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')

  const list = [
    ...assetLibrary.filter((a) => category === '全部' || category === '服装素材' ? a.groupId !== 'uploads' : false),
    ...DEMO_POSES.filter(() => category !== '服装素材'),
  ]

  const filtered = (category === '我的素材' ? [] : list).filter((item) => !query || item.demo?.name?.includes(query) || item.name?.includes(query))

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-card" style={{ width: 280 }}>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Bookmark className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">素材库</h2>
      </div>
      <div className="p-3 pb-0">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材..." aria-label="搜索素材" className="h-8 text-sm" />
        <div className="mt-2 flex flex-wrap gap-1 text-xs">
          {CATEGORIES.map((cat) => (
            <button key={cat} type="button" onClick={() => setCategory(cat)} className={cn('rounded px-2 py-1', category === cat ? 'bg-primary text-primary-foreground' : 'bg-secondary')}>
              {cat}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {(category === '姿势参考' ? DEMO_POSES : category === '服装素材' ? assetLibrary : category === '我的素材' ? [] : [...assetLibrary, ...DEMO_POSES]).map((item, index) => {
          const name = 'demo' in item ? item.demo.name : item.name
          const url = 'demo' in item ? item.demo.url : item.url
          const nw = 'demo' in item ? item.demo.naturalWidth : 900
          const nh = 'demo' in item ? item.demo.naturalHeight : 1200
          return (
            <article key={index} className="mb-3 break-inside-avoid rounded-lg border border-border bg-card">
              <button
                type="button"
                onClick={() => {
                  const id = `${'demo' in item ? 'demo' : 'pose'}-${index}-${Date.now()}`
                  onAddToCanvas({
                    id,
                    url,
                    name,
                    naturalWidth: nw,
                    naturalHeight: nh,
                    x: 80 + index * 24,
                    y: 80,
                    width: 'demo' in item ? 128 : 96,
                    kind: 'ref',
                    groupId: 'reference',
                  })
                }}
                className="block w-full text-left"
                aria-label={`添加 ${name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={name} className="h-32 w-full rounded-t-lg bg-secondary object-contain" />
                <div className="p-3">
                  <p className="text-xs font-medium">{name}</p>
                  <p className="text-[11px] text-muted-foreground">{'demo' in item ? '服装素材' : '姿势参考'}</p>
                </div>
              </button>
            </article>
          )
        })}
      </div>
      <div className="border-t border-border p-3">
        <Button size="sm" onClick={() => inputRef.current?.click()}>
          上传图片
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) onUpload(files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
