"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { OptionSelector } from "./option-selectors";
import {
  prepareImageForGenerationUpload,
  UploadBox,
} from "./upload-components";
import { FaceMaskPainterDialog } from "./face-mask-painter-dialog";
import {
  cn,
  readJsonResponse,
} from "@/lib/utils";
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
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_FASHION_MODEL,
  FEATURE_LABELS,
  FASHION_IMAGE_RATIOS,
  FASHION_PROMPT_MODES,
  FASHION_RESOLUTIONS,
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
  type CompanyModel,
  type FashionImageRatio,
  type FashionModelId,
  type FashionPromptMode,
  type FashionReferenceImage,
  type FashionRemixRequest,
  type FashionResolution,
  type FeatureType,
  type PhotoFissionChildrensCategory,
  type PhotoFissionCategory,
  type PhotoFissionCase,
  type PhotoFissionImageRatio,
  type PhotoFissionParams,
  type PhotoFissionResolution,
  type PhotoFissionResultCount,
  type PantsMainHandVisibility,
  type PoseFissionCase,
  type PoseFissionParams,
  type PoseImageRatio,
  type PoseResolution,
  type AiFashionPhotoParams,
  type PoseTemplate,
  type UploadedImage,
} from "@/lib/types";

const CREATE_TASK_TIMEOUT_MS = 15_000;
const MISSING_ASSET_ERROR_PREFIX = "素材不存在：";

function replacePhotoFissionDetail(
  current: UploadedImage[],
  index: number,
  image: UploadedImage,
): UploadedImage[] {
  const next = current.slice(0, 2);
  next[index] = image;
  return next.filter((item): item is UploadedImage => Boolean(item)).slice(0, 2);
}

interface AssetDescriptor {
  assetId: string;
  name: string;
  role: string;
}

interface LeftPanelProps {
  feature: FeatureType;
  selectedPoseTemplates: PoseTemplate[];
  companyModels: CompanyModel[];
  fashionReferences: FashionReferenceImage[];
  fashionRemixRequest: FashionRemixRequest | null;
  photoFissionCaseRequest: PhotoFissionCaseRequest | null;
  poseFissionCaseRequest: PoseFissionCaseRequest | null;
  faceIdModels?: CompanyModel[];
  selectedFaceIdModel?: CompanyModel | null;
  onChangeSelectedPoseTemplates: (templates: PoseTemplate[]) => void;
  onChangeSelectedFaceIdModel?: (model: CompanyModel | null) => void;
  onAddFashionReference: (reference: FashionReferenceImage) => void;
  onRemoveFashionReference: (assetId: string) => void;
  onOpenCompanyModelLibrary: () => void;
  onOpenFaceIdLibrary?: () => void;
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
  faceIdModels = [],
  selectedFaceIdModel = null,
  onChangeSelectedPoseTemplates,
  onChangeSelectedFaceIdModel = () => {},
  onAddFashionReference,
  onRemoveFashionReference,
  onOpenCompanyModelLibrary,
  onOpenFaceIdLibrary = () => {},
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
  const [photoFissionModel, setPhotoFissionModel] = useState<FashionModelId>(
    DEFAULT_FASHION_MODEL,
  );
  const [photoFissionCategory, setPhotoFissionCategory] =
    useState<PhotoFissionCategory>("childrens");
  const [photoFissionChildrensCategory, setPhotoFissionChildrensCategory] =
    useState<PhotoFissionChildrensCategory>("dress");
  const [photoFissionMainImage, setPhotoFissionMainImage] =
    useState<UploadedImage | null>(null);
  const [photoFissionFrontDetails, setPhotoFissionFrontDetails] =
    useState<UploadedImage[]>([]);
  const [photoFissionSideDetails, setPhotoFissionSideDetails] =
    useState<UploadedImage[]>([]);
  const [photoFissionBackDetails, setPhotoFissionBackDetails] =
    useState<UploadedImage[]>([]);
  const [photoFissionFaceMask, setPhotoFissionFaceMask] =
    useState<UploadedImage | null>(null);
  const [isFaceMaskPainterOpen, setIsFaceMaskPainterOpen] = useState(false);
  const [isUploadingFaceMask, setIsUploadingFaceMask] = useState(false);
  const [photoFissionImageRatio, setPhotoFissionImageRatio] =
    useState<PhotoFissionImageRatio>("3:4");
  const [photoFissionResolution, setPhotoFissionResolution] =
    useState<PhotoFissionResolution>("2k");
  const [photoFissionResultCount, setPhotoFissionResultCount] =
    useState<PhotoFissionResultCount>(9);
  const [
    photoFissionPantsMainHandVisibility,
    setPhotoFissionPantsMainHandVisibility,
  ] = useState<PantsMainHandVisibility>("hidden");
  const [photoFissionPlannerReasoningEnabled, setPhotoFissionPlannerReasoningEnabled] =
    useState(false);
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
  const [poseImageRatio, setPoseImageRatio] = useState<PoseImageRatio>("3:4");
  const [poseResolution, setPoseResolution] = useState<PoseResolution>("4k");
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

