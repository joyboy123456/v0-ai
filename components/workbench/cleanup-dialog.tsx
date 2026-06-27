"use client";

import { useState } from "react";
import { Search, Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefreshTasks: () => void;
}

interface PreviewAsset {
  assetId: string;
  fileName: string;
  createdAt: string;
  fileUrl: string;
}

interface CleanupResult {
  success?: boolean;
  deletedAssets: number;
  deletedObjects: number;
  errors: number;
  details?: Array<{ assetId: string; key: string; error?: string }>;
}

const MAX_PREVIEW_THUMBNAILS = 20;

export function CleanupDialog({
  open,
  onOpenChange,
  onRefreshTasks,
}: CleanupDialogProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [previewAssets, setPreviewAssets] = useState<PreviewAsset[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  function resetState() {
    setPreviewAssets([]);
    setPreviewTotal(0);
    setPreviewError(null);
    setResult(null);
    setResultError(null);
    setConfirmOpen(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      resetState();
    }
    onOpenChange(next);
  }

  async function handlePreview() {
    if (!startDate || !endDate) return;
    setPreviewing(true);
    setPreviewError(null);
    setPreviewAssets([]);
    setPreviewTotal(0);
    setResult(null);
    setResultError(null);

    try {
      const params = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`/api/cleanup?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `查询失败：HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        total: number;
        assets: PreviewAsset[];
      };
      setPreviewTotal(data.total);
      setPreviewAssets(data.assets);
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : "查询失败，请重试",
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirmCleanup() {
    setCleaning(true);
    setResultError(null);
    setResult(null);

    try {
      const response = await fetch("/api/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `清理失败：HTTP ${response.status}`);
      }
      const data = (await response.json()) as CleanupResult;
      setResult(data);
      setConfirmOpen(false);
      onRefreshTasks();
    } catch (error) {
      setResultError(
        error instanceof Error ? error.message : "清理失败，请重试",
      );
    } finally {
      setCleaning(false);
    }
  }

  const hasPreview = previewTotal > 0 || previewAssets.length > 0;
  const previewThumbnails = previewAssets.slice(0, MAX_PREVIEW_THUMBNAILS);
  const remainingCount = Math.max(0, previewTotal - MAX_PREVIEW_THUMBNAILS);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 text-muted-foreground" />
              手动清理生成图
            </DialogTitle>
            <DialogDescription>
              选择日期范围，预览待清理的生成图后手动确认删除。已收藏的图片不会被清理。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  开始日期
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  结束日期
                </label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handlePreview}
                disabled={!startDate || !endDate || previewing}
                className="h-9"
              >
                {previewing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                查询
              </Button>
            </div>

            {previewError && (
              <p className="text-sm text-destructive">{previewError}</p>
            )}

            {hasPreview && !result && (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  找到 <span className="text-primary">{previewTotal}</span> 张生成图
                </p>
                {previewThumbnails.length > 0 && (
                  <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                    {previewThumbnails.map((asset) => (
                      <div
                        key={asset.assetId}
                        className="aspect-square rounded-md overflow-hidden border border-border bg-secondary"
                      >
                        <img
                          src={asset.fileUrl}
                          alt={asset.fileName}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {remainingCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    还有 {remainingCount} 张未展示…
                  </p>
                )}
              </div>
            )}

            {result && (
              <div className="space-y-2 rounded-md border border-border bg-secondary/50 p-4">
                <p className="text-sm font-medium">
                  清理完成：删除了 {result.deletedAssets} 张生成图，
                  {result.deletedObjects} 个存储对象
                </p>
                {result.errors > 0 && (
                  <p className="text-sm text-destructive">
                    {result.errors} 个错误（详情见服务端日志）
                  </p>
                )}
              </div>
            )}

            {resultError && (
              <p className="text-sm text-destructive">{resultError}</p>
            )}
          </div>

          <DialogFooter>
            {result ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                关闭
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!hasPreview || cleaning}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                  确认清理
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!cleaning) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清理？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除 {previewTotal} 张生成图（含原图及缩略图），此操作不可撤销。已收藏的图片不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleaning}>再想想</AlertDialogCancel>
            <AlertDialogAction
              disabled={cleaning}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmCleanup();
              }}
            >
              {cleaning ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  清理中…
                </>
              ) : (
                "确认删除"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
