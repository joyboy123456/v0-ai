import { ProxyAgent } from 'undici'

export const proxyFetch: typeof fetch = (input, init) => {
  // 运行时读取代理配置
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY

  if (proxyUrl) {
    const agent = new ProxyAgent({
      uri: proxyUrl,
      requestTls: { rejectUnauthorized: false }
    })
    return fetch(input, { ...init, dispatcher: agent } as RequestInit & { dispatcher: unknown })
  }

  return fetch(input, init)
}
