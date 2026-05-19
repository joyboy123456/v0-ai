/**
 * Cloudflare Workers KV REST API 客户端。
 *
 * 用法：
 *   await kvPut('sess_xxx', JSON.stringify({ userId, expiresAt }), 30 * 86400)
 *   const value = await kvGet('sess_xxx')
 *   await kvDelete('sess_xxx')
 *
 * 设计要点：
 * - GET /storage/kv/namespaces/{ns}/values/{key} 返回 200 / 404 两种情况
 *   - 200: body 是 value 字符串
 *   - 404: 没有这个 key，返回 null
 * - PUT 时通过 query `expiration_ttl` 控制 TTL（秒）
 * - 同样使用 `CLOUDFLARE_D1_KV_TOKEN`，不重试，错误抛 CloudflareError
 */

import {
  CloudflareError,
  assertCloudflareConfigured,
  mapHttpStatusToCode,
  readCloudflareEnv,
} from './shared'

function buildKvEndpoint(key: string, queryParams?: Record<string, string>) {
  const { accountId, kvNamespaceId } = readCloudflareEnv()
  const encodedKey = encodeURIComponent(key)
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNamespaceId}/values/${encodedKey}`
  if (!queryParams || Object.keys(queryParams).length === 0) return base
  const search = new URLSearchParams(queryParams).toString()
  return `${base}?${search}`
}

export async function kvGet(
  key: string,
  options?: { signal?: AbortSignal },
): Promise<string | null> {
  assertCloudflareConfigured('kv')
  const { token } = readCloudflareEnv()
  const endpoint = buildKvEndpoint(key)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: options?.signal,
    })
  } catch (cause) {
    throw new CloudflareError({
      code: 'NETWORK_ERROR',
      message: `KV GET 网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  if (response.status === 404) return null
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new CloudflareError({
      code: mapHttpStatusToCode(response.status),
      message: `KV GET 失败 HTTP ${response.status}：${text.slice(0, 200)}`,
      httpStatus: response.status,
    })
  }
  return await response.text()
}

export async function kvPut(
  key: string,
  value: string,
  ttlSeconds?: number,
  options?: { signal?: AbortSignal },
): Promise<void> {
  assertCloudflareConfigured('kv')
  const { token } = readCloudflareEnv()
  // KV 要求 TTL 至少 60 秒
  const query =
    ttlSeconds && ttlSeconds >= 60
      ? { expiration_ttl: String(Math.floor(ttlSeconds)) }
      : undefined
  const endpoint = buildKvEndpoint(key, query)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: value,
      signal: options?.signal,
    })
  } catch (cause) {
    throw new CloudflareError({
      code: 'NETWORK_ERROR',
      message: `KV PUT 网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new CloudflareError({
      code: mapHttpStatusToCode(response.status),
      message: `KV PUT 失败 HTTP ${response.status}：${text.slice(0, 200)}`,
      httpStatus: response.status,
    })
  }
}

export async function kvDelete(
  key: string,
  options?: { signal?: AbortSignal },
): Promise<void> {
  assertCloudflareConfigured('kv')
  const { token } = readCloudflareEnv()
  const endpoint = buildKvEndpoint(key)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: options?.signal,
    })
  } catch (cause) {
    throw new CloudflareError({
      code: 'NETWORK_ERROR',
      message: `KV DELETE 网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  // 404 视为已删除，幂等
  if (response.status === 404) return
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new CloudflareError({
      code: mapHttpStatusToCode(response.status),
      message: `KV DELETE 失败 HTTP ${response.status}：${text.slice(0, 200)}`,
      httpStatus: response.status,
    })
  }
}
