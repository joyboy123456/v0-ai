'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AgentBetaToolTraceView } from '@/lib/agent-beta/types'
import { buildToolTraceView } from './tool-trace-view'

const statusTone: Record<AgentBetaToolTraceView['status'], string> = {
  completed: 'bg-primary/10 text-foreground',
  rejected: 'bg-destructive/10 text-destructive',
  awaiting_approval: 'bg-secondary text-foreground',
  verification_required: 'bg-accent text-foreground',
}

export function ToolTrace({
  entries,
  className,
}: {
  entries: readonly AgentBetaToolTraceView[]
  className?: string
}) {
  const view = buildToolTraceView(entries)
  const [expanded, setExpanded] = useState(view.defaultOpen)

  useEffect(() => {
    if (view.defaultOpen) setExpanded(true)
  }, [view.defaultOpen])

  if (!view.rows.length) return null

  return (
    <details
      className={cn('rounded-xl border border-border bg-card', className)}
      open={expanded}
      onToggle={(event) => setExpanded((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-foreground marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>{view.accessibleName}</span>
        <span className="text-xs text-secondary-foreground">{expanded ? '收起' : '展开'}</span>
      </summary>
      <ol className="space-y-2 border-t border-border px-3.5 py-3">
        {view.rows.map((row, index) => (
          <li key={`${row.step}-${row.toolName}-${index}`} className="rounded-lg bg-secondary/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs tabular-nums text-secondary-foreground">步骤 {row.step}</span>
              <span className="text-sm font-medium text-foreground">{row.label}</span>
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', statusTone[row.status])}>{row.statusLabel}</span>
              {row.targetLabel && <span className="text-xs text-secondary-foreground">{row.targetLabel}</span>}
            </div>
            {row.note && <p className="mt-1 text-xs leading-5 text-secondary-foreground">系统说明：{row.note}</p>}
          </li>
        ))}
      </ol>
      {view.cutoutHint && (
        <p role="status" className="border-t border-border px-3.5 py-2.5 text-sm leading-6 text-foreground">
          {view.cutoutHint}
        </p>
      )}
    </details>
  )
}
