"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
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
  const eraseModeRef = useRef(false); // 记录当前绘制是否为橡皮模式
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [brushSize, setBrushSize] = useState(42);
  const [mode, setMode] = useState<PaintMode>("draw");
  const [history, setHistory] = useState<string[]>([]);
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [isSpacePressed, setIsSpacePressed] = useState(false);

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

    // 重置状态
    setBrushSize(42);
    setMode("draw");
    setHistory([]);
    setImageStatus("loading");

    // 计算初始 zoom 以完整显示图片
    const calculateFitZoom = () => {
      // 假设对话框内容区域大约是 90vh - 150px（顶部标题和工具栏）
      const availableHeight = window.innerHeight * 0.9 - 150;
      const availableWidth = Math.min(1200, window.innerWidth * 0.96) - 64; // 对话框最大宽度减去 padding

      const scaleX = availableWidth / safeWidth;
      const scaleY = availableHeight / safeHeight;
      const fitZoom = Math.min(scaleX, scaleY, 1); // 不超过原始尺寸

      return Math.max(0.35, Math.min(1, Number(fitZoom.toFixed(2))));
    };

    // 立即设置 zoom
    const newZoom = calculateFitZoom();
    setZoom(newZoom);

    // 初始化 canvas
    window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = safeWidth;
      canvas.height = safeHeight;
      canvas.getContext("2d")?.clearRect(0, 0, safeWidth, safeHeight);
    }, 0);

    // 图片居中：滚动到图片中心偏上位置（脸部通常在这里）
    window.setTimeout(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;

      const displayWidth = safeWidth * newZoom;
      const displayHeight = safeHeight * newZoom;

      // 计算居中滚动位置，垂直方向偏上 10%（0.1 表示从顶部往下 10% 的位置）
      const scrollLeft = Math.max(0, (displayWidth - scroller.clientWidth) / 2);
      const scrollTop = Math.max(0, (displayHeight - scroller.clientHeight) * 0.1);

      scroller.scrollLeft = scrollLeft;
      scroller.scrollTop = scrollTop;
    }, 100);
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

  const paintTo = (point: { x: number; y: number }, eraseMode = false) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const lastPoint = lastPointRef.current;
    if (!canvas || !ctx || !lastPoint) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    if (eraseMode) {
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
    // 中键或空格+左键：拖动画布
    if (event.button === 1 || (event.button === 0 && isSpacePressed)) {
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

    // 左键或右键：涂抹或擦除
    if (event.button !== 0 && event.button !== 2) return;

    const point = getPoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pushHistory();
    drawingRef.current = true;
    lastPointRef.current = point;

    // 右键是橡皮，左键是涂抹
    const eraseMode = event.button === 2;
    eraseModeRef.current = eraseMode; // 记录模式
    paintTo({ x: point.x + 0.01, y: point.y + 0.01 }, eraseMode);
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

    // 使用记录的模式，而不是判断当前按键状态
    paintTo(point, eraseModeRef.current);
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

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // 滚轮缩放
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      setZoom((value) => {
        const newZoom = value + delta;
        return Math.max(0.35, Math.min(3, Number(newZoom.toFixed(2))));
      });
    }
  };

  // 监听空格键按下/释放，用于临时切换到拖动模式
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isSpacePressed) {
        event.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [open, isSpacePressed]);

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
              主要涂眉眼鼻嘴和脸颊，少量碰到头发没事；不要大面积涂帽子、发饰和衣领。左键涂抹，右键橡皮，Ctrl+滚轮缩放。
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
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-1.5">
            <div className="flex items-center gap-1.5 text-xs">
              <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium shadow-sm">
                左键
              </kbd>
              <span className="text-muted-foreground">涂抹</span>
            </div>
            <div className="h-3 w-px bg-border" />
            <div className="flex items-center gap-1.5 text-xs">
              <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium shadow-sm">
                右键
              </kbd>
              <span className="text-muted-foreground">橡皮</span>
            </div>
            <div className="h-3 w-px bg-border" />
            <div className="flex items-center gap-1.5 text-xs">
              <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium shadow-sm">
                Ctrl
              </kbd>
              <span className="text-muted-foreground">+滚轮缩放</span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
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
          onWheel={handleWheel}
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
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                "absolute inset-0 h-full w-full touch-none",
                imageStatus !== "loaded"
                  ? "pointer-events-none"
                  : isSpacePressed
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

const iconButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-40";
