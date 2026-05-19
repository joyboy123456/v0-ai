/**
 * 本地（in-process Map + JSON 文件）TaskRepo 实现。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR3 引入。
 *
 * 设计要点：
 * - **共享 `globalThis.fashionMvpStore`**：本仓储不引入新的持久化层；
 *   它是 task-store.ts 现有 Map 之上的「薄翻译层」，把 row shape 与
 *   `GenerationTask` / `AssetRecord` 互转。
 * - 这样在 local 模式下，task-store 调 `getTaskRepo()` 写入的数据，
 *   与现有 `store.tasks.set(...)` 写入的数据是**同一份** Map，
 *   不会双写 / 不一致，也不破坏 streaming-fission-pipeline 流式持久化契约。
 * - JSON 文件落盘仍由 task-store.ts 内部的 `persistStore()` 串行化负责，
 *   本仓储不再独立 IO。
 *
 * 关于「先不按 userId 过滤」（任务说明明确要求）：
 * - listTasksByUser / listAssetsByUser **暂返回全表**，过滤交给 PR4 实现。
 * - getTask / getAsset 也不校验 ownership。
 */

import type {
  AssetRecord,
  FeatureType,
  GenerationTask,
  TaskParams,
} from '@/lib/types'

import type { AssetRow, TaskRepo, TaskRow } from './task-repo'

interface LocalStore {
  assets: Map<string, AssetRecord>
  tasks: Map<string, GenerationTask>
}

const globalStore = globalThis as typeof globalThis & {
  fashionMvpStore?: LocalStore
}

/**
 * 与 task-store.ts:33 同名 / 同结构的全局 store。
 * 两边读写同一份 Map，由 task-store.ts 负责 JSON 持久化与 lifecycle。
 */
function getSharedStore(): LocalStore {
  if (!globalStore.fashionMvpStore) {
    globalStore.fashionMvpStore = {
      assets: new Map<string, AssetRecord>(),
      tasks: new Map<string, GenerationTask>(),
    }
  }
  return globalStore.fashionMvpStore
}

// -----------------------------------------------------------------------------
// 双向 mapping：TaskRow <-> GenerationTask、AssetRow <-> AssetRecord
// -----------------------------------------------------------------------------

const DEFAULT_USER_ID_FALLBACK = 'demo_user'

function taskToRow(task: GenerationTask): TaskRow {
  const createdMs = parseTimestamp(task.createdAt) ?? Date.now()
  const updatedMs = parseTimestamp(task.finishedAt) ?? createdMs
  return {
    id: task.taskId,
    userId: DEFAULT_USER_ID_FALLBACK, // PR4 接通 auth 后才真有用户身份
    type: task.featureType,
    status: task.status,
    payloadJson: safeJson({
      featureType: task.featureType,
      workflowId: task.workflowId,
      inputAssetIds: task.inputAssetIds,
      params: task.params,
      progress: task.progress,
      message: task.message,
      errorMessage: task.errorMessage,
      creditsUsed: task.creditsUsed,
    }),
    resultJson: safeJson({
      resultAssetIds: task.resultAssetIds,
      results: task.results,
      finishedAt: task.finishedAt,
    }),
    createdAt: createdMs,
    updatedAt: updatedMs,
  }
}

function rowToTask(row: TaskRow): GenerationTask {
  const payload = safeParse<{
    featureType?: FeatureType
    workflowId?: string
    inputAssetIds?: string[]
    params?: TaskParams
    progress?: number
    message?: string
    errorMessage?: string
    creditsUsed?: number
  }>(row.payloadJson)
  const result = safeParse<{
    resultAssetIds?: string[]
    results?: GenerationTask['results']
    finishedAt?: string
  }>(row.resultJson)

  return {
    taskId: row.id,
    featureType: (payload?.featureType ?? row.type) as FeatureType,
    workflowId: payload?.workflowId ?? '',
    inputAssetIds: payload?.inputAssetIds ?? [],
    params: (payload?.params ?? {}) as TaskParams,
    status: row.status as GenerationTask['status'],
    progress: payload?.progress ?? 0,
    message: payload?.message ?? '',
    errorMessage: payload?.errorMessage,
    creditsUsed: payload?.creditsUsed ?? 0,
    resultAssetIds: result?.resultAssetIds ?? [],
    results: result?.results ?? [],
    createdAt: new Date(row.createdAt).toISOString(),
    finishedAt: result?.finishedAt,
  }
}

function assetToRow(asset: AssetRecord): AssetRow {
  const createdMs = parseTimestamp(asset.createdAt) ?? Date.now()
  return {
    id: asset.assetId,
    userId: asset.userId || DEFAULT_USER_ID_FALLBACK,
    // PR4：AssetRecord 增加了 taskId 字段（仅 generated 资产有意义）。
    taskId: asset.taskId ?? null,
    kind: asset.fileUrl?.includes('/results/') ? 'generated' : 'upload',
    r2Key: asset.fileUrl ?? '',
    publicUrl: asset.fileUrl ?? null,
    mime: asset.fileType ?? null,
    bytes: null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    createdAt: createdMs,
  }
}

