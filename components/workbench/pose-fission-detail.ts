type PoseBodyPart = "full" | "upper" | "lower";

export const POSE_BODY_PART_LABELS: Record<PoseBodyPart, string> = {
  full: "全身",
  upper: "上半身",
  lower: "下半身",
};

export interface PoseFissionDetailPose {
  id: string;
  url: string;
  name: string;
  bodyPart: PoseBodyPart;
}

function isPoseBodyPart(value: unknown): value is PoseBodyPart {
  return value === "full" || value === "upper" || value === "lower";
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 从任务 params 读取姿势裂变当时选用的姿势。
 * 姿势图不在 inputAssets 里，只存在 params.poses；姿势库条目删除后仍可回看。
 */
export function readPoseFissionDetailPoses(
  params: unknown,
): PoseFissionDetailPose[] {
  if (!params || typeof params !== "object") return [];
  const poses = (params as { poses?: unknown }).poses;
  if (!Array.isArray(poses)) return [];

  const seen = new Set<string>();
  const result: PoseFissionDetailPose[] = [];
  for (const item of poses) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = readTrimmedString(record.id);
    const url = readTrimmedString(record.url);
    const name = readTrimmedString(record.name) || "未命名姿势";
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      url,
      name,
      bodyPart: isPoseBodyPart(record.bodyPart) ? record.bodyPart : "full",
    });
  }
  return result;
}

export function getPoseFissionInputAssetLabel(options: {
  index: number;
  assetCount: number;
  hasFrontDetail?: boolean;
  hasBackDetail?: boolean;
}): string {
  const { index, assetCount, hasFrontDetail, hasBackDetail } = options;
  if (index === 0) return "主图";

  const front = hasFrontDetail === true;
  const back = hasBackDetail === true;
  const inferredBothDetails = !front && !back && assetCount === 3;

  if (front && back) {
    if (index === 1) return "正面细节";
    if (index === 2) return "背面细节";
  } else if (inferredBothDetails) {
    if (index === 1) return "正面细节";
    if (index === 2) return "背面细节";
  } else if (front && index === 1) {
    return "正面细节";
  } else if (back && index === 1) {
    return "背面细节";
  }

  return `图${index + 1}`;
}

export function isCurrentPoseFissionPose(
  poseId: string,
  resultShotId?: string | null,
): boolean {
  return Boolean(resultShotId) && poseId === resultShotId;
}

/**
 * 按任务原始 inputAssetIds 槽位取角色下标。
 * hydrate 丢资产后 inputAssets 会被压缩，不能用展示下标当主图/正反细节。
 */
export function resolvePoseFissionAssetSlotIndex(
  assetId: string,
  inputAssetIds: readonly string[],
  fallbackIndex: number,
): number {
  const index = inputAssetIds.indexOf(assetId);
  return index >= 0 ? index : fallbackIndex;
}
