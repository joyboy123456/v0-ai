"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, Pencil, Trash2, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, readJsonResponse } from "@/lib/utils";
import type { UploadedImage } from "@/lib/types";
import { ImageEditorDialog } from "./image-editor-dialog";

interface UploadBoxProps {
  label: string;
  helper: string;
  image: UploadedImage | null;
  onUploaded: (image: UploadedImage) => void;
  onRemove: () => void;
  required?: boolean;
  className?: string;
  variant?: "standard" | "compact";
  optimizeForGeneration?: boolean;
}

interface PreparedGenerationUpload {
  file: File;
  width: number;
  height: number;
  optimized: false;
}

interface LoadedImage {
  image: HTMLImageElement;
  width: number;
  height: number;
  release: () => void;
}

export async function prepareImageForGenerationUpload(
  file: File,
  optimizeForGeneration = false,
): Promise<PreparedGenerationUpload> {
  void optimizeForGeneration;
  // 只读取尺寸，不压缩、不缩放、不转码，保证模型看到用户上传的原始纹理。
  const loaded = await loadImageFromFile(file).catch(() => null);
  if (!loaded) {
    return {
      file,
      width: 0,
      height: 0,
      optimized: false,
    };
  }

  const { image, width, height, release } = loaded;

  try {
    return {
      file,
      width,
      height,
      optimized: false,
    };
  } finally {
    release();
  }
}

function loadImageFromFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof Image === "undefined") {
      reject(new Error("当前环境不支持读取图片尺寸"));
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    const release = () => URL.revokeObjectURL(url);

    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        release();
        reject(new Error("无法读取图片尺寸"));
        return;
      }

      resolve({ image, width, height, release });
    };

    image.onerror = () => {
      release();
      reject(new Error("无法读取图片尺寸"));
    };

    image.src = url;
  });
}

