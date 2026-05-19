/**
 * Cloudflare D1 REST API 客户端。
 *
 * 用法：
 *   const { results } = await executeD1Query<UserRow>(
 *     'SELECT id, username FROM users WHERE username = ?',
 *     [username],
 *   )
 *
 * 设计要点（参考 prd.md §「Cloudflare 库选型」）：
 * - 通过 `POST /accounts/{account_id}/d1/database/{database_id}/query` 调用
 * - Bearer token 来自 `CLOUDFLARE_D1_KV_TOKEN`（区别于 wrangler OAuth）
 * - 不带重试逻辑（单调用失败让上层决定），区别于 `google-image-retry`
 * - 返回 `D1QueryResult<T>`，调用方传入预期 row shape
 */

import {
  CloudflareError,
  assertCloudflareConfigured,
  mapHttpStatusToCode,
  readCloudflareEnv,
} from './shared'

export interface D1QueryMeta {
  duration?: number
  rows_read?: number
  rows_written?: number
  changes?: number
  last_row_id?: number
}

export interface D1QueryResult<T> {
  results: T[]
  meta: D1QueryMeta
  success: boolean
}

interface D1RawResponse<T> {
  success: boolean
  errors: Array<{ code?: number; message?: string }>
  result?: Array<{
    results: T[]
    success: boolean
    meta: D1QueryMeta
  }>
}

export async function executeD1Query<T = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
  options?: { signal?: AbortSignal },
): Promise<D1QueryResult<T>> {
  assertCloudflareConfigured('d1')
  const { accountId, token, d1DatabaseId } = readCloudflareEnv()
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1DatabaseId}/query`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: options?.signal,
    })
  } catch (cause) {
    throw new CloudflareError({
      code: 'NETWORK_ERROR',
      message: `D1 调用网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new CloudflareError({
      code: mapHttpStatusToCode(response.status),
      message: `D1 调用失败 HTTP ${response.status}：${text.slice(0, 500)}`,
      httpStatus: response.status,
    })
  }

  let payload: D1RawResponse<T>
  try {
    payload = (await response.json()) as D1RawResponse<T>
  } catch (cause) {
    throw new CloudflareError({
      code: 'UNKNOWN',
      message: 'D1 响应不是合法 JSON',
      cause,
    })
  }

  if (!payload.success) {
    const reason =
      payload.errors?.[0]?.message ?? `D1 调用返回 success=false`
    throw new CloudflareError({ code: 'UNKNOWN', message: reason })
  }

  const first = payload.result?.[0]
  if (!first) {
    return { results: [], meta: {}, success: true }
  }
  return {
    results: first.results ?? [],
    meta: first.meta ?? {},
    success: first.success !== false,
  }
}
