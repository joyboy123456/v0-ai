"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CircleMinus,
  CirclePlus,
  Contrast,
  Eraser,
  Hand,
  Loader2,
  Maximize,
  Minus,
  Paintbrush,
  Plus,
  Redo2,
  RotateCcw,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ApiResponseError, cn, readJsonResponse } from "@/lib/utils";
import {
  ImageCanvasViewport,
  type ImageCanvasLoadStatus,
} from "./image-canvas-viewport";
import type {
  CutoutRegionInfo,
  CutoutRegionWorkerRequest,
  CutoutRegionWorkerResponse,
} from "./cutout-region-worker";

export interface EditableImage {
  assetId: string;
  preview: string;
  name: string;
  width?: number;
  height?: number;
}

export interface CutoutAsset {
  assetId: string;
  url: string;
  fileName: string;
  fileType: string;
  width: number;
  height: number;
  sourceAssetId: string;
}

interface CutoutEditorDialogProps {
  open: boolean;
  image: EditableImage | null;
  onOpenChange: (open: boolean) => void;
  onApply: (asset: CutoutAsset) => void;
}

interface CutoutSessionCategoryDto {
  category: string;
  width: number;
  height: number;
}

interface CutoutSessionDto {
  sessionId: string;
  scene: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  originalWidth: number;
  originalHeight: number;
  scale: number;
  categories: CutoutSessionCategoryDto[];
  createdAt: string;
}

interface CutoutExportResponse {
  asset: CutoutAsset;
  mask: { assetId: string; url: string; width: number; height: number };
  boundingBox: { x: number; y: number; width: number; height: number };
}

type EditorPhase = "idle" | "preparing" | "ready" | "exporting";
type EditorTool = "add" | "subtract" | "paint" | "erase";
type EventPayload = Record<string, string | number | boolean | null>;

interface EditorError {
  message: string;
  advice: string;
  code: string;
  retryable: boolean;
}

interface CategoryRegionData {
  labelMap: Uint32Array;
  indexWidth: number;
  indexHeight: number;
  indexMap: Uint32Array;
  regions: Map<number, CutoutRegionInfo>;
  previews: Map<number, Uint8Array>;
}

interface HoverHit {
  category: string;
  region: CutoutRegionInfo;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.1;
const BRUSH_MIN = 5;
const BRUSH_MAX = 200;
const BRUSH_DEFAULT = 40;
const HISTORY_LIMIT = 30;
const INDEX_MAX_EDGE = 1024;
/** 选区蒙版蓝色，35% 不透明度（PRD §8.2：30%～45%）。 */
const MASK_TINT_COLOR = "rgba(59,130,246,0.35)";
/** 悬停高亮蓝色透明度（index 尺寸 previewMask 着色用）。 */
const HOVER_TINT: [number, number, number, number] = [59, 130, 246, 115];
/** 前景判定阈值，与后端 FOREGROUND_THRESHOLD 口径一致。 */
const FOREGROUND_THRESHOLD = 8;

/** 右画布占位图：1x1 透明 PNG（透明预览完全由 canvas 绘制，img 仅占位加载）。 */
const TRANSPARENT_PIXEL_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

/** 命中优先级（PRD §39.5）：具体服饰 > 皮肤/头发 > 完整人体 > 通用主体。 */
const CATEGORY_TIER: Record<string, number> = {
  tops: 0,
  coat: 0,
  skirt: 0,
  pants: 0,
  bag: 0,
  shoes: 0,
  hat: 0,
  skin: 1,
  hair: 1,
  body: 2,
  common: 3,
};

const TOOL_TIPS: Record<EditorTool, { label: string; hint: string }> = {
  add: { label: "增选", hint: "点击需要保留的地方，整片服饰会加入选区。" },
  subtract: {
    label: "减选",
    hint: "点击不需要保留的地方，整片区域会从选区移除。",
  },
  paint: { label: "涂抹", hint: "涂抹需要保留的区域，适合补充边角与细节。" },
  erase: { label: "擦除", hint: "擦除不需要的区域，适合清理误选残留。" },
};

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
}

/** 轻量埋点：失败静默（PRD §31 / §37 决策）。 */
function trackCutoutEvent(event: string, payload?: EventPayload): void {
  try {
    void fetch("/api/events", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, payload }),
    }).catch(() => {});
  } catch {
    // 埋点失败不影响主流程
  }
}

function toEditorError(error: unknown, fallback: string): EditorError {
  if (error instanceof ApiResponseError) {
    const status = error.status;
    return {
      message: error.payload?.error?.trim() || error.message || fallback,
      advice: error.payload?.advice?.trim() || "请稍后重试",
      code: error.payload?.code || `http_${status}`,
      retryable: status >= 500 || status === 429,
    };
  }
  return {
    message: error instanceof Error ? error.message : fallback,
    advice: "请检查网络后重试",
    code: "network",
    retryable: true,
  };
}

/**
 * prepared 工作图经同源 API 输出：viapi 临时桶对浏览器匿名 GET 403，
 * 禁止把 session.imageUrl（preparedImageUrl）直接交给 <img>/canvas。
 */
function sessionImageApiPath(sessionId: string): string {
  return "/api/cutout-sessions/" + encodeURIComponent(sessionId) + "/image";
}

