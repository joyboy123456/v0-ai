import path from 'node:path'
import {
  loadJsonFileWithRecovery,
  writeJsonFileAtomic,
} from '@/lib/server/json-file-store'
import type { CompanyModel } from '@/lib/types'

/**
 * 模特库（按登录用户持久化）。
 *
 * 背景：图片文件本身已经通过 /api/assets/upload 落 OSS（生产 STORAGE_MODE=oss），
 * 但「哪些图属于我的模特库」这份列表历史上只存在浏览器 localStorage，换设备即丢。
 * 本 store 把这份列表搬到服务端、按 userId 持久化，使模特库跨设备一致。
 *
 * 结构完全照搬 saved-pose-store.ts：globalThis 单例 + json-file-store 的
 * 损坏恢复加载 / 原子写 + persistChain 串行化落盘。
 *
 * 两个库共用 CompanyModel 结构（lib/types.ts），以 assetId 为去重主键：
 * - company：AI服装大片的「我的模特库」
 * - faceId ：服装大片裂变的「证件照 / 五官模特库」
 */

export type ModelLibrary = 'company' | 'faceId'

interface UserModelLibraries {
  companyModels: CompanyModel[]
  faceIdModels: CompanyModel[]
}

interface PersistedState {
  [userId: string]: UserModelLibraries
}

const globalStore = globalThis as typeof globalThis & {
  companyModelStore?: {
    byUserId: Map<string, UserModelLibraries>
  }
}

const store = globalStore.companyModelStore ?? {
  byUserId: new Map<string, UserModelLibraries>(),
}

globalStore.companyModelStore = store

const workspaceRoot = process.cwd()
const dataDir = path.join(workspaceRoot, 'data')
const stateFilePath = path.join(dataDir, 'company-models.json')

let stateLoaded = false
const stateReady = loadState().finally(() => {
  stateLoaded = true
})

function emptyLibraries(): UserModelLibraries {
  return { companyModels: [], faceIdModels: [] }
}

function libraryKey(library: ModelLibrary): keyof UserModelLibraries {
  return library === 'faceId' ? 'faceIdModels' : 'companyModels'
}

async function loadState() {
  const parsed = await loadJsonFileWithRecovery({
    filePath: stateFilePath,
    label: 'company-model-store',
    parse: parsePersistedState,
  })
  if (!parsed) return

  const next = new Map<string, UserModelLibraries>()
  for (const [userId, libs] of Object.entries(parsed)) {
    if (libs.companyModels.length || libs.faceIdModels.length) {
      next.set(userId, libs)
    }
  }
  store.byUserId = next
}

let persistChain: Promise<void> = Promise.resolve()

function persistState(): Promise<void> {
  const next = persistChain
    .catch(() => undefined)
    .then(() => writeStateFile())
  persistChain = next.catch(() => undefined)
  return next
}

async function writeStateFile() {
  const payload: PersistedState = Object.fromEntries(
    Array.from(store.byUserId.entries()).map(([userId, libs]) => [userId, libs]),
  )
  await writeJsonFileAtomic(stateFilePath, payload, 'company-model-store')
}

async function ensureReady() {
  if (!stateLoaded) await stateReady
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验并清洗单个 CompanyModel。沿用前端历史规则：preview 必须是字符串、
 * 且丢弃 `blob:` 预览（换设备无效的临时对象 URL）。
 */
function sanitizeCompanyModel(value: unknown): CompanyModel | null {
  if (!isRecord(value)) return null
  if (
    typeof value.assetId !== 'string' ||
    !value.assetId.trim() ||
    typeof value.preview !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height) ||
    typeof value.createdAt !== 'string'
  ) {
    return null
  }
  if (value.preview.startsWith('blob:')) return null
  return {
    assetId: value.assetId,
    preview: value.preview,
    name: value.name,
    width: value.width,
    height: value.height,
    createdAt: value.createdAt,
  }
}

function sanitizeLibraries(value: unknown): UserModelLibraries {
  const libs = emptyLibraries()
  if (!isRecord(value)) return libs
  if (Array.isArray(value.companyModels)) {
    libs.companyModels = value.companyModels
      .map(sanitizeCompanyModel)
      .filter((m): m is CompanyModel => Boolean(m))
  }
  if (Array.isArray(value.faceIdModels)) {
    libs.faceIdModels = value.faceIdModels
      .map(sanitizeCompanyModel)
      .filter((m): m is CompanyModel => Boolean(m))
  }
  return libs
}

function parsePersistedState(value: unknown): PersistedState {
  if (!isRecord(value)) {
    throw new Error('模特库 JSON 根节点必须是对象')
  }
  const parsed: PersistedState = {}
  for (const [userId, libs] of Object.entries(value)) {
    const sanitized = sanitizeLibraries(libs)
    if (sanitized.companyModels.length || sanitized.faceIdModels.length) {
      parsed[userId] = sanitized
    }
  }
  return parsed
}

