'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AgentBetaApiError, agentBetaRequest } from '@/lib/agent-beta/client'
import { bindClickedPreviewIdentity, confirmationInput, isAgentRuntimeV1Plan, previewIdentity } from '@/lib/agent-beta/protocol'
import type {
  AgentBetaPlan,
  AgentBetaPreviewIdentity,
  AgentBetaRepreviewInput,
  AgentBetaSession,
  AgentBetaSessionSummary,
  AgentBetaSettings,
} from '@/lib/agent-beta/types'
import { manualSessionRefresh, sessionPollAction, withLocalPositions, type NodePosition } from './session-state'

const sessionsUrl = '/api/beta/agent/sessions'
type PlanAction = 'preview' | 'execute' | 'cancel'

function hasNewPreview(
  previous: AgentBetaPlan,
  nextSession: AgentBetaSession,
  messageId: string,
  expectedPrompt: string,
): boolean {
  const before = previewIdentity(previous)
  const nextPlan = nextSession.messages.find((message) => message.id === messageId)?.plan
  const after = nextPlan ? previewIdentity(nextPlan) : undefined
  if (!before || !after || nextPlan?.prompt !== expectedPrompt) return false
  return after.proposalId === before.proposalId
    && after.previewVersion > before.previewVersion
    && after.previewDigest !== before.previewDigest
}