  useEffect(() => {
    if (!selectedFaceIdModel) {
      setPhotoFissionFaceMask(null);
    }
  }, [selectedFaceIdModel]);

  useEffect(() => {
    if (photoFissionChildrensCategory !== "pants") return;
    if (photoFissionResultCount === 9) {
      setPhotoFissionResultCount(10);
    }
    setPhotoFissionFaceMask(null);
    onChangeSelectedFaceIdModel(null);
  }, [
    onChangeSelectedFaceIdModel,
    photoFissionChildrensCategory,
    photoFissionResultCount,
  ]);

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
    setPhotoFissionFrontDetails([]);
    setPhotoFissionSideDetails([]);
    setPhotoFissionBackDetails([]);
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

        const data = await readJsonResponse<{
          assetId: string;
          fileName: string;
          width: number;
          height: number;
        }>(uploadResponse, "上传失败");
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
      if (
        photoFissionChildrensCategory !== "pants" &&
        selectedFaceIdModel &&
        !photoFissionFaceMask
      ) {
        setError("请先涂抹主图五官区域");
        return;
      }
    } else if (!activeImage) {
      setError("请先上传图片");
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

    setError("");
    setIsCreating(true);

    try {
      const taskInputAssets = getInputAssetDescriptors();
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        CREATE_TASK_TIMEOUT_MS,
      );
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          featureType: feature,
          inputAssetIds: taskInputAssets.map((asset) => asset.assetId),
          params: getParams(),
        }),
      }).finally(() => window.clearTimeout(timeoutId));

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(
          formatCreateTaskError(data.error, taskInputAssets),
        );
      }

      const data = (await response.json()) as { taskId: string };
      onTaskCreated(data.taskId);
    } catch (createError) {
      if (createError instanceof DOMException && createError.name === "AbortError") {
        setError("创建任务超时，请刷新任务列表确认是否已创建，或稍后重试");
        return;
      }
      setError(
        createError instanceof Error ? createError.message : "创建任务失败",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const uploadPhotoFissionFaceMask = async (maskDataUrl: string) => {
    if (!photoFissionMainImage) {
      setError("请先上传主图");
      return;
    }
    setIsUploadingFaceMask(true);
    setError("");
    try {
      const blob = await (await fetch(maskDataUrl)).blob();
      const formData = new FormData();
      formData.append(
        "file",
        new File([blob], `photo-fission-face-mask-${Date.now()}.png`, {
          type: "image/png",
        }),
      );
      formData.append("width", String(photoFissionMainImage.width));
      formData.append("height", String(photoFissionMainImage.height));
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: formData,
      });
      const data = await readJsonResponse<{
        assetId: string;
        url: string;
        fileName: string;
        width?: number;
        height?: number;
      }>(response, "上传人脸 mask 失败");
      setPhotoFissionFaceMask({
        assetId: data.assetId,
        preview: data.url,
        name: data.fileName,
        width: data.width ?? photoFissionMainImage.width,
        height: data.height ?? photoFissionMainImage.height,
      });
    } catch (maskError) {
      setError(maskError instanceof Error ? maskError.message : "上传人脸 mask 失败");
    } finally {
      setIsUploadingFaceMask(false);
    }
  };

  const getInputAssetIds = () => {
    return getInputAssetDescriptors().map((asset) => asset.assetId);
  };

  const getInputAssetDescriptors = (): AssetDescriptor[] => {
    if (feature === "ai-fashion-photo") {
      return fashionReferences.map((reference, index) => ({
        assetId: reference.assetId,
        name: reference.name || `参考图 ${index + 1}`,
        role: `AI服装大片参考图 ${index + 1}`,
      }));
    }

    if (feature === "photo-fission") {
      if (!photoFissionMainImage) return [];
      const isPantsCategory = photoFissionChildrensCategory === "pants";
      const frontDetails = photoFissionFrontDetails.slice(
        0,
        isPantsCategory ? 2 : 1,
      );
      const sideDetails = isPantsCategory
        ? photoFissionSideDetails.slice(0, 2)
        : [];
      const backDetails = photoFissionBackDetails.slice(
        0,
        isPantsCategory ? 2 : 1,
      );
      const assets: AssetDescriptor[] = [
        {
          assetId: photoFissionMainImage.assetId,
          name: photoFissionMainImage.name,
          role: "主图",
        },
      ];
      frontDetails.forEach((detail, index) => {
        assets.push({
          assetId: detail.assetId,
          name: detail.name,
          role: `产品正面参考图 ${index + 1}`,
        });
      });
      sideDetails.forEach((detail, index) => {
        assets.push({
          assetId: detail.assetId,
          name: detail.name,
          role: `产品侧面参考图 ${index + 1}`,
        });
      });
      backDetails.forEach((detail, index) => {
        assets.push({
          assetId: detail.assetId,
          name: detail.name,
          role: `产品背面参考图 ${index + 1}`,
        });
      });
      if (
        photoFissionChildrensCategory !== "pants" &&
        selectedFaceIdModel
      ) {
        assets.push({
          assetId: selectedFaceIdModel.assetId,
          name: selectedFaceIdModel.name,
          role: "五官特征锁定人像小卡",
        });
      }
      return assets;
    }

    if (!activeImage) return [];

    if (feature === "pose-fission") {
      const assets: AssetDescriptor[] = [
        {
          assetId: activeImage.assetId,
          name: activeImage.name,
          role: "姿势裂变主图",
        },
      ];
      if (poseFrontDetailImage) {
        assets.push({
          assetId: poseFrontDetailImage.assetId,
          name: poseFrontDetailImage.name,
          role: "姿势裂变正面细节图",
        });
      }
      if (poseBackDetailImage) {
        assets.push({
          assetId: poseBackDetailImage.assetId,
          name: poseBackDetailImage.name,
          role: "姿势裂变背面细节图",
        });
      }
      return assets;
    }

    return [{
      assetId: activeImage.assetId,
      name: activeImage.name,
      role: "主图",
    }];
  };

  const formatCreateTaskError = (
    rawError: string | undefined,
    assets: AssetDescriptor[],
  ) => {
    if (!rawError?.startsWith(MISSING_ASSET_ERROR_PREFIX)) {
      return rawError || "创建任务失败";
    }

    const missingAssetId = rawError.slice(MISSING_ASSET_ERROR_PREFIX.length).trim();
    const missingAsset = assets.find((asset) => asset.assetId === missingAssetId);
    if (!missingAsset) return rawError;

    if (selectedFaceIdModel?.assetId === missingAssetId) {
      onChangeSelectedFaceIdModel(null);
    }

    return `素材不存在：${missingAsset.name}（${missingAsset.role}，${missingAsset.assetId}）。请重新上传或重新选择该素材后再生成。`;
  };

  const getParams = ():
    | AiFashionPhotoParams
    | PhotoFissionParams
    | PoseFissionParams => {
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
      const isPantsCategory = photoFissionChildrensCategory === "pants";
      const frontDetailCount = Math.min(
        photoFissionFrontDetails.length,
        isPantsCategory ? 2 : 1,
      );
      const sideDetailCount = isPantsCategory
        ? Math.min(photoFissionSideDetails.length, 2)
        : 0;
      const backDetailCount = Math.min(
        photoFissionBackDetails.length,
        isPantsCategory ? 2 : 1,
      );
      // shotPlan 由后端 normalize 阶段补全，这里仅占位以满足类型。
      return {
        model: photoFissionModel,
        category: photoFissionCategory,
        childrensCategory: photoFissionChildrensCategory,
        hasFrontDetail: frontDetailCount > 0,
        hasSideDetail: sideDetailCount > 0,
        hasBackDetail: backDetailCount > 0,
        frontDetailCount,
        sideDetailCount,
        backDetailCount,
        pantsMainHandVisibility: isPantsCategory
          ? photoFissionPantsMainHandVisibility
          : undefined,
        imageRatio: photoFissionImageRatio,
        resolution: photoFissionResolution,
        shotPlan: [],
        resultCount: photoFissionResultCount,
        faceIdModelId:
          photoFissionChildrensCategory === "pants"
            ? null
            : selectedFaceIdModel?.assetId ?? null,
        faceMaskAssetId:
          photoFissionChildrensCategory === "pants"
            ? null
            : selectedFaceIdModel
              ? photoFissionFaceMask?.assetId ?? null
              : null,
        plannerReasoningEnabled: photoFissionPlannerReasoningEnabled,
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

    throw new Error(`Unknown feature: ${feature}`);
  };

  const submitDisabled = isCreating || isUploadingFaceMask;
  const submitLabel = isCreating
    ? "创建任务中..."
    : isUploadingFaceMask
      ? "正在保存人脸 mask..."
      : "立即生成";

  return (
    <>
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
                frontDetailImages={photoFissionFrontDetails}
                sideDetailImages={photoFissionSideDetails}
                backDetailImages={photoFissionBackDetails}
                pantsMainHandVisibility={photoFissionPantsMainHandVisibility}
                imageRatio={photoFissionImageRatio}
                resolution={photoFissionResolution}
                plannerReasoningEnabled={photoFissionPlannerReasoningEnabled}
                helperText={helperText}
                faceIdModels={faceIdModels}
                selectedFaceIdModel={selectedFaceIdModel}
                faceMaskImage={photoFissionFaceMask}
                isUploadingFaceMask={isUploadingFaceMask}
                onModelChange={setPhotoFissionModel}
                onCategoryChange={setPhotoFissionCategory}
                onChildrensCategoryChange={setPhotoFissionChildrensCategory}
                onMainUploaded={(image) => {
                  setPhotoFissionMainImage(image);
                  setPhotoFissionFaceMask(null);
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
                onMainRemove={() => {
                  setPhotoFissionMainImage(null);
                  setPhotoFissionFaceMask(null);
                }}
                onFrontDetailUploaded={(index, image) =>
                  setPhotoFissionFrontDetails((current) =>
                    replacePhotoFissionDetail(current, index, image),
                  )
                }
                onFrontDetailRemove={(index) =>
                  setPhotoFissionFrontDetails((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
                onSideDetailUploaded={(index, image) =>
                  setPhotoFissionSideDetails((current) =>
                    replacePhotoFissionDetail(current, index, image),
                  )
                }
                onSideDetailRemove={(index) =>
                  setPhotoFissionSideDetails((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
                onBackDetailUploaded={(index, image) =>
                  setPhotoFissionBackDetails((current) =>
                    replacePhotoFissionDetail(current, index, image),
                  )
                }
                onBackDetailRemove={(index) =>
                  setPhotoFissionBackDetails((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
                onPantsMainHandVisibilityChange={
                  setPhotoFissionPantsMainHandVisibility
                }
                onSelectFaceIdModel={onChangeSelectedFaceIdModel}
                onOpenFaceIdLibrary={onOpenFaceIdLibrary}
                onOpenFaceMaskPainter={() => setIsFaceMaskPainterOpen(true)}
                onClearFaceMask={() => setPhotoFissionFaceMask(null)}
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
                onPlannerReasoningEnabledChange={
                  setPhotoFissionPlannerReasoningEnabled
                }
              />
            ) : null}
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
          </button>
        </div>
      </aside>
      {photoFissionMainImage && (
        <FaceMaskPainterDialog
          open={isFaceMaskPainterOpen}
          title="涂抹主图五官区域"
          imageUrl={photoFissionMainImage.preview}
          imageWidth={photoFissionMainImage.width}
          imageHeight={photoFissionMainImage.height}
          onOpenChange={setIsFaceMaskPainterOpen}
          onComplete={uploadPhotoFissionFaceMask}
        />
      )}
    </>
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
            className="h-[132px] w-full resize-none rounded-md border border-border bg-white p-4 text-sm text-black placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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

    setIsUploading(true);
    setUploadError("");

    try {
      for (const file of files.slice(0, availableSlots)) {
        const preview = URL.createObjectURL(file);
        const formData = new FormData();
        formData.append("file", file);

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

        onAddUploadReference({
          assetId: data.assetId,
          preview,
          name: data.fileName,
          width: data.width,
          height: data.height,
        });
      }

      const messages: string[] = [];
      if (files.length > availableSlots) {
        messages.push("参考图最多上传10张，已自动忽略超出图片");
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
      <span className="text-sm text-foreground">画质</span>
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
      <span className="text-sm text-foreground">画质</span>
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
 * 字段：模型 / 品类 / 主图（必填）/ 正面细节图 / 侧面细节图（裤子）/ 背面细节图 / 图片比例（6+5）/ 画质。
 * 「更多」按钮在主图比例后弹出 Radix Popover 平铺 5 个扩展比例。
 */
function PhotoFissionDetailReferenceGroup({
  angleLabel,
  images,
  maxCount,
  onUploaded,
  onRemove,
}: {
  angleLabel: "正面" | "侧面" | "背面";
  images: UploadedImage[];
  maxCount: 1 | 2;
  onUploaded: (index: number, image: UploadedImage) => void;
  onRemove: (index: number) => void;
}) {
  const getSingleHelper = () => {
    if (angleLabel === "正面") {
      return "请上传服装正面的关键细节图，如领口、图案、Logo 等";
    }
    if (angleLabel === "背面") {
      return "请上传服装背面的关键细节图，如背片设计、面料纹理等";
    }
    return "请上传服装侧面的关键细节图";
  };

  return (
    <div className="space-y-2">
      {Array.from({ length: maxCount }, (_, index) => (
        <UploadBox
          key={`${angleLabel}-${index + 1}`}
          label={
            maxCount === 1
              ? `产品${angleLabel}细节图（非必填）`
              : `产品${angleLabel}参考图 ${index + 1}（非必填）`
          }
          helper={
            maxCount === 2
              ? "可自由上传完整角度图或局部放大图；上传两张时系统会联合参考"
              : getSingleHelper()
          }
          image={images[index] ?? null}
          onUploaded={(image) => onUploaded(index, image)}
          onRemove={() => onRemove(index)}
          required={false}
          variant="compact"
          optimizeForGeneration
        />
      ))}
    </div>
  );
}

function PhotoFissionForm({
  model,
  category,
  childrensCategory,
  mainImage,
  frontDetailImages,
  sideDetailImages,
  backDetailImages,
  pantsMainHandVisibility,
  imageRatio,
  resolution,
  plannerReasoningEnabled,
  helperText,
  faceIdModels = [],
  selectedFaceIdModel = null,
  faceMaskImage = null,
  isUploadingFaceMask = false,
  onModelChange,
  onCategoryChange,
  onChildrensCategoryChange,
  onMainUploaded,
  onMainRemove,
  onFrontDetailUploaded,
  onFrontDetailRemove,
  onSideDetailUploaded,
  onSideDetailRemove,
  onBackDetailUploaded,
  onBackDetailRemove,
  onPantsMainHandVisibilityChange,
  onSelectFaceIdModel = () => {},
  onOpenFaceIdLibrary = () => {},
  onOpenFaceMaskPainter = () => {},
  onClearFaceMask = () => {},
  onImageRatioChange,
  onResolutionChange,
  resultCount,
  onResultCountChange,
  onPlannerReasoningEnabledChange,
}: {
  model: FashionModelId;
  category: PhotoFissionCategory;
  childrensCategory: PhotoFissionChildrensCategory;
  mainImage: UploadedImage | null;
  frontDetailImages: UploadedImage[];
  sideDetailImages: UploadedImage[];
  backDetailImages: UploadedImage[];
  pantsMainHandVisibility: PantsMainHandVisibility;
  imageRatio: PhotoFissionImageRatio;
  resolution: PhotoFissionResolution;
  plannerReasoningEnabled: boolean;
  helperText: string;
  faceIdModels?: CompanyModel[];
  selectedFaceIdModel?: CompanyModel | null;
  faceMaskImage?: UploadedImage | null;
  isUploadingFaceMask?: boolean;
  onModelChange: (value: FashionModelId) => void;
  onCategoryChange: (value: PhotoFissionCategory) => void;
  onChildrensCategoryChange: (value: PhotoFissionChildrensCategory) => void;
  onMainUploaded: (image: UploadedImage) => void;
  onMainRemove: () => void;
  onFrontDetailUploaded: (index: number, image: UploadedImage) => void;
  onFrontDetailRemove: (index: number) => void;
  onSideDetailUploaded: (index: number, image: UploadedImage) => void;
  onSideDetailRemove: (index: number) => void;
  onBackDetailUploaded: (index: number, image: UploadedImage) => void;
  onBackDetailRemove: (index: number) => void;
  onPantsMainHandVisibilityChange: (value: PantsMainHandVisibility) => void;
  onSelectFaceIdModel?: (model: CompanyModel | null) => void;
  onOpenFaceIdLibrary?: () => void;
  onOpenFaceMaskPainter?: () => void;
  onClearFaceMask?: () => void;
  onImageRatioChange: (value: PhotoFissionImageRatio) => void;
  onResolutionChange: (value: PhotoFissionResolution) => void;
  resultCount: PhotoFissionResultCount;
  onResultCountChange: (value: PhotoFissionResultCount) => void;
  onPlannerReasoningEnabledChange: (value: boolean) => void;
}) {
  const isExtraRatio = PHOTO_FISSION_RATIOS_EXTRA.some(
    (option) => option.id === imageRatio,
  );
  const isPantsCategory = childrensCategory === "pants";
  const resultCountOptions = isPantsCategory
    ? PHOTO_FISSION_RESULT_COUNTS.filter((option) => option.id !== 9)
    : PHOTO_FISSION_RESULT_COUNTS;

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

      {isPantsCategory && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm text-foreground">主图露手</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              关闭时全批不写手部姿势，成图不出现手
            </p>
          </div>
          <Switch
            checked={pantsMainHandVisibility === "visible"}
            onCheckedChange={(checked) =>
              onPantsMainHandVisibilityChange(checked ? "visible" : "hidden")
            }
          />
        </div>
      )}

      <PhotoFissionDetailReferenceGroup
        angleLabel="正面"
        images={frontDetailImages}
        maxCount={isPantsCategory ? 2 : 1}
        onUploaded={onFrontDetailUploaded}
        onRemove={onFrontDetailRemove}
      />
      {isPantsCategory && (
        <PhotoFissionDetailReferenceGroup
          angleLabel="侧面"
          images={sideDetailImages}
          maxCount={2}
          onUploaded={onSideDetailUploaded}
          onRemove={onSideDetailRemove}
        />
      )}
      <PhotoFissionDetailReferenceGroup
        angleLabel="背面"
        images={backDetailImages}
        maxCount={isPantsCategory ? 2 : 1}
        onUploaded={onBackDetailUploaded}
        onRemove={onBackDetailRemove}
      />

      {!isPantsCategory && (
        <FaceIdModelSelect
          models={faceIdModels}
          selectedModel={selectedFaceIdModel}
          onSelectModel={onSelectFaceIdModel}
          onOpenLibrary={onOpenFaceIdLibrary}
        />
      )}

      {!isPantsCategory && selectedFaceIdModel && (
        <div className="rounded-lg border border-border bg-secondary p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-foreground">主图五官涂抹</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                手动涂抹主图眉眼鼻嘴区域，系统只按你的 mask 弱化原脸。
              </p>
              {faceMaskImage ? (
                <p className="mt-2 text-xs text-primary">已保存人脸 mask</p>
              ) : (
                <p className="mt-2 text-xs text-destructive">生图前必须先涂抹五官区域</p>
              )}
            </div>
            {faceMaskImage && (
              <img
                src={faceMaskImage.preview}
                alt=""
                className="h-12 w-12 rounded-md border border-border bg-white object-cover"
              />
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={!mainImage || isUploadingFaceMask}
              onClick={onOpenFaceMaskPainter}
              className="h-9 flex-1 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:border-primary/60 disabled:opacity-50"
            >
              {isUploadingFaceMask
                ? "正在保存..."
                : faceMaskImage
                  ? "重新涂抹"
                  : "涂抹五官区域"}
            </button>
            {faceMaskImage && (
              <button
                type="button"
                onClick={onClearFaceMask}
                className="h-9 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground hover:border-destructive/60 hover:text-destructive"
              >
                清除
              </button>
            )}
          </div>
        </div>
      )}

      <OptionSelector
        label="出图数量"
        required
        options={resultCountOptions}
        value={resultCount}
        onChange={onResultCountChange}
      />

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-secondary/55 p-3 transition-colors hover:border-primary/50">
        <input
          type="checkbox"
          checked={plannerReasoningEnabled}
          onChange={(event) =>
            onPlannerReasoningEnabledChange(event.target.checked)
          }
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            分镜推理模式
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
            开启后会让分镜 Planner 深度思考，画面策划更稳，但生成前等待时间会增加。
          </span>
        </span>
      </label>

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
        <span className="text-sm text-foreground">画质</span>
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
  return "2k";
}

function FaceIdModelSelect({
  models = [],
  selectedModel = null,
  onSelectModel = () => {},
  onOpenLibrary = () => {},
}: {
  models?: CompanyModel[];
  selectedModel?: CompanyModel | null;
  onSelectModel?: (model: CompanyModel | null) => void;
  onOpenLibrary?: () => void;
}) {
  const previewModels = Array.isArray(models) ? models.slice(0, 4) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="text-sm text-foreground">五官特征锁定（选填）</span>
      </div>

      <div className="rounded-lg border border-border bg-secondary p-3">
        {selectedModel ? (
          <div className="mb-3 flex items-center gap-3">
            <img
              src={selectedModel.preview}
              alt={selectedModel.name}
              className="w-12 h-12 rounded-md object-cover bg-white"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="truncate text-sm text-foreground">{selectedModel.name}</p>
                <button
                  type="button"
                  onClick={() => onSelectModel(null)}
                  className="text-xs text-destructive hover:underline"
                >
                  清除
                </button>
              </div>
              <p className="text-xs text-muted-foreground">已锁定此人像小卡的五官特征</p>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">
            上传并选择人像小卡（胸口以上），生图时将锁定其五官特征。
          </p>
        )}

        <div className="flex items-center gap-2">
          {previewModels.map((model) => {
            const isActive = selectedModel?.assetId === model.assetId;
            return (
              <button
                key={model.assetId}
                type="button"
                onClick={() => onSelectModel(isActive ? null : model)}
                className={cn(
                  'relative w-11 h-11 rounded-md overflow-hidden border bg-white',
                  isActive ? 'border-primary' : 'border-border',
                )}
              >
                <img src={model.preview} alt={model.name} className="w-full h-full object-cover" />
                {isActive && (
                  <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={onOpenLibrary}
            className="h-11 min-w-14 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            人像小卡
          </button>
        </div>
      </div>
    </div>
  );
}
