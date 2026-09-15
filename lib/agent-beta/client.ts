export class AgentBetaApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message)
    this.name = 'AgentBetaApiError'
  }
}

export async function agentBetaRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new AgentBetaApiError(data?.error || `请求失败（${response.status}）`, response.status, data?.code)
  }
  if (data === null) throw new Error('服务返回了无效数据，请重试')
  return data as T
}
