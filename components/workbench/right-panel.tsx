"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, getOssThumbnailUrl, validateUploadSize } from "@/lib/utils";
import { EnhancedImageTaskCard } from "./image-task-card";
import { FaceMaskPainterDialog } from "./face-mask-painter-dialog";
import {
  AI_FASHION_DEMO_TASKS,
  FASHION_MODELS,
  FASHION_PROMPT_MODES,
  FEATURE_LABELS,
  PHOTO_FISSION_CASES,
  POSE_FISSION_CASES,
  type AssetRecord,
  type CompanyModel,
  type FashionModelId,
  type FashionPromptMode,
  type FashionReferenceImage,
  type FeatureType,
  type GenerationTask,
  type PhotoFissionCase,
  type PhotoFissionParams,
  type PoseFissionCase,
  type PoseFissionParams,
  type ResultAsset,
  type ShotProgress,
  type TaskStatus,
} from "@/lib/types";

const favoritesStorageKey = "fashion_favorites";

interface ResultPreview {
  image: ResultAsset;
  task: GenerationTask;
}

type ResultGridItem =
  | { kind: "image"; image: ResultAsset; progress?: ShotProgress }
  | { kind: "progress"; progress: ShotProgress };

function isPantsFissionTask(task: GenerationTask): boolean {
  if (task.featureType !== "photo-fission") return false;
  const params = task.params as Partial<PhotoFissionParams>;
  return params.childrensCategory === "pants";
}

