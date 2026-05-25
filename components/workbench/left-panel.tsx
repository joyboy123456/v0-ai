"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Coins,
  Loader2,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { OptionSelector, RatioSelector } from "./option-selectors";
import {
  prepareImageForGenerationUpload,
  UploadBox,
} from "./upload-components";
import { cn, validateUploadSize } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_FASHION_MODEL,
  DEFAULT_VIDEO_MODEL,
  ELEMENT_REPLACE_TYPES,
  FEATURE_LABELS,
  FASHION_IMAGE_RATIOS,
  FASHION_PROMPT_MODES,
  FASHION_RESOLUTIONS,
  GENERATE_COUNTS,
  IMAGE_RATIOS,
  PHOTO_FISSION_CHILDRENS_CATEGORIES,
  PHOTO_FISSION_CATEGORIES,
  PHOTO_FISSION_RATIOS_EXTRA,
  PHOTO_FISSION_RATIOS_MAIN,
  PHOTO_FISSION_RESOLUTIONS,
  PHOTO_FISSION_RESULT_COUNTS,
  POSE_TEMPLATES,
  POSE_IMAGE_RATIOS,
  POSE_RESOLUTIONS,
  SELECTABLE_FASHION_MODELS,
  SELECTABLE_VIDEO_MODELS,
  VIDEO_DURATIONS,
  VIDEO_RESOLUTIONS,
  resolveVideoSize,
  type BackgroundReplaceParams,
  type CompanyModel,
  type ElementReplaceType,
  type FashionImageRatio,
  type FashionModelId,
  type FashionPromptMode,
  type FashionReferenceImage,
  type FashionRemixRequest,
  type FashionResolution,
  type FeatureType,
  type GenerateCount,
  type ImageRatio,
  type PhotoFissionChildrensCategory,
  type PhotoFissionCategory,
  type PhotoFissionCase,
  type PhotoFissionImageRatio,
  type PhotoFissionParams,
  type PhotoFissionResolution,
  type PhotoFissionResultCount,
  type PoseFissionCase,
  type PoseFissionParams,
  type PoseImageRatio,
  type PoseResolution,
  type AiFashionPhotoParams,
  type PoseTemplate,
  type UploadedImage,
  type VideoDuration,
  type VideoGenerationParams,
  type VideoResolution,
} from "@/lib/types";

interface LeftPanelProps {
  feature: FeatureType;
  selectedPoseTemplates: PoseTemplate[];
  companyModels: CompanyModel[];
  fashionReferences: FashionReferenceImage[];
  fashionRemixRequest: FashionRemixRequest | null;
  photoFissionCaseRequest: PhotoFissionCaseRequest | null;
  poseFissionCaseRequest: PoseFissionCaseRequest | null;
  onChangeSelectedPoseTemplates: (templates: PoseTemplate[]) => void;
  onAddFashionReference: (reference: FashionReferenceImage) => void;
  onRemoveFashionReference: (assetId: string) => void;
  onOpenCompanyModelLibrary: () => void;
  onOpenPoseLibrary: () => void;
  onTaskCreated: (taskId: string) => void;
}

interface PhotoFissionCaseRequest {
  requestId: number;
  case: PhotoFissionCase;
}

interface PoseFissionCaseRequest {
  requestId: number;
  case: PoseFissionCase;
}

