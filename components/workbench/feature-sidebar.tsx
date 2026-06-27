"use client";

import { useState } from "react";
import { Camera, LogOut, PersonStanding, Repeat2, Trash2 } from "lucide-react";
import { CleanupDialog } from "./cleanup-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { FEATURES, type FeatureType } from "@/lib/types";

interface FeatureSidebarProps {
  activeFeature: FeatureType;
  onFeatureChange: (feature: FeatureType) => void;
  user: AuthUser | null;
  isAuthLoading: boolean;
  onLogout: () => Promise<void>;
  onRefreshTasks: () => void;
}

const featureIcons = {
  "ai-fashion-photo": Camera,
  "photo-fission": Repeat2,
  "pose-fission": PersonStanding,
} satisfies Record<FeatureType, typeof Camera>;

export function FeatureSidebar({
  activeFeature,
  onFeatureChange,
  user,
  isAuthLoading,
  onLogout,
  onRefreshTasks,
}: FeatureSidebarProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const displayName = user?.displayName || user?.username || "未登录";
  const username = user?.username ?? "请先登录";
  const avatarLabel = (displayName || username).slice(0, 1).toUpperCase();

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <aside className="w-[260px] h-screen bg-sidebar backdrop-blur-md border-r border-border flex flex-col shrink-0 shadow-sm z-10">
      <div className="px-6 py-6 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--color-brand-primary)]" />
          <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            AI Workspace
          </p>
        </div>
        <h1 className="text-base font-semibold text-foreground tracking-tight">
          <span className="text-primary font-bold">智能生成</span>工作台
        </h1>
      </div>

      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-1.5">
          {FEATURES.map((feature) => {
            const Icon = featureIcons[feature.id];
            const isActive = activeFeature === feature.id;
            const isComingSoon = feature.status === "coming-soon";

            return (
              <li key={feature.id}>
                <button
                  onClick={() => onFeatureChange(feature.id)}
                  className={cn(
                    "w-full p-2 flex items-start gap-3 rounded-xl transition-all text-left group relative",
                    isActive
                      ? "bg-accent/80 text-primary shadow-sm border border-sky-100/50"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {isActive && (
                    <div className="absolute left-1 top-2.5 bottom-2.5 w-1 rounded-full bg-primary shadow-[0_0_8px_var(--color-brand-primary)]" />
                  )}
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                      isActive
                        ? "bg-white text-primary shadow-xs"
                        : "bg-transparent text-muted-foreground group-hover:text-primary",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-[13px] font-semibold transition-colors",
                          isActive
                            ? "text-primary"
                            : "text-slate-700 group-hover:text-slate-900",
                        )}
                      >
                        {feature.name}
                      </span>
                      {isComingSoon && (
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                          Beta
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed transition-colors group-hover:text-slate-500">
                      {feature.description}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3 space-y-2">
        <button
          onClick={() => setCleanupOpen(true)}
          className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-[12px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <Trash2 className="size-3.5" />
          清理生成图
        </button>
        <div className="flex items-center gap-3 rounded-md bg-secondary/50 p-2.5 hover:bg-secondary transition-colors">
          <Avatar className="size-8 border border-border bg-white shadow-sm">
            <AvatarFallback className="bg-secondary text-[11px] font-medium text-foreground">
              {isAuthLoading ? "…" : avatarLabel}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">
              {isAuthLoading ? "正在读取账号" : displayName}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {isAuthLoading ? "请稍候" : username}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-primary hover:bg-accent"
            onClick={handleLogout}
            disabled={loggingOut || isAuthLoading}
            aria-label="退出登录"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>

      <CleanupDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        onRefreshTasks={onRefreshTasks}
      />
    </aside>
  );
}
