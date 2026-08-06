"use client";

import { motion } from "framer-motion";
import {
  formatUsd,
  formatDateShort,
  LAOZHANG_ACCENT,
  GRSAI_ACCENT,
} from "./shared";

interface KpiCardsProps {
  /** 范围内总花费（两渠道合计） */
  totalUsd: number;
  /** 范围内总调用次数 */
  totalCalls: number;
  /** 日均花费（总花费 / 范围天数） */
  avgDailyUsd: number;
  /** 峰值日（合并按天数据中的最大值），无数据为 null */
  peakDay: { date: string; totalUsd: number } | null;
  /** 老张渠道小计（未加载完为 null） */
  laozhangUsd: number | null;
  /** Grsai 渠道小计（未加载完为 null） */
  grsaiUsd: number | null;
  /** 是否加载中 */
  loading: boolean;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

export function KpiCards({
  totalUsd,
  totalCalls,
  avgDailyUsd,
  peakDay,
  laozhangUsd,
  grsaiUsd,
  loading,
}: KpiCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-surface shadow-card p-5"
          >
            <div className="skeleton-shimmer h-3 w-20 rounded mb-4" />
            <div className="skeleton-shimmer h-8 w-28 rounded mb-2" />
            <div className="skeleton-shimmer h-3 w-24 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const cards: Array<{
    key: string;
    label: string;
    value: string;
    sub?: React.ReactNode;
  }> = [
    {
      key: "total",
      label: "范围内总花费",
      value: formatUsd(totalUsd),
      sub: (
        <span className="inline-flex items-center gap-2.5">
          {laozhangUsd !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span
                className="size-1.5 rounded-full"
                style={{ background: LAOZHANG_ACCENT }}
              />
              老张 {formatUsd(laozhangUsd)}
            </span>
          )}
          {grsaiUsd !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span
                className="size-1.5 rounded-full"
                style={{ background: GRSAI_ACCENT }}
              />
              Grsai {formatUsd(grsaiUsd)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "calls",
      label: "总调用次数",
      value: totalCalls.toLocaleString(),
      sub: "次 API 调用",
    },
    {
      key: "avg",
      label: "日均花费",
      value: formatUsd(avgDailyUsd),
      sub: "按范围天数平均",
    },
    {
      key: "peak",
      label: "峰值日",
      value: peakDay ? formatUsd(peakDay.totalUsd) : "—",
      sub: peakDay ? `${formatDateShort(peakDay.date)} 单日最高` : "暂无数据",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, i) => (
        <motion.div
          key={card.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: i * 0.05 }}
          className="rounded-2xl border border-border bg-surface shadow-card p-5"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            {card.label}
          </p>
          <p className="text-[28px] leading-8 font-bold tabular-nums text-foreground">
            {card.value}
          </p>
          {card.sub && (
            <p className="text-xs text-muted-foreground mt-2">{card.sub}</p>
          )}
        </motion.div>
      ))}
    </div>
  );
}
