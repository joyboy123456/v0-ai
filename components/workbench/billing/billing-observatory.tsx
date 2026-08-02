"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BalanceCards, type ChannelBalanceResult } from "./balance-cards";
import { ChannelSection } from "./channel-section";
import { CallLogList, type CallLogEntry } from "./call-log-list";

// ---- 类型 ----

type BillingRange = "today" | "7d" | "30d";

interface LaozhangDailyResponse {
  ok: boolean;
  range: BillingRange;
  totalUsd: number;
  totalCalls: number;
  days: Array<{ date: string; totalUsd: number; calls: number; byModel: Array<{ model: string; totalUsd: number; calls: number }> }>;
  byModel: Array<{ model: string; totalUsd: number; calls: number }>;
  error?: string;
}

interface LaozhangLogsResponse {
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

interface GrsaiSummaryResponse {
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

interface GrsaiEventsResponse {
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

interface MultiChannelBalance {
  ok: boolean;
  channels: ChannelBalanceResult[];
  error?: string;
}

// ---- 常量 ----

const MODEL_LABELS: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "Nano Banana",
  "gpt-image-2": "GPT Image 2",
  "gemini-3-pro-image-preview": "Nano Banana Pro",
  "nano-banana-2-lite": "Grsai NB 2 Lite",
  "nano-banana-2": "Grsai NB 2",
  "nano-banana-pro": "Grsai NB Pro",
};

const RANGES: Array<{ value: BillingRange; label: string }> = [
  { value: "today", label: "今日" },
  { value: "7d", label: "近7天" },
  { value: "30d", label: "近30天" },
];

const LAOZHANG_ACCENT = "#F59E0B";
const LAOZHANG_ACCENT_LIGHT = "#FBBF24";
const GRSAI_ACCENT = "#0D9488";
const GRSAI_ACCENT_LIGHT = "#14B8A6";

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

// ---- count-up hook ----

function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const startTime = performance.now();
    let raf: number;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = start + (target - start) * eased;
      setValue(current);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = target;
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

// ---- 格式化 ----

function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

// ---- 主组件 ----

interface BillingObservatoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillingObservatory({ open, onOpenChange }: BillingObservatoryProps) {
  const [range, setRange] = useState<BillingRange>("today");
  const [refreshKey, setRefreshKey] = useState(0);

  // 余额
  const [balanceChannels, setBalanceChannels] = useState<ChannelBalanceResult[] | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // 老张范围数据
  const [laozhangData, setLaozhangData] = useState<LaozhangDailyResponse | null>(null);
  const [laozhangLoading, setLaozhangLoading] = useState(false);
  const [laozhangError, setLaozhangError] = useState<string | null>(null);

  // Grsai 范围数据
  const [grsaiData, setGrsaiData] = useState<GrsaiSummaryResponse | null>(null);
  const [grsaiLoading, setGrsaiLoading] = useState(false);
  const [grsaiError, setGrsaiError] = useState<string | null>(null);

  // 下钻
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [laozhangLogs, setLaozhangLogs] = useState<CallLogEntry[]>([]);
  const [laozhangLogsLoading, setLaozhangLogsLoading] = useState(false);
  const [laozhangLogsPage, setLaozhangLogsPage] = useState(1);
  const [laozhangLogsHasMore, setLaozhangLogsHasMore] = useState(false);
  const [grsaiEvents, setGrsaiEvents] = useState<CallLogEntry[]>([]);
  const [grsaiEventsLoading, setGrsaiEventsLoading] = useState(false);

