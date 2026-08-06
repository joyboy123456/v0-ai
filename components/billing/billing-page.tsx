"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RANGES,
  LAOZHANG_ACCENT,
  GRSAI_ACCENT,
  type BillingRange,
  type CallLogEntry,
  type ChannelBalanceResult,
  type GrsaiEventsResponse,
  type GrsaiSummaryResponse,
  type LaozhangDailyResponse,
  type LaozhangLogsResponse,
  type MergedLogEntry,
  type MultiChannelBalanceResponse,
} from "./shared";
import { KpiCards } from "./kpi-cards";
import { BalanceCards } from "./balance-cards";
import { SpendChart, type SpendDayPoint } from "./spend-chart";
import { CallLogTable } from "./call-log-table";
import { ModelSummary } from "./model-summary";

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

export function BillingPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  // 防抖：避免重复 replace（workbench 同款模式，公网慢网兜底）
  const redirectFiredRef = useRef(false);

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

  // ---- 登录守卫 ----

  useEffect(() => {
    if (isAuthLoading || user) return;
    if (redirectFiredRef.current) return;
    redirectFiredRef.current = true;
    router.replace("/login");
  }, [isAuthLoading, user, router]);

  // ---- 数据拉取 ----

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/billing/balance", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as MultiChannelBalanceResponse;
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

  const fetchRangeData = useCallback(async (r: BillingRange) => {
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
  }, []);

  const fetchDrillDown = useCallback(async (date: string | null) => {
    if (!date) {
      setSelectedDate(null);
      setLaozhangLogs([]);
      setGrsaiEvents([]);
      return;
    }
    setSelectedDate(date);

    // 老张日志第 1 页
    setLaozhangLogs([]);
    setLaozhangLogsPage(1);
    setLaozhangLogsHasMore(false);
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
  }, []);

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

  // 登录后拉取数据
  useEffect(() => {
    if (!user) return;
    fetchBalance();
    fetchRangeData(range);
  }, [user, range, refreshKey, fetchBalance, fetchRangeData]);

  // 切换范围时清除下钻
  useEffect(() => {
    setSelectedDate(null);
    setLaozhangLogs([]);
    setGrsaiEvents([]);
  }, [range]);

  // ---- 派生数据 ----

  /** 合并双渠道按天数据并补空天（图表用）。 */
  const mergedDays = useMemo<SpendDayPoint[]>(() => {
    const map = new Map<string, SpendDayPoint>();
    for (const d of laozhangData?.days ?? []) {
      const entry = map.get(d.date) ?? { date: d.date, laozhang: 0, grsai: 0, total: 0 };
      entry.laozhang += d.totalUsd;
      entry.total += d.totalUsd;
      map.set(d.date, entry);
    }
    for (const d of grsaiData?.summary?.byDay ?? []) {
      const entry = map.get(d.date) ?? { date: d.date, laozhang: 0, grsai: 0, total: 0 };
      entry.grsai += d.totalUsd;
      entry.total += d.totalUsd;
      map.set(d.date, entry);
    }
    const dates = [...map.keys()].sort();
    if (dates.length === 0) return [];

    const result: SpendDayPoint[] = [];
    const cursor = new Date(`${dates[0]}T00:00:00`);
    const end = new Date(`${dates[dates.length - 1]}T00:00:00`);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      result.push(map.get(key) ?? { date: key, laozhang: 0, grsai: 0, total: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, [laozhangData, grsaiData]);

  const peakDay = useMemo(() => {
    let peak: SpendDayPoint | null = null;
    for (const d of mergedDays) {
      if (d.total > 0 && (!peak || d.total > peak.total)) peak = d;
    }
    return peak ? { date: peak.date, totalUsd: peak.total } : null;
  }, [mergedDays]);

  const combinedUsd = (laozhangData?.totalUsd ?? 0) + (grsaiData?.summary?.totalUsd ?? 0);
  const combinedCalls = (laozhangData?.totalCalls ?? 0) + (grsaiData?.summary?.totalCalls ?? 0);
  const rangeDays = RANGES.find((r) => r.value === range)?.days ?? 1;
  const avgDailyUsd = combinedUsd / rangeDays;

  /** 合并下钻明细（两渠道按时间倒序）。 */
  const mergedLogs = useMemo<MergedLogEntry[]>(() => {
    const all: MergedLogEntry[] = [
      ...laozhangLogs.map((e) => ({ ...e, channel: "laozhang" as const })),
      ...grsaiEvents.map((e) => ({ ...e, channel: "grsai" as const })),
    ];
    return all.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [laozhangLogs, grsaiEvents]);

  const rangeLoading = laozhangLoading || grsaiLoading;
  /** 首次加载（无任何数据）时才出骨架，刷新时保留旧数字避免闪烁 */
  const initialLoading = rangeLoading && !laozhangData && !grsaiData && !laozhangError && !grsaiError;
  const anyLoading = rangeLoading || balanceLoading;
  const drillDownLoading = laozhangLogsLoading || grsaiEventsLoading;

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    if (selectedDate) void fetchDrillDown(selectedDate);
  }, [selectedDate, fetchDrillDown]);

  // ---- 渲染 ----

  // 登录态解析中 / 未登录跳转中
  if (isAuthLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {isAuthLoading ? "正在读取账号" : "正在前往登录页"}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-5">
        {/* 页头：返回 + 标题 + 范围/刷新 */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              返回工作台
            </Link>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
              计费观测台
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              双渠道消费与余额总览
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <RangeTabs range={range} onChange={setRange} />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="bg-surface text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("size-3.5", anyLoading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </header>

        {/* KPI 卡 */}
        <KpiCards
          totalUsd={combinedUsd}
          totalCalls={combinedCalls}
          avgDailyUsd={avgDailyUsd}
          peakDay={peakDay}
          laozhangUsd={laozhangData?.totalUsd ?? null}
          grsaiUsd={grsaiData?.summary?.totalUsd ?? null}
          loading={initialLoading}
        />

        {/* 实时余额 */}
        <BalanceCards channels={balanceChannels} loading={balanceLoading} />

        {/* 合并按天图表 */}
        <SpendChart
          days={mergedDays}
          laozhangTotal={laozhangData?.totalUsd ?? null}
          grsaiTotal={grsaiData?.summary?.totalUsd ?? null}
          selectedDate={selectedDate}
          onSelectDate={(date) => void fetchDrillDown(date)}
          isLoading={initialLoading}
        />

        {/* 下钻明细表 */}
        {selectedDate && (
          <CallLogTable
            date={selectedDate}
            items={mergedLogs}
            loading={drillDownLoading}
            hasMore={laozhangLogsHasMore}
            onLoadMore={() => void loadMoreLaozhangLogs()}
          />
        )}

        {/* 按模型汇总 */}
        <ModelSummary
          channels={[
            {
              channel: "laozhang",
              title: "老张 API",
              badgeText: "上游实际",
              isEstimate: false,
              accent: LAOZHANG_ACCENT,
              totalUsd: laozhangData?.totalUsd ?? null,
              totalCalls: laozhangData?.totalCalls ?? null,
              byModel: laozhangData?.byModel ?? [],
              loading: laozhangLoading && !laozhangData && !laozhangError,
              error: laozhangError,
            },
            {
              channel: "grsai",
              title: "Grsai",
              badgeText: "本地估算",
              isEstimate: true,
              accent: GRSAI_ACCENT,
              totalUsd: grsaiData?.summary?.totalUsd ?? null,
              totalCalls: grsaiData?.summary?.totalCalls ?? null,
              byModel: grsaiData?.summary?.byModel ?? [],
              loading: grsaiLoading && !grsaiData && !grsaiError,
              error: grsaiError,
            },
          ]}
        />

        {/* 数据来源说明 */}
        <p className="pt-2 text-center text-xs text-muted-foreground/70">
          老张数据来自上游实际扣费（约 30 天保留期）· Grsai 数据来自本地计费事件估算（7 月 8 日起）
        </p>
      </div>
    </div>
  );
}

// ---- 范围切换 ----

function RangeTabs({
  range,
  onChange,
}: {
  range: BillingRange;
  onChange: (r: BillingRange) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-card">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className="relative px-3.5 py-1.5 text-xs font-medium focus:outline-none"
        >
          {range === r.value && (
            <motion.span
              layoutId="billing-range-pill"
              className="absolute inset-0 rounded-full bg-primary"
              transition={SPRING}
            />
          )}
          <span
            className={cn(
              "relative z-10 transition-colors",
              range === r.value
                ? "text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </span>
        </button>
      ))}
    </div>
  );
}
