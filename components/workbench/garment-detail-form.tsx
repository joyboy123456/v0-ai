"use client";

/**
 * 高清放大细节图（garment-detail）创作表单 —— 前端界面先行。
 *
 * 对应《服装细节图生成功能 PRD v1.0》§3/§4：
 * 上传服装原图 → mock 抠图分类（可手动修正）→ 模型双档（动态下发 mock）
 * → 参考图 ≤3 张 → 自定义提示词 ≤103 字 + AI 追加描述 → 分辨率/比例。
 *
 * 本组件为纯受控组件，状态与提交都由 LeftPanel 持有（与 PoseFissionForm 同模式）。
 */
import { Loader2, ScanSearch, Sparkles, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  GARMENT_DETAIL_CATEGORIES,
  GARMENT_DETAIL_MAX_REFERENCES,
  GARMENT_DETAIL_PROMPT_MAX,
  GARMENT_DETAIL_RATIOS,
  type GarmentDetailCategory,
  type GarmentDetailRatio,
  type GarmentDetailResolution,
  type UploadedImage,
} from "@/lib/types";
import type { GarmentDetailModelOption } from "@/lib/garment-detail-mock";
import { UploadBox } from "./upload-components";

/** mock 识别阶段：idle（未上传）→ processing（识别中）→ done（可确认/修正） */
export type GarmentDetailRecognizePhase = "idle" | "processing" | "done";

const RESOLUTION_LABELS: Record<GarmentDetailResolution, string> = {
  "1k": "1K",
  "2k": "2K",
  "4k": "4K",
};

