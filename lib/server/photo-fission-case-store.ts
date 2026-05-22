import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<HiddenState>

    if (Array.isArray(parsed.hiddenCaseIds)) {
      store.hiddenCases = new Set(
        parsed.hiddenCaseIds.filter(
          (id): id is string => typeof id === 'string',
        ),
      )
    }

    if (parsed.hiddenShots && typeof parsed.hiddenShots === 'object') {
      const map = new Map<string, Set<number>>()
      for (const [caseId, indices] of Object.entries(parsed.hiddenShots)) {
        if (!Array.isArray(indices)) continue
        const numericIndices = indices.filter(
          (value): value is number =>
            typeof value === 'number' && Number.isInteger(value) && value >= 0,
        )
        if (numericIndices.length) {
          map.set(caseId, new Set(numericIndices))
        }
      }
      store.hiddenShots = map
    }
  } catch {
    // 首次启动 / 文件不存在：当作空隐藏集合
  }
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
  await mkdir(dataDir, { recursive: true })
  const payload: HiddenState = {
    hiddenCaseIds: Array.from(store.hiddenCases),
    hiddenShots: Object.fromEntries(
      Array.from(store.hiddenShots.entries()).map(([caseId, indices]) => [
        caseId,
        Array.from(indices).sort((a, b) => a - b),
      ]),
    ),
  }
  await writeFile(stateFilePath, JSON.stringify(payload, null, 2), 'utf8')
}

async function ensureReady() {
  if (!stateLoaded) await stateReady
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
