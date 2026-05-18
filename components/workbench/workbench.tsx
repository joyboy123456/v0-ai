'use client'

import { useCallback, useEffect, useState } from 'react'
import { FeatureSidebar } from './feature-sidebar'
import { LeftPanel } from './left-panel'
import { RightPanel } from './right-panel'
import {
  type CompanyModel,
  type FashionReferenceImage,
  type FashionRemixRequest,
  type FeatureType,
  type GenerationTask,
  type PhotoFissionCase,
  type PoseCase,
} from '@/lib/types'

const companyModelsStorageKey = 'fashion_company_models'
const maxFashionReferences = 10

export function Workbench() {
  const [currentFeature, setCurrentFeature] = useState<FeatureType>('ai-fashion-photo')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [selectedPoseCase, setSelectedPoseCase] = useState<PoseCase | null>(null)
  const [poseLibraryRequestKey, setPoseLibraryRequestKey] = useState(0)
  const [companyModelLibraryRequestKey, setCompanyModelLibraryRequestKey] = useState(0)
  const [companyModels, setCompanyModels] = useState<CompanyModel[]>([])
  const [companyModelsHydrated, setCompanyModelsHydrated] = useState(false)
  const [fashionReferences, setFashionReferences] = useState<FashionReferenceImage[]>([])
  const [fashionRemixRequest, setFashionRemixRequest] = useState<FashionRemixRequest | null>(null)
  const [photoFissionCaseRequest, setPhotoFissionCaseRequest] = useState<{
    requestId: number
    case: PhotoFissionCase
  } | null>(null)

  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks', { cache: 'no-store' })
    if (!response.ok) return

    const data = (await response.json()) as { tasks: GenerationTask[] }
    setTasks(data.tasks)
  }, [])

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

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      <FeatureSidebar activeFeature={currentFeature} onFeatureChange={setCurrentFeature} />
      <LeftPanel
        feature={currentFeature}
        selectedPoseCase={selectedPoseCase}
        companyModels={companyModels}
        fashionReferences={fashionReferences}
        fashionRemixRequest={fashionRemixRequest}
        photoFissionCaseRequest={photoFissionCaseRequest}
        onAddFashionReference={handleAddFashionReference}
        onRemoveFashionReference={handleRemoveFashionReference}
        onOpenCompanyModelLibrary={() => setCompanyModelLibraryRequestKey((currentKey) => currentKey + 1)}
        onOpenPoseLibrary={() => setPoseLibraryRequestKey((currentKey) => currentKey + 1)}
        onTaskCreated={(taskId) => {
          setActiveTaskId(taskId)
          void loadTask(taskId)
        }}
      />
      <RightPanel
        feature={currentFeature}
        activeTask={activeTask}
        tasks={tasks}
        selectedPoseCaseId={selectedPoseCase?.id ?? null}
        poseLibraryRequestKey={poseLibraryRequestKey}
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
        onSelectPoseCase={setSelectedPoseCase}
        onSelectPhotoFissionCase={handleSelectPhotoFissionCase}
        onSelectTask={setActiveTaskId}
        onRefreshTasks={loadTasks}
      />
    </main>
  )
}
