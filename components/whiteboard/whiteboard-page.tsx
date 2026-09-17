'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Copy, Grid3X3, Layers, Link2, Scan, SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { GroupId, ImageRole, ReferenceItem, TaskResult, Viewport, WhiteboardImage } from '@/lib/whiteboard/types'
import { CanvasStage } from './canvas-stage'
import { ProjectHeader } from './project-header'
import { ToolRail } from './tool-rail'
import { AssetDrawer } from './asset-drawer'
import { SelectionToolbar } from './selection-toolbar'
import { ExportDialog } from './export-dialog'
import { CreationPanel, TaskPanel } from './creation-panel'
import { LocalEditOverlay } from './local-edit-overlay'
import {
  createTask, subscribe, getTask, markImage, cancelTask, emit,
} from '@/lib/whiteboard/mock-service'
import { makeInitialImages, taskKindLabel, DEMO_PHOTO_URLS, POSE_LIBRARY } from '@/lib/whiteboard/initial-scene'
import { toolById, toolDefinitions } from '@/lib/whiteboard/tool-registry'
import { cn } from '@/lib/utils'

const STORAGE = 'v0-whiteboard-demo'

interface ResultTaskItem {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

function generateImageUrl(toolId: string, index: number): string {
  const tool = toolById(toolId)
  return DEMO_PHOTO_URLS[index % DEMO_PHOTO_URLS.length]
}

function makeResultPositions(count: number, toolId: string) {
  const positions: Array<{ x: number; y: number; width: number; height: number }> = []
  for (let i = 0; i < count; i++) {
    positions.push({
      x: 640 + i * 160,
      y: 72,
      width: 144,
      height: 192,
    })
  }
  return positions
}

export function WhiteboardPage() {
  const [images, setImages] = useState<WhiteboardImage[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewport, setViewport] = useState<Viewport>({ x: 56, y: 64, zoom: 1 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [prompt, setPrompt] = useState('基于这张图做一组商品详情页套图，保留人物和服装，补充不同角度和细节')
  const [activeToolId, setActiveToolId] = useState('generate-set')
  const [activeTasks, setActiveTasks] = useState<TaskResult[]>([])
  const [panelOpen, setPanelOpen] = useState(true)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [assetsMode, setAssetsMode] = useState<'select' | 'pan'>('select')
  const [editTarget, setEditTarget] = useState<WhiteboardImage | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [taskList, setTaskList] = useState<TaskResult[]>([])
  const [editTool, setEditTool] = useState<'select' | 'pan' | 'asset'>('select')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const groupCounter = useRef(0)
  const nextId = () => `img-${++groupCounter.current}`
  const undoStack = useRef<any[]>([])
  const redoStack = useRef<any[]>([])

  const saveToLocal = useCallback(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ images, references, prompt, viewport, savedAt: Date.now() }))
      setSavedAt(Date.now())
    } catch {
      setSavedAt(null)
    }
  }, [images, references, prompt, viewport, savedAt])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed.images) && parsed.images.length) {
          setImages(parsed.images)
          setReferences(parsed.references ?? [])
          setPrompt(parsed.prompt ?? '')
          setViewport(parsed.viewport ?? { x: 56, y: 64, zoom: 1 })
          setSavedAt(parsed.savedAt ?? null)
          return
        }
      }
    } catch {}
    setImages(makeInitialImages())
  }, [])

  useEffect(() => {
    const unsub = subscribe(() => {
      setActiveTasks((prev) => prev)
      setTaskList((prev) => prev)
    })
    return unsub
  }, [])

  const selectedImage = images.find((image) => selectedIds.includes(image.id))

  const handleMove = useCallback((positions: Array<{ id: string; x: number; y: number }>, persist = true) => {
    if (persist) {
      undoStack.current.push(images)
      redoStack.current = []
      setImages((prev) => {
        const map = new Map(prev.map((i) => [i.id, i]))
        positions.forEach((p) => {
          const item = map.get(p.id)
          if (item) map.set(p.id, { ...item, x: p.x, y: p.y })
        })
        return Array.from(map.values())
      })
      saveToLocal()
      return
    }
    setImages((prev) => {
      const map = new Map(prev.map((i) => [i.id, i]))
      positions.forEach((p) => {
        const item = map.get(p.id)
        if (item) map.set(p.id, { ...item, x: p.x, y: p.y })
      })
      return Array.from(map.values())
    })
  }, [images, saveToLocal])

  const handleUndo = useCallback(() => {
    if (!undoStack.current.length) return
    const prev = undoStack.current.pop()
    redoStack.current.push(images)
    setImages(prev)
    saveToLocal()
  }, [images, saveToLocal])

  const handleRedo = useCallback(() => {
    if (!redoStack.current.length) return
    const next = redoStack.current.pop()
    undoStack.current.push(images)
    setImages(next)
    saveToLocal()
  }, [images, saveToLocal])

  const handleUpload = useCallback((files: File[]) => {
    const centerX = 140
    const centerY = 140
    const next = files.map((file, index) => {
      const url = URL.createObjectURL(file)
      const id = `upload-${Date.now()}-${index}`
      return { id, url, name: file.name, naturalWidth: 896, naturalHeight: 1200, width: 128, x: centerX + index * 16, y: centerY, kind: 'upload' as const, groupId: 'uploads' as GroupId, demo: undefined as boolean | undefined } as WhiteboardImage
    })
    undoStack.current.push(images)
    redoStack.current = []
    setImages((prev) => [...prev, ...next])
    saveToLocal()
  }, [images, saveToLocal])

  const handleCopy = useCallback(() => {
    const target = selectedIds.length === 1 ? selectedIds[0] : null
    const image = images.find((img) => img.id === target)
    if (!image) return
    undoStack.current.push(images)
    redoStack.current = []
    setImages((prev) => [...prev, { ...image, id: nextId(), x: image.x + 24, y: image.y + 24 }])
    saveToLocal()
  }, [images, selectedIds, saveToLocal])

  const handleDelete = useCallback(() => {
    if (!selectedIds.length) return
    undoStack.current.push(images)
    redoStack.current = []
    setImages((prev) => prev.filter((img) => !selectedIds.includes(img.id)))
    setSelectedIds([])
    saveToLocal()
  }, [images, selectedIds, saveToLocal])

  const handleAlign = useCallback((mode: 'left' | 'top' | 'middle' | 'center') => {
    if (selectedIds.length < 2) return
    const targets = images.filter((img) => selectedIds.includes(img.id))
    const xs = targets.map((t) => t.x)
    const ys = targets.map((t) => t.y)
    const baseX = mode === 'left' ? Math.min(...xs) : mode === 'center' ? xs.reduce((a, b) => a + b, 0) / xs.length : null
    const baseY = mode === 'top' ? Math.min(...ys) : mode === 'middle' ? ys.reduce((a, b) => a + b, 0) / ys.length : null
    undoStack.current.push(images)
    redoStack.current = []
    setImages((prev) => {
      const map = new Map(prev.map((i) => [i.id, i]))
      targets.forEach((t) => {
        const item = map.get(t.id)
        if (item) {
          const nextX = baseX != null ? (mode === 'left' ? baseX : mode === 'center' ? (xs[target.length / 2] ?? baseX) : item.x) : item.x
          const nextY = baseY != null ? (mode === 'top' ? baseY : mode === 'middle' ? (ys[target.length / 2] ?? baseY) : item.y) : item.y
          map.set(t.id, { ...item, x: nextX, y: nextY })
        }
      })
      return Array.from(map.values())
    })
    saveToLocal()
  }, [images, selectedIds, saveToLocal])

  const handleGroup = useCallback(() => {
    if (!selectedIds.length) return
    undoStack.current.push(images)
    redoStack.current = []
    const gid = 'uploads'
    setImages((prev) => {
      const newImgs = prev.map((img) => selectedIds.includes(img.id) ? { ...img, groupId: gid } : img)
      return newImgs
    })
    saveToLocal()
  }, [images, selectedIds, saveToLocal])

  const handleReference = useCallback(() => {
    const target = selectedIds.length === 1 ? images.find((img) => img.id === selectedIds[0]) : null
    if (!target || references.some((r) => r.id === target.id)) return
    setReferences((prev) => [...prev, { id: target.id, url: target.url, name: target.name, role: target.kind === 'pose' ? 'pose' : 'main' }])
    saveToLocal()
  }, [images, selectedIds, references, saveToLocal])

  const handleTaskSubmit = useCallback(() => {
    if (!references.length || !activeToolId) return
    const tool = toolById(activeToolId)
    const shots = activeToolId === 'generate-set' ? ['正面全身', '侧面全身', '背面全身', '面料细节'] : activeToolId === 'switch-pose' ? ['正面', '侧面'] : [tool.name]
    const baseline = makeResultPositions(shots.length, activeToolId).map((pos, index) => ({
      id: `${nextId()}-gen-${index}`,
      url: null,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      label: shots[index],
      status: 'pending' as const,
    }))
    undoStack.current.push(images)
    redoStack.current = []
    const before = images
    createTask({
      tool: activeToolId as 'image-set' | 'pose-set' | 'single-edit',
      toolName: tool.name,
      prompt,
      references: references.map((r) => ({ ...r })),
      scenario: 'partial-fail' as 'all-success' | 'partial-fail',
      params: { ratio: '7:9', count: shots.length, resolution: '2K' },
      baseline,
    })
    setActiveTasks((prev) => prev)
    const resultImages: WhiteboardImage[] = baseline.map((item, index) => ({
      ...item,
      id: item.id,
      url: DEMO_PHOTO_URLS[index % DEMO_PHOTO_URLS.length],
      demo: true,
      kind: 'result' as const,
      groupId: 'results' as GroupId,
    } as WhiteboardImage))
    setImages((prev) => [...prev, ...resultImages])
    saveToLocal()
  }, [activeToolId, references, prompt, images, saveToLocal])

  const handleCancelTask = useCallback((taskId: string) => {
    cancelTask(taskId)
    setActiveTasks((prev) => prev)
  }, [])

  const handleRetryImage = useCallback((taskId: string, imageIndex: number) => {
    markImage(taskId, `image-${imageIndex}`, 'ok', DEMO_PHOTO_URLS[imageIndex % images.length])
    setActiveTasks((prev) => prev)
  }, [images])

  const handleEdit = useCallback((toolId: string | null) => {
    setActiveToolId(toolId ?? 'generate-set')
  }, [])

  const handleDownload = useCallback((image: WhiteboardImage, format: 'original' | 'png' | 'jpeg') => {
    const anchor = document.createElement('a')
    anchor.href = image.url
    anchor.download = image.name
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }, [images])

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev)
  }, [])

  const toggleAssets = useCallback(() => {
    setAssetsOpen((prev) => !prev)
  }, [])

  const toggleToolbox = useCallback(() => {
    setPanelOpen(true)
    setActiveToolId('business-photography')
  }, [])

  useEffect(() => {
    if (!references.length && selectedIds.length === 1 && selectedIds[0]) {
      const target = images.find((img) => img.id === selectedIds[0])
      if (target) {
        setReferences([{ id: target.id, url: target.url, name: target.name, role: 'main' }])
        saveToLocal()
      }
    }
  }, [selectedIds, images, references, saveToLocal])

  useEffect(() => {
    const watched = ['assets1', 'assets2']
    const initialTask = taskList[0]
    if (watched && initialTask && initialTask.images.length) {
      const tick = setInterval(() => {
        const updated = [...activeTasks]
        setActiveTasks(updated)
      }, 300)
      return () => clearInterval(tick)
    }
  }, [activeTasks, taskList])

  const currentTool = toolById(activeToolId)
  const selectedToolLabel = currentTool ? currentTool.name : '未选择工具'
  const activeTaskCount = taskList.length

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background" aria-label="创作白板">
      <ProjectHeader
        savedAt={savedAt}
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onExport={() => setExportOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex border-border bg-card" style={{ height: '100%' }}>
          <ToolRail
            activeTool={assetsMode}
            onTool={() => setAssetsMode((assetsMode === 'select' ? 'pan' : 'select') as 'select' | 'pan')}
            onUpload={() => fileInputRef.current?.click()}
            onAssets={toggleAssets}
            assetsOpen={assetsOpen}
            onToolbox={toggleToolbox}
            toolboxOpen={activeToolId !== 'generate-set' && activeToolId !== null}
          />
          {assetsOpen && (
            <AssetDrawer
              onUpload={handleUpload}
              onAddToCanvas={(img) => {
                undoStack.current.push(images)
                redoStack.current = []
                setImages((prev) => [...prev, img])
                saveToLocal()
                setAssetsOpen(false)
              }}
            />
          )}
        </div>
        <div className="relative flex-1 min-h-0">
          <CanvasStage
            images={images}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            onMove={handleMove}
            onUpload={() => fileInputRef.current?.click()}
            viewport={viewport}
            onViewport={setViewport}
            hoverId={hoverId}
            onHover={setHoverId}
            renderNode={undefined}
          />
          {selectedImage && (
            <div className="absolute left-1/2 top-1/2 z-10 w-max -translate-x-1/2 -translate-y-full rounded-lg" style={{ top: `${viewport.y + 40}px` }}>
              <SelectionToolbar
                multi={selectedIds.length > 1}
                onReference={handleReference}
                onGenerateSet={() => handleEdit('generate-set')}
                onPose={() => handleEdit('switch-pose')}
                onEdit={() => handleEdit('local-repaint')}
                onDownload={() => handleDownload(selectedImage, 'original')}
                onCopy={handleCopy}
                onDelete={handleDelete}
                onAlign={handleAlign}
                onDistribute={() => {}}
                onGroup={handleGroup}
              />
            </div>
          )}
        </div>
        <aside className={cn('min-h-0 border-l border-border bg-card transition-all', panelOpen ? 'flex w-[368px] max-w-[40vw]' : 'hidden')}>
          <div className="flex h-full w-full flex-col border-l border-border">
            <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-card px-1.5">
              <Tabs value={panelOpen ? 'creation' : 'task'} className="w-full">
                <TabsTrigger value="creation" className="w-full flex-1">创作</TabsTrigger>
                <TabsTrigger value="task" className="w-full flex-1">任务</TabsTrigger>
              </Tabs>
            </div>
            {panelOpen ? (
              <div className="flex min-h-0 flex-1">
                <CreationPanel
                  tools={toolDefinitions}
                  activeToolId={activeToolId}
                  references={references}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  onSubmit={handleTaskSubmit}
                  disabled={!references.length}
                  activeTasks={activeTasks}
                  onRemoveReference={(id) => setReferences((prev) => prev.filter((r) => r.id !== id))}
                  onRoleChange={(id, role) => setReferences((prev) => prev.map((r) => r.id === id ? { ...r, role } : r))}
                  onOpenToolbox={toggleToolbox}
                  taskImages={images}
                  onOpenToolSettings={handleEdit}
                />
                <div className="hidden max-h-0 flex-1">
                  <TaskPanel
                    tasks={taskList}
                    onCancel={handleCancelTask}
                    onRetryImage={handleRetryImage}
                    onViewGroup={() => {}}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </aside>
        {editTarget && (
          <LocalEditOverlay
            image={editTarget}
            onClose={() => setEditTarget(null)}
            onSubmit={(update) => { setEditTarget(null) }}
          />
        )}
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          images={images}
          selectedIds={selectedIds}
          onExport={handleDownload}
        />
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) handleUpload(files); e.target.value = '' }} />
      </div>
    </div>
  )
}
