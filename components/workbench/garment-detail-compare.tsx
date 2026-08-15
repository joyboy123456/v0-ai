"use client";

/**
 * 高清放大细节图的结果预览舞台（PRD FR-18 轻量版）：
 * - 滚轮/按钮缩放（0.5x ~ 4x）、拖拽平移、双击切换 1x ↔ 2.5x；
 * - 「原图对比」模式：左原图右细节图双窗格并排。
 * 局部定位框（原图热区联动）留待后端接入后实现。
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function ZoomablePane({ src, label }: { src: string; label: string }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const zoomBy = (factor: number) => {
    setScale((current) => {
      const next = clampScale(current * factor);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.baseX + event.clientX - drag.startX,
      y: drag.baseY + event.clientY - drag.startY,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-[#111315]"
      style={{ touchAction: "none" }}
      onWheel={(event) => {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => (scale === 1 ? zoomBy(2.5) : reset())}
    >
      <div className="flex h-full items-center justify-center">
        <img
          src={src}
          alt={label}
          draggable={false}
          className={cn(
            "max-h-full max-w-full select-none object-contain",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 160ms ease-out",
          }}
        />
      </div>

      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white/85">
        {label}
      </span>

      <div
        className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/55 p-1"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="缩小"
          onClick={() => zoomBy(1 / 1.25)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/15"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-11 text-center text-[11px] tabular-nums text-white/80">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          aria-label="放大"
          onClick={() => zoomBy(1.25)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/15"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="重置缩放"
          onClick={reset}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/15"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function GarmentDetailCompareStage({
  detailUrl,
  originalUrl,
  compare,
}: {
  detailUrl: string;
  originalUrl?: string;
  compare: boolean;
}) {
  if (compare && originalUrl) {
    return (
      <div className="grid h-full min-h-0 grid-cols-1 gap-px bg-border md:grid-cols-2">
        <ZoomablePane src={originalUrl} label="原图" />
        <ZoomablePane src={detailUrl} label="细节图" />
      </div>
    );
  }
  return <ZoomablePane src={detailUrl} label="细节图" />;
}
