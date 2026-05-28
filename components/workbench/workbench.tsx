'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { FeatureSidebar } from './feature-sidebar'
import { LeftPanel } from './left-panel'
import { RightPanel } from './right-panel'
import { PoseLibraryDialog } from './pose-library-dialog'
import { useAuth } from '@/hooks/use-auth'
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
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading: isAuthLoading, error: authError, logout, refresh: refreshAuth } = useAuth()
  const [redirectingToLogin, setRedirectingToLogin] = useState(false)
  // 公网客户曾反复反馈「正在前往登录页」一直挂着不动 —— root cause 是 useAuth fetch
  // 短暂时网络抖动 / 等待 /api/auth/me 时，下方守卫把 !user 当成「准备跳转」状态展示，
  // 加上 useEffect 死命 router.replace('/login') 没做防抖，一卡就出不来。
  // 这里加一个「加载过久」标志位，6 秒兜底给客户一个明确的重试入口，避免无限等待。
  const [authStalled, setAuthStalled] = useState(false)
  const redirectFiredRef = useRef(false)
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

  useEffect(() => {
    const clearStaleModalLock = () => {
      const hasOpenDialog = document.querySelector('[role="dialog"][data-state="open"]')
      if (hasOpenDialog) return

      document.body.style.pointerEvents = ''
      document
        .querySelectorAll('[data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"]')
        .forEach((node) => node.remove())
    }

    clearStaleModalLock()
    const timeoutId = window.setTimeout(clearStaleModalLock, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  const redirectToLogin = useCallback(() => {
    // 防抖：避免重复 router.replace 把客户钉在 loading 文案上
    if (redirectFiredRef.current) return
    if (pathname === '/login') return
    redirectFiredRef.current = true
    setRedirectingToLogin(true)
    router.replace('/login')
    router.refresh()
  }, [pathname, router])

  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks', { cache: 'no-store' })
    if (response.status === 401) {
      redirectToLogin()
      return
    }
    if (!response.ok) return

    const data = (await response.json()) as { tasks: GenerationTask[] }
    setTasks(data.tasks)
  }, [redirectToLogin])

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
    if (response.status === 401) {
      redirectToLogin()
      return
    }
    if (!response.ok) return

    const task = (await response.json()) as GenerationTask
    setTasks((currentTasks) => {
      const existingIndex = currentTasks.findIndex((item) => item.taskId === task.taskId)

      if (existingIndex === -1) {
        return [task, ...currentTasks]
      }

      return currentTasks.map((item) => (item.taskId === task.taskId ? task : item))
    })
  }, [redirectToLogin])

  useEffect(() => {
    // 只有「已经确认未登录」（loading 结束 + 没拿到 user + 没有 error）才真的跳走。
    // 任何一项 loading 期间，下面的守卫视图会显示「正在加载工作台…」而不是误导性的
    // 「正在前往登录页」。
    if (isAuthLoading) return
    if (authError) return
    if (user) return
    redirectToLogin()
  }, [authError, isAuthLoading, redirectToLogin, user])

  // 加载兜底：如果 6 秒后还没拿到 user 也没出 error，就把客户从「未知 loading」里拉出来，
  // 给一个明确的「重试 / 去登录」入口。这条直接根治公网客户反复反馈「卡在正在前往登录页」。
  useEffect(() => {
    if (!isAuthLoading) {
      setAuthStalled(false)
      return
    }
    const timer = window.setTimeout(() => setAuthStalled(true), 6000)
    return () => window.clearTimeout(timer)
  }, [isAuthLoading])

  useEffect(() => {
    if (!user) return
    void loadTasks()
  }, [loadTasks, user])

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
    if (!user) return
    if (!activeTaskId) return

    const intervalId = window.setInterval(() => {
      void loadTask(activeTaskId)
    }, 900)

    void loadTask(activeTaskId)

    return () => window.clearInterval(intervalId)
  }, [activeTaskId, loadTask, user])

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
    if (!user) return
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
  }, [user])

  const handleLogout = useCallback(async () => {
    await logout()
    router.replace('/login')
    router.refresh()
  }, [logout, router])

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

  if (isAuthLoading || redirectingToLogin || !user || authError) {
    // 三态视图（彻底解决「文案误导客户」的顽疾）：
    //   1) authError —— 后端真的失败：显示错误 + 重试 / 去登录两个出口，绝不自动死循环
    //   2) redirectingToLogin —— 已确认未登录、router 已开始跳：显示「正在前往登录页」
    //   3) 其它（默认）—— 还在拉 /api/auth/me：显示「正在加载工作台…」
    // 6 秒后仍卡住 → authStalled = true，额外给客户「重试 / 去登录」两个手动出口。
    let title = '正在加载工作台…'
    let description = '请稍候，正在确认登录状态'
    if (authError) {
      title = '加载登录状态失败'
      description = authError
    } else if (redirectingToLogin) {
      title = '正在前往登录页'
      description = '请稍候…'
    } else if (authStalled) {
      title = '加载较慢，可手动重试'
      description = '网络可能不稳定，已为你准备了重试入口'
    }

    const showActions = Boolean(authError) || authStalled

    return (
      <main className="flex h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm rounded-md border border-border bg-card p-5">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          {showActions && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAuthStalled(false)
                  void refreshAuth()
                }}
                className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-secondary px-3 text-xs font-medium hover:bg-secondary/80"
              >
                重试
              </button>
              <button
                type="button"
                onClick={() => {
                  redirectFiredRef.current = false
                  redirectToLogin()
                }}
                className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                去登录
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-screen overflow-hidden bg-ice-blue-gradient">
      <FeatureSidebar
        activeFeature={currentFeature}
        onFeatureChange={setCurrentFeature}
        user={user}
        isAuthLoading={isAuthLoading}
        onLogout={handleLogout}
      />
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
