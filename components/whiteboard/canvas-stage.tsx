'use client'

import { useEffect, useRef, useState } from 'react'
import { Hand, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Viewport, WhiteboardImage } from '@/lib/whiteboard/types'
import { clampZoom, screenToCanvas, zoomAtPoint } from '@/lib/agent-beta/canvas-geometry'
import { GROUP_TITLES } from '@/lib/whiteboard/initial-scene'

export interface CanvasProps {
  images: WhiteboardImage[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onMove: (positions: Array<{ id: string; x: number; y: number }>, persist?: boolean) => void
  onUpload: () => void
  viewport: Viewport
  onViewport: (v: Viewport) => void
  hoverId?: string | null
  onHover: (id: string | null) => void
  renderNode?: (image: WhiteboardImage, index: number, selected: boolean) => React.ReactNode
  fitHint?: boolean
}

export function CanvasStage({
  images, selectedIds, onSelect, onMove, onUpload, viewport, onViewport, hoverId, onHover, renderNode, fitHint = true,
}: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    kind: 'pan' | 'nodes' | 'selection'
    start: { x: number; y: number }
    viewport: Viewport
    positions: Array<{ id: string; x: number; y: number }>
    moved: boolean
    lastPositions?: Array<{ id: string; x: number; y: number }>
  } | null>(null)
  const [panMode, setPanMode] = useState(false)
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const isSpace = useRef(false)