export function LeftPanel({
  feature,
  selectedPoseTemplates,
  companyModels,
  fashionReferences,
  fashionRemixRequest,
  photoFissionCaseRequest,
  poseFissionCaseRequest,
  onChangeSelectedPoseTemplates,
  onAddFashionReference,
  onRemoveFashionReference,
  onOpenCompanyModelLibrary,
  onOpenPoseLibrary,
  onTaskCreated,
}: LeftPanelProps) {
  const [fashionPrompt, setFashionPrompt] = useState("");
  const [fashionPromptMode, setFashionPromptMode] =
    useState<FashionPromptMode>("enhanced");
  const [fashionModel, setFashionModel] = useState<FashionModelId>(
    DEFAULT_FASHION_MODEL,
  );
  const [fashionImageRatio, setFashionImageRatio] =
    useState<FashionImageRatio>("3:4");
  const [fashionResolution, setFashionResolution] =
    useState<FashionResolution>("4k");
  const [fashionImage, setFashionImage] = useState<UploadedImage | null>(null);
  const [replacementImage, setReplacementImage] =
    useState<UploadedImage | null>(null);
  const [photoFissionModel, setPhotoFissionModel] = useState<FashionModelId>(
    DEFAULT_FASHION_MODEL,
  );
  const [photoFissionCategory, setPhotoFissionCategory] =
    useState<PhotoFissionCategory>("childrens");
  const [photoFissionChildrensCategory, setPhotoFissionChildrensCategory] =
    useState<PhotoFissionChildrensCategory>("dress");
  const [photoFissionMainImage, setPhotoFissionMainImage] =
    useState<UploadedImage | null>(null);
  const [photoFissionFrontDetail, setPhotoFissionFrontDetail] =
    useState<UploadedImage | null>(null);
  const [photoFissionBackDetail, setPhotoFissionBackDetail] =
    useState<UploadedImage | null>(null);
  const [photoFissionImageRatio, setPhotoFissionImageRatio] =
    useState<PhotoFissionImageRatio>("3:4");
  const [photoFissionResolution, setPhotoFissionResolution] =
    useState<PhotoFissionResolution>("2k");
  const [photoFissionResultCount, setPhotoFissionResultCount] =
    useState<PhotoFissionResultCount>(9);
  const photoFissionRatioUserOverrideRef = useRef(false);
  const photoFissionResolutionUserOverrideRef = useRef(false);
  const [poseMainImage, setPoseMainImage] = useState<UploadedImage | null>(
    null,
  );
  const [poseFrontDetailImage, setPoseFrontDetailImage] =
    useState<UploadedImage | null>(null);
  const [poseBackDetailImage, setPoseBackDetailImage] =
    useState<UploadedImage | null>(null);
  const [poseFissionModel, setPoseFissionModel] = useState<FashionModelId>(
    DEFAULT_FASHION_MODEL,
  );
  const [generateCount, setGenerateCount] = useState<GenerateCount>(4);
  const [imageRatio, setImageRatio] = useState<ImageRatio>("3:4");
  const [poseImageRatio, setPoseImageRatio] = useState<PoseImageRatio>("3:4");
  const [poseResolution, setPoseResolution] = useState<PoseResolution>("4k");
  const [elementType, setElementType] =
    useState<ElementReplaceType>("clothing");
  const [prompt, setPrompt] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoModel, setVideoModel] = useState<string>(DEFAULT_VIDEO_MODEL);
  const [videoResolution, setVideoResolution] =
    useState<VideoResolution>("720p");
  const [videoDuration, setVideoDuration] = useState<VideoDuration>("5");
  const [videoOrientation, setVideoOrientation] = useState<
    "landscape" | "portrait"
  >("landscape");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const activeImage =
    feature === "photo-fission"
      ? photoFissionMainImage
      : feature === "pose-fission"
        ? poseMainImage
        : fashionImage;
  const isPoseFission = feature === "pose-fission";
  const isAiFashionPhoto = feature === "ai-fashion-photo";
  const isPhotoFission = feature === "photo-fission";
  const isVideoGeneration = feature === "video-generation";
  const credits =
    isPoseFission || isAiFashionPhoto || isVideoGeneration
      ? 35
      : isPhotoFission
        ? 0
        : generateCount;

  useEffect(() => {
    if (!fashionRemixRequest) return;

    const { task } = fashionRemixRequest;
    if (task.featureType !== "ai-fashion-photo") return;

    const params = task.params as Partial<AiFashionPhotoParams>;
    const nextPrompt = params.userPrompt ?? params.prompt ?? "";
    const nextPromptMode = params.promptMode === "raw" ? "raw" : "enhanced";

    setFashionPrompt(nextPrompt);
    setFashionPromptMode(nextPromptMode);
    setError("");

    if (
      params.model &&
      SELECTABLE_FASHION_MODELS.some((option) => option.id === params.model)
    ) {
      setFashionModel(params.model);
    }

    if (
      params.imageRatio &&
      FASHION_IMAGE_RATIOS.some((option) => option.id === params.imageRatio)
    ) {
      setFashionImageRatio(params.imageRatio);
    }

    if (
      params.resolution &&
      FASHION_RESOLUTIONS.some((option) => option.id === params.resolution)
    ) {
      setFashionResolution(params.resolution);
    }
  }, [fashionRemixRequest]);

  // photo-fission 案例库「使用此案例」回填：
  // 1) 同步 5 个表单字段（model / category / imageRatio / resolution / 主图）
  // 2) 把比例和分辨率标记为「用户主动选择」防止主图 onUploaded 推断逻辑再次覆盖
  // 3) fetch 案例图 → /api/assets/upload → 落到 photoFissionMainImage
  useEffect(() => {
    if (!photoFissionCaseRequest) return;

    const { case: photoFissionCase } = photoFissionCaseRequest;
    const nextModel = SELECTABLE_FASHION_MODELS.some(
      (option) => option.id === photoFissionCase.modelId,
    )
      ? photoFissionCase.modelId
      : DEFAULT_FASHION_MODEL;

    setPhotoFissionModel(nextModel);
    setPhotoFissionCategory(photoFissionCase.category);
    setPhotoFissionChildrensCategory(
      photoFissionCase.childrensCategory ?? "dress",
    );
    setPhotoFissionImageRatio(photoFissionCase.imageRatio);
    setPhotoFissionResolution(photoFissionCase.resolution);
    photoFissionRatioUserOverrideRef.current = true;
    photoFissionResolutionUserOverrideRef.current = true;
    setPhotoFissionFrontDetail(null);
    setPhotoFissionBackDetail(null);
    setError("");

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(photoFissionCase.mainImageUrl);
        if (!response.ok) return;
        const blob = await response.blob();
        const mimeType = blob.type || "image/jpeg";
        const extension = mimeType.split("/")[1] || "jpg";
        const file = new File(
          [blob],
          `case-${photoFissionCase.id}.${extension}`,
          { type: mimeType },
        );

        const prepared = await prepareImageForGenerationUpload(file, true);
        const sizeError = validateUploadSize(prepared.file);
        if (sizeError) return;

        const formData = new FormData();
        formData.append("file", prepared.file);
        if (prepared.width > 0 && prepared.height > 0) {
          formData.append("width", String(prepared.width));
          formData.append("height", String(prepared.height));
        }

        const uploadResponse = await fetch("/api/assets/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadResponse.ok) return;

        const data = (await uploadResponse.json()) as {
          assetId: string;
          fileName: string;
          width: number;
          height: number;
        };
        if (cancelled) return;
        setPhotoFissionMainImage({
          assetId: data.assetId,
          preview: photoFissionCase.mainImageUrl,
          name: data.fileName,
          width: data.width,
          height: data.height,
        });
      } catch {
        // 静默失败：已回填的非主图字段保留，用户可手动重传主图
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photoFissionCaseRequest]);

  // PR4：pose-fission 案例库「做同款」回填：
  // 1) 把 case.poseTemplateIds 解为 PoseTemplate[]（找不到的 id 静默忽略，参考 types.ts D3 注释）
  //    并通过 onChangeSelectedPoseTemplates 回写到 workbench（避免重新打开 PoseLibraryDialog）
  // 2) 同步 model / 比例 / 分辨率 三个本地字段
  // 3) 不自动上传 mainImageUrl 作为主图：与 photo-fission 不同，pose-fission 的 case
  //    主图是"成品参考"而非"输入服装图"，用户必须上传自己的服装主图
  useEffect(() => {
    if (!poseFissionCaseRequest) return;

    const { case: poseCase } = poseFissionCaseRequest;
    const templates: PoseTemplate[] = poseCase.poseTemplateIds
      .map((id) => POSE_TEMPLATES.find((tpl) => tpl.id === id))
      .filter((tpl): tpl is PoseTemplate => Boolean(tpl));

    onChangeSelectedPoseTemplates(templates);
    setPoseFissionModel(
      SELECTABLE_FASHION_MODELS.some((option) => option.id === poseCase.model)
        ? poseCase.model
        : DEFAULT_FASHION_MODEL,
    );
    setPoseImageRatio(poseCase.imageRatio);
    setPoseResolution(poseCase.resolution);
    setError("");
  }, [poseFissionCaseRequest, onChangeSelectedPoseTemplates]);

  const helperText = useMemo(() => {
    if (feature === "ai-fashion-photo") return "上传服装、姿势或场景参考图";
    if (feature === "element-replace") return "上传需要修改的服装大片原图";
    if (feature === "photo-fission") return "上传一张已满意的服装大片作为参考";
    return "请上传需要姿势裂变的清晰主图";
  }, [feature]);

  const handleCreateTask = async () => {
    if (feature === "ai-fashion-photo") {
      if (!fashionReferences.length) {
        setError("请先上传参考图或在我的模特库选择模特");
        return;
      }

      if (!fashionPrompt.trim()) {
        setError("请输入提示词");
        return;
      }
    } else if (feature === "photo-fission") {
      if (!photoFissionMainImage) {
        setError("请先上传参考图");
        return;
      }
    } else if (!isVideoGeneration && !activeImage) {
      setError("请先上传图片");
      return;
    }

    if (feature === "element-replace" && !replacementImage) {
      setError("请上传替换元素");
      return;
    }

    if (feature === "pose-fission" && selectedPoseTemplates.length === 0) {
      setError("请先去姿势库选择合适的姿势");
      return;
    }

    if (
      feature === "pose-fission" &&
      selectedPoseTemplates.length > 9
    ) {
      setError("姿势模板最多选 9 个");
      return;
    }

    if (feature === "video-generation") {
      if (!videoPrompt.trim()) {
        setError("请输入视频提示词");
        return;
      }
      if (!videoModel) {
        setError("请选择视频模型");
        return;
      }
    }

    setError("");
    setIsCreating(true);

    try {
      const taskInputAssetIds = getInputAssetIds();
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          featureType: feature,
          inputAssetIds: taskInputAssetIds,
          params: getParams(),
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "创建任务失败");
      }

      const data = (await response.json()) as { taskId: string };
      onTaskCreated(data.taskId);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "创建任务失败",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const getInputAssetIds = () => {
    if (feature === "video-generation") {
      return [];
    }

    if (feature === "ai-fashion-photo") {
      return fashionReferences.map((reference) => reference.assetId);
    }

    if (feature === "photo-fission") {
      if (!photoFissionMainImage) return [];
      return [
        photoFissionMainImage.assetId,
        ...(photoFissionFrontDetail ? [photoFissionFrontDetail.assetId] : []),
        ...(photoFissionBackDetail ? [photoFissionBackDetail.assetId] : []),
      ];
    }

    if (!activeImage) return [];

    if (feature === "element-replace" && replacementImage) {
      return [activeImage.assetId, replacementImage.assetId];
    }

    if (feature === "pose-fission") {
      return [
        activeImage.assetId,
        ...(poseFrontDetailImage ? [poseFrontDetailImage.assetId] : []),
        ...(poseBackDetailImage ? [poseBackDetailImage.assetId] : []),
      ];
    }

    return [activeImage.assetId];
  };

  const getParams = ():
    | AiFashionPhotoParams
    | PhotoFissionParams
    | BackgroundReplaceParams
    | PoseFissionParams
    | VideoGenerationParams => {
    if (feature === "video-generation") {
      return {
        prompt: videoPrompt.trim(),
        model: videoModel,
        size: resolveVideoSize(videoResolution, videoOrientation),
        duration: videoDuration,
        resultCount: 1,
        creditsCost: 35,
      } satisfies VideoGenerationParams;
    }

    if (feature === "ai-fashion-photo") {
      const trimmedPrompt = fashionPrompt.trim();
      // finalPrompt 由后端 composer 重新计算并落库；这里给一个占位以满足类型，后端会覆盖。
      return {
        prompt: trimmedPrompt,
        userPrompt: trimmedPrompt,
        finalPrompt: trimmedPrompt,
        promptMode: fashionPromptMode,
        model: fashionModel,
        referenceImageCount: fashionReferences.length,
        imageRatio: fashionImageRatio,
        resolution: fashionResolution,
        resultCount: 1,
        creditsCost: 35,
      };
    }

    if (feature === "photo-fission") {
      // shotPlan 由后端 normalize 阶段补全，这里仅占位以满足类型。
      return {
        model: photoFissionModel,
        category: photoFissionCategory,
        childrensCategory: photoFissionChildrensCategory,
        hasFrontDetail: Boolean(photoFissionFrontDetail),
        hasBackDetail: Boolean(photoFissionBackDetail),
        imageRatio: photoFissionImageRatio,
        resolution: photoFissionResolution,
        shotPlan: [],
        resultCount: photoFissionResultCount,
      };
    }

    if (feature === "pose-fission") {
      // PR3：用户已在 PoseLibraryDialog 完成多选；上游 handleCreateTask 已校验非空与上限。
      const poseTemplateSnapshots: PoseTemplate[] = selectedPoseTemplates;
      const poseTemplateIds = poseTemplateSnapshots.map((tpl) => tpl.id);
      return {
        model: poseFissionModel,
        poseTemplateIds,
        poseTemplateSnapshots,
        hasFrontDetail: Boolean(poseFrontDetailImage),
        hasBackDetail: Boolean(poseBackDetailImage),
        imageRatio: poseImageRatio,
        resolution: poseResolution,
        resultCount: poseTemplateIds.length,
        creditsCost: 0,
      };
    }

    return {
      elementType,
      prompt,
      generateCount,
      imageRatio,
    };
  };

  const submitDisabled = isCreating;
  const submitLabel = isCreating ? "创建任务中..." : "立即生成";

  return (
    <aside
      className={cn(
        "h-screen min-h-0 overflow-hidden bg-card border-r border-border flex flex-col",
        isAiFashionPhoto ? "w-[460px]" : "w-[320px]",
      )}
    >
      <div className="shrink-0 p-5 border-b border-border">
        {!isPoseFission && (
          <p className="text-xs text-muted-foreground">固定 Workflow</p>
        )}
        <h2 className="mt-1 text-lg font-semibold text-foreground">
          {FEATURE_LABELS[feature]}
        </h2>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto space-y-6",
          isAiFashionPhoto ? "p-4" : "p-5",
        )}
      >
        {isPoseFission ? (
          <PoseFissionForm
            mainImage={poseMainImage}
            frontDetailImage={poseFrontDetailImage}
            backDetailImage={poseBackDetailImage}
            selectedPoseTemplates={selectedPoseTemplates}
            model={poseFissionModel}
            imageRatio={poseImageRatio}
            resolution={poseResolution}
            helperText={helperText}
            onModelChange={setPoseFissionModel}
            onMainUploaded={setPoseMainImage}
            onFrontDetailUploaded={setPoseFrontDetailImage}
            onBackDetailUploaded={setPoseBackDetailImage}
            onMainRemove={() => setPoseMainImage(null)}
            onFrontDetailRemove={() => setPoseFrontDetailImage(null)}
            onBackDetailRemove={() => setPoseBackDetailImage(null)}
            onOpenPoseLibrary={onOpenPoseLibrary}
            onImageRatioChange={setPoseImageRatio}
            onResolutionChange={setPoseResolution}
          />
        ) : (
          <>
            {feature === "ai-fashion-photo" ? (
              <AiFashionPhotoForm
                references={fashionReferences}
                prompt={fashionPrompt}
                promptMode={fashionPromptMode}
                model={fashionModel}
                imageRatio={fashionImageRatio}
                resolution={fashionResolution}
                helperText={helperText}
                companyModels={companyModels}
                onOpenCompanyModelLibrary={onOpenCompanyModelLibrary}
                onAddUploadReference={(image) => {
                  onAddFashionReference({
                    assetId: image.assetId,
                    source: "upload",
                    preview: image.preview,
                    name: image.name,
                    width: image.width,
                    height: image.height,
                  });
                }}
                onAddModelReference={(model) => {
                  onAddFashionReference({
                    assetId: model.assetId,
                    source: "model",
                    preview: model.preview,
                    name: model.name,
                    width: model.width,
                    height: model.height,
                    modelId: model.assetId,
                  });
                }}
                onRemoveReference={onRemoveFashionReference}
                onPromptChange={setFashionPrompt}
                onPromptModeChange={setFashionPromptMode}
                onModelChange={setFashionModel}
                onImageRatioChange={setFashionImageRatio}
                onResolutionChange={setFashionResolution}
              />
            ) : feature === "photo-fission" ? (
              <PhotoFissionForm
                model={photoFissionModel}
                category={photoFissionCategory}
                childrensCategory={photoFissionChildrensCategory}
                mainImage={photoFissionMainImage}
                frontDetailImage={photoFissionFrontDetail}
                backDetailImage={photoFissionBackDetail}
                imageRatio={photoFissionImageRatio}
                resolution={photoFissionResolution}
                helperText={helperText}
                onModelChange={setPhotoFissionModel}
                onCategoryChange={setPhotoFissionCategory}
                onChildrensCategoryChange={setPhotoFissionChildrensCategory}
                onMainUploaded={(image) => {
                  setPhotoFissionMainImage(image);
                  if (!photoFissionRatioUserOverrideRef.current) {
                    setPhotoFissionImageRatio(
                      inferPhotoFissionRatio(image.width, image.height),
                    );
                  }
                  if (!photoFissionResolutionUserOverrideRef.current) {
                    setPhotoFissionResolution(
                      inferPhotoFissionResolution(image.width, image.height),
                    );
                  }
                }}
                onMainRemove={() => setPhotoFissionMainImage(null)}
                onFrontDetailUploaded={setPhotoFissionFrontDetail}
                onFrontDetailRemove={() => setPhotoFissionFrontDetail(null)}
                onBackDetailUploaded={setPhotoFissionBackDetail}
                onBackDetailRemove={() => setPhotoFissionBackDetail(null)}
                onImageRatioChange={(value) => {
                  photoFissionRatioUserOverrideRef.current = true;
                  setPhotoFissionImageRatio(value);
                }}
                onResolutionChange={(value) => {
                  photoFissionResolutionUserOverrideRef.current = true;
                  setPhotoFissionResolution(value);
                }}
                resultCount={photoFissionResultCount}
                onResultCountChange={setPhotoFissionResultCount}
              />
            ) : feature === "element-replace" ? (
              <>
                <UploadBox
                  label="上传原图"
                  helper={helperText}
                  image={fashionImage}
                  onUploaded={setFashionImage}
                  onRemove={() => setFashionImage(null)}
                />
                <div className="space-y-3">
                  <OptionSelector
                    label="替换类型"
                    required
                    options={ELEMENT_REPLACE_TYPES}
                    value={elementType}
                    onChange={setElementType}
                  />
                  <UploadBox
                    label="上传替换元素"
                    helper="上传要替换进去的服装、环境参考或人像元素"
                    image={replacementImage}
                    onUploaded={setReplacementImage}
                    onRemove={() => setReplacementImage(null)}
                  />
                </div>
              </>
            ) : feature === "video-generation" ? (
              <VideoGenerationForm
                prompt={videoPrompt}
                model={videoModel}
                resolution={videoResolution}
                duration={videoDuration}
                orientation={videoOrientation}
                onPromptChange={setVideoPrompt}
                onModelChange={setVideoModel}
                onResolutionChange={setVideoResolution}
                onDurationChange={setVideoDuration}
                onOrientationChange={setVideoOrientation}
              />
            ) : feature === "photo-fission" ? null : (
              <UploadBox
                label="服装大片"
                helper={helperText}
                image={fashionImage}
                onUploaded={setFashionImage}
                onRemove={() => setFashionImage(null)}
              />
            )}

            {feature === "element-replace" && (
              <div className="space-y-2">
                <span className="text-sm text-foreground">提示词</span>
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="请输入提示词，例如：将原图背景替换为室内高级商拍场景，保持人物和服装不变"
                    maxLength={800}
                    className="w-full h-24 resize-none rounded-lg border border-border bg-black p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
                    {prompt.length}/800
                  </span>
                </div>
              </div>
            )}

            {feature === "element-replace" && (
              <>
                <OptionSelector
                  label="生成数量"
                  required
                  options={GENERATE_COUNTS}
                  value={generateCount}
                  onChange={setGenerateCount}
                />
                <RatioSelector
                  label="图片比例"
                  required
                  options={IMAGE_RATIOS}
                  value={imageRatio}
                  onChange={setImageRatio}
                />
              </>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 p-5 border-t border-border bg-card space-y-3 z-10">
        {error && (
          <p className="text-[13px] text-destructive flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> {error}
          </p>
        )}
        <button
          onClick={handleCreateTask}
          disabled={submitDisabled}
          className="w-full h-[40px] bg-primary text-primary-foreground rounded-md text-[13px] font-medium flex items-center justify-center gap-2 transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          <Sparkles className="w-4 h-4 opacity-90" />
          <span>{submitLabel}</span>
          {!isPhotoFission && (
            <div className="flex items-center gap-1 ml-1 pl-3 border-l border-primary-foreground/20 opacity-90">
              <Coins className="w-4 h-4" />
              <span>{credits}</span>
            </div>
          )}
        </button>
        {!isPoseFission && !isAiFashionPhoto && !isPhotoFission && (
          <p className="text-[11px] text-muted-foreground text-center">
            MVP 当前按每生成 1 张消耗 1 点额度计算。
          </p>
        )}
      </div>
    </aside>
  );
}

function FashionModelSelect({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: FashionModelId;
  onChange: (value: FashionModelId) => void;
  className?: string;
}) {
  const activeModel =
    SELECTABLE_FASHION_MODELS.find((option) => option.id === value) ??
    SELECTABLE_FASHION_MODELS[0];

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-foreground">{label}</span>
        {activeModel && (
          <span className="truncate text-[10px] text-muted-foreground">
            {activeModel.alias}
          </span>
        )}
      </div>
      <Select
        value={activeModel?.id ?? value}
        onValueChange={(nextValue) => onChange(nextValue as FashionModelId)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent>
          {SELECTABLE_FASHION_MODELS.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label} · {option.alias}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeModel && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {activeModel.description}
        </p>
      )}
    </div>
  );
}

