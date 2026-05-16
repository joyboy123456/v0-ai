'use client'

import { useCallback, useEffect, useState } from 'react'
import { FeatureSidebar } from './feature-sidebar'
import { LeftPanel } from './left-panel'
import { RightPanel } from './right-panel'
import { type FashionModel, type FeatureType, type GenerationTask, type PoseCase } from '@/lib/types'

export function Workbench() {
  const [currentFeature, setCurrentFeature] = useState<FeatureType>('ai-fashion-photo')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [selectedPoseCase, setSelectedPoseCase] = useState<PoseCase | null>(null)
  const [poseLibraryRequestKey, setPoseLibraryRequestKey] = useState(0)
  const [selectedFashionModel, setSelectedFashionModel] = useState<FashionModel | null>(null)
  const [fashionModelLibraryRequestKey, setFashionModelLibraryRequestKey] = useState(0)

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
        selectedFashionModel={selectedFashionModel}
        onOpenPoseLibrary={() => setPoseLibraryRequestKey((currentKey) => currentKey + 1)}
        onOpenFashionModelLibrary={() => setFashionModelLibraryRequestKey((currentKey) => currentKey + 1)}
        onFashionModelRemove={() => setSelectedFashionModel(null)}
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
        selectedFashionModelId={selectedFashionModel?.id ?? null}
        fashionModelLibraryRequestKey={fashionModelLibraryRequestKey}
        onSelectFashionModel={setSelectedFashionModel}
        onSelectPoseCase={setSelectedPoseCase}
        onSelectTask={setActiveTaskId}
        onRefreshTasks={loadTasks}
      />
    </main>
  )
}