function getTaskResultGridItems(task: GenerationTask): ResultGridItem[] {
  // 任务取消/生成进度 UI 仅对裤子品类生效；连衣裙/套装/姿势裂变沿用旧行为（不显示进度卡）。
  const showProgress = isPantsFissionTask(task);
  const params = task.params as {
    shotPlan?: { shotId?: string }[];
    poseTemplateIds?: string[];
  };
  const resultsByShotId = new Map(
    task.results
      .filter((result) => result.shotId)
      .map((result) => [result.shotId as string, result]),
  );

  if (task.featureType === "photo-fission" && Array.isArray(params.shotPlan)) {
    const plannedItems = params.shotPlan.flatMap<ResultGridItem>((shot, index) => {
      const shotId = shot.shotId ?? `shot_${index + 1}`;
      const result = resultsByShotId.get(shotId);
      const progress = showProgress
        ? task.shotProgress?.find((item) => item.shotId === shotId)
        : undefined;
      if (result) return [{ kind: "image", image: result, progress }];
      if (progress) return [{ kind: "progress", progress }];
      return [];
    });
    const plannedIds = new Set(
      params.shotPlan.map((shot, index) => shot.shotId ?? `shot_${index + 1}`),
    );
    const extraResults = task.results
      .filter((result) => !result.shotId || !plannedIds.has(result.shotId))
      .map<ResultGridItem>((image) => ({ kind: "image", image }));
    return [...plannedItems, ...extraResults];
  }

  if (
    task.featureType === "pose-fission" &&
    Array.isArray(params.poseTemplateIds)
  ) {
    const plannedItems = params.poseTemplateIds.flatMap<ResultGridItem>(
      (templateId) => {
        const result = resultsByShotId.get(templateId);
        const progress = showProgress
          ? task.shotProgress?.find((item) => item.shotId === templateId)
          : undefined;
        if (result) return [{ kind: "image", image: result, progress }];
        if (progress) return [{ kind: "progress", progress }];
        return [];
      },
    );
    const plannedIds = new Set(params.poseTemplateIds);
    const extraResults = task.results
      .filter((result) => !result.shotId || !plannedIds.has(result.shotId))
      .map<ResultGridItem>((image) => ({ kind: "image", image }));
    return [...plannedItems, ...extraResults];
  }

  return task.results.map<ResultGridItem>((image) => ({ kind: "image", image }));
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

interface RightPanelProps {
  feature: FeatureType;
  activeTask: GenerationTask | null;
  tasks: GenerationTask[];
  tasksLoading?: boolean;
  companyModels: CompanyModel[];
  fashionReferences: FashionReferenceImage[];
  companyModelLibraryRequestKey: number;
  faceIdModels: CompanyModel[];
  faceIdLibraryRequestKey: number;
  selectedFaceIdModel: CompanyModel | null;
  onAddCompanyModel: (model: CompanyModel) => void;
  onDeleteCompanyModel: (assetId: string) => void;
  onRenameCompanyModel: (assetId: string, name: string) => void;
  onAddFaceIdModel: (model: CompanyModel) => void;
  onDeleteFaceIdModel: (assetId: string) => void;
  onRenameFaceIdModel: (assetId: string, name: string) => void;
  onSelectFaceIdModel: (model: CompanyModel | null) => void;
  onAddFashionReference: (reference: FashionReferenceImage) => void;
  onUseTaskAsFashionReference: (task: GenerationTask) => void;
  onSelectPoseFissionCase: (poseFissionCase: PoseFissionCase) => void;
  onSelectPhotoFissionCase: (photoFissionCase: PhotoFissionCase) => void;
  onSelectTask: (taskId: string) => void;
  onRefreshTasks: () => void;
  onCancelTask: (taskId: string) => Promise<void>;
  onDeleteTaskResult: (taskId: string, assetId: string) => Promise<void>;
}

export function RightPanel({
  feature,
  activeTask,
  tasks,
  tasksLoading,
  companyModels,
  fashionReferences,
  companyModelLibraryRequestKey,
  faceIdModels,
  faceIdLibraryRequestKey,
  selectedFaceIdModel,
  onAddCompanyModel,
  onDeleteCompanyModel,
  onRenameCompanyModel,
  onAddFaceIdModel,
  onDeleteFaceIdModel,
  onRenameFaceIdModel,
  onSelectFaceIdModel,
  onAddFashionReference,
  onUseTaskAsFashionReference,
  onSelectPoseFissionCase,
  onSelectPhotoFissionCase,
  onSelectTask,
  onRefreshTasks,
  onCancelTask,
  onDeleteTaskResult,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<
    "current" | "history" | "cases" | "my-model-library" | "my-id-photo-library"
  >("current");
  const [previewResult, setPreviewResult] = useState<ResultPreview | null>(
    null,
  );
  const [faceRefineTarget, setFaceRefineTarget] = useState<ResultPreview | null>(
    null,
  );
  const [isFaceVariantRunning, setIsFaceVariantRunning] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);
  const [onlyCurrentFeature, setOnlyCurrentFeature] = useState(true);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [poseCases, setPoseCases] = useState<PoseFissionCase[]>(POSE_FISSION_CASES);
  const [photoFissionCases, setPhotoFissionCases] =
    useState<PhotoFissionCase[]>(PHOTO_FISSION_CASES);
  const [sameStyleTaskId, setSameStyleTaskId] = useState<string | null>(null);
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<
    Map<string, { url: string; downloadUrl: string }>
  >(new Map());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(favoritesStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setFavorites(
            new Set(
              parsed.filter((id): id is string => typeof id === "string"),
            ),
          );
        }
      }
    } catch {
      // ignore unreadable storage
    } finally {
      setFavoritesHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!favoritesHydrated) return;
    try {
      window.localStorage.setItem(
        favoritesStorageKey,
        JSON.stringify(Array.from(favorites)),
      );
    } catch {
      // ignore quota errors
    }
  }, [favorites, favoritesHydrated]);

  // 首次加载后把 localStorage 里的历史收藏一次性同步到服务端，
  // 避免自动清理误删用户已收藏但服务端未记录的老图。本次会话只同步一次。
  const historyFavoritesSyncedRef = useRef(false);
  useEffect(() => {
    if (!favoritesHydrated) return;
    if (historyFavoritesSyncedRef.current) return;
    const ids = Array.from(favorites);
    if (ids.length === 0) return;
    historyFavoritesSyncedRef.current = true;
    fetch("/api/assets/favorites/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: ids }),
    }).catch(() => {
      // best-effort：同步失败时允许下次加载重试
      historyFavoritesSyncedRef.current = false;
    });
  }, [favoritesHydrated, favorites]);

  const handleToggleFavorite = useCallback((assetId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      const willFavorite = !next.has(assetId);
      if (willFavorite) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      // fire-and-forget server sync
      fetch(`/api/assets/${encodeURIComponent(assetId)}/favorite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorited: willFavorite }),
      }).catch(() => {
        // best-effort: localStorage 仍保留本地状态
      });
      return next;
    });
  }, []);

  const isPoseFission = feature === "pose-fission";
  const isAiFashionPhoto = feature === "ai-fashion-photo";
  const isPhotoFission = feature === "photo-fission";

  const currentFeatureTasks = useMemo(
    () => tasks.filter((task) => task.featureType === feature),
    [feature, tasks],
  );

  const aiFashionGalleryItems = useMemo(
    () => [
      ...currentFeatureTasks.flatMap((task) =>
        task.results.map((image) => ({
          image,
          task,
        })),
      ),
      // MVP 演示用：把 yibaiaigc 友商图作为"历史精选"追加到瀑布流末尾。
      // 仅 ai-fashion-photo 功能下注入；不污染 task-store，刷新页面不消失。
      // 上线前必须替换为本平台真实生成的素材。
      ...(isAiFashionPhoto
        ? AI_FASHION_DEMO_TASKS.flatMap((task) =>
            task.results.map((image) => ({
              image,
              task,
            })),
          )
        : []),
    ],
    [currentFeatureTasks, isAiFashionPhoto],
  );

  const visibleTask =
    activeTab === "current"
      ? activeTask
      : (currentFeatureTasks[0] ?? activeTask);
  const visibleTaskGridItems = visibleTask
    ? getTaskResultGridItems(visibleTask)
    : [];
  const showHistoryLiveTask =
    activeTab === "history" &&
    visibleTask &&
    isPantsFissionTask(visibleTask) &&
    (visibleTask.status === "pending" || visibleTask.status === "running");

  useEffect(() => {
    if (isPoseFission) {
      setActiveTab("cases");
    } else if (isPhotoFission) {
      // photo-fission 默认进历史记录，正在跑的 task 在这里能看到进度；
      // 案例库由用户主动点击切换。
      setActiveTab("history");
    } else {
      setActiveTab("current");
    }
  }, [isPoseFission, isPhotoFission]);

  useEffect(() => {
    if (feature === "ai-fashion-photo" && companyModelLibraryRequestKey > 0) {
      setActiveTab("my-model-library");
    }
  }, [companyModelLibraryRequestKey, feature]);

  useEffect(() => {
    if (feature === "photo-fission" && faceIdLibraryRequestKey > 0) {
      setActiveTab("my-id-photo-library");
    }
  }, [faceIdLibraryRequestKey, feature]);

  useEffect(() => {
    if (!isPoseFission) return;

    let ignore = false;

    async function loadPoseCases() {
      const response = await fetch("/api/pose-fission/cases", {
        cache: "no-store",
      });
      if (!response.ok) return;

      const data = (await response.json()) as { cases: PoseFissionCase[] };
      if (!ignore) setPoseCases(data.cases);
    }

    void loadPoseCases();

    return () => {
      ignore = true;
    };
  }, [isPoseFission]);

  useEffect(() => {
    if (!isPhotoFission) return;

    let ignore = false;

    async function loadPhotoFissionCases() {
      const response = await fetch("/api/photo-fission/cases", {
        cache: "no-store",
      });
      if (!response.ok) return;

      const data = (await response.json()) as { cases: PhotoFissionCase[] };
      if (!ignore) setPhotoFissionCases(data.cases);
    }

    void loadPhotoFissionCases();

    return () => {
      ignore = true;
    };
  }, [isPhotoFission]);

  const handleBatchDownload = async () => {
    if (!visibleTask) return;
    const response = await fetch(`/api/tasks/${visibleTask.taskId}/download`, {
      method: "POST",
    });

    if (!response.ok) return;

    const data = (await response.json()) as { downloadUrl: string };
    if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
  };

  // R5：photo-fission 重跑失败镜头 / PR4：pose-fission 重跑失败姿势。
  // 两个 feature 的 retry 路由前缀和 body 字段名不同（shotIds vs templateIds），
  // 但 RightPanel 的按钮交互保持一致（沿用 photo-fission 视觉与 loading 模式）。
  const handleRetryShots = async (
    task: GenerationTask,
    shotIds: string[],
  ) => {
    const isPoseFissionTask = task.featureType === "pose-fission";
    const endpoint = isPoseFissionTask
      ? `/api/pose-fission/tasks/${task.taskId}/retry`
      : `/api/tasks/${task.taskId}/retry-shots`;
    const body = isPoseFissionTask
      ? { templateIds: shotIds }
      : { shotIds };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(data.error ?? `重跑失败：HTTP ${response.status}`);
    }
    onRefreshTasks();
  };

  const handleUseSameStyle = (task: GenerationTask) => {
    onUseTaskAsFashionReference(task);
    setSameStyleTaskId(task.taskId);
    window.setTimeout(() => {
      setSameStyleTaskId((currentTaskId) =>
        currentTaskId === task.taskId ? null : currentTaskId,
      );
    }, 1600);
  };

  // 在 AI 服装大片瀑布流里删某张「效果不好」的生成图。
  // 走 confirm 二次确认；删除后由父组件统一更新 tasks 列表。
  const handleDeleteResult = async (taskId: string, assetId: string) => {
    const ok = window.confirm("确定删除这张图吗？删除后无法恢复。");
    if (!ok) return false;
    try {
      await onDeleteTaskResult(taskId, assetId);
      // 如果当前预览框正好预览这张图，关闭预览
      setPreviewResult((current) =>
        current?.image.assetId === assetId ? null : current,
      );
      return true;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除失败");
      return false;
    }
  };

  const uploadFaceRefineMask = async (
    maskDataUrl: string,
    image: ResultAsset,
  ) => {
    const blob = await (await fetch(maskDataUrl)).blob();
    const formData = new FormData();
    formData.append(
      "file",
      new File([blob], `face-refine-mask-${Date.now()}.png`, {
        type: "image/png",
      }),
    );
    formData.append("width", String(image.width));
    formData.append("height", String(image.height));
    const response = await fetch("/api/assets/upload", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(data.error ?? `上传重修 mask 失败：HTTP ${response.status}`);
    }
    const data = (await response.json()) as { assetId: string };
    return data.assetId;
  };

  const openFaceRefine = (task: GenerationTask, image: ResultAsset) => {
    setPreviewResult(null);
    setFaceRefineTarget({ image, task });
  };

  const handleRegenerateShot = async (
    task: GenerationTask,
    image: ResultAsset,
  ) => {
    if (!image.shotId) {
      window.alert("这张图没有 shotId，无法单张重生");
      return;
    }
    setIsFaceVariantRunning(true);
    try {
      const response = await fetch(`/api/tasks/${task.taskId}/regenerate-shot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shotId: image.shotId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `重生失败：HTTP ${response.status}`);
      }
      onRefreshTasks();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "重生失败");
    } finally {
      setIsFaceVariantRunning(false);
    }
  };

  const handleFaceRefineComplete = async (maskDataUrl: string) => {
    const target = faceRefineTarget;
    if (!target) return;
    setIsFaceVariantRunning(true);
    try {
      const maskAssetId = await uploadFaceRefineMask(maskDataUrl, target.image);
      const response = await fetch(
        `/api/tasks/${target.task.taskId}/refine-face`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assetId: target.image.assetId,
            maskAssetId,
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `重修脸失败：HTTP ${response.status}`);
      }
      setFaceRefineTarget(null);
      setPreviewResult(null);
      onRefreshTasks();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "重修脸失败");
    } finally {
      setIsFaceVariantRunning(false);
    }
  };

  // 软隐藏 photo-fission 整个案例。本地 state 同步过滤，避免等下次 reload。
  const handleDeletePhotoFissionCase = async (caseId: string) => {
    const ok = window.confirm("确定删除整个案例吗？");
    if (!ok) return;
    const response = await fetch(`/api/photo-fission/cases/${caseId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      window.alert(data.error ?? `删除失败：HTTP ${response.status}`);
      return;
    }
    setPhotoFissionCases((current) =>
      current.filter((item) => item.id !== caseId),
    );
  };

  // 软隐藏 photo-fission 案例中的某张 shot。前端从 resultImageUrls / shotLabels
  // 中按 URL 同步过滤；后端按 URL 反查原始下标做隐藏。
  const handleDeletePhotoFissionShot = async (
    caseId: string,
    shotUrl: string,
  ) => {
    const ok = window.confirm("确定删除这张镜头图吗？");
    if (!ok) return;
    const response = await fetch(
      `/api/photo-fission/cases/${caseId}/shots`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shotUrl }),
      },
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      window.alert(data.error ?? `删除失败：HTTP ${response.status}`);
      return;
    }
    setPhotoFissionCases((current) =>
      current.map((item) => {
        if (item.id !== caseId) return item;
        const filteredUrls: string[] = [];
        const filteredLabels: string[] = [];
        for (let index = 0; index < item.resultImageUrls.length; index += 1) {
          const url = item.resultImageUrls[index];
          if (url === shotUrl) continue;
          filteredUrls.push(url);
          filteredLabels.push(item.shotLabels[index] ?? `镜头 ${index + 1}`);
        }
        return {
          ...item,
          resultImageUrls: filteredUrls,
          shotLabels: filteredLabels,
        };
      }),
    );
  };

  const toggleBatchSelectMode = () => {
    setBatchSelectMode((current) => {
      if (current) setSelectedAssets(new Map());
      return !current;
    });
  };

  const toggleImageSelection = (
    assetId: string,
    url: string,
    downloadUrl: string,
  ) => {
    setSelectedAssets((current) => {
      const next = new Map(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.set(assetId, { url, downloadUrl });
      }
      return next;
    });
  };

  const downloadSelectedImages = async () => {
    const entries = Array.from(selectedAssets.entries());
    if (!entries.length) return;
    for (const [assetId, { downloadUrl }] of entries) {
      try {
        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${assetId}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      } catch {
        window.open(downloadUrl, "_blank");
      }
    }
    setBatchSelectMode(false);
    setSelectedAssets(new Map());
  };

  if (activeTab === "my-model-library") {
    const referencedModelIds = new Set(
      fashionReferences
        .filter((reference) => reference.source === "model")
        .map((reference) => reference.modelId ?? reference.assetId),
    );

    return (
      <section className="flex min-h-screen flex-1 flex-col bg-background">
        <MyModelLibraryPanel
          models={companyModels}
          referencedModelIds={referencedModelIds}
          referencedCount={fashionReferences.length}
          onAddModel={onAddCompanyModel}
          onDeleteModel={onDeleteCompanyModel}
          onRenameModel={onRenameCompanyModel}
          onCancel={() => setActiveTab("current")}
          onClose={() => setActiveTab("current")}
          onConfirm={(models) => {
            for (const model of models) {
              onAddFashionReference({
                assetId: model.assetId,
                source: "model",
                preview: model.preview,
                name: model.name,
                width: model.width,
                height: model.height,
                modelId: model.assetId,
              });
            }
            setActiveTab("current");
          }}
        />
      </section>
    );
  }

  if (activeTab === "my-id-photo-library") {
    return (
      <section className="flex min-h-screen flex-1 flex-col bg-background">
        <MyFaceIdLibraryPanel
          models={faceIdModels}
          selectedModelId={selectedFaceIdModel?.assetId ?? null}
          onAddModel={onAddFaceIdModel}
          onDeleteModel={onDeleteFaceIdModel}
          onRenameModel={onRenameFaceIdModel}
          onClose={() => setActiveTab("history")}
          onConfirm={(model) => {
            onSelectFaceIdModel(model);
            setActiveTab("history");
          }}
        />
      </section>
    );
  }

  return (
    <section className="flex-1 min-h-screen bg-transparent flex flex-col">
      <header className="flex items-center justify-between gap-4 p-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-secondary rounded-md p-1 border border-border">
            <button
              onClick={() => setActiveTab("history")}
              className={cn(
                "px-4 py-1 text-[12px] font-medium rounded-sm transition-all border border-transparent",
                activeTab === "history"
                  ? "bg-primary/20 text-accent-foreground shadow-[0_0_8px_rgba(0,163,255,0.2)] border-primary/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              历史记录
            </button>
            {!isPoseFission && !isPhotoFission && (
              <button
                onClick={() => setActiveTab("current")}
                className={cn(
                  "px-4 py-1 text-[12px] font-medium rounded-sm transition-all border border-transparent",
                  activeTab === "current"
                    ? "bg-primary/20 text-accent-foreground shadow-[0_0_8px_rgba(0,163,255,0.2)] border-primary/30"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {isAiFashionPhoto ? "案例库" : "当前任务"}
              </button>
            )}
            {(isPoseFission || isPhotoFission) && (
              <button
                onClick={() => setActiveTab("cases")}
                className={cn(
                  "px-4 py-1 text-[12px] font-medium rounded-sm transition-all border border-transparent",
                  activeTab === "cases"
                    ? "bg-primary/20 text-accent-foreground shadow-[0_0_8px_rgba(0,163,255,0.2)] border-primary/30"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                案例库
              </button>
            )}
          </div>

          {isAiFashionPhoto && activeTab === "current" && (
            <div className="flex items-center gap-4 pl-4 text-sm text-foreground">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyCurrentFeature}
                  onChange={(event) =>
                    setOnlyCurrentFeature(event.target.checked)
                  }
                  className="h-4 w-4 accent-primary"
                />
                仅看当前功能
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyFavorites}
                  onChange={(event) => setOnlyFavorites(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                仅看收藏
              </label>
            </div>
          )}

          <button
            onClick={onRefreshTasks}
            className="w-8 h-8 rounded-md border border-border bg-transparent flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-soft transition-colors"
            aria-label="刷新任务"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {activeTab === "history" && (
            <button
              onClick={toggleBatchSelectMode}
              className={cn(
                "h-8 px-3 rounded-md border text-[12px] font-medium flex items-center gap-1.5 transition-colors",
                batchSelectMode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-soft",
              )}
            >
              <Download className="w-3.5 h-3.5" />
              {batchSelectMode ? "取消选择" : "批量下载"}
            </button>
          )}
        </div>
      </header>

      {isPoseFission && activeTab === "cases" ? (
        <PoseFissionCaseLibrary
          cases={poseCases}
          onSelectCase={onSelectPoseFissionCase}
        />
      ) : isPhotoFission && activeTab === "cases" ? (
        <PhotoFissionCaseLibrary
          cases={photoFissionCases}
          onSelectCase={onSelectPhotoFissionCase}
          onDeleteCase={handleDeletePhotoFissionCase}
          onDeleteShot={handleDeletePhotoFissionShot}
        />
      ) : activeTab === "history" ? (
        <TaskHistory
          tasks={currentFeatureTasks}
          tasksLoading={tasksLoading}
          topContent={
            showHistoryLiveTask && visibleTask ? (
              <LiveTaskProgressPanel
                task={visibleTask}
                gridItems={visibleTaskGridItems}
                favorites={favorites}
                isFaceVariantRunning={isFaceVariantRunning}
                onBatchDownload={handleBatchDownload}
                onRetryShots={handleRetryShots}
                onCancelTask={onCancelTask}
                onPreviewImage={(image) =>
                  setPreviewResult({ image, task: visibleTask })
                }
                onToggleFavorite={handleToggleFavorite}
                onRefineFace={(image) => openFaceRefine(visibleTask, image)}
                onRegenerate={(image) => handleRegenerateShot(visibleTask, image)}
                onDelete={(image) =>
                  void handleDeleteResult(visibleTask.taskId, image.assetId)
                }
              />
            ) : null
          }
          activeTaskId={activeTask?.taskId}
          favorites={favorites}
          batchSelectMode={batchSelectMode}
          selectedAssetIds={selectedAssets}
          onSelectTask={onSelectTask}
          onToggleFavorite={handleToggleFavorite}
          onPreviewImage={(image, task) => setPreviewResult({ image, task })}
          onToggleImageSelection={(assetId, url, downloadUrl) =>
            toggleImageSelection(assetId, url, downloadUrl)
          }
        />
      ) : isAiFashionPhoto ? (
        <AiFashionMasonryGallery
          items={aiFashionGalleryItems}
          activeTask={
            activeTask?.featureType === "ai-fashion-photo" ? activeTask : null
          }
          favorites={favorites}
          onlyFavorites={onlyFavorites}
          sameStyleTaskId={sameStyleTaskId}
          onBatchDownload={handleBatchDownload}
          onPreviewImage={(image, task) => setPreviewResult({ image, task })}
          onUseSameStyle={handleUseSameStyle}
          onDeleteResult={handleDeleteResult}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          {visibleTask ? (
            <div className="space-y-5">
              <TaskStatusCard
                task={visibleTask}
                onBatchDownload={handleBatchDownload}
                onRetryShots={handleRetryShots}
                onCancelTask={onCancelTask}
              />

              {visibleTaskGridItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {visibleTaskGridItems.map((item) => {
                    if (item.kind === "progress") {
                      return (
                        <ResultProgressCard
                          key={item.progress.shotId}
                          progress={item.progress}
                        />
                      );
                    }

                    const image = item.image;
                    const isFavorite = favorites.has(image.assetId);
                    const canUseFaceActions =
                      visibleTask.featureType === "photo-fission" &&
                      Boolean((visibleTask.params as PhotoFissionParams).faceIdModelId);

                    return (
                      <ResultImageCard
                        key={image.assetId}
                        image={image}
                        isFavorite={isFavorite}
                        canRefineFace={canUseFaceActions}
                        canRegenerate={visibleTask.featureType === "photo-fission"}
                        actionDisabled={isFaceVariantRunning}
                        onClick={() => setPreviewResult({ image, task: visibleTask })}
                        onToggleFavorite={() => {
                          handleToggleFavorite(image.assetId);
                        }}
                        onRefineFace={() =>
                          openFaceRefine(visibleTask, image)
                        }
                        onRegenerate={() => handleRegenerateShot(visibleTask, image)}
                        onDelete={() => handleDeleteResult(visibleTask.taskId, image.assetId)}
                      />
                    );
                  })}
                </div>
              ) : (
                <EmptyResults status={visibleTask.status} />
              )}
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      )}

      <Dialog
        open={!!previewResult}
        onOpenChange={() => setPreviewResult(null)}
      >
        <DialogContent
          showCloseButton={false}
          className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border-0 bg-background p-0 sm:max-w-none"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">生成详情</DialogTitle>
          {previewResult && (
            <GenerationDetailDialog
              preview={previewResult}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              onSelectPreview={(image, task) =>
                setPreviewResult({ image, task })
              }
              onUseSameStyle={handleUseSameStyle}
              isFaceVariantRunning={isFaceVariantRunning}
              onRefineFace={(image, task) => openFaceRefine(task, image)}
              onRegenerateShot={(task, image) =>
                handleRegenerateShot(task, image)
              }
              onDeleteResult={(task, image) => {
                void handleDeleteResult(task.taskId, image.assetId);
              }}
              onClose={() => setPreviewResult(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {faceRefineTarget && (
        <FaceMaskPainterDialog
          open={!!faceRefineTarget}
          title="涂抹需要重修的人脸区域"
          imageUrl={faceRefineTarget.image.url}
          imageWidth={faceRefineTarget.image.width}
          imageHeight={faceRefineTarget.image.height}
          onOpenChange={(open) => {
            if (!open && !isFaceVariantRunning) setFaceRefineTarget(null);
          }}
          onComplete={handleFaceRefineComplete}
        />
      )}

      {batchSelectMode && selectedAssets.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-border bg-card px-5 py-3 shadow-lg">
          <span className="text-sm text-foreground">
            已选 <span className="font-semibold text-primary">{selectedAssets.size}</span> 张
          </span>
          <button
            onClick={downloadSelectedImages}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Download className="w-4 h-4" />
            下载选中
          </button>
          <button
            onClick={() => {
              setSelectedAssets(new Map());
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            清空选择
          </button>
        </div>
      )}
    </section>
  );
}

function ResultImageCard({
  image,
  isFavorite,
  canRefineFace,
  canRegenerate,
  actionDisabled,
  onClick,
  onToggleFavorite,
  onRefineFace,
  onRegenerate,
  onDelete,
}: {
  image: ResultAsset;
  isFavorite: boolean;
  canRefineFace: boolean;
  canRegenerate: boolean;
  actionDisabled: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
  onRefineFace: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className="group relative aspect-[3/4] overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/60"
    >
      <img src={getOssThumbnailUrl(image.url)} alt="" className="h-full w-full object-cover" />
      <div className="absolute right-2 top-2 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60"
          aria-label={isFavorite ? "取消收藏" : "收藏"}
        >
          <Star
            className={cn(
              "h-4 w-4",
              isFavorite ? "fill-yellow-400 text-yellow-400" : "text-white/80",
            )}
          />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            window.open(image.downloadUrl, "_blank");
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60"
          aria-label="下载"
        >
          <Download className="h-4 w-4 text-white/80" />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="grid grid-cols-2 gap-1.5">
          {canRefineFace && (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onRefineFace();
              }}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-white/35 bg-black/45 px-2 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              重修脸
            </button>
          )}
          {canRegenerate && (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onRegenerate();
              }}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-white/35 bg-black/45 px-2 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重生
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={actionDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-white/25 bg-black/45 px-2 text-xs font-medium text-white hover:bg-red-500/80 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>
    </div>
  );
}

function AiFashionMasonryGallery({
  items,
  activeTask,
  favorites,
  onlyFavorites,
  sameStyleTaskId,
  onBatchDownload,
  onPreviewImage,
  onUseSameStyle,
  onDeleteResult,
  onToggleFavorite,
}: {
  items: ResultPreview[];
  activeTask: GenerationTask | null;
  favorites: Set<string>;
  onlyFavorites: boolean;
  sameStyleTaskId: string | null;
  onBatchDownload: () => void;
  onPreviewImage: (image: ResultAsset, task: GenerationTask) => void;
  onUseSameStyle: (task: GenerationTask) => void;
  onDeleteResult: (taskId: string, assetId: string) => void;
  onToggleFavorite: (assetId: string) => void;
}) {
  const visibleItems = onlyFavorites
    ? items.filter(({ image }) => favorites.has(image.assetId))
    : items;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="space-y-5">
        {activeTask && (
          <TaskStatusCard task={activeTask} onBatchDownload={onBatchDownload} />
        )}

        {visibleItems.length > 0 ? (
          <div className="columns-2 lg:columns-3 xl:columns-4 gap-2">
            {visibleItems.map(({ image, task }) => {
              const isFavorite = favorites.has(image.assetId);
              const isSameStyleDone = sameStyleTaskId === task.taskId;
              const canUseSameStyle = Boolean(task.inputAssets?.length);

              return (
                <div
                  key={`${task.taskId}-${image.assetId}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPreviewImage(image, task)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPreviewImage(image, task);
                    }
                  }}
                  className="group relative overflow-hidden glass-card glass-card-hover break-inside-avoid mb-2 inline-block w-full text-left"
                >
                  <img
                    src={getOssThumbnailUrl(image.url)}
                    alt=""
                    className="w-full h-auto block bg-secondary"
                  />

                  <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-lg bg-white/85 backdrop-blur-md border border-sky-100/80 px-2 py-0.5 text-[10px] font-semibold text-sky-700 shadow-xs z-10">
                    <ImageIcon className="h-3 w-3 text-sky-500" />
                    AI服装大片
                  </span>

                  <div className="absolute right-2 top-2 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFavorite(image.assetId);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60"
                      aria-label={isFavorite ? "取消收藏" : "收藏"}
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          isFavorite
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-white/80",
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        window.open(image.downloadUrl, "_blank");
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60"
                      aria-label="下载"
                    >
                      <Download className="h-4 w-4 text-white/80" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteResult(task.taskId, image.assetId);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 hover:bg-red-500/80"
                      aria-label="删除"
                      title="删除这张图（无法恢复）"
                    >
                      <Trash2 className="h-4 w-4 text-white/80" />
                    </button>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={!canUseSameStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (canUseSameStyle) onUseSameStyle(task);
                      }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/40 bg-black/40 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:border-transparent disabled:text-white/50"
                      title={
                        canUseSameStyle
                          ? "带入本次参考图和提示词"
                          : "旧任务没有参考图详情"
                      }
                    >
                      <Sparkles className="h-4 w-4" />
                      {isSameStyleDone ? "已带入" : "做同款"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="min-h-[520px] rounded-md border border-dashed border-border bg-transparent flex flex-col items-center justify-center text-center p-8 mx-4 my-8">
            <div className="w-12 h-12 rounded-md bg-white/[0.03] border border-border flex items-center justify-center mb-4">
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium text-foreground">
              {onlyFavorites ? "暂无收藏案例" : "暂无生成案例"}
            </p>
            <p className="mt-2 max-w-[420px] text-[12px] text-muted-foreground leading-relaxed">
              {onlyFavorites
                ? "取消「仅看收藏」后可以查看全部 AI 服装大片结果。"
                : "生成成功后的图片会在这里以瀑布流展示，点击图片查看详情，悬停可做同款。"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function GenerationDetailDialog({
  preview,
  favorites,
  onToggleFavorite,
  onSelectPreview,
  onUseSameStyle,
  isFaceVariantRunning,
  onRefineFace,
  onRegenerateShot,
  onDeleteResult,
  onClose,
}: {
  preview: ResultPreview;
  favorites: Set<string>;
  onToggleFavorite: (assetId: string) => void;
  onSelectPreview: (image: ResultAsset, task: GenerationTask) => void;
  onUseSameStyle: (task: GenerationTask) => void;
  isFaceVariantRunning: boolean;
  onRefineFace: (image: ResultAsset, task: GenerationTask) => void;
  onRegenerateShot: (task: GenerationTask, image: ResultAsset) => void;
  onDeleteResult: (task: GenerationTask, image: ResultAsset) => void;
  onClose: () => void;
}) {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const { image, task } = preview;
  const isFavorite = favorites.has(image.assetId);
  const rawParams = task.params as {
    prompt?: string;
    userPrompt?: string;
    finalPrompt?: string;
    promptMode?: FashionPromptMode;
    model?: FashionModelId;
  };
  const isPhotoFission = task.featureType === "photo-fission";
  const photoFissionPromptBundle = isPhotoFission
    ? buildPhotoFissionPromptBundle(task)
    : null;
  // photo-fission：详情区主显示当前预览图的 finalPrompt（如有），降级到 shotPlan 拼接。
  // 旧 v1 任务可能还残留 userPrompt 字段，宽松读取以保持向后兼容。
  const photoFissionLegacyUserPrompt = isPhotoFission
    ? readLegacyString(
        (task.params as unknown as Record<string, unknown>).userPrompt,
      )
    : "";
  const displayPrompt = isPhotoFission
    ? (image.finalPrompt ??
      photoFissionPromptBundle ??
      photoFissionLegacyUserPrompt)
    : (rawParams.userPrompt ?? rawParams.prompt ?? "");
  const finalPromptText = rawParams.finalPrompt ?? "";
  const hasFinalPromptDiff =
    task.featureType === "ai-fashion-photo" &&
    finalPromptText.trim().length > 0 &&
    finalPromptText !== displayPrompt;
  const promptToShow =
    showFullPrompt && hasFinalPromptDiff ? finalPromptText : displayPrompt;
  const modelMeta = rawParams.model
    ? FASHION_MODELS.find((option) => option.id === rawParams.model)
    : undefined;
  const promptModeMeta = rawParams.promptMode
    ? FASHION_PROMPT_MODES.find((option) => option.id === rawParams.promptMode)
    : undefined;
  const canUseSameStyle =
    task.featureType === "ai-fashion-photo" &&
    Boolean(task.inputAssets?.length);
  const canUseFaceActions =
    isPhotoFission && Boolean((task.params as PhotoFissionParams).faceIdModelId);
  const canRegenerateShot = isPhotoFission && Boolean(image.shotId);
  const resultImages = task.results.length > 0 ? task.results : [image];
  const copyContent = isPhotoFission
    ? (photoFissionPromptBundle ?? "")
    : displayPrompt;
  const copyLabel = isPhotoFission ? "复制全部 Prompt" : "复制提示词";

  const copyPrompt = async () => {
    if (!copyContent) return;
    try {
      await navigator.clipboard.writeText(copyContent);
    } catch {
      // ignore clipboard permission failures
    }
  };

  return (
    <div className="grid h-[100dvh] min-h-0 grid-cols-[minmax(0,1fr)_360px_72px] bg-background text-foreground">
      <div className="relative min-h-0 overflow-hidden bg-[#111315]">
        <div className="flex h-full items-center justify-center px-8 py-10">
          <img
            src={image.url}
            alt=""
            className="max-h-[calc(100dvh-104px)] max-w-full rounded-sm object-contain"
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-background/80 to-transparent px-6 py-5">
          <span className="rounded-full bg-black/50 px-3 py-1 text-sm text-white/80">
            {image.width} x{image.height}
          </span>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col border-l border-border bg-background">
        <div className="flex items-start justify-between gap-4 px-5 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <ImageIcon className="h-4 w-4" />
              </span>
              <h3 className="truncate text-2xl font-semibold">
                {FEATURE_LABELS[task.featureType]}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 border-b border-border px-5 pb-4">
          <button
            type="button"
            onClick={() => onToggleFavorite(image.assetId)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card hover:border-primary/60"
            aria-label={isFavorite ? "取消收藏" : "收藏"}
          >
            <Star
              className={cn(
                "h-4 w-4",
                isFavorite
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground",
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => window.open(image.downloadUrl, "_blank")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card hover:border-primary/60"
            aria-label="下载"
          >
            <Download className="h-4 w-4" />
          </button>
          {task.featureType === "ai-fashion-photo" && (
            <button
              type="button"
              disabled={!canUseSameStyle}
              onClick={() => {
                onUseSameStyle(task);
                onClose();
              }}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-card disabled:text-muted-foreground"
              title={
                canUseSameStyle
                  ? "带入本次参考图和提示词"
                  : "旧任务没有参考图详情"
              }
            >
              <Sparkles className="h-4 w-4" />
              做同款
            </button>
          )}
          {canUseFaceActions && (
            <button
              type="button"
              disabled={isFaceVariantRunning}
              onClick={() => onRefineFace(image, task)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-card disabled:text-muted-foreground"
            >
              <Pencil className="h-4 w-4" />
              重修脸
            </button>
          )}
          {canRegenerateShot && (
            <button
              type="button"
              disabled={isFaceVariantRunning}
              onClick={() => onRegenerateShot(task, image)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              重生
            </button>
          )}
          {isPhotoFission && (
            <button
              type="button"
              disabled={isFaceVariantRunning}
              onClick={() => onDeleteResult(task, image)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:border-destructive/70 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={task.status} />
                {modelMeta && (
                  <span className="rounded-full border border-blue-400/40 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                    {modelMeta.label}
                  </span>
                )}
                {promptModeMeta && (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      rawParams.promptMode === "raw"
                        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                        : "border-primary/40 bg-primary/10 text-primary",
                    )}
                  >
                    {promptModeMeta.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(task.createdAt).toLocaleString("zh-CN")} ·{" "}
                {task.inputAssetIds.length} 张参考图
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">提示词</p>
                {copyContent && (
                  <button
                    type="button"
                    onClick={copyPrompt}
                    className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
                  >
                    {copyLabel}
                  </button>
                )}
              </div>
              {promptToShow ? (
                <p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-card p-3 text-sm leading-relaxed text-muted-foreground">
                  {promptToShow}
                </p>
              ) : (
                <p className="rounded-md bg-card p-3 text-sm text-muted-foreground">
                  无提示词记录
                </p>
              )}
              {hasFinalPromptDiff && (
                <button
                  type="button"
                  onClick={() => setShowFullPrompt((current) => !current)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {showFullPrompt ? "显示用户提示词" : "查看实际发送 Prompt"}
                </button>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">本次参考图</p>
              {task.inputAssets?.length ? (
                <div className="grid grid-cols-4 gap-2">
                  {task.inputAssets.map((asset, index) => (
                    <ReferenceAssetThumb
                      key={asset.assetId}
                      asset={asset}
                      index={index}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  旧任务没有参考图详情记录
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>

      <aside className="min-h-0 overflow-y-auto border-l border-border bg-background px-2 py-5">
        <div className="space-y-2">
          {resultImages.map((resultImage) => {
            const isActive = resultImage.assetId === image.assetId;

            return (
              <button
                key={resultImage.assetId}
                type="button"
                onClick={() => onSelectPreview(resultImage, task)}
                className={cn(
                  "relative aspect-[3/4] w-full overflow-hidden rounded-md border bg-card transition-colors",
                  isActive
                    ? "border-primary shadow-[0_0_0_1px_var(--primary)]"
                    : "border-border hover:border-primary/60",
                )}
                aria-label="查看这张结果图"
              >
                <img
                  src={getOssThumbnailUrl(resultImage.url)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function ReferenceAssetThumb({
  asset,
  index,
}: {
  asset: AssetRecord;
  index: number;
}) {
  return (
    <div className="space-y-1">
      <div className="aspect-square overflow-hidden rounded border border-border bg-card">
        <img
          src={asset.fileUrl}
          alt={asset.fileName}
          className="h-full w-full object-cover"
        />
      </div>
      <p
        className="truncate text-[10px] text-muted-foreground"
        title={asset.fileName}
      >
        图{index + 1}
      </p>
    </div>
  );
}

function MyModelLibraryPanel({
  models,
  referencedModelIds,
  referencedCount,
  onAddModel,
  onDeleteModel,
  onRenameModel,
  onCancel,
  onClose,
  onConfirm,
}: {
  models: CompanyModel[];
  referencedModelIds: Set<string>;
  referencedCount: number;
  onAddModel: (model: CompanyModel) => void;
  onDeleteModel: (assetId: string) => void;
  onRenameModel: (assetId: string, name: string) => void;
  onCancel: () => void;
  onClose: () => void;
  onConfirm: (models: CompanyModel[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftSelectedIds, setDraftSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  const remainingSlots = Math.max(0, 10 - referencedCount);
  const selectedModels = models.filter((model) =>
    draftSelectedIds.has(model.assetId),
  );
  const exceedsLimit = selectedModels.length > remainingSlots;

  const toggleSelected = (assetId: string) => {
    setDraftSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const sizeError = validateUploadSize(file);
    if (sizeError) {
      setError(sizeError);
      return;
    }

    setError("");
    setIsUploading(true);

    try {
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
        url: string;
        fileName: string;
        width: number;
        height: number;
      };
      const model: CompanyModel = {
        assetId: data.assetId,
        // A-fix: 强制使用 server 返回的稳定 URL，去掉 blob URL fallback。
        preview: data.url,
        name: data.fileName,
        width: data.width,
        height: data.height,
        createdAt: new Date().toISOString(),
      };

      onAddModel(model);
      setDraftSelectedIds((current) => {
        const next = new Set(current);
        next.add(model.assetId);
        return next;
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex rounded-full bg-secondary p-1">
          <span className="rounded-full bg-card px-5 py-2 text-sm font-medium text-foreground">
            我的模特库
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="关闭模特库"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <p className="mb-4 text-xs text-muted-foreground">
          单击模特图片选中后点「确定」可批量加入参考图，双击则直接加入。当前参考图剩余可添加{" "}
          {remainingSlots} 张。
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="aspect-[3/4] rounded-md border border-dashed border-border bg-secondary text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <span className="flex h-full flex-col items-center justify-center gap-3">
              {isUploading ? (
                <Upload className="h-7 w-7 animate-pulse text-primary" />
              ) : (
                <Plus className="h-7 w-7" />
              )}
              <span className="text-sm">
                {isUploading ? "上传中..." : "上传模特"}
              </span>
              <span className="text-xs text-muted-foreground">
                jpg/png/webp
              </span>
            </span>
          </button>

          {models.map((model) => (
            <ModelCard
              key={model.assetId}
              model={model}
              selected={draftSelectedIds.has(model.assetId)}
              referenced={referencedModelIds.has(model.assetId)}
              canSelect={remainingSlots > 0}
              onToggleSelect={() => toggleSelected(model.assetId)}
              onQuickAdd={() => {
                if (
                  referencedModelIds.has(model.assetId) ||
                  remainingSlots <= 0
                )
                  return;
                onConfirm([model]);
              }}
              onDelete={() => onDeleteModel(model.assetId)}
              onRename={(name) => onRenameModel(model.assetId, name)}
            />
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
        {exceedsLimit && (
          <span className="text-xs text-destructive">
            已选 {selectedModels.length} 张，超过参考图剩余可添加数{" "}
            {remainingSlots}
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="min-w-[116px] rounded-full border border-border px-7 py-3 text-sm text-foreground hover:border-primary/60"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onConfirm(selectedModels)}
          disabled={!selectedModels.length || exceedsLimit}
          className="min-w-[116px] rounded-full border border-primary bg-primary/10 px-7 py-3 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          确定{selectedModels.length ? `（${selectedModels.length}）` : ""}
        </button>
      </div>
    </div>
  );
}

function ModelCard({
  model,
  selected,
  referenced,
  canSelect,
  onToggleSelect,
  onQuickAdd,
  onDelete,
  onRename,
}: {
  model: CompanyModel;
  selected: boolean;
  referenced: boolean;
  canSelect: boolean;
  onToggleSelect: () => void;
  onQuickAdd: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(model.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftName(model.name);
  }, [model.name]);

  useEffect(() => {
    if (isEditing) {
      const handle = window.setTimeout(() => inputRef.current?.select(), 0);
      return () => window.clearTimeout(handle);
    }
  }, [isEditing]);

  const commitRename = () => {
    const next = draftName.trim();
    if (next && next !== model.name) {
      onRename(next);
    } else {
      setDraftName(model.name);
    }
    setIsEditing(false);
  };

  const cancelRename = () => {
    setDraftName(model.name);
    setIsEditing(false);
  };

  const handleCardClick = () => {
    if (isEditing || showDeleteConfirm) return;
    if (referenced) return;
    onToggleSelect();
  };

  const handleCardDoubleClick = () => {
    if (isEditing || showDeleteConfirm) return;
    if (!referenced && canSelect) onQuickAdd();
  };

  return (
    <div
      role="button"
      tabIndex={referenced ? -1 : 0}
      aria-disabled={referenced}
      onClick={handleCardClick}
      onDoubleClick={handleCardDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            handleCardClick();
          }
        }
      }}
      title={referenced ? "已在参考图中" : "单击选中，双击直接加入参考图"}
      className={cn(
        "group relative overflow-hidden rounded-md border bg-card text-left transition-colors",
        referenced
          ? "border-primary/40 opacity-60 cursor-not-allowed"
          : selected
            ? "border-primary shadow-[0_0_0_1px_var(--primary)] cursor-pointer"
            : "border-border hover:border-primary/60 cursor-pointer",
      )}
    >
      <div className="aspect-[3/4] bg-white">
        <img
          src={model.preview}
          alt={model.name}
          className="h-full w-full object-cover object-top"
        />
      </div>

      <div className="px-3 py-2">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftName}
            maxLength={40}
            onChange={(event) => setDraftName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commitRename();
              else if (event.key === "Escape") cancelRename();
            }}
            className="w-full rounded border border-primary bg-background px-2 py-1 text-xs text-foreground outline-none"
          />
        ) : (
          <p
            className="truncate text-xs font-medium text-foreground"
            onDoubleClick={(event) => {
              event.stopPropagation();
              setIsEditing(true);
            }}
            title="双击重命名"
          >
            {model.name}
          </p>
        )}
      </div>

      {/* status badges */}
      {referenced ? (
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
          已在参考图
        </span>
      ) : selected ? (
        <span className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-4 w-4" />
        </span>
      ) : null}

      {/* hover actions */}
      {!referenced && (
        <div className="absolute left-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsEditing(true);
            }}
            title="重命名"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            title="删除"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* delete confirm overlay */}
      {showDeleteConfirm && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 text-center"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-xs text-foreground">删除这个模特？</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:border-primary/60"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(false);
                onDelete();
              }}
              className="rounded-full bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 姿势裂变案例库 Tab：每个 case 一张大卡片，左侧主图 + 右侧 N 张套图网格，
 * 底部「做同款」按钮。完全参照 PhotoFissionCaseLibrary 的视觉与交互模式。
 * 结果图缺失时显示「示例图生成中」占位（CaseShotThumb 内自管 onError）。
 */
function PoseFissionCaseLibrary({
  cases,
  onSelectCase,
}: {
  cases: PoseFissionCase[];
  onSelectCase: (poseFissionCase: PoseFissionCase) => void;
}) {
  if (!cases.length) {
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="min-h-[420px] rounded-md border border-dashed border-border bg-transparent flex flex-col items-center justify-center text-center p-8 mx-4 my-8">
          <div className="w-12 h-12 rounded-md bg-white/[0.03] border border-border flex items-center justify-center mb-4">
            <ImageIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-[13px] font-medium text-foreground">暂无案例</p>
          <p className="mt-2 max-w-[360px] text-[12px] text-muted-foreground leading-relaxed">
            案例库正在筹备中，敬请期待。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="space-y-6">
        {cases.map((poseCase) => {
          // pose-fission case 每张图对应一个姿势模板（顺序与 poseTemplateIds 对齐），
          // 没有 shotLabels 字段：用「姿势 N」自动编号即可，足以做视觉占位。
          const shotCount = poseCase.resultImageUrls.length;

          return (
            <article
              key={poseCase.id}
              className="rounded-md border border-border bg-card p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row">
                <div className="lg:w-[260px] shrink-0 space-y-3">
                  <div className="relative aspect-[3/4] overflow-hidden rounded-md border border-border bg-background">
                    <CaseImage
                      src={poseCase.mainImageUrl}
                      alt={poseCase.name}
                    />
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-background/85 px-2 py-1 text-[10px] text-foreground">
                      <ImageIcon className="h-3 w-3" />
                      姿势裂变
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {poseCase.name}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {poseCase.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded border border-border bg-secondary px-2 py-0.5">
                      比例 {poseCase.imageRatio}
                    </span>
                    <span className="rounded border border-border bg-secondary px-2 py-0.5">
                      分辨率 {poseCase.resolution.toUpperCase()}
                    </span>
                    <span className="rounded border border-border bg-secondary px-2 py-0.5">
                      {shotCount} 个姿势
                    </span>
                  </div>
                </div>

                <div className="flex-1 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    生成效果（{shotCount} 张）
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {poseCase.resultImageUrls.map((url, index) => (
                      <CaseShotThumb
                        key={`${poseCase.id}-${index}-${url}`}
                        src={url}
                        label={`姿势 ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => onSelectCase(poseCase)}
                  className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary/10 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  做同款
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 服装大片裂变案例库 Tab：每个 case 一张大卡片，
 * 卡片内：左侧原图+案例信息，右侧 3×3 结果图网格（带 label 角标），底部「使用此案例」按钮。
 * 结果图缺失时显示「示例图生成中」占位（CaseShotThumb 内自管 onError）。
 */
function PhotoFissionCaseLibrary({
  cases,
  onSelectCase,
  onDeleteCase,
  onDeleteShot,
}: {
  cases: PhotoFissionCase[];
  onSelectCase: (photoFissionCase: PhotoFissionCase) => void;
  onDeleteCase: (caseId: string) => void;
  onDeleteShot: (caseId: string, shotUrl: string) => void;
}) {
  if (!cases.length) {
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="min-h-[420px] rounded-md border border-dashed border-border bg-transparent flex flex-col items-center justify-center text-center p-8 mx-4 my-8">
          <div className="w-12 h-12 rounded-md bg-white/[0.03] border border-border flex items-center justify-center mb-4">
            <ImageIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-[13px] font-medium text-foreground">暂无案例</p>
          <p className="mt-2 max-w-[360px] text-[12px] text-muted-foreground leading-relaxed">
            案例库正在筹备中，敬请期待。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="space-y-6">
        {cases.map((photoFissionCase) => (
          <article
            key={photoFissionCase.id}
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="lg:w-[260px] shrink-0 space-y-3">
                <div className="relative aspect-[3/4] overflow-hidden rounded-md border border-border bg-background">
                  <CaseImage
                    src={photoFissionCase.mainImageUrl}
                    alt={photoFissionCase.name}
                  />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-background/85 px-2 py-1 text-[10px] text-foreground">
                    <ImageIcon className="h-3 w-3" />
                    服装大片裂变
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {photoFissionCase.name}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {photoFissionCase.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="rounded border border-border bg-secondary px-2 py-0.5">
                    比例 {photoFissionCase.imageRatio}
                  </span>
                  <span className="rounded border border-border bg-secondary px-2 py-0.5">
                    分辨率 {photoFissionCase.resolution.toUpperCase()}
                  </span>
                  <span className="rounded border border-border bg-secondary px-2 py-0.5">
                    9 张套图
                  </span>
                </div>
              </div>

              <div className="flex-1 space-y-3">
                <p className="text-xs text-muted-foreground">
                  生成效果（{photoFissionCase.resultImageUrls.length} 张）
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {photoFissionCase.resultImageUrls.map((url, index) => (
                    <CaseShotThumb
                      key={url}
                      src={url}
                      label={
                        photoFissionCase.shotLabels[index] ??
                        `镜头 ${index + 1}`
                      }
                      onDelete={() =>
                        onDeleteShot(photoFissionCase.id, url)
                      }
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => onDeleteCase(photoFissionCase.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-red-500/60 hover:text-red-400"
                title="删除整个案例（软隐藏，不影响生成的图片）"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除案例
              </button>
              <button
                type="button"
                onClick={() => onSelectCase(photoFissionCase)}
                className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary/10 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Sparkles className="h-3.5 w-3.5" />
                使用此案例
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * 案例库 3×3 网格里的单张结果图，
 * 加载失败时切到「示例图生成中」灰色占位（不影响其它图加载）。
 *
 * 提供 onDelete 时，hover 右上角显示垃圾桶按钮，可单独删除该 shot。
 */
function CaseShotThumb({
  src,
  label,
  onDelete,
}: {
  src: string;
  label: string;
  onDelete?: () => void;
}) {
  const [hasError, setHasError] = useState(false);

  return (
    <div className="group/shot relative aspect-[3/4] overflow-hidden rounded border border-border bg-secondary">
      {hasError ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-2 text-center text-[10px] text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
          <span>示例图生成中</span>
        </div>
      ) : (
        <img
          src={src}
          alt={label}
          loading="lazy"
          onError={() => setHasError(true)}
          className="h-full w-full object-cover"
        />
      )}
      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
        {label}
      </span>
      {onDelete && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 transition-opacity hover:bg-red-500/80 hover:text-white group-hover/shot:opacity-100"
          aria-label="删除这张图"
          title="删除这张镜头图"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/**
 * 案例库左侧主图：加载失败时同样回落到灰色占位。
 */
function CaseImage({ src, alt }: { src: string; alt: string }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-[11px] text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
        <span>原图加载失败</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setHasError(true)}
      className="h-full w-full object-cover"
    />
  );
}

function ResultProgressCard({ progress }: { progress: ShotProgress }) {
  const isFailed = progress.status === "failed";
  const isCancelled = progress.status === "cancelled";
  const isRetrying = progress.status === "retrying";
  const retryAttempt = progress.retryAttempt ?? 0;

  return (
    <div className="aspect-[3/4] rounded-lg border border-dashed border-border bg-card/70 p-3 text-left">
      <div className="flex h-full flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-foreground">
              {progress.label}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {retryAttempt > 0 ? `重跑 ${retryAttempt}` : "排队"}
            </span>
          </div>
          <p
            className={cn(
              "mt-3 text-xs leading-relaxed",
              isFailed ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {isFailed ? "重跑失败" : progress.message}
          </p>
        </div>
        {!isFailed && !isCancelled && (
          <div className="flex items-center gap-2 text-[11px] text-sky-300/80">
            <RefreshCw
              className={cn("h-3.5 w-3.5 animate-spin", isRetrying && "text-sky-200")}
            />
            <span>{isRetrying ? "正在重试" : "处理中"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskStatusCard({
  task,
  onBatchDownload,
  onRetryShots,
  onCancelTask,
}: {
  task: GenerationTask;
  onBatchDownload: () => void;
  onRetryShots?: (task: GenerationTask, shotIds: string[]) => Promise<void>;
  onCancelTask?: (taskId: string) => Promise<void>;
}) {
  const isDone =
    task.status === "success" ||
    task.status === "partial" ||
    task.status === "cancelled";
  const isRunning = task.status === "pending" || task.status === "running";
  const isPhotoFission = task.featureType === "photo-fission";
  const isPoseFission = task.featureType === "pose-fission";
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // photo-fission：shotPlan 中存在但 results 中没有对应 shotId 的项。
  // pose-fission：poseTemplateIds 中存在但 results 中没有对应 shotId（=templateId）的项。
  // 仅在 partial 或 (failed && 已有部分结果) 时展示按钮。
  const failedShotIds = useMemo(() => {
    const succeeded = new Set(
      task.results
        .map((r) => r.shotId)
        .filter((id): id is string => Boolean(id)),
    );

    if (isPhotoFission) {
      const params = task.params as Partial<PhotoFissionParams>;
      if (!Array.isArray(params.shotPlan)) return [];
      return params.shotPlan
        .map((shot) => shot.shotId)
        .filter((id) => !succeeded.has(id));
    }

    if (isPoseFission) {
      const params = task.params as Partial<PoseFissionParams>;
      if (!Array.isArray(params.poseTemplateIds)) return [];
      return params.poseTemplateIds.filter((id) => !succeeded.has(id));
    }

    return [] as string[];
  }, [isPhotoFission, isPoseFission, task.params, task.results]);

  const canRetryShots =
    (isPhotoFission || isPoseFission) &&
    onRetryShots &&
    failedShotIds.length > 0 &&
    (task.status === "partial" ||
      (task.status === "failed" && task.results.length > 0));

  // photo-fission 用「镜头」措辞，pose-fission 用「姿势」措辞，沿用各 feature 既有产品文案。
  const retryLabel = isPoseFission ? "失败姿势" : "失败镜头";

  const handleRetry = async () => {
    if (!onRetryShots || retrying) return;
    setRetryError(null);
    setRetrying(true);
    try {
      await onRetryShots(task, failedShotIds);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "重跑失败");
    } finally {
      setRetrying(false);
    }
  };

  const handleCancel = async () => {
    if (!onCancelTask || cancelling) return;
    setRetryError(null);
    setCancelling(true);
    try {
      await onCancelTask(task.taskId);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "取消任务失败");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="text-sm text-muted-foreground">{task.taskId}</span>
          </div>
          <p className="mt-2 text-sm text-foreground">{task.message}</p>
          {task.errorMessage && (
            <p className="mt-1 text-sm text-destructive">{task.errorMessage}</p>
          )}
          {retryError && (
            <p className="mt-1 text-sm text-destructive">{retryError}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canRetryShots && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-3 py-2 rounded-md border border-primary/60 bg-primary/10 text-primary text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary hover:text-primary-foreground transition-colors"
              title={
                isPoseFission
                  ? "只重跑当前未成功的姿势，已有图保留"
                  : "只重跑当前未成功的镜头，已有图保留"
              }
            >
              <RefreshCw
                className={cn("w-4 h-4", retrying && "animate-spin")}
              />
              {retrying
                ? "重跑中..."
                : `重新生成${retryLabel} (${failedShotIds.length})`}
            </button>
          )}
          {isRunning && onCancelTask && isPantsFissionTask(task) && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-3 py-2 rounded-md border border-destructive/60 bg-destructive/10 text-destructive text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-destructive hover:text-destructive-foreground transition-colors"
              title="停止当前任务，保留已生成图片"
            >
              <X className="w-4 h-4" />
              {cancelling ? "取消中..." : "取消任务"}
            </button>
          )}
          <button
            onClick={onBatchDownload}
            disabled={!isDone || task.results.length === 0}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            批量下载
          </button>
        </div>
      </div>

      <div className="mt-4 h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${task.progress}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>进度 {task.progress}%</span>
        {!isPhotoFission && !isPoseFission && (
          <span>额度 -{task.creditsUsed}</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const label = {
    pending: "等待中",
    running: "生成中",
    success: "成功",
    failed: "失败",
    partial: "部分成功",
    cancelled: "已取消",
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs",
        status === "success" && "bg-primary/15 text-primary",
        status === "running" && "bg-blue-500/15 text-blue-300",
        status === "pending" && "bg-muted text-muted-foreground",
        status === "failed" && "bg-destructive/15 text-destructive",
        status === "partial" && "bg-yellow-500/15 text-yellow-300",
        status === "cancelled" && "bg-muted text-muted-foreground",
      )}
    >
      {status === "success" && <CheckCircle2 className="w-3 h-3" />}
      {label}
    </span>
  );
}

function LiveTaskProgressPanel({
  task,
  gridItems,
  favorites,
  isFaceVariantRunning,
  onBatchDownload,
  onRetryShots,
  onCancelTask,
  onPreviewImage,
  onToggleFavorite,
  onRefineFace,
  onRegenerate,
  onDelete,
}: {
  task: GenerationTask;
  gridItems: ResultGridItem[];
  favorites: Set<string>;
  isFaceVariantRunning: boolean;
  onBatchDownload: () => void;
  onRetryShots: (task: GenerationTask, shotIds: string[]) => Promise<void>;
  onCancelTask: (taskId: string) => Promise<void>;
  onPreviewImage: (image: ResultAsset) => void;
  onToggleFavorite: (assetId: string) => void;
  onRefineFace: (image: ResultAsset) => void;
  onRegenerate: (image: ResultAsset) => void;
  onDelete: (image: ResultAsset) => void;
}) {
  const canUseFaceActions =
    task.featureType === "photo-fission" &&
    Boolean((task.params as PhotoFissionParams).faceIdModelId);

  return (
    <div className="mb-5 space-y-4">
      <TaskStatusCard
        task={task}
        onBatchDownload={onBatchDownload}
        onRetryShots={onRetryShots}
        onCancelTask={onCancelTask}
      />
      {gridItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {gridItems.map((item) => {
            if (item.kind === "progress") {
              return (
                <ResultProgressCard
                  key={item.progress.shotId}
                  progress={item.progress}
                />
              );
            }

            return (
              <ResultImageCard
                key={item.image.assetId}
                image={item.image}
                isFavorite={favorites.has(item.image.assetId)}
                canRefineFace={canUseFaceActions}
                canRegenerate={task.featureType === "photo-fission"}
                actionDisabled={isFaceVariantRunning}
                onClick={() => onPreviewImage(item.image)}
                onToggleFavorite={() => onToggleFavorite(item.image.assetId)}
                onRefineFace={() => onRefineFace(item.image)}
                onRegenerate={() => onRegenerate(item.image)}
                onDelete={() => onDelete(item.image)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskHistory({
  tasks,
  tasksLoading,
  topContent,
  activeTaskId,
  favorites,
  batchSelectMode,
  selectedAssetIds,
  onSelectTask,
  onToggleFavorite,
  onPreviewImage,
  onToggleImageSelection,
}: {
  tasks: GenerationTask[];
  tasksLoading?: boolean;
  topContent?: ReactNode;
  activeTaskId?: string;
  favorites: Set<string>;
  batchSelectMode: boolean;
  selectedAssetIds: Map<string, { url: string; downloadUrl: string }>;
  onSelectTask: (taskId: string) => void;
  onToggleFavorite: (assetId: string) => void;
  onPreviewImage: (image: ResultAsset, task: GenerationTask) => void;
  onToggleImageSelection: (assetId: string, url: string, downloadUrl: string) => void;
}) {
  if (!tasks.length) {
    if (tasksLoading) {
      return (
        <div className="flex-1 overflow-y-auto p-5">
          {topContent}
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="w-full rounded-lg border border-border bg-card p-4 animate-pulse"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="h-5 w-16 rounded bg-secondary" />
                  <div className="h-3 w-28 rounded bg-secondary" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-4 w-20 rounded bg-secondary" />
                  <div className="h-4 w-12 rounded-full bg-secondary" />
                </div>
                <div className="mt-1 h-3 w-24 rounded bg-secondary" />
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div
                      key={j}
                      className="aspect-[3/4] rounded bg-secondary"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto p-5">
        {topContent}
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="space-y-3">
        {topContent}
        {tasks.map((task) => {
          // 使用增强版动画组件（如果不需要批量选择模式）
          if (!batchSelectMode) {
            return (
              <EnhancedImageTaskCard
                key={task.taskId}
                task={task}
                isActive={activeTaskId === task.taskId}
                onSelectTask={onSelectTask}
                onPreviewImage={onPreviewImage}
                onToggleFavorite={onToggleFavorite}
                favorites={favorites}
              />
            );
          }

          // 批量选择模式下使用原版组件
          return (
            <TaskHistoryCard
              key={task.taskId}
              task={task}
              isActive={activeTaskId === task.taskId}
              favorites={favorites}
              batchSelectMode={batchSelectMode}
              selectedAssetIds={selectedAssetIds}
              onSelectTask={onSelectTask}
              onToggleFavorite={onToggleFavorite}
              onPreviewImage={onPreviewImage}
              onToggleImageSelection={onToggleImageSelection}
            />
          );
        })}
      </div>
    </div>
  );
}

function TaskHistoryCard({
  task,
  isActive,
  favorites,
  batchSelectMode,
  selectedAssetIds,
  onSelectTask,
  onToggleFavorite,
  onPreviewImage,
  onToggleImageSelection,
}: {
  task: GenerationTask;
  isActive: boolean;
  favorites: Set<string>;
  batchSelectMode: boolean;
  selectedAssetIds: Map<string, { url: string; downloadUrl: string }>;
  onSelectTask: (taskId: string) => void;
  onToggleFavorite: (assetId: string) => void;
  onPreviewImage: (image: ResultAsset, task: GenerationTask) => void;
  onToggleImageSelection: (assetId: string, url: string, downloadUrl: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showFinalPrompt, setShowFinalPrompt] = useState(false);
  const rawParams = task.params as {
    prompt?: string;
    userPrompt?: string;
    finalPrompt?: string;
    promptMode?: FashionPromptMode;
    model?: FashionModelId;
  };
  // 历史记录展示优先级：userPrompt → 旧任务的 prompt。复制按钮也用这个值，保证复制的是"用户原始提示词"。
  const displayPrompt = rawParams.userPrompt ?? rawParams.prompt ?? "";
  const finalPromptText = rawParams.finalPrompt ?? "";
  const isFashionPhoto = task.featureType === "ai-fashion-photo";
  const isPhotoFission = task.featureType === "photo-fission";
  const photoFissionPromptBundle = isPhotoFission
    ? buildPhotoFissionPromptBundle(task)
    : null;
  // 旧任务可能没有 promptMode；默认按 enhanced 兼容。
  const promptModeId: FashionPromptMode = rawParams.promptMode ?? "enhanced";
  const promptModeMeta = FASHION_PROMPT_MODES.find(
    (mode) => mode.id === promptModeId,
  );
  // 旧任务可能没有 model；展示时降级为空（即不显示模型徽标），不强制猜测。
  const modelMeta = rawParams.model
    ? FASHION_MODELS.find((option) => option.id === rawParams.model)
    : undefined;
  // 仅当 finalPrompt 与 userPrompt 不同时，给"查看实际发送 Prompt"按钮意义。
  const hasFinalPromptDiff =
    isFashionPhoto &&
    finalPromptText.trim().length > 0 &&
    finalPromptText !== displayPrompt;
  // photo-fission 的「复制提示词」用 shotPlan 拼接；其它 feature 用 displayPrompt
  const copyContent = isPhotoFission
    ? (photoFissionPromptBundle ?? "")
    : displayPrompt;
  const hasCopyContent = Boolean(copyContent);
  const latestResults = getLatestTaskResults(task);

  const handleCopyPrompt = async () => {
    if (!hasCopyContent) return;
    try {
      await navigator.clipboard.writeText(copyContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore - some browsers without https deny clipboard
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectTask(task.taskId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTask(task.taskId);
        }
      }}
      className={cn(
        "w-full rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/60 cursor-pointer",
        isActive ? "border-primary" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <StatusBadge status={task.status} />
        <span className="text-xs text-muted-foreground">
          {new Date(task.createdAt).toLocaleString("zh-CN")}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-sm text-foreground">
          {FEATURE_LABELS[task.featureType]}
        </p>
        {isFashionPhoto && modelMeta && (
          <span
            className="rounded-full border border-blue-400/40 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300"
            title={`${modelMeta.alias} · ${modelMeta.description}`}
          >
            {modelMeta.label}
          </span>
        )}
        {isFashionPhoto && promptModeMeta && (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              promptModeId === "raw"
                ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                : "border-primary/40 bg-primary/10 text-primary",
            )}
            title={promptModeMeta.description}
          >
            {promptModeMeta.label}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {latestResults.length} 张结果
        {!isPhotoFission && ` · 消耗 ${task.creditsUsed} 点`}
      </p>

      {displayPrompt && (
        <p
          className="mt-2 line-clamp-2 text-xs text-muted-foreground"
          title={displayPrompt}
        >
          {displayPrompt}
        </p>
      )}

      {task.errorMessage && (
        <p className="mt-2 text-xs text-destructive line-clamp-2">
          {task.errorMessage}
        </p>
      )}

      {latestResults.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {latestResults.map((image) => {
            const isFavorite = favorites.has(image.assetId);
            const isSelected = selectedAssetIds.has(image.assetId);

            return (
              <div
                key={image.assetId}
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  if (batchSelectMode) {
                    onToggleImageSelection(image.assetId, image.url, image.downloadUrl);
                  } else {
                    onPreviewImage(image, task);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (batchSelectMode) {
                      onToggleImageSelection(image.assetId, image.url, image.downloadUrl);
                    } else {
                      onPreviewImage(image, task);
                    }
                  }
                }}
                className={cn(
                  "group relative aspect-[3/4] overflow-hidden rounded border bg-card cursor-pointer transition-colors",
                  batchSelectMode && isSelected
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-border hover:border-primary/60",
                )}
              >
                <img
                  src={getOssThumbnailUrl(image.url)}
                  alt=""
                  className="h-full w-full object-cover"
                />

                {batchSelectMode && (
                  <div className={cn(
                    "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-white/80 bg-black/40",
                  )}>
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                )}
                {!batchSelectMode && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
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
                      className={cn(
                        "h-3.5 w-3.5",
                        isFavorite
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-muted-foreground",
                      )}
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
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasFinalPromptDiff && showFinalPrompt && (
        <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            实际发送给模型的 Prompt
          </p>
          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">
            {finalPromptText}
          </pre>
        </div>
      )}

      {(displayPrompt || hasFinalPromptDiff || hasCopyContent) && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {hasFinalPromptDiff && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowFinalPrompt((current) => !current);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              {showFinalPrompt ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  收起实际 Prompt
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  查看实际发送 Prompt
                </>
              )}
            </button>
          )}
          {hasCopyContent && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleCopyPrompt();
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                copied
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
              )}
            >
              {copied
                ? "已复制"
                : isPhotoFission
                  ? "复制全部 Prompt"
                  : "复制提示词"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyResults({ status }: { status: TaskStatus }) {
  return (
    <div className="min-h-[360px] rounded-md border border-dashed border-border bg-transparent flex flex-col items-center justify-center text-center p-8 mt-4">
      <div className="w-12 h-12 rounded-md bg-white/[0.03] border border-border flex items-center justify-center mb-4">
        {status === "failed" ? (
          <X className="w-5 h-5 text-destructive" />
        ) : (
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
        )}
      </div>
      <p className="text-[13px] font-medium text-foreground">
        {status === "failed" ? "任务失败，没有可用结果" : "结果生成中..."}
      </p>
      <p className="mt-2 max-w-[360px] text-[12px] text-muted-foreground leading-relaxed">
        任务完成后会在这里展示生成图片，可预览、收藏、下载使用。
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="min-h-[520px] rounded-md border border-dashed border-border bg-transparent flex flex-col items-center justify-center text-center p-8">
      <div className="w-12 h-12 rounded-md bg-white/[0.03] border border-border flex items-center justify-center mb-4">
        <Sparkles className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-[13px] font-medium text-foreground">
        先创建一个生成任务
      </p>
      <p className="mt-2 max-w-[420px] text-[12px] text-muted-foreground leading-relaxed">
        上传服装图片，选择参数并点击立即生成。MVP
        会创建异步任务，并通过第三方图片 API 适配层返回结果。
      </p>
    </div>
  );
}

/**
 * 服装大片裂变的「复制 Prompt」：把成功结果或 shotPlan 拼成按 label 分段的文本。
 * 优先用 task.results 中携带的 label/finalPrompt（最准），找不到时降级到 params.shotPlan。
 * 旧 photo-fission 任务（无 shotPlan）返回 null，前端按通用提示词逻辑处理。
 */
function buildPhotoFissionPromptBundle(task: GenerationTask): string | null {
  const segments: { label: string; prompt: string }[] = [];
  const seen = new Set<string>();

  for (const result of task.results) {
    if (!result.label || !result.finalPrompt) continue;
    const key = result.shotId ?? result.label;
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push({ label: result.label, prompt: result.finalPrompt });
  }

  if (!segments.length) {
    const params = task.params as Partial<PhotoFissionParams>;
    if (Array.isArray(params.shotPlan)) {
      for (const shot of params.shotPlan) {
        if (!shot?.label || !shot?.prompt) continue;
        const key = shot.shotId ?? shot.label;
        if (seen.has(key)) continue;
        seen.add(key);
        segments.push({ label: shot.label, prompt: shot.prompt });
      }
    }
  }

  if (!segments.length) return null;

  return segments
    .map((segment) => `【${segment.label}】\n${segment.prompt}`)
    .join("\n\n");
}

/**
 * 兼容旧任务数据：宽松读取一个字符串字段，类型不匹配时返回空串。
 * 主要用于读取被 v2 类型移除、但旧 photo-fission 任务仍可能持久化的字段（如 userPrompt）。
 */
function readLegacyString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function MyFaceIdLibraryPanel({
  models,
  selectedModelId,
  onAddModel,
  onDeleteModel,
  onRenameModel,
  onClose,
  onConfirm,
}: {
  models: CompanyModel[];
  selectedModelId: string | null;
  onAddModel: (model: CompanyModel) => void;
  onDeleteModel: (assetId: string) => void;
  onRenameModel: (assetId: string, name: string) => void;
  onClose: () => void;
  onConfirm: (model: CompanyModel | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftSelectedId, setDraftSelectedId] = useState<string | null>(
    selectedModelId,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  const toggleSelected = (assetId: string) => {
    setDraftSelectedId((current) => (current === assetId ? null : assetId));
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const sizeError = validateUploadSize(file);
    if (sizeError) {
      setError(sizeError);
      return;
    }

    setError("");
    setIsUploading(true);

    try {
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
        url: string;
        fileName: string;
        width: number;
        height: number;
      };
      const model: CompanyModel = {
        assetId: data.assetId,
        preview: data.url,
        name: data.fileName,
        width: data.width,
        height: data.height,
        createdAt: new Date().toISOString(),
      };

      onAddModel(model);
      setDraftSelectedId(model.assetId);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  const selectedModel = models.find((m) => m.assetId === draftSelectedId) || null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#101010] text-foreground">
      <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-[#101010]">
        <div className="flex rounded-full bg-secondary p-1">
          <span className="rounded-full bg-card px-5 py-2 text-sm font-medium text-foreground">
            我的人像小卡
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="关闭人像小卡"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 bg-[#101010]">
        <p className="mb-4 text-xs text-muted-foreground">
          单击人像小卡图片选中（胸口以上，大头照效果最佳），点「确定」锁定五官特征。双击可以直接选择并返回。
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="aspect-[3/4] rounded-md border border-dashed border-border bg-secondary text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground flex flex-col items-center justify-center"
          >
            <span className="flex flex-col items-center justify-center gap-3">
              {isUploading ? (
                <Upload className="h-7 w-7 animate-pulse text-primary" />
              ) : (
                <Plus className="h-7 w-7" />
              )}
              <span className="text-sm">
                {isUploading ? "上传中..." : "上传人像小卡"}
              </span>
              <span className="text-xs text-muted-foreground">
                jpg/png/webp
              </span>
            </span>
          </button>

          {models.map((model) => (
            <ModelCard
              key={model.assetId}
              model={model}
              selected={draftSelectedId === model.assetId}
              referenced={false}
              canSelect={true}
              onToggleSelect={() => toggleSelected(model.assetId)}
              onQuickAdd={() => onConfirm(model)}
              onDelete={() => onDeleteModel(model.assetId)}
              onRename={(name) => onRenameModel(model.assetId, name)}
            />
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      <div className="flex justify-end gap-3 border-t border-border px-5 py-4 bg-[#101010]">
        <button
          type="button"
          onClick={() => onConfirm(null)}
          className="rounded-full border border-border px-8 py-3 text-sm text-foreground hover:border-primary/60"
        >
          清除选择
        </button>
        <button
          type="button"
          onClick={() => onConfirm(selectedModel)}
          className="rounded-full border border-primary bg-primary/10 px-8 py-3 text-sm text-primary hover:bg-primary hover:text-primary-foreground"
        >
          确定
        </button>
      </div>
    </div>
  );
}
