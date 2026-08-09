"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, TicketPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface InviteCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PublicInviteCode {
  code: string;
  createdAt: number;
  expiresAt: number | null;
  usedAt: number | null;
  usedByUserId: string | null;
  status: "available" | "used" | "expired" | "pending";
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: PublicInviteCode["status"]): string {
  switch (status) {
    case "available":
      return "可用";
    case "used":
      return "已用";
    case "expired":
      return "过期";
    case "pending":
      return "占用中";
  }
}

export function InviteCodesDialog({
  open,
  onOpenChange,
}: InviteCodesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [codes, setCodes] = useState<PublicInviteCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<PublicInviteCode[]>([]);

  const fetchCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/invite-codes", {
        credentials: "include",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        codes?: PublicInviteCode[];
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      }
      setCodes(json.codes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载邀请码失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchCodes();
  }, [open, fetchCodes]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/invite-codes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1, expiresInDays: 7 }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        codes?: PublicInviteCode[];
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      }
      const created = json.codes ?? [];
      setLastCreated(created);
      await fetchCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成邀请码失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => {
        setCopiedCode((current) => (current === code ? null : current));
      }, 1500);
    } catch {
      setError("复制失败，请手动选择邀请码");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            邀请码管理
          </DialogTitle>
          <DialogDescription>
            生成一次性邀请码发给同事。默认 7 天有效，注册成功后自动作废。
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 flex items-center gap-2">
          <Button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="gap-1.5"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <TicketPlus className="size-4" />
            )}
            {creating ? "生成中…" : "生成邀请码"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void fetchCodes()}
            disabled={loading}
          >
            刷新
          </Button>
        </div>

        {lastCreated.length > 0 ? (
          <div className="mx-6 mb-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
            <p className="text-xs font-medium text-primary mb-2">刚生成，可复制发送</p>
            <div className="space-y-2">
              {lastCreated.map((item) => (
                <div
                  key={item.code}
                  className="flex items-center justify-between gap-2 rounded-md bg-background/80 px-2.5 py-2"
                >
                  <code className="font-mono text-sm tracking-wider">{item.code}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1"
                    onClick={() => void handleCopy(item.code)}
                  >
                    {copiedCode === item.code ? (
                      <Check className="size-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copiedCode === item.code ? "已复制" : "复制"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <Separator />

        <div className="max-h-[360px] overflow-y-auto px-6 py-4">
          {error ? (
            <p className="mb-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {loading && codes.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载中…
            </div>
          ) : codes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              还没有邀请码，点上方按钮生成。
            </p>
          ) : (
            <ul className="space-y-2">
              {codes.map((item) => (
                <li
                  key={`${item.code}-${item.createdAt}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[13px] tracking-wider">
                        {item.code}
                      </code>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px]",
                          item.status === "available" &&
                            "bg-emerald-50 text-emerald-700",
                          item.status === "used" && "bg-secondary text-muted-foreground",
                          item.status === "expired" &&
                            "bg-amber-50 text-amber-700",
                        )}
                      >
                        {statusLabel(item.status)}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      创建 {formatTime(item.createdAt)}
                      {item.expiresAt ? ` · 过期 ${formatTime(item.expiresAt)}` : ""}
                      {item.usedAt ? ` · 使用 ${formatTime(item.usedAt)}` : ""}
                    </p>
                  </div>
                  {item.status === "available" ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => void handleCopy(item.code)}
                      aria-label="复制邀请码"
                    >
                      {copiedCode === item.code ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
