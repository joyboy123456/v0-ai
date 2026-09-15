'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, LayoutDashboard, Loader2, MessageSquare, Plus, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { useAuth } from '@/hooks/use-auth'
import type { AgentBetaNode } from '@/lib/agent-beta/types'
import { cn } from '@/lib/utils'
import { AgentCanvas, NodeImage } from './agent-canvas'
import { AgentChat } from './agent-chat'
import { useAgentBeta } from './use-agent-beta'
import { AgentActionButton } from './agent-action-button'

export function AgentBetaWorkbench() {
  const { user, isLoading: authLoading, error: authError, refresh } = useAuth()
  const state = useAgentBeta(user?.id)
  const fileInput = useRef<HTMLInputElement>(null)
  const [mobileTab, setMobileTab] = useState<'chat' | 'canvas'>('chat')
  const [preview, setPreview] = useState<AgentBetaNode | null>(null)
  const disabled = !!state.busy || state.loading || authLoading || !user

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', preventFileNavigation)
    window.addEventListener('drop', preventFileNavigation)
    return () => { window.removeEventListener('dragover', preventFileNavigation); window.removeEventListener('drop', preventFileNavigation) }
  }, [])

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-4 md:px-6">
        <Button variant="ghost" size="icon-sm" asChild><Link href="/" aria-label="返回原工作台"><ArrowLeft className="size-4" /></Link></Button>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <div className="flex items-center gap-2"><Sparkles className="hidden size-4 text-primary sm:block" /><h1 className="whitespace-nowrap text-sm font-semibold tracking-tight">Agent<span className="hidden sm:inline"> 画布</span></h1><span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">Beta</span></div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <select aria-label="历史会话" value={state.session?.id ?? ''} onChange={(event) => { if (event.target.value) void state.switchSession(event.target.value) }} disabled={disabled} className="h-8 max-w-20 truncate rounded-md border border-border bg-background px-2 text-xs sm:max-w-28 md:max-w-48">
            {!state.session && <option value="">{state.loading ? '加载会话…' : '新的创作'}</option>}
            {state.sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
          </select>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void state.newSession()} aria-label="新建会话"><Plus className="size-3.5" /><span className="hidden sm:inline">新建</span></Button>
          <div className="w-8 lg:w-36"><ThemeToggle className="justify-center max-lg:px-1 max-lg:[&>span]:hidden" /></div>
        </div>
      </header>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-secondary/40 px-5 py-2 text-[10px] text-muted-foreground">
        <span>本地试用 · 先从服饰生图开始</span><Link href="/" className="flex items-center gap-1 hover:text-foreground">原工作台<ArrowLeft className="size-3 rotate-180" /></Link>
      </div>
      {(state.error || authError) && <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-xs text-destructive"><p className="flex-1 break-words leading-5">{state.error ?? authError}</p>{authError && <Button variant="ghost" size="sm" onClick={() => void refresh()}>重试登录</Button>}<Button variant="ghost" size="icon-sm" onClick={() => state.setError(null)} aria-label="关闭错误提示"><X className="size-3.5" /></Button></div>}
      {!authLoading && !user && !authError ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><p className="text-sm text-muted-foreground">请先登录后使用 Agent Beta。</p><AgentActionButton asChild><Link href="/login">前往登录</Link></AgentActionButton></div> : <>
        <div className="flex shrink-0 border-b border-border bg-card p-1.5 md:hidden">
          <Button variant={mobileTab === 'chat' ? 'secondary' : 'ghost'} size="sm" className="flex-1" onClick={() => setMobileTab('chat')}><MessageSquare className="size-3.5" />对话</Button>
          <Button variant={mobileTab === 'canvas' ? 'secondary' : 'ghost'} size="sm" className="flex-1" onClick={() => setMobileTab('canvas')}><LayoutDashboard className="size-3.5" />画布 {state.session?.nodes.length ? `· ${state.session.nodes.length}` : ''}</Button>
        </div>
        <div className="relative flex min-h-0 flex-1">
          <div className={cn('min-h-0 w-full shrink-0 border-border md:block md:w-[370px] md:border-r xl:w-[410px]', mobileTab !== 'chat' && 'hidden')}>
            <AgentChat key={state.session?.id ?? 'new'} session={state.session} selectedIds={state.selectedIds} onSelect={state.setSelectedIds} busy={state.busy} disabled={disabled} onUpload={() => fileInput.current?.click()} onSend={state.sendMessage} onAction={state.planAction} />
          </div>
          <div className={cn('min-h-0 min-w-0 flex-1 md:block', mobileTab !== 'canvas' && 'hidden')}>
            <AgentCanvas key={state.session?.id ?? 'new'} nodes={state.session?.nodes ?? []} selectedIds={state.selectedIds} onSelect={state.setSelectedIds} onMove={state.moveNodes} disabled={disabled} onUpload={() => fileInput.current?.click()} onPreview={setPreview} />
          </div>
          {(state.loading || authLoading) && <div role="status" className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground backdrop-blur-sm"><Loader2 className="size-4 animate-spin" />正在加载创作空间…</div>}
        </div>
      </>}
      <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" aria-label="选择参考图片" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void state.upload(files) }} />
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent className="max-h-[90dvh] sm:max-w-4xl">
          <DialogTitle className="truncate pr-7 text-sm">{preview?.name ?? '图片预览'}</DialogTitle>
          <DialogDescription className="sr-only">查看完整图片并下载生成结果。</DialogDescription>
          {preview && <><div className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-secondary"><NodeImage node={preview} className="max-h-[65dvh] max-w-full object-contain" /></div><Button variant="secondary" asChild><a href={preview.url} download={preview.name} target="_blank" rel="noreferrer"><Download className="size-4" />下载图片</a></Button></>}
        </DialogContent>
      </Dialog>
    </main>
  )
}
