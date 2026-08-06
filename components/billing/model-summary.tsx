"use client";

import { motion } from "framer-motion";
import { AlertCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatUsd,
  getModelLabel,
  type BillingChannel,
} from "./shared";

export interface ChannelModelSummaryData {
  channel: BillingChannel;
  title: string;
  badgeText: string;
  isEstimate: boolean;
  accent: string;
  totalUsd: number | null;
  totalCalls: number | null;
  byModel: Array<{ model: string; totalUsd: number; calls: number }>;
  loading: boolean;
  error: string | null;
}

interface ModelSummaryProps {
  channels: ChannelModelSummaryData[];
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

export function ModelSummary({ channels }: ModelSummaryProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {channels.map((ch, i) => {
        // 按花费降序，占比条以最大值为 100%
        const rows = [...ch.byModel].sort((a, b) => b.totalUsd - a.totalUsd);
        return (
        <motion.section
          key={ch.channel}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.12 + i * 0.06 }}
          className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ background: ch.accent }}
              />
              <h3 className="text-sm font-semibold text-foreground">{ch.title}</h3>
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                  ch.isEstimate
                    ? "bg-secondary text-muted-foreground"
                    : "font-medium",
                )}
                style={
                  !ch.isEstimate
                    ? { background: `${ch.accent}1A`, color: ch.accent }
                    : undefined
                }
              >
                {ch.badgeText}
              </span>
            </div>
            {ch.totalUsd !== null && !ch.error && (
              <span className="text-xs text-muted-foreground tabular-nums">
                <span className="text-sm font-bold text-foreground">
                  {formatUsd(ch.totalUsd)}
                </span>
                {ch.totalCalls !== null && (
                  <span className="ml-1.5">{ch.totalCalls} 次</span>
                )}
              </span>
            )}
          </div>

          <div className="px-5 py-4">
            {/* 错误 */}
            {ch.error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                <AlertCircle className="size-4 text-destructive shrink-0" />
                <p className="text-xs text-destructive">{ch.error}</p>
              </div>
            )}

            {/* 加载骨架 */}
            {!ch.error && ch.loading && (
              <div className="space-y-3">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="skeleton-shimmer h-5 w-full rounded" />
                ))}
              </div>
            )}

            {/* 空态 */}
            {!ch.error && !ch.loading && rows.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Layers className="size-4" />
                范围内暂无消费
              </div>
            )}

            {/* 模型行 */}
            {!ch.error && !ch.loading && rows.length > 0 && (
              <div className="space-y-3">
                {rows.map((m) => {
                  const maxUsd = rows[0]?.totalUsd || 1;
                  const pct = Math.max((m.totalUsd / maxUsd) * 100, 2);
                  return (
                    <div key={m.model} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-[13px] text-foreground">
                        {getModelLabel(m.model)}
                      </span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: ch.accent }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-[13px] font-semibold tabular-nums text-foreground">
                        {formatUsd(m.totalUsd)}
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {m.calls} 次
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.section>
        );
      })}
    </div>
  );
}
