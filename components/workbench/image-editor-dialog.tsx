"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Undo2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, readJsonResponse } from "@/lib/utils";
import {
  ImageCanvasViewport,
  type ImageCanvasLoadStatus,
} from "./image-canvas-viewport";

export interface EditableImage {
  assetId: string;
  preview: string;
  name: string;
  width?: number;
  height?: number;
}

export interface CutoutAsset {
  assetId: string;
  url: string;
  fileName: string;
  fileType: string;
  width: number;
  height: number;
  sourceAssetId: string;
}

interface ImageEditorDialogProps {
  open: boolean;
  image: EditableImage | null;
  onOpenChange: (open: boolean) => void;
  onApply: (asset: CutoutAsset) => void;
}

type CutoutStatus = "idle" | "processing" | "success" | "error";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;
const CUTOUT_TIMEOUT_MS = 120_000;

function calculateFitZoom(width: number, height: number) {
  if (typeof window === "undefined") return 0.5;

  const mobile = window.innerWidth < 768;
  const availableWidth = Math.max(
    240,
    window.innerWidth - (mobile ? 32 : 280),
  );
  const availableHeight = Math.max(
    240,
    window.innerHeight - (mobile ? 250 : 150),
  );
  const fitZoom = Math.min(availableWidth / width, availableHeight / height, 1);
  return Math.max(MIN_ZOOM, Number(fitZoom.toFixed(2)));
}

