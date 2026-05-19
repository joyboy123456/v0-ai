/**
 * D1（Cloudflare 远程 SQLite）TaskRepo 实现。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR3 引入。
 *
 * 设计要点：
 * - 通过 `executeD1Query`（cloudflare/d1-client.ts）走 HTTPS REST API。
 * - DB schema 用 snake_case（与 prd.md §「D1 Schema 草案」 + PR1 migration 一致），
 *   row mapping 在本文件统一翻译成 camelCase；业务层不感知 DB 命名。
 * - 全部 SQL 用参数化 query，防注入。
 * - 不带重试。失败抛 `CloudflareError`，由上层（task-store.ts）决定怎么落到
 *   用户错误（partial / failed 状态）。
 */

import { executeD1Query } from '@/lib/server/cloudflare'

import type { AssetRow, TaskRepo, TaskRow } from './task-repo'

interface DbTaskRow {
  id: string
  user_id: string
  type: string
  status: string
  payload_json: string | null
  result_json: string | null
  created_at: number
  updated_at: number
}

interface DbAssetRow {
  id: string
  user_id: string
  task_id: string | null
  kind: string
  r2_key: string
  public_url: string | null
  mime: string | null
  bytes: number | null
  width: number | null
  height: number | null
  created_at: number
}

function dbToTaskRow(row: DbTaskRow): TaskRow {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    payloadJson: row.payload_json,
    resultJson: row.result_json,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  }
}

function dbToAssetRow(row: DbAssetRow): AssetRow {
  const kind = row.kind === 'generated' ? 'generated' : 'upload'
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id ?? null,
    kind,
    r2Key: row.r2_key,
    publicUrl: row.public_url ?? null,
    mime: row.mime ?? null,
    bytes: row.bytes ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    createdAt: Number(row.created_at) || 0,
  }
}

export function createD1TaskRepo(): TaskRepo {
  return {
    async insertTask(task) {
      await executeD1Query(
        `INSERT INTO tasks (id, user_id, type, status, payload_json, result_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          task.id,
          task.userId,
          task.type,
          task.status,
          task.payloadJson,
          task.resultJson,
          task.createdAt,
          task.updatedAt,
        ],
      )
    },

    async updateTask(id, patch) {
      const fields: string[] = []
      const params: unknown[] = []

      if (patch.type !== undefined) {
        fields.push('type = ?')
        params.push(patch.type)
      }
      if (patch.status !== undefined) {
        fields.push('status = ?')
        params.push(patch.status)
      }
      if (patch.payloadJson !== undefined) {
        fields.push('payload_json = ?')
        params.push(patch.payloadJson)
      }
      if (patch.resultJson !== undefined) {
        fields.push('result_json = ?')
        params.push(patch.resultJson)
      }
      // updated_at 总是刷新成现在
      fields.push('updated_at = ?')
      params.push(patch.updatedAt ?? Date.now())

      if (fields.length === 1) {
        // 只有 updated_at，没意义；跳过 SQL
        return
      }

      params.push(id)
      await executeD1Query(
        `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`,
        params,
      )
    },

    async getTask(id) {
      const { results } = await executeD1Query<DbTaskRow>(
        `SELECT id, user_id, type, status, payload_json, result_json, created_at, updated_at
         FROM tasks WHERE id = ? LIMIT 1`,
        [id],
      )
      const row = results[0]
      return row ? dbToTaskRow(row) : null
    },

    async listTasksByUser(userId, opts) {
      const limit = opts?.limit ?? 100
      const offset = opts?.offset ?? 0
      const { results } = await executeD1Query<DbTaskRow>(
        `SELECT id, user_id, type, status, payload_json, result_json, created_at, updated_at
         FROM tasks WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset],
      )
      return results.map(dbToTaskRow)
    },

    async deleteTask(id) {
      // 先删 assets 再删 task，避免外键孤儿（D1 默认不强制外键，但保守起见）
      await executeD1Query(`DELETE FROM assets WHERE task_id = ?`, [id])
      await executeD1Query(`DELETE FROM tasks WHERE id = ?`, [id])
    },

    async insertAsset(asset) {
      await executeD1Query(
        `INSERT INTO assets (id, user_id, task_id, kind, r2_key, public_url, mime, bytes, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          asset.id,
          asset.userId,
          asset.taskId,
          asset.kind,
          asset.r2Key,
          asset.publicUrl,
          asset.mime,
          asset.bytes,
          asset.width,
          asset.height,
          asset.createdAt,
        ],
      )
    },

    async getAsset(id) {
      const { results } = await executeD1Query<DbAssetRow>(
        `SELECT id, user_id, task_id, kind, r2_key, public_url, mime, bytes, width, height, created_at
         FROM assets WHERE id = ? LIMIT 1`,
        [id],
      )
      const row = results[0]
      return row ? dbToAssetRow(row) : null
    },

    async listAssetsByTask(taskId) {
      const { results } = await executeD1Query<DbAssetRow>(
        `SELECT id, user_id, task_id, kind, r2_key, public_url, mime, bytes, width, height, created_at
         FROM assets WHERE task_id = ?
         ORDER BY created_at ASC`,
        [taskId],
      )
      return results.map(dbToAssetRow)
    },

    async listAssetsByUser(userId, opts) {
      const limit = opts?.limit ?? 100
      const offset = opts?.offset ?? 0
      const { results } = await executeD1Query<DbAssetRow>(
        `SELECT id, user_id, task_id, kind, r2_key, public_url, mime, bytes, width, height, created_at
         FROM assets WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset],
      )
      return results.map(dbToAssetRow)
    },

    async deleteAsset(id) {
      await executeD1Query(`DELETE FROM assets WHERE id = ?`, [id])
    },
  }
}
