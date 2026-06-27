"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { cn, readJsonResponse } from "@/lib/utils";
import type { UploadedImage } from "@/lib/types";

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
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setError("");
    setIsUploading(true);

    try {
      const prepared = await prepareImageForGenerationUpload(
        file,
        optimizeForGeneration,
      );

      const preview = URL.createObjectURL(prepared.file);
      const formData = new FormData();
      formData.append("file", prepared.file);
      if (prepared.width > 0 && prepared.height > 0) {
        formData.append("width", String(prepared.width));
        formData.append("height", String(prepared.height));
      }

      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: formData,
      });

      const data = await readJsonResponse<{
        assetId: string;
        fileName: string;
        width: number;
        height: number;
      }>(response, "上传失败");

      onUploaded({
        assetId: data.assetId,
        preview,
        name: data.fileName,
        width: data.width,
        height: data.height,
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex items-center gap-1.5">
        <span className="text-[14px] font-medium text-foreground tracking-wide">
          {label}
        </span>
        {required && <span className="text-primary/70 text-xs mt-0.5">*</span>}
      </div>

      {variant === "compact" ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            "group relative w-full min-h-[120px] rounded-xl border border-dashed border-sky-200 bg-white/60",
            "flex items-center gap-3 overflow-hidden p-3 text-left transition-all duration-300 cursor-pointer",
            "hover:bg-[#EAF8FF]/40 hover:border-sky-400 hover:shadow-soft",
            image && "border-solid border-sky-300 bg-[#EAF8FF]/20 shadow-card",
          )}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2">
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            ) : (
              <div className="w-8 h-8 rounded-md bg-surface-soft border border-border flex items-center justify-center text-muted-foreground transition-all group-hover:text-primary group-hover:bg-primary/10">
                <Upload className="w-4 h-4" />
              </div>
            )}
            <span className="max-w-[138px] text-center text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
              {isUploading ? "上传中..." : helper}
            </span>
          </div>

          <div className="relative h-[96px] w-[72px] shrink-0 overflow-hidden rounded-sm border border-border bg-background transition-colors group-hover:border-muted-foreground">
            {image ? (
              <>
                <img
                  src={image.preview}
                  alt={image.name}
                  className="h-full w-full object-cover"
                />
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemove();
                    }
                  }}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive"
                >
                  <X className="h-3 w-3" />
                </span>
              </>
            ) : (
              <div className="flex h-full w-full items-end justify-center bg-secondary p-1">
                <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border">
                  示例
                </span>
              </div>
            )}
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            "group relative w-full min-h-[140px] rounded-xl border border-dashed border-sky-200 bg-white/60",
            "flex flex-col items-center justify-center gap-3 overflow-hidden transition-all duration-300 cursor-pointer",
            "hover:border-sky-400 hover:bg-[#EAF8FF]/40 hover:shadow-soft",
            image && "border-solid border-sky-300 bg-[#EAF8FF]/20 shadow-card",
          )}
        >
          {image ? (
            <>
              <img
                src={image.preview}
                alt={image.name}
                className="absolute inset-0 w-full h-full object-contain p-2"
              />
              <span className="absolute bottom-2 left-2 max-w-[80%] truncate rounded bg-black/60 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {image.name}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemove();
                  }
                }}
                className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </>
          ) : (
            <>
              {isUploading ? (
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-soft text-muted-foreground transition-all group-hover:bg-primary/10 group-hover:text-primary">
                  <Upload className="h-5 w-5" />
                </div>
              )}
              <div className="flex flex-col items-center gap-1 px-4">
                <span className="text-[13px] font-medium text-foreground">
                  {isUploading ? "上传中..." : "点击或拖拽上传"}
                </span>
                <span className="max-w-[220px] text-center text-[11px] text-muted-foreground leading-relaxed">
                  {helper}
                </span>
              </div>
            </>
          )}
        </button>
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
    </div>
  );
}
