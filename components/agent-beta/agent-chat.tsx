'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ImagePlus, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentBetaMessage, AgentBetaNode, AgentBetaPlan, AgentBetaPreviewIdentity, AgentBetaSession, AgentBetaSettings } from '@/lib/agent-beta/types'
import { DEFAULT_FASHION_MODEL, FASHION_IMAGE_RATIOS, FASHION_RESOLUTIONS, SELECTABLE_FASHION_MODELS } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NodeImage } from './agent-canvas'
import { AgentActionButton } from './agent-action-button'
import { previewIdentity } from '@/lib/agent-beta/protocol'
import { PlanPreviewCard } from './plan-preview-card'
import { buildPlanCardView, previewExpiryIdentityKey, schedulePreviewExpiry } from './plan-preview-view'
import { ToolTrace } from './tool-trace'
import { visibleToolTrace } from './tool-trace-view'
import { useAgentBetaAccess } from './use-agent-beta-access'

const examples = [
  { title: '做一张模特图', text: '参考这件衣服，生成一张自然光下的电商模特展示图，保持服装款式、颜色和图案。' },
  { title: '换一种场景', text: '以选中的图片为参考，换成干净自然的户外场景，保持人物和服装细节。' },
  { title: '延续这张的风格', text: '延续选中图片的摄影风格，生成一张不同构图的展示图，保持服装一致。' },
]

// Beta 的现有生图接口只有 2K / 4K，排除仅支持 1K 的模型。
const betaModels = SELECTABLE_FASHION_MODELS.filter((model) => model.provider === 'grsai' && Number.parseInt(model.maxResolutionLabel, 10) >= 2)
type PlanAction = 'preview' | 'execute' | 'cancel'

function usePreviewExpiryClock(identity: AgentBetaPreviewIdentity | undefined, expiresAt: string | undefined) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const identityKey = previewExpiryIdentityKey(identity) ?? ''

  useEffect(() => {
    const now = Date.now()
    setNowMs(now)
    const delay = schedulePreviewExpiry(expiresAt, now)
    if (delay === undefined) return
    const timer = window.setTimeout(() => setNowMs(Date.now()), delay)
    return () => window.clearTimeout(timer)
  }, [identityKey, expiresAt])

  return nowMs
}

function PlanCard({ message, nodes, busy, onAction, onRetry, onRefresh }: {
  message: AgentBetaMessage
  nodes: AgentBetaNode[]
  busy: string | null
  onAction: (action: PlanAction, messageId: string, prompt?: string, identity?: AgentBetaPreviewIdentity) => Promise<boolean>
  onRetry: (plan: AgentBetaPlan) => void
  onRefresh?: () => Promise<boolean>
}) {
  const plan = message.plan!
  const [prompt, setPrompt] = useState(plan.prompt)
  const preview = plan.preview
  const identity = previewIdentity(plan)
  const previewKey = preview ? `${preview.proposalId}:${preview.version}:${preview.digest}` : 'legacy'
  const nowMs = usePreviewExpiryClock(identity, preview?.expiresAt)
  const view = buildPlanCardView({ message, nodes, draftPrompt: prompt, busy, nowMs })

  useEffect(() => { setPrompt(plan.prompt) }, [plan.id, plan.prompt, previewKey])

  if (!view) return null

  return (
    <PlanPreviewCard
      view={view}
      nodes={nodes}
      prompt={prompt}
      busy={busy}
      onPromptChange={setPrompt}
      onAction={(action, identity) => {
        if (action === 'cancel') {
          void onAction('cancel', message.id)
          return
        }
        void onAction(action, message.id, prompt.trim(), identity)
      }}
      onRetry={() => onRetry(plan)}
      onRefresh={onRefresh ? () => { void onRefresh() } : undefined}
    />
  )
}