export function CutoutEditorDialog({
  open,
  image,
  onOpenChange,
  onApply,
}: CutoutEditorDialogProps) {
  // —— 会话与异步控制 ——
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerSeqRef = useRef(0);
  const openedAtRef = useRef(0);

  // —— 视口 ——
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingViewRef = useRef<
    | { mode: "center"; side: "left" | "right" }
    | {
        mode: "anchor";
        side: "left" | "right";
        fx: number;
        fy: number;
        clientX: number;
        clientY: number;
      }
    | null
  >(null);

  // —— 画布（DOM overlay） ——
  const tintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // —— Mask 模型（PRD §10.3）：semantic ∪ manualAdd − manualErase = final ——
  const semanticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const manualAddCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const manualEraseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const finalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dimsRef = useRef({ width: 0, height: 0 });
  const baseImageRef = useRef<HTMLImageElement | null>(null);

  // —— 候选区域（Worker 分析结果） ——
  const categoriesRef = useRef<Map<string, CategoryRegionData>>(new Map());
  const hoverTintCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // —— 历史（finalMask PNG 快照栈 ≤30） ——
  const pastRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);

  // —— 指针交互 ——
  const drawingRef = useRef(false);
  const strokeDirtyRef = useRef(false);
  const strokeTargetRef = useRef<"add" | "erase">("add");
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    side: "left" | "right";
  } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const hoverRef = useRef<HoverHit | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const renderScheduledRef = useRef(false);
  const hoverScheduledRef = useRef(false);

  // —— 渲染镜像 ref（rAF 回调读取最新值） ——
  const zoomRef = useRef(0.5);
  const toolRef = useRef<EditorTool>("add");
  const brushSizeRef = useRef(BRUSH_DEFAULT);
  /** prepared/original 比例：笔刷尺寸以原图坐标为准（PRD §14），绘制时换算到工作图坐标。 */
  const scaleRef = useRef(1);
  /** 撤销/重做快照为异步解码，用递增序号丢弃过期的 restore，避免连续撤销乱序。 */
  const restoreSeqRef = useRef(0);
  /** 候选区域分析 Worker 是否发生过错误（用于降级提示，PRD §29）。 */
  const workerFailedRef = useRef(false);

  // —— React 状态 ——
  const [phase, setPhase] = useState<EditorPhase>("idle");
  const [session, setSession] = useState<CutoutSessionDto | null>(null);
  const [prepareError, setPrepareError] = useState<EditorError | null>(null);
  const [exportError, setExportError] = useState<EditorError | null>(null);
  const [tool, setTool] = useState<EditorTool>("add");
  const [brushSize, setBrushSize] = useState(BRUSH_DEFAULT);
  const [panMode, setPanMode] = useState(false);
  const [zoom, setZoom] = useState(0.5);
  const [leftStatus, setLeftStatus] =
    useState<ImageCanvasLoadStatus>("loading");
  const [rightStatus, setRightStatus] =
    useState<ImageCanvasLoadStatus>("loading");
  const [hasSelection, setHasSelection] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [regionsVersion, setRegionsVersion] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [autoMenuOpen, setAutoMenuOpen] = useState(false);

  zoomRef.current = zoom;
  toolRef.current = tool;
  brushSizeRef.current = brushSize;
  scaleRef.current =
    session?.scale && Number.isFinite(session.scale) && session.scale > 0
      ? session.scale
      : 1;

  const imageAssetId = image?.assetId;
  const workWidth = Math.max(
    1,
    Math.round(session?.imageWidth || image?.width || 1024),
  );
  const workHeight = Math.max(
    1,
    Math.round(session?.imageHeight || image?.height || 1024),
  );
  const leftImageUrl = session
    ? sessionImageApiPath(session.sessionId)
    : image?.preview || "";
  const displaySize = useMemo(
    () => ({
      width: Math.max(1, Math.round(workWidth * zoom)),
      height: Math.max(1, Math.round(workHeight * zoom)),
    }),
    [workWidth, workHeight, zoom],
  );
  const canEdit = phase === "ready" && leftStatus === "loaded";
  const exporting = phase === "exporting";

  // —— 渲染调度 ——
  const drawTintedMask = useCallback(() => {
    const canvas = tintCanvasRef.current;
    const final = finalCanvasRef.current;
    const { width, height } = dimsRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !final || !ctx || width <= 0 || height <= 0) return;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(final, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = MASK_TINT_COLOR;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  }, []);

  const drawTransparentPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const final = finalCanvasRef.current;
    const base = baseImageRef.current;
    const { width, height } = dimsRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !final || !ctx || width <= 0 || height <= 0) return;
    ctx.clearRect(0, 0, width, height);
    if (!base) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(base, 0, 0, width, height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(final, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }, []);

  const renderCanvases = useCallback(() => {
    drawTintedMask();
    drawTransparentPreview();
  }, [drawTintedMask, drawTransparentPreview]);

  const scheduleRender = useCallback(() => {
    if (renderScheduledRef.current) return;
    renderScheduledRef.current = true;
    requestAnimationFrame(() => {
      renderScheduledRef.current = false;
      renderCanvases();
    });
  }, [renderCanvases]);

  const getHoverTintCanvas = useCallback(
    (data: CategoryRegionData, region: CutoutRegionInfo) => {
      const cacheKey = `${region.category}:${region.label}`;
      const cached = hoverTintCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const preview = data.previews.get(region.label);
      if (!preview) return null;
      const canvas = document.createElement("canvas");
      canvas.width = data.indexWidth;
      canvas.height = data.indexHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const imageData = ctx.createImageData(data.indexWidth, data.indexHeight);
      const pixels = imageData.data;
      for (let index = 0; index < preview.length; index += 1) {
        if (preview[index] === 0) continue;
        const offset = index * 4;
        pixels[offset] = HOVER_TINT[0];
        pixels[offset + 1] = HOVER_TINT[1];
        pixels[offset + 2] = HOVER_TINT[2];
        pixels[offset + 3] = HOVER_TINT[3];
      }
      ctx.putImageData(imageData, 0, 0);
      hoverTintCacheRef.current.set(cacheKey, canvas);
      return canvas;
    },
    [],
  );

  const drawHoverLayer = useCallback(() => {
    const canvas = hoverCanvasRef.current;
    const { width, height } = dimsRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || width <= 0 || height <= 0) return;
    ctx.clearRect(0, 0, width, height);

    const activeTool = toolRef.current;
    if (activeTool === "add" || activeTool === "subtract") {
      const hover = hoverRef.current;
      if (hover) {
        const data = categoriesRef.current.get(hover.region.category);
        const tint = data ? getHoverTintCanvas(data, hover.region) : null;
        if (data && tint) {
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            tint,
            0,
            0,
            data.indexWidth,
            data.indexHeight,
            0,
            0,
            width,
            height,
          );
        }
      }
    }

    if (
      (activeTool === "paint" || activeTool === "erase") &&
      pointerRef.current.inside &&
      !panRef.current
    ) {
      const radius = Math.max(
        1,
        (brushSizeRef.current * scaleRef.current) / 2,
      );
      const lineWidth = Math.max(1 / zoomRef.current, 0.5);
      const { x, y } = pointerRef.current;
      ctx.beginPath();
      ctx.arc(x, y, radius + lineWidth, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }, [getHoverTintCanvas]);

  const scheduleHoverDraw = useCallback(() => {
    if (hoverScheduledRef.current) return;
    hoverScheduledRef.current = true;
    requestAnimationFrame(() => {
      hoverScheduledRef.current = false;
      drawHoverLayer();
    });
  }, [drawHoverLayer]);

  // —— Mask 合成与历史 ——
  const recomputeFinalMask = useCallback(() => {
    const final = finalCanvasRef.current;
    const semantic = semanticCanvasRef.current;
    const manualAdd = manualAddCanvasRef.current;
    const manualErase = manualEraseCanvasRef.current;
    const { width, height } = dimsRef.current;
    const ctx = final?.getContext("2d");
    if (!final || !ctx || !semantic || !manualAdd || !manualErase) return;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(semantic, 0, 0);
    ctx.drawImage(manualAdd, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(manualErase, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }, []);

  const updateHasSelection = useCallback(() => {
    const final = finalCanvasRef.current;
    const { width, height } = dimsRef.current;
    const ctx = final?.getContext("2d");
    if (!final || !ctx || width <= 0 || height <= 0) {
      setHasSelection(false);
      return;
    }
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > FOREGROUND_THRESHOLD) {
        setHasSelection(true);
        return;
      }
    }
    setHasSelection(false);
  }, []);

  const snapshotFinalMask = useCallback((): string | null => {
    const final = finalCanvasRef.current;
    if (!final || dimsRef.current.width <= 0) return null;
    return final.toDataURL("image/png");
  }, []);

  /** 在每次修改选区「之前」调用：记录当前 finalMask 快照并清空重做栈。 */
  const commitHistory = useCallback(() => {
    const snapshot = snapshotFinalMask();
    if (!snapshot) return;
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), snapshot];
    redoRef.current = [];
    setHistoryVersion((value) => value + 1);
  }, [snapshotFinalMask]);

  const restoreSnapshot = useCallback(
    (snapshot: string) => {
      const semantic = semanticCanvasRef.current;
      const manualAdd = manualAddCanvasRef.current;
      const manualErase = manualEraseCanvasRef.current;
      const { width, height } = dimsRef.current;
      const semanticCtx = semantic?.getContext("2d");
      if (!semantic || !semanticCtx || !manualAdd || !manualErase) return;
      const restoreSeq = ++restoreSeqRef.current;
      const snapshotImage = new Image();
      snapshotImage.onload = () => {
        // 连续撤销/重做时丢弃过期的异步解码结果，避免旧快照覆盖新状态。
        if (restoreSeqRef.current !== restoreSeq) return;
        if (dimsRef.current.width !== width || dimsRef.current.height !== height)
          return;
        // 回放语义：把快照作为 semantic 层，清空手动层，保持
        // final = (semantic ∪ add) − erase 模型在撤销后继续一致。
        semanticCtx.clearRect(0, 0, width, height);
        semanticCtx.drawImage(snapshotImage, 0, 0, width, height);
        manualAdd.getContext("2d")?.clearRect(0, 0, width, height);
        manualErase.getContext("2d")?.clearRect(0, 0, width, height);
        recomputeFinalMask();
        updateHasSelection();
        renderCanvases();
      };
      snapshotImage.src = snapshot;
    },
    [recomputeFinalMask, renderCanvases, updateHasSelection],
  );

  const handleUndo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    const current = snapshotFinalMask();
    pastRef.current = pastRef.current.slice(0, -1);
    if (current) redoRef.current = [...redoRef.current, current];
    setHistoryVersion((value) => value + 1);
    restoreSnapshot(previous);
    trackCutoutEvent("cutout_undo");
  }, [restoreSnapshot, snapshotFinalMask]);

  const handleRedo = useCallback(() => {
    const next = redoRef.current.at(-1);
    if (!next) return;
    const current = snapshotFinalMask();
    redoRef.current = redoRef.current.slice(0, -1);
    if (current) pastRef.current = [...pastRef.current, current];
    setHistoryVersion((value) => value + 1);
    restoreSnapshot(next);
    trackCutoutEvent("cutout_redo");
  }, [restoreSnapshot, snapshotFinalMask]);

  const clearAllMaskLayers = useCallback(() => {
    const { width, height } = dimsRef.current;
    for (const ref of [
      semanticCanvasRef,
      manualAddCanvasRef,
      manualEraseCanvasRef,
      finalCanvasRef,
    ]) {
      ref.current?.getContext("2d")?.clearRect(0, 0, width, height);
    }
  }, []);

  const handleReset = useCallback(() => {
    if (!canEdit) return;
    if (!hasSelection && pastRef.current.length === 0) return;
    commitHistory();
    clearAllMaskLayers();
    recomputeFinalMask();
    setHasSelection(false);
    scheduleRender();
  }, [
    canEdit,
    clearAllMaskLayers,
    commitHistory,
    hasSelection,
    recomputeFinalMask,
    scheduleRender,
  ]);

  const handleInvert = useCallback(() => {
    if (!canEdit || !hasSelection) return;
    const final = finalCanvasRef.current;
    const semantic = semanticCanvasRef.current;
    const manualAdd = manualAddCanvasRef.current;
    const manualErase = manualEraseCanvasRef.current;
    const { width, height } = dimsRef.current;
    const ctx = final?.getContext("2d");
    if (!final || !ctx || !semantic || !manualAdd || !manualErase) return;
    commitHistory();
    // 反选：finalMask 逐像素取反（PRD §15），然后归并回 semantic 层。
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    for (let index = 3; index < pixels.length; index += 4) {
      pixels[index] = 255 - pixels[index];
    }
    ctx.putImageData(imageData, 0, 0);
    const semanticCtx = semantic.getContext("2d");
    semanticCtx?.clearRect(0, 0, width, height);
    semanticCtx?.drawImage(final, 0, 0);
    manualAdd.getContext("2d")?.clearRect(0, 0, width, height);
    manualErase.getContext("2d")?.clearRect(0, 0, width, height);
    recomputeFinalMask();
    updateHasSelection();
    scheduleRender();
    trackCutoutEvent("cutout_invert");
  }, [
    canEdit,
    commitHistory,
    hasSelection,
    recomputeFinalMask,
    scheduleRender,
    updateHasSelection,
  ]);

  // —— 悬停命中（PRD §39.4/39.5，零网络查表） ——
  const hitTest = useCallback(
    (workX: number, workY: number): HoverHit | null => {
      const { width, height } = dimsRef.current;
      if (width <= 0 || height <= 0) return null;
      const hits: HoverHit[] = [];
      for (const [category, data] of categoriesRef.current) {
        const indexX = Math.min(
          data.indexWidth - 1,
          Math.max(0, Math.floor((workX * data.indexWidth) / width)),
        );
        const indexY = Math.min(
          data.indexHeight - 1,
          Math.max(0, Math.floor((workY * data.indexHeight) / height)),
        );
        const label = data.indexMap[indexY * data.indexWidth + indexX];
        if (label === 0) continue;
        const region = data.regions.get(label);
        if (region) hits.push({ category, region });
      }
      if (hits.length === 0) return null;
      hits.sort((a, b) => {
        const tierDiff =
          (CATEGORY_TIER[a.category] ?? 4) - (CATEGORY_TIER[b.category] ?? 4);
        if (tierDiff !== 0) return tierDiff;
        return a.region.area - b.region.area;
      });
      return hits[0];
    },
    [],
  );

  /** 由工作尺寸 label map 生成单个区域的蒙版 canvas（白 = 该区域）。 */
  const buildRegionMaskCanvas = useCallback(
    (data: CategoryRegionData, label: number): HTMLCanvasElement | null => {
      const { width, height } = dimsRef.current;
      let temp = tempCanvasRef.current;
      if (!temp) {
        temp = document.createElement("canvas");
        tempCanvasRef.current = temp;
      }
      if (temp.width !== width) temp.width = width;
      if (temp.height !== height) temp.height = height;
      const ctx = temp.getContext("2d");
      if (!ctx) return null;
      const imageData = ctx.createImageData(width, height);
      const pixels = imageData.data;
      const labelMap = data.labelMap;
      for (let index = 0; index < labelMap.length; index += 1) {
        if (labelMap[index] !== label) continue;
        const offset = index * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      return temp;
    },
    [],
  );

  /**
   * 批量应用候选区域（一条历史记录）：
   * 增选：finalMask ∪ regionMask（语义层 source-over）。
   * 减选：finalMask − regionMask（PRD §11 / info.md §4.3），语义层与手动涂抹层
   * 同步 destination-out，避免只减语义层导致涂抹补充过的区域残留。
   */
  const applyRegionList = useCallback(
    (hits: HoverHit[], isAdd: boolean) => {
      if (hits.length === 0) return;
      const semantic = semanticCanvasRef.current;
      const manualAdd = manualAddCanvasRef.current;
      const semanticCtx = semantic?.getContext("2d");
      const addCtx = manualAdd?.getContext("2d");
      if (!semantic || !semanticCtx || !manualAdd || !addCtx) return;
      commitHistory();
      for (const hit of hits) {
        const data = categoriesRef.current.get(hit.region.category);
        if (!data) continue;
        const regionMask = buildRegionMaskCanvas(data, hit.region.label);
        if (!regionMask) continue;
        semanticCtx.globalCompositeOperation = isAdd
          ? "source-over"
          : "destination-out";
        semanticCtx.drawImage(regionMask, 0, 0);
        semanticCtx.globalCompositeOperation = "source-over";
        if (!isAdd) {
          addCtx.globalCompositeOperation = "destination-out";
          addCtx.drawImage(regionMask, 0, 0);
          addCtx.globalCompositeOperation = "source-over";
        }
      }
      recomputeFinalMask();
      updateHasSelection();
      scheduleRender();
    },
    [
      buildRegionMaskCanvas,
      commitHistory,
      recomputeFinalMask,
      scheduleRender,
      updateHasSelection,
    ],
  );

  const applyRegionSelection = useCallback(
    (hit: HoverHit, isAdd: boolean) => {
      applyRegionList([hit], isAdd);
      trackCutoutEvent(isAdd ? "cutout_add_select" : "cutout_subtract_select", {
        category: hit.region.category,
      });
    },
    [applyRegionList],
  );

  /**
   * 自动选区（PRD §37：common/upper/lower 三种自动分割结果保留为快捷按钮）。
   * 全部为前端本地选区运算，一次操作一条历史记录（PRD §18.1）。
   */
  const handleAutoSelect = useCallback(
    (kind: "common" | "upper" | "lower") => {
      if (!canEdit) return;
      const categories = categoriesRef.current;
      const hits: HoverHit[] = [];
      const collectCategory = (category: string) => {
        const data = categories.get(category);
        if (!data) return;
        for (const region of data.regions.values()) {
          hits.push({ category, region });
        }
      };

      if (kind === "upper") {
        collectCategory("tops");
        collectCategory("coat");
      } else if (kind === "lower") {
        collectCategory("pants");
        collectCategory("skirt");
      } else {
        // 主体：优先 common 类别中面积最大区域（置信度最高，PRD §9.3）；
        // common 缺失时回退到除皮肤/头发外面积最大的区域（避免选中整个人身）。
        const common = categories.get("common");
        let bestCommon: CutoutRegionInfo | null = null;
        if (common) {
          for (const region of common.regions.values()) {
            if (!bestCommon || region.area > bestCommon.area) {
              bestCommon = region;
            }
          }
        }
        if (bestCommon) {
          hits.push({ category: "common", region: bestCommon });
        } else {
          let fallback: HoverHit | null = null;
          for (const [category, data] of categories) {
            if (category === "skin" || category === "hair") continue;
            for (const region of data.regions.values()) {
              if (!fallback || region.area > fallback.region.area) {
                fallback = { category, region };
              }
            }
          }
          if (fallback) hits.push(fallback);
        }
      }

      if (hits.length === 0) return;
      applyRegionList(hits, true);
      trackCutoutEvent("cutout_auto_select", { kind, regions: hits.length });
    },
    [applyRegionList, canEdit],
  );

  // —— 涂抹 / 擦除（纯前端位运算，PRD §12/§13） ——
  const paintStrokeTo = useCallback((point: { x: number; y: number }) => {
    const target =
      strokeTargetRef.current === "add"
        ? manualAddCanvasRef.current
        : manualEraseCanvasRef.current;
    const lastPoint = lastPointRef.current;
    const ctx = target?.getContext("2d");
    if (!target || !ctx || !lastPoint) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 笔刷尺寸为原图坐标（PRD §14），绘制到工作图画布需乘以 prepared/original 比例。
    ctx.lineWidth = Math.max(1, brushSizeRef.current * scaleRef.current);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
    lastPointRef.current = point;
    strokeDirtyRef.current = true;
    recomputeFinalMask();
  }, [recomputeFinalMask]);

  // —— 缩放 / 平移 ——
  const applyPendingView = useCallback(() => {
    const pending = pendingViewRef.current;
    if (!pending) return;
    pendingViewRef.current = null;
    const primary =
      pending.side === "right" ? rightScrollRef.current : leftScrollRef.current;
    const secondary =
      pending.side === "right" ? leftScrollRef.current : rightScrollRef.current;
    if (!primary) return;
    if (pending.mode === "center") {
      const scrollLeft = Math.max(
        0,
        (primary.scrollWidth - primary.clientWidth) / 2,
      );
      const scrollTop = Math.max(
        0,
        (primary.scrollHeight - primary.clientHeight) / 2,
      );
      primary.scrollLeft = scrollLeft;
      primary.scrollTop = scrollTop;
      if (secondary) {
        secondary.scrollLeft = scrollLeft;
        secondary.scrollTop = scrollTop;
      }
      return;
    }
    const stage = primary.firstElementChild as HTMLElement | null;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    primary.scrollLeft += rect.left + pending.fx * rect.width - pending.clientX;
    primary.scrollTop += rect.top + pending.fy * rect.height - pending.clientY;
    if (secondary) {
      secondary.scrollLeft = primary.scrollLeft;
      secondary.scrollTop = primary.scrollTop;
    }
  }, []);

  useLayoutEffect(() => {
    applyPendingView();
  }, [zoom, displaySize.width, displaySize.height, applyPendingView]);

  const zoomTo = useCallback(
    (nextZoom: number, side: "left" | "right", clientX?: number, clientY?: number) => {
      const clamped = clampZoom(nextZoom);
      if (clamped === zoomRef.current) return;
      const scroller =
        side === "right" ? rightScrollRef.current : leftScrollRef.current;
      const stage = scroller?.firstElementChild as HTMLElement | null | undefined;
      if (scroller && stage) {
        const stageRect = stage.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const anchorX =
          clientX ?? scrollerRect.left + scroller.clientWidth / 2;
        const anchorY =
          clientY ?? scrollerRect.top + scroller.clientHeight / 2;
        pendingViewRef.current = {
          mode: "anchor",
          side,
          fx: (anchorX - stageRect.left) / Math.max(1, stageRect.width),
          fy: (anchorY - stageRect.top) / Math.max(1, stageRect.height),
          clientX: anchorX,
          clientY: anchorY,
        };
      }
      setZoom(clamped);
    },
    [],
  );

  const applyFit = useCallback(() => {
    const scroller = leftScrollRef.current;
    if (!scroller) return;
    const { width, height } = dimsRef.current;
    if (width <= 0 || height <= 0) return;
    const availableWidth = Math.max(120, scroller.clientWidth - 32);
    const availableHeight = Math.max(120, scroller.clientHeight - 32);
    const fitZoom = Math.min(
      availableWidth / width,
      availableHeight / height,
    );
    pendingViewRef.current = { mode: "center", side: "left" };
    setZoom(clampZoom(fitZoom));
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>, side: "left" | "right") => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const ratio = event.deltaY > 0 ? 1 / 1.15 : 1.15;
      zoomTo(zoomRef.current * ratio, side, event.clientX, event.clientY);
    },
    [zoomTo],
  );

  // —— 指针交互 ——
  const getWorkPoint = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = hoverCanvasRef.current;
      const { width, height } = dimsRef.current;
      if (!canvas || width <= 0 || height <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: Math.min(
          width,
          Math.max(0, ((event.clientX - rect.left) / rect.width) * width),
        ),
        y: Math.min(
          height,
          Math.max(0, ((event.clientY - rect.top) / rect.height) * height),
        ),
      };
    },
    [],
  );

  const startPan = useCallback(
    (event: React.PointerEvent<HTMLElement>, side: "left" | "right") => {
      const scroller =
        side === "right" ? rightScrollRef.current : leftScrollRef.current;
      if (!scroller) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
        side,
      };
    },
    [],
  );

  const movePan = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const scroller =
      pan.side === "right" ? rightScrollRef.current : leftScrollRef.current;
    if (!scroller) return;
    event.preventDefault();
    scroller.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
    scroller.scrollTop = pan.scrollTop - (event.clientY - pan.y);
  }, []);

  const stopPanAndStroke = useCallback(() => {
    if (panRef.current) {
      panRef.current = null;
    }
    if (drawingRef.current) {
      drawingRef.current = false;
      lastPointRef.current = null;
      if (strokeDirtyRef.current) {
        strokeDirtyRef.current = false;
        updateHasSelection();
        scheduleRender();
        trackCutoutEvent(
          strokeTargetRef.current === "add" ? "cutout_paint" : "cutout_erase",
          { brushSize: brushSizeRef.current },
        );
      }
    }
  }, [scheduleRender, updateHasSelection]);

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // 中键 / 空格+左键 / 拖动画布模式：平移，不修改选区（PRD §17.2）。
      if (
        event.button === 1 ||
        (event.button === 0 && (isSpacePressed || panMode))
      ) {
        startPan(event, "left");
        return;
      }
      if (!canEdit || event.button !== 0) return;
      const point = getWorkPoint(event);
      if (!point) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const activeTool = toolRef.current;
      if (activeTool === "add" || activeTool === "subtract") {
        const hit = hitTest(point.x, point.y);
        if (!hit) return;
        applyRegionSelection(hit, activeTool === "add");
        return;
      }

      strokeTargetRef.current = activeTool === "paint" ? "add" : "erase";
      commitHistory();
      drawingRef.current = true;
      strokeDirtyRef.current = false;
      lastPointRef.current = point;
      // 单击也要落一个笔刷圆点。
      paintStrokeTo({ x: point.x + 0.01, y: point.y + 0.01 });
      scheduleRender();
    },
    [
      applyRegionSelection,
      canEdit,
      commitHistory,
      getWorkPoint,
      hitTest,
      isSpacePressed,
      paintStrokeTo,
      panMode,
      scheduleRender,
      startPan,
    ],
  );

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (panRef.current) {
        movePan(event);
        return;
      }
      const point = getWorkPoint(event);
      if (point) {
        pointerRef.current = { x: point.x, y: point.y, inside: true };
      } else {
        pointerRef.current = { x: 0, y: 0, inside: false };
      }

      const activeTool = toolRef.current;
      if (activeTool === "paint" || activeTool === "erase") {
        scheduleHoverDraw();
        if (drawingRef.current && point && canEdit) {
          paintStrokeTo(point);
          scheduleRender();
        }
        return;
      }

      if (!canEdit || !point) return;
      const hit = hitTest(point.x, point.y);
      const key = hit ? `${hit.category}:${hit.region.label}` : null;
      if (key !== hoverKeyRef.current) {
        hoverKeyRef.current = key;
        hoverRef.current = hit;
        scheduleHoverDraw();
      }
    },
    [
      canEdit,
      getWorkPoint,
      hitTest,
      movePan,
      paintStrokeTo,
      scheduleHoverDraw,
      scheduleRender,
    ],
  );

  const handleCanvasPointerLeave = useCallback(() => {
    if (panRef.current || drawingRef.current) return;
    pointerRef.current = { x: 0, y: 0, inside: false };
    if (hoverKeyRef.current !== null) {
      hoverKeyRef.current = null;
      hoverRef.current = null;
    }
    scheduleHoverDraw();
  }, [scheduleHoverDraw]);

  const handlePreviewPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (
        event.button === 1 ||
        (event.button === 0 && (isSpacePressed || panMode))
      ) {
        startPan(event, "right");
      }
    },
    [isSpacePressed, panMode, startPan],
  );

  const handlePreviewPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (panRef.current) movePan(event);
    },
    [movePan],
  );

  // —— 会话准备 ——
  const resetEditorState = useCallback(() => {
    pastRef.current = [];
    redoRef.current = [];
    categoriesRef.current.clear();
    hoverTintCacheRef.current.clear();
    hoverRef.current = null;
    hoverKeyRef.current = null;
    baseImageRef.current = null;
    drawingRef.current = false;
    panRef.current = null;
    workerFailedRef.current = false;
    setSession(null);
    setPrepareError(null);
    setExportError(null);
    setTool("add");
    setPanMode(false);
    setHasSelection(false);
    setHistoryVersion((value) => value + 1);
    setRegionsVersion(0);
    setLeftStatus("loading");
    setRightStatus("loading");
  }, []);

  const initMaskCanvases = useCallback((width: number, height: number) => {
    dimsRef.current = { width, height };
    const create = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    semanticCanvasRef.current = create();
    manualAddCanvasRef.current = create();
    manualEraseCanvasRef.current = create();
    finalCanvasRef.current = create();
    tempCanvasRef.current = null;
  }, []);

  const ensureWorker = useCallback((seq: number): Worker => {
    workerRef.current?.terminate();
    const worker = new Worker(
      new URL("./cutout-region-worker.ts", import.meta.url),
    );
    workerRef.current = worker;
    workerSeqRef.current = seq;
    worker.onmessage = (event: MessageEvent<CutoutRegionWorkerResponse>) => {
      const message = event.data;
      if (workerSeqRef.current !== seq) return;
      if (
        !message ||
        message.width !== dimsRef.current.width ||
        message.height !== dimsRef.current.height
      ) {
        return;
      }
      categoriesRef.current.set(message.category, {
        labelMap: new Uint32Array(message.labelMap),
        indexWidth: message.indexWidth,
        indexHeight: message.indexHeight,
        indexMap: new Uint32Array(message.indexMap),
        regions: new Map(message.regions.map((region) => [region.label, region])),
        previews: new Map(
          message.previews.map((preview) => [
            preview.label,
            new Uint8Array(preview.data),
          ]),
        ),
      });
      setRegionsVersion((value) => value + 1);
    };
    worker.onerror = (event) => {
      console.warn("[cutout] 候选区域分析 Worker 错误", event.message);
      workerFailedRef.current = true;
      // 触发重渲染，让降级提示（PRD §29）立即展示。
      setRegionsVersion((value) => value + 1);
    };
    return worker;
  }, []);

  const loadBaseImage = useCallback(
    (url: string, seq: number) => {
      const bitmapImage = new Image();
      bitmapImage.onload = () => {
        if (requestSeqRef.current !== seq) return;
        baseImageRef.current = bitmapImage;
        scheduleRender();
      };
      bitmapImage.onerror = () => {
        console.warn("[cutout] 底图位图加载失败", url);
      };
      bitmapImage.src = url;
    },
    [scheduleRender],
  );

  const loadCategoryMasks = useCallback(
    (sessionDto: CutoutSessionDto, seq: number, signal: AbortSignal) => {
      const worker = ensureWorker(seq);
      const { width, height } = dimsRef.current;
      for (const categoryMeta of sessionDto.categories) {
        void (async () => {
          try {
            const response = await fetch(
              `/api/cutout-sessions/${encodeURIComponent(sessionDto.sessionId)}/masks/${encodeURIComponent(categoryMeta.category)}`,
              { signal },
            );
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const blob = await response.blob();
            if (requestSeqRef.current !== seq) return;
            const bitmap = await createImageBitmap(blob);
            const decoder = document.createElement("canvas");
            decoder.width = width;
            decoder.height = height;
            const ctx = decoder.getContext("2d");
            if (!ctx) throw new Error("无法创建解码画布");
            ctx.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();
            const rgba = ctx.getImageData(0, 0, width, height).data;
            const grayscale = new Uint8Array(width * height);
            for (let index = 0, pixel = 0; pixel < grayscale.length; index += 4, pixel += 1) {
              grayscale[pixel] = rgba[index];
            }
            if (requestSeqRef.current !== seq) return;
            const request: CutoutRegionWorkerRequest = {
              category: categoryMeta.category,
              width,
              height,
              mask: grayscale.buffer,
              indexMaxEdge: INDEX_MAX_EDGE,
            };
            worker.postMessage(request, [grayscale.buffer]);
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError")
              return;
            console.warn(
              `[cutout] 类别 ${categoryMeta.category} 的 Mask 加载失败，跳过`,
              error,
            );
          }
        })();
      }
    },
    [ensureWorker],
  );

  const prepareSession = useCallback(
    async (assetId: string, isRetry: boolean) => {
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      resetEditorState();
      setPhase("preparing");
      const startedAt = Date.now();
      openedAtRef.current = startedAt;
      if (!isRetry) trackCutoutEvent("cutout_open", { assetId });

      try {
        const response = await fetch("/api/cutout-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId, scene: "garment" }),
          signal: controller.signal,
        });
        const data = await readJsonResponse<{ session: CutoutSessionDto }>(
          response,
          "智能抠图初始化失败",
        );
        if (requestSeqRef.current !== seq) return;
        if (!data.session?.sessionId) {
          throw new Error("智能抠图初始化结果不完整，请重试");
        }

        initMaskCanvases(data.session.imageWidth, data.session.imageHeight);
        setSession(data.session);
        setPhase("ready");
        trackCutoutEvent("cutout_prepare_success", {
          durationMs: Date.now() - startedAt,
          imageWidth: data.session.imageWidth,
          imageHeight: data.session.imageHeight,
          originalWidth: data.session.originalWidth,
          originalHeight: data.session.originalHeight,
          categoryCount: data.session.categories.length,
        });
        loadBaseImage(sessionImageApiPath(data.session.sessionId), seq);
        loadCategoryMasks(data.session, seq, controller.signal);
      } catch (error) {
        if (requestSeqRef.current !== seq) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        const mapped = toEditorError(error, "智能抠图初始化失败");
        setPhase("idle");
        setPrepareError(mapped);
        trackCutoutEvent("cutout_prepare_failed", {
          durationMs: Date.now() - startedAt,
          code: mapped.code,
        });
      }
    },
    [initMaskCanvases, loadBaseImage, loadCategoryMasks, resetEditorState],
  );

  // —— 打开 / 关闭 ——
  useEffect(() => {
    if (!open || !imageAssetId) return;
    void prepareSession(imageAssetId, false);
  }, [open, imageAssetId, prepareSession]);

  useEffect(() => {
    if (open) return;
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setConfirmOpen(false);
    setAutoMenuOpen(false);
  }, [open]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      workerRef.current?.terminate();
    },
    [],
  );

  // 底图 URL 变化（会话就绪 / 重开）时重置左画布加载状态。
  useEffect(() => {
    if (!open) return;
    setLeftStatus("loading");
  }, [leftImageUrl, open]);

  // 底图加载完成后自适应画布。
  useEffect(() => {
    if (!open || leftStatus !== "loaded") return;
    applyFit();
  }, [open, leftStatus, applyFit, session?.sessionId]);

  // 工作尺寸变化时重建 overlay 画布内容。
  useEffect(() => {
    scheduleRender();
    scheduleHoverDraw();
  }, [workWidth, workHeight, scheduleRender, scheduleHoverDraw]);

  // 双画布滚动联动（PRD §16）。
  useEffect(() => {
    if (!open) return;
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    if (!left || !right) return;
    const syncTo =
      (source: HTMLDivElement, target: HTMLDivElement) => () => {
        if (target.scrollLeft !== source.scrollLeft)
          target.scrollLeft = source.scrollLeft;
        if (target.scrollTop !== source.scrollTop)
          target.scrollTop = source.scrollTop;
      };
    const leftToRight = syncTo(left, right);
    const rightToLeft = syncTo(right, left);
    left.addEventListener("scroll", leftToRight, { passive: true });
    right.addEventListener("scroll", rightToLeft, { passive: true });
    return () => {
      left.removeEventListener("scroll", leftToRight);
      right.removeEventListener("scroll", rightToLeft);
    };
  }, [open]);

  // 空格临时拖动（PRD §17.2）。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setIsSpacePressed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [open]);

  // —— 导出 ——
  const handleComplete = useCallback(async () => {
    if (!session || phase !== "ready" || !hasSelection) return;
    const final = finalCanvasRef.current;
    if (!final) return;
    setPhase("exporting");
    setExportError(null);
    const startedAt = Date.now();
    try {
      const maskDataUrl = final.toDataURL("image/png");
      const response = await fetch(
        `/api/cutout-sessions/${encodeURIComponent(session.sessionId)}/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maskDataUrl }),
        },
      );
      const data = await readJsonResponse<CutoutExportResponse>(
        response,
        "透明图层生成失败",
      );
      if (!data.asset?.assetId || !data.asset.url) {
        throw new Error("导出结果缺少可用图片，请重试");
      }
      trackCutoutEvent("cutout_complete", {
        durationMs: Date.now() - openedAtRef.current,
        exportDurationMs: Date.now() - startedAt,
        originalWidth: session.originalWidth,
        originalHeight: session.originalHeight,
        operations: pastRef.current.length,
      });
      onApply(data.asset);
      onOpenChange(false);
    } catch (error) {
      const mapped = toEditorError(error, "透明图层生成失败");
      setPhase("ready");
      setExportError(mapped);
      trackCutoutEvent("cutout_export_failed", { code: mapped.code });
    }
  }, [hasSelection, onApply, onOpenChange, phase, session]);

  // —— 关闭确认（PRD §20） ——
  const requestClose = useCallback(() => {
    if (exporting) return;
    if (hasSelection || pastRef.current.length > 0) {
      setConfirmOpen(true);
      return;
    }
    onOpenChange(false);
  }, [exporting, hasSelection, onOpenChange]);

  const handleDiscard = useCallback(() => {
    trackCutoutEvent("cutout_cancel", { operations: pastRef.current.length });
    setConfirmOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      requestClose();
    },
    [onOpenChange, requestClose],
  );

  // —— 渲染 ——
  const canUndo = historyVersion >= 0 && pastRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoRef.current.length > 0;
  void regionsVersion;
  let totalRegions = 0;
  for (const data of categoriesRef.current.values()) {
    totalRegions += data.regions.size;
  }
  const completeDisabled =
    !canEdit || !hasSelection || exporting || leftStatus !== "loaded";
  const brushVisible = tool === "paint" || tool === "erase";
  const canvasCursor = panMode || isSpacePressed ? "cursor-grab active:cursor-grabbing" : brushVisible ? "cursor-none" : "cursor-crosshair";

  const toolButton = (
    toolId: EditorTool,
    Icon: typeof CirclePlus,
    danger = false,
  ) => {
    const active = tool === toolId;
    return (
      <button
        key={toolId}
        type="button"
        onClick={() => setTool(toolId)}
        disabled={!canEdit}
        aria-pressed={active}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 md:px-3",
          active
            ? danger
              ? "border-destructive/60 bg-destructive/10 text-destructive"
              : "border-primary/60 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="hidden sm:inline">{TOOL_TIPS[toolId].label}</span>
      </button>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none"
        >
          <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 md:px-4">
            <button
              type="button"
              onClick={requestClose}
              disabled={exporting}
              className={iconButtonClass}
              aria-label="关闭服饰智能分层编辑器"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">
                服饰智能分层
              </DialogTitle>
              <p className="truncate text-xs text-muted-foreground">
                {image?.name || "当前图片"}
              </p>
            </div>
            <div className="mx-auto flex items-center gap-1.5">
              {toolButton("add", CirclePlus)}
              {toolButton("subtract", CircleMinus, true)}
              {toolButton("paint", Paintbrush)}
              {toolButton("erase", Eraser)}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAutoMenuOpen((value) => !value)}
                  disabled={!canEdit}
                  aria-haspopup="menu"
                  aria-expanded={autoMenuOpen}
                  title="自动选区：一键选择主体/上装/下装"
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 md:px-3",
                    autoMenuOpen && "border-primary/60 bg-primary/10 text-primary",
                  )}
                >
                  <Wand2 className="h-4 w-4" />
                  <span className="hidden sm:inline">自动选区</span>
                </button>
                {autoMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setAutoMenuOpen(false)}
                      aria-hidden
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-card p-1 shadow-lg"
                    >
                      {(
                        [
                          ["common", "智能抠图（主体）"],
                          ["upper", "上装"],
                          ["lower", "下装"],
                        ] as const
                      ).map(([kind, label]) => (
                        <button
                          key={kind}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAutoMenuOpen(false);
                            handleAutoSelect(kind);
                          }}
                          className="flex w-full items-center rounded-md px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleInvert}
                disabled={!canEdit || !hasSelection}
                title="反选选区"
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 md:px-3",
                )}
              >
                <Contrast className="h-4 w-4" />
                <span className="hidden sm:inline">反选</span>
              </button>
              {brushVisible && (
                <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
                  笔刷
                  <input
                    type="range"
                    min={BRUSH_MIN}
                    max={BRUSH_MAX}
                    value={brushSize}
                    onChange={(event) => setBrushSize(Number(event.target.value))}
                    className="w-24 md:w-32"
                    aria-label="笔刷大小"
                  />
                  <span className="w-8 text-right tabular-nums">
                    {brushSize}
                  </span>
                </label>
              )}
            </div>
            <div className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
              {phase === "preparing" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  智能抠图准备中
                </>
              )}
              {phase === "ready" && totalRegions > 0 && (
                <>已识别 {totalRegions} 个可点选区域</>
              )}
              {phase === "ready" && totalRegions === 0 && (
                <>未识别到可点选区域，可用涂抹选区手动完成</>
              )}
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
            <ImageCanvasViewport
              scrollRef={leftScrollRef}
              imageUrl={leftImageUrl}
              imageAlt={image?.name || "待抠图图片"}
              displayWidth={displaySize.width}
              displayHeight={displaySize.height}
              imageStatus={leftStatus}
              onImageStatusChange={setLeftStatus}
              onWheel={(event) => handleWheel(event, "left")}
              className="min-h-[38vh] flex-1 bg-secondary/60 md:min-h-0"
              stageClassName="ring-1 ring-border"
              loadingMessage="图片加载中..."
              errorMessage="图片加载失败，请检查网络后重试"
            >
              <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full border border-border bg-background/85 px-2 py-0.5 text-[11px] text-muted-foreground">
                原图选区
              </span>
              <canvas
                ref={tintCanvasRef}
                width={workWidth}
                height={workHeight}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
              <canvas
                ref={hoverCanvasRef}
                width={workWidth}
                height={workHeight}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={stopPanAndStroke}
                onPointerCancel={stopPanAndStroke}
                onPointerLeave={handleCanvasPointerLeave}
                onContextMenu={(event) => event.preventDefault()}
                className={cn(
                  "absolute inset-0 h-full w-full touch-none",
                  leftStatus !== "loaded" || phase === "preparing"
                    ? "pointer-events-none"
                    : canvasCursor,
                )}
              />
              {phase === "preparing" && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/60 text-sm font-medium text-foreground backdrop-blur-[1px]">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  智能抠图准备中……
                </div>
              )}
              {prepareError && phase === "idle" && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-4 backdrop-blur-[1px]">
                  <div className="w-full max-w-sm space-y-3 rounded-lg border border-destructive/40 bg-card p-4 shadow-lg">
                    <p className="text-sm font-medium text-destructive">
                      智能抠图准备失败
                    </p>
                    <p className="text-xs leading-relaxed text-foreground">
                      {prepareError.message}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {prepareError.advice}
                    </p>
                    <div className="flex items-center gap-2">
                      {prepareError.retryable && imageAssetId && (
                        <button
                          type="button"
                          onClick={() =>
                            void prepareSession(imageAssetId, true)
                          }
                          className="h-8 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          重试
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="h-8 rounded-md border border-border bg-card px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {canEdit && !exporting && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/85 px-3 py-1.5 text-xs text-muted-foreground">
                  {hasSelection
                    ? TOOL_TIPS[tool].hint
                    : pastRef.current.length > 0
                      ? "当前选区为空，请重新选择需要保留的区域"
                      : totalRegions > 0
                        ? "点击图片中需要保留的区域"
                        : workerFailedRef.current
                          ? "智能识别暂时不可用，仍可以使用画笔手动完成选区"
                          : "智能识别暂未识别到可点选区域，可用涂抹选区手动完成"}
                </div>
              )}
            </ImageCanvasViewport>

            <ImageCanvasViewport
              scrollRef={rightScrollRef}
              imageUrl={TRANSPARENT_PIXEL_URL}
              imageAlt="透明图层预览"
              displayWidth={displaySize.width}
              displayHeight={displaySize.height}
              imageStatus={rightStatus}
              onImageStatusChange={setRightStatus}
              onWheel={(event) => handleWheel(event, "right")}
              checkerboard
              className="min-h-[38vh] flex-1 bg-secondary/60 md:min-h-0 md:border-l md:border-border"
              stageClassName="ring-1 ring-border"
              loadingMessage="预览初始化中..."
              errorMessage="预览初始化失败，请重新打开编辑器"
            >
              <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full border border-border bg-background/85 px-2 py-0.5 text-[11px] text-muted-foreground">
                透明预览
              </span>
              <canvas
                ref={previewCanvasRef}
                width={workWidth}
                height={workHeight}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={stopPanAndStroke}
                onPointerCancel={stopPanAndStroke}
                className={cn(
                  "absolute inset-0 h-full w-full touch-none",
                  panMode || isSpacePressed
                    ? "cursor-grab active:cursor-grabbing"
                    : "cursor-default",
                )}
              />
            </ImageCanvasViewport>

            <aside className="hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 md:flex">
              <div>
                <p className="text-xs font-medium text-foreground">
                  抠图小技巧
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {TOOL_TIPS[tool].hint}
                </p>
              </div>
              <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <p>· 上衣、裤子、鞋包等区域可整片点选加入或移除</p>
                <p>· 涂抹与擦除用于修正智能识别的边缘细节</p>
                <p>· Ctrl+滚轮缩放画布，按住空格或鼠标中键拖动</p>
                <p>· 反选可快速交换保留区与透明区</p>
              </div>
              <div className="rounded-md border border-border bg-secondary/70 p-3">
                <p className="text-xs font-medium text-foreground">正确案例</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  边缘完整、无背景残留的抠图，后续换装与展示效果较好。
                </p>
              </div>
              <div className="rounded-md border border-border bg-secondary/70 p-3">
                <p className="text-xs font-medium text-foreground">错误案例</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  带背景残留、皮肤残留或边缘缺损的抠图，后续使用效果较差。
                </p>
              </div>
            </aside>

            {exporting && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-background/60 text-sm font-medium text-foreground backdrop-blur-[1px]">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                正在生成透明图层……
              </div>
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2.5 md:px-4">
            {exportError && (
              <div className="flex w-full items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-xs text-destructive">
                  {exportError.message}。{exportError.advice}
                </p>
                {exportError.retryable && (
                  <button
                    type="button"
                    onClick={() => void handleComplete()}
                    className="shrink-0 text-xs font-medium text-primary hover:underline"
                  >
                    重试导出
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExportError(null)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="关闭错误提示"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={applyFit}
                disabled={leftStatus !== "loaded"}
                className={iconButtonClass}
                aria-label="适应画布"
                title="适应画布"
              >
                <Maximize className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPanMode((value) => !value)}
                aria-pressed={panMode}
                className={cn(
                  iconButtonClass,
                  panMode && "border-primary/60 bg-primary/10 text-primary",
                )}
                aria-label="拖动画布"
                title="拖动画布（也可按住空格或鼠标中键）"
              >
                <Hand className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  zoomTo(zoomRef.current - ZOOM_STEP, "left")
                }
                className={iconButtonClass}
                aria-label="缩小"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() =>
                  zoomTo(zoomRef.current + ZOOM_STEP, "left")
                }
                className={iconButtonClass}
                aria-label="放大"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo || !canEdit}
                className={iconButtonClass}
                aria-label="撤销"
                title="撤销"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo || !canEdit}
                className={iconButtonClass}
                aria-label="重做"
                title="重做"
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={
                  !canEdit || (!hasSelection && !canUndo)
                }
                className={iconButtonClass}
                aria-label="重置选区"
                title="重置选区"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                disabled={exporting}
                className="h-9 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={completeDisabled}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting && <Loader2 className="h-4 w-4 animate-spin" />}
                {exporting ? "导出中…" : "完成"}
              </button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              当前抠图结果尚未保存，确认退出吗？
            </AlertDialogTitle>
            <AlertDialogDescription>
              退出后本次选区修改将丢失，已成功导出的图片不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              放弃并退出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const iconButtonClass =
  "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
