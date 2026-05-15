"use client"

import { 
  Repeat2,
  Copy, 
  PersonStanding,
  LayoutGrid,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FeatureType } from '@/lib/types'

interface FeatureSidebarProps {
  activeFeature: FeatureType
  onFeatureChange: (feature: FeatureType) => void
}

const features = [
  {
    id: 'element-replace' as FeatureType,
    label: '服装大片-元素替换',
    description: '一键替换服装大片中的元素，支持替换服装、模特脸部、背景',
    icon: Repeat2,
  },
  {
    id: 'photo-fission' as FeatureType,
    label: '服装大片裂变',
    description: '一张大片生成多角度多姿势套图',
    icon: Copy,
  },
  {
    id: 'pose-fission' as FeatureType,
    label: '姿势裂变',
    description: '1张服装模特图衍生不同模特姿势和拍摄角度，提供大量姿势选择',
    icon: PersonStanding,
  },
  {
    id: 'detail-fission' as FeatureType,
    label: '服装详情图裂变',
    description: '1张服装产品图衍生不同形式的电商产品详情页细节图',
    icon: LayoutGrid,
  },
]

export function FeatureSidebar({ activeFeature, onFeatureChange }: FeatureSidebarProps) {
  return (
    <div className="w-[240px] h-screen bg-[#0a0d11] border-r border-border flex flex-col shrink-0">
      {/* Feature navigation */}
      <nav className="flex-1 py-2">
        <ul className="space-y-1">
          {features.map((feature) => {
            const Icon = feature.icon
            const isActive = activeFeature === feature.id
            return (
              <li key={feature.id}>
                <button
                  onClick={() => onFeatureChange(feature.id)}
                  className={cn(
                    "w-full px-4 py-3 flex items-start gap-3 transition-all text-left",
                    isActive 
                      ? "bg-secondary/50 border-l-2 border-primary" 
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 border-l-2 border-transparent"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                    isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
                  )}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "font-medium text-sm",
                      isActive ? "text-foreground" : "text-foreground/80"
                    )}>
                      {feature.label}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                      {feature.description}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
