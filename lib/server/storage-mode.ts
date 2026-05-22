/**
 * STORAGE_MODE 双轨开关。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR2 引入：
 * - `local`：沿用 `data/fashion-mvp-store.json` + 本地图片目录
 *   （默认 `public/generated/**`，可用 `LOCAL_IMAGE_ROOT` 指到仓库外），
 *   user / session 走内存 mock，便于无网开发与客户演示。
 * - `cloud`：调用 Cloudflare D1 / KV / R2 真实远程服务。
 *
 * 本模块只暴露开关，**不实现** storage-adapter（PR3 才做）。任何 server 端
 * 文件需要走双轨逻辑时，必须读取这里的常量，不要散落 `process.env.STORAGE_MODE`。
 */

export type StorageMode = 'local' | 'cloud'

function readStorageMode(): StorageMode {
  const raw = process.env.STORAGE_MODE?.trim().toLowerCase()
  if (raw === 'cloud') return 'cloud'
  return 'local'
}

export const STORAGE_MODE: StorageMode = readStorageMode()

export function isLocal(): boolean {
  return STORAGE_MODE === 'local'
}

export function isCloud(): boolean {
  return STORAGE_MODE === 'cloud'
}
