"use client"

import { 
  ImageIcon, 
  Layers, 
  LayoutGrid, 
  Move3D,
  HelpCircle,
  BookOpen
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
    label: '服装大片 - 元素替换',
    icon: ImageIcon,
  },
  {
    id: 'detail-fission' as FeatureType,
    label: '服装详情图裂变',
    icon: LayoutGrid,
  },
  {
    id: 'photo-fission' as FeatureType,
    label: '服装大片裂变',
    icon: Layers,
  },
  {
    id: 'pose-fission' as FeatureType,
    label: '姿势裂变',
    icon: Move3D,
  },
]

export function FeatureSidebar({ activeFeature, onFeatureChange }: FeatureSidebarProps) {
  return (
    <div className="w-[72px] h-screen bg-[#0a0d11] border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center justify-center border-b border-border">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-sm">AI</span>
        </div>
      </div>

      {/* Feature navigation */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {features.map((feature) => {
            const Icon = feature.icon
            const isActive = activeFeature === feature.id
            return (
              <li key={feature.id}>
                <button
                  onClick={() => onFeatureChange(feature.id)}
                  className={cn(
                    "w-full aspect-square rounded-lg flex flex-col items-center justify-center gap-1 transition-all group relative",
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {/* Tooltip */}
                  <div className="absolute left-full ml-2 px-2 py-1 bg-popover border border-border rounded text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                    {feature.label}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Bottom actions */}
      <div className="py-4 px-2 space-y-1 border-t border-border">
        <button className="w-full aspect-square rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors group relative">
          <BookOpen className="w-5 h-5" />
          <div className="absolute left-full ml-2 px-2 py-1 bg-popover border border-border rounded text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            使用教程
          </div>
        </button>
        <button className="w-full aspect-square rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors group relative">
          <HelpCircle className="w-5 h-5" />
          <div className="absolute left-full ml-2 px-2 py-1 bg-popover border border-border rounded text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            帮助中心
          </div>
        </button>
      </div>
    </div>
  )
}