function SectionLabel({
  label,
  required = false,
  hint,
}: {
  label: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <div className="flex items-center gap-1">
        {required && <span className="text-primary">*</span>}
        <span className="text-sm text-foreground">{label}</span>
      </div>
      {hint && (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

function getGarmentDetailRatioStyle(id: GarmentDetailRatio) {
  if (id === "3:4") return { width: 15, height: 22 };
  if (id === "4:3") return { width: 22, height: 15 };
  return { width: 18, height: 18 };
}

export function GarmentDetailForm({
  mainImage,
  recognizePhase,
  category,
  models,
  selectedModelId,
  references,
  prompt,
  aiAppendDescription,
  imageRatio,
  resolution,
  onMainUploaded,
  onMainRemove,
  onCategoryChange,
  onModelChange,
  onReferenceUploaded,
  onReferenceRemove,
  onPromptChange,
  onAiAppendDescriptionChange,
  onImageRatioChange,
  onResolutionChange,
}: {
  mainImage: UploadedImage | null;
  recognizePhase: GarmentDetailRecognizePhase;
  category: GarmentDetailCategory;
  /** null 表示模型版本列表仍在加载（mock 动态下发） */
  models: GarmentDetailModelOption[] | null;
  selectedModelId: string | null;
  /** 固定 3 个槽位，空槽为 null（FR-7：最多 3 张参考图） */
  references: (UploadedImage | null)[];
  prompt: string;
  aiAppendDescription: boolean;
  imageRatio: GarmentDetailRatio;
  resolution: GarmentDetailResolution;
  onMainUploaded: (image: UploadedImage) => void;
  onMainRemove: () => void;
  onCategoryChange: (category: GarmentDetailCategory) => void;
  onModelChange: (model: GarmentDetailModelOption) => void;
  onReferenceUploaded: (index: number, image: UploadedImage) => void;
  onReferenceRemove: (index: number) => void;
  onPromptChange: (value: string) => void;
  onAiAppendDescriptionChange: (value: boolean) => void;
  onImageRatioChange: (value: GarmentDetailRatio) => void;
  onResolutionChange: (value: GarmentDetailResolution) => void;
}) {
  const selectedModel =
    models?.find((model) => model.algorithmModelId === selectedModelId) ?? null;
  const referenceCount = references.filter(Boolean).length;
  const outputCount = Math.max(1, referenceCount);

  return (
    <div className="space-y-5">
      {/* 1. 上传服装原图（FR-1） */}
      <div className="space-y-2">
        <SectionLabel label="服装原图" required />
        <UploadBox
          label="服装原图"
          helper="支持 JPG/PNG/WebP，单张 ≤20MB，建议边长 ≥1024px"
          image={mainImage}
          onUploaded={onMainUploaded}
          onRemove={onMainRemove}
          variant="compact"
        />
      </div>

      {/* 2. 抠图分类结果确认（FR-3 / FR-4，当前为 mock 识别） */}
      {recognizePhase !== "idle" && (
        <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <ScanSearch className="h-4 w-4 text-primary" />
            <span>智能识别</span>
          </div>
          {recognizePhase === "processing" ? (
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在自动抠图并识别服装类型…
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[12px] text-muted-foreground">
                识别结果：
                <span className="font-medium text-foreground">
                  {GARMENT_DETAIL_CATEGORIES.find((item) => item.id === category)
                    ?.label ?? category}
                </span>
                ，识别有误可手动修正
              </p>
              <div className="flex flex-wrap gap-1.5">
                {GARMENT_DETAIL_CATEGORIES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onCategoryChange(option.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      category === option.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. 模型档位（FR-5 / FR-6：列表动态下发，前端不硬编码） */}
      <div className="space-y-2">
        <SectionLabel label="模型版本" required />
        {models === null ? (
          <div className="space-y-2">
            {[0, 1].map((index) => (
              <div
                key={index}
                className="h-[76px] animate-pulse rounded-md border border-border bg-secondary/60"
              />
            ))}
            <p className="text-[11px] text-muted-foreground">
              正在拉取模型版本列表…
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {models.map((model) => {
              const isActive = model.algorithmModelId === selectedModelId;
              return (
                <button
                  key={model.algorithmModelId}
                  type="button"
                  onClick={() => onModelChange(model)}
                  className={cn(
                    "w-full rounded-md border p-3 text-left transition-colors",
                    isActive
                      ? "border-primary bg-primary/10"
                      : "border-border bg-secondary hover:border-primary/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        isActive ? "text-primary" : "text-foreground",
                      )}
                    >
                      {model.algorithmModelName}
                    </span>
                    {model.recommended && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        推荐
                      </span>
                    )}
                    {model.defaultSelected && (
                      <span className="rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        默认
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {model.costLabel} · 约 {model.estimatedSeconds}s
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {model.description}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    支持分辨率：
                    {model.resolutions
                      .map((item) => RESOLUTION_LABELS[item])
                      .join(" / ")}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. 参考图（FR-7 / FR-8 / FR-14） */}
      <div className="space-y-2">
        <SectionLabel
          label="参考图（可选）"
          hint={`最多 ${GARMENT_DETAIL_MAX_REFERENCES} 张，每张生成 1 张结果`}
        />
        <div className="grid grid-cols-3 gap-2">
          {references.map((reference, index) => (
            <UploadBox
              key={index}
              label={`参考图 ${index + 1}`}
              helper="风格/构图参考"
              image={reference}
              onUploaded={(image) => onReferenceUploaded(index, image)}
              onRemove={() => onReferenceRemove(index)}
              required={false}
              variant="compact"
            />
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          参考图用于控制细节表现风格/构图，不会替换服装主体；当前将输出{" "}
          <span className="font-medium text-foreground">{outputCount}</span> 张细节图
        </p>
      </div>

      {/* 5. 自定义提示词 + AI 追加描述（FR-9 ~ FR-11） */}
      <div className="space-y-2">
        <SectionLabel
          label="自定义提示词（可选）"
          hint={`${prompt.length}/${GARMENT_DETAIL_PROMPT_MAX}`}
        />
        <Textarea
          value={prompt}
          onChange={(event) =>
            onPromptChange(event.target.value.slice(0, GARMENT_DETAIL_PROMPT_MAX))
          }
          maxLength={GARMENT_DETAIL_PROMPT_MAX}
          rows={3}
          placeholder="指定细节部位与风格，如：丝绸质感，高级感，微距纹理"
          className="resize-none bg-secondary text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          留空走系统默认模板；填写后将合并进服务端提示词模板（演示：输入「失败」可预览失败与重试流程）
        </p>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              AI 追加描述
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              由服务端对原图自动生成描述并合并进提示词
            </p>
          </div>
          <Switch
            checked={aiAppendDescription}
            onCheckedChange={onAiAppendDescriptionChange}
          />
        </div>
      </div>

      {/* 6. 输出设置：比例 + 分辨率（FR-12 / FR-13，分辨率随模型档位联动） */}
      <div className="space-y-2">
        <SectionLabel label="输出比例" required />
        <div className="grid grid-cols-3 gap-2">
          {GARMENT_DETAIL_RATIOS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onImageRatioChange(option.id)}
              className={cn(
                "flex h-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors",
                imageRatio === option.id
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50",
              )}
            >
              <span
                className={cn(
                  "rounded-sm border",
                  imageRatio === option.id
                    ? "border-primary"
                    : "border-muted-foreground",
                )}
                style={getGarmentDetailRatioStyle(option.id)}
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel
          label="分辨率"
          required
          hint={
            selectedModel
              ? `${selectedModel.algorithmModelName}支持 ${selectedModel.resolutions
                  .map((item) => RESOLUTION_LABELS[item])
                  .join(" / ")}`
              : undefined
          }
        />
        <div className="grid grid-cols-3 gap-2">
          {(selectedModel?.resolutions ?? []).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onResolutionChange(option)}
              className={cn(
                "flex h-10 items-center justify-center rounded-md border text-xs font-medium transition-colors",
                resolution === option
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground hover:border-primary/50",
              )}
            >
              {option === "4k" && (
                <Zap className="mr-1.5 h-3.5 w-3.5 fill-current" />
              )}
              {RESOLUTION_LABELS[option]}
            </button>
          ))}
          {selectedModel === null && (
            <p className="col-span-3 text-[11px] text-muted-foreground">
              请先选择模型版本
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
