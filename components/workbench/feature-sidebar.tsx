'use client'

import { Camera, Layers2, PersonStanding, Repeat2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FEATURES, type FeatureType } from '@/lib/types'

interface FeatureSidebarProps {
  activeFeature: FeatureType
  onFeatureChange: (feature: FeatureType) => void
}

const featureIcons = {
  'ai-fashion-photo': Camera,
  'element-replace': Layers2,
  'photo-fission': Repeat2,
  'pose-fission': PersonStanding,
} satisfies Record<FeatureType, typeof Camera>

export function FeatureSidebar({ activeFeature, onFeatureChange }: FeatureSidebarProps) {
  return (
    <aside className="w-[260px] h-screen bg-[#0a0d11] border-r border-border flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-border">
        <p className="text-xs text-primary">MVP 工作台</p>
        <h1 className="mt-1 text-lg font-semibold text-foreground">AI服装电商图片生成</h1>
      </div>

      <nav className="flex-1 py-2">
        <ul className="space-y-1">
          {FEATURES.map((feature) => {
            const Icon = featureIcons[feature.id]
            const isActive = activeFeature === feature.id
            const isComingSoon = feature.status === 'coming-soon'

            return (
              <li key={feature.id}>
                <button
                  onClick={() => onFeatureChange(feature.id)}
                  className={cn(
                    'w-full px-4 py-3 flex items-start gap-3 transition-all text-left border-l-2',
                    isActive
                      ? 'bg-secondary/50 border-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/30 border-transparent',
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                      isActive ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('font-medium text-sm', isActive && 'text-foreground')}>
                        {feature.name}
                      </span>
                      {isComingSoon && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                          即将上线
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
