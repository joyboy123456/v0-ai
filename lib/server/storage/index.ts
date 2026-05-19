/**
 * Storage 层门面。业务侧统一从这里 import：
 *   import { getStorageAdapter, getTaskRepo } from '@/lib/server/storage'
 *
 * 内部模块（r2-client / task-repo.local / task-repo.d1）禁止直接 import。
 */

export { getStorageAdapter, buildPublicUrlForKey } from './storage-adapter'
export type {
  StorageAdapter,
  StorageBucket,
  PutImageInput,
  PutImageFromDataUrlInput,
  PutImageResult,
  PutImageFromDataUrlResult,
  GetImageResult,
} from './storage-adapter'
export { getTaskRepo } from './task-repo'
export type { TaskRepo, TaskRow, AssetRow } from './task-repo'
