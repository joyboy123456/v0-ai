"use client";

import { useCallback, useEffect, useState } from "react";
import { DollarSign, Loader2, RefreshCw, ImageIcon, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ModelBillingSummary {
  model: string;
  unitPriceUsd: number;
  count: number;
  totalUsd: number;
  calls: number;
}

interface ModelPrice {
  model: string;
  unitPriceUsd: number;
}

interface BillingSummary {
  ok: boolean;
  date: string;
  totalCount: number;
  totalUsd: number;
  totalCalls: number;
  modelPrices: ModelPrice[];
  byModel: ModelBillingSummary[];
  error?: string;
}

/** 老张渠道余额数据（USD 口径）。 */
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

/** Grsai 渠道余额数据（CNY 积分口径）。 */
interface GrsaiChannelData {
  channel: "grsai";
  displayName: string;
  credits: number;
  remainingCny: number;
  currency: "CNY";
  fetchedAt: string;
}

/** 单渠道余额结果（route 返回的 channels 元素）。 */
interface ChannelBalanceResult {
  channel: "laozhang" | "grsai";
  ok: boolean;
  error?: string;
  data?: LaozhangChannelData | GrsaiChannelData;
}

/** 多渠道余额聚合响应（/api/billing/balance 新结构）。 */
interface MultiChannelBalance {
  ok: boolean;
  channels: ChannelBalanceResult[];
  error?: string;
}

// 与 lib/types.ts 的 FASHION_MODELS label 保持一致；仅列出当前实际使用的模型，
// 其余作为历史/灰度模型 fallback 显示原始 ID。
const MODEL_LABELS: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "Nano Banana",
  "gpt-image-2": "GPT Image 2",
  "gemini-3-pro-image-preview": "Nano Banana Pro",
  "nano-banana-2-lite": "Grsai Nano Banana 2 Lite",
  "nano-banana-2": "Grsai Nano Banana 2",
  "nano-banana-pro": "Grsai Nano Banana Pro",
};

function getModelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function BillingDialog({ open, onOpenChange }: BillingDialogProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BillingSummary | null>(null);
  const [balanceChannels, setBalanceChannels] = useState<ChannelBalanceResult[] | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBilling = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/today", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const summary = (await response.json()) as BillingSummary;
      setData(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    try {
      const response = await fetch("/api/billing/balance", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as MultiChannelBalance;
      // route 用 Promise.allSettled，至少一个渠道成功也返回；channels 始终存在
      if (body.channels && Array.isArray(body.channels)) {
        setBalanceChannels(body.channels);
      } else {
        // 兜底：旧结构或异常，构造一个失败渠道
        setBalanceChannels([
          {
            channel: "laozhang",
            ok: false,
            error: body.error ?? `HTTP ${response.status}`,
          },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBalanceChannels([
        { channel: "laozhang", ok: false, error: message },
        { channel: "grsai", ok: false, error: message },
      ]);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchBilling();
    fetchBalance();
  }, [fetchBilling, fetchBalance]);

  useEffect(() => {
    if (open) {
      fetchBilling();
      fetchBalance();
    }
  }, [open, fetchBilling, fetchBalance]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="size-5 text-primary" />
            计费统计
          </DialogTitle>
          <DialogDescription>
            账户实时余额 + 今日本地计费累计 · 今日 0 点至今
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshAll}
            disabled={loading}
            className="text-muted-foreground"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        </div>

        {/* 账户实时余额（多渠道） */}
        <BalanceSection channels={balanceChannels} loading={balanceLoading} />

        {/* 今日计费 */}
        {loading && !data && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="ml-2 text-sm">加载中…</span>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            今日计费查询失败：{error}
          </div>
        )}

        {data && !error && (
          <BillingContent data={data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatCny(value: number): string {
  if (value === 0) return "¥0.00";
  if (value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function BalanceSection({
  channels,
  loading,
}: {
  channels: ChannelBalanceResult[] | null;
  loading: boolean;
}) {
  // 加载中且无数据：显示骨架
  if (loading && !channels) {
    return (
      <div className="rounded-lg border border-border bg-secondary/30 p-4">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2">
          <Wallet className="size-4 text-primary" />
          账户余额
        </div>
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="ml-2">加载中…</span>
        </div>
      </div>
    );
  }

  if (!channels || channels.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {channels.map((ch) => (
        <ChannelBalanceCard key={ch.channel} channel={ch} />
      ))}
    </div>
  );
}

function ChannelBalanceCard({ channel }: { channel: ChannelBalanceResult }) {
  // 失败：显示错误条
  if (!channel.ok) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-destructive mb-1">
          <Wallet className="size-4" />
          {channelLabel(channel.channel)}
        </div>
        <p className="text-xs text-destructive">查询失败：{channel.error ?? "未知错误"}</p>
      </div>
    );
  }

  const data = channel.data;
  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-secondary/30 p-4">
        <div className="text-sm font-medium text-foreground mb-1">
          {channelLabel(channel.channel)}
        </div>
        <p className="text-xs text-muted-foreground">余额数据为空</p>
      </div>
    );
  }

  // 按渠道类型分发渲染
  if (data.channel === "laozhang") {
    return <LaozhangBalanceCard data={data} />;
  }
  return <GrsaiBalanceCard data={data} />;
}

function channelLabel(channel: string): string {
  if (channel === "laozhang") return "老张 API 实时余额";
  if (channel === "grsai") return "Grsai 实时余额";
  return channel;
}

function LaozhangBalanceCard({ data }: { data: LaozhangChannelData }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Wallet className="size-4 text-primary" />
          {channelLabel("laozhang")}
        </div>
        {data.group && (
          <Badge variant="secondary" className="text-[10px]">
            {data.group}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <OverviewCard
          label="剩余余额"
          value={formatUsd(data.remainingUsd)}
          unit="USD"
        />
        <OverviewCard
          label="已用额度"
          value={formatUsd(data.usedUsd)}
          unit="USD"
        />
        <OverviewCard
          label="累计请求"
          value={`${data.requestCount}`}
          unit="次"
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        账户：{data.displayName || data.username}
        {data.totalUsd > 0 && ` · 历史总额度 ${formatUsd(data.totalUsd)}`}
        · 更新于 {new Date(data.fetchedAt).toLocaleTimeString("zh-CN")}
      </p>
    </div>
  );
}

function GrsaiBalanceCard({ data }: { data: GrsaiChannelData }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Wallet className="size-4 text-primary" />
          {channelLabel("grsai")}
        </div>
        <Badge variant="secondary" className="text-[10px]">
          积分制
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OverviewCard
          label="剩余积分"
          value={`${data.credits}`}
          unit="积分"
        />
        <OverviewCard
          label="剩余余额"
          value={formatCny(data.remainingCny)}
          unit="CNY"
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        1 元 = 10000 积分 · 接口仅返回剩余积分，暂无已用/累计统计
        · 更新于 {new Date(data.fetchedAt).toLocaleTimeString("zh-CN")}
      </p>
    </div>
  );
}

function BillingContent({ data }: { data: BillingSummary }) {
  return (
    <div className="space-y-5">
      {/* 概览卡片 */}
      <div className="grid grid-cols-3 gap-3">
        <OverviewCard
          label="今日生成"
          value={`${data.totalCount}`}
          unit="张"
          icon={<ImageIcon className="size-4" />}
        />
        <OverviewCard
          label="今日花费"
          value={formatUsd(data.totalUsd)}
          unit="USD"
        />
        <OverviewCard
          label="今日调用"
          value={`${data.totalCalls}`}
          unit="次"
        />
      </div>

      <Separator />

      {/* 今日消耗明细 */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          今日消耗明细
        </h3>
        {data.byModel.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            今日暂无生图记录
          </p>
        ) : (
          <div className="space-y-2">
            {data.byModel.map((item) => (
              <div
                key={item.model}
                className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground truncate">
                      {getModelLabel(item.model)}
                    </span>
                    <Badge variant="secondary" className="text-[10px] font-normal shrink-0">
                      {item.calls} 次调用
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {item.model}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[13px] font-semibold text-foreground">
                    {item.count} 张
                  </p>
                  <p className="text-[11px] text-primary font-medium">
                    {formatUsd(item.totalUsd)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* 模型单价表 */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          模型单价表
        </h3>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">模型</th>
                <th className="text-right font-medium px-3 py-2">单价</th>
              </tr>
            </thead>
            <tbody>
              {data.modelPrices.map((price, index) => (
                <tr
                  key={price.model}
                  className={cn(
                    "border-t border-border",
                    index % 2 === 1 && "bg-secondary/20",
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">
                      {getModelLabel(price.model)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {price.model}
                    </div>
                  </td>
                  <td className="text-right px-3 py-2 font-medium text-primary whitespace-nowrap">
                    ${price.unitPriceUsd.toFixed(3)}/张
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        日期：{data.date} · 今日消耗按模型固定单价本地累计，账户余额实时拉取
      </p>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold text-foreground tabular-nums">
          {value}
        </span>
        <span className="text-[11px] text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