export function AgentChat({ session, selectedIds, onSelect, busy, disabled, onUpload, onSend, onAction, onRefresh }: {
  session: AgentBetaSession | null
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  busy: string | null
  disabled: boolean
  onUpload: () => void
  onSend: (text: string, settings: AgentBetaSettings) => Promise<boolean>
  onAction: (action: PlanAction, messageId: string, prompt?: string, identity?: AgentBetaPreviewIdentity) => Promise<boolean>
  onRefresh?: () => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [settings, setSettings] = useState<AgentBetaSettings>({ model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' })
  const { llmOptions, defaultLlmId } = useAgentBetaAccess()
  const latest = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const nodes = session?.nodes ?? []
  const references = selectedIds.flatMap((id) => nodes.find((node) => node.id === id) ?? [])
  const currentModel = SELECTABLE_FASHION_MODELS.find((model) => model.id === settings.model)
  const maxReferences = Math.min(currentModel?.maxInputImages ?? 10, 10)
  const tooManyReferences = references.length > maxReferences
  const lastMessage = session?.messages.at(-1)

  useEffect(() => {
    const node = latest.current
    if (!node) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }, [session?.messages.length, busy])

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
        <div><h2 className="text-sm font-semibold">服饰创作助手</h2><p className="mt-0.5 text-xs text-secondary-foreground">描述需求 → 确认方案 → 安全核验结果</p></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 [scroll-padding-bottom:6rem]">
        {!session?.messages.length && <div className="px-1 pb-5 pt-4">
          <span className="mb-4 inline-flex rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-secondary-foreground">你的第一位创作搭档</span>
          <h3 className="text-2xl font-semibold leading-tight tracking-tight">让想法，<br /><span className="text-muted-foreground">从这里变成图片。</span></h3>
          <p className="mt-4 text-sm leading-6 text-secondary-foreground">上传素材或选中画布图片，告诉助手你的想法。它会先整理生成要求，等你确认后再执行。</p>
          <div className="mt-5 space-y-2">
            {examples.map((example) => <button key={example.title} type="button" disabled={disabled} onClick={() => { setText(example.text); input.current?.focus() }} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border bg-card px-3.5 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-secondary disabled:opacity-50 max-md:opacity-100">
              <span>{example.title}</span><ArrowUp className="size-3 rotate-45 text-secondary-foreground" />
            </button>)}
          </div>
        </div>}
        <div className="space-y-6">
          {session?.messages.map((item) => {
            const traces = !item.plan ? visibleToolTrace(item) : []
            return (
              <div
                key={item.id}
                ref={item.id === lastMessage?.id ? latest : undefined}
                className={cn('scroll-mt-3 text-sm', item.role === 'user' && 'ml-6')}
              >
                {item.role === 'assistant' && <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-secondary-foreground"><Sparkles className="size-3" />创作助手</p>}
                <div className={cn('whitespace-pre-wrap break-words text-sm leading-6', item.role === 'user' && 'rounded-2xl rounded-tr-sm bg-secondary px-3.5 py-3')}>{item.content}</div>
                {item.role === 'user' && item.referenceNodeIds.length > 0 && <p className="mt-1.5 text-right text-xs text-secondary-foreground">使用 {item.referenceNodeIds.length} 张参考图</p>}
                {item.role === 'assistant' && !item.plan && traces.length > 0 && <ToolTrace className="mt-3" entries={traces} />}
                {item.plan && <PlanCard message={item} nodes={nodes} busy={busy} onAction={onAction} onRetry={retry} onRefresh={onRefresh} />}
              </div>
            )
          })}
        </div>
        {busy && <p role="status" aria-live="polite" className="mt-5 flex items-center gap-2 text-sm text-foreground"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />{busy}…</p>}
        <div className="h-24 shrink-0" aria-hidden="true" />
      </div>
      <div className="shrink-0 border-t border-border bg-card px-4 pb-4 pt-3">
        {!!references.length && <div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="已选参考图">
          {references.map((node, index) => <div key={node.id} className="flex max-w-full items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 pr-1 text-xs">
            <NodeImage node={node} className="size-7 rounded-l-lg object-cover" /><span className="max-w-24 truncate">{index + 1}. {node.name}</span><button type="button" onClick={() => onSelect(selectedIds.filter((id) => id !== node.id))} className="rounded p-1 text-secondary-foreground hover:bg-secondary max-md:opacity-100" aria-label={`移除参考图 ${node.name}`}><X className="size-3" /></button>
          </div>)}
        </div>}
        <div className="rounded-xl border border-border bg-background p-2.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/5">
          <Textarea ref={input} aria-label="告诉助手你的创作需求" value={text} onChange={(event) => setText(event.target.value)} disabled={disabled} maxLength={4000}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }}
            placeholder={references.length ? '想怎样使用这些参考图？' : '描述你想要的服饰图片…'} rows={3} className="min-h-20 resize-none border-0 p-0 text-sm leading-6 shadow-none focus-visible:ring-0" />
          <div className="mt-2 flex items-center justify-between">
            <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={onUpload} aria-label="上传参考图"><ImagePlus className="size-4" /></Button>
            <AgentActionButton size="sm" onClick={() => void send()} disabled={disabled || !text.trim() || tooManyReferences}>{busy === '正在准备方案' ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-3.5" />}准备方案</AgentActionButton>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_66px_64px] gap-1.5">
          <select aria-label="生成模型" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value as AgentBetaSettings['model'] })} disabled={disabled} className="min-h-11 min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
            {betaModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
          <select aria-label="图片比例" value={settings.imageRatio} onChange={(event) => setSettings({ ...settings, imageRatio: event.target.value as AgentBetaSettings['imageRatio'] })} disabled={disabled} className="min-h-11 rounded-md border border-border bg-background px-1 py-1.5 text-xs text-foreground">
            {FASHION_IMAGE_RATIOS.filter((ratio) => ratio.id !== 'more').map((ratio) => <option key={ratio.id} value={ratio.id}>{ratio.label}</option>)}
          </select>
          <select aria-label="图片分辨率" value={settings.resolution} onChange={(event) => setSettings({ ...settings, resolution: event.target.value as AgentBetaSettings['resolution'] })} disabled={disabled} className="min-h-11 rounded-md border border-border bg-background px-1 py-1.5 text-xs text-foreground">
            {FASHION_RESOLUTIONS.map((resolution) => <option key={resolution.id} value={resolution.id}>{resolution.label.toUpperCase()}</option>)}
          </select>
        </div>
        {llmOptions.length ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="shrink-0 text-xs text-secondary-foreground">规划模型</span>
            <select aria-label="规划模型" value={settings.plannerLlm || defaultLlmId || ''} onChange={(event) => setSettings({ ...settings, plannerLlm: event.target.value })} disabled={disabled} className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
              {llmOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
        ) : null}
        <p className={cn('mt-2 text-xs leading-5', tooManyReferences ? 'text-destructive' : 'text-secondary-foreground')}>{tooManyReferences ? `当前模型最多使用 ${maxReferences} 张参考图，请取消部分选择。` : 'Beta 每次生成 1 张 · 准备方案不会自动开始生图'}</p>
      </div>
    </section>
  )
}
