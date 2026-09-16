'use client'

import { useEffect, useState } from 'react'
import type { AgentBetaAccess } from '@/lib/agent-beta/types'

export interface AgentBetaAccessState {
  enabled: boolean
  llmOptions: Array<{ id: string; label: string }>
  defaultLlmId: string | null
}

const EMPTY_ACCESS: AgentBetaAccessState = { enabled: false, llmOptions: [], defaultLlmId: null }

/**
 * 拉取 Agent Beta 开放状态与可选规划 LLM 目录。
 * 入口展示只看 enabled；用户级门禁在 /beta/agent 页面与 Beta API 服务端各自校验。
 */
export function useAgentBetaAccess(): AgentBetaAccessState {
  const [access, setAccess] = useState<AgentBetaAccessState>(EMPTY_ACCESS)
  useEffect(() => {
    let active = true
    fetch('/api/beta/agent/access', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<AgentBetaAccess>) : null))
      .then((data) => {
        if (active && data?.enabled) {
          setAccess({
            enabled: true,
            llmOptions: data.llmOptions ?? [],
            defaultLlmId: data.defaultLlmId ?? null,
          })
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return access
}