  // ---- 数据拉取 ----

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/billing/balance", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as MultiChannelBalance;
      if (body.channels && Array.isArray(body.channels)) {
        setBalanceChannels(body.channels);
      } else {
        setBalanceChannels([
          { channel: "laozhang", ok: false, error: body.error ?? `HTTP ${res.status}` },
          { channel: "grsai", ok: false, error: body.error ?? `HTTP ${res.status}` },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBalanceChannels([
        { channel: "laozhang", ok: false, error: msg },
        { channel: "grsai", ok: false, error: msg },
      ]);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const fetchRangeData = useCallback(
    async (r: BillingRange) => {
      // 老张
      setLaozhangLoading(true);
      setLaozhangError(null);
      fetch(`/api/billing/laozhang/daily?range=${r}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((body: LaozhangDailyResponse) => {
          if (body.ok) {
            setLaozhangData(body);
          } else {
            setLaozhangError(body.error ?? "查询失败");
            setLaozhangData(null);
          }
        })
        .catch((err) => {
          setLaozhangError(err instanceof Error ? err.message : String(err));
          setLaozhangData(null);
        })
        .finally(() => setLaozhangLoading(false));

      // Grsai
      setGrsaiLoading(true);
      setGrsaiError(null);
      fetch(`/api/billing/summary?range=${r}&channel=grsai`, { cache: "no-store" })
        .then((res) => res.json())
        .then((body: GrsaiSummaryResponse) => {
          if (body.ok) {
            setGrsaiData(body);
          } else {
            setGrsaiError(body.error ?? "查询失败");
            setGrsaiData(null);
          }
        })
        .catch((err) => {
          setGrsaiError(err instanceof Error ? err.message : String(err));
          setGrsaiData(null);
        })
        .finally(() => setGrsaiLoading(false));
    },
    [],
  );

  const fetchDrillDown = useCallback(
    async (date: string) => {
      if (!date) {
        setSelectedDate(null);
        return;
      }
      setSelectedDate(date);

      // 老张日志第 1 页
      setLaozhangLogs([]);
      setLaozhangLogsPage(1);
      setLaozhangLogsLoading(true);
      fetch(`/api/billing/laozhang/call-logs?date=${date}&p=1`, { cache: "no-store" })
        .then((res) => res.json())
        .then((body: LaozhangLogsResponse) => {
          if (body.ok) {
            setLaozhangLogs(
              body.items.map((it) => ({
                ts: it.ts,
                model: it.model,
                keyName: `Key ${it.keyName}`,
                usd: it.usd,
                promptTokens: it.promptTokens,
                completionTokens: it.completionTokens,
                durationSec: it.durationSec,
                count: 1,
                content: it.content,
              })),
            );
            setLaozhangLogsHasMore(body.hasMore);
          } else {
            setLaozhangLogs([]);
            setLaozhangLogsHasMore(false);
          }
        })
        .catch(() => {
          setLaozhangLogs([]);
          setLaozhangLogsHasMore(false);
        })
        .finally(() => setLaozhangLogsLoading(false));

      // Grsai 当天事件
      setGrsaiEvents([]);
      setGrsaiEventsLoading(true);
      fetch(`/api/billing/events?date=${date}&channel=grsai`, { cache: "no-store" })
        .then((res) => res.json())
        .then((body: GrsaiEventsResponse) => {
          if (body.ok) {
            setGrsaiEvents(
              body.items.map((it) => ({
                ts: it.ts,
                model: it.model,
                keyName: it.providerId,
                usd: it.totalUsd,
                promptTokens: 0,
                completionTokens: 0,
                durationSec: 0,
                count: it.count,
              })),
            );
          } else {
            setGrsaiEvents([]);
          }
        })
        .catch(() => setGrsaiEvents([]))
        .finally(() => setGrsaiEventsLoading(false));
    },
    [],
  );

  const loadMoreLaozhangLogs = useCallback(async () => {
    if (!selectedDate) return;
    const nextPage = laozhangLogsPage + 1;
    setLaozhangLogsLoading(true);
    try {
      const res = await fetch(
        `/api/billing/laozhang/call-logs?date=${selectedDate}&p=${nextPage}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as LaozhangLogsResponse;
      if (body.ok) {
        setLaozhangLogs((prev) => [
          ...prev,
          ...body.items.map((it) => ({
            ts: it.ts,
            model: it.model,
            keyName: `Key ${it.keyName}`,
            usd: it.usd,
            promptTokens: it.promptTokens,
            completionTokens: it.completionTokens,
            durationSec: it.durationSec,
            count: 1,
            content: it.content,
          })),
        ]);
        setLaozhangLogsPage(nextPage);
        setLaozhangLogsHasMore(body.hasMore);
      }
    } catch {
      // 静默
    } finally {
      setLaozhangLogsLoading(false);
    }
  }, [selectedDate, laozhangLogsPage]);

  // ---- 效果 ----

  // 打开时拉取数据
  useEffect(() => {
    if (open) {
      fetchBalance();
      fetchRangeData(range);
    }
  }, [open, range, refreshKey, fetchBalance, fetchRangeData]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onOpenChange]);

  // 切换范围时清除选中日期
  useEffect(() => {
    setSelectedDate(null);
  }, [range]);

  // ---- 计算汇总 ----

  const combinedUsd =
    (laozhangData?.totalUsd ?? 0) + (grsaiData?.summary?.totalUsd ?? 0);
  const heroValue = useCountUp(combinedUsd);
  const combinedCalls =
    (laozhangData?.totalCalls ?? 0) + (grsaiData?.summary?.totalCalls ?? 0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ---- 渲染 ----

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 overflow-y-auto"
        >
          {/* 极光背景 */}
          <AuroraBackground />

          {/* 关闭按钮 */}
          <div className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 backdrop-blur-sm bg-surface/30">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className="size-4 text-primary" />
              计费观测台
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={cn("size-3.5", (laozhangLoading || grsaiLoading) && "animate-spin")} />
                刷新
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* 主内容 */}
          <div className="relative z-10 max-w-4xl mx-auto px-6 pb-12 space-y-6">
            {/* 范围 tabs */}
            <RangeTabs range={range} onChange={setRange} />

            {/* Hero 数字 */}
            <div className="text-center pt-4 pb-2">
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">
                范围内总花费
              </p>
              <motion.p
                key={range}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={SPRING}
                className="font-bold tabular-nums leading-none"
                style={{
                  fontSize: "clamp(3rem, 10vw, 7rem)",
                  background: "linear-gradient(135deg, #0284C7 0%, #38BDF8 50%, #F59E0B 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {formatUsd(heroValue)}
              </motion.p>
              <div className="flex items-center justify-center gap-4 mt-3 text-[11px] text-muted-foreground">
                <span className="tabular-nums">
                  <span className="font-semibold text-foreground">{combinedCalls}</span> 次调用
                </span>
                {laozhangData && laozhangData.totalUsd > 0 && (
                  <span className="tabular-nums" style={{ color: LAOZHANG_ACCENT }}>
                    老张 {formatUsd(laozhangData.totalUsd)}
                  </span>
                )}
                {grsaiData?.summary && grsaiData.summary.totalUsd > 0 && (
                  <span className="tabular-nums" style={{ color: GRSAI_ACCENT }}>
                    Grsai {formatUsd(grsaiData.summary.totalUsd)}
                  </span>
                )}
              </div>
            </div>

            {/* 实时余额卡 */}
            <BalanceCards channels={balanceChannels} loading={balanceLoading} />

            {/* 老张区 */}
            <ChannelSection
              channelType="laozhang"
              title="老张 API"
              badgeText="上游实际"
              isEstimate={false}
              accentColor={LAOZHANG_ACCENT}
              accentColorLight={LAOZHANG_ACCENT_LIGHT}
              summary={
                laozhangData
                  ? {
                      totalUsd: laozhangData.totalUsd,
                      totalCalls: laozhangData.totalCalls,
                      byModel: laozhangData.byModel,
                    }
                  : null
              }
              days={laozhangData?.days ?? []}
              isLoading={laozhangLoading}
              error={laozhangError}
              selectedDate={selectedDate}
              onSelectDate={fetchDrillDown}
              drillDownItems={laozhangLogs}
              drillDownLoading={laozhangLogsLoading}
              drillDownHasMore={laozhangLogsHasMore}
              onLoadMore={loadMoreLaozhangLogs}
              modelLabels={MODEL_LABELS}
              formatValue={formatUsd}
              unitLabel="USD"
            />

            {/* Grsai 区 */}
            <ChannelSection
              channelType="grsai"
              title="Grsai"
              badgeText="本地估算"
              isEstimate={true}
              accentColor={GRSAI_ACCENT}
              accentColorLight={GRSAI_ACCENT_LIGHT}
              summary={
                grsaiData?.summary
                  ? {
                      totalUsd: grsaiData.summary.totalUsd,
                      totalCalls: grsaiData.summary.totalCalls,
                      byModel: grsaiData.summary.byModel,
                    }
                  : null
              }
              days={(grsaiData?.summary?.byDay ?? []).map((d) => ({
                date: d.date,
                totalUsd: d.totalUsd,
                calls: d.totalCalls,
              }))}
              isLoading={grsaiLoading}
              error={grsaiError}
              selectedDate={selectedDate}
              onSelectDate={fetchDrillDown}
              drillDownItems={grsaiEvents}
              drillDownLoading={grsaiEventsLoading}
              drillDownHasMore={false}
              onLoadMore={() => undefined}
              modelLabels={MODEL_LABELS}
              formatValue={formatUsd}
              unitLabel="USD"
            />

            {/* 底部说明 */}
            <p className="text-center text-[10px] text-muted-foreground/60 pt-4">
              老张数据来自上游实际扣费（约 30 天保留期）· Grsai 数据来自本地计费事件估算（7 月 8 日起）
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- 极光背景 ----

function AuroraBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* 基底渐变 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #F8FCFF 0%, #EAF8FF 40%, #DDF5FF 100%)",
        }}
      />

      {/* 极光光晕 1 — 天空蓝 */}
      <motion.div
        className="absolute -top-1/4 -left-1/4 size-[60vw] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
        animate={{
          x: [0, 80, 0],
          y: [0, 40, 0],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* 极光光晕 2 — 琥珀金 */}
      <motion.div
        className="absolute -bottom-1/4 -right-1/4 size-[50vw] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
        animate={{
          x: [0, -60, 0],
          y: [0, -30, 0],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* 点阵纹理 */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle, #0F172A 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
}

// ---- 范围 tabs ----

function RangeTabs({
  range,
  onChange,
}: {
  range: BillingRange;
  onChange: (r: BillingRange) => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-surface/50 backdrop-blur-md p-1">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => onChange(r.value)}
            className="relative px-4 py-1.5 text-[12px] font-medium transition-colors focus:outline-none"
            style={{
              color: range === r.value ? "#FFFFFF" : "var(--color-text-secondary)",
            }}
          >
            {range === r.value && (
              <motion.div
                layoutId="range-tab-pill"
                className="absolute inset-0 rounded-full"
                style={{
                  background: "linear-gradient(135deg, #0284C7, #38BDF8)",
                }}
                transition={SPRING}
              />
            )}
            <span className="relative z-10">{r.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