export function useAgentBeta(userId: string | undefined) {
  const [session, setSession] = useState<AgentBetaSession | null>(null)
  const [sessions, setSessions] = useState<AgentBetaSessionSummary[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<AgentBetaSession | null>(null)
  const epoch = useRef(0)
  const revision = useRef(0)
  const busyRef = useRef(false)
  const positions = useRef(new Map<string, NodePosition>())
  const positionChain = useRef(Promise.resolve())
  const requestControllers = useRef(new Set<AbortController>())
  const storageKey = userId ? `agent-beta-session:${userId}` : null

  const abortRequests = useCallback(() => {
    for (const controller of requestControllers.current) controller.abort()
    requestControllers.current.clear()
  }, [])

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const controller = new AbortController()
    requestControllers.current.add(controller)
    try {
      return await agentBetaRequest<T>(path, { ...init, signal: controller.signal })
    } finally {
      requestControllers.current.delete(controller)
    }
  }, [])

  const accept = useCallback((next: AgentBetaSession) => {
    const merged = withLocalPositions(next, positions.current)
    sessionRef.current = merged
    setSession(merged)
    setSelectedIds((ids) => ids.filter((id) => merged.nodes.some((node) => node.id === id)))
    setSessions((previous) => [
      { id: next.id, title: next.title, updatedAt: next.updatedAt },
      ...previous.filter((item) => item.id !== next.id),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    if (storageKey) {
      try { localStorage.setItem(storageKey, next.id) } catch { /* 浏览器禁用存储时仍可继续创作。 */ }
    }
  }, [storageKey])

  const reportError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : '请求失败，请重试')
    if (cause instanceof AgentBetaApiError && ([401, 403].includes(cause.status) || cause.code === 'AGENT_BETA_SESSION_NOT_FOUND')) {
      if (storageKey) {
        try { localStorage.removeItem(storageKey) } catch { /* 存储不可用不影响错误提示。 */ }
      }
      sessionRef.current = null
      positions.current.clear()
      setSession(null)
      setSelectedIds([])
    }
  }, [storageKey])

  const switchSession = useCallback(async (id: string) => {
    abortRequests()
    const currentEpoch = ++epoch.current
    ++revision.current
    positions.current.clear()
    sessionRef.current = null
    setSession(null)
    setSelectedIds([])
    setLoading(true)
    setError(null)
    try {
      const data = await request<{ session: AgentBetaSession }>(`${sessionsUrl}/${encodeURIComponent(id)}`)
      if (epoch.current === currentEpoch) accept(data.session)
    } catch (cause) {
      if (epoch.current === currentEpoch) reportError(cause)
    } finally {
      if (epoch.current === currentEpoch) setLoading(false)
    }
  }, [abortRequests, accept, reportError, request])

  useEffect(() => {
    abortRequests()
    const currentEpoch = ++epoch.current
    sessionRef.current = null
    positions.current.clear()
    setSession(null)
    setSessions([])
    setSelectedIds([])
    if (!userId) {
      setLoading(false)
      return () => { abortRequests(); ++epoch.current }
    }
    setLoading(true)
    void (async () => {
      try {
        const data = await request<{ sessions: AgentBetaSessionSummary[] }>(sessionsUrl)
        if (epoch.current !== currentEpoch) return
        setSessions(data.sessions)
        let saved: string | null = null
        try { saved = storageKey ? localStorage.getItem(storageKey) : null } catch { /* 使用最近会话作为默认值。 */ }
        const target = data.sessions.find((item) => item.id === saved) ?? data.sessions[0]
        if (saved && !data.sessions.some((item) => item.id === saved) && storageKey) {
          try { localStorage.removeItem(storageKey) } catch { /* 忽略不可用的浏览器存储。 */ }
        }
        if (target) await switchSession(target.id)
      } catch (cause) {
        if (epoch.current === currentEpoch) reportError(cause)
      } finally {
        if (epoch.current === currentEpoch) setLoading(false)
      }
    })()
    return () => { abortRequests(); ++epoch.current }
  }, [abortRequests, userId, storageKey, reportError, request, switchSession])

  const run = useCallback(async (label: string, operation: (currentEpoch: number) => Promise<void>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(label)
    setError(null)
    ++revision.current
    const currentEpoch = epoch.current
    try {
      await operation(currentEpoch)
      return true
    } catch (cause) {
      if (currentEpoch === epoch.current) reportError(cause)
      return false
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }, [reportError])

  const ensureSession = useCallback(async (currentEpoch: number) => {
    if (sessionRef.current) return sessionRef.current
    const data = await request<{ session: AgentBetaSession }>(sessionsUrl, { method: 'POST', body: '{}' })
    if (currentEpoch !== epoch.current) throw new Error('会话已切换，请重新操作')
    accept(data.session)
    return data.session
  }, [accept, request])

  const newSession = useCallback(() => {
    if (busyRef.current) return Promise.resolve(false)
    abortRequests()
    ++epoch.current
    ++revision.current
    positions.current.clear()
    sessionRef.current = null
    setSession(null)
    setSelectedIds([])
    return run('正在新建会话', async (currentEpoch) => {
      const data = await request<{ session: AgentBetaSession }>(sessionsUrl, { method: 'POST', body: '{}' })
      if (currentEpoch !== epoch.current) return
      accept(data.session)
    })
  }, [abortRequests, accept, request, run])

  const upload = useCallback((files: File[]) => run('正在上传参考图', async (currentEpoch) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (!images.length) throw new Error('请选择图片文件')
    if (images.length > 10) throw new Error('一次最多上传 10 张图片')
    const current = await ensureSession(currentEpoch)
    const addedIds: string[] = []
    for (const file of images) {
      if (currentEpoch !== epoch.current) return
      const body = new FormData()
      body.append('file', file)
      const asset = await request<{ assetId: string }>('/api/assets/upload', { method: 'POST', body })
      const data = await request<{ session: AgentBetaSession }>(`${sessionsUrl}/${encodeURIComponent(current.id)}/assets`, {
        method: 'POST', body: JSON.stringify({ assetIds: [asset.assetId] }),
      })
      if (currentEpoch !== epoch.current) return
      addedIds.push(...data.session.nodes.filter((node) => node.assetId === asset.assetId).map((node) => node.id))
      accept(data.session)
      setSelectedIds([...addedIds])
    }
  }), [accept, ensureSession, request, run])

  const sendMessage = useCallback((text: string, settings: AgentBetaSettings) => run('正在准备方案', async (currentEpoch) => {
    const current = await ensureSession(currentEpoch)
    const data = await request<{ session: AgentBetaSession }>(`${sessionsUrl}/${encodeURIComponent(current.id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ clientMessageId: crypto.randomUUID(), text, referenceNodeIds: selectedIds, settings }),
    })
    if (currentEpoch === epoch.current) accept(data.session)
  }), [accept, ensureSession, request, run, selectedIds])

  const planAction = useCallback((
    action: PlanAction,
    messageId: string,
    prompt?: string,
    clickedIdentity?: AgentBetaPreviewIdentity,
  ) => run(
    action === 'preview' ? '正在更新预览' : action === 'execute' ? '正在提交生成' : '正在取消任务',
    async (currentEpoch) => {
      const current = sessionRef.current
      if (!current) throw new Error('会话已切换，请重新操作')
      const plan = current.messages.find((message) => message.id === messageId && message.role === 'assistant')?.plan
      if (!plan) throw new Error('可操作方案不存在，请刷新后重试')

      let body: object
      if (action === 'cancel') {
        body = { messageId }
      } else if (isAgentRuntimeV1Plan(plan)) {
        const identity = bindClickedPreviewIdentity(clickedIdentity, plan)
        if (!identity) throw new Error('预览身份已失效，请刷新后重试')
        if (action === 'preview') {
          const nextPrompt = prompt?.trim()
          if (plan.status !== 'proposed') throw new Error('预览身份已失效，请刷新后重试')
          if (!nextPrompt) throw new Error('请输入生成要求')
          if (nextPrompt === plan.prompt) throw new Error('当前预览已是最新版本')
          const input: AgentBetaRepreviewInput = { messageId, ...identity, prompt: nextPrompt }
          body = input
        } else {
          if (prompt?.trim() !== plan.prompt) throw new Error('生成要求已修改，请先更新预览')
          if (!confirmationInput(plan, messageId)) throw new Error('当前预览暂不可确认，请按阻断提示调整方案')
          body = { messageId, ...identity }
        }
      } else {
        if (action === 'preview') throw new Error('旧版方案无需单独更新预览')
        body = { messageId, ...(prompt !== undefined ? { prompt } : {}) }
      }

      const data = await request<{ session: AgentBetaSession }>(
        `${sessionsUrl}/${encodeURIComponent(current.id)}/${action}`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      if (currentEpoch !== epoch.current) return
      if (action === 'preview' && !hasNewPreview(plan, data.session, messageId, prompt?.trim() ?? '')) {
        throw new Error('服务器未返回新版预览，请刷新后重试')
      }
      accept(data.session)
    },
  ), [accept, request, run])

  const moveNodes = useCallback((changes: NodePosition[], persist: boolean) => {
    const current = sessionRef.current
    if (!current) return
    changes.forEach((position) => positions.current.set(position.id, position))
    const merged = withLocalPositions(current, positions.current)
    sessionRef.current = merged
    setSession(merged)
    if (!persist) return
    const currentEpoch = epoch.current
    ++revision.current
    positionChain.current = positionChain.current.catch(() => {}).then(async () => {
      try {
        await request<{ session: AgentBetaSession }>(`${sessionsUrl}/${encodeURIComponent(current.id)}`, {
          method: 'PATCH', body: JSON.stringify({ positions: changes }),
        })
        if (currentEpoch !== epoch.current || sessionRef.current?.id !== current.id) return
        // PATCH 只确认位置保存；不把它的旧消息快照覆盖到正在进行的对话。
        // 当前会话持续保留本地坐标，防止较早发出的进度响应让节点回跳。
      } catch (cause) {
        if (currentEpoch === epoch.current) setError(`画布位置未保存：${cause instanceof Error ? cause.message : '请重新拖动重试'}`)
      }
    })
  }, [request])

  const refreshSession = useCallback(() => run('正在刷新状态', async (currentEpoch) => {
    const current = sessionRef.current
    if (!current) throw new Error('会话已切换，请重新操作')
    const spec = manualSessionRefresh(current.id)
    const data = await request<{ session: AgentBetaSession }>(spec.path)
    if (currentEpoch === epoch.current) accept(data.session)
  }), [accept, request, run])

  const pollAction = sessionPollAction(session)
  useEffect(() => {
    if (pollAction !== 'refresh' || !session?.id) return
    const sessionId = session.id
    const currentEpoch = epoch.current
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (cancelled) return
      const pollRevision = revision.current
      if (!busyRef.current) {
        try {
          const data = await request<{ session: AgentBetaSession }>(`${sessionsUrl}/${encodeURIComponent(sessionId)}`)
          if (!cancelled && currentEpoch === epoch.current && pollRevision === revision.current && !busyRef.current) accept(data.session)
        } catch (cause) {
          if (!cancelled && currentEpoch === epoch.current) reportError(cause)
        }
      }
      if (!cancelled) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 3000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [pollAction, session?.id, accept, reportError, request])

  return {
    session, sessions, loading, busy, error, setError, selectedIds, setSelectedIds,
    switchSession, newSession, upload, sendMessage, planAction, refreshSession, moveNodes,
  }
}
