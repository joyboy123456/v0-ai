'use client'

import { useEffect, useState } from 'react'

/**
 * 工作台导航用：Agent Beta 画布入口是否开放（只读服务端 enabled，无需登录态）。
 * 入口对所有人可见；真正的用户级门禁在 /beta/agent 页面与 Beta API 服务端各自校验。
 */
export function useAgentBetaAccess(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let active = true
    fetch('/api/beta/agent/access', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ enabled?: boolean }>) : null))
      .then((data) => {
        if (active && data?.enabled) setEnabled(true)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return enabled
}
