'use client'

import { Camera, Replace, LayoutGrid, PersonStanding, BookOpen } from 'lucide-react'
import { FEATURES, type FeatureType } from '@/lib/types'
import { Button } from '@/components/ui/button'

interface FeatureHeaderProps {
  currentFeature: FeatureType
}

const featureIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  camera: Camera,
  replace: Replace,
  grid: LayoutGrid,
  pose: PersonStanding,
}

export function FeatureHeader({ currentFeature }: FeatureHeaderProps) {
  const feature = FEATURES.find(f => f.id === currentFeature)
  if (!feature) return null
  
  const Icon = featureIcons[feature.icon]

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">{feature.name}</h1>
          <p className="text-sm text-muted-foreground">{feature.description}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="gap-2 border-border hover:bg-muted">
        <BookOpen className="w-4 h-4" />
        使用教程
      </Button>
    </div>
  )
}
