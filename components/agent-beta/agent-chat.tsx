'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, CircleStop, ImagePlus, Loader2, RefreshCw, Sparkles, WandSparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentBetaMessage, AgentBetaNode, AgentBetaPlan, AgentBetaSession, AgentBetaSettings } from '@/lib/agent-beta/types'
import { DEFAULT_FASHION_MODEL, FASHION_IMAGE_RATIOS, FASHION_RESOLUTIONS, SELECTABLE_FASHION_MODELS } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NodeImage } from './agent-canvas'
import { AgentActionButton } from './agent-action-button'

const examples = [
  { title: '做一张模特图', text: '参考这件衣服，生成一张自然光下的电商模特展示图，保持服装款式、颜色和图案。' },
  { title: '换一种场景', text: '以选中的图片为参考，换成干净自然的户外场景，保持人物和服装细节。' },
  { title: '延续这张的风格', text: '延续选中图片的摄影风格，生成一张不同构图的展示图，保持服装一致。' },
]

// Beta 的现有生图接口只有 2K / 4K，排除仅支持 1K 的模型。
const betaModels = SELECTABLE_FASHION_MODELS.filter((model) => Number.parseInt(model.maxResolutionLabel, 10) >= 2)

function PlanCard({ message, nodes, busy, onAction, onRetry }: {
  message: AgentBetaMessage
  nodes: AgentBetaNode[]
  busy: string | null
  onAction: (action: 'execute' | 'cancel', messageId: string, prompt?: string) => Promise<boolean>
  onRetry: (plan: AgentBetaPlan) => void
}) {
  const plan = message.plan!
  const [prompt, setPrompt] = useState(plan.prompt)
  const task = plan.task
  const running = task?.status === 'pending' || task?.status === 'running'
  const done = task?.status === 'success' || task?.status === 'partial'
  const failed = task?.status === 'failed' || task?.status === 'cancelled'
  const model = SELECTABLE_FASHION_MODELS.find((item) => item.id === plan.settings.model)
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
        <span className="flex items-center gap-2 text-xs font-semibold"><WandSparkles className="size-3.5 text-primary" />服饰生图方案</span>
        <span className="text-[10px] text-muted-foreground">{plan.status === 'proposed' ? '待你确认' : done ? '已完成' : failed ? '已结束' : '已提交'}</span>
      </div>
      <div className="space-y-3 p-3.5">
        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {[model?.label ?? plan.settings.model, plan.settings.imageRatio, plan.settings.resolution.toUpperCase(), '1 张'].map((label) => <span key={label} className="rounded-md bg-secondary px-2 py-1">{label}</span>)}
        </div>
        {!!plan.referenceNodeIds.length && <div className="flex flex-wrap gap-1.5" aria-label="方案参考图">
          {plan.referenceNodeIds.map((id, index) => {
            const node = nodes.find((item) => item.id === id)
            return node ? <div key={id} className="flex max-w-full items-center gap-1.5 rounded-md border border-border pr-2 text-[10px] text-muted-foreground"><NodeImage node={node} className="size-7 rounded-l object-cover" /><span className="truncate">图 {index + 1} · {node.name}</span></div> : null
          })}
        </div>}
        {plan.status === 'proposed' ? <>
          <label className="block text-[11px] font-medium" htmlFor={`prompt-${plan.id}`}>生成要求 · 可直接修改</label>
          <Textarea id={`prompt-${plan.id}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={8000} rows={5} disabled={!!busy} className="min-h-28 resize-y bg-background text-xs leading-6" />
          <p className="text-[11px] leading-5 text-muted-foreground">确认后生成 1 张，将产生所选模型的生成费用。调整模型、比例或分辨率，请在下方重新准备方案。</p>
          <AgentActionButton className="w-full" disabled={!!busy || !prompt.trim()} onClick={() => void onAction('execute', message.id, prompt.trim())}>
            {busy === '正在提交生成' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}确认生成 1 张
          </AgentActionButton>
        </> : <>
          <p className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{plan.prompt}</p>
          {task && <div className="rounded-lg bg-secondary/70 p-3" role="status">
            <div className="flex items-center gap-2 text-xs font-medium">
              {running ? <Loader2 className="size-3.5 animate-spin text-primary" /> : done ? <Check className="size-3.5 text-primary" /> : <CircleStop className="size-3.5 text-muted-foreground" />}
              <span>{running ? '图片生成中' : done ? '图片已加入画布' : task.status === 'cancelled' ? '任务已取消' : '生成未完成'}</span>
              {running && <span className="ml-auto text-[10px] tabular-nums">{Math.round(Math.max(0, Math.min(100, task.progress)))}%</span>}
            </div>
            <p className="mt-2 break-words text-[11px] leading-5 text-muted-foreground">{task.message}</p>
            {running && <div className="mt-3 h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="生成进度" aria-valuenow={Math.round(Math.max(0, Math.min(100, task.progress)))} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} /></div>}
          </div>}
          {running && <Button variant="outline" size="sm" className="w-full" disabled={!!busy} onClick={() => void onAction('cancel', message.id)}><CircleStop className="size-3.5" />取消任务</Button>}
          {failed && <Button variant="outline" size="sm" className="w-full" disabled={!!busy} onClick={() => onRetry(plan)}><RefreshCw className="size-3.5" />调整要求并重新准备</Button>}
        </>}
      </div>
    </div>
  )
}

export function AgentChat({ session, selectedIds, onSelect, busy, disabled, onUpload, onSend, onAction }: {
  session: AgentBetaSession | null
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  busy: string | null
  disabled: boolean
  onUpload: () => void
  onSend: (text: string, settings: AgentBetaSettings) => Promise<boolean>
  onAction: (action: 'execute' | 'cancel', messageId: string, prompt?: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [settings, setSettings] = useState<AgentBetaSettings>({ model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' })
  const bottom = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const nodes = session?.nodes ?? []
  const references = selectedIds.flatMap((id) => nodes.find((node) => node.id === id) ?? [])
  const currentModel = SELECTABLE_FASHION_MODELS.find((model) => model.id === settings.model)
  const maxReferences = Math.min(currentModel?.maxInputImages ?? 10, 10)
  const tooManyReferences = references.length > maxReferences

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [session?.messages.length, busy])

  const send = async () => {
    if (!text.trim() || disabled || tooManyReferences) return
    const submitted = text
    if (await onSend(text.trim(), settings)) setText((current) => current === submitted ? '' : current)
  }

  const retry = (plan: AgentBetaPlan) => {
    const planIndex = session?.messages.findIndex((message) => message.plan?.id === plan.id) ?? -1
    const originalRequest = session?.messages.slice(0, planIndex).reverse().find((message) => message.role === 'user')
    setText(originalRequest?.content ?? plan.prompt)
    setSettings(plan.settings)
    onSelect(plan.referenceNodeIds.filter((id) => nodes.some((node) => node.id === id)))
    input.current?.focus()
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Agent 对话">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles className="size-4" /></div>
        <div><h2 className="text-sm font-semibold">服饰创作助手</h2><p className="mt-0.5 text-[11px] text-muted-foreground">描述需求 → 确认方案 → 图片进入画布</p></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        {!session?.messages.length && <div className="px-1 pb-5 pt-4">
          <span className="mb-4 inline-flex rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground">你的第一位创作搭档</span>
          <h3 className="text-2xl font-semibold leading-tight tracking-tight">让想法，<br /><span className="text-muted-foreground">从这里变成图片。</span></h3>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">上传素材或选中画布图片，告诉助手你的想法。它会先整理生成要求，等你确认后再执行。</p>
          <div className="mt-5 space-y-2">
            {examples.map((example) => <button key={example.title} type="button" disabled={disabled} onClick={() => { setText(example.text); input.current?.focus() }} className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3.5 py-3 text-left text-xs transition-colors hover:border-primary/40 hover:bg-secondary disabled:opacity-50">
              <span>{example.title}</span><ArrowUp className="size-3 rotate-45 text-muted-foreground" />
            </button>)}
          </div>
        </div>}
        <div className="space-y-6">
          {session?.messages.map((message) => <div key={message.id} className={cn('text-sm', message.role === 'user' && 'ml-6')}>
            {message.role === 'assistant' && <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"><Sparkles className="size-3" />创作助手</p>}
            <div className={cn('whitespace-pre-wrap break-words text-xs leading-6', message.role === 'user' && 'rounded-2xl rounded-tr-sm bg-secondary px-3.5 py-3')}>{message.content}</div>
            {message.role === 'user' && message.referenceNodeIds.length > 0 && <p className="mt-1.5 text-right text-[10px] text-muted-foreground">使用 {message.referenceNodeIds.length} 张参考图</p>}
            {message.plan && <PlanCard key={message.plan.id} message={message} nodes={nodes} busy={busy} onAction={onAction} onRetry={retry} />}
          </div>)}
        </div>
        {busy && <p role="status" className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{busy}…</p>}
        <div ref={bottom} />
      </div>
      <div className="shrink-0 border-t border-border bg-card px-4 pb-4 pt-3">
        {!!references.length && <div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="已选参考图">
          {references.map((node, index) => <div key={node.id} className="flex max-w-full items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 pr-1 text-[10px]">
            <NodeImage node={node} className="size-7 rounded-l-lg object-cover" /><span className="max-w-24 truncate">{index + 1}. {node.name}</span><button type="button" onClick={() => onSelect(selectedIds.filter((id) => id !== node.id))} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label={`移除参考图 ${node.name}`}><X className="size-3" /></button>
          </div>)}
        </div>}
        <div className="rounded-xl border border-border bg-background p-2.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/5">
          <Textarea ref={input} aria-label="告诉助手你的创作需求" value={text} onChange={(event) => setText(event.target.value)} disabled={disabled} maxLength={4000}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }}
            placeholder={references.length ? '想怎样使用这些参考图？' : '描述你想要的服饰图片…'} rows={3} className="min-h-20 resize-none border-0 p-0 text-xs leading-6 shadow-none focus-visible:ring-0" />
          <div className="mt-2 flex items-center justify-between">
            <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={onUpload} aria-label="上传参考图"><ImagePlus className="size-4" /></Button>
            <AgentActionButton size="sm" onClick={() => void send()} disabled={disabled || !text.trim() || tooManyReferences}>{busy === '正在准备方案' ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}准备方案</AgentActionButton>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_66px_64px] gap-1.5">
          <select aria-label="生成模型" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value as AgentBetaSettings['model'] })} disabled={disabled} className="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-[10px] text-muted-foreground">
            {betaModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
          <select aria-label="图片比例" value={settings.imageRatio} onChange={(event) => setSettings({ ...settings, imageRatio: event.target.value as AgentBetaSettings['imageRatio'] })} disabled={disabled} className="rounded-md border border-border bg-background px-1 py-1.5 text-[10px] text-muted-foreground">
            {FASHION_IMAGE_RATIOS.filter((ratio) => ratio.id !== 'more').map((ratio) => <option key={ratio.id} value={ratio.id}>{ratio.label}</option>)}
          </select>
          <select aria-label="图片分辨率" value={settings.resolution} onChange={(event) => setSettings({ ...settings, resolution: event.target.value as AgentBetaSettings['resolution'] })} disabled={disabled} className="rounded-md border border-border bg-background px-1 py-1.5 text-[10px] text-muted-foreground">
            {FASHION_RESOLUTIONS.map((resolution) => <option key={resolution.id} value={resolution.id}>{resolution.label.toUpperCase()}</option>)}
          </select>
        </div>
        <p className={cn('mt-2 text-[10px] leading-4', tooManyReferences ? 'text-destructive' : 'text-muted-foreground')}>{tooManyReferences ? `当前模型最多使用 ${maxReferences} 张参考图，请取消部分选择。` : 'Beta 每次生成 1 张 · 准备方案不会自动开始生图'}</p>
      </div>
    </section>
  )
}
