'use client'

import { Check, CircleStop, Loader2, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { AgentActionButton } from '@/components/agent-beta/agent-action-button'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AgentBetaNode, AgentBetaPreviewIdentity } from '@/lib/agent-beta/types'
import { SELECTABLE_FASHION_MODELS } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NodeImage } from './agent-canvas'
import type { PlanCardView, PlanWorkflowStage } from './plan-preview-view'
import { ToolTrace } from './tool-trace'

type PlanAction = 'preview' | 'execute' | 'cancel'

const statusTone: Record<PlanCardView['statusKind'], string> = {
  legacy_proposed: 'bg-secondary text-foreground',
  confirm_ready: 'bg-primary/10 text-foreground',
  needs_repreview: 'bg-accent text-foreground',
  blocked: 'bg-destructive/10 text-destructive',
  expired: 'bg-destructive/10 text-destructive',
  not_confirmable: 'bg-destructive/10 text-destructive',
  pending_generation: 'bg-secondary text-foreground',
  pending_admission: 'bg-accent text-foreground',
  verifying: 'bg-accent text-foreground',
  quarantined: 'bg-destructive/10 text-destructive',
  admitted: 'bg-primary/10 text-foreground',
  admitted_empty: 'bg-secondary text-foreground',
  running: 'bg-secondary text-foreground',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-secondary text-foreground',
  submitted: 'bg-secondary text-foreground',
}

function modelLabel(modelId: string): string {
  return SELECTABLE_FASHION_MODELS.find((item) => item.id === modelId)?.label ?? modelId
}

function WorkflowSteps({ stage }: { stage: PlanWorkflowStage }) {
  const steps: Array<{ id: PlanWorkflowStage; label: string }> = [
    { id: 'edit', label: '编辑要求' },
    { id: 'repreview', label: '更新预览' },
    { id: 'confirm', label: '确认当前版本' },
  ]
  const currentIndex = stage === 'submitted' ? 2 : stage === 'confirm' ? 2 : stage === 'repreview' ? 1 : 0
  return (
    <ol className="grid grid-cols-3 gap-1.5" aria-label="方案确认步骤">
      {steps.map((step, index) => {
        const current = stage !== 'submitted' && index === currentIndex
        const done = index < currentIndex || stage === 'submitted'
        return (
          <li
            key={step.id}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'rounded-lg border px-2 py-2 text-center text-xs font-medium leading-4',
              current
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : done
                  ? 'border-border bg-secondary text-foreground'
                  : 'border-border bg-background text-foreground',
            )}
          >
            {index + 1}. {step.label}
          </li>
        )
      })}
    </ol>
  )
}

