'use client'

import { useState } from 'react'
import { Download, Trash2, LayoutGrid, List, RefreshCw, ImageOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { GeneratedImage } from '@/lib/types'
import { ImagePreviewModal } from './image-preview-modal'

interface ResultPanelProps {
  images: GeneratedImage[]
  isGenerating: boolean
  generatingCount: number
  onClear: () => void
  onRetry?: () => void
}

type FilterTab = 'all' | 'success' | 'failed'

export function ResultPanel({ images, isGenerating, generatingCount, onClear, onRetry }: ResultPanelProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>('success')
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null)

  const filteredImages = images.filter(img => {
    if (activeTab === 'all') return true
    return img.status === activeTab
  })

  const handleBatchDownload = () => {
    alert('正在打包下载...')
  }

  const handleDownload = (image: GeneratedImage, e: React.MouseEvent) => {
    e.stopPropagation()
    const link = document.createElement('a')
    link.href = image.url
    link.download = `generated-${image.id}.jpg`
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-foreground">生成结果</h3>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleBatchDownload}
            disabled={filteredImages.length === 0}
            className="gap-1.5 border-border text-muted-foreground hover:text-foreground"
          >
            <Download className="w-4 h-4" />
            批量下载
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onClear}
            disabled={images.length === 0}
            className="gap-1.5 border-border text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-4 h-4" />
            清空
          </Button>
          <div className="flex border border-border rounded-lg overflow-hidden">
            <button className="p-2 bg-primary/10 text-primary">
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button className="p-2 hover:bg-muted text-muted-foreground">
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-4">
        {(['all', 'success', 'failed'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'text-sm transition-colors',
              activeTab === tab ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab === 'all' && '全部'}
            {tab === 'success' && '成功'}
            {tab === 'failed' && '失败'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Generating State */}
        {isGenerating && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-card border border-border rounded-lg">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <div>
                <p className="text-sm text-foreground">正在生成服装大片...</p>
                <p className="text-xs text-muted-foreground">预计需要 30-60 秒</p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: generatingCount }).map((_, i) => (
                <Skeleton key={i} className="aspect-[3/4] rounded-lg bg-muted" />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isGenerating && images.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <ImageOff className="w-8 h-8 text-muted-foreground" />
            </div>
            <h4 className="text-base font-medium text-foreground mb-2">暂无生成结果</h4>
            <p className="text-sm text-muted-foreground">上传产品图并点击立即生成后，将在这里展示结果</p>
          </div>
        )}

        {/* Results Grid */}
        {!isGenerating && filteredImages.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {filteredImages.map((image) => (
              <div
                key={image.id}
                onClick={() => image.status === 'success' && setPreviewImage(image)}
                className={cn(
                  'relative group rounded-lg overflow-hidden border border-border cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5',
                  image.status === 'failed' && 'opacity-60'
                )}
              >
                {image.status === 'success' ? (
                  <>
                    <img 
                      src={image.url} 
                      alt="生成图片"
                      className="w-full aspect-[3/4] object-cover"
                    />
                    <button
                      onClick={(e) => handleDownload(image, e)}
                      className="absolute bottom-2 right-2 w-8 h-8 rounded-lg bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background"
                    >
                      <Download className="w-4 h-4 text-foreground" />
                    </button>
                  </>
                ) : (
                  <div className="w-full aspect-[3/4] bg-muted flex flex-col items-center justify-center p-4 text-center">
                    <ImageOff className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-xs text-muted-foreground mb-2">生成失败</p>
                    <p className="text-xs text-muted-foreground mb-3">请检查图片是否清晰，或稍后重试</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRetry?.()
                      }}
                      className="gap-1 text-xs h-7"
                    >
                      <RefreshCw className="w-3 h-3" />
                      重新生成
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      <ImagePreviewModal 
        image={previewImage} 
        onClose={() => setPreviewImage(null)} 
      />
    </div>
  )
}
