"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ChevronDown, BarChart3 } from "lucide-react";
import { DailyChart, type ChartDataPoint } from "./daily-chart";
import { CallLogList, type CallLogEntry } from "./call-log-list";
import { cn } from "@/lib/utils";

interface ChannelSectionProps {
  /** 渠道标识 */
  channelType: "laozhang" | "grsai";
  /** 渠道显示名 */
  title: string;
  /** 徽章文字 */
  badgeText: string;
  /** 是否估算（grsai 显示"估算"标记） */
  isEstimate: boolean;
  /** 强调色 */
  accentColor: string;
  /** 强调色浅色 */
  accentColorLight: string;
  /** 范围汇总 */
  summary: {
    totalUsd: number;
    totalCalls: number;
    byModel: Array<{ model: string; totalUsd: number; calls: number; count?: number }>;
  } | null;
  /** 按天数据（图表用） */
  days: ChartDataPoint[];
  /** 是否加载中 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 当前选中日期 */
  selectedDate: string | null;
  /** 选择日期 */
  onSelectDate: (date: string) => void;
  /** 下钻日志条目 */
  drillDownItems: CallLogEntry[];
  /** 下钻加载中 */
  drillDownLoading: boolean;
  /** 下钻是否还有更多 */
  drillDownHasMore: boolean;
  /** 加载更多 */
  onLoadMore: () => void;
  /** 模型标签映射 */
  modelLabels: Record<string, string>;
  /** 值格式化 */
  formatValue: (v: number) => string;
  /** 值单位 */
  unitLabel: string;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

export function ChannelSection({
  title,
  badgeText,
  isEstimate,
  accentColor,
  accentColorLight,
  summary,
  days,
  isLoading,
  error,
  selectedDate,
  onSelectDate,
  drillDownItems,
  drillDownLoading,
  drillDownHasMore,
  onLoadMore,
  modelLabels,
  formatValue,
  unitLabel,
}: ChannelSectionProps) {
  const hasSelection = selectedDate && selectedDate.length > 0;

  return (
    <div
      className="rounded-2xl border border-border/40 bg-surface/40 backdrop-blur-md overflow-hidden"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div
            className="size-2 rounded-full"
            style={{
              background: accentColor,
              boxShadow: `0 0 6px ${accentColor}`,
            }}
          />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span
            className={cn(
              "text-[9px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded",
              isEstimate
                ? "bg-secondary/60 text-muted-foreground"
                : "text-white",
            )}
            style={!isEstimate ? { background: `${accentColor}20`, color: accentColor } : undefined}
          >
            {badgeText}
          </span>
        </div>

        {/* 范围汇总 */}
        {summary && !error && (
          <div className="flex items-center gap-4 text-[11px] tabular-nums">
            <span className="text-muted-foreground">
              <span className="font-bold text-foreground" style={{ color: accentColor }}>
                {formatValue(summary.totalUsd)}
              </span>
              <span className="ml-0.5 text-muted-foreground/60">{unitLabel}</span>
            </span>
            <span className="text-muted-foreground hidden sm:inline">
              {summary.totalCalls} 次
            </span>
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="p-4 space-y-4">
        {/* 错误 */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
            <AlertCircle className="size-4 text-destructive shrink-0" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {/* 柱状图 */}
        {!error && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              <BarChart3 className="size-3" />
              按天分布
            </div>
            <DailyChart
              days={days}
              accentColor={accentColor}
              accentColorLight={accentColorLight}
              selectedDate={selectedDate}
              onSelectDate={onSelectDate}
              isLoading={isLoading}
              formatValue={formatValue}
              unitLabel={unitLabel}
            />
          </div>
        )}

        {/* 按模型明细（范围汇总） */}
        {!error && summary && summary.byModel.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {summary.byModel.slice(0, 6).map((m) => (
              <span
                key={m.model}
                className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-secondary/30 px-2 py-0.5 text-[10px]"
              >
                <span className="text-muted-foreground">
                  {modelLabels[m.model] ?? m.model}
                </span>
                <span className="font-medium tabular-nums" style={{ color: accentColor }}>
                  {formatValue(m.totalUsd)}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* 下钻面板 */}
        <AnimatePresence initial={false}>
          {hasSelection && !error && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ ...SPRING, opacity: { duration: 0.2 } }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/30 pt-3">
                <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  <ChevronDown className="size-3" />
                  {selectedDate} 逐条调用
                </div>
                <CallLogList
                  items={drillDownItems}
                  loading={drillDownLoading}
                  hasMore={drillDownHasMore}
                  onLoadMore={onLoadMore}
                  accentColor={accentColor}
                  modelLabels={modelLabels}
                  formatValue={formatValue}
                  emptyText="当天暂无调用记录"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
