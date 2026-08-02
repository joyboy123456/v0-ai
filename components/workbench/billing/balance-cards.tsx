"use client";

import { motion } from "framer-motion";
import { Wallet, Loader2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** 老张渠道余额数据。 */
interface LaozhangChannelData {
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
interface GrsaiChannelData {
  channel: "grsai";
  displayName: string;
  credits: number;
  remainingCny: number;
  currency: "CNY";
  fetchedAt: string;
}

/** 单渠道余额结果。 */
export interface ChannelBalanceResult {
  channel: "laozhang" | "grsai";
  ok: boolean;
  error?: string;
  data?: LaozhangChannelData | GrsaiChannelData;
}

interface BalanceCardsProps {
  channels: ChannelBalanceResult[] | null;
  loading: boolean;
}

function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatCny(value: number): string {
  if (value === 0) return "¥0.00";
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

export function BalanceCards({ channels, loading }: BalanceCardsProps) {
  if (loading && !channels) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-border/50 bg-surface/40 backdrop-blur-md p-4 animate-pulse"
          >
            <div className="h-4 w-24 rounded bg-secondary/40 mb-3" />
            <div className="h-8 w-32 rounded bg-secondary/40 mb-2" />
            <div className="h-3 w-20 rounded bg-secondary/30" />
          </div>
        ))}
      </div>
    );
  }

  if (!channels || channels.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {channels.map((ch, i) => (
        <motion.div
          key={ch.channel}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: i * 0.08 }}
        >
          <BalanceMeterCard channel={ch} />
        </motion.div>
      ))}
    </div>
  );
}

function BalanceMeterCard({ channel }: { channel: ChannelBalanceResult }) {
  const isLaozhang = channel.channel === "laozhang";
  const accentColor = isLaozhang ? "#F59E0B" : "#0D9488";

  // 失败
  if (!channel.ok) {
    return (
      <div
        className="rounded-2xl border border-destructive/20 bg-destructive/5 backdrop-blur-md p-4"
      >
        <div className="flex items-center gap-1.5 text-sm font-medium text-destructive mb-1">
          <Wallet className="size-4" />
          {isLaozhang ? "老张 API" : "Grsai"}
        </div>
        <p className="text-xs text-destructive/80">
          {channel.error ?? "查询失败"}
        </p>
      </div>
    );
  }

  const data = channel.data;
  if (!data) return null;

  if (isLaozhang) {
    const d = data as LaozhangChannelData;
    return (
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-surface/50 backdrop-blur-md p-4">
        {/* 顶部辉光 */}
        <div
          className="absolute -top-12 -right-12 size-24 rounded-full blur-2xl opacity-20"
          style={{ background: accentColor }}
        />

        <div className="relative flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Wallet className="size-3.5" style={{ color: accentColor }} />
            老张 API
          </div>
          <div className="flex items-center gap-1.5">
            {d.group && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                {d.group}
              </Badge>
            )}
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <span
                className="size-1.5 rounded-full animate-pulse"
                style={{ background: accentColor }}
              />
              上游直连
            </span>
          </div>
        </div>

        <div className="relative space-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-0.5">
              剩余余额
            </p>
            <p
              className="text-2xl font-bold tabular-nums"
              style={{ color: accentColor }}
            >
              {formatUsd(d.remainingUsd)}
            </p>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              已用 <span className="text-foreground font-medium">{formatUsd(d.usedUsd)}</span>
            </span>
            <span className="tabular-nums">
              请求 <span className="text-foreground font-medium">{d.requestCount}</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Grsai
  const d = data as GrsaiChannelData;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-surface/50 backdrop-blur-md p-4">
      <div
        className="absolute -top-12 -right-12 size-24 rounded-full blur-2xl opacity-20"
        style={{ background: accentColor }}
      />

      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Wallet className="size-3.5" style={{ color: accentColor }} />
          Grsai
        </div>
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
          积分制
        </Badge>
      </div>

      <div className="relative space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-0.5">
            剩余余额
          </p>
          <p
            className="text-2xl font-bold tabular-nums"
            style={{ color: accentColor }}
          >
            {formatCny(d.remainingCny)}
          </p>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 tabular-nums">
            <Zap className="size-2.5" />
            {d.credits.toLocaleString()} 积分
          </span>
        </div>
      </div>
    </div>
  );
}
