/**
 * 图片存储抽象层：屏蔽 `STORAGE_MODE=local` 与 `STORAGE_MODE=cloud` 差异。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR3 引入。所有业务代码（task-store /
 * service 层）**禁止**直接 `import` r2-client；必须通过 `getStorageAdapter()`
 * 拿到 adapter 调用 `putImage` / `putImageFromDataUrl` / `getImage`。
 *
 * 路径约定（参考 prd.md §D5「完全私有的数据隔离」）：
 * - local 模式：
 *   - 默认根目录：`public/generated/{bucket}/{userId}/{filename}`
 *     publicUrl = `/generated/{bucket}/{userId}/{filename}`
 *   - 设置 `LOCAL_IMAGE_ROOT` 后：`{LOCAL_IMAGE_ROOT}/{bucket}/{userId}/{filename}`
 *     publicUrl = `/local-assets/{bucket}/{userId}/{filename}`
 *   - 匿名（PR3 兼容现状）不带 `{userId}` 段（PR4 接通 auth 后逐步去掉匿名兜底）
 * - cloud 模式：
 *   - key = `users/{userId}/{bucket}/{filename}`
 *   - publicUrl = `R2_PUBLIC_URL + '/' + key`
 *   - userId 为空直接抛出 NotAuthorized（cloud 不允许匿名）
 *
 * 流式持久化契约：
 * 本 adapter 是同步 put 单文件，符合 `streaming-fission-pipeline.md` 里
 * 「每个 shot 成功立即写盘」的预期；并发写不同 key 在两种模式下都安全
 * （local 各自 mkdir + writeFile 不会冲突；R2 PUT 互不影响）。
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { isCloud, isLocal } from '@/lib/server/storage-mode'

import {
  buildR2PublicUrl,
  r2Delete,
  r2Get,
  r2Put,
} from './r2-client'

export type StorageBucket = 'uploads' | 'generated' | 'results' | 'assets'

export interface PutImageInput {
  /** 用户身份。local 模式可空（退化为匿名）；cloud 模式必填 */
  userId: string | null
  bucket: StorageBucket
  /** 不含路径，例如 "abc.png" */
  filename: string
  body: Buffer | Uint8Array
  contentType: string
}

export interface PutImageFromDataUrlInput {
  userId: string | null
  bucket: StorageBucket
  filename: string
  /** "data:image/png;base64,xxx" */
  dataUrl: string
}

export interface PutImageResult {
  /** 存储层 key：local 是磁盘相对路径，cloud 是 R2 object key */
  key: string
  /** 可对外公开访问的 URL：local 是本应用本地 URL，cloud 是 R2 公共 URL */
  publicUrl: string
  bytes: number
}

export interface PutImageFromDataUrlResult extends PutImageResult {
  mime: string
}

export interface GetImageResult {
  body: ArrayBuffer
  contentType?: string
}

export interface StorageAdapter {
  putImage(input: PutImageInput): Promise<PutImageResult>
  putImageFromDataUrl(
    input: PutImageFromDataUrlInput,
  ): Promise<PutImageFromDataUrlResult>
  /**
   * 仅 local 模式提供完整支持（按相对 publicUrl 反查文件）；
   * cloud 模式应让浏览器直接走 R2 CDN，本方法只在服务端真有需求时调用。
   */
  getImage(key: string): Promise<GetImageResult | null>
  deleteImage(key: string): Promise<void>
}

// -----------------------------------------------------------------------------
// 工具
// -----------------------------------------------------------------------------

const workspaceRoot = process.cwd()
const publicRootDir = path.join(workspaceRoot, 'public')
const publicGeneratedDir = path.join(publicRootDir, 'generated')
const localAssetPublicPrefix = '/local-assets'

function readLocalImageRootDir(): string {
  const raw = process.env.LOCAL_IMAGE_ROOT?.trim()
  if (!raw) return publicGeneratedDir
  return path.resolve(workspaceRoot, raw)
}

function isCustomLocalImageRoot(): boolean {
  return readLocalImageRootDir() !== publicGeneratedDir
}