export function PlanPreviewCard({
  view,
  nodes,
  prompt,
  busy,
  onPromptChange,
  onAction,
  onRetry,
  onRefresh,
}: {
  view: PlanCardView
  nodes: AgentBetaNode[]
  prompt: string
  busy: string | null
  onPromptChange: (value: string) => void
  onAction: (action: PlanAction, identity?: AgentBetaPreviewIdentity) => void
  onRetry: () => void
  onRefresh?: () => void
}) {
  const spinning = view.statusKind === 'pending_generation'
    || view.statusKind === 'pending_admission'
    || view.statusKind === 'verifying'
    || view.statusKind === 'running'

  return (
    <article className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-label={`${view.featureLabel}方案${view.previewVersion ? `，预览版本 ${view.previewVersion}` : ''}`}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <WandSparkles className="size-4 shrink-0 text-primary" />
          <span className="truncate">{view.featureLabel}方案</span>
        </span>
        <span className={cn('shrink-0 rounded-md px-2 py-1 text-xs font-medium', statusTone[view.statusKind])}>{view.phaseLabel}</span>
      </header>

      <div className="space-y-3 p-3.5">
        <div className="flex flex-wrap gap-1.5">
          {view.previewVersion !== undefined && (
            <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-foreground">预览版本 {view.previewVersion}</span>
          )}
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground">{view.featureLabel}</span>
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground">{modelLabel(view.modelId)}</span>
          {view.imageRatio && <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground">{view.imageRatio}</span>}
          {view.resolution && <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground">{view.resolution.toUpperCase()}</span>}
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground">{view.resultCount} 张</span>
          {view.expiresLabel && (
            <span className={cn('rounded-md px-2 py-1 text-xs font-medium', view.expired ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-foreground')}>
              {view.expired ? '已过期' : `有效至 ${view.expiresLabel}`}
            </span>
          )}
        </div>

        {!!view.assets.length && (
          <div className="flex flex-wrap gap-1.5" aria-label="方案参考图">
            {view.assets.map((reference, index) => {
              const node = nodes.find((item) => item.id === reference.nodeId)
              return (
                <div key={`${reference.nodeId}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-md border border-border pr-2 text-xs text-foreground">
                  {node ? <NodeImage node={node} className="size-8 rounded-l object-cover" /> : <span className="ml-2">图 {index + 1}</span>}
                  <span className="truncate">{reference.name}</span>
                </div>
              )
            })}
          </div>
        )}

        {!!view.riskNotices.length && (
          <ul className="space-y-1 rounded-lg bg-secondary px-3 py-2 text-xs leading-5 text-secondary-foreground" aria-label="方案注意事项">
            {view.riskNotices.map((notice, index) => <li key={`${index}-${notice}`}>{notice}</li>)}
          </ul>
        )}

        {!!view.blockers.length && (
          <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm leading-6 text-destructive">
            <p className="font-medium">当前方案暂不可确认</p>
            <ul className="mt-1 list-inside list-disc text-xs">{view.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
          </div>
        )}

        {view.showProposalControls ? (
          <>
            <WorkflowSteps stage={view.workflowStage} />
            <Label className="text-sm" htmlFor={`prompt-${view.planId}`}>{view.isV1 ? '生成要求 · 修改后需更新预览' : '生成要求 · 可直接修改'}</Label>
            <Textarea
              id={`prompt-${view.planId}`}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              maxLength={8000}
              rows={5}
              disabled={!!busy}
              className="min-h-28 resize-y bg-background text-sm leading-6"
            />
            <p role="status" aria-live="polite" className="text-sm leading-6 text-foreground">{view.nextStep}</p>
            {view.repreviewEnabled || (view.isV1 && !view.promptMatchesPlan) ? (
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full max-md:opacity-100"
                disabled={!view.repreviewEnabled}
                onClick={() => onAction('preview', view.identity)}
              >
                {busy === '正在更新预览' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-4" />}
                更新预览
              </Button>
            ) : (
              <AgentActionButton
                type="button"
                className="h-11 w-full max-md:opacity-100"
                disabled={!view.confirmEnabled}
                onClick={() => onAction('execute', view.identity)}
              >
                {busy === '正在提交生成' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-4" />}
                {view.isV1
                  ? (view.confirmEnabled ? `确认当前版本 · 生成 ${view.resultCount} 张` : '当前版本不可确认')
                  : `确认生成 ${view.resultCount} 张`}
              </AgentActionButton>
            )}
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{prompt}</p>
            <div className="rounded-lg bg-secondary p-3" role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {spinning
                  ? <Loader2 className="size-4 animate-spin text-primary motion-reduce:animate-none" />
                  : view.claimsCanvas
                    ? <Check className="size-4 text-primary" />
                    : <CircleStop className="size-4 text-secondary-foreground" />}
                <span>{view.statusTitle}</span>
                {view.taskProgress !== undefined && <span className="ml-auto text-xs tabular-nums text-foreground">{view.taskProgress}%</span>}
              </div>
              {view.showTaskMessage && view.taskMessage && <p className="mt-2 break-words text-xs leading-5 text-secondary-foreground">{view.taskMessage}</p>}
              <p className="mt-2 text-sm leading-6 text-foreground">{view.nextStep}</p>
              {view.taskProgress !== undefined && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="生成进度" aria-valuenow={view.taskProgress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-primary motion-reduce:transition-none" style={{ width: `${view.taskProgress}%` }} />
                </div>
              )}
            </div>
            {view.cancelEnabled && (
              <Button type="button" variant="outline" className="h-11 w-full max-md:opacity-100" disabled={!!busy} onClick={() => onAction('cancel')}>
                <CircleStop className="size-4" />取消任务
              </Button>
            )}
            {view.refreshEnabled && onRefresh && (
              <Button type="button" variant="secondary" className="h-11 w-full max-md:opacity-100" disabled={!!busy} onClick={onRefresh}>
                {busy === '正在刷新状态' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-4" />}
                刷新核验状态
              </Button>
            )}
            {view.retryPrepareEnabled && (
              <Button type="button" variant="outline" className="h-11 w-full max-md:opacity-100" disabled={!!busy} onClick={onRetry}>
                <RefreshCw className="size-4" />调整要求并重新准备
              </Button>
            )}
          </>
        )}

        {view.digest && (
          <details className="rounded-lg border border-border bg-background">
            <summary className="min-h-11 cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              预览校验编号（只读）
            </summary>
            <p className="break-all px-3 pb-3 font-mono text-xs leading-5 text-secondary-foreground">{view.digest}</p>
          </details>
        )}

        <ToolTrace entries={view.traces} />
      </div>
    </article>
  )
}