export function ImageEditorDialog({
  open,
  image,
  onOpenChange,
  onApply,
}: ImageEditorDialogProps) {
  const requestSequenceRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [derivedAsset, setDerivedAsset] = useState<CutoutAsset | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [cutoutStatus, setCutoutStatus] = useState<CutoutStatus>("idle");
  const [cutoutError, setCutoutError] = useState("");
  const [imageStatus, setImageStatus] =
    useState<ImageCanvasLoadStatus>("loading");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(0.5);
  const imageAssetId = image?.assetId;

  const sourceWidth = Math.max(
    1,
    Math.round(image?.width || naturalSize.width || 1024),
  );
  const sourceHeight = Math.max(
    1,
    Math.round(image?.height || naturalSize.height || 1024),
  );
  const resultUrl = derivedAsset?.url || "";
  const activeImageUrl = showResult && resultUrl ? resultUrl : image?.preview || "";
  const displaySize = useMemo(
    () => ({
      width: Math.round(sourceWidth * zoom),
      height: Math.round(sourceHeight * zoom),
    }),
    [sourceHeight, sourceWidth, zoom],
  );

  useEffect(() => {
    if (!open || !imageAssetId) return;

    requestSequenceRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setDerivedAsset(null);
    setShowResult(false);
    setCutoutStatus("idle");
    setCutoutError("");
    setImageStatus("loading");
    setNaturalSize({ width: 0, height: 0 });
  }, [imageAssetId, open]);

  useEffect(() => {
    if (!open) return;
    setZoom(calculateFitZoom(sourceWidth, sourceHeight));
  }, [imageAssetId, open, sourceHeight, sourceWidth]);

  useEffect(() => {
    if (!open) return;
    setImageStatus("loading");
  }, [activeImageUrl, open]);

  useEffect(() => {
    if (open) return;
    requestSequenceRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, [open]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestSequenceRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
    onOpenChange(nextOpen);
  };

  const runCutout = async () => {
    if (!image || cutoutStatus === "processing" || derivedAsset) return;

    const requestId = ++requestSequenceRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    setCutoutStatus("processing");
    setCutoutError("");

    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CUTOUT_TIMEOUT_MS);

    try {
      const response = await fetch(
        `/api/assets/${encodeURIComponent(image.assetId)}/cutout`,
        {
          method: "POST",
          signal: controller.signal,
        },
      );
      const data = await readJsonResponse<{ asset: CutoutAsset }>(
        response,
        "抠图失败",
      );

      if (requestSequenceRef.current !== requestId) return;
      if (!data.asset?.assetId || !data.asset.url) {
        throw new Error("抠图结果缺少可用图片，请重试");
      }

      setDerivedAsset(data.asset);
      setImageStatus("loading");
      setShowResult(true);
      setCutoutStatus("success");
    } catch (error) {
      if (requestSequenceRef.current !== requestId) return;
      if (error instanceof DOMException && error.name === "AbortError" && !timedOut) {
        return;
      }

      setCutoutStatus("error");
      setCutoutError(
        timedOut
          ? "处理超时，请检查网络后重试"
          : error instanceof Error
            ? error.message
            : "抠图失败，请稍后重试",
      );
    } finally {
      window.clearTimeout(timeoutId);
      if (requestSequenceRef.current === requestId) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleApply = () => {
    if (!derivedAsset || !showResult) return;
    onApply(derivedAsset);
    handleOpenChange(false);
  };

  const toolDisabled =
    !image || cutoutStatus === "processing" || cutoutStatus === "success";
  const canUndo = Boolean(derivedAsset && showResult);
  const canRedo = Boolean(derivedAsset && !showResult);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className={iconButtonClass}
            aria-label="关闭图片编辑器"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">图片编辑</DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              {image?.name || "当前图片"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {cutoutStatus === "processing" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                正在处理
              </>
            )}
            {cutoutStatus === "success" && (
              <>
                <Check className="h-3.5 w-3.5 text-primary" />
                抠图完成
              </>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="shrink-0 border-b border-border bg-card p-3 md:w-52 md:border-r md:border-b-0">
            <p className="mb-2 px-2 text-[11px] font-medium tracking-wide text-muted-foreground">
              图片处理
            </p>
            <button
              type="button"
              onClick={() => void runCutout()}
              disabled={toolDisabled}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                cutoutStatus === "success"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-secondary text-foreground hover:border-primary/60 hover:bg-primary/5",
                "disabled:cursor-not-allowed disabled:opacity-70",
              )}
            >
              {cutoutStatus === "processing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : cutoutStatus === "success" ? (
                <Check className="h-4 w-4" />
              ) : (
                <Scissors className="h-4 w-4" />
              )}
              <span>
                {cutoutStatus === "processing"
                  ? "正在一键抠图"
                  : cutoutStatus === "success"
                    ? "一键抠图已完成"
                    : cutoutStatus === "error"
                      ? "重试一键抠图"
                      : "一键抠图"}
              </span>
            </button>

            {cutoutStatus === "success" && (
              <div className="mt-3 rounded-md border border-border bg-secondary/70 p-3 text-xs leading-relaxed text-muted-foreground">
                背景已转为透明。若算法效果不理想，可恢复原图；首版暂不提供保留或擦除修边。
              </div>
            )}
            {cutoutStatus === "error" && (
              <div className="mt-3 space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="text-xs font-medium text-destructive">抠图失败</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {cutoutError}
                </p>
                <button
                  type="button"
                  onClick={() => void runCutout()}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  重试
                </button>
              </div>
            )}
          </aside>

          <ImageCanvasViewport
            imageUrl={activeImageUrl}
            imageAlt={image?.name || "待编辑图片"}
            displayWidth={displaySize.width}
            displayHeight={displaySize.height}
            imageStatus={imageStatus}
            onImageStatusChange={setImageStatus}
            onImageLoad={(event) => {
              if (image?.width && image?.height) return;
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                setNaturalSize({ width: naturalWidth, height: naturalHeight });
              }
            }}
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              const delta = event.deltaY > 0 ? -0.1 : 0.1;
              setZoom((current) =>
                Math.max(
                  MIN_ZOOM,
                  Math.min(MAX_ZOOM, Number((current + delta).toFixed(2))),
                ),
              );
            }}
            checkerboard={Boolean(derivedAsset && showResult)}
            className="flex-1 bg-secondary/60"
            stageClassName="ring-1 ring-border"
            loadingMessage="图片加载中..."
            errorMessage="图片加载失败，请恢复原图或稍后重试"
          >
            {cutoutStatus === "processing" && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/60 text-sm font-medium text-foreground backdrop-blur-[1px]">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                正在抠图，请稍候…
              </div>
            )}
          </ImageCanvasViewport>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-3 md:px-4">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setImageStatus("loading");
                setShowResult(false);
              }}
              disabled={!canUndo}
              className={iconButtonClass}
              aria-label="撤销抠图"
              title="撤销"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setImageStatus("loading");
                setShowResult(true);
              }}
              disabled={!canRedo}
              className={iconButtonClass}
              aria-label="恢复抠图结果"
              title="恢复抠图结果"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDerivedAsset(null);
                setShowResult(false);
                setCutoutStatus("idle");
                setCutoutError("");
              }}
              disabled={!derivedAsset}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复原图
            </button>
          </div>

          <div className="flex items-center gap-1.5 md:ml-2">
            <button
              type="button"
              onClick={() =>
                setZoom((current) =>
                  Math.max(MIN_ZOOM, Number((current - 0.15).toFixed(2))),
                )
              }
              className={iconButtonClass}
              aria-label="缩小"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-12 text-center text-xs text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() =>
                setZoom((current) =>
                  Math.min(MAX_ZOOM, Number((current + 0.15).toFixed(2))),
                )
              }
              className={iconButtonClass}
              aria-label="放大"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!derivedAsset || !showResult || imageStatus !== "loaded"}
              className="h-9 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              应用
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

const iconButtonClass =
  "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
