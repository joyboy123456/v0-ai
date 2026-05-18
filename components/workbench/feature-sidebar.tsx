"use client";

import { Camera, Layers2, PersonStanding, Repeat2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES, type FeatureType } from "@/lib/types";

interface FeatureSidebarProps {
  activeFeature: FeatureType;
  onFeatureChange: (feature: FeatureType) => void;
}

const featureIcons = {
  "ai-fashion-photo": Camera,
  "element-replace": Layers2,
  "photo-fission": Repeat2,
  "pose-fission": PersonStanding,
} satisfies Record<FeatureType, typeof Camera>;

export function FeatureSidebar({
  activeFeature,
  onFeatureChange,
}: FeatureSidebarProps) {
  return (
    <aside className="w-[260px] h-screen bg-sidebar border-r border-border flex flex-col shrink-0">
      <div className="px-6 py-6 border-b border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
          <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            AI Workspace
          </p>
        </div>
        <h1 className="text-base font-semibold text-foreground tracking-tight">
          智能生成工作台
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
                    "w-full p-2.5 flex items-start gap-3 rounded-md transition-colors text-left group",
                    isActive
                      ? "bg-white/[0.06] text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "bg-transparent text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-[13px] font-medium transition-colors",
                          isActive
                            ? "text-foreground"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      >
                        {feature.name}
                      </span>
                      {isComingSoon && (
                        <span className="px-1.5 py-0.5 rounded-md bg-secondary/80 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                          Beta
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-2 leading-relaxed transition-colors group-hover:text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