  useEffect(() => {
    const element = surface.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (event.ctrlKey || event.metaKey) {
        onViewport(zoomAtPoint(viewport, cursor, clampZoom(viewport.zoom * Math.exp(-event.deltaY * 0.008))))
      } else {
        onViewport({ ...viewport, x: viewport.x - event.deltaX, y: viewport.y - event.deltaY })
      }
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [viewport, onViewport])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
      e.preventDefault()
      isSpace.current = true
    }
    const up = () => {
      isSpace.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const pointInSurface = (clientX: number, clientY: number) => {
    const rect = surface.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }

  const startBackground = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-canvas-node], [data-canvas-control]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const kind = panMode || isSpace.current ? 'pan' : 'selection'
    gesture.current = { kind, start: pointInSurface(event.clientX, event.clientY), viewport, positions: [], moved: false }
  }

  const startNode = (event: React.PointerEvent<HTMLButtonElement>, image: WhiteboardImage) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const multiple = event.shiftKey || event.metaKey || event.ctrlKey
    const nextIds = multiple
      ? selectedIds.includes(image.id)
        ? selectedIds
        : [...selectedIds, image.id]
      : selectedIds.includes(image.id)
        ? selectedIds
        : [image.id]
    onSelect(nextIds)
    gesture.current = {
      kind: 'nodes',
      start: pointInSurface(event.clientX, event.clientY),
      viewport,
      positions: images.filter((item) => nextIds.includes(item.id)).map(({ id, x, y }) => ({ id, x, y })),
      moved: false,
    }
  }

  const move = (event: React.PointerEvent) => {
    const current = gesture.current
    if (!current) return
    const point = pointInSurface(event.clientX, event.clientY)
    const dx = point.x - current.start.x
    const dy = point.y - current.start.y
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    current.moved = true
    if (current.kind === 'pan') onViewport({ ...current.viewport, x: current.viewport.x + dx, y: current.viewport.y + dy })
    if (current.kind === 'nodes') {
      const next = current.positions.map((p) => ({ id: p.id, x: p.x + dx / current.viewport.zoom, y: p.y + dy / current.viewport.zoom }))
      current.lastPositions = next
      onMove(next, false)
    }
    if (current.kind === 'selection') {
      const sel = { x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(dx), height: Math.abs(dy) }
      setSelectionRect(sel)
      const first = screenToCanvas({ x: sel.x, y: sel.y }, current.viewport)
      const last = screenToCanvas({ x: sel.x + sel.width, y: sel.y + sel.height }, current.viewport)
      onSelect(images.filter((image) => image.x < last.x && image.x + image.width > first.x && image.y < last.y && image.y + (image.naturalHeight / image.naturalWidth) * image.width + 65 > first.y).map((x) => x.id))
    }
  }

  const finish = () => {
    const current = gesture.current
    if (current?.kind === 'nodes' && current.moved && current.lastPositions) onMove(current.lastPositions, true)
    if (current && current.kind !== 'nodes' && !current.moved) onSelect([])
    gesture.current = null
    setSelectionRect(null)
  }

  const fit = () => {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect || !images.length) return
    const xs = images.map((i) => i.x)
    const ys = images.map((i) => i.y)
    const ws = images.map((i) => i.width)
    const hs = images.map((i) => (i.naturalHeight / i.naturalWidth) * i.width)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs.map((x, i) => x + ws[i]))
    const maxY = Math.max(...ys.map((y, i) => y + hs[i] + 65))
    const zoom = clampZoom(Math.min((rect.width - 80) / (maxX - minX), (rect.height - 140) / (maxY - minY), 1))
    onViewport({
      x: rect.width / 2 - ((maxX - minX) / 2 + minX) * zoom,
      y: rect.height / 2 - ((maxY - minY) / 2 + minY) * zoom - 50,
      zoom,
    })
  }

  const visibleGroups = [...new Set(images.map((i) => i.groupId ?? 'uploads'))] as Array<'reference' | 'main' | 'results' | 'uploads'>

  return (
    <section className="relative h-full min-h-0 overflow-hidden" style={{ background: '#F6F7F9' }} aria-label="创作画布">
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(#cbd5e1 0.7px, transparent 0.7px)', backgroundSize: '24px 24px', backgroundPosition: `${viewport.x}px ${viewport.y}px` }} />
      <div ref={surface} className={cn('absolute inset-0 touch-none overflow-hidden', panMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair')}
        onPointerDown={startBackground} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
        <div className="absolute origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {visibleGroups.map((gid) => {
            const imgs = images.filter((i) => (i.groupId ?? 'uploads') === gid)
            if (!imgs.length) return null
            const xs = imgs.map((i) => i.x)
            const ys = imgs.map((i) => i.y)
            return (
              <div key={gid} className="pointer-events-none absolute left-0 top-0" style={{ left: Math.min(...xs), top: Math.min(...ys) - 28 }}>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{GROUP_TITLES[gid]}</span>
              </div>
            )
          })}
          {images.map((image, index) => {
            const selected = selectedIds.includes(image.id)
            const isHovering = hoverId === image.id
            const height = (image.naturalHeight / image.naturalWidth) * image.width
            return (
              <article key={image.id} data-canvas-node className={cn('absolute overflow-hidden rounded-lg border bg-card transition-shadow', selected ? 'border-primary ring-2 ring-primary/25 shadow-md' : isHovering ? 'shadow-md' : 'border-border')}
                style={{ left: image.x, top: image.y, width: image.width }}>
                {renderNode ? renderNode(image, index, selected) : (
                  <button type="button" aria-label={`选择 ${image.name}`} aria-pressed={selected}
                    className="relative block w-full cursor-move touch-none focus-visible:outline-2 focus-visible:outline-primary"
                    style={{ height }}
                    onPointerDown={(event) => startNode(event, image)}
                    onMouseEnter={() => onHover(image.id)}
                    onMouseLeave={() => onHover(null)}>
                    <img src={image.url} alt={image.name} draggable={false} className="h-full w-full bg-secondary object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    {image.demo && <span className={cn('absolute left-2 top-2 rounded-full bg-card/95 px-2 py-0.5 text-[10px] font-semibold', selected ? 'text-primary' : 'text-muted-foreground')}>演示</span>}
                  </button>
                )}
                <div className="flex h-[60px] items-center gap-1 px-2.5">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{image.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{Math.round(image.width)} × {Math.round(height)}</p></div>
                </div>
              </article>
            )
          })}
          {selectionRect && <div className="pointer-events-none absolute rounded border bg-primary/10" style={{ ...selectionRect, backgroundColor: 'rgba(65, 105, 225, 0.1)', borderColor: '#4169E1', borderWidth: 1 }} />}
        </div>
      </div>
      <div data-canvas-control className="absolute bottom-4 left-4 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon-sm" onClick={() => onViewport({ ...viewport, zoom: clampZoom(viewport.zoom / 1.2) })} aria-label="缩小画布"><ZoomOut className="size-4" /></Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(viewport.zoom * 100)}%</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onViewport({ ...viewport, zoom: clampZoom(viewport.zoom * 1.2) })} aria-label="放大画布"><ZoomIn className="size-4" /></Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={fit} aria-label="适配全部图片"><Scan className="size-4" /></Button>
      </div>
    </section>
  )
}
