"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  POSE_TEMPLATES_DEFAULT_TRIO,
  POSE_TEMPLATE_AGE_GROUPS,
  POSE_TEMPLATE_BODY_PARTS,
  type PoseAgeGroup,
  type PoseBodyPart,
  type PoseTemplate,
} from "@/lib/types";

const MAX_POSE_SELECTION = 9;

type AgeGroupFilter = "all" | PoseAgeGroup;
type BodyPartFilter = "all" | PoseBodyPart;

interface PoseLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PoseTemplate[];
  favorites: Set<string>;
  /** 打开 Modal 时回填的已选 ID（用户上次点「确定」时的快照）。 */
  initialSelectedIds: string[];
  onToggleFavorite: (templateId: string) => void;
  onConfirm: (selectedTemplates: PoseTemplate[]) => void;
}

/**
 * 姿势库 Modal（PRD D7 + D8 + D9）：
 * - 三组筛选（人群 / 身位 / 仅看收藏）
 * - 多选最多 9 个姿势模板
 * - 「基础搭配 3 张」一键预设
 * - 「重置」+「确定」结对
 *
 * 状态收口：Modal 内只持有 draft 状态（`internalSelectedIds` / 筛选），
 * 仅在用户点「确定」时通过 onConfirm 抛给父组件。
 */
