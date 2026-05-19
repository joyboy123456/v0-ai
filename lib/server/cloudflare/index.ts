/**
 * Cloudflare REST API 客户端门面。
 *
 * 只重导出 d1 / kv 与共享 error 类型，方便业务侧 `import { executeD1Query }
 * from '@/lib/server/cloudflare'`。
 */

export { CloudflareError, assertCloudflareConfigured } from './shared'
export type {
  CloudflareErrorCode,
  CloudflareErrorInit,
} from './shared'
export {
  executeD1Query,
} from './d1-client'
export type { D1QueryMeta, D1QueryResult } from './d1-client'
export { kvGet, kvPut, kvDelete } from './kv-client'