function rowToAsset(row: AssetRow): AssetRecord {
  return {
    assetId: row.id,
    userId: row.userId,
    projectId: 'demo_project',
    fileName: row.id,
    fileUrl: row.publicUrl ?? row.r2Key,
    fileType: row.mime ?? 'image/jpeg',
    width: row.width ?? 1024,
    height: row.height ?? 1365,
    createdAt: new Date(row.createdAt).toISOString(),
    taskId: row.taskId ?? null,
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return 'null'
  }
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function parseTimestamp(iso: string | undefined): number | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? time : null
}

// -----------------------------------------------------------------------------
// Repo 实现
// -----------------------------------------------------------------------------

export function createLocalTaskRepo(): TaskRepo {
  return {
    async insertTask(row) {
      const store = getSharedStore()
      const existing = store.tasks.get(row.id)
      // 如果已经存在 rich task（task-store.ts createTask 设进来的），
      // 不要用 minimal row 覆盖；only fill in missing fields.
      // 这避免 cloud 模式调用方误把 row 写回 rich Map 时丢失 inputAssets 等字段。
      if (existing) return
      store.tasks.set(row.id, rowToTask(row))
    },

    async updateTask(id, patch) {
      const store = getSharedStore()
      const existing = store.tasks.get(id)
      if (!existing) return

      const next: GenerationTask = { ...existing }
      if (patch.status !== undefined) {
        next.status = patch.status as GenerationTask['status']
      }
      if (patch.payloadJson !== undefined) {
        const parsed = safeParse<{
          progress?: number
          message?: string
          errorMessage?: string
          creditsUsed?: number
          inputAssetIds?: string[]
          params?: TaskParams
        }>(patch.payloadJson)
        if (parsed) {
          if (parsed.progress !== undefined) next.progress = parsed.progress
          if (parsed.message !== undefined) next.message = parsed.message
          if (parsed.errorMessage !== undefined) {
            next.errorMessage = parsed.errorMessage
          }
          if (parsed.creditsUsed !== undefined) {
            next.creditsUsed = parsed.creditsUsed
          }
          if (parsed.inputAssetIds !== undefined) {
            next.inputAssetIds = parsed.inputAssetIds
          }
          if (parsed.params !== undefined) {
            next.params = parsed.params
          }
        }
      }
      if (patch.resultJson !== undefined) {
        const parsed = safeParse<{
          resultAssetIds?: string[]
          results?: GenerationTask['results']
          finishedAt?: string
        }>(patch.resultJson)
        if (parsed) {
          if (parsed.resultAssetIds !== undefined) {
            next.resultAssetIds = parsed.resultAssetIds
          }
          if (parsed.results !== undefined) next.results = parsed.results
          if (parsed.finishedAt !== undefined) next.finishedAt = parsed.finishedAt
        }
      }
      store.tasks.set(id, next)
    },

    async getTask(id) {
      const store = getSharedStore()
      const task = store.tasks.get(id)
      return task ? taskToRow(task) : null
    },

    async listTasksByUser(userId, opts) {
      // PR4：按 userId 过滤。空字符串 / 'demo_user' 视为「不过滤」（兼容历史调用）。
      const store = getSharedStore()
      const all = Array.from(store.tasks.values())
        .map(taskToRow)
        .filter((row) => {
          if (!userId || userId === DEFAULT_USER_ID_FALLBACK) return true
          return row.userId === userId
        })
        .sort((a, b) => b.createdAt - a.createdAt)
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? all.length
      return all.slice(offset, offset + limit)
    },

    async deleteTask(id) {
      const store = getSharedStore()
      store.tasks.delete(id)
    },

    async insertAsset(row) {
      const store = getSharedStore()
      if (store.assets.has(row.id)) return
      store.assets.set(row.id, rowToAsset(row))
    },

    async getAsset(id) {
      const store = getSharedStore()
      const asset = store.assets.get(id)
      return asset ? assetToRow(asset) : null
    },

    async listAssetsByTask(taskId) {
      // PR4：AssetRecord 现已携带 taskId 字段，按 taskId 过滤即可。
      const store = getSharedStore()
      return Array.from(store.assets.values())
        .filter((asset) => asset.taskId === taskId)
        .map(assetToRow)
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    async listAssetsByUser(userId, opts) {
      const store = getSharedStore()
      const all = Array.from(store.assets.values())
        .filter((asset) => {
          if (!userId || userId === DEFAULT_USER_ID_FALLBACK) return true
          return asset.userId === userId
        })
        .map(assetToRow)
        .sort((a, b) => b.createdAt - a.createdAt)
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? all.length
      return all.slice(offset, offset + limit)
    },

    async deleteAsset(id) {
      const store = getSharedStore()
      store.assets.delete(id)
    },
  }
}
