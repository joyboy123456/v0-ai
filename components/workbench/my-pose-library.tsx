'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn, readJsonResponse } from '@/lib/utils'
import type { PoseBodyPart, SavedPose } from '@/lib/types'

const MAX_POSE_SELECTION = 9
const BODY_PART_OPTIONS: Array<{
  value: 'all' | PoseBodyPart
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'full', label: '全身' },
  { value: 'upper', label: '上半身' },
  { value: 'lower', label: '下半身' },
]
const UPLOAD_BODY_PART_OPTIONS: Array<{
  value: PoseBodyPart
  label: string
}> = [
  { value: 'full', label: '全身' },
  { value: 'upper', label: '上半身' },
  { value: 'lower', label: '下半身' },
]
const BODY_PART_LABELS: Record<PoseBodyPart, string> = {
  full: '全身',
  upper: '上半身',
  lower: '下半身',
}

interface MyPoseLibraryProps {
  poses: SavedPose[]
  selectedPoses: SavedPose[]
  onChangeSelectedPoses: (poses: SavedPose[]) => void
  onAddPose: (pose: SavedPose) => void
  onRenamePose: (poseId: string, name: string) => void
  onDeletePose: (poseId: string) => void
}

export function MyPoseLibrary({
  poses,
  selectedPoses,
  onChangeSelectedPoses,
  onAddPose,
  onRenamePose,
  onDeletePose,
}: MyPoseLibraryProps) {
  const [open, setOpen] = useState(false)
  const previewPoses = selectedPoses.slice(0, 4)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="text-primary">*</span>
        <span className="text-sm text-foreground">我的姿势库</span>
      </div>

      <div className="rounded-lg border border-border bg-secondary p-3">
        {selectedPoses.length ? (
          <div className="mb-3 flex items-center gap-3">
            <div className="flex -space-x-2">
              {previewPoses.map((pose) => (
                <img
                  key={pose.id}
                  src={pose.url}
                  alt={pose.name}
                  className="h-12 w-12 rounded-md border border-border bg-white object-cover"
                />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">
                已选 {selectedPoses.length} 个姿势
              </p>
              <p className="text-xs text-muted-foreground">
                生成时会按所选姿势逐个裂变
              </p>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">
            上传并选择你常用的姿势，适合做自己的固定姿势库。
          </p>
        )}

        <div className="flex items-center gap-2">
          {previewPoses.map((pose) => (
            <button
              key={pose.id}
              type="button"
              onClick={() => setOpen(true)}
              className="relative h-11 w-11 overflow-hidden rounded-md border border-border bg-white"
            >
              <img src={pose.url} alt={pose.name} className="h-full w-full object-cover" />
              <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            </button>
          ))}

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-11 min-w-14 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            管理
          </button>
        </div>
      </div>

      <MyPoseLibraryDialog
        open={open}
        poses={poses}
        selectedPoses={selectedPoses}
        onOpenChange={setOpen}
        onChangeSelectedPoses={onChangeSelectedPoses}
        onAddPose={onAddPose}
        onRenamePose={onRenamePose}
        onDeletePose={onDeletePose}
      />
    </div>
  )
}

function MyPoseLibraryDialog({
  open,
  poses,
  selectedPoses,
  onOpenChange,
  onChangeSelectedPoses,
  onAddPose,
  onRenamePose,
  onDeletePose,
}: MyPoseLibraryProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')
  const [filterBodyPart, setFilterBodyPart] = useState<'all' | PoseBodyPart>(
    'all',
  )
  const [uploadBodyPart, setUploadBodyPart] = useState<PoseBodyPart>('full')
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true
    setDraftSelectedIds(selectedPoses.map((pose) => pose.id))
    setError('')
  }, [open, selectedPoses])

  useEffect(() => {
    setDraftSelectedIds((current) =>
      current.filter((poseId) => poses.some((pose) => pose.id === poseId)),
    )
  }, [poses])

  const selectedCount = draftSelectedIds.length
  const atLimit = selectedCount >= MAX_POSE_SELECTION
  const filteredPoses = useMemo(() => {
    if (filterBodyPart === 'all') return poses
    return poses.filter((pose) => pose.bodyPart === filterBodyPart)
  }, [filterBodyPart, poses])

  const selectedPoseMap = useMemo(
    () => new Map(poses.map((pose) => [pose.id, pose])),
    [poses],
  )

  const orderedSelectedPoses = draftSelectedIds
    .map((id) => selectedPoseMap.get(id))
    .filter((pose): pose is SavedPose => Boolean(pose))

  const toggleSelected = (poseId: string) => {
    setDraftSelectedIds((current) => {
      if (current.includes(poseId)) {
        return current.filter((id) => id !== poseId)
      }
      if (current.length >= MAX_POSE_SELECTION) return current
      return [...current, poseId]
    })
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const uploadResponse = await fetch('/api/assets/upload', {
        method: 'POST',
        body: formData,
      })

      const uploaded = await readJsonResponse<{
        assetId: string
        url: string
        fileName: string
        width: number
        height: number
      }>(uploadResponse, '上传失败')

      const poseResponse = await fetch('/api/poses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: uploaded.assetId,
          url: uploaded.url,
          name: uploaded.fileName,
          width: uploaded.width,
          height: uploaded.height,
          bodyPart: uploadBodyPart,
        }),
      })

      const savedPose = await readJsonResponse<SavedPose>(
        poseResponse,
        '保存姿势失败',
      )

      onAddPose(savedPose)
      setDraftSelectedIds((current) =>
        current.includes(savedPose.id) ? current : [...current, savedPose.id],
      )
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  const handleConfirm = () => {
    onChangeSelectedPoses(orderedSelectedPoses)
    onOpenChange(false)
  }

  const handleReset = () => {
    setDraftSelectedIds([])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(96vw,88rem)] max-w-7xl bg-[#101010] border-border p-0 overflow-hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">我的姿势库</DialogTitle>

        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">我的姿势库</h2>
            <p className="mt-1 text-xs text-muted-foreground">上传、重命名、删除并多选你的常用姿势。</p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-full border border-border bg-secondary/80 p-1">
            {BODY_PART_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilterBodyPart(option.value)}
                className={cn(
                  'rounded-full px-4 py-2 text-xs font-medium transition-colors',
                  filterBodyPart === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mb-4 rounded-2xl border border-border bg-secondary/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">上传前先选分类：</span>
              {UPLOAD_BODY_PART_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setUploadBodyPart(option.value)}
                  className={cn(
                    'rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                    uploadBodyPart === option.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              默认高亮全身，上传后会按所选分类保存到姿势库。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="aspect-[3/4] rounded-2xl border border-dashed border-border bg-secondary flex flex-col items-center justify-center gap-3 hover:border-primary/60"
            >
              {isUploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <Plus className="h-8 w-8 text-muted-foreground" />
              )}
              <span className="text-sm text-foreground">
                {isUploading ? '上传中...' : '上传姿势'}
              </span>
              <span className="rounded-full bg-background px-3 py-1 text-[11px] text-muted-foreground">
                {BODY_PART_LABELS[uploadBodyPart]}
              </span>
            </button>

            {filteredPoses.map((pose) => {
              const isSelected = draftSelectedIds.includes(pose.id)
              const isDisabled = !isSelected && atLimit
              return (
                <PoseCard
                  key={pose.id}
                  pose={pose}
                  selected={isSelected}
                  disabled={isDisabled}
                  onToggle={() => {
                    if (isDisabled) return
                    toggleSelected(pose.id)
                  }}
                  onRename={onRenamePose}
                  onDelete={onDeletePose}
                />
              )
            })}
          </div>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <span className="text-xs text-muted-foreground">
            已选 {selectedCount} / 最多 {MAX_POSE_SELECTION} 个
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-full border border-border px-6 py-2.5 text-sm text-foreground hover:border-primary/60"
            >
              重置
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedCount}
              className="rounded-full border border-primary bg-primary/10 px-6 py-2.5 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
            >
              确定（{selectedCount}）
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PoseCard({
  pose,
  selected,
  disabled,
  onToggle,
  onRename,
  onDelete,
}: {
  pose: SavedPose
  selected: boolean
  disabled: boolean
  onToggle: () => void
  onRename: (poseId: string, name: string) => void
  onDelete: (poseId: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(pose.name)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraftName(pose.name)
  }, [pose.name])

  useEffect(() => {
    if (!isEditing) return
    const handle = window.setTimeout(() => inputRef.current?.select(), 0)
    return () => window.clearTimeout(handle)
  }, [isEditing])

  const commitRename = () => {
    const next = draftName.trim()
    if (next && next !== pose.name) {
      onRename(pose.id, next)
    } else {
      setDraftName(pose.name)
    }
    setIsEditing(false)
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => {
        if (isEditing || showDeleteConfirm || disabled) return
        onToggle()
      }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-card text-left transition-colors',
        selected
          ? 'border-primary shadow-[0_0_0_1px_var(--primary)]'
          : disabled
            ? 'border-border opacity-40 cursor-not-allowed'
            : 'border-border hover:border-primary/60 cursor-pointer',
      )}
    >
      <div className="relative aspect-[3/4] bg-white">
        <img src={pose.url} alt={pose.name} className="h-full w-full object-cover object-top" />
        <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm">
          {BODY_PART_LABELS[pose.bodyPart]}
        </span>
      </div>

      <div className="px-3 py-3">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftName}
            maxLength={40}
            onChange={(event) => setDraftName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') commitRename()
              else if (event.key === 'Escape') setIsEditing(false)
            }}
            className="w-full rounded border border-primary bg-background px-2 py-1 text-xs text-foreground outline-none"
          />
        ) : (
          <p className="truncate text-sm font-medium text-foreground" title="双击重命名">
            {pose.name}
          </p>
        )}
      </div>

      {selected ? (
        <span className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-4 w-4" />
        </span>
      ) : null}

      {!disabled && (
        <div className="absolute left-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setIsEditing(true)
            }}
            title="重命名"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setShowDeleteConfirm(true)
            }}
            title="删除"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 text-center"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-xs text-foreground">删除这个姿势？</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:border-primary/60"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(false)
                onDelete(pose.id)
              }}
              className="rounded-full bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