function getUserLibraries(userId: string): UserModelLibraries {
  return store.byUserId.get(userId) ?? emptyLibraries()
}

function setUserLibraries(userId: string, libs: UserModelLibraries) {
  if (libs.companyModels.length || libs.faceIdModels.length) {
    store.byUserId.set(userId, libs)
  } else {
    store.byUserId.delete(userId)
  }
}

function cloneModels(models: CompanyModel[]): CompanyModel[] {
  return models.map((model) => ({ ...model }))
}

// -----------------------------------------------------------------------------
// 对外 API
// -----------------------------------------------------------------------------

export async function listModels(
  userId: string,
): Promise<{ companyModels: CompanyModel[]; faceIdModels: CompanyModel[] }> {
  await ensureReady()
  const libs = getUserLibraries(userId)
  return {
    companyModels: cloneModels(libs.companyModels),
    faceIdModels: cloneModels(libs.faceIdModels),
  }
}

/**
 * 新增模特到指定库。按 assetId 去重：已存在则幂等返回既有项；否则插入队首。
 */
export async function addModel(
  userId: string,
  library: ModelLibrary,
  input: {
    assetId: string
    preview: string
    name: string
    width: number
    height: number
    createdAt?: string
  },
): Promise<CompanyModel> {
  await ensureReady()

  const libs = getUserLibraries(userId)
  const key = libraryKey(library)
  const list = libs[key]

  const existing = list.find((model) => model.assetId === input.assetId)
  if (existing) return { ...existing }

  const model: CompanyModel = {
    assetId: input.assetId,
    preview: input.preview,
    name: input.name,
    width: input.width,
    height: input.height,
    createdAt: input.createdAt?.trim() || new Date().toISOString(),
  }

  setUserLibraries(userId, { ...libs, [key]: [model, ...list] })
  await persistState()
  return { ...model }
}

export async function renameModel(
  userId: string,
  library: ModelLibrary,
  assetId: string,
  name: string,
): Promise<boolean> {
  await ensureReady()

  const libs = getUserLibraries(userId)
  const key = libraryKey(library)
  const list = libs[key]
  const index = list.findIndex((model) => model.assetId === assetId)
  if (index < 0) return false

  const next = list.map((model, modelIndex) =>
    modelIndex === index ? { ...model, name } : model,
  )
  setUserLibraries(userId, { ...libs, [key]: next })
  await persistState()
  return true
}

export async function deleteModel(
  userId: string,
  library: ModelLibrary,
  assetId: string,
): Promise<boolean> {
  await ensureReady()

  const libs = getUserLibraries(userId)
  const key = libraryKey(library)
  const list = libs[key]
  if (!list.length) return false

  const next = list.filter((model) => model.assetId !== assetId)
  if (next.length === list.length) return false

  setUserLibraries(userId, { ...libs, [key]: next })
  await persistState()
  return true
}

/**
 * 该 assetId 是否仍存在于任一库（company / faceId）。
 * 供物理删除前的跨库保护：同一张图可能同时被两个库引用。
 */
export async function hasModelInAnyLibrary(
  userId: string,
  assetId: string,
): Promise<boolean> {
  await ensureReady()
  const libs = getUserLibraries(userId)
  return (
    libs.companyModels.some((model) => model.assetId === assetId) ||
    libs.faceIdModels.some((model) => model.assetId === assetId)
  )
}

/**
 * 存量迁移：把前端 legacy localStorage 列表合并进服务端。
 * 以服务端为准，按 assetId 合并 legacy 中服务端尚无的项；返回合并后的列表。
 * 幂等：重复调用不会产生重复项。
 */
export async function syncModels(
  userId: string,
  library: ModelLibrary,
  legacy: unknown[],
): Promise<CompanyModel[]> {
  await ensureReady()

  const incoming = legacy
    .map(sanitizeCompanyModel)
    .filter((m): m is CompanyModel => Boolean(m))

  const libs = getUserLibraries(userId)
  const key = libraryKey(library)
  const serverList = libs[key]
  const knownAssetIds = new Set(serverList.map((model) => model.assetId))

  // legacy 中服务端没有的项追加到队尾（保持服务端既有顺序优先）。
  const additions = incoming.filter(
    (model) => !knownAssetIds.has(model.assetId),
  )
  if (!additions.length) return cloneModels(serverList)

  const merged = [...serverList, ...additions]
  setUserLibraries(userId, { ...libs, [key]: merged })
  await persistState()
  return cloneModels(merged)
}

/**
 * 仅供测试：清空内存态。生产代码不要调用。
 */
export function __resetCompanyModelStoreForTests() {
  store.byUserId = new Map<string, UserModelLibraries>()
  stateLoaded = true
}
