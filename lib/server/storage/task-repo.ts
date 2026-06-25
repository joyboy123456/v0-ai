/**
 * 任务仓储抽象。
 *
 * 设计要点：
 * - 这是**底层仓储**，只管 `users` / `tasks` / `assets` 三张表的 CRUD，
 *   不包含 photo-fission / pose-fission 业务逻辑（这些仍在 `task-store.ts`
 *   与 `pipeline` 文件里）。
 * - `task-store.ts` 通过 `getTaskRepo()` 调用本仓储；
 *   service 层（photo-fission-service / pose-fission-service / ai-fashion-photo-service）
 *   **不直接**调本仓储，只通过 task-store 间接调。
 * - row shape 是 camelCase。
 */

import { createLocalTaskRepo } from './task-repo.local'

export interface TaskRow {
  id: string
  userId: string
  /** 业务侧的 featureType / type 字符串（保留兼容） */
  type: string
  /**
   * 业务侧的 task.status 字符串（与 `GenerationTask['status']` 同源）。
   * D1 schema 用 `'queued' | 'running' | 'done' | 'failed' | 'partial'`，
   * 这里保留为宽 string，由 `task-store.ts` 自行决定写什么值，避免双重枚举。
   */
  status: string
  /** 输入参数 JSON 字符串 */
  payloadJson: string | null
  /** 结果摘要 JSON 字符串 */
  resultJson: string | null
  createdAt: number
  updatedAt: number
}

export interface AssetRow {
  id: string
  userId: string
  taskId: string | null
  kind: 'upload' | 'generated'
  /** local 模式 = publicUrl（`/generated/...` 或 `/local-assets/...`）；oss 模式 = OSS object key */
  r2Key: string
  publicUrl: string | null
  mime: string | null
  bytes: number | null
  width: number | null
  height: number | null
  createdAt: number
  favorited: boolean
}

export interface TaskRepo {
  // 任务
  insertTask(task: TaskRow): Promise<void>
  updateTask(
    id: string,
    patch: Partial<Omit<TaskRow, 'id' | 'userId' | 'createdAt'>>,
  ): Promise<void>
  getTask(id: string): Promise<TaskRow | null>
  listTasksByUser(
    userId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<TaskRow[]>
  deleteTask(id: string): Promise<void>

  // 资产
  insertAsset(asset: AssetRow): Promise<void>
  getAsset(id: string): Promise<AssetRow | null>
  listAssetsByTask(taskId: string): Promise<AssetRow[]>
  listAssetsByUser(
    userId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<AssetRow[]>
  deleteAsset(id: string): Promise<void>
}

let cached: TaskRepo | null = null

export function getTaskRepo(): TaskRepo {
  if (cached) return cached
  cached = createLocalTaskRepo()
  return cached
}

/**
 * 仅供测试：清空 repo cache。生产代码不要调用。
 */
export function __resetTaskRepoForTests(): void {
  cached = null
}
