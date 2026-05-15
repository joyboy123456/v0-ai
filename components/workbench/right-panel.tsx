'use client'

import { useState } from 'react'
import { Download, Star, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CATEGORIES, MOCK_GALLERY_IMAGES, type GeneratedImage, type FeatureType } from '@/lib/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface RightPanelProps {
  feature: FeatureType
}

export function RightPanel({ feature }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'history' | 'gallery'>('gallery')
  const [showCurrentFeature, setShowCurrentFeature] = useState(true)
  const [showFavorites, setShowFavorites] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null)

  // Filter images based on current feature if checkbox is checked
  const filteredImages = MOCK_GALLERY_IMAGES.filter(img => {
    if (showFavorites && !img.favorite) return false
    return true
  })

  const featureLabel = {
    'element-replace': '服装大片裂变',
    'detail-fission': '服装详情图裂变',
    'photo-fission': '服装大片裂变',
    'pose-fission': '姿势裂变'
  }[feature]

  const hasImages = filteredImages.length > 0

  return (
    <div className="flex-1 min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-6 p-4 border-b border-border">
        {/* Tabs */}
        <div className="flex items-center gap-1 bg-secondary rounded-full p-1">
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              'px-4 py-1.5 text-sm rounded-full transition-colors',
              activeTab === 'history'
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            历史记录
          </button>
          <button
            onClick={() => setActiveTab('gallery')}
            className={cn(
              'px-4 py-1.5 text-sm rounded-full transition-colors',
              activeTab === 'gallery'
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            案例库
          </button>
        </div>

        {/* Checkboxes */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCurrentFeature}
              onChange={(e) => setShowCurrentFeature(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-secondary accent-primary"
            />
            <span className="text-sm text-muted-foreground">仅看当前功能</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showFavorites}
              onChange={(e) => setShowFavorites(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-secondary accent-primary"
            />
            <span className="text-sm text-muted-foreground">仅看收藏</span>
          </label>
        </div>
      </div>

      {/* Category filters */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={cn(
              'px-3 py-1 text-sm rounded-full border transition-colors',
              selectedCategory === cat.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            )}
          >
            {cat.id === 'all' && <ChevronDown className="w-3 h-3 inline mr-1" />}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Gallery content */}
      <div className="flex-1 overflow-y-auto p-4">
        {hasImages ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredImages.map((image) => (
              <div
                key={image.id}
                className="group relative aspect-[3/4] rounded-lg overflow-hidden bg-card border border-border cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setPreviewImage(image)}
              >
                <img
                  src={image.url}
                  alt=""
                  className="w-full h-full object-cover"
                />
                
                {/* Feature label */}
                <div className="absolute top-2 left-2">
                  <span className="px-2 py-0.5 text-[10px] bg-primary/80 text-primary-foreground rounded">
                    {image.feature}
                  </span>
                </div>

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-2 right-2 flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        // Toggle favorite
                      }}
                      className="w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
                    >
                      <Star className={cn(
                        'w-4 h-4',
                        image.favorite ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'
                      )} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        // Download
                        window.open(image.url, '_blank')
                      }}
                      className="w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
                    >
                      <Download className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>

                {/* Similar button on first image */}
                {image.id === '1' && (
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                    <button className="w-full py-1.5 text-xs text-center bg-muted/80 rounded text-foreground hover:bg-muted transition-colors">
                      做同款
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-20">
            <div className="w-20 h-20 mb-4 text-muted-foreground">
              {/* UFO icon */}
              <svg viewBox="0 0 100 100" fill="currentColor" className="w-full h-full opacity-30">
                <ellipse cx="50" cy="60" rx="40" ry="12" />
                <ellipse cx="50" cy="55" rx="30" ry="20" />
                <circle cx="35" cy="52" r="3" fill="white" />
                <circle cx="50" cy="50" r="3" fill="white" />
                <circle cx="65" cy="52" r="3" fill="white" />
                <path d="M50 30 Q45 45 50 55 Q55 45 50 30" />
              </svg>
            </div>
            <p className="text-lg text-muted-foreground">暂无匹配案例</p>
          </div>
        )}
      </div>

      {/* Preview modal */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent showCloseButton={false} className="max-w-3xl bg-card border-border p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {previewImage && (
            <div className="relative">
              <img
                src={previewImage.url}
                alt=""
                className="w-full h-auto max-h-[80vh] object-contain"
              />
              <div className="absolute top-4 right-4 flex gap-2">
                <button
                  onClick={() => window.open(previewImage.url, '_blank')}
                  className="w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setPreviewImage(null)}
                  className="w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