function PoseFissionForm({
  mainImage,
  frontDetailImage,
  backDetailImage,
  selectedPoseTemplates,
  model,
  imageRatio,
  resolution,
  helperText,
  onModelChange,
  onMainUploaded,
  onFrontDetailUploaded,
  onBackDetailUploaded,
  onMainRemove,
  onFrontDetailRemove,
  onBackDetailRemove,
  onOpenPoseLibrary,
  onImageRatioChange,
  onResolutionChange,
}: {
  mainImage: UploadedImage | null;
  frontDetailImage: UploadedImage | null;
  backDetailImage: UploadedImage | null;
  selectedPoseTemplates: PoseTemplate[];
  model: FashionModelId;
  imageRatio: PoseImageRatio;
  resolution: PoseResolution;
  helperText: string;
  onModelChange: (value: FashionModelId) => void;
  onMainUploaded: (image: UploadedImage) => void;
  onFrontDetailUploaded: (image: UploadedImage) => void;
  onBackDetailUploaded: (image: UploadedImage) => void;
  onMainRemove: () => void;
  onFrontDetailRemove: () => void;
  onBackDetailRemove: () => void;
  onOpenPoseLibrary: () => void;
  onImageRatioChange: (value: PoseImageRatio) => void;
  onResolutionChange: (value: PoseResolution) => void;
}) {
  const hasSelectedPoses = selectedPoseTemplates.length > 0;

  return (
    <div className="space-y-4">
      <FashionModelSelect
        label="模型版本"
        value={model}
        onChange={onModelChange}
      />

      <UploadBox
        label="主图"
        helper={helperText}
        image={mainImage}
        onUploaded={onMainUploaded}
        onRemove={onMainRemove}
        variant="compact"
      />
      <UploadBox
        label="产品正面细节图（非必填）"
        helper="请上传模板的正面种类细节图，如领口、图案、logo等。仅上传必要细节，图片不是越多越好"
        image={frontDetailImage}
        onUploaded={onFrontDetailUploaded}
        onRemove={onFrontDetailRemove}
        required={false}
        variant="compact"
      />
      <UploadBox
        label="产品背面细节图（非必填）"
        helper="请上传模板的完整背面图以及背面特殊细节图，图片不是越多越好"
        image={backDetailImage}
        onUploaded={onBackDetailUploaded}
        onRemove={onBackDetailRemove}
        required={false}
        variant="compact"
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <RequiredLabel label="选择姿势" />
          {hasSelectedPoses && (
            <span className="text-xs text-muted-foreground">
              {selectedPoseTemplates.length} 张已选 / 最多 9 张
            </span>
          )}
        </div>
        {hasSelectedPoses ? (
          <div className="space-y-2 rounded-md border border-primary/60 bg-secondary p-3">
            <div className="flex flex-wrap gap-2">
              {selectedPoseTemplates.map((template, index) => (
                <div
                  key={template.id}
                  className="relative h-12 w-12 overflow-hidden rounded border border-border bg-background"
                  title={`${index + 1}. ${template.name}`}
                >
                  <img
                    src={template.imageUrl}
                    alt={template.name}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
                    {index + 1}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onOpenPoseLibrary}
              className="w-full rounded-md border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              重新选择
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenPoseLibrary}
            className={cn(
              "flex min-h-[58px] w-full items-center justify-center gap-3 rounded-md border bg-secondary px-3 py-3",
              "border-border text-center text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5",
            )}
          >
            <span className="text-2xl leading-none">+</span>
            <span>去姿势库选择合适的姿势</span>
          </button>
        )}
      </div>

      <PoseRatioSelector value={imageRatio} onChange={onImageRatioChange} />
      <ResolutionSelector value={resolution} onChange={onResolutionChange} />
    </div>
  );
}

function AiFashionPhotoForm({
  references,
  prompt,
  promptMode,
  model,
  imageRatio,
  resolution,
  helperText,
  companyModels,
  onOpenCompanyModelLibrary,
  onAddUploadReference,
  onAddModelReference,
  onRemoveReference,
  onPromptChange,
  onPromptModeChange,
  onModelChange,
  onImageRatioChange,
  onResolutionChange,
}: {
  references: FashionReferenceImage[];
  prompt: string;
  promptMode: FashionPromptMode;
  model: FashionModelId;
  imageRatio: FashionImageRatio;
  resolution: FashionResolution;
  helperText: string;
  companyModels: CompanyModel[];
  onOpenCompanyModelLibrary: () => void;
  onAddUploadReference: (image: UploadedImage) => void;
  onAddModelReference: (model: CompanyModel) => void;
  onRemoveReference: (assetId: string) => void;
  onPromptChange: (value: string) => void;
  onPromptModeChange: (value: FashionPromptMode) => void;
  onModelChange: (value: FashionModelId) => void;
  onImageRatioChange: (value: FashionImageRatio) => void;
  onResolutionChange: (value: FashionResolution) => void;
}) {
  const referencedModelIds = useMemo(
    () =>
      new Set(
        references
          .filter((reference) => reference.source === "model")
          .map((reference) => reference.modelId ?? reference.assetId),
      ),
    [references],
  );

  const activePromptMode = FASHION_PROMPT_MODES.find(
    (mode) => mode.id === promptMode,
  );
  const sectionClass = "rounded-md bg-secondary p-4";

  return (
    <div className="space-y-4">
      <FashionModelSelect
        label="模型"
        value={model}
        onChange={onModelChange}
        className={sectionClass}
      />

      <div className={cn(sectionClass, "space-y-4")}>
        <FashionReferenceUploader
          references={references}
          helperText={helperText}
          onAddUploadReference={onAddUploadReference}
          onRemoveReference={onRemoveReference}
        />

        <CompanyModelStrip
          models={companyModels}
          referencedModelIds={referencedModelIds}
          canAddMore={references.length < 10}
          onAddModel={onAddModelReference}
          onOpenLibrary={onOpenCompanyModelLibrary}
        />
      </div>

      <div className={cn(sectionClass, "space-y-3")}>
        <RequiredLabel label="提示词" />
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="请输入提示词"
            maxLength={800}
            className="h-[132px] w-full resize-none rounded-md border border-border bg-black p-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
            {prompt.length}/800
          </span>
        </div>
      </div>

      <div className={cn(sectionClass, "space-y-3")}>
        <span className="text-sm text-foreground">提示词模式</span>
        <div className="grid grid-cols-2 gap-2">
          {FASHION_PROMPT_MODES.map((option) => {
            const isActive = option.id === promptMode;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onPromptModeChange(option.id)}
                className={cn(
                  "rounded-md border bg-secondary px-3 py-2 text-left text-xs transition-colors",
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                <span className="block font-medium">{option.label}</span>
              </button>
            );
          })}
        </div>
        {activePromptMode && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {activePromptMode.description}
          </p>
        )}
      </div>

      <div className={sectionClass}>
        <FashionRatioSelector
          value={imageRatio}
          onChange={onImageRatioChange}
        />
      </div>

      <div className={sectionClass}>
        <FashionResolutionSelector
          value={resolution}
          onChange={onResolutionChange}
        />
      </div>
    </div>
  );
}

