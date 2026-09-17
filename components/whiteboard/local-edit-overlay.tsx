'use client'

import { useEffect, useRef, useState } from 'react'
import { Eraser, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import type { WhiteboardImage } from '@/lib/whiteboard/types'

export function LocalEditOverlay({
  image,
  onClose,
  onSubmit,
}: {
  image: WhiteboardImage
  onClose: () => void
  onSubmit: (update: { mask: unknown; prompt: string }) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const [tool, setTool] = useState<'paint' | 'erase'>('paint')
  const [size, setSize] = useState(18)
  const drawing = useRef(false)
  const [prompt, setPrompt] = useState('保持人物，面料细节优化')

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = image && image.width && image.naturalHeight ? { width: image.width, height: (image.naturalHeight / image.naturalWidth) * image.width } : null
    if (!rect || !rect.width || !rect.height) return
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width
      canvas.height = rect.height
    }
    ctx.fillStyle = 'rgba(65, 105, 225, 0.25)'
    ctx.strokeStyle = 'rgba(65, 105, 225, 1)'
    ctx.lineWidth = size
  }, [image, size])

  const rel = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: relWithX(rect, clientX), y: relWithY(rect, clientY) }
  }
  const relWithX = (rect: DOMRect | undefined, clientX: number) => (clientX - (rect?.left ?? 0)) / 1
  const relWithY = (rect: DOMRect | undefined, clientY: number) => (clientY - (rect?.top ?? 0)) / 1

  const handleDown = (e: React.PointerEvent) => {
    drawing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const point = rel(e.clientX, e.clientY)
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
  }

  const handleMove = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = ctxRef.current
    if (!ctx) return
    const point = rel(e.clientX, e.clientY)
    ctx.lineTo(point.x, point.y)
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over'
    if (tool === 'paint') {
      ctx.strokeStyle = 'rgba(65, 105, 225, 0.35)'
      ctx.globalCompositeOperation = 'source-over'
      ctx.beginPath()
    } else {
      ctx.globalCompositeOperation = 'destination-out'
    }
    ctx.moveTo(point.x, point.y)
    ctx.stroke()
  }

  const handleUp = () => {
    ctxRef.current?.close()
    drawing.current = false
  }

  const handleClear = () => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.clearRect(0, 0, canvasRef.current?.width ?? 0, canvasRef.current?.height ?? 0)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" aria-label="局部重绘">
      <div className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <h2 className="text-sm font-medium">局部重绘 · {image.name}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>返回白板</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 flex items-center justify-center overflow-hidden bg-background p-8">
          <div className="relative rounded border border-border bg-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.name} className="max-h-full max-w-full object-contain" />
            <canvas ref={canvasRef} className="absolute inset-0 pointer-events-auto cursor-crosshair" style={{ maxHeight: '100%', maxWidth: '100%' }} onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp} />
            <div className="absolute inset-0 pointer-events-none mix-blend-multiply" />
          </div>
        </div>
        <div className="w-72 border-l border-border bg-card p-4">
          <p className="mb-2 text-sm font-medium">画笔工具</p>
          <div className="mb-3 flex items-center gap-2">
            <Button variant={tool === 'paint' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTool('paint')} aria-label="画笔">
              <Pencil className="size-4" />
            </Button>
            <Button variant={tool === 'erase' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTool('erase')} aria-label="橡皮">
              <Eraser className="size-4" />
            </Button>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">笔刷大小: {size}px</p>
          <Slider value={[size]} onValueChange={(v) => setSize(v[0] ?? size)} min={1} max={50} step={1} aria-label="画笔大小" />
          <Button variant="ghost" size="sm" onClick={handleClear} className="mt-2">清除选区</Button>
          <div className="mt-4">
            <label htmlFor="edit-prompt" className="text-xs text-muted-foreground">修改需求</label>
            <textarea id="edit-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mt-2 h-20 w-full rounded border border-border bg-background p-2 text-sm" />
          </div>
          <Button onClick={() => onSubmit({ mask: null, prompt })} className="mt-4 w-full">生成新图片</Button>
        </div>
      </div>
    </div>
  )
}
