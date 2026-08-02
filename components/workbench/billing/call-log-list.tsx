"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ChevronRight, Cpu, Clock, Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  /** 输入 tokens（老张有，grsai 可能 0） */
  promptTokens: number;
  /** 输出 tokens */
  completionTokens: number;
  /** 耗时秒（老张有，grsai 可能 0） */
  durationSec: number;
  /** 生成图片数（grsai 有，老张可能 1） */
  count: number;
  /** 计费明细文字（老张 content） */
  content?: string;
}

interface CallLogListProps {
  /** 日志条目 */
  items: CallLogEntry[];
  /** 是否加载中 */
  loading: boolean;
  /** 是否还有更多（老张翻页用） */
  hasMore: boolean;
  /** 加载更多回调 */
  onLoadMore: () => void;
  /** 强调色 */
  accentColor: string;
  /** 模型标签映射 */
  modelLabels: Record<string, string>;
  /** 值格式化 */
  formatValue: (v: number) => string;
  /** 空态文案 */
  emptyText: string;
}

const SPRING = { type: "spring" as const, stiffness: 300, damping: 30 };

function getModelLabel(model: string, labels: Record<string, string>): string {
  return labels[model] ?? model;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function CallLogList({
  items,
  loading,
  hasMore,
  onLoadMore,
  accentColor,
  modelLabels,
  formatValue,
  emptyText,
}: CallLogListProps) {
  if (!loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <AnimatePresence mode="popLayout">
        {items.map((item, i) => (
          <motion.div
            key={`${item.ts}-${i}`}
            layout
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ ...SPRING, delay: Math.min(i * 0.03, 0.3) }}
            className="group flex items-center gap-3 rounded-lg border border-border/60 bg-surface/60 backdrop-blur-sm px-3 py-2 hover:border-border hover:bg-surface/80 transition-colors"
          >
            {/* 时间 */}
            <span className="text-[11px] text-muted-foreground tabular-nums w-16 shrink-0">
              {formatTime(item.ts)}
            </span>

            {/* 模型 + key */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-foreground truncate">
                  {getModelLabel(item.model, modelLabels)}
                </span>
                {item.keyName && (
                  <Badge
                    variant="secondary"
                    className="text-[9px] font-normal shrink-0 px-1.5 py-0"
                  >
                    {item.keyName}
                  </Badge>
                )}
              </div>
              {item.count > 1 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {item.count} 张
                </p>
              )}
            </div>

            {/* 用量指标 */}
            <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
              {item.durationSec > 0 && (
                <span className="flex items-center gap-0.5 tabular-nums">
                  <Clock className="size-2.5" />
                  {item.durationSec}s
                </span>
              )}
              {item.promptTokens > 0 && (
                <span className="flex items-center gap-0.5 tabular-nums">
                  <Cpu className="size-2.5" />
                  {item.promptTokens + item.completionTokens}
                </span>
              )}
            </div>

            {/* 扣费 */}
            <div className="text-right shrink-0">
              <span
                className="text-[13px] font-semibold tabular-nums"
                style={{ color: accentColor }}
              >
                {formatValue(item.usd)}
              </span>
            </div>

            <ChevronRight className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* 加载中骨架 */}
      {loading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className="flex items-center gap-3 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 animate-pulse"
          >
            <div className="w-16 h-3 rounded bg-secondary/40" />
            <div className="flex-1 h-3 rounded bg-secondary/40" />
            <div className="w-12 h-3 rounded bg-secondary/40" />
          </div>
        ))}

      {/* 加载更多 */}
      {hasMore && !loading && (
        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            className="text-muted-foreground hover:text-foreground"
          >
            <Coins className="size-3.5 mr-1" />
            加载更多
          </Button>
        </div>
      )}

      {/* 加载中指示器 */}
      {loading && items.length > 0 && (
        <div className="flex justify-center py-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
