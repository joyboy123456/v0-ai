'use client'

import { useState, useCallback } from 'react'
import { UploadPanel } from './upload-panel'
import { GenerationSettingsPanel } from './generation-settings'
import { GenerateButton } from './generate-button'
import { ResultPanel } from './result-panel'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { FeatureType, UploadedImage, GenerationSettings, GeneratedImage } from '@/lib/types'
import { MOCK_GENERATED_IMAGES } from '@/lib/types'

interface WorkbenchProps {
  currentFeature: FeatureType
}

const DEFAULT_SETTINGS: GenerationSettings = {
  sceneStyle: 'all',
  modelType: 'all',
  count: 8,
  aspectRatio: '3:4',
  replaceType: 'background',
  replaceStrength: 'medium',
  backgroundType: 'solid',
  variationDirection: 'angle',
  poseType: 'standing',
  cameraAngle: 'full',
}

// Default product image to show on initial load
const DEFAULT_PRODUCT_IMAGE: UploadedImage = {
  id: 'default-1',
  file: new File([], '产品图.jpg'),
  preview: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=200&h=280&fit=crop',
  name: '产品图.jpg'
}

export function Workbench({ currentFeature }: WorkbenchProps) {
  const [productImages, setProductImages] = useState<UploadedImage[]>([DEFAULT_PRODUCT_IMAGE])
  const [modelImages, setModelImages] = useState<UploadedImage[]>([])
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS)
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>(MOCK_GENERATED_IMAGES)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleGenerate = useCallback(() => {
    if (productImages.length === 0) {
      alert('请先上传产品图')
      return
    }

    setIsGenerating(true)
    setGeneratedImages([])

    // Simulate generation
    setTimeout(() => {
      setGeneratedImages(MOCK_GENERATED_IMAGES.slice(0, settings.count))
      setIsGenerating(false)
    }, 2000)
  }, [productImages, settings.count])

  const handleClear = useCallback(() => {
    setGeneratedImages([])
  }, [])

  return (
    <div className="flex-1 flex gap-6 p-6 min-h-0">
      {/* Left: Config Panel */}
      <div className="w-[380px] flex flex-col gap-6 overflow-y-auto">
        <div className="bg-card border border-border rounded-xl p-5 space-y-6">
          <UploadPanel
            productImages={productImages}
            modelImages={modelImages}
            onProductImagesChange={setProductImages}
            onModelImagesChange={setModelImages}
          />

          <div className="border-t border-border" />

          <GenerationSettingsPanel
            feature={currentFeature}
            settings={settings}
            onSettingsChange={setSettings}
          />

          {/* Advanced Settings Toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            高级设置
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showAdvanced && (
            <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
              高级设置功能开发中...
            </div>
          )}
        </div>

        <GenerateButton
          isGenerating={isGenerating}
          estimatedCount={settings.count}
          onGenerate={handleGenerate}
          disabled={productImages.length === 0}
        />
      </div>

      {/* Right: Results Panel */}
      <div className="flex-1 bg-card border border-border rounded-xl p-5 min-h-0 flex flex-col">
        <ResultPanel
          images={generatedImages}
          isGenerating={isGenerating}
          generatingCount={settings.count}
          onClear={handleClear}
        />
      </div>
    </div>
  )
}
