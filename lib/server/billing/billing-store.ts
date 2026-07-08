/**
 * 计费事件存储。
 *
 * 跟随 lib/server/saved-pose-store.ts 模式：
 * - 进程内 Map（按日期分组）+ data/billing-events.jsonl 持久化
 * - appendBillingEvent：异步追加到 jsonl，失败静默，绝不影响生图主流程
 * - getTodayBilling：返回今日统计（总数、总额、按模型分组明细）
 *
 * "今天"按服务器本地时区自然日 0 点计算。
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getUnitPriceUsd } from './pricing'

/** 单条计费事件。 */
export interface BillingEvent {
  /** 唯一 ID */
  id: string
  /** ISO 时间戳 */
  ts: string
  /** Unix epoch ms */
  tsMs: number
  /** 日期字符串 YYYY-MM-DD（本地时区），用于按日聚合 */
  date: string
  /** 模型 ID */
  model: string
  /** 本次调用生成图片数 */
  count: number
  /** 单价 USD/张 */
  unitPriceUsd: number
  /** 本次调用总花费 USD */
  totalUsd: number
  /** provider ID */
  providerId: string
  /** 任务 ID */
  taskId: string
  /** 功能类型 */
  featureType?: string
}

/** 按模型分组的统计。 */
export interface ModelBillingSummary {
  model: string
  unitPriceUsd: number
  /** 该模型今日生成张数 */
  count: number
  /** 该模型今日花费 USD */
  totalUsd: number
  /** 该模型今日调用次数 */
  calls: number
}

/** 今日计费统计。 */
export interface TodayBillingSummary {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 今日生成图片总数 */
  totalCount: number
  /** 今日花费总额 USD */
  totalUsd: number
  /** 今日调用总次数 */
  totalCalls: number
  /** 全部已知模型单价表 */
  modelPrices: Array<{ model: string; unitPriceUsd: number }>
  /** 今日按模型分组的消耗明细 */
  byModel: ModelBillingSummary[]
}

// ---- 进程内缓存 ----

interface BillingStore {
  /** 按 date(YYYY-MM-DD) 分组的事件列表 */
  eventsByDate: Map<string, BillingEvent[]>
}

const globalKey = '__billing_store__'
const globalAny = globalThis as typeof globalThis & {
  [globalKey]?: BillingStore
}

const store: BillingStore = globalAny[globalKey] ?? {
  eventsByDate: new Map<string, BillingEvent[]>(),
}
globalAny[globalKey] = store

// ---- 文件持久化 ----

const workspaceRoot = process.cwd()
const dataDir = path.join(workspaceRoot, 'data')
const stateFilePath = path.join(dataDir, 'billing-events.jsonl')

let stateLoaded = false
const stateReady = loadState().finally(() => {
  stateLoaded = true
})

async function loadState(): Promise<void> {
  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as BillingEvent
        if (!isValidEvent(event)) continue
        const list = store.eventsByDate.get(event.date) ?? []
        list.push(event)
        store.eventsByDate.set(event.date, list)
      } catch {
        // 跳过损坏行
      }
    }
  } catch {
    // 首次启动 / 文件不存在：空存储
  }
}

async function ensureReady(): Promise<void> {
  if (!stateLoaded) await stateReady
}

function isValidEvent(value: unknown): value is BillingEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.ts === 'string' &&
    typeof v.tsMs === 'number' &&
    typeof v.date === 'string' &&
    typeof v.model === 'string' &&
    typeof v.count === 'number' &&
    typeof v.unitPriceUsd === 'number' &&
    typeof v.totalUsd === 'number' &&
    typeof v.providerId === 'string' &&
    typeof v.taskId === 'string'
  )
}

// ---- 时间工具 ----

/** 返回本地时区日期字符串 YYYY-MM-DD。 */
function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ---- 公共 API ----

/**
 * 记录一次计费事件。
 *
 * 异步追加到 jsonl，失败静默，绝不抛出异常影响生图主流程。
 */
export async function appendBillingEvent(input: {
  model: string
  count: number
  providerId: string
  taskId: string
  featureType?: string
}): Promise<void> {
  try {
    await ensureReady()

    const now = new Date()
    const unitPriceUsd = getUnitPriceUsd(input.model)
    const event: BillingEvent = {
      id: createId('bill'),
      ts: now.toISOString(),
      tsMs: now.getTime(),
      date: getLocalDateString(now),
      model: input.model,
      count: input.count,
      unitPriceUsd,
      totalUsd: Number((unitPriceUsd * input.count).toFixed(6)),
      providerId: input.providerId,
      taskId: input.taskId,
      ...(input.featureType ? { featureType: input.featureType } : {}),
    }

    // 更新进程内缓存
    const list = store.eventsByDate.get(event.date) ?? []
    list.push(event)
    store.eventsByDate.set(event.date, list)

    // 异步追加到文件（静默失败）
    await mkdir(dataDir, { recursive: true }).catch(() => undefined)
    await appendFile(stateFilePath, JSON.stringify(event) + '\n', 'utf8').catch(
      (err) => {
        console.error('[billing-store] 追加计费事件失败（已忽略）', err)
      },
    )
  } catch (err) {
    // 最后兜底：静默失败，绝不影响生图
    console.error('[billing-store] 记录计费事件异常（已忽略）', err)
  }
}

/**
 * 获取今日计费统计。
 */
export async function getTodayBilling(): Promise<TodayBillingSummary> {
  await ensureReady()

  const today = getLocalDateString(new Date())
  const events = store.eventsByDate.get(today) ?? []

  let totalCount = 0
  let totalUsd = 0
  let totalCalls = 0

  const byModelMap = new Map<
    string,
    { count: number; totalUsd: number; calls: number; unitPriceUsd: number }
  >()

  for (const event of events) {
    totalCount += event.count
    totalUsd += event.totalUsd
    totalCalls += 1

    const existing = byModelMap.get(event.model)
    if (existing) {
      existing.count += event.count
      existing.totalUsd += event.totalUsd
      existing.calls += 1
    } else {
      byModelMap.set(event.model, {
        count: event.count,
        totalUsd: event.totalUsd,
        calls: 1,
        unitPriceUsd: event.unitPriceUsd,
      })
    }
  }

  const byModel: ModelBillingSummary[] = Array.from(byModelMap.entries())
    .map(([model, v]) => ({
      model,
      unitPriceUsd: v.unitPriceUsd,
      count: v.count,
      totalUsd: Number(v.totalUsd.toFixed(6)),
      calls: v.calls,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd)

  // 延迟导入 getAllModelPrices 避免循环
  const { getAllModelPrices } = await import('./pricing')

  return {
    date: today,
    totalCount,
    totalUsd: Number(totalUsd.toFixed(6)),
    totalCalls,
    modelPrices: getAllModelPrices(),
    byModel,
  }
}
