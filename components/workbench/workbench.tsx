'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { FeatureSidebar } from './feature-sidebar'
import { LeftPanel } from './left-panel'
import { MobileShell } from './mobile-shell'
import { RightPanel } from './right-panel'
import { BrandLoader } from '@/components/ui/brand-loader'
import { useAuth } from '@/hooks/use-auth'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  type CompanyModel,
  type FashionReferenceImage,
  type FashionRemixRequest,
  type FeatureType,
  type GenerationTask,
  type PhotoFissionCase,
  type SavedPose,
} from '@/lib/types'

const companyModelsStorageKey = 'fashion_company_models'
const faceIdModelsStorageKey = 'fashion_face_id_models'
const maxFashionReferences = 10

function isTaskInFlight(task: GenerationTask) {
  return task.status === 'pending' || task.status === 'running'
}

function releaseBlobPreview(preview: string | undefined) {
  if (preview?.startsWith('blob:')) {
    URL.revokeObjectURL(preview)
  }
}

/**
 * 读取并清洗 legacy localStorage 模特列表（存量迁移用）。
 * 沿用历史规则：必须是数组、preview 为字符串、丢弃 `blob:` 临时预览。
 */
function readLegacyModels(storageKey: string): CompanyModel[] {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (!stored) return []
    const parsed = JSON.parse(stored) as CompanyModel[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((model) => {
      if (!model || typeof model.preview !== 'string') return false
      if (model.preview.startsWith('blob:')) return false
      return true
    })
  } catch {
    return []
  }
}

/**
 * 把 legacy 列表合并上传到服务端（幂等，按 assetId 去重）。
 * 成功返回合并后的服务端列表；失败返回 null（调用方据此决定是否清本地键）。
 */
