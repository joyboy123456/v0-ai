'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AgentBetaApiError, agentBetaRequest } from '@/lib/agent-beta/client'
import type { AgentBetaSession, AgentBetaSessionSummary, AgentBetaSettings } from '@/lib/agent-beta/types'
import { hasRunningTask, withLocalPositions, type NodePosition } from './session-state'

const sessionsUrl = '/api/beta/agent/sessions'

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
  const storageKey = userId ? `agent-beta-session:${userId}` : null

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
    const currentEpoch = ++epoch.current
    positions.current.clear()
    sessionRef.current = null
    setSession(null)
    setSelectedIds([])
    setLoading(true)
    setError(null)
    try {
      const data = await agentBetaRequest<{ session: AgentBetaSession }>(`${sessionsUrl}/${encodeURIComponent(id)}`)
      if (epoch.current === currentEpoch) accept(data.session)
    } catch (cause) {
      if (epoch.current === currentEpoch) reportError(cause)
    } finally {
      if (epoch.current === currentEpoch) setLoading(false)
    }
  }, [accept, reportError])

  useEffect(() => {
    const currentEpoch = ++epoch.current
    sessionRef.current = null
    positions.current.clear()
    setSession(null)
    setSessions([])
    setSelectedIds([])
    if (!userId) { setLoading(false); return }
    setLoading(true)
    void (async () => {
      try {
        const data = await agentBetaRequest<{ sessions: AgentBetaSessionSummary[] }>(sessionsUrl)
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
    return () => { ++epoch.current }
  }, [userId, storageKey, reportError, switchSession])

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
    const data = await agentBetaRequest<{ session: AgentBetaSession }>(sessionsUrl, { method: 'POST', body: '{}' })
    if (currentEpoch !== epoch.current) throw new Error('会话已切换，请重新操作')
    accept(data.session)
    return data.session
  }, [accept])

  const newSession = useCallback(() => run('正在新建会话', async (currentEpoch) => {
    const data = await agentBetaRequest<{ session: AgentBetaSession }>(sessionsUrl, { method: 'POST', body: '{}' })
    if (currentEpoch !== epoch.current) return
    positions.current.clear()
    setSelectedIds([])
    accept(data.session)
  }), [accept, run])

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
      const asset = await agentBetaRequest<{ assetId: string }>('/api/assets/upload', { method: 'POST', body })
      const data = await agentBetaRequest<{ session: AgentBetaSession }>(`${sessionsUrl}/${current.id}/assets`, {
        method: 'POST', body: JSON.stringify({ assetIds: [asset.assetId] }),
      })
      if (currentEpoch !== epoch.current) return
      addedIds.push(...data.session.nodes.filter((node) => node.assetId === asset.assetId).map((node) => node.id))
      accept(data.session)
      setSelectedIds([...addedIds])
    }
  }), [accept, ensureSession, run])

  const sendMessage = useCallback((text: string, settings: AgentBetaSettings) => run('正在准备方案', async (currentEpoch) => {
    const current = await ensureSession(currentEpoch)
    const data = await agentBetaRequest<{ session: AgentBetaSession }>(`${sessionsUrl}/${current.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ clientMessageId: crypto.randomUUID(), text, referenceNodeIds: selectedIds, settings }),
    })
    if (currentEpoch === epoch.current) accept(data.session)
  }), [accept, ensureSession, run, selectedIds])

  const planAction = useCallback((action: 'execute' | 'cancel', messageId: string, prompt?: string) => run(
    action === 'execute' ? '正在提交生成' : '正在取消任务',
    async (currentEpoch) => {
      const current = sessionRef.current
      if (!current) return
      const data = await agentBetaRequest<{ session: AgentBetaSession }>(`${sessionsUrl}/${current.id}/${action}`, {
        method: 'POST', body: JSON.stringify({ messageId, ...(prompt !== undefined ? { prompt } : {}) }),
      })
      if (currentEpoch === epoch.current) accept(data.session)
    },
  ), [accept, run])

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
        await agentBetaRequest<{ session: AgentBetaSession }>(`${sessionsUrl}/${current.id}`, {
          method: 'PATCH', body: JSON.stringify({ positions: changes }),
        })
        if (currentEpoch !== epoch.current || sessionRef.current?.id !== current.id) return
        // PATCH 只确认位置保存；不把它的旧消息快照覆盖到正在进行的对话。
        // 当前会话持续保留本地坐标，防止较早发出的进度响应让节点回跳。
      } catch (cause) {
        if (currentEpoch === epoch.current) setError(`画布位置未保存：${cause instanceof Error ? cause.message : '请重新拖动重试'}`)
      }
    })
  }, [])

  const running = hasRunningTask(session)
  useEffect(() => {
    if (!running || !session?.id) return
    const sessionId = session.id
    const currentEpoch = epoch.current
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (cancelled) return
      const pollRevision = revision.current
      if (!busyRef.current) {
        try {
          const data = await agentBetaRequest<{ session: AgentBetaSession }>(`${sessionsUrl}/${sessionId}`)
          if (!cancelled && currentEpoch === epoch.current && pollRevision === revision.current && !busyRef.current) accept(data.session)
        } catch (cause) {
          if (!cancelled && currentEpoch === epoch.current) reportError(cause)
        }
      }
      if (!cancelled) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 3000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [running, session?.id, accept, reportError])

  return { session, sessions, loading, busy, error, setError, selectedIds, setSelectedIds, switchSession, newSession, upload, sendMessage, planAction, moveNodes }
}
