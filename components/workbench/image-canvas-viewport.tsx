"use client";

import type {
  CSSProperties,
  ReactEventHandler,
  ReactNode,
  RefObject,
  WheelEventHandler,
} from "react";
import { cn } from "@/lib/utils";

export type ImageCanvasLoadStatus = "loading" | "loaded" | "error";

interface ImageCanvasViewportProps {
  scrollRef?: RefObject<HTMLDivElement | null>;
  imageUrl: string;
  imageAlt: string;
  displayWidth: number;
  displayHeight: number;
  imageStatus: ImageCanvasLoadStatus;
  onImageStatusChange: (status: ImageCanvasLoadStatus) => void;
  onImageLoad?: ReactEventHandler<HTMLImageElement>;
  onWheel?: WheelEventHandler<HTMLDivElement>;
  checkerboard?: boolean;
  className?: string;
  stageClassName?: string;
  loadingMessage?: string;
  errorMessage?: string;
  children?: ReactNode;
}

const checkerboardStyle: CSSProperties = {
  backgroundColor: "var(--secondary)",
  backgroundImage:
    "linear-gradient(45deg, var(--card) 25%, transparent 25%), linear-gradient(-45deg, var(--card) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--card) 75%), linear-gradient(-45deg, transparent 75%, var(--card) 75%)",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
  backgroundSize: "20px 20px",
};

/**
 * 图片编辑类对话框共用的画布视口。
 * 保持图片坐标系不变，只通过外层尺寸控制缩放；overlay 可叠加 canvas 或处理状态。
 */
export function ImageCanvasViewport({
  scrollRef,
  imageUrl,
  imageAlt,
  displayWidth,
  displayHeight,
  imageStatus,
  onImageStatusChange,
  onImageLoad,
  onWheel,
  checkerboard = false,
  className,
  stageClassName,
  loadingMessage = "图片加载中...",
  errorMessage = "图片加载失败，请稍后重试",
  children,
}: ImageCanvasViewportProps) {
  return (
    <div
      ref={scrollRef}
      className={cn("min-h-0 overflow-auto p-4", className)}
      onWheel={onWheel}
    >
      <div
        className={cn(
          "relative mx-auto overflow-hidden bg-card shadow-sm",
          stageClassName,
        )}
        style={{
          width: Math.max(1, Math.round(displayWidth)),
          height: Math.max(1, Math.round(displayHeight)),
          ...(checkerboard ? checkerboardStyle : undefined),
        }}
      >
        <img
          key={imageUrl}
          src={imageUrl}
          alt={imageAlt}
          draggable={false}
          onLoad={(event) => {
            onImageStatusChange("loaded");
            onImageLoad?.(event);
          }}
          onError={() => onImageStatusChange("error")}
          className="absolute inset-0 h-full w-full select-none object-contain"
        />
        {imageStatus !== "loaded" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/90 px-6 text-center text-sm text-muted-foreground">
            {imageStatus === "error" ? errorMessage : loadingMessage}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