function parseDataUrl(
  dataUrl: string,
): { mime: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  const mime = match[1] || 'application/octet-stream'
  const buffer = Buffer.from(match[2], 'base64')
  return { mime, buffer }
}

function isAnonymousUser(userId: string | null | undefined): boolean {
  if (!userId) return true
  const trimmed = userId.trim()
  if (!trimmed) return true
  return trimmed === 'anonymous' || trimmed === 'demo_user'
}

function sanitizeUserSegment(userId: string): string {
  // 仅允许字母数字 + 下划线 + 短横线，避免 `..` / `/` 注入。
  // userId 来自 PR2 user-repo，本身应该安全；这里再加一层防御。
  return userId.replace(/[^A-Za-z0-9_-]/g, '_')
}

function sanitizeBucket(bucket: StorageBucket): StorageBucket {
  // 白名单：StorageBucket 联合类型保证只可能是这几个值，无需 runtime 校验。
  return bucket
}

function buildLocalRelativePath(
  bucket: StorageBucket,
  userId: string | null | undefined,
  filename: string,
): string {
  return isAnonymousUser(userId)
    ? path.posix.join(bucket, filename)
    : path.posix.join(bucket, sanitizeUserSegment(userId as string), filename)
}

function buildLocalPublicUrl(relativePath: string): string {
  if (isCustomLocalImageRoot()) {
    return `${localAssetPublicPrefix}/${relativePath}`
  }
  return `/generated/${relativePath}`
}