export function PoseLibraryDialog({
  open,
  onOpenChange,
  templates,
  favorites,
  initialSelectedIds,
  onToggleFavorite,
  onConfirm,
}: PoseLibraryDialogProps) {
  const [internalSelectedIds, setInternalSelectedIds] =
    useState<string[]>(initialSelectedIds);
  const [ageGroupFilter, setAgeGroupFilter] = useState<AgeGroupFilter>("all");
  const [bodyPartFilter, setBodyPartFilter] = useState<BodyPartFilter>("all");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const wasOpenRef = useRef(false);

  // 只在「关闭 → 打开」这一刻同步父组件回填的已选 → draft，清空筛选。
  // 打开期间父组件可能因轮询、收藏等动作重渲染；不能因此覆盖用户正在多选的草稿。
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;

    wasOpenRef.current = true;
    setInternalSelectedIds([...initialSelectedIds]);
    setAgeGroupFilter("all");
    setBodyPartFilter("all");
    setOnlyFavorites(false);
  }, [open, initialSelectedIds]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      if (ageGroupFilter !== "all" && tpl.ageGroup !== ageGroupFilter)
        return false;
      if (bodyPartFilter !== "all" && tpl.bodyPart !== bodyPartFilter)
        return false;
      if (onlyFavorites && !favorites.has(tpl.id)) return false;
      return true;
    });
  }, [templates, ageGroupFilter, bodyPartFilter, onlyFavorites, favorites]);

  const selectedCount = internalSelectedIds.length;
  const atLimit = selectedCount >= MAX_POSE_SELECTION;

  const handleToggleTemplate = (templateId: string) => {
    setInternalSelectedIds((current) => {
      if (current.includes(templateId)) {
        return current.filter((id) => id !== templateId);
      }
      if (current.length >= MAX_POSE_SELECTION) {
        return current;
      }
      return [...current, templateId];
    });
  };

  const handleApplyDefaultTrio = () => {
    // 仅保留当前 POSE_TEMPLATES 中真实存在的 id（防止常量漂移）。
    const validTrio = POSE_TEMPLATES_DEFAULT_TRIO.filter((id) =>
      templates.some((tpl) => tpl.id === id),
    );
    setInternalSelectedIds(validTrio);
  };

  const handleReset = () => {
    setInternalSelectedIds([]);
  };

  const handleConfirm = () => {
    // 按 internalSelectedIds 顺序解出 template；筛掉 templates 中不存在的兜底防御。
    const ordered: PoseTemplate[] = [];
    for (const id of internalSelectedIds) {
      const tpl = templates.find((item) => item.id === id);
      if (tpl) ordered.push(tpl);
    }
    onConfirm(ordered);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(960px,95vw)] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-base font-semibold">
              姿势库
            </DialogTitle>
            <span className="text-xs text-muted-foreground">
              已选 {selectedCount} 张
              {atLimit && (
                <span className="ml-2 text-primary">（已达上限 9 张）</span>
              )}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-3 border-b border-border px-6 py-3">
          <FilterRow label="人群">
            <FilterButton
              active={ageGroupFilter === "all"}
              onClick={() => setAgeGroupFilter("all")}
            >
              全部
            </FilterButton>
            {POSE_TEMPLATE_AGE_GROUPS.map((option) => (
              <FilterButton
                key={option.id}
                active={ageGroupFilter === option.id}
                onClick={() => setAgeGroupFilter(option.id)}
              >
                {option.label}
              </FilterButton>
            ))}
          </FilterRow>

          <FilterRow label="身位">
            <FilterButton
              active={bodyPartFilter === "all"}
              onClick={() => setBodyPartFilter("all")}
            >
              全部
            </FilterButton>
            {POSE_TEMPLATE_BODY_PARTS.map((option) => (
              <FilterButton
                key={option.id}
                active={bodyPartFilter === option.id}
                onClick={() => setBodyPartFilter(option.id)}
              >
                {option.label}
              </FilterButton>
            ))}
          </FilterRow>

          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <Checkbox
                checked={onlyFavorites}
                onCheckedChange={(checked) => setOnlyFavorites(checked === true)}
              />
              仅看收藏
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleApplyDefaultTrio}
            >
              基础搭配 3 张
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {filteredTemplates.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              {onlyFavorites
                ? "你还没有收藏任何姿势模板，点击卡片右上角的星标即可收藏"
                : "没有符合筛选条件的姿势模板"}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filteredTemplates.map((template) => {
                const isSelected = internalSelectedIds.includes(template.id);
                const selectionIndex = isSelected
                  ? internalSelectedIds.indexOf(template.id) + 1
                  : null;
                const isFavorite = favorites.has(template.id);
                const isDisabled = !isSelected && atLimit;

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      if (isDisabled) return;
                      handleToggleTemplate(template.id);
                    }}
                    disabled={isDisabled}
                    className={cn(
                      "group relative overflow-hidden rounded-md border bg-background text-left transition-colors",
                      isSelected
                        ? "border-primary ring-2 ring-primary/40"
                        : isDisabled
                          ? "border-border opacity-40 cursor-not-allowed"
                          : "border-border hover:border-primary/60",
                    )}
                    title={
                      isDisabled
                        ? `最多选 ${MAX_POSE_SELECTION} 个`
                        : template.prompt
                    }
                  >
                    <div className="relative aspect-[3/4] w-full bg-secondary">
                      <img
                        src={template.imageUrl}
                        alt={template.name}
                        className="h-full w-full object-cover"
                      />
                      {selectionIndex !== null && (
                        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground shadow">
                          {selectionIndex}
                        </span>
                      )}
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={isFavorite ? "取消收藏" : "收藏"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleFavorite(template.id);
                        }}
                        className={cn(
                          "absolute left-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-background/85 transition-opacity",
                          isFavorite
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        <Star
                          className={cn(
                            "h-3.5 w-3.5",
                            isFavorite
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground",
                          )}
                        />
                      </span>
                    </div>
                    <div className="space-y-0.5 px-2 py-2">
                      <p className="truncate text-xs font-medium text-foreground">
                        {template.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {bodyPartLabel(template.bodyPart)} ·{" "}
                        {ageGroupLabel(template.ageGroup)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3">
          <span className="text-xs text-muted-foreground">
            提示：最多多选 {MAX_POSE_SELECTION} 个姿势模板
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={handleReset}>
              重置
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={selectedCount === 0}
            >
              确定（{selectedCount}）
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ageGroupLabel(ageGroup: PoseAgeGroup): string {
  return (
    POSE_TEMPLATE_AGE_GROUPS.find((option) => option.id === ageGroup)?.label ??
    ageGroup
  );
}

function bodyPartLabel(bodyPart: PoseBodyPart): string {
  return (
    POSE_TEMPLATE_BODY_PARTS.find((option) => option.id === bodyPart)?.label ??
    bodyPart
  );
}
