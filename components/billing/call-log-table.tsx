"use client";

import { motion } from "framer-motion";
import { Loader2, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatUsd,
  formatDateCn,
  getModelLabel,
  CHANNEL_LABELS,
  LAOZHANG_ACCENT,
  GRSAI_ACCENT,
  type MergedLogEntry,
} from "./shared";

interface CallLogTableProps {
  /** 选中日期 YYYY-MM-DD */
  date: string;
  /** 合并后的逐条记录（已按时间倒序） */
  items: MergedLogEntry[];
  /** 是否加载中（任一渠道） */
  loading: boolean;
  /** 老张是否还有更多页 */
  hasMore: boolean;
  /** 加载更多（老张分页） */
  onLoadMore: () => void;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function CallLogTable({ date, items, loading, hasMore, onLoadMore }: CallLogTableProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <ReceiptText className="size-4 text-primary" />
          <h2 className="text-[15px] font-semibold text-foreground">
            {formatDateCn(date)} 调用明细
          </h2>
        </div>
        {!loading && items.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {items.length} 条记录
          </span>
        )}
      </div>

      {/* 表格（窄屏横向滚动） */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-y border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">时间</th>
              <th className="px-3 py-2.5 font-medium">渠道</th>
              <th className="px-3 py-2.5 font-medium">模型</th>
              <th className="px-3 py-2.5 font-medium">来源</th>
              <th className="px-3 py-2.5 font-medium text-right">Tokens</th>
              <th className="px-3 py-2.5 font-medium text-right">耗时</th>
              <th className="px-5 py-2.5 font-medium text-right">费用</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const accent = item.channel === "laozhang" ? LAOZHANG_ACCENT : GRSAI_ACCENT;
              const tokens = item.promptTokens + item.completionTokens;
              return (
                <tr
                  key={`${item.channel}-${item.ts}-${i}`}
                  className="border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors"
                >
                  <td className="px-5 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                    {formatTime(item.ts)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full" style={{ background: accent }} />
                      {CHANNEL_LABELS[item.channel]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5" title={item.content ?? undefined}>
                    <span className="font-medium text-foreground whitespace-nowrap">
                      {getModelLabel(item.model)}
                    </span>
                    {item.count > 1 && (
                      <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                        ×{item.count} 张
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {item.keyName || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {tokens > 0 ? tokens.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {item.durationSec > 0 ? `${item.durationSec}s` : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-foreground whitespace-nowrap">
                    {formatUsd(item.usd)}
                  </td>
                </tr>
              );
            })}

            {/* 加载中骨架行 */}
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-border/40 last:border-0">
                  <td colSpan={7} className="px-5 py-2.5">
                    <div className="skeleton-shimmer h-4 w-full rounded" />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* 空态 */}
      {!loading && items.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          当天暂无调用记录
        </p>
      )}

      {/* 老张分页 */}
      {(hasMore || (loading && items.length > 0)) && (
        <div className="flex justify-center border-t border-border/50 px-5 py-3">
          {loading && items.length > 0 ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoadMore}
              className="text-muted-foreground hover:text-foreground"
            >
              加载更多（老张 API 分页）
            </Button>
          )}
        </div>
      )}
    </motion.section>
  );
}
