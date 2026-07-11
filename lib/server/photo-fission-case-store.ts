import path from 'node:path'
import {
  loadJsonFileWithRecovery,
  writeJsonFileAtomic,
} from '@/lib/server/json-file-store'
import { PHOTO_FISSION_CASES, type PhotoFissionCase } from '@/lib/types'

/**
 * 服装大片裂变（photo-fission）案例库的「软隐藏」存储。
 *
 * 背景：PHOTO_FISSION_CASES 是 lib/types.ts 里的硬编码常量，shot 图片是
 * public/cases/photo-fission-*.jpg 静态资源。用户想删除「效果不好的」案例 / shot，
 * 不应改源码也不删静态文件 —— 这里维护一份隐藏列表，GET cases 时实时过滤。
 *
 * 数据结构：
 * - hiddenCases:  Set<caseId>          隐藏整个 case
 * - hiddenShots:  Map<caseId, Set<idx>> 隐藏单张 shot（idx 对应 resultImageUrls 的下标）
 *
 * 持久化：data/photo-fission-cases-hidden.json，跨进程冷启动复活。
 */

interface HiddenState {
  hiddenCaseIds: string[]
  hiddenShots: Record<string, number[]>
}

const globalStore = globalThis as typeof globalThis & {
  photoFissionCaseHiddenStore?: {
    hiddenCases: Set<string>
    hiddenShots: Map<string, Set<number>>
  }
}

const store = globalStore.photoFissionCaseHiddenStore ?? {
  hiddenCases: new Set<string>(),
  hiddenShots: new Map<string, Set<number>>(),
}

globalStore.photoFissionCaseHiddenStore = store

const workspaceRoot = process.cwd()
const dataDir = path.join(workspaceRoot, 'data')
const stateFilePath = path.join(dataDir, 'photo-fission-cases-hidden.json')

let stateLoaded = false
const stateReady = loadState().finally(() => {
  stateLoaded = true
})

async function loadState() {
  const parsed = await loadJsonFileWithRecovery({
    filePath: stateFilePath,
    label: 'photo-fission-case-store',
    parse: parseHiddenState,
  })
  if (!parsed) return

  store.hiddenCases = new Set(parsed.hiddenCaseIds)
  const hiddenShots = new Map<string, Set<number>>()
  for (const [caseId, indices] of Object.entries(parsed.hiddenShots)) {
    if (indices.length) {
      hiddenShots.set(caseId, new Set(indices))
    }
  }
  store.hiddenShots = hiddenShots
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
  const payload: HiddenState = {
    hiddenCaseIds: Array.from(store.hiddenCases),
    hiddenShots: Object.fromEntries(
      Array.from(store.hiddenShots.entries()).map(([caseId, indices]) => [
        caseId,
        Array.from(indices).sort((a, b) => a - b),
      ]),
    ),
  }
  await writeJsonFileAtomic(
    stateFilePath,
    payload,
    'photo-fission-case-store',
  )
}

async function ensureReady() {
  if (!stateLoaded) await stateReady
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHiddenState(value: unknown): HiddenState {
  if (!isRecord(value)) {
    throw new Error('案例隐藏配置 JSON 根节点必须是对象')
  }

  const hiddenCaseIds = Array.isArray(value.hiddenCaseIds)
    ? value.hiddenCaseIds.filter(
        (id): id is string => typeof id === 'string',
      )
    : []
  const hiddenShots: Record<string, number[]> = {}

  if (isRecord(value.hiddenShots)) {
    for (const [caseId, indices] of Object.entries(value.hiddenShots)) {
      if (!Array.isArray(indices)) continue
      const numericIndices = indices.filter(
        (index): index is number =>
          typeof index === 'number' &&
          Number.isInteger(index) &&
          index >= 0,
      )
      if (numericIndices.length) {
        hiddenShots[caseId] = numericIndices
      }
    }
  }

  return { hiddenCaseIds, hiddenShots }
}

/**
 * 返回经过隐藏过滤的案例库 —— 隐藏的 case 直接剔除，
 * 隐藏的单张 shot 从 resultImageUrls / shotLabels 中同步剔除。
 *
 * 注意：剔除单 shot 后 resultImageUrls 长度会 < 9，前端 UI 已支持 graceful 渲染
 * （PhotoFissionCaseLibrary 直接 map resultImageUrls）。
 */
export async function getVisibleCases(): Promise<PhotoFissionCase[]> {
  await ensureReady()

  return PHOTO_FISSION_CASES.filter(
    (item) => !store.hiddenCases.has(item.id),
  ).map((item) => {
    const hiddenIndexSet = store.hiddenShots.get(item.id)
    if (!hiddenIndexSet || hiddenIndexSet.size === 0) return item

    const filteredUrls: string[] = []
    const filteredLabels: string[] = []
    for (let index = 0; index < item.resultImageUrls.length; index += 1) {
      if (hiddenIndexSet.has(index)) continue
      filteredUrls.push(item.resultImageUrls[index])
      filteredLabels.push(
        item.shotLabels[index] ?? `镜头 ${index + 1}`,
      )
    }

    return {
      ...item,
      resultImageUrls: filteredUrls,
      shotLabels: filteredLabels,
    }
  })
}

/**
 * 隐藏整个 case。返回 true 表示 case 存在并完成隐藏（含已隐藏的幂等场景）。
 */
export async function hideCase(caseId: string): Promise<boolean> {
  await ensureReady()

  const exists = PHOTO_FISSION_CASES.some((item) => item.id === caseId)
  if (!exists) return false

  store.hiddenCases.add(caseId)
  // 整 case 已隐藏，单 shot 隐藏记录就是冗余了，顺手清掉
  store.hiddenShots.delete(caseId)
  await persistState()
  return true
}

/**
 * 隐藏 case 中的某张 shot。
 *
 * 用 shot 的 URL 作为标识符（前端已经渲染了它），server 在原始
 * PHOTO_FISSION_CASES 里反查下标。这样即便客户端拿到的是过滤后 case
 * （shot 下标已偏移），也能正确锚定到原始下标做隐藏。
 *
 * 返回 true：成功隐藏（含幂等）；false：caseId 不存在或 shotUrl 不在该 case 内。
 */
export async function hideCaseShot(
  caseId: string,
  shotUrl: string,
): Promise<boolean> {
  await ensureReady()

  const target = PHOTO_FISSION_CASES.find((item) => item.id === caseId)
  if (!target) return false

  const shotIndex = target.resultImageUrls.indexOf(shotUrl)
  if (shotIndex < 0) return false

  const existing = store.hiddenShots.get(caseId) ?? new Set<number>()
  existing.add(shotIndex)
  store.hiddenShots.set(caseId, existing)
  await persistState()
  return true
}