async function syncLegacyModels(
  library: 'company' | 'faceId',
  models: CompanyModel[],
): Promise<CompanyModel[] | null> {
  try {
    const response = await fetch('/api/models/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ library, models }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { models?: CompanyModel[] }
    return Array.isArray(data.models) ? data.models : null
  } catch {
    return null
  }
}

export function Workbench() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading: isAuthLoading, error: authError, logout, refresh: refreshAuth } = useAuth()
  const isMobile = useIsMobile()
  // 手机版创作表单滑层：首次打开才挂载 LeftPanel（省首屏），之后常驻 DOM 保留表单输入
  const [mobileFormOpen, setMobileFormOpen] = useState(false)
  const [mobileFormMounted, setMobileFormMounted] = useState(false)
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
  const tasksRef = useRef<GenerationTask[]>([])
  const taskRequestSequenceRef = useRef(0)
  const latestTaskResponseRef = useRef(new Map<string, number>())
  const [tasksLoading, setTasksLoading] = useState(false)
  // 历史任务分页：记录服务端已加载条数（offset 基准）、总数与是否还有下一页
  const tasksOffsetRef = useRef(0)
  const [tasksTotal, setTasksTotal] = useState(0)
  const [tasksHasMore, setTasksHasMore] = useState(false)
  const [tasksLoadingMore, setTasksLoadingMore] = useState(false)
  const [savedPoses, setSavedPoses] = useState<SavedPose[]>([])
  const [selectedPoses, setSelectedPoses] = useState<SavedPose[]>([])
  const [companyModelLibraryRequestKey, setCompanyModelLibraryRequestKey] = useState(0)
  const [companyModels, setCompanyModels] = useState<CompanyModel[]>([])
  const [faceIdLibraryRequestKey, setFaceIdLibraryRequestKey] = useState(0)
  const [faceIdModels, setFaceIdModels] = useState<CompanyModel[]>([])
  const [selectedFaceIdModel, setSelectedFaceIdModel] = useState<CompanyModel | null>(null)
  const [fashionReferences, setFashionReferences] = useState<FashionReferenceImage[]>([])
  const [fashionRemixRequest, setFashionRemixRequest] = useState<FashionRemixRequest | null>(null)
  const [photoFissionCaseRequest, setPhotoFissionCaseRequest] = useState<{
    requestId: number
    case: PhotoFissionCase
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

  // 全局兜底：文件拖到非放置区时阻止浏览器默认行为（直接导航打开图片、丢失页面状态）。
  // 仅拦截文件拖拽，不影响文本拖入输入框；放置区自身的 preventDefault 不受影响
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const preventFileDropNavigation = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    window.addEventListener('dragover', preventFileDropNavigation)
    window.addEventListener('drop', preventFileDropNavigation)
    return () => {
      window.removeEventListener('dragover', preventFileDropNavigation)
      window.removeEventListener('drop', preventFileDropNavigation)
    }
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

  const TASKS_PAGE_SIZE = 20

  const loadTasks = useCallback(async () => {
    const requestSequence = ++taskRequestSequenceRef.current
    setTasksLoading(true)
    try {
      // 只拉当前功能的第一页，避免历史任务几千个时首屏 JSON 十几 MB
      const response = await fetch(
        `/api/tasks?featureType=${currentFeature}&offset=0&limit=${TASKS_PAGE_SIZE}`,
        { cache: 'no-store' },
      )
      if (response.status === 401) {
        redirectToLogin()
        return
      }
      if (!response.ok) return

      const data = (await response.json()) as {
        tasks: GenerationTask[]
        total: number
        hasMore: boolean
      }
      tasksOffsetRef.current = data.tasks.length
      setTasksTotal(data.total)
      setTasksHasMore(data.hasMore)
      setTasks((currentTasks) => {
        const currentById = new Map(currentTasks.map((task) => [task.taskId, task]))
        const serverTaskIds = new Set(data.tasks.map((task) => task.taskId))
        const nextTasks = data.tasks.map((task) => {
          const latestSequence = latestTaskResponseRef.current.get(task.taskId) ?? 0
          if (latestSequence > requestSequence) {
            return currentById.get(task.taskId) ?? task
          }
          latestTaskResponseRef.current.set(task.taskId, requestSequence)
          return task
        })

        for (const task of currentTasks) {
          if (
            !serverTaskIds.has(task.taskId) &&
            (latestTaskResponseRef.current.get(task.taskId) ?? 0) > requestSequence
          ) {
            nextTasks.push(task)
          }
        }
        return nextTasks
      })
    } finally {
      setTasksLoading(false)
    }
  }, [currentFeature, redirectToLogin])

  // 加载历史任务下一页（追加 + 按 taskId 去重，offset 以服务端已加载条数为准）
  const loadMoreTasks = useCallback(async () => {
    if (tasksLoadingMore) return
    setTasksLoadingMore(true)
    try {
      const offset = tasksOffsetRef.current
      const response = await fetch(
        `/api/tasks?featureType=${currentFeature}&offset=${offset}&limit=${TASKS_PAGE_SIZE}`,
        { cache: 'no-store' },
      )
      if (!response.ok) return

      const data = (await response.json()) as {
        tasks: GenerationTask[]
        total: number
        hasMore: boolean
      }
      tasksOffsetRef.current = offset + data.tasks.length
      setTasksTotal(data.total)
      setTasksHasMore(data.hasMore)
      setTasks((currentTasks) => {
        const seen = new Set(currentTasks.map((task) => task.taskId))
        return [...currentTasks, ...data.tasks.filter((task) => !seen.has(task.taskId))]
      })
    } finally {
      setTasksLoadingMore(false)
    }
  }, [currentFeature, tasksLoadingMore])

  // 从右侧图片卡片或详情弹窗删除单张「效果不好的」生成图。
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

      const currentTask = tasksRef.current.find((task) => task.taskId === taskId)
      const willRemoveTask = currentTask
        ? currentTask.results.filter((item) => item.assetId !== assetId).length === 0 &&
          currentTask.resultAssetIds.filter((id) => id !== assetId).length === 0
        : false
      latestTaskResponseRef.current.set(taskId, ++taskRequestSequenceRef.current)

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

      if (willRemoveTask) {
        setActiveTaskId((current) => (current === taskId ? null : current))
      }
    },
    [],
  )

  const handleCancelTask = useCallback(
    async (taskId: string) => {
      const response = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(data.error ?? `取消任务失败：HTTP ${response.status}`)
      }

      const task = (await response.json()) as GenerationTask
      latestTaskResponseRef.current.set(task.taskId, ++taskRequestSequenceRef.current)
      setTasks((currentTasks) =>
        currentTasks.map((item) =>
          item.taskId === task.taskId ? task : item,
        ),
      )
    },
    [],
  )

  const loadTask = useCallback(async (taskId: string) => {
    const requestSequence = ++taskRequestSequenceRef.current
    const response = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' })
    if (response.status === 401) {
      redirectToLogin()
      return
    }
    if (!response.ok) return

    const task = (await response.json()) as GenerationTask
    if ((latestTaskResponseRef.current.get(taskId) ?? 0) > requestSequence) return
    latestTaskResponseRef.current.set(taskId, requestSequence)
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
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    if (!user) return
    void loadTasks()
  }, [loadTasks, user])

  useEffect(() => {
    if (!user || !activeTaskId) return
    void loadTask(activeTaskId)
  }, [activeTaskId, loadTask, user])

  useEffect(() => {
    if (!user) return

    const loadInFlightTasks = () => {
      const taskIds = new Set(
        tasksRef.current
          .filter(isTaskInFlight)
          .map((task) => task.taskId),
      )
      if (
        activeTaskId &&
        !tasksRef.current.some((task) => task.taskId === activeTaskId)
      ) {
        taskIds.add(activeTaskId)
      }

      for (const taskId of taskIds) {
        void loadTask(taskId)
      }
    }

    const intervalId = window.setInterval(loadInFlightTasks, 3000)
    loadInFlightTasks()
    return () => window.clearInterval(intervalId)
  }, [activeTaskId, loadTask, user])

  const activeTask = tasks.find((task) => task.taskId === activeTaskId) ?? null

  const handleAddFashionReference = useCallback((reference: FashionReferenceImage) => {
    setFashionReferences((currentReferences) => {
      const existingReference = currentReferences.find(
        (item) => item.assetId === reference.assetId,
      )
      if (existingReference) {
        if (
          reference.source === 'upload' &&
          existingReference.preview !== reference.preview
        ) {
          releaseBlobPreview(reference.preview)
        }
        return currentReferences
      }
      if (currentReferences.length >= maxFashionReferences) {
        if (reference.source === 'upload') releaseBlobPreview(reference.preview)
        return currentReferences
      }
      return [...currentReferences, reference]
    })
  }, [])

  const handleRemoveFashionReference = useCallback((assetId: string) => {
    setFashionReferences((currentReferences) => {
      const removedReference = currentReferences.find((item) => item.assetId === assetId)
      if (removedReference?.source === 'upload') {
        releaseBlobPreview(removedReference.preview)
      }
      return currentReferences.filter((item) => item.assetId !== assetId)
    })
  }, [])

  const handleReplaceFashionReference = useCallback(
    (sourceAssetId: string, reference: FashionReferenceImage) => {
      setFashionReferences((currentReferences) =>
        currentReferences.map((currentReference) => {
          if (currentReference.assetId !== sourceAssetId) return currentReference
          if (
            currentReference.source === 'upload' &&
            currentReference.preview !== reference.preview
          ) {
            releaseBlobPreview(currentReference.preview)
          }
          return reference
        }),
      )
    },
    [],
  )

  const handleReorderFashionReferences = useCallback(
    (orderedAssetIds: string[]) => {
      setFashionReferences((currentReferences) => {
        const referencesById = new Map(
          currentReferences.map((reference) => [reference.assetId, reference]),
        )
        const orderedReferences: FashionReferenceImage[] = []
        const seenAssetIds = new Set<string>()

        for (const assetId of orderedAssetIds) {
          const reference = referencesById.get(assetId)
          if (!reference || seenAssetIds.has(assetId)) continue
          orderedReferences.push(reference)
          seenAssetIds.add(assetId)
        }

        for (const reference of currentReferences) {
          if (!seenAssetIds.has(reference.assetId)) {
            orderedReferences.push(reference)
          }
        }

        if (
          orderedReferences.every(
            (reference, index) =>
              reference.assetId === currentReferences[index]?.assetId,
          )
        ) {
          return currentReferences
        }
        return orderedReferences
      })
    },
    [],
  )

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
    setFashionReferences((currentReferences) => {
      currentReferences.forEach((reference) => {
        if (reference.source === 'upload') releaseBlobPreview(reference.preview)
      })
      return nextReferences
    })
    setFashionRemixRequest({
      requestId: Date.now(),
      task,
    })
  }, [])

  const handleSelectPhotoFissionCase = useCallback((photoFissionCase: PhotoFissionCase) => {
    setCurrentFeature('photo-fission')
    setPhotoFissionCaseRequest({ requestId: Date.now(), case: photoFissionCase })
  }, [])

  const handleLogout = useCallback(async () => {
    await logout()
    router.replace('/login')
    router.refresh()
  }, [logout, router])

  // 手机版：打开滑层时顺带把 LeftPanel 挂载标记置位（懒挂载只需一次）
  const handleMobileFormOpenChange = useCallback((open: boolean) => {
    if (open) setMobileFormMounted(true)
    setMobileFormOpen(open)
  }, [])

  const loadPoses = useCallback(async () => {
    if (!user) return
    try {
      const response = await fetch('/api/poses', { cache: 'no-store' })
      if (!response.ok) return
      const data = (await response.json()) as { poses?: SavedPose[] }
      if (!Array.isArray(data.poses)) return
      setSavedPoses(data.poses)
      setSelectedPoses((current) =>
        current.filter((pose) => data.poses?.some((item) => item.id === pose.id)),
      )
    } catch {
      // ignore pose library load failure; empty state will surface in UI
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    void loadPoses()
  }, [loadPoses, user])

  const handleAddPose = useCallback((pose: SavedPose) => {
    setSavedPoses((current) => {
      if (current.some((item) => item.id === pose.id)) return current
      return [pose, ...current]
    })
  }, [])

  const handleRenamePose = useCallback(async (poseId: string, name: string) => {
    const response = await fetch(`/api/poses/${encodeURIComponent(poseId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `重命名失败：HTTP ${response.status}`)
    }
    setSavedPoses((current) =>
      current.map((pose) => (pose.id === poseId ? { ...pose, name } : pose)),
    )
    setSelectedPoses((current) =>
      current.map((pose) => (pose.id === poseId ? { ...pose, name } : pose)),
    )
  }, [])

  const handleDeletePose = useCallback(async (poseId: string) => {
    const response = await fetch(`/api/poses/${encodeURIComponent(poseId)}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `删除失败：HTTP ${response.status}`)
    }
    setSavedPoses((current) => current.filter((pose) => pose.id !== poseId))
    setSelectedPoses((current) => current.filter((pose) => pose.id !== poseId))
  }, [])

  // 模特库：数据源为服务端（按用户持久化，跨设备一致）。挂载/用户变化时拉取，
  // 并把老用户 localStorage 里的 legacy 列表一次性迁移上云。
  const loadModels = useCallback(async () => {
    if (!user) return
    try {
      const response = await fetch('/api/models', { cache: 'no-store' })
      if (!response.ok) return
      const data = (await response.json()) as {
        companyModels?: CompanyModel[]
        faceIdModels?: CompanyModel[]
      }
      let companyNext = Array.isArray(data.companyModels) ? data.companyModels : []
      let faceIdNext = Array.isArray(data.faceIdModels) ? data.faceIdModels : []

      // 存量迁移：合并 legacy 列表到服务端，成功后清除本地键。清除后 readLegacyModels
      // 返回空，天然幂等，无需额外标志位。
      const legacyCompany = readLegacyModels(companyModelsStorageKey)
      if (legacyCompany.length) {
        const merged = await syncLegacyModels('company', legacyCompany)
        if (merged) {
          companyNext = merged
          window.localStorage.removeItem(companyModelsStorageKey)
        }
      }
      const legacyFaceId = readLegacyModels(faceIdModelsStorageKey)
      if (legacyFaceId.length) {
        const merged = await syncLegacyModels('faceId', legacyFaceId)
        if (merged) {
          faceIdNext = merged
          window.localStorage.removeItem(faceIdModelsStorageKey)
        }
      }

      setCompanyModels(companyNext)
      setFaceIdModels(faceIdNext)
    } catch {
      // 静默失败：空列表会在 UI 呈现，下次挂载会重试
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    void loadModels()
  }, [loadModels, user])

  // 以下 6 个 handler：乐观更新本地 state + 异步落服务端；失败则 loadModels 纠正。
  const handleAddCompanyModel = useCallback((model: CompanyModel) => {
    setCompanyModels((current) =>
      current.some((item) => item.assetId === model.assetId)
        ? current
        : [model, ...current],
    )
    void (async () => {
      try {
        const response = await fetch('/api/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            library: 'company',
            assetId: model.assetId,
            url: model.preview,
            name: model.name,
            width: model.width,
            height: model.height,
          }),
        })
        if (!response.ok) void loadModels()
      } catch {
        void loadModels()
      }
    })()
  }, [loadModels])

  const handleDeleteCompanyModel = useCallback((assetId: string) => {
    setCompanyModels((current) =>
      current.filter((item) => item.assetId !== assetId),
    )
    void (async () => {
      try {
        const response = await fetch(
          `/api/models/${encodeURIComponent(assetId)}?library=company`,
          { method: 'DELETE' },
        )
        if (!response.ok) void loadModels()
      } catch {
        void loadModels()
      }
    })()
  }, [loadModels])

  const handleRenameCompanyModel = useCallback((assetId: string, name: string) => {
    setCompanyModels((current) =>
      current.map((item) => (item.assetId === assetId ? { ...item, name } : item)),
    )
    void (async () => {
      try {
        const response = await fetch(
          `/api/models/${encodeURIComponent(assetId)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ library: 'company', name }),
          },
        )
        if (!response.ok) void loadModels()
      } catch {
        void loadModels()
      }
    })()
  }, [loadModels])

  const handleAddFaceIdModel = useCallback((model: CompanyModel) => {
    setFaceIdModels((current) =>
      current.some((item) => item.assetId === model.assetId)
        ? current
        : [model, ...current],
    )
    void (async () => {
      try {
        const response = await fetch('/api/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            library: 'faceId',
            assetId: model.assetId,
            url: model.preview,
            name: model.name,
            width: model.width,
            height: model.height,
          }),
        })
        if (!response.ok) void loadModels()
      } catch {
        void loadModels()
      }
    })()
  }, [loadModels])

  const handleDeleteFaceIdModel = useCallback((assetId: string) => {
    setFaceIdModels((current) =>
      current.filter((item) => item.assetId !== assetId),
    )
    setSelectedFaceIdModel((current) =>
      current?.assetId === assetId ? null : current,
    )
    void (async () => {
      try {
        const response = await fetch(
          `/api/models/${encodeURIComponent(assetId)}?library=faceId`,
          { method: 'DELETE' },
        )
        if (!response.ok) void loadModels()
      } catch {
        void loadModels()
      }
    })()
  }, [loadModels])

  const handleRenameFaceIdModel = useCallback((assetId: string, name: string) => {
    setFaceIdModels((current) =>
      current.map((item) => (item.assetId === assetId ? { ...item, name } : item)),
    )
    setSelectedFaceIdModel((current) =>
      current?.assetId === assetId ? { ...current, name } : current,
    )
    void (async () => {
      try {
        const response = await fetch(
          `/api/models/${encodeURIComponent(assetId)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ library: 'faceId', name }),
          },
        )
        if (!response.ok) void loadModels()
      } catch {
        void loadModels()
      }
    })()
  }, [loadModels])

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
        <BrandLoader title={title} description={description}>
          {showActions && (
            <div className="flex gap-2">
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
        </BrandLoader>
      </main>
    )
  }

  const leftPanel = (
    <LeftPanel
      mobile={isMobile}
      feature={currentFeature}
      selectedPoses={selectedPoses}
      savedPoses={savedPoses}
      companyModels={companyModels}
      fashionReferences={fashionReferences}
      fashionRemixRequest={fashionRemixRequest}
      photoFissionCaseRequest={photoFissionCaseRequest}
      faceIdModels={faceIdModels}
      selectedFaceIdModel={selectedFaceIdModel}
      onChangeSelectedFaceIdModel={setSelectedFaceIdModel}
      onChangeSelectedPoses={setSelectedPoses}
      onAddFashionReference={handleAddFashionReference}
      onReplaceFashionReference={handleReplaceFashionReference}
      onRemoveFashionReference={handleRemoveFashionReference}
      onReorderFashionReferences={handleReorderFashionReferences}
      onOpenCompanyModelLibrary={() => setCompanyModelLibraryRequestKey((currentKey) => currentKey + 1)}
      onOpenFaceIdLibrary={() => setFaceIdLibraryRequestKey((currentKey) => currentKey + 1)}
      onAddPose={handleAddPose}
      onRenamePose={handleRenamePose}
      onDeletePose={handleDeletePose}
      onTaskCreated={(taskId) => {
        setActiveTaskId(taskId)
        setMobileFormOpen(false)
        void loadTask(taskId)
      }}
    />
  )

  const rightPanel = (
    <RightPanel
      feature={currentFeature}
      activeTask={activeTask}
      tasks={tasks}
      tasksLoading={tasksLoading}
      tasksTotal={tasksTotal}
      tasksHasMore={tasksHasMore}
      tasksLoadingMore={tasksLoadingMore}
      onLoadMoreTasks={() => void loadMoreTasks()}
      companyModels={companyModels}
      fashionReferences={fashionReferences}
      companyModelLibraryRequestKey={companyModelLibraryRequestKey}
      faceIdModels={faceIdModels}
      faceIdLibraryRequestKey={faceIdLibraryRequestKey}
      selectedFaceIdModel={selectedFaceIdModel}
      onAddCompanyModel={handleAddCompanyModel}
      onDeleteCompanyModel={handleDeleteCompanyModel}
      onRenameCompanyModel={handleRenameCompanyModel}
      onAddFaceIdModel={handleAddFaceIdModel}
      onDeleteFaceIdModel={handleDeleteFaceIdModel}
      onRenameFaceIdModel={handleRenameFaceIdModel}
      onSelectFaceIdModel={setSelectedFaceIdModel}
      onAddFashionReference={handleAddFashionReference}
      onUseTaskAsFashionReference={handleUseTaskAsFashionReference}
      onSelectPhotoFissionCase={handleSelectPhotoFissionCase}
      onSelectTask={setActiveTaskId}
      onRefreshTasks={loadTasks}
      onCancelTask={handleCancelTask}
      onDeleteTaskResult={handleDeleteTaskResult}
    />
  )

  // 手机版（<768px）：MobileShell 换壳，LeftPanel/RightPanel/状态全部复用
  if (isMobile) {
    return (
      <MobileShell
        activeFeature={currentFeature}
        onFeatureChange={setCurrentFeature}
        user={user}
        isAuthLoading={isAuthLoading}
        onLogout={handleLogout}
        onRefreshTasks={loadTasks}
        formOpen={mobileFormOpen}
        onFormOpenChange={handleMobileFormOpenChange}
        formMounted={mobileFormMounted}
        form={leftPanel}
      >
        {rightPanel}
      </MobileShell>
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
        onRefreshTasks={loadTasks}
      />
      {leftPanel}
      {rightPanel}
    </main>
  )
}
