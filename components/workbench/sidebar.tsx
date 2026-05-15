'use client'

import { Camera, Replace, LayoutGrid, PersonStanding, FolderOpen, ClipboardList, Star, BookOpen, HelpCircle, Shirt } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FEATURES, type FeatureType } from '@/lib/types'

interface SidebarProps {
  currentFeature: FeatureType
  onFeatureChange: (feature: FeatureType) => void
}

const featureIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  camera: Camera,
  replace: Replace,
  grid: LayoutGrid,
  pose: PersonStanding,
}

export function Sidebar({ currentFeature, onFeatureChange }: SidebarProps) {
  return (
    <aside className="w-60 min-h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Shirt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-sidebar-foreground">AI服装电商</h1>
            <p className="text-xs text-muted-foreground">智能生成，高效出图</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3">
        {/* 创作 Section */}
        <div className="mb-6">
          <h2 className="text-xs font-medium text-muted-foreground px-3 mb-2">创作</h2>
          <ul className="space-y-1">
            {FEATURES.map((feature) => {
              const Icon = featureIcons[feature.icon]
              const isActive = currentFeature === feature.id
              return (
                <li key={feature.id}>
                  <button
                    onClick={() => onFeatureChange(feature.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200',
                      isActive 
                        ? 'bg-primary/10 text-primary border-l-2 border-primary' 
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{feature.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {/* 管理 Section */}
        <div>
          <h2 className="text-xs font-medium text-muted-foreground px-3 mb-2">管理</h2>
          <ul className="space-y-1">
            <li>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
                <FolderOpen className="w-4 h-4" />
                <span>素材管理</span>
              </button>
            </li>
            <li>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
                <ClipboardList className="w-4 h-4" />
                <span>任务记录</span>
              </button>
            </li>
            <li>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
                <Star className="w-4 h-4" />
                <span>我的收藏</span>
              </button>
            </li>
          </ul>
        </div>
      </nav>

      {/* Bottom Section */}
      <div className="p-3 border-t border-sidebar-border">
        <ul className="space-y-1">
          <li>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
              <BookOpen className="w-4 h-4" />
              <span>使用教程</span>
            </button>
          </li>
          <li>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
              <HelpCircle className="w-4 h-4" />
              <span>帮助中心</span>
            </button>
          </li>
        </ul>
      </div>
    </aside>
  )
}
