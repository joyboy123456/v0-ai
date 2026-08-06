"use client";

import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import { BarChart3 } from "lucide-react";
import {
  formatUsd,
  CHANNEL_LABELS,
  LAOZHANG_ACCENT,
  GRSAI_ACCENT,
} from "./shared";

/** 合并后的单天数据点（双渠道）。 */
export interface SpendDayPoint {
  date: string;
  laozhang: number;
  grsai: number;
  total: number;
}

interface SpendChartProps {
  /** 合并按天数据（已排序、已补空天） */
  days: SpendDayPoint[];
  /** 渠道范围小计（图例用），未加载完为 null */
  laozhangTotal: number | null;
  grsaiTotal: number | null;
  /** 当前选中日期 */
  selectedDate: string | null;
  /** 点击柱子选中/取消某天 */
  onSelectDate: (date: string | null) => void;
  /** 是否加载中 */
  isLoading: boolean;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };
const AXIS_TICK = { fontSize: 12, fill: "#9AA6B2" } as const;
const GRID_STROKE = "rgba(17, 24, 39, 0.06)";

/** 悬浮提示：白卡 + 分渠道明细 + 合计（Exa/Cursor 模式）。 */
function SpendTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  const laozhang = Number(payload.find((p) => p.dataKey === "laozhang")?.value ?? 0);
  const grsai = Number(payload.find((p) => p.dataKey === "grsai")?.value ?? 0);

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5 shadow-soft">
      <p className="text-xs text-muted-foreground tabular-nums mb-1.5">{label}</p>
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs tabular-nums">
          <span className="size-2 rounded-sm" style={{ background: LAOZHANG_ACCENT }} />
          <span className="text-muted-foreground">老张</span>
          <span className="ml-auto pl-4 font-semibold text-foreground">{formatUsd(laozhang)}</span>
        </p>
        <p className="flex items-center gap-1.5 text-xs tabular-nums">
          <span className="size-2 rounded-sm" style={{ background: GRSAI_ACCENT }} />
          <span className="text-muted-foreground">Grsai</span>
          <span className="ml-auto pl-4 font-semibold text-foreground">{formatUsd(grsai)}</span>
        </p>
        <p className="flex items-center gap-1.5 border-t border-border/60 pt-1 text-xs tabular-nums">
          <span className="text-muted-foreground">合计</span>
          <span className="ml-auto pl-4 font-bold text-foreground">
            {formatUsd(laozhang + grsai)}
          </span>
        </p>
      </div>
    </div>
  );
}

export function SpendChart({
  days,
  laozhangTotal,
  grsaiTotal,
  selectedDate,
  onSelectDate,
  isLoading,
}: SpendChartProps) {
  const hasData = days.some((d) => d.total > 0);
  // 30 天抽稀刻度，避免日期标签互相压叠
  const tickInterval = days.length > 14 ? Math.floor(days.length / 8) : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: 0.1 }}
      className="rounded-2xl border border-border bg-surface shadow-card"
    >
      {/* 头部：标题 + 图例（含渠道小计） */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          <h2 className="text-[15px] font-semibold text-foreground">按天花费</h2>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="size-2.5 rounded-sm" style={{ background: LAOZHANG_ACCENT }} />
            {CHANNEL_LABELS.laozhang}
            {laozhangTotal !== null && (
              <span className="font-semibold text-foreground">{formatUsd(laozhangTotal)}</span>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="size-2.5 rounded-sm" style={{ background: GRSAI_ACCENT }} />
            {CHANNEL_LABELS.grsai}
            {grsaiTotal !== null && (
              <span className="font-semibold text-foreground">{formatUsd(grsaiTotal)}</span>
            )}
          </span>
        </div>
      </div>

      <div className="px-3 pb-3">
        {isLoading ? (
          <div className="flex h-[280px] items-end gap-1.5 px-4 pb-8">
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-shimmer flex-1 rounded-t-md"
                style={{ height: `${15 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        ) : !hasData ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            范围内暂无消费记录
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={days}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
              onClick={(state) => {
                const label = state?.activeLabel;
                if (typeof label === "string") {
                  onSelectDate(label === selectedDate ? null : label);
                }
              }}
            >
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5)}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
                tickMargin={8}
              />
              <YAxis
                tickFormatter={(v: number) => `$${v}`}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip content={<SpendTooltip />} cursor={{ fill: "rgba(2, 132, 199, 0.06)" }} />
              <Bar dataKey="laozhang" stackId="spend" fill={LAOZHANG_ACCENT} cursor="pointer">
                {days.map((d) => (
                  <Cell
                    key={d.date}
                    fillOpacity={selectedDate ? (d.date === selectedDate ? 1 : 0.3) : 0.95}
                  />
                ))}
              </Bar>
              <Bar dataKey="grsai" stackId="spend" fill={GRSAI_ACCENT} cursor="pointer">
                {days.map((d) => (
                  <Cell
                    key={d.date}
                    fillOpacity={selectedDate ? (d.date === selectedDate ? 1 : 0.3) : 0.95}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <p className="border-t border-border/50 px-5 py-2.5 text-xs text-muted-foreground/80">
        点击柱子查看当日逐条调用明细{selectedDate ? "，再次点击取消选择" : ""}
      </p>
    </motion.section>
  );
}
