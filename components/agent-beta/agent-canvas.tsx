'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Download, Expand, Hand, ImageOff, MousePointer2, Plus, Scan, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clampZoom, screenToCanvas, zoomAtPoint } from '@/lib/agent-beta/canvas-geometry'
import type { AgentBetaNode } from '@/lib/agent-beta/types'
import { cn } from '@/lib/utils'
import { nodeDisplaySize, toggleNodeSelection, type NodePosition } from './session-state'
import { AgentActionButton } from './agent-action-button'

type Viewport = { x: number; y: number; zoom: number }
type Gesture = {
  kind: 'pan' | 'nodes' | 'selection'
  start: { x: number; y: number }
  viewport: Viewport
  positions: NodePosition[]
  moved: boolean
  lastPositions?: NodePosition[]
}

export function NodeImage({ node, className }: { node: AgentBetaNode; className?: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <span className={cn('flex items-center justify-center gap-2 bg-secondary text-sm text-muted-foreground', className)}>
      <ImageOff className="size-5" /> 图片暂不可用
    </span>
  ) : <img src={node.url} alt={node.name} draggable={false} onError={() => setFailed(true)} className={className} />
}

export function AgentCanvas({ nodes, selectedIds, onSelect, onMove, onUpload, onPreview, disabled }: {
  nodes: AgentBetaNode[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onMove: (positions: NodePosition[], persist: boolean) => void
  onUpload: () => void
  onPreview: (node: AgentBetaNode) => void
  disabled: boolean
}) {
  const surface = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 44, y: 52, zoom: 1 })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const [selectMode, setSelectMode] = useState(false)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const gesture = useRef<Gesture | null>(null)

  const pointInSurface = (clientX: number, clientY: number) => {
    const rect = surface.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }

  useEffect(() => {
    const element = surface.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        setViewport((value) => zoomAtPoint(value, { x: event.clientX - rect.left, y: event.clientY - rect.top }, clampZoom(value.zoom * Math.exp(-event.deltaY * 0.008))))
      } else {
        setViewport((value) => ({ ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }))
      }
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  const zoom = (factor: number) => {
    const rect = surface.current?.getBoundingClientRect()
    setViewport((value) => zoomAtPoint(value, { x: (rect?.width ?? 600) / 2, y: (rect?.height ?? 500) / 2 }, clampZoom(value.zoom * factor)))
  }

  const fit = () => {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect || !nodes.length) { setViewport({ x: 44, y: 52, zoom: 1 }); return }
    const left = Math.min(...nodes.map((node) => node.x))
    const top = Math.min(...nodes.map((node) => node.y))
    const right = Math.max(...nodes.map((node) => node.x + nodeDisplaySize(node).width))
    const bottom = Math.max(...nodes.map((node) => node.y + nodeDisplaySize(node).height + 65))
    const nextZoom = clampZoom(Math.min((rect.width - 100) / (right - left), (rect.height - 150) / (bottom - top), 1))
    setViewport({ x: (rect.width - (right - left) * nextZoom) / 2 - left * nextZoom, y: (rect.height - (bottom - top) * nextZoom) / 2 - top * nextZoom, zoom: nextZoom })
  }

  const startBackground = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-canvas-node], [data-canvas-control]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const kind = selectMode || event.shiftKey ? 'selection' : 'pan'
    gesture.current = { kind, start: pointInSurface(event.clientX, event.clientY), viewport: viewportRef.current, positions: [], moved: false }
  }

  const startNode = (event: ReactPointerEvent<HTMLButtonElement>, node: AgentBetaNode) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const multiple = multiSelect || event.shiftKey || event.metaKey || event.ctrlKey
    const nextIds = multiple ? toggleNodeSelection(selectedIds, node.id, true) : selectedIds.includes(node.id) ? selectedIds : [node.id]
    onSelect(nextIds)
    gesture.current = {
      kind: 'nodes',
      start: pointInSurface(event.clientX, event.clientY),
      viewport: viewportRef.current,
      positions: nodes.filter((item) => nextIds.includes(item.id)).map(({ id, x, y }) => ({ id, x, y })),
      moved: false,
    }
  }

  const move = (event: ReactPointerEvent) => {
    const current = gesture.current
    if (!current) return
    const point = pointInSurface(event.clientX, event.clientY)
    const dx = point.x - current.start.x
    const dy = point.y - current.start.y
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    current.moved = true
    if (current.kind === 'pan') setViewport({ ...current.viewport, x: current.viewport.x + dx, y: current.viewport.y + dy })
    if (current.kind === 'nodes') {
      current.lastPositions = current.positions.map((position) => ({ id: position.id, x: position.x + dx / current.viewport.zoom, y: position.y + dy / current.viewport.zoom }))
      onMove(current.lastPositions, false)
    }
    if (current.kind === 'selection') {
      const selection = { x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(dx), height: Math.abs(dy) }
      setSelectionRect(selection)
      const first = screenToCanvas({ x: selection.x, y: selection.y }, current.viewport)
      const last = screenToCanvas({ x: selection.x + selection.width, y: selection.y + selection.height }, current.viewport)
      onSelect(nodes.filter((node) => {
        const size = nodeDisplaySize(node)
        return node.x < last.x && node.x + size.width > first.x && node.y < last.y && node.y + size.height + 65 > first.y
      }).map((node) => node.id))
    }
  }

  const finish = () => {
    const current = gesture.current
    if (current?.kind === 'nodes' && current.moved && current.lastPositions) onMove(current.lastPositions, true)
    if (current && current.kind !== 'nodes' && !current.moved) onSelect([])
    gesture.current = null
    setSelectionRect(null)
  }

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-secondary/35" aria-label="创作画布">
      <div className="pointer-events-none absolute inset-0 opacity-35" style={{ backgroundImage: 'radial-gradient(var(--muted-foreground) 0.7px, transparent 0.7px)', backgroundSize: '24px 24px', backgroundPosition: `${viewport.x}px ${viewport.y}px` }} />
      <div ref={surface} className={cn('absolute inset-0 touch-none overflow-hidden', selectMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}
        onPointerDown={startBackground} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible text-border" width="1" height="1" aria-hidden="true">
            {nodes.filter((node) => node.parentNodeId).map((node) => {
              const parent = nodes.find((item) => item.id === node.parentNodeId)
              if (!parent) return null
              const fromX = parent.x + nodeDisplaySize(parent).width
              const fromY = parent.y + nodeDisplaySize(parent).height / 2
              const toY = node.y + nodeDisplaySize(node).height / 2
              return <path key={node.id} d={`M ${fromX} ${fromY} C ${fromX + 70} ${fromY}, ${node.x - 70} ${toY}, ${node.x} ${toY}`} stroke="currentColor" strokeWidth="2" fill="none" />
            })}
          </svg>
          {nodes.map((node, index) => {
            const size = nodeDisplaySize(node)
            const selected = selectedIds.includes(node.id)
            return (
              <article key={node.id} data-canvas-node className={cn('absolute overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow', selected ? 'border-primary ring-2 ring-primary/25 shadow-lg' : 'border-border')}
                style={{ left: node.x, top: node.y, width: size.width }}>
                <button type="button" aria-label={`选择参考图 ${index + 1}：${node.name}`} aria-pressed={selected}
                  className="relative block w-full cursor-move touch-none focus-visible:outline-2 focus-visible:outline-primary"
                  style={{ height: size.height }}
                  onPointerDown={(event) => startNode(event, node)}
                  onClick={(event) => { if (event.detail === 0) onSelect(toggleNodeSelection(selectedIds, node.id, multiSelect)) }}
                  onDoubleClick={() => onPreview(node)}>
                  <NodeImage node={node} className="h-full w-full bg-secondary object-contain" />
                  <span className={cn('absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur', selected ? 'bg-primary text-primary-foreground' : 'bg-card/90 text-foreground')}>
                    {selected ? `参考 ${selectedIds.indexOf(node.id) + 1}` : node.taskId ? '生成结果' : '原始素材'}
                  </span>
                </button>
                <div className="flex h-[62px] items-center gap-1 px-2.5">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={node.name}>{node.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{node.width} × {node.height}</p></div>
                  <Button variant="ghost" size="icon-sm" onClick={() => onPreview(node)} aria-label={`预览 ${node.name}`}><Expand className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon-sm" asChild><a href={node.url} download={node.name} target="_blank" rel="noreferrer" aria-label={`下载 ${node.name}`}><Download className="size-3.5" /></a></Button>
                </div>
              </article>
            )
          })}
        </div>
        {selectionRect && <div className="pointer-events-none absolute rounded border border-primary bg-primary/10" style={selectionRect} />}
      </div>
      <div data-canvas-control className="absolute left-4 top-4 flex items-center gap-2 rounded-xl border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur">
        <Button variant={!selectMode ? 'secondary' : 'ghost'} size="icon-sm" aria-label="拖动画布" aria-pressed={!selectMode} onClick={() => setSelectMode(false)}><Hand className="size-4" /></Button>
        <Button variant={selectMode ? 'secondary' : 'ghost'} size="icon-sm" aria-label="框选图片" aria-pressed={selectMode} onClick={() => setSelectMode(true)}><MousePointer2 className="size-4" /></Button>
        <span className="h-5 w-px bg-border" />
        <Button variant={multiSelect ? 'secondary' : 'ghost'} size="sm" aria-pressed={multiSelect} onClick={() => setMultiSelect(!multiSelect)}>多选</Button>
      </div>
      <Button data-canvas-control variant="secondary" size="sm" className="absolute right-4 top-4 shadow-sm" onClick={onUpload} disabled={disabled} aria-label="添加图片"><Plus className="size-4" /><span className="max-sm:hidden">添加图片</span></Button>
      {!nodes.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
        <div className="pointer-events-auto max-w-sm text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm"><Upload className="size-6 text-primary" /></div>
          <h2 className="text-lg font-semibold tracking-tight">从一张参考图开始</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">把服装或灵感放进画布，再告诉助手想做什么。每一步结果都会留在这里。</p>
          <AgentActionButton className="mt-6" onClick={onUpload} disabled={disabled}><Plus className="size-4" />上传参考图</AgentActionButton>
          <p className="mt-3 text-xs text-muted-foreground">也可以先描述需求，让助手帮你明确方向</p>
        </div>
      </div>}
      <div data-canvas-control className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon-sm" onClick={() => zoom(1 / 1.2)} aria-label="缩小画布"><ZoomOut className="size-4" /></Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(viewport.zoom * 100)}%</span>
        <Button variant="ghost" size="icon-sm" onClick={() => zoom(1.2)} aria-label="放大画布"><ZoomIn className="size-4" /></Button>
        <span className="mx-1 h-5 w-px bg-border" /><Button variant="ghost" size="icon-sm" onClick={fit} aria-label="适配全部图片"><Scan className="size-4" /></Button>
      </div>
      {!!nodes.length && <p className="pointer-events-none absolute bottom-6 left-4 hidden text-[11px] text-muted-foreground lg:block">拖动排布 · Shift 框选 · Ctrl / ⌘ 滚轮缩放</p>}
    </section>
  )
}
