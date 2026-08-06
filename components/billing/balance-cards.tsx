"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Wallet, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatUsd,
  formatCny,
  LAOZHANG_ACCENT,
  GRSAI_ACCENT,
  WARN_ACCENT,
  getBalanceLevel,
  type BalanceLevel,
  type ChannelBalanceResult,
  type LaozhangChannelData,
  type GrsaiChannelData,
} from "./shared";

interface BalanceCardsProps {
  channels: ChannelBalanceResult[] | null;
  loading: boolean;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

export function BalanceCards({ channels, loading }: BalanceCardsProps) {
  if (loading && !channels) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-surface shadow-card p-5"
          >
            <div className="skeleton-shimmer h-4 w-24 rounded mb-4" />
            <div className="skeleton-shimmer h-8 w-32 rounded mb-3" />
            <div className="skeleton-shimmer h-3 w-28 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!channels || channels.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {channels.map((ch, i) => (
        <motion.div
          key={ch.channel}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: i * 0.06 }}
        >
          <BalanceMeterCard channel={ch} />
        </motion.div>
      ))}
    </div>
  );
}

/** 低余额/耗尽提示行（耗尽红、不足琥珀）。 */
function BalanceWarningLine({ level }: { level: BalanceLevel }) {
  if (level === "normal") return null;
  const exhausted = level === "exhausted";
  return (
    <p
      className="flex items-center gap-1 text-xs font-medium"
      style={{ color: exhausted ? "var(--destructive)" : WARN_ACCENT }}
    >
      <AlertTriangle className="size-3" />
      {exhausted ? "余额已耗尽，充值后恢复使用" : "余额不足，建议及时充值"}
    </p>
  );
}

function BalanceMeterCard({ channel }: { channel: ChannelBalanceResult }) {
  const isLaozhang = channel.channel === "laozhang";
  const accentColor = isLaozhang ? LAOZHANG_ACCENT : GRSAI_ACCENT;

  // 查询失败
  if (!channel.ok) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-destructive mb-1.5">
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
    const level = getBalanceLevel("laozhang", d.remainingUsd);
    return (
      <div
        className={`relative overflow-hidden rounded-2xl border bg-surface shadow-card p-5 ${
          level === "exhausted" ? "border-destructive/30" : "border-border"
        }`}
      >
        <div
          className="absolute -top-12 -right-12 size-24 rounded-full blur-2xl opacity-15"
          style={{ background: accentColor }}
        />

        <div className="relative flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Wallet className="size-4" style={{ color: accentColor }} />
            老张 API
          </div>
          <div className="flex items-center gap-1.5">
            {d.group && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {d.group}
              </Badge>
            )}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span
                className="size-1.5 rounded-full animate-pulse"
                style={{ background: accentColor }}
              />
              上游直连
            </span>
          </div>
        </div>

        <div className="relative space-y-2.5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              剩余余额
            </p>
            <p
              className="text-[28px] leading-8 font-bold tabular-nums"
              style={{
                color: level === "exhausted" ? "var(--destructive)" : accentColor,
              }}
            >
              {formatUsd(d.remainingUsd)}
            </p>
          </div>

          <BalanceWarningLine level={level} />

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="tabular-nums">
              已用 <span className="text-foreground font-medium">{formatUsd(d.usedUsd)}</span>
            </span>
            <span className="tabular-nums">
              请求 <span className="text-foreground font-medium">{d.requestCount.toLocaleString()}</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Grsai
  const d = data as GrsaiChannelData;
  const level = getBalanceLevel("grsai", d.remainingCny);
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-surface shadow-card p-5 ${
        level === "exhausted" ? "border-destructive/30" : "border-border"
      }`}
    >
      <div
        className="absolute -top-12 -right-12 size-24 rounded-full blur-2xl opacity-15"
        style={{ background: accentColor }}
      />

      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Wallet className="size-4" style={{ color: accentColor }} />
          Grsai
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          积分制
        </Badge>
      </div>

      <div className="relative space-y-2.5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
            剩余余额
          </p>
          <p
            className="text-[28px] leading-8 font-bold tabular-nums"
            style={{
              color: level === "exhausted" ? "var(--destructive)" : accentColor,
            }}
          >
            {formatCny(d.remainingCny)}
          </p>
        </div>

        <BalanceWarningLine level={level} />

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 tabular-nums">
            <Zap className="size-3" />
            {d.credits.toLocaleString()} 积分
          </span>
        </div>
      </div>
    </div>
  );
}
