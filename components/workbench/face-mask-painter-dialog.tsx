"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brush,
  Eraser,
  Minus,
  Move,
  Plus,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type PaintMode = "draw" | "erase" | "pan";

interface FaceMaskPainterDialogProps {
  open: boolean;
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onOpenChange: (open: boolean) => void;
  onComplete: (maskDataUrl: string) => void;
}

export function FaceMaskPainterDialog({
  open,
  title,
  imageUrl,
  imageWidth,
  imageHeight,
  onOpenChange,
  onComplete,
}: FaceMaskPainterDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [brushSize, setBrushSize] = useState(42);
  const [mode, setMode] = useState<PaintMode>("draw");
  const [history, setHistory] = useState<string[]>([]);
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "error">("loading");

  const safeWidth = Math.max(1, Math.round(imageWidth || 1024));
  const safeHeight = Math.max(1, Math.round(imageHeight || 1365));
  const displaySize = useMemo(
    () => ({
      width: Math.round(safeWidth * zoom),
      height: Math.round(safeHeight * zoom),
    }),
    [safeWidth, safeHeight, zoom],
  );

  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setBrushSize(42);
    setMode("draw");
    setHistory([]);
    setImageStatus("loading");
    window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = safeWidth;
      canvas.height = safeHeight;
      canvas.getContext("2d")?.clearRect(0, 0, safeWidth, safeHeight);
    }, 0);
  }, [imageUrl, open, safeHeight, safeWidth]);

  const pushHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHistory((current) => [...current.slice(-14), canvas.toDataURL("image/png")]);
  };

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * safeWidth,
      y: ((event.clientY - rect.top) / rect.height) * safeHeight,
    };
  };

  const paintTo = (point: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const lastPoint = lastPointRef.current;
    if (!canvas || !ctx || !lastPoint) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    if (mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(56,189,248,0.92)";
    }
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
    lastPointRef.current = point;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === "pan") {
      const scroller = scrollRef.current;
      if (!scroller) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
      return;
    }

    const point = getPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pushHistory();
    drawingRef.current = true;
    lastPointRef.current = point;
    paintTo({ x: point.x + 0.01, y: point.y + 0.01 });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pan = panRef.current;
    if (pan) {
      const scroller = scrollRef.current;
      if (!scroller) return;
      event.preventDefault();
      scroller.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
      scroller.scrollTop = pan.scrollTop - (event.clientY - pan.y);
      return;
    }

    if (!drawingRef.current) return;
    const point = getPoint(event);
    if (!point) return;
    paintTo(point);
  };

  const stopDrawing = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
    panRef.current = null;
  };

  const handleUndo = () => {
    const previous = history.at(-1);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!previous || !canvas || !ctx) return;
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, safeWidth, safeHeight);
      ctx.drawImage(image, 0, 0, safeWidth, safeHeight);
      setHistory((current) => current.slice(0, -1));
    };
    image.src = previous;
  };

  const handleReset = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    pushHistory();
    canvas.getContext("2d")?.clearRect(0, 0, safeWidth, safeHeight);
  };

  const hasMaskContent = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return false;
    const data = ctx.getImageData(0, 0, safeWidth, safeHeight).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 12) return true;
    }
    return false;
  };

  const handleComplete = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (imageStatus !== "loaded") {
      window.alert("底图还没有加载成功，请稍等或刷新后重试");
      return;
    }
    if (!hasMaskContent()) {
      window.alert("请先涂抹人脸五官区域");
      return;
    }
    onComplete(canvas.toDataURL("image/png"));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-w-[min(1200px,96vw)] flex-col p-0">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">
              主要涂眉眼鼻嘴和脸颊，少量碰到头发没事；不要大面积涂帽子、发饰和衣领。
            </p>
          </div>
          <button
            type="button"
            onClick={handleComplete}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            完成
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setMode("draw")}
            className={toolButtonClass(mode === "draw")}
          >
            <Brush className="h-4 w-4" />
            涂抹
          </button>
          <button
            type="button"
            onClick={() => setMode("erase")}
            className={toolButtonClass(mode === "erase")}
          >
            <Eraser className="h-4 w-4" />
            橡皮
          </button>
          <button
            type="button"
            onClick={() => setMode("pan")}
            className={toolButtonClass(mode === "pan")}
          >
            <Move className="h-4 w-4" />
            拖动
          </button>
          <label className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
            笔刷
            <input
              type="range"
              min={12}
              max={96}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
              className="w-28"
            />
            <span className="w-8 text-right">{brushSize}</span>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setZoom((value) =>
                  Math.max(0.35, Number((value - 0.15).toFixed(2))),
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
                setZoom((value) =>
                  Math.min(3, Number((value + 0.15).toFixed(2))),
                )
              }
              className={iconButtonClass}
              aria-label="放大"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleUndo}
              disabled={!history.length}
              className={iconButtonClass}
              aria-label="撤销"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={iconButtonClass}
              aria-label="重置"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto bg-secondary/50 p-4"
        >
          <div
            className="relative mx-auto bg-white shadow-sm"
            style={{ width: displaySize.width, height: displaySize.height }}
          >
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={() => setImageStatus("loaded")}
              onError={() => setImageStatus("error")}
              className="absolute inset-0 h-full w-full select-none object-contain"
            />
            {imageStatus !== "loaded" && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 px-6 text-center text-sm text-muted-foreground">
                {imageStatus === "error"
                  ? "底图加载失败，请关闭后刷新任务再重试"
                  : "底图加载中..."}
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={safeWidth}
              height={safeHeight}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
              className={cn(
                "absolute inset-0 h-full w-full touch-none",
                imageStatus !== "loaded"
                  ? "pointer-events-none"
                  : mode === "pan"
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-crosshair",
              )}
              style={{ opacity: 0.72 }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function toolButtonClass(active: boolean) {
  return cn(
    "flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground",
  );
}

const iconButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-40";
