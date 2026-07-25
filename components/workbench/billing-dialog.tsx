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

interface AccountBalance {
  ok: boolean;
  username: string;
  displayName: string;
  group: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  remainingUsd: number;
  usedUsd: number;
  totalUsd: number;
  modelFixedPrices: Record<string, number>;
  fetchedAt: string;
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
  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

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
    setBalanceError(null);
    try {
      const response = await fetch("/api/billing/balance", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const result = (await response.json()) as AccountBalance;
      setBalance(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBalanceError(message);
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

        {/* 账户实时余额 */}
        <BalanceSection balance={balance} error={balanceError} />

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

function BalanceSection({
  balance,
  error,
}: {
  balance: AccountBalance | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-destructive mb-1">
          <Wallet className="size-4" />
          账户余额
        </div>
        <p className="text-xs text-destructive">查询失败：{error}</p>
      </div>
    );
  }

  if (!balance) {
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

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Wallet className="size-4 text-primary" />
          账户余额（老张 API 实时）
        </div>
        {balance.group && (
          <Badge variant="secondary" className="text-[10px]">
            {balance.group}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <OverviewCard
          label="剩余余额"
          value={formatUsd(balance.remainingUsd)}
          unit="USD"
        />
        <OverviewCard
          label="已用额度"
          value={formatUsd(balance.usedUsd)}
          unit="USD"
        />
        <OverviewCard
          label="累计请求"
          value={`${balance.requestCount}`}
          unit="次"
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        账户：{balance.displayName || balance.username}
        {balance.totalUsd > 0 && ` · 历史总额度 ${formatUsd(balance.totalUsd)}`}
        · 更新于 {new Date(balance.fetchedAt).toLocaleTimeString("zh-CN")}
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
