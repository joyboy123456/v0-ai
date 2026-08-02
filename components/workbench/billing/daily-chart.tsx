"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

/** 单天数据点（图表用）。 */
export interface ChartDataPoint {
  date: string;
  totalUsd: number;
  calls: number;
}

interface DailyChartProps {
  /** 按天数据（已排序） */
  days: ChartDataPoint[];
  /** 强调色 CSS 变量或色值，如 "#F59E0B" */
  accentColor: string;
  /** 强调色浅色 */
  accentColorLight: string;
  /** 当前选中的日期 YYYY-MM-DD */
  selectedDate: string | null;
  /** 点击柱体选中某天 */
  onSelectDate: (date: string) => void;
  /** 是否加载中 */
  isLoading: boolean;
  /** 值的格式化函数 */
  formatValue: (v: number) => string;
  /** 值的单位标签 */
  unitLabel: string;
}

/** 弹簧动效参数。 */
const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

export function DailyChart({
  days,
  accentColor,
  accentColorLight,
  selectedDate,
  onSelectDate,
  isLoading,
  formatValue,
  unitLabel,
}: DailyChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxValue = useMemo(() => {
    if (days.length === 0) return 1;
    return Math.max(...days.map((d) => d.totalUsd), 0.01);
  }, [days]);

  // 填充空天：如果 range 内某些天没有数据，仍显示空柱
  const paddedDays = useMemo(() => {
    if (days.length === 0) return [];
    const result: ChartDataPoint[] = [];
    const start = days[0].date;
    const end = days[days.length - 1].date;
    const startDate = new Date(start);
    const endDate = new Date(end);
    const dayMap = new Map(days.map((d) => [d.date, d]));
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      result.push(dayMap.get(dateStr) ?? { date: dateStr, totalUsd: 0, calls: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, [days]);

  if (isLoading) {
    return (
      <div className="flex items-end gap-1 h-32 px-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-md bg-secondary/40 animate-pulse"
            style={{ height: `${20 + Math.random() * 60}%` }}
          />
        ))}
      </div>
    );
  }

  if (paddedDays.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        暂无数据
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 柱状图 */}
      <div className="flex items-end gap-[3px] h-32 px-1">
        {paddedDays.map((day, i) => {
          const heightPct = day.totalUsd > 0 ? (day.totalUsd / maxValue) * 100 : 0;
          const isSelected = day.date === selectedDate;
          const isHovered = hoverIndex === i;
          const showLabel = paddedDays.length <= 15 || i % Math.ceil(paddedDays.length / 10) === 0;

          return (
            <button
              key={day.date}
              className="group relative flex-1 h-full flex flex-col justify-end items-center cursor-pointer focus:outline-none"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              onClick={() => onSelectDate(day.date === selectedDate ? "" : day.date)}
              aria-label={`${day.date}: ${formatValue(day.totalUsd)}`}
            >
              {/* 柱体 */}
              <motion.div
                className={cn(
                  "w-full rounded-t-[3px] transition-opacity",
                  day.totalUsd === 0 && "opacity-20",
                )}
                style={{
                  background: `linear-gradient(to top, ${accentColor}, ${accentColorLight})`,
                  boxShadow: isSelected
                    ? `0 0 12px ${accentColor}80, 0 0 4px ${accentColor}`
                    : isHovered
                      ? `0 0 8px ${accentColor}60`
                      : "none",
                  minHeight: day.totalUsd > 0 ? "3px" : "1px",
                }}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(heightPct, day.totalUsd > 0 ? 2 : 0.5)}%` }}
                transition={{ ...SPRING, delay: i * 0.035 }}
              />

              {/* 选中指示线 */}
              {isSelected && (
                <motion.div
                  layoutId="chart-selected-line"
                  className="absolute inset-x-0 -top-1 h-px"
                  style={{ background: accentColor }}
                  transition={SPRING}
                />
              )}

              {/* 日期标签 */}
              {showLabel && (
                <span className="mt-1 text-[9px] text-muted-foreground/60 tabular-nums whitespace-nowrap">
                  {day.date.slice(5)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 悬浮 tooltip */}
      <AnimatePresence>
        {hoverIndex !== null && paddedDays[hoverIndex] && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-lg border border-border bg-surface/95 backdrop-blur-md px-3 py-2 shadow-lg"
            style={{
              left: `${(hoverIndex / Math.max(paddedDays.length - 1, 1)) * 100}%`,
              top: "-8px",
              transform: "translate(-50%, -100%)",
            }}
          >
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {paddedDays[hoverIndex].date}
            </p>
            <p className="text-sm font-bold tabular-nums" style={{ color: accentColor }}>
              {formatValue(paddedDays[hoverIndex].totalUsd)}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unitLabel}</span>
            </p>
            <p className="text-[10px] text-muted-foreground">
              {paddedDays[hoverIndex].calls} 次调用
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
