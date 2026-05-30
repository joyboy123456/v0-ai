import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Download, Sparkles } from "lucide-react";
import type { GenerationTask, ResultAsset } from "@/lib/types";

// 扩展的内部状态，用于动画控制
type InternalImageStatus = "loading" | "loaded";

interface ImageSlot {
  id: string;
  index: number;
  image?: ResultAsset;
  isPlaceholder: boolean;
}

// ==========================================
// AI 图像显影中占位动画组件
// ==========================================
function ImageSlotPlaceholder({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-br from-[#EEF3FF] via-[#F4F0FF] to-[#EAFBFF]"
    >
      {/* 柔和光斑 1 */}
      <motion.div
        className="absolute -left-8 top-1/4 h-32 w-32 rounded-full bg-blue-300/30 blur-3xl"
        animate={{
          x: ["-20%", "30%", "-10%"],
          y: ["-10%", "20%", "0%"],
          scale: [1, 1.15, 1],
        }}
        transition={{
          duration: 3.2,
          repeat: Infinity,
          ease: "easeInOut",
          delay: index * 0.12,
        }}
      />

      {/* 柔和光斑 2 */}
      <motion.div
        className="absolute -right-8 bottom-1/4 h-32 w-32 rounded-full bg-purple-300/25 blur-3xl"
        animate={{
          x: ["10%", "-25%", "15%"],
          y: ["5%", "-15%", "10%"],
          scale: [1, 1.12, 1],
        }}
        transition={{
          duration: 3.6,
          repeat: Infinity,
          ease: "easeInOut",
          delay: index * 0.15,
        }}
      />

      {/* 斜向 shimmer 扫描线 */}
      <motion.div
        className="absolute inset-y-0 -left-1/2 w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/70 to-transparent"
        animate={{ x: ["-80%", "260%"] }}
        transition={{
          duration: 1.8,
          repeat: Infinity,
          ease: "easeInOut",
          delay: index * 0.18,
        }}
      />

      {/* 中心图标和文案 */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center gap-2"
        animate={{
          opacity: [0.55, 1, 0.55],
          scale: [1, 1.06, 1],
        }}
        transition={{
          duration: 1.6,
          repeat: Infinity,
          ease: "easeInOut",
          delay: index * 0.1,
        }}
      >
        <Sparkles className="h-5 w-5 text-blue-400/60" />
        <span className="text-xs font-medium text-blue-500/70">生成中</span>
      </motion.div>

      {/* 底部细进度光条 */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-blue-200/30">
        <motion.div
          className="h-full w-1/3 bg-gradient-to-r from-transparent via-blue-400/80 to-transparent"
          animate={{ x: ["-100%", "300%"] }}
          transition={{
            duration: 2.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: index * 0.14,
          }}
        />
      </div>
    </motion.div>
  );
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
  const isLoaded = image && imageState === "loaded";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.28,
        delay: slot.index * 0.06,
      }}
      role={image ? "button" : undefined}
      tabIndex={image ? 0 : -1}
      onClick={
        image
          ? (event) => {
              event.stopPropagation();
              onPreviewImage(image, task);
            }
          : undefined
      }
      onKeyDown={
        image
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onPreviewImage(image, task);
              }
            }
          : undefined
      }
      className={`group relative aspect-[3/4] overflow-hidden rounded border ${
        image ? "cursor-pointer border-border hover:border-primary/60" : "border-border"
      } bg-card transition-colors`}
    >
      {/* 占位动画 - 当没有图片或图片未加载完成时显示 */}
      <AnimatePresence mode="wait">
        {(!image || !isLoaded) && (
          <ImageSlotPlaceholder key={`placeholder-${slot.id}`} index={slot.index} />
        )}
      </AnimatePresence>

      {/* 真实图片 - 有 imageUrl 后挂载，但加载完成前保持不可见 */}
      {image && (
        <motion.img
          src={image.url}
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
      )}

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
              <Heart
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
  plannedResultCount,
  isActive,
  onSelectTask,
  onPreviewImage,
  onToggleFavorite,
  favorites = new Set(),
}: {
  task: GenerationTask;
  plannedResultCount?: number;
  isActive: boolean;
  onSelectTask: (taskId: string) => void;
  onPreviewImage: (image: ResultAsset, task: GenerationTask) => void;
  onToggleFavorite: (assetId: string) => void;
  favorites?: Set<string>;
}) {
  // 每张图片的加载状态
  const [imageStates, setImageStates] = useState<Map<string, InternalImageStatus>>(new Map());

  // 判断任务是否正在生成中
  const isGenerating = task.status === "pending" || task.status === "running";

  // 计算需要渲染的 slot 数量
  const slotCount = Math.max(
    plannedResultCount ?? 0,
    task.results.length,
    isGenerating ? 1 : 0
  );

  // 创建 renderSlots
  const renderSlots: ImageSlot[] = Array.from({ length: slotCount }).map((_, index) => {
    const image = task.results[index];

    return {
      id: image?.assetId ?? `${task.taskId}-placeholder-${index}`,
      index,
      image,
      isPlaceholder: !image,
    };
  });

  // 当 task.results 变化时，为新图片初始化 loading 状态
  useEffect(() => {
    setImageStates((prev) => {
      const next = new Map(prev);

      task.results.forEach((image) => {
        if (!next.has(image.assetId)) {
          next.set(image.assetId, "loading");
        }
      });

      return next;
    });
  }, [task.results]);

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

      {/* 图片网格 - 关键修改：不再判断 task.results.length > 0 */}
      {slotCount > 0 && (
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
  };

  const config = statusConfig[status];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
