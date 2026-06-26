import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, Download } from "lucide-react";
import type { GenerationTask, ResultAsset } from "@/lib/types";
import { getOssThumbnailUrl } from "@/lib/utils";

// 扩展的内部状态，用于动画控制
type InternalImageStatus = "loading" | "loaded";

interface ImageSlot {
  id: string;
  index: number;
  image: ResultAsset;
}

function getLatestTaskResults(task: GenerationTask): ResultAsset[] {
  const params = task.params as {
    shotPlan?: { shotId?: string }[];
    poseTemplateIds?: string[];
  };
  const latestByShotId = new Map<string, ResultAsset>();
  const unplanned: ResultAsset[] = [];
  for (const result of task.results) {
    if (result.shotId) {
      latestByShotId.set(result.shotId, result);
    } else {
      unplanned.push(result);
    }
  }
  if (task.featureType === "photo-fission" && Array.isArray(params.shotPlan)) {
    const planned = params.shotPlan
      .map((shot, index) => latestByShotId.get(shot.shotId ?? `shot_${index + 1}`))
      .filter((item): item is ResultAsset => Boolean(item));
    return [...planned, ...unplanned];
  }
  if (task.featureType === "pose-fission" && Array.isArray(params.poseTemplateIds)) {
    const planned = params.poseTemplateIds
      .map((templateId) => latestByShotId.get(templateId))
      .filter((item): item is ResultAsset => Boolean(item));
    return [...planned, ...unplanned];
  }
  return task.results;
}

// ==========================================
// 单个图片 Slot 卡片组件
// ==========================================
function ImageSlotCard({
  slot,
  task,
  imageState,
  isFavorite,
  onImageLoad,
  onPreviewImage,
  onToggleFavorite,
}: {
  slot: ImageSlot;
  task: GenerationTask;
  imageState?: InternalImageStatus;
  isFavorite: boolean;
  onImageLoad: (assetId: string, index: number) => void;
  onPreviewImage: (image: ResultAsset, task: GenerationTask) => void;
  onToggleFavorite: (assetId: string) => void;
}) {
  const image = slot.image;
  const isLoaded = imageState === "loaded";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.28,
        delay: slot.index * 0.06,
      }}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onPreviewImage(image, task);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onPreviewImage(image, task);
        }
      }}
      className="group relative aspect-[3/4] cursor-pointer overflow-hidden rounded border border-border bg-card transition-colors hover:border-primary/60"
    >
      {!isLoaded && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-secondary/60"
        />
      )}

      <motion.img
        src={getOssThumbnailUrl(image.url)}
        alt={image.finalPrompt ?? ""}
        draggable={false}
        onLoad={() => onImageLoad(image.assetId, slot.index)}
        initial={{
          opacity: 0,
          scale: 1.03,
          filter: "blur(10px)",
        }}
        animate={
          isLoaded
            ? {
                opacity: 1,
                scale: 1,
                filter: "blur(0px)",
              }
            : {
                opacity: 0,
                scale: 1.03,
                filter: "blur(10px)",
              }
        }
        transition={{
          duration: 0.55,
          ease: [0.22, 1, 0.36, 1],
          delay: slot.index * 0.06,
        }}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* 操作按钮 - 必须等图片 loaded 后再出现 */}
      <AnimatePresence>
        {image && isLoaded && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.22,
              delay: 0.12,
            }}
            className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleFavorite(image.assetId);
              }}
              aria-label={isFavorite ? "取消收藏" : "收藏"}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-background/85"
            >
              <Star
                className={`h-3.5 w-3.5 ${
                  isFavorite
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground"
                }`}
              />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                window.open(image.downloadUrl, "_blank");
              }}
              aria-label="下载"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-background/85"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ==========================================
// 增强版任务卡片组件 - 带丝滑动画
// ==========================================
export function EnhancedImageTaskCard({
  task,
  isActive,
  onSelectTask,
  onPreviewImage,
  onToggleFavorite,
  favorites = new Set(),
}: {
  task: GenerationTask;
  isActive: boolean;
  onSelectTask: (taskId: string) => void;
  onPreviewImage: (image: ResultAsset, task: GenerationTask) => void;
  onToggleFavorite: (assetId: string) => void;
  favorites?: Set<string>;
}) {
  // 每张图片的加载状态
  const [imageStates, setImageStates] = useState<Map<string, InternalImageStatus>>(new Map());

  const latestResults = useMemo(() => getLatestTaskResults(task), [task]);

  const renderSlots: ImageSlot[] = latestResults.map((image, index) => ({
    id: image.assetId,
    index,
    image,
  }));

  // 当 task.results 变化时，为新图片初始化 loading 状态
  useEffect(() => {
    setImageStates((prev) => {
      const next = new Map(prev);

      latestResults.forEach((image) => {
        if (!next.has(image.assetId)) {
          next.set(image.assetId, "loading");
        }
      });

      return next;
    });
  }, [latestResults]);

  // 重新生成时重置状态（根据 taskId 变化）
  useEffect(() => {
    setImageStates(new Map());
  }, [task.taskId]);

  // 图片加载完成处理 - 给动画一个最小展示时间
  const handleImageLoad = (assetId: string, index: number) => {
    window.setTimeout(() => {
      setImageStates((prev) => {
        const next = new Map(prev);
        next.set(assetId, "loaded");
        return next;
      });
    }, 120 + index * 80);
  };

  return (
    <motion.div
      // 卡片出现动画：轻量级的上浮和放大
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      role="button"
      tabIndex={0}
      onClick={() => onSelectTask(task.taskId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTask(task.taskId);
        }
      }}
      className={`w-full rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/60 cursor-pointer ${
        isActive ? "border-primary" : "border-border"
      }`}
    >
      {/* 顶部任务信息 */}
      <div className="flex items-center justify-between gap-3">
        <StatusBadge status={task.status} />
        <span className="text-xs text-muted-foreground">
          {new Date(task.createdAt).toLocaleString("zh-CN")}
        </span>
      </div>

      {/* Prompt 显示 */}
      {task.params && typeof task.params === "object" && "prompt" in task.params && (
        <p className="mt-2 text-sm text-foreground line-clamp-2">
          {String(task.params.prompt)}
        </p>
      )}

      {/* 错误信息 */}
      {task.errorMessage && (
        <p className="mt-2 text-xs text-destructive line-clamp-2">
          {task.errorMessage}
        </p>
      )}

      {renderSlots.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {renderSlots.map((slot) => {
            const isFavorite = slot.image ? favorites.has(slot.image.assetId) : false;
            const imageState = slot.image ? imageStates.get(slot.image.assetId) : undefined;

            return (
              <ImageSlotCard
                key={slot.id}
                slot={slot}
                task={task}
                imageState={imageState}
                isFavorite={isFavorite}
                onImageLoad={handleImageLoad}
                onPreviewImage={onPreviewImage}
                onToggleFavorite={onToggleFavorite}
              />
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// 状态徽章组件
function StatusBadge({ status }: { status: GenerationTask["status"] }) {
  const statusConfig = {
    pending: { label: "排队中", className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" },
    running: { label: "生成中", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
    success: { label: "已完成", className: "bg-green-500/10 text-green-600 border-green-500/20" },
    failed: { label: "失败", className: "bg-red-500/10 text-red-600 border-red-500/20" },
    partial: { label: "部分成功", className: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
    cancelled: { label: "已取消", className: "bg-muted text-muted-foreground border-border" },
  };

  const config = statusConfig[status];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