function normalizeLocalImageKey(
  key: string,
): { root: string; relativePath: string } {
  const withoutQuery = key.split('?')[0] ?? key
  const normalized = withoutQuery.replace(/^\//, '')
  if (normalized.startsWith('generated/')) {
    return {
      root: publicGeneratedDir,
      relativePath: normalized.slice('generated/'.length),
    }
  }
  if (normalized.startsWith('local-assets/')) {
    return {
      root: readLocalImageRootDir(),
      relativePath: normalized.slice('local-assets/'.length),
    }
  }
  return {
    root: readLocalImageRootDir(),
    relativePath: normalized,
  }
}

function resolveLocalImagePath(key: string): string | null {
  const { root, relativePath } = normalizeLocalImageKey(key)
  const absolutePath = path.resolve(root, relativePath)
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (absolutePath !== root && !absolutePath.startsWith(rootWithSeparator)) {
    return null
  }
  return absolutePath
}

function inferContentType(absolutePath: string): string {
  const ext = path.extname(absolutePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

async function readLocalImageByKey(key: string): Promise<GetImageResult | null> {
  const absolutePath = resolveLocalImagePath(key)
  if (!absolutePath) return null

  try {
    const buffer = await readFile(absolutePath)
    return {
      body: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
      contentType: inferContentType(absolutePath),
    }
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
// Local 实现
// -----------------------------------------------------------------------------

const localAdapter: StorageAdapter = {
  async putImage(input) {
    const bucket = sanitizeBucket(input.bucket)
    const relativePath = buildLocalRelativePath(
      bucket,
      input.userId,
      input.filename,
    )
    const absolutePath = resolveLocalImagePath(relativePath)
    if (!absolutePath) {
      throw new Error(`本地图片路径不合法（filename=${input.filename}）`)
    }
    const dir = path.dirname(absolutePath)

    await mkdir(dir, { recursive: true })
    const buffer =
      input.body instanceof Buffer ? input.body : Buffer.from(input.body)
    await writeFile(absolutePath, buffer)
    const publicUrl = buildLocalPublicUrl(relativePath)

    return {
      key: publicUrl,
      publicUrl,
      bytes: buffer.byteLength,
    }
  },

  async putImageFromDataUrl(input) {
    const parsed = parseDataUrl(input.dataUrl)
    if (!parsed) {
      throw new Error(`无法解析 dataURL（filename=${input.filename}）`)
    }
    const result = await this.putImage({
      userId: input.userId,
      bucket: input.bucket,
      filename: input.filename,
      body: parsed.buffer,
      contentType: parsed.mime,
    })
    return { ...result, mime: parsed.mime }
  },

  async getImage(key) {
    // local 模式 key 与 publicUrl 同形，兼容旧 `/generated/...` 与新 `/local-assets/...`。
    return readLocalImageByKey(key)
  },

  async deleteImage(key) {
    const absolutePath = resolveLocalImagePath(key)
    if (!absolutePath) return
    try {
      await unlink(absolutePath)
    } catch {
      // best-effort：文件不存在 / 并发删除 / 权限问题都吞掉
    }
  },
}

// -----------------------------------------------------------------------------
// Cloud 实现
// -----------------------------------------------------------------------------

function requireCloudUserId(userId: string | null | undefined): string {
  if (isAnonymousUser(userId)) {
    throw new Error(
      'storage-adapter: cloud 模式不允许匿名写入，必须传入有效 userId',
    )
  }
  return userId as string
}

function buildCloudKey(
  userId: string,
  bucket: StorageBucket,
  filename: string,
): string {
  const safeUser = sanitizeUserSegment(userId)
  return `users/${safeUser}/${bucket}/${filename}`
}

const cloudAdapter: StorageAdapter = {
  async putImage(input) {
    const userId = requireCloudUserId(input.userId)
    const key = buildCloudKey(userId, sanitizeBucket(input.bucket), input.filename)
    const result = await r2Put({
      key,
      body: input.body,
      contentType: input.contentType,
    })
    return {
      key: result.key,
      publicUrl: result.publicUrl,
      bytes: result.bytes,
    }
  },

  async putImageFromDataUrl(input) {
    const parsed = parseDataUrl(input.dataUrl)
    if (!parsed) {
      throw new Error(`无法解析 dataURL（filename=${input.filename}）`)
    }
    const result = await this.putImage({
      userId: input.userId,
      bucket: input.bucket,
      filename: input.filename,
      body: parsed.buffer,
      contentType: parsed.mime,
    })
    return { ...result, mime: parsed.mime }
  },

  async getImage(key) {
    // cloud 模式服务端理论上不需要回读图片（图片直接由浏览器从 R2 CDN 拉），
    // 但保留 GET 入口给未来 / 测试用。
    try {
      const { body, contentType } = await r2Get(key)
      return { body, contentType }
    } catch (error) {
      // NOT_FOUND 直接降级为 null；其他错误冒泡
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'NOT_FOUND'
      ) {
        return null
      }
      throw error
    }
  },

  async deleteImage(key) {
    await r2Delete(key)
  },
}

// -----------------------------------------------------------------------------
// 工厂
// -----------------------------------------------------------------------------

let cachedAdapter: StorageAdapter | null = null
let cachedMode: 'local' | 'cloud' | null = null

export function getStorageAdapter(): StorageAdapter {
  const mode: 'local' | 'cloud' = isCloud() ? 'cloud' : 'local'
  if (cachedAdapter && cachedMode === mode) {
    return cachedAdapter
  }
  cachedAdapter = mode === 'cloud' ? cloudAdapter : localAdapter
  cachedMode = mode
  return cachedAdapter
}

/**
 * 仅供测试：清空 adapter cache。生产代码不要调用。
 */
export function __resetStorageAdapterForTests(): void {
  cachedAdapter = null
  cachedMode = null
}

/**
 * 把 R2 公共 URL（cloud 模式）或 publicUrl 反推出来。
 * local 模式 publicUrl 已经在 putImage 返回过；cloud 模式偶尔需要从历史 key 拼 URL。
 */
export function buildPublicUrlForKey(key: string): string {
  if (isLocal()) {
    return key.startsWith('/') ? key : `/${key}`
  }
  return buildR2PublicUrl(key)
}

/**
 * 供 `/local-assets/[...path]` route 和 task-store 服务端回读使用。
 * 只读取 local 图片根目录内的文件；路径逃逸会返回 null。
 */
export async function getLocalImageForPublicUrl(
  publicUrl: string,
): Promise<GetImageResult | null> {
  return readLocalImageByKey(publicUrl)
}

export function buildLocalAssetPublicUrl(relativePath: string): string {
  return buildLocalPublicUrl(relativePath)
}
