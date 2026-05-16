'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, Download, ImageIcon, RefreshCw, Star, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  FEATURE_LABELS,
  FASHION_MODELS,
  POSE_CASES,
  type FashionModel,
  type FashionModelAgeGroup,
  type FashionModelEthnicity,
  type FashionModelGender,
  type FashionModelHairColor,
  type FeatureType,
  type GenerationTask,
  type PoseCase,
  type ResultAsset,
  type TaskStatus,
} from '@/lib/types'

interface RightPanelProps {
  feature: FeatureType
  activeTask: GenerationTask | null
  tasks: GenerationTask[]
  selectedPoseCaseId: string | null
  poseLibraryRequestKey: number
  selectedFashionModelId: string | null
  fashionModelLibraryRequestKey: number
  onSelectFashionModel: (model: FashionModel) => void
  onSelectPoseCase: (poseCase: PoseCase) => void
  onSelectTask: (taskId: string) => void
  onRefreshTasks: () => void
}

export function RightPanel({
  feature,
  activeTask,
  tasks,
  selectedPoseCaseId,
  poseLibraryRequestKey,
  selectedFashionModelId,
  fashionModelLibraryRequestKey,
  onSelectFashionModel,
  onSelectPoseCase,
  onSelectTask,
  onRefreshTasks,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'current' | 'history' | 'cases' | 'model-library'>('current')
  const [previewImage, setPreviewImage] = useState<ResultAsset | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [modelFavorites, setModelFavorites] = useState<Set<string>>(new Set())
  const [onlyCurrentFeature, setOnlyCurrentFeature] = useState(true)
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [poseCases, setPoseCases] = useState<PoseCase[]>(POSE_CASES)

  const isPoseFission = feature === 'pose-fission'

  const currentFeatureTasks = useMemo(
    () => tasks.filter((task) => task.featureType === feature),
    [feature, tasks],
  )

  const visibleTask = activeTab === 'current' ? activeTask : currentFeatureTasks[0] ?? activeTask
  const results = visibleTask?.results ?? []

  useEffect(() => {
    setActiveTab(isPoseFission ? 'cases' : 'current')
  }, [isPoseFission])

  useEffect(() => {
    if (isPoseFission && poseLibraryRequestKey > 0) {
      setActiveTab('cases')
    }
  }, [isPoseFission, poseLibraryRequestKey])

  useEffect(() => {
    if (feature === 'ai-fashion-photo' && fashionModelLibraryRequestKey > 0) {
      setActiveTab('model-library')
    }
  }, [fashionModelLibraryRequestKey, feature])

  useEffect(() => {
    if (!isPoseFission) return

    let ignore = false

    async function loadPoseCases() {
      const response = await fetch('/api/pose-fission/cases', { cache: 'no-store' })
      if (!response.ok) return

      const data = (await response.json()) as { cases: PoseCase[] }
      if (!ignore) setPoseCases(data.cases)
    }

    void loadPoseCases()

    return () => {
      ignore = true
    }
  }, [isPoseFission])

  const handleBatchDownload = async () => {
    if (!visibleTask) return
    const response = await fetch(`/api/tasks/${visibleTask.taskId}/download`, {
      method: 'POST',
    })

    if (!response.ok) return

    const data = (await response.json()) as { downloadUrl: string }
    if (data.downloadUrl) window.open(data.downloadUrl, '_blank')
  }

  return (
    <section className="flex-1 min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between gap-4 p-5 border-b border-border">
        <div>
          <p className="text-xs text-muted-foreground">生成结果</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{FEATURE_LABELS[feature]}</h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-secondary rounded-full p-1">
            {!isPoseFission && (
              <button
                onClick={() => setActiveTab('current')}
                className={cn(
                  'px-4 py-1.5 text-sm rounded-full transition-colors',
                  activeTab === 'current'
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                当前任务
              </button>
            )}
            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                'px-4 py-1.5 text-sm rounded-full transition-colors',
                activeTab === 'history'
                  ? 'bg-card text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              历史记录
            </button>
            {isPoseFission && (
              <button
                onClick={() => setActiveTab('cases')}
                className={cn(
                  'px-4 py-1.5 text-sm rounded-full transition-colors',
                  activeTab === 'cases'
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                案例库
              </button>
            )}
          </div>

          {isPoseFission && activeTab === 'cases' && (
            <div className="flex items-center gap-4 pl-2 text-sm text-foreground">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyCurrentFeature}
                  onChange={(event) => setOnlyCurrentFeature(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                仅看当前功能
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyFavorites}
                  onChange={(event) => setOnlyFavorites(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                仅看收藏
              </label>
            </div>
          )}

          <button
            onClick={onRefreshTasks}
            className="w-9 h-9 rounded-full border border-border bg-secondary flex items-center justify-center hover:border-primary/60"
            aria-label="刷新任务"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {feature === 'ai-fashion-photo' && activeTab === 'model-library' ? (
        <FashionModelLibraryPanel
          models={FASHION_MODELS}
          favorites={modelFavorites}
          selectedModelId={selectedFashionModelId}
          onCancel={() => setActiveTab('current')}
          onClose={() => setActiveTab('current')}
          onConfirm={(model) => {
            onSelectFashionModel(model)
            setActiveTab('current')
          }}
          onToggleFavorite={(modelId) => {
            setModelFavorites((current) => {
              const next = new Set(current)
              if (next.has(modelId)) {
                next.delete(modelId)
              } else {
                next.add(modelId)
              }
              return next
            })
          }}
        />
      ) : isPoseFission && activeTab === 'cases' ? (
        <PoseCaseLibrary
          feature={feature}
          poseCases={poseCases}
          favorites={favorites}
          onlyCurrentFeature={onlyCurrentFeature}
          onlyFavorites={onlyFavorites}
          selectedPoseCaseId={selectedPoseCaseId}
          onSelectPoseCase={onSelectPoseCase}
          onToggleFavorite={(caseId) => {
            setFavorites((current) => {
              const next = new Set(current)
              if (next.has(caseId)) {
                next.delete(caseId)
              } else {
                next.add(caseId)
              }
              return next
            })
          }}
        />
      ) : activeTab === 'history' ? (
        <TaskHistory tasks={currentFeatureTasks} activeTaskId={activeTask?.taskId} onSelectTask={onSelectTask} />
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          {visibleTask ? (
            <div className="space-y-5">
              <TaskStatusCard task={visibleTask} onBatchDownload={handleBatchDownload} />

              {results.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  {results.map((image) => {
                    const isFavorite = favorites.has(image.assetId)

                    return (
                      <div
                        key={image.assetId}
                        className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-border bg-card cursor-pointer hover:border-primary/60"
                        onClick={() => setPreviewImage(image)}
                      >
                        <img src={image.url} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 p-3 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              setFavorites((current) => {
                                const next = new Set(current)
                                if (next.has(image.assetId)) {
                                  next.delete(image.assetId)
                                } else {
                                  next.add(image.assetId)
                                }
                                return next
                              })
                            }}
                            className="w-8 h-8 rounded-full bg-background/85 flex items-center justify-center"
                            aria-label="收藏"
                          >
                            <Star
                              className={cn(
                                'w-4 h-4',
                                isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground',
                              )}
                            />
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              window.open(image.downloadUrl, '_blank')
                            }}
                            className="w-8 h-8 rounded-full bg-background/85 flex items-center justify-center"
                            aria-label="下载"
                          >
                            <Download className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyResults status={visibleTask.status} />
              )}
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      )}

      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent showCloseButton={false} className="max-w-3xl bg-card border-border p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {previewImage && (
            <div className="relative">
              <img src={previewImage.url} alt="" className="w-full h-auto max-h-[82vh] object-contain" />
              <div className="absolute top-4 right-4 flex gap-2">
                <button
                  onClick={() => window.open(previewImage.downloadUrl, '_blank')}
                  className="w-10 h-10 rounded-full bg-background/80 flex items-center justify-center hover:bg-background"
                  aria-label="下载"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setPreviewImage(null)}
                  className="w-10 h-10 rounded-full bg-background/80 flex items-center justify-center hover:bg-background"
                  aria-label="关闭"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function PoseCaseLibrary({
  feature,
  poseCases,
  favorites,
  onlyCurrentFeature,
  onlyFavorites,
  selectedPoseCaseId,
  onSelectPoseCase,
  onToggleFavorite,
}: {
  feature: FeatureType
  poseCases: PoseCase[]
  favorites: Set<string>
  onlyCurrentFeature: boolean
  onlyFavorites: boolean
  selectedPoseCaseId: string | null
  onSelectPoseCase: (poseCase: PoseCase) => void
  onToggleFavorite: (caseId: string) => void
}) {
  const cases = poseCases.filter((poseCase) => {
    if (onlyCurrentFeature && poseCase.featureType !== feature) return false
    if (onlyFavorites && !favorites.has(poseCase.id)) return false
    return true
  })

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {cases.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          {cases.map((poseCase) => {
            const isFavorite = favorites.has(poseCase.id)
            const isSelected = selectedPoseCaseId === poseCase.id

            return (
              <div
                key={poseCase.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectPoseCase(poseCase)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectPoseCase(poseCase)
                  }
                }}
                className={cn(
                  'group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border bg-card text-left transition-colors',
                  isSelected ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-border hover:border-primary/60',
                )}
              >
                <img src={poseCase.imageUrl} alt={poseCase.name} className="h-full w-full object-cover" />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-background/85 px-2 py-1 text-[10px] text-foreground">
                  <ImageIcon className="h-3 w-3" />
                  姿势裂变
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleFavorite(poseCase.id)
                  }}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/85 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="收藏案例"
                >
                  <Star
                    className={cn(
                      'h-4 w-4',
                      isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground',
                    )}
                  />
                </button>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="text-sm font-medium text-white">{poseCase.name}</p>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="min-h-[420px] rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-center">
          <p className="text-lg text-foreground">暂无收藏案例</p>
          <p className="mt-2 max-w-[360px] text-sm text-muted-foreground">
            取消「仅看收藏」后选择喜欢的姿势案例。
          </p>
        </div>
      )}
    </div>
  )
}

function FashionModelLibraryPanel({
  models,
  favorites,
  selectedModelId,
  onCancel,
  onClose,
  onConfirm,
  onToggleFavorite,
}: {
  models: FashionModel[]
  favorites: Set<string>
  selectedModelId: string | null
  onCancel: () => void
  onClose: () => void
  onConfirm: (model: FashionModel) => void
  onToggleFavorite: (modelId: string) => void
}) {
  const [activeSource, setActiveSource] = useState<'featured' | 'mine'>('featured')
  const [gender, setGender] = useState<FashionModelGender | 'all'>('all')
  const [ageGroup, setAgeGroup] = useState<FashionModelAgeGroup | 'all'>('all')
  const [ethnicity, setEthnicity] = useState<FashionModelEthnicity | 'all'>('all')
  const [hairColor, setHairColor] = useState<FashionModelHairColor | 'all'>('all')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [draftSelectedId, setDraftSelectedId] = useState<string | null>(selectedModelId)

  const visibleModels = models.filter((model) => {
    if (model.source !== activeSource) return false
    if (gender !== 'all' && model.gender !== gender) return false
    if (ageGroup !== 'all' && model.ageGroup !== ageGroup) return false
    if (ethnicity !== 'all' && model.ethnicity !== ethnicity) return false
    if (hairColor !== 'all' && model.hairColor !== hairColor) return false
    if (onlyFavorites && !favorites.has(model.id) && !model.favorite) return false
    return true
  })
  const selectedModel = models.find((model) => model.id === draftSelectedId) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex rounded-full bg-secondary p-1">
            <button
              type="button"
              onClick={() => setActiveSource('featured')}
              className={cn(
                'rounded-full px-5 py-2 text-sm transition-colors',
                activeSource === 'featured' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              精选模特库
            </button>
            <button
              type="button"
              onClick={() => setActiveSource('mine')}
              className={cn(
                'rounded-full px-5 py-2 text-sm transition-colors',
                activeSource === 'mine' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              我的模特库
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="关闭模特库"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <ModelFilterSelect
          value={gender}
          options={[
            { id: 'all', label: '全部性别' },
            { id: 'female', label: '女装' },
            { id: 'male', label: '男装' },
          ]}
          onChange={(value) => setGender(value as FashionModelGender | 'all')}
        />
        <ModelFilterSelect
          value={ageGroup}
          options={[
            { id: 'all', label: '全部年龄' },
            { id: 'adult', label: '成人' },
            { id: 'teen', label: '青年' },
          ]}
          onChange={(value) => setAgeGroup(value as FashionModelAgeGroup | 'all')}
        />
        <ModelFilterSelect
          value={ethnicity}
          options={[
            { id: 'all', label: '全部族裔' },
            { id: 'east-asian', label: '东亚' },
            { id: 'white', label: '欧美' },
            { id: 'black', label: '黑肤色' },
            { id: 'latino', label: '拉丁' },
            { id: 'mixed', label: '混血' },
          ]}
          onChange={(value) => setEthnicity(value as FashionModelEthnicity | 'all')}
        />
        <ModelFilterSelect
          value={hairColor}
          options={[
            { id: 'all', label: '全部发色' },
            { id: 'black', label: '黑发' },
            { id: 'blonde', label: '金发' },
            { id: 'brown', label: '棕发' },
            { id: 'red', label: '红发' },
          ]}
          onChange={(value) => setHairColor(value as FashionModelHairColor | 'all')}
        />

        <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={onlyFavorites}
            onChange={(event) => setOnlyFavorites(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          仅看收藏
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {visibleModels.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
            {visibleModels.map((model) => {
              const isSelected = draftSelectedId === model.id
              const isFavorite = favorites.has(model.id) || Boolean(model.favorite)

              return (
                <div
                  key={model.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDraftSelectedId(model.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setDraftSelectedId(model.id)
                    }
                  }}
                  className={cn(
                    'group relative cursor-pointer overflow-hidden rounded-md border bg-card transition-colors',
                    isSelected ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-border hover:border-primary/60',
                  )}
                >
                  <div className="aspect-[4/3] bg-white">
                    <img src={model.previewUrl} alt={model.name} className="h-full w-full object-cover object-top" />
                  </div>
                  <div className="flex h-8 items-center justify-center bg-[#111111] px-2">
                    <p className="truncate text-xs font-medium text-foreground">{model.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleFavorite(model.id)
                    }}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/85 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="收藏模特"
                  >
                    <Star className={cn('h-4 w-4', isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
                  </button>
                  {isSelected && (
                    <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
            <p className="text-lg text-foreground">暂无可用模特</p>
            <p className="mt-2 max-w-[360px] text-sm text-muted-foreground">
              调整筛选条件后再试一次。
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="min-w-[116px] rounded-full border border-border px-7 py-3 text-sm text-foreground hover:border-primary/60"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => selectedModel && onConfirm(selectedModel)}
          disabled={!selectedModel}
          className="min-w-[116px] rounded-full border border-primary bg-primary/10 px-7 py-3 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          确定
        </button>
      </div>
    </div>
  )
}

function ModelFilterSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-md border border-border bg-secondary px-3 text-sm text-foreground outline-none hover:border-primary/60"
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function TaskStatusCard({
  task,
  onBatchDownload,
}: {
  task: GenerationTask
  onBatchDownload: () => void
}) {
  const isDone = task.status === 'success' || task.status === 'partial'

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="text-sm text-muted-foreground">{task.taskId}</span>
          </div>
          <p className="mt-2 text-sm text-foreground">{task.message}</p>
          {task.errorMessage && <p className="mt-1 text-sm text-destructive">{task.errorMessage}</p>}
        </div>

        <button
          onClick={onBatchDownload}
          disabled={!isDone || task.results.length === 0}
          className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          批量下载
        </button>
      </div>

      <div className="mt-4 h-2 rounded-full bg-secondary overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>进度 {task.progress}%</span>
        <span>额度 -{task.creditsUsed}</span>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const label = {
    pending: '等待中',
    running: '生成中',
    success: '成功',
    failed: '失败',
    partial: '部分成功',
  }[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs',
        status === 'success' && 'bg-primary/15 text-primary',
        status === 'running' && 'bg-blue-500/15 text-blue-300',
        status === 'pending' && 'bg-muted text-muted-foreground',
        status === 'failed' && 'bg-destructive/15 text-destructive',
        status === 'partial' && 'bg-yellow-500/15 text-yellow-300',
      )}
    >
      {status === 'success' && <CheckCircle2 className="w-3 h-3" />}
      {label}
    </span>
  )
}

function TaskHistory({
  tasks,
  activeTaskId,
  onSelectTask,
}: {
  tasks: GenerationTask[]
  activeTaskId?: string
  onSelectTask: (taskId: string) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      {tasks.length > 0 ? (
        <div className="space-y-3">
          {tasks.map((task) => (
            <button
              key={task.taskId}
              onClick={() => onSelectTask(task.taskId)}
              className={cn(
                'w-full rounded-lg border bg-card p-4 text-left hover:border-primary/60',
                activeTaskId === task.taskId ? 'border-primary' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <StatusBadge status={task.status} />
                <span className="text-xs text-muted-foreground">
                  {new Date(task.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground">{FEATURE_LABELS[task.featureType]}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {task.results.length} 张结果 · 消耗 {task.creditsUsed} 点
              </p>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}

function EmptyResults({ status }: { status: TaskStatus }) {
  return (
    <div className="min-h-[360px] rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-center">
      <p className="text-base text-foreground">{status === 'failed' ? '任务失败，没有可用结果' : '结果生成中'}</p>
      <p className="mt-2 max-w-[360px] text-sm text-muted-foreground">
        任务完成后会在这里展示生成图片，可预览、收藏、下载使用。
      </p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="min-h-[520px] rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-center">
      <p className="text-lg text-foreground">先创建一个生成任务</p>
      <p className="mt-2 max-w-[420px] text-sm text-muted-foreground">
        上传服装图片，选择参数并点击立即生成。MVP 会创建异步任务，并通过第三方图片 API 适配层返回结果。
      </p>
    </div>
  )
}
