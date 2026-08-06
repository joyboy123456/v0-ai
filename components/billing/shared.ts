/**
 * 计费页面共享类型、常量与格式化函数。
 *
 * 数据来源：
 * - 老张 API：/api/billing/laozhang/*（上游实际扣费，约 30 天保留期）
 * - Grsai：/api/billing/summary、/api/billing/events（本地计费事件估算，7 月 8 日起）
 */

// ---- 范围 ----

export type BillingRange = "today" | "7d" | "30d";

export const RANGES: Array<{ value: BillingRange; label: string; days: number }> = [
  { value: "today", label: "今日", days: 1 },
  { value: "7d", label: "近7天", days: 7 },
  { value: "30d", label: "近30天", days: 30 },
];

// ---- 渠道 ----

export type BillingChannel = "laozhang" | "grsai";

/** 渠道强调色：仅用于图表系列与小徽章，不作页面主色。 */
export const LAOZHANG_ACCENT = "#F59E0B";
export const GRSAI_ACCENT = "#0D9488";

export const CHANNEL_LABELS: Record<BillingChannel, string> = {
  laozhang: "老张",
  grsai: "Grsai",
};

// ---- 余额预警 ----

export type BalanceLevel = "normal" | "low" | "exhausted";

/** 预警色：仅用于余额不足提示（耗尽用 destructive 令牌）。 */
export const WARN_ACCENT = "#D97706";

/** 低余额阈值（约十余次出图）：老张 $5 / Grsai ¥10。 */
export const LOW_BALANCE_THRESHOLDS: Record<BillingChannel, number> = {
  laozhang: 5,
  grsai: 10,
};

export function getBalanceLevel(
  channel: BillingChannel,
  remaining: number,
): BalanceLevel {
  if (remaining <= 0) return "exhausted";
  return remaining < LOW_BALANCE_THRESHOLDS[channel] ? "low" : "normal";
}

// ---- 模型标签 ----

export const MODEL_LABELS: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "Nano Banana",
  "gpt-image-2": "GPT Image 2",
  "gemini-3-pro-image-preview": "Nano Banana Pro",
  "nano-banana-2-lite": "Grsai NB 2 Lite",
  "nano-banana-2": "Grsai NB 2",
  "nano-banana-pro": "Grsai NB Pro",
};

export function getModelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

// ---- 逐条调用记录 ----

/** 逐条调用记录（统一接口，老张/grsai 共用）。 */
export interface CallLogEntry {
  /** ISO 时间戳或原始 ts */
  ts: string;
  /** 模型 ID */
  model: string;
  /** 使用的 key 名称（老张 token_name / grsai providerId） */
  keyName: string;
  /** 本次扣费/估算 USD */
  usd: number;
  /** 输入 tokens（老张有，grsai 为 0） */
  promptTokens: number;
  /** 输出 tokens */
  completionTokens: number;
  /** 耗时秒（老张有，grsai 为 0） */
  durationSec: number;
  /** 生成图片数（grsai 有，老张为 1） */
  count: number;
  /** 计费明细文字（老张 content） */
  content?: string;
}

/** 合并明细表用：附加渠道归属。 */
export interface MergedLogEntry extends CallLogEntry {
  channel: BillingChannel;
}

// ---- API 响应类型 ----

export interface LaozhangDailyResponse {
  ok: boolean;
  range: BillingRange;
  totalUsd: number;
  totalCalls: number;
  days: Array<{
    date: string;
    totalUsd: number;
    calls: number;
    byModel: Array<{ model: string; totalUsd: number; calls: number }>;
  }>;
  byModel: Array<{ model: string; totalUsd: number; calls: number }>;
  error?: string;
}

export interface LaozhangLogsResponse {
  ok: boolean;
  date: string;
  page: number;
  items: Array<{
    ts: string;
    createdAt: number;
    model: string;
    keyName: string;
    usd: number;
    promptTokens: number;
    completionTokens: number;
    durationSec: number;
    content: string;
  }>;
  hasMore: boolean;
  error?: string;
}

export interface GrsaiSummaryResponse {
  ok: boolean;
  range: string;
  channel: string;
  summary: {
    totalCount: number;
    totalUsd: number;
    totalCalls: number;
    byModel: Array<{ model: string; totalUsd: number; calls: number; count: number }>;
    byDay: Array<{ date: string; totalCount: number; totalUsd: number; totalCalls: number }>;
  };
  error?: string;
}

export interface GrsaiEventsResponse {
  ok: boolean;
  date: string;
  channel: string;
  items: Array<{
    id: string;
    ts: string;
    model: string;
    count: number;
    unitPriceUsd: number;
    totalUsd: number;
    providerId: string;
    taskId: string;
  }>;
  error?: string;
}

/** 老张渠道余额数据。 */
export interface LaozhangChannelData {
  channel: "laozhang";
  username: string;
  displayName: string;
  group: string;
  remainingUsd: number;
  usedUsd: number;
  totalUsd: number;
  requestCount: number;
  fetchedAt: string;
}

/** Grsai 渠道余额数据。 */
export interface GrsaiChannelData {
  channel: "grsai";
  displayName: string;
  credits: number;
  remainingCny: number;
  currency: "CNY";
  fetchedAt: string;
}

/** 单渠道余额结果。 */
export interface ChannelBalanceResult {
  channel: BillingChannel;
  ok: boolean;
  error?: string;
  data?: LaozhangChannelData | GrsaiChannelData;
}

export interface MultiChannelBalanceResponse {
  ok: boolean;
  channels: ChannelBalanceResult[];
  error?: string;
}

// ---- 格式化 ----

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatCny(value: number): string {
  if (value === 0) return "¥0.00";
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

/** "2026-08-05" → "8月5日" */
export function formatDateCn(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** "2026-08-05" → "08/05" */
export function formatDateShort(date: string): string {
  const [, m, d] = date.split("-");
  return `${m}/${d}`;
}