export function UploadBox({
  label,
  helper,
  image,
  onUploaded,
  onRemove,
  required = true,
  className,
  variant = "standard",
  optimizeForGeneration = false,
}: UploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // 兜底复位：拖拽以任何方式结束（放置/取消/拖出窗口）都关闭拖拽高亮，
  // 避免 dragenter/dragleave 计数失配导致「松开以上传」遮罩卡死
  useEffect(() => {
    const resetDragState = () => {
      dragDepthRef.current = 0;
      setIsDragOver(false);
    };
    const handleDocumentDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) resetDragState();
    };
    window.addEventListener("dragend", resetDragState);
    window.addEventListener("drop", resetDragState);
    document.documentElement.addEventListener("dragleave", handleDocumentDragLeave);
    return () => {
      window.removeEventListener("dragend", resetDragState);
      window.removeEventListener("drop", resetDragState);
      document.documentElement.removeEventListener("dragleave", handleDocumentDragLeave);
    };
  }, []);

  const releaseCurrentPreview = () => {
    if (image?.preview.startsWith("blob:")) {
      URL.revokeObjectURL(image.preview);
    }
  };

  const handleRemoveImage = () => {
    setIsPreviewOpen(false);
    setIsEditorOpen(false);
    setError("");
    releaseCurrentPreview();
    onRemove();
  };

  const uploadFile = async (file: File) => {
    setError("");
    setIsUploading(true);

    try {
      const prepared = await prepareImageForGenerationUpload(
        file,
        optimizeForGeneration,
      );

      const formData = new FormData();
      formData.append("file", prepared.file);
      if (prepared.width > 0 && prepared.height > 0) {
        formData.append("width", String(prepared.width));
        formData.append("height", String(prepared.height));
      }

      // 后端不响应时避免永久转圈：60s 超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);

      let response: Response;
      try {
        response = await fetch("/api/assets/upload", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await readJsonResponse<{
        assetId: string;
        fileName: string;
        width: number;
        height: number;
      }>(response, "上传失败");

      const preview = URL.createObjectURL(prepared.file);
      releaseCurrentPreview();
      onUploaded({
        assetId: data.assetId,
        preview,
        name: data.fileName,
        width: data.width,
        height: data.height,
      });
    } catch (uploadError) {
      const message =
        uploadError instanceof DOMException && uploadError.name === "AbortError"
          ? "上传超时，请检查网络后重试"
          : uploadError instanceof Error
            ? uploadError.message
            : "上传失败";
      setError(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;
    void uploadFile(file);
  };

  const hasDraggedFiles = (dataTransfer: DataTransfer) =>
    Array.from(dataTransfer.types).includes("Files");

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    // 始终接受放置，拒绝放置（dropEffect="none"）会导致 drop 事件不触发、
    // 拖拽高亮状态无法复位而卡死
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);

    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("只能上传图片文件");
      return;
    }
    if (isUploading) {
      setError("图片正在上传，请稍候再添加");
      return;
    }
    void uploadFile(file);
  };

  return (
    <div
      className={cn("space-y-2.5", className)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-1.5">
        {required && <span className="text-primary text-xs mt-0.5">*</span>}
        <span className="text-[14px] font-medium text-foreground tracking-wide">
          {label}
        </span>
      </div>

      {variant === "compact" ? (
        <div className="group relative">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              "relative min-h-[120px] w-full rounded-xl border border-dashed border-border-blue bg-card/60",
              "flex cursor-pointer items-center gap-3 overflow-hidden p-3 text-left transition-all duration-300",
              "hover:border-primary/60 hover:bg-accent/40 hover:shadow-soft",
              image && "border-solid border-primary/30 bg-accent/20 shadow-card",
              isDragOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
            )}
            aria-label={image ? "更换图片" : `上传${label}`}
          >
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2">
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-soft text-muted-foreground transition-all group-hover:bg-primary/10 group-hover:text-primary">
                  <Upload className="h-4 w-4" />
                </div>
              )}
              <span className="max-w-[138px] text-center text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
                {isUploading ? "上传中..." : helper}
              </span>
            </div>

            <div className="relative h-[96px] w-[72px] shrink-0 overflow-hidden rounded-sm border border-border bg-background transition-colors group-hover:border-muted-foreground">
              {image ? (
                <img
                  src={image.preview}
                  alt={image.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-end justify-center bg-secondary p-1">
                  <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    示例
                  </span>
                </div>
              )}
            </div>

            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/90 text-[12px] font-medium text-primary backdrop-blur-sm">
                松开以上传图片
              </div>
            )}
          </button>
          {image && !isUploading && (
            <UploadedImageActions
              compact
              onEdit={() => setIsEditorOpen(true)}
              onPreview={() => setIsPreviewOpen(true)}
              onRemove={handleRemoveImage}
            />
          )}
        </div>
      ) : (
        <div className="group relative">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              "relative min-h-[140px] w-full rounded-xl border border-dashed border-border-blue bg-card/60",
              "flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden transition-all duration-300",
              "hover:border-primary/60 hover:bg-accent/40 hover:shadow-soft",
              image && "border-solid border-primary/30 bg-accent/20 shadow-card",
              isDragOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
            )}
            aria-label={image ? "更换图片" : `上传${label}`}
          >
            {image ? (
              <>
                <img
                  src={image.preview}
                  alt={image.name}
                  className="absolute inset-0 h-full w-full object-contain p-2"
                />
                <span className="absolute left-2 top-2 max-w-[70%] truncate rounded border border-border bg-background/90 px-2 py-1 text-[11px] text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 max-md:opacity-100">
                  {image.name}
                </span>
              </>
            ) : (
              <>
                {isUploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-soft text-muted-foreground transition-all group-hover:bg-primary/10 group-hover:text-primary">
                    <Upload className="h-5 w-5" />
                  </div>
                )}
                <div className="flex flex-col items-center gap-1 px-4">
                  <span className="text-[13px] font-medium text-foreground">
                    {isUploading ? "上传中..." : "点击或拖拽上传"}
                  </span>
                  <span className="max-w-[220px] text-center text-[11px] leading-relaxed text-muted-foreground">
                    {helper}
                  </span>
                </div>
              </>
            )}

            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/90 text-[13px] font-medium text-primary backdrop-blur-sm">
                松开以上传图片
              </div>
            )}
          </button>
          {image && !isUploading && (
            <UploadedImageActions
              onEdit={() => setIsEditorOpen(true)}
              onPreview={() => setIsPreviewOpen(true)}
              onRemove={handleRemoveImage}
            />
          )}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-destructive flex items-center gap-1.5">
          <X className="w-3 h-3" /> {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
      <Dialog open={isPreviewOpen && image !== null} onOpenChange={setIsPreviewOpen}>
        <DialogContent
          className="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center overflow-hidden border-0 bg-transparent p-0 shadow-none sm:max-w-none"
          aria-describedby={undefined}
          onClick={() => setIsPreviewOpen(false)}
        >
          <DialogTitle className="sr-only">
            {image ? `预览${image.name}` : "图片预览"}
          </DialogTitle>
          {image && (
            <img
              src={image.preview}
              alt={image.name}
              className="max-h-[88dvh] w-auto max-w-[calc(100vw-2rem)] rounded-lg object-contain sm:max-w-[88vw]"
              onClick={(event) => event.stopPropagation()}
            />
          )}
        </DialogContent>
      </Dialog>
      <ImageEditorDialog
        open={isEditorOpen && image !== null}
        image={image}
        onOpenChange={setIsEditorOpen}
        onApply={(asset) => {
          setError("");
          releaseCurrentPreview();
          onUploaded({
            assetId: asset.assetId,
            preview: asset.url,
            name: asset.fileName,
            width: asset.width,
            height: asset.height,
          });
        }}
      />
    </div>
  );
}

function UploadedImageActions({
  compact = false,
  onEdit,
  onPreview,
  onRemove,
}: {
  compact?: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const actionClass = cn(
    "pointer-events-auto absolute z-30 flex items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm transition-all",
    "opacity-0 hover:border-primary/60 hover:bg-secondary group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:opacity-100",
    compact ? "h-6 w-6" : "h-7 w-7",
  );
  const iconClass = "h-3.5 w-3.5";

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-30",
        compact ? "right-3 top-3 h-[96px] w-[72px]" : "inset-0",
      )}
    >
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          actionClass,
          compact ? "right-1 top-1" : "right-2 top-2",
          "hover:border-destructive hover:bg-destructive hover:text-destructive-foreground",
        )}
        aria-label="删除图片"
      >
        <Trash2 className={iconClass} />
      </button>
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          actionClass,
          compact ? "bottom-1 left-1" : "bottom-2 left-2",
        )}
        aria-label="编辑图片"
      >
        <Pencil className={iconClass} />
      </button>
      <button
        type="button"
        onClick={onPreview}
        className={cn(
          actionClass,
          compact ? "bottom-1 right-1" : "bottom-2 right-2",
        )}
        aria-label="查看图片"
      >
        <Eye className={iconClass} />
      </button>
    </div>
  );
}
