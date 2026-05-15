'use client'

import { useState, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UploadedImage } from '@/lib/types'

interface UploadPanelProps {
  productImages: UploadedImage[]
  modelImages: UploadedImage[]
  onProductImagesChange: (images: UploadedImage[]) => void
  onModelImagesChange: (images: UploadedImage[]) => void
}

export function UploadPanel({ 
  productImages, 
  modelImages, 
  onProductImagesChange, 
  onModelImagesChange 
}: UploadPanelProps) {
  const [activeTab, setActiveTab] = useState<'product' | 'model'>('product')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentImages = activeTab === 'product' ? productImages : modelImages
  const setCurrentImages = activeTab === 'product' ? onProductImagesChange : onModelImagesChange

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newImages: UploadedImage[] = Array.from(files).map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      preview: URL.createObjectURL(file),
      name: file.name
    }))

    setCurrentImages([...currentImages, ...newImages])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemoveImage = (id: string) => {
    setCurrentImages(currentImages.filter(img => img.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">1</span>
        <h3 className="text-sm font-medium text-foreground">上传素材</h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
        <button
          onClick={() => setActiveTab('product')}
          className={cn(
            'pb-2 text-sm transition-colors relative',
            activeTab === 'product' 
              ? 'text-primary' 
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          产品图（必传）
          {activeTab === 'product' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('model')}
          className={cn(
            'pb-2 text-sm transition-colors relative',
            activeTab === 'model' 
              ? 'text-primary' 
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          模特图（选传）
          {activeTab === 'model' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          )}
        </button>
      </div>

      {/* Upload Area */}
      <div className="flex gap-3 flex-wrap">
        {currentImages.map((image) => (
          <div 
            key={image.id} 
            className="relative w-24 h-28 rounded-lg overflow-hidden border border-border bg-muted group"
          >
            <img 
              src={image.preview} 
              alt={image.name}
              className="w-full h-full object-cover"
            />
            <button
              onClick={() => handleRemoveImage(image.id)}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3 text-foreground" />
            </button>
            <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm px-1 py-0.5">
              <p className="text-xs text-muted-foreground truncate">{image.name}</p>
            </div>
          </div>
        ))}

        {/* Upload Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-24 h-28 rounded-lg border border-dashed border-border bg-muted/50 flex flex-col items-center justify-center gap-2 hover:border-primary/50 hover:bg-muted transition-colors"
        >
          <Plus className="w-5 h-5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">上传图片</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    </div>
  )
}
