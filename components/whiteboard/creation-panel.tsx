'use client'

import { useRef, useState } from 'react'
import { Check, ChevronDown, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ImageRole, ReferenceItem, TaskResult, WhiteboardImage } from '@/lib/whiteboard/types'
import { roleLabel } from '@/lib/whiteboard/tool-registry'

import { toolDefinitions, toolById, roleLabel } from '@/lib/whiteboard/tool-registry'
import { cn } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function CreationPanel({
  tools = toolDefinitions,
  activeToolId,
  references,
  prompt,
  onPromptChange,
  onSubmit,
  disabled,
  activeTasks,
  onRemoveReference,
  onRoleChange,
  onOpenToolbox,
  onOpenToolSettings,
}: {
  tools?: typeof toolDefinitions
  activeToolId: string | null
  references: ReferenceItem[]
  prompt: string
  onPromptChange: (v: string) => void
  onSubmit: () => void
  disabled: boolean
  activeTasks: TaskResult[]
  onRemoveReference: (id: string) => void
  onRoleChange: (id: string, role: ReferenceItem['role']) => void
  onOpenToolbox: () => void
  onOpenToolSettings: (toolId: string) => void
}) {
  const tool = toolById(activeToolId ?? 'generate-set')
  const text = prompt.trim() || '基于这张图做一组商品详情页套图，保留人物和服装，补充不同角度和细节。'
  const shotList = activeToolId === 'generate-set' ? ['正面全身', '侧面全身', '背面全身', '面料细节'] : activeToolId === 'switch-pose' ? ['正面', '侧面'] : [tool.name]
  const count = shotList.length
  const [expanded, setExpanded] = useState(false)
  const inputId = useRef(`prompt-${Math.random().toString(36).slice(2, 8)}`).current

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-card">
      <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-card px-1.5 py-1">
        <Tabs value="creation" className="w-full">
          <TabsContent value="creation" className="m-0 flex-1" aria-label="创作面板" />
        </Tabs>
        <Button variant="ghost" size="sm" className="w-full justify-start px-2 text-sm" onClick={onOpenToolbox}>
          <Settings2 className="size-4" />
          AI 工具箱
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">工具</h3>
          <div className="mt-1 rounded border border-border bg-card" onClick={() => onOpenToolSettings(tool.id)}>
            <div className="flex items-center justify-between p-2 text-sm">
              <span className="truncate">{tool.name}</span>
              <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
            </div>
            {expanded && (
              <div className="max-h-40 overflow-y-auto">
                {tools.filter((t) => t.id !== tool.id).map((t) => (
                  <button key={t.id} type="button" onClick={() => { onOpenToolSettings(t.id); setExpanded(false) }} className="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-secondary">
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setExpanded(!expanded)} className="mt-1 block text-left text-xs text-muted-foreground">
            {expanded ? '收起工具' : '收起执业'}
          </button>
        </div>
        <div className="mb-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">引用素材</h3>
          {references.length === 0 ? (
            <div className="rounded border border-dashed border-border bg-card p-3 text-center text-sm text-muted-foreground">
              在画布中选中图片后点击“用作参考”
            </div>
          ) : (
            <div className="space-y-2">
              {references.map((ref) => (
                <div key={ref.id} className="flex items-center gap-2 rounded border border-border bg-card p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.url} alt={ref.name} className="size-10 shrink-0 rounded bg-secondary object-contain" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{ref.name}</p>
                    <p className="text-[11px] text-muted-foreground">{roleLabel(ref.role)}</p>
                  </div>
                  <button type="button" onClick={() => onRemoveReference(ref.id)} className="rounded p-1 hover:bg-secondary" aria-label="移除引用">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mb-3">
          <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            创作需求
          </label>
          <Textarea
            id={inputId}
            value={text}
            onChange={(e) => {
              onPromptChange(e.target.value)
            }}
            placeholder="描述要求..."
            className="mt-2 h-24 resize-none text-sm"
          />
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <label htmlFor={`${inputId}-model`} className="text-[11px] text-muted-foreground">模型</label>
            <Select defaultValue="Gemini 3" aria-label="模型">
              <SelectTrigger id={`${inputId}-model`} className="h-8 text-sm">
                <SelectValue placeholder="模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Gemini 3">Gemini 3</SelectItem>
                <SelectItem value="GLM 4.5">GLM 4.5</SelectItem>
                <SelectItem value="Claude 3.7">Claude 3.7</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${inputId}-ratio`} className="text-[11px] text-muted-foreground">比例</label>
            <Select defaultValue="7:9" aria-label="比例">
              <SelectTrigger id={`${inputId}-ratio`} className="h-8 text-sm">
                <SelectValue placeholder="比例" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1:1">1:1</SelectItem>
                <SelectItem value="7:9">7:9</SelectItem>
                <SelectItem value="3:4">3:4</SelectItem>
                <SelectItem value="9:16">9:16</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={onSubmit} disabled={disabled} className="w-full gap-1.5" aria-label={`生成 ${count} 张`}>
          <Check className="size-4" />
          生成 {count} 张
        </Button>
      </div>
      <div className="mt-auto border-t border-border">
        <button
          type="button"
          className="flex w-full items-center justify-between bg-card p-3 text-xs"
          onClick={() => {
            /* task toggle */
          }}
          aria-label="查看任务"
        >
          <span className="font-medium">任务</span>
          <span className="text-muted-foreground">{activeTasks.length !== 1 ? `${activeTasks.length} 个任务` : '1 个任务生成中'}</span>
          <ChevronDown className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function TaskPanel({
  tasks,
  onCancel,
  onRetryImage,
  onViewGroup,
}: {
  tasks: TaskResult[]
  onCancel: (id: string) => void
  onRetryImage: (taskId: string, imageIndex: number) => void
  onViewGroup: (imageIndex: number) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      {tasks.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">暂无任务</div>
      ) : (
        tasks.map((task) => (
          <article key={task.id} className="mb-3 rounded border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{task.tool}</p>
                <p className="text-[11px] text-muted-foreground">
                  {task.status === 'completed' ? '已完成' : task.status === 'cancelled' ? '已取消' : `已 ${task.images.filter((x) => x.status === 'ok').length}/${task.images.length} 张`}
                  {task.status === 'partial-failed' ? `（${task.images.filter((x) => x.status === 'failed').length} 张失败）` : ''}
                </p>
              </div>
              {task.status !== 'cancelled' && task.status !== 'completed' && task.status !== 'partial-failed' && task.status !== 'failed' && task.status !== 'submitting' && task.status !== 'queued' && task.status !== 'running' && (
                <button type="button" onClick={() => onCancel(task.id)} className="rounded p-1 hover:bg-secondary" aria-label="取消任务">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {task.images.map((img, index) => (
                <div key={img.id}>
                  {img.status === 'pending' ? (
                    <div className="h-20 rounded bg-secondary" aria-label={`占位 ${img.label}`} />
                  ) : img.status === 'failed' ? (
                    <div className="flex h-20 flex-col items-center justify-center rounded border border-destructive/50 bg-destructive/10">
                      <p className="text-[11px] text-destructive">失败</p>
                      <button type="button" onClick={() => onRetryImage(task.id, index)} className="text-[11px] text-primary">
                        重试这张
                      </button>
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={img.url ?? ''} alt={img.label} className="h-20 w-full rounded bg-secondary object-contain" />
                  )}
                </div>
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  )
}
