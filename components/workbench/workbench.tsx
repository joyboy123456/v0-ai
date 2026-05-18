'use client'

import { useCallback, useEffect, useState } from 'react'
import { FeatureSidebar } from './feature-sidebar'
import { LeftPanel } from './left-panel'
import { RightPanel } from './right-panel'
import { PoseLibraryDialog } from './pose-library-dialog'
import {
  type CompanyModel,
  type FashionReferenceImage,
  type FashionRemixRequest,
  type FeatureType,
  type GenerationTask,
  type PhotoFissionCase,
  type PoseFissionCase,
  type PoseTemplate,
} from '@/lib/types'

const companyModelsStorageKey = 'fashion_company_models'
const maxFashionReferences = 10

export function Workbench() {
  const [currentFeature, setCurrentFeature] = useState<FeatureType>('ai-fashion-photo')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  // PR3：升级为「已选姿势模板数组」，告别 PR1 阶段 selectedPoseFissionCase 兜底单选。
  const [selectedPoseTemplates, setSelectedPoseTemplates] = useState<PoseTemplate[]>([])
  const [poseTemplates, setPoseTemplates] = useState<PoseTemplate[]>([])
  const [poseLibraryDialogOpen, setPoseLibraryDialogOpen] = useState(false)
  const [poseFavorites, setPoseFavorites] = useState<Set<string>>(new Set())
  const [companyModelLibraryRequestKey, setCompanyModelLibraryRequestKey] = useState(0)
  const [companyModels, setCompanyModels] = useState<CompanyModel[]>([])
  const [companyModelsHydrated, setCompanyModelsHydrated] = useState(false)
  const [fashionReferences, setFashionReferences] = useState<FashionReferenceImage[]>([])
  const [fashionRemixRequest, setFashionRemixRequest] = useState<FashionRemixRequest | null>(null)
  const [photoFissionCaseRequest, setPhotoFissionCaseRequest] = useState<{
    requestId: number
    case: PhotoFissionCase
  } | null>(null)
  // PR4：派发「一键做同款」的 pose-fission 案例，参考 photoFissionCaseRequest 模式。
  // LeftPanel 在 useEffect 中消费此 request 完成回填，包括把 case 的 poseTemplateIds
  // 解为 PoseTemplate[] 并通过 onChangeSelectedPoseTemplates 回写到 workbench。
  const [poseFissionCaseRequest, setPoseFissionCaseRequest] = useState<{
    requestId: number
    case: PoseFissionCase
  } | null>(null)

  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks', { cache: 'no-store' })
    if (!response.ok) return

    const data = (await response.json()) as { tasks: GenerationTask[] }
    setTasks(data.tasks)
  }, [])

  // 从右侧瀑布流 / 案例库 hover 操作里删单张「效果不好的」生成图。
  // 后端会同步把 task.results 中对应条目移除（删空整个 task 也会被一起删），
  // 前端这里只需做乐观更新 + 兜底 reload。
  const handleDeleteTaskResult = useCallback(
    async (taskId: string, assetId: string) => {
      const response = await fetch(
        `/api/tasks/${taskId}/results/${assetId}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(data.error ?? `删除失败：HTTP ${response.status}`)
      }

      setTasks((currentTasks) => {
        const next: GenerationTask[] = []
        for (const task of currentTasks) {
          if (task.taskId !== taskId) {
            next.push(task)
            continue
          }
          const filteredResults = task.results.filter(
            (item) => item.assetId !== assetId,
          )
          const filteredIds = task.resultAssetIds.filter((id) => id !== assetId)
          // 与后端保持一致：task 删空 → 整 task 一起从前端列表里去掉
          if (filteredResults.length === 0 && filteredIds.length === 0) {
            continue
          }
          next.push({
            ...task,
            results: filteredResults,
            resultAssetIds: filteredIds,
          })
        }
        return next
      })

      // 如果当前选中的就是这个 task 且已被删空，清掉 activeTaskId 以触发空状态
      setActiveTaskId((current) => (current === taskId ? null : current))
    },
    [],
  )

  const loadTask = useCallback(async (taskId: string) => {
    const response = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' })
    if (!response.ok) return

    const task = (await response.json()) as GenerationTask
    setTasks((currentTasks) => {
      const existingIndex = currentTasks.findIndex((item) => item.taskId === task.taskId)

      if (existingIndex === -1) {
        return [task, ...currentTasks]
      }

      return currentTasks.map((item) => (item.taskId === task.taskId ? task : item))
    })
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    try {
      const storedModels = window.localStorage.getItem(companyModelsStorageKey)
      if (storedModels) {
        const parsed = JSON.parse(storedModels) as CompanyModel[]
        // A-fix: 过滤掉历史 blob URL 残留（之前用 URL.createObjectURL，刷新即失效），
        // 只保留指向 server 的稳定 URL（/generated/...、http(s)://、data:）。
        const validModels = Array.isArray(parsed)
          ? parsed.filter((model) => {
              if (!model || typeof model.preview !== 'string') return false
              if (model.preview.startsWith('blob:')) return false
              return true
            })
          : []
        setCompanyModels(validModels)
      }
    } catch {
      // ignore unreadable storage
    } finally {
      setCompanyModelsHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!companyModelsHydrated) return
    window.localStorage.setItem(companyModelsStorageKey, JSON.stringify(companyModels))
  }, [companyModels, companyModelsHydrated])

  useEffect(() => {
    if (!activeTaskId) return

    const intervalId = window.setInterval(() => {
      void loadTask(activeTaskId)
    }, 900)

    void loadTask(activeTaskId)

    return () => window.clearInterval(intervalId)
  }, [activeTaskId, loadTask])

  const activeTask = tasks.find((task) => task.taskId === activeTaskId) ?? null

  const handleAddFashionReference = useCallback((reference: FashionReferenceImage) => {
    setFashionReferences((currentReferences) => {
      if (currentReferences.some((item) => item.assetId === reference.assetId)) {
        return currentReferences
      }
      if (currentReferences.length >= maxFashionReferences) {
        return currentReferences
      }
      return [...currentReferences, reference]
    })
  }, [])

  const handleRemoveFashionReference = useCallback((assetId: string) => {
    setFashionReferences((currentReferences) =>
      currentReferences.filter((item) => item.assetId !== assetId),
    )
  }, [])

  const handleUseTaskAsFashionReference = useCallback((task: GenerationTask) => {
    if (task.featureType !== 'ai-fashion-photo') return

    const nextReferences =
      task.inputAssets?.slice(0, maxFashionReferences).map((asset) => ({
        assetId: asset.assetId,
        source: 'upload' as const,
        preview: asset.fileUrl,
        name: asset.fileName,
        width: asset.width,
        height: asset.height,
      })) ?? []

    setCurrentFeature('ai-fashion-photo')
    setActiveTaskId(task.taskId)
    setFashionReferences(nextReferences)
    setFashionRemixRequest({
      requestId: Date.now(),
      task,
    })
  }, [])

  // 切到 photo-fission 并把案例参数派发给 LeftPanel 自动回填；不会自动触发生成，
  // 用户仍需点「立即生成」复刻。
  const handleSelectPhotoFissionCase = useCallback((photoFissionCase: PhotoFissionCase) => {
    setCurrentFeature('photo-fission')
    setPhotoFissionCaseRequest({ requestId: Date.now(), case: photoFissionCase })
  }, [])

  // PR4：与 photo-fission 同样的派发模式：切到 pose-fission，构造一个 requestId
  // 派发 case 给 LeftPanel，由 LeftPanel 在 useEffect 内回填 model/比例/分辨率
  // 并通过 onChangeSelectedPoseTemplates 回写已选模板。
  const handleSelectPoseFissionCase = useCallback((poseFissionCase: PoseFissionCase) => {
    setCurrentFeature('pose-fission')
    setPoseFissionCaseRequest({ requestId: Date.now(), case: poseFissionCase })
  }, [])

  // PR3：组件挂载时一次性 fetch templates，避免 LeftPanel / RightPanel 各自重复请求。
  // 失败时静默 fallback，等到用户切到 pose-fission 再走 retry（PR4 会做更优雅的 UX）。
  useEffect(() => {
    let cancelled = false

    async function loadPoseTemplates() {
      try {
        const response = await fetch('/api/pose-fission/templates', { cache: 'no-store' })
        if (!response.ok) return
        const data = (await response.json()) as { templates: PoseTemplate[] }
        if (cancelled) return
        if (Array.isArray(data.templates)) setPoseTemplates(data.templates)
      } catch {
        // 静默失败：用户切到 pose-fission 时如果数组为空，会看到 Modal 空状态
      }
    }

    void loadPoseTemplates()
    return () => {
      cancelled = true
    }
  }, [])

  const handleConfirmPoseLibrary = useCallback((selectedTemplates: PoseTemplate[]) => {
    setSelectedPoseTemplates(selectedTemplates)
    setPoseLibraryDialogOpen(false)
  }, [])

  const handleTogglePoseFavorite = useCallback((templateId: string) => {
    setPoseFavorites((current) => {
      const next = new Set(current)
      if (next.has(templateId)) {
        next.delete(templateId)
      } else {
        next.add(templateId)
      }
      return next
    })
  }, [])

  // PR4：PoseFissionCaseLibrary 不再做单选高亮，case 卡片直接点「做同款」派发 request。
  // PR1/PR3 阶段的 selectedPoseFissionCaseId 兜底已可移除。

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      <FeatureSidebar activeFeature={currentFeature} onFeatureChange={setCurrentFeature} />
      <LeftPanel
        feature={currentFeature}
        selectedPoseTemplates={selectedPoseTemplates}
        companyModels={companyModels}
        fashionReferences={fashionReferences}
        fashionRemixRequest={fashionRemixRequest}
        photoFissionCaseRequest={photoFissionCaseRequest}
        poseFissionCaseRequest={poseFissionCaseRequest}
        onChangeSelectedPoseTemplates={setSelectedPoseTemplates}
        onAddFashionReference={handleAddFashionReference}
        onRemoveFashionReference={handleRemoveFashionReference}
        onOpenCompanyModelLibrary={() => setCompanyModelLibraryRequestKey((currentKey) => currentKey + 1)}
        onOpenPoseLibrary={() => setPoseLibraryDialogOpen(true)}
        onTaskCreated={(taskId) => {
          setActiveTaskId(taskId)
          void loadTask(taskId)
        }}
      />
      <RightPanel
        feature={currentFeature}
        activeTask={activeTask}
        tasks={tasks}
        companyModels={companyModels}
        fashionReferences={fashionReferences}
        companyModelLibraryRequestKey={companyModelLibraryRequestKey}
        onAddCompanyModel={(model) => {
          setCompanyModels((currentModels) => {
            if (currentModels.some((item) => item.assetId === model.assetId)) return currentModels
            return [model, ...currentModels]
          })
        }}
        onDeleteCompanyModel={(assetId) => {
          setCompanyModels((currentModels) =>
            currentModels.filter((item) => item.assetId !== assetId),
          )
        }}
        onRenameCompanyModel={(assetId, name) => {
          setCompanyModels((currentModels) =>
            currentModels.map((item) =>
              item.assetId === assetId ? { ...item, name } : item,
            ),
          )
        }}
        onAddFashionReference={handleAddFashionReference}
        onUseTaskAsFashionReference={handleUseTaskAsFashionReference}
        onSelectPoseFissionCase={handleSelectPoseFissionCase}
        onSelectPhotoFissionCase={handleSelectPhotoFissionCase}
        onSelectTask={setActiveTaskId}
        onRefreshTasks={loadTasks}
        onDeleteTaskResult={handleDeleteTaskResult}
      />
      <PoseLibraryDialog
        open={poseLibraryDialogOpen}
        onOpenChange={setPoseLibraryDialogOpen}
        templates={poseTemplates}
        favorites={poseFavorites}
        initialSelectedIds={selectedPoseTemplates.map((tpl) => tpl.id)}
        onToggleFavorite={handleTogglePoseFavorite}
        onConfirm={handleConfirmPoseLibrary}
      />
    </main>
  )
}
