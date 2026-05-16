'use client'

import { useCallback, useEffect, useState } from 'react'
import { FeatureSidebar } from './feature-sidebar'
import { LeftPanel } from './left-panel'
import { RightPanel } from './right-panel'
import { type CompanyModel, type FeatureType, type GenerationTask, type PoseCase } from '@/lib/types'

const companyModelsStorageKey = 'fashion_company_models'

export function Workbench() {
  const [currentFeature, setCurrentFeature] = useState<FeatureType>('ai-fashion-photo')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [selectedPoseCase, setSelectedPoseCase] = useState<PoseCase | null>(null)
  const [poseLibraryRequestKey, setPoseLibraryRequestKey] = useState(0)
  const [companyModelLibraryRequestKey, setCompanyModelLibraryRequestKey] = useState(0)
  const [companyModels, setCompanyModels] = useState<CompanyModel[]>(() => {
    if (typeof window === 'undefined') return []

    try {
      const storedModels = window.localStorage.getItem(companyModelsStorageKey)
      return storedModels ? JSON.parse(storedModels) as CompanyModel[] : []
    } catch {
      return []
    }
  })
  const [selectedCompanyModel, setSelectedCompanyModel] = useState<CompanyModel | null>(null)

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
    window.localStorage.setItem(companyModelsStorageKey, JSON.stringify(companyModels))
  }, [companyModels])

  useEffect(() => {
    if (!activeTaskId) return

    const intervalId = window.setInterval(() => {
      void loadTask(activeTaskId)
    }, 900)

    void loadTask(activeTaskId)

    return () => window.clearInterval(intervalId)
  }, [activeTaskId, loadTask])

  const activeTask = tasks.find((task) => task.taskId === activeTaskId) ?? null

  return (
    <main className="flex min-h-screen bg-background">
      <FeatureSidebar activeFeature={currentFeature} onFeatureChange={setCurrentFeature} />
      <LeftPanel
        feature={currentFeature}
        selectedPoseCase={selectedPoseCase}
        companyModels={companyModels}
        selectedCompanyModel={selectedCompanyModel}
        onSelectCompanyModel={setSelectedCompanyModel}
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
        selectedCompanyModelId={selectedCompanyModel?.assetId ?? null}
        companyModelLibraryRequestKey={companyModelLibraryRequestKey}
        onAddCompanyModel={(model) => {
          setCompanyModels((currentModels) => {
            if (currentModels.some((item) => item.assetId === model.assetId)) return currentModels
            return [model, ...currentModels]
          })
        }}
        onSelectCompanyModel={setSelectedCompanyModel}
        onSelectPoseCase={setSelectedPoseCase}
        onSelectTask={setActiveTaskId}
        onRefreshTasks={loadTasks}
      />
    </main>
  )
}
