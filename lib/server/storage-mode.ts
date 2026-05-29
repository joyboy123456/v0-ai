/**
 * STORAGE_MODE 双轨开关。
 *
 * - `local`：沿用本地图片目录
 * - `oss`：阿里云 OSS 对象存储（适合国内 ECS 部署）
 */

export type StorageMode = 'local' | 'oss'

function readStorageMode(): StorageMode {
  const raw = process.env.STORAGE_MODE?.trim().toLowerCase()
  if (raw === 'oss') return 'oss'
  return 'local'
}

export const STORAGE_MODE: StorageMode = readStorageMode()

export function isLocal(): boolean {
  return STORAGE_MODE === 'local'
}

export function isOss(): boolean {
  return STORAGE_MODE === 'oss'
}
