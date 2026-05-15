'use client'

import { useState } from 'react'
import { LeftPanel } from './left-panel'
import { RightPanel } from './right-panel'
import { FEATURES, type FeatureType } from '@/lib/types'

export function Workbench() {
  const [currentFeature, setCurrentFeature] = useState<FeatureType>('element-replace')
  const [isGenerating, setIsGenerating] = useState(false)

  const currentFeatureData = FEATURES.find(f => f.id === currentFeature)
  const credits = currentFeatureData?.credits || 35

  const handleGenerate = () => {
    setIsGenerating(true)
    // Simulate generation
    setTimeout(() => {
      setIsGenerating(false)
    }, 2000)
  }

  return (
    <div className="flex min-h-screen bg-background">
      <LeftPanel
        feature={currentFeature}
        credits={credits}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
      />
      <RightPanel feature={currentFeature} />
    </div>
  )
}