function CompanyModelStrip({
  models,
  referencedModelIds,
  canAddMore,
  onAddModel,
  onOpenLibrary,
}: {
  models: CompanyModel[];
  referencedModelIds: Set<string>;
  canAddMore: boolean;
  onAddModel: (model: CompanyModel) => void;
  onOpenLibrary: () => void;
}) {
  const previewModels = models.slice(0, 5);

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">找灵感可以试试官方素材</p>
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-sm text-muted-foreground">
          模特库
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {previewModels.map((model) => {
            const isAdded = referencedModelIds.has(model.assetId);
            const isDisabled = isAdded || !canAddMore;

            return (
              <button
                key={model.assetId}
                type="button"
                onClick={() => onAddModel(model)}
                disabled={isDisabled}
                className={cn(
                  "relative h-12 w-12 overflow-hidden rounded border bg-background transition-colors",
                  isAdded
                    ? "border-primary opacity-60"
                    : !canAddMore
                      ? "border-border opacity-40 cursor-not-allowed"
                      : "border-border hover:border-primary/60",
                )}
                aria-label={
                  isAdded ? `${model.name}已添加` : `添加${model.name}到参考图`
                }
                title={
                  isAdded
                    ? "已添加到参考图"
                    : !canAddMore
                      ? "参考图已达上限"
                      : "添加到参考图"
                }
              >
                <img
                  src={model.preview}
                  alt={model.name}
                  className="h-full w-full object-cover"
                />
                {isAdded && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/60 text-[10px] font-medium text-primary">
                    已加
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onOpenLibrary}
            className="ml-auto h-12 min-w-14 rounded bg-card px-3 text-xs font-medium text-foreground hover:text-primary"
          >
            More
          </button>
        </div>
      </div>
    </div>
  );
}

function FashionReferenceUploader({
  references,
  helperText,
  onAddUploadReference,
  onRemoveReference,
}: {
  references: FashionReferenceImage[];
  helperText: string;
  onAddUploadReference: (image: UploadedImage) => void;
  onRemoveReference: (assetId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const canAddMore = references.length < 10;

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const availableSlots = 10 - references.length;
    if (availableSlots <= 0) {
      setUploadError("参考图最多上传10张");
      return;
    }

    const oversizedNames: string[] = [];
    const acceptedFiles: File[] = [];
    for (const file of files) {
      if (validateUploadSize(file)) {
        oversizedNames.push(file.name);
      } else {
        acceptedFiles.push(file);
      }
    }

    if (!acceptedFiles.length) {
      setUploadError(
        oversizedNames.length === 1
          ? `图片体积超过 8MB 上限：${oversizedNames[0]}`
          : `${oversizedNames.length} 张图片体积超过 8MB 上限，未上传`,
      );
      return;
    }

    setIsUploading(true);
    setUploadError("");

    try {
      for (const file of acceptedFiles.slice(0, availableSlots)) {
        const preview = URL.createObjectURL(file);
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/assets/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "上传失败");
        }

        const data = (await response.json()) as {
          assetId: string;
          fileName: string;
          width: number;
          height: number;
        };

        onAddUploadReference({
          assetId: data.assetId,
          preview,
          name: data.fileName,
          width: data.width,
          height: data.height,
        });
      }

      const messages: string[] = [];
      if (acceptedFiles.length > availableSlots) {
        messages.push("参考图最多上传10张，已自动忽略超出图片");
      }
      if (oversizedNames.length) {
        messages.push(`已跳过 ${oversizedNames.length} 张超过 8MB 的图片`);
      }
      if (messages.length) setUploadError(messages.join("；"));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <RequiredLabel label="参考图（最多支持10张参考图）" />
        <span className="shrink-0 text-xs text-muted-foreground">
          {references.length}/10
        </span>
      </div>
      <div className="max-h-[276px] overflow-y-auto pr-1">
        <div className="grid grid-cols-4 gap-2">
          {references.map((reference) => (
            <div
              key={reference.assetId}
              className="group relative aspect-square overflow-hidden rounded-md border border-border bg-background"
            >
              <img
                src={reference.preview}
                alt={reference.name}
                className="h-full w-full object-cover"
              />
              <span className="absolute left-1.5 top-1.5 max-w-[72px] truncate rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-foreground">
                {reference.source === "model" ? "模特" : "参考"}
              </span>
              <button
                type="button"
                onClick={() => onRemoveReference(reference.assetId)}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/90 opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                aria-label="移除参考图"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {canAddMore && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="aspect-square rounded-md border border-dashed border-border bg-secondary px-3 text-center transition-colors hover:border-primary/60 hover:bg-primary/5"
            >
              <span className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                {isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                <span>{isUploading ? "上传中..." : helperText}</span>
              </span>
            </button>
          )}
        </div>
      </div>
      {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}

function FashionRatioSelector({
  value,
  onChange,
}: {
  value: FashionImageRatio;
  onChange: (value: FashionImageRatio) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <RequiredLabel label="图片比例" />
        <span className="text-xs text-muted-foreground">{value}</span>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {FASHION_IMAGE_RATIOS.map((option) => {
          const ratioStyle = getFashionRatioStyle(option.id);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                "flex h-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors",
                value === option.id
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50",
              )}
            >
              <span
                className={cn(
                  "rounded-sm border",
                  value === option.id
                    ? "border-primary"
                    : "border-muted-foreground",
                )}
                style={ratioStyle}
              />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FashionResolutionSelector({
  value,
  onChange,
}: {
  value: FashionResolution;
  onChange: (value: FashionResolution) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-foreground">分辨率</span>
      <div className="grid grid-cols-3 gap-2">
        {FASHION_RESOLUTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "flex h-10 items-center justify-center rounded-md border text-xs font-medium transition-colors",
              value === option.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-secondary text-muted-foreground hover:border-primary/50",
            )}
          >
            {option.id === "4k" && (
              <Zap className="mr-1.5 h-3.5 w-3.5 fill-current" />
            )}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function getFashionRatioStyle(id: FashionImageRatio) {
  if (id === "3:4") return { width: 15, height: 22 };
  if (id === "4:3") return { width: 22, height: 15 };
  if (id === "2:3") return { width: 15, height: 22 };
  if (id === "3:2") return { width: 22, height: 15 };
  if (id === "more") return { width: 17, height: 20 };
  return { width: 18, height: 18 };
}

function RequiredLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-primary">*</span>
      <span className="text-sm text-foreground">{label}</span>
    </div>
  );
}

function PoseRatioSelector({
  value,
  onChange,
}: {
  value: PoseImageRatio;
  onChange: (value: PoseImageRatio) => void;
}) {
  return (
    <div className="space-y-2">
      <RequiredLabel label="图片比例" />
      <div className="grid grid-cols-6 gap-2">
        {POSE_IMAGE_RATIOS.map((option) => {
          const ratioStyle = getPoseRatioStyle(option.id);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                "flex h-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors",
                value === option.id
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50",
              )}
            >
              <span
                className={cn(
                  "rounded-sm border",
                  value === option.id
                    ? "border-primary"
                    : "border-muted-foreground",
                )}
                style={ratioStyle}
              />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResolutionSelector({
  value,
  onChange,
}: {
  value: PoseResolution;
  onChange: (value: PoseResolution) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-foreground">分辨率</span>
      <div className="grid grid-cols-3 gap-2">
        {POSE_RESOLUTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "flex h-10 items-center justify-center rounded-md border text-xs font-medium transition-colors",
              value === option.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-secondary text-muted-foreground hover:border-primary/50",
            )}
          >
            {option.id === "4k" && (
              <Zap className="mr-1.5 h-3.5 w-3.5 fill-current" />
            )}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function getPoseRatioStyle(id: PoseImageRatio) {
  if (id === "3:4") return { width: 15, height: 22 };
  if (id === "4:3") return { width: 22, height: 15 };
  if (id === "2:3") return { width: 15, height: 22 };
  if (id === "3:2") return { width: 22, height: 15 };
  if (id === "more") return { width: 17, height: 20 };
  return { width: 18, height: 18 };
}

/**
 * 服装大片裂变（PRD v2）左侧表单。
 * 字段：模型 / 品类 / 主图（必填）/ 正面细节图 / 背面细节图 / 图片比例（6+5）/ 分辨率。
 * 「更多」按钮在主图比例后弹出 Radix Popover 平铺 5 个扩展比例。
 */
function PhotoFissionForm({
  model,
  category,
  childrensCategory,
  mainImage,
  frontDetailImage,
  backDetailImage,
  imageRatio,
  resolution,
  helperText,
  onModelChange,
  onCategoryChange,
  onChildrensCategoryChange,
  onMainUploaded,
  onMainRemove,
  onFrontDetailUploaded,
  onFrontDetailRemove,
  onBackDetailUploaded,
  onBackDetailRemove,
  onImageRatioChange,
  onResolutionChange,
  resultCount,
  onResultCountChange,
}: {
  model: FashionModelId;
  category: PhotoFissionCategory;
  childrensCategory: PhotoFissionChildrensCategory;
  mainImage: UploadedImage | null;
  frontDetailImage: UploadedImage | null;
  backDetailImage: UploadedImage | null;
  imageRatio: PhotoFissionImageRatio;
  resolution: PhotoFissionResolution;
  helperText: string;
  onModelChange: (value: FashionModelId) => void;
  onCategoryChange: (value: PhotoFissionCategory) => void;
  onChildrensCategoryChange: (value: PhotoFissionChildrensCategory) => void;
  onMainUploaded: (image: UploadedImage) => void;
  onMainRemove: () => void;
  onFrontDetailUploaded: (image: UploadedImage) => void;
  onFrontDetailRemove: () => void;
  onBackDetailUploaded: (image: UploadedImage) => void;
  onBackDetailRemove: () => void;
  onImageRatioChange: (value: PhotoFissionImageRatio) => void;
  onResolutionChange: (value: PhotoFissionResolution) => void;
  resultCount: PhotoFissionResultCount;
  onResultCountChange: (value: PhotoFissionResultCount) => void;
}) {
  const isExtraRatio = PHOTO_FISSION_RATIOS_EXTRA.some(
    (option) => option.id === imageRatio,
  );

  return (
    <div className="space-y-4">
      <FashionModelSelect
        label="模型"
        value={model}
        onChange={onModelChange}
      />

      <div className="space-y-2">
        <span className="text-sm text-foreground">品类</span>
        <Select
          value={category}
          onValueChange={(value) =>
            onCategoryChange(value as PhotoFissionCategory)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择品类" />
          </SelectTrigger>
          <SelectContent>
            {PHOTO_FISSION_CATEGORIES.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {category === "childrens" && (
        <div className="space-y-2">
          <span className="text-sm text-foreground">童装品类</span>
          <Select
            value={childrensCategory}
            onValueChange={(value) =>
              onChildrensCategoryChange(value as PhotoFissionChildrensCategory)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择童装品类" />
            </SelectTrigger>
            <SelectContent>
              {PHOTO_FISSION_CHILDRENS_CATEGORIES.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <UploadBox
        label="主图"
        helper={helperText}
        image={mainImage}
        onUploaded={onMainUploaded}
        onRemove={onMainRemove}
        variant="compact"
        optimizeForGeneration
      />
      {mainImage && (
        <p className="-mt-2 text-[11px] text-muted-foreground">
          已识别尺寸：{mainImage.width} × {mainImage.height} px
        </p>
      )}

      <UploadBox
        label="产品正面细节图（非必填）"
        helper="请上传服装正面的关键细节图，如领口、图案、Logo 等"
        image={frontDetailImage}
        onUploaded={onFrontDetailUploaded}
        onRemove={onFrontDetailRemove}
        required={false}
        variant="compact"
        optimizeForGeneration
      />
      <UploadBox
        label="产品背面细节图（非必填）"
        helper="请上传服装背面的关键细节图，如背片设计、面料纹理等"
        image={backDetailImage}
        onUploaded={onBackDetailUploaded}
        onRemove={onBackDetailRemove}
        required={false}
        variant="compact"
        optimizeForGeneration
      />

      <OptionSelector
        label="出图数量"
        required
        options={PHOTO_FISSION_RESULT_COUNTS}
        value={resultCount}
        onChange={onResultCountChange}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <RequiredLabel label="图片比例" />
          {isExtraRatio && (
            <span className="text-xs text-muted-foreground">
              {imageRatio} &gt;
            </span>
          )}
        </div>
        <div className="grid grid-cols-6 gap-2">
          {PHOTO_FISSION_RATIOS_MAIN.map((option) => {
            const ratioStyle = getPhotoFissionRatioStyle(option.id);
            const isActive = option.id === imageRatio;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onImageRatioChange(option.id)}
                className={cn(
                  "flex h-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50",
                )}
              >
                <span
                  className={cn(
                    "rounded-sm border",
                    isActive ? "border-primary" : "border-muted-foreground",
                  )}
                  style={ratioStyle}
                />
                <span>{option.label}</span>
              </button>
            );
          })}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative flex h-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors",
                  isExtraRatio
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50",
                )}
              >
                <span
                  className={cn(
                    "rounded-sm border",
                    isExtraRatio ? "border-primary" : "border-muted-foreground",
                  )}
                  style={{ width: 17, height: 20 }}
                />
                <span>更多</span>
                {isExtraRatio && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[8px] font-medium text-primary-foreground">
                    !
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-3">
              <div className="grid grid-cols-5 gap-2">
                {PHOTO_FISSION_RATIOS_EXTRA.map((option) => {
                  const ratioStyle = getPhotoFissionRatioStyle(option.id);
                  const isActive = option.id === imageRatio;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onImageRatioChange(option.id)}
                      className={cn(
                        "flex h-[54px] w-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors",
                        isActive
                          ? "border-primary text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      <span
                        className={cn(
                          "rounded-sm border",
                          isActive
                            ? "border-primary"
                            : "border-muted-foreground",
                        )}
                        style={ratioStyle}
                      />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm text-foreground">分辨率</span>
        <div className="grid grid-cols-3 gap-2">
          {PHOTO_FISSION_RESOLUTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onResolutionChange(option.id)}
              className={cn(
                "flex h-10 items-center justify-center rounded-md border text-xs font-medium transition-colors",
                resolution === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground hover:border-primary/50",
              )}
            >
              {option.id === "4k" && (
                <Zap className="mr-1.5 h-3.5 w-3.5 fill-current" />
              )}
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function getPhotoFissionRatioStyle(id: PhotoFissionImageRatio) {
  if (id === "1:1") return { width: 18, height: 18 };
  if (id === "3:2") return { width: 22, height: 15 };
  if (id === "2:3") return { width: 15, height: 22 };
  if (id === "3:4") return { width: 15, height: 22 };
  if (id === "4:3") return { width: 22, height: 15 };
  if (id === "4:5") return { width: 16, height: 22 };
  if (id === "5:4") return { width: 22, height: 16 };
  if (id === "9:16") return { width: 13, height: 22 };
  if (id === "16:9") return { width: 22, height: 13 };
  if (id === "21:9") return { width: 22, height: 11 };
  return { width: 18, height: 18 };
}

/**
 * 主图尺寸 → 推断默认 imageRatio：在 10 个预设里挑数值最接近 (width / height) 的一项。
 */
function inferPhotoFissionRatio(
  width: number,
  height: number,
): PhotoFissionImageRatio {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "3:4";
  }
  const targetRatio = width / height;
  const candidates: { id: PhotoFissionImageRatio; value: number }[] = [
    { id: "1:1", value: 1 },
    { id: "3:2", value: 1.5 },
    { id: "2:3", value: 2 / 3 },
    { id: "3:4", value: 0.75 },
    { id: "4:3", value: 4 / 3 },
    { id: "4:5", value: 0.8 },
    { id: "5:4", value: 1.25 },
    { id: "9:16", value: 9 / 16 },
    { id: "16:9", value: 16 / 9 },
    { id: "21:9", value: 21 / 9 },
  ];
  return candidates.reduce((best, current) =>
    Math.abs(current.value - targetRatio) < Math.abs(best.value - targetRatio)
      ? current
      : best,
  ).id;
}

/**
 * 主图最大边 → 推断默认 resolution。
 */
function inferPhotoFissionResolution(
  width: number,
  height: number,
): PhotoFissionResolution {
  const maxSide = Math.max(width, height);
  if (!Number.isFinite(maxSide) || maxSide <= 0) return "2k";
  if (maxSide >= 3000) return "4k";
  if (maxSide >= 1500) return "2k";
  return "1k";
}

function VideoGenerationForm({
  prompt,
  model,
  resolution,
  duration,
  orientation,
  onPromptChange,
  onModelChange,
  onResolutionChange,
  onDurationChange,
  onOrientationChange,
}: {
  prompt: string;
  model: string;
  resolution: VideoResolution;
  duration: VideoDuration;
  orientation: "landscape" | "portrait";
  onPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onResolutionChange: (value: VideoResolution) => void;
  onDurationChange: (value: VideoDuration) => void;
  onOrientationChange: (value: "landscape" | "portrait") => void;
}) {
  const selectedModel = SELECTABLE_VIDEO_MODELS.find((m) => m.id === model);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <RequiredLabel label="视频模型" />
        <Select value={model} onValueChange={onModelChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择视频模型" />
          </SelectTrigger>
          <SelectContent>
            {SELECTABLE_VIDEO_MODELS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedModel && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {selectedModel.description}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <RequiredLabel label="分辨率" />
          <Select
            value={resolution}
            onValueChange={(v) => onResolutionChange(v as VideoResolution)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_RESOLUTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <RequiredLabel label="时长" />
          <Select
            value={duration}
            onValueChange={(v) => onDurationChange(v as VideoDuration)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_DURATIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <RequiredLabel label="画面方向" />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOrientationChange("landscape")}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition-colors",
              orientation === "landscape"
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            横屏 16:9
          </button>
          <button
            type="button"
            onClick={() => onOrientationChange("portrait")}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition-colors",
              orientation === "portrait"
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            竖屏 9:16
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <RequiredLabel label="提示词" />
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="例如：一位亚洲女性模特穿着白色连衣裙在花园中漫步，电商展示风格"
            maxLength={500}
            className="h-[132px] w-full resize-none rounded-md border border-border bg-black p-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
            {prompt.length}/500
          </span>
        </div>
      </div>
    </div>
  );
}
