'use client'

import { Download, X } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { GeneratedImage } from '@/lib/types'

interface ImagePreviewModalProps {
  image: GeneratedImage | null
  onClose: () => void
}

export function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  if (!image) return null

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = image.url
    link.download = `generated-${image.id}.jpg`
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <Dialog open={!!image} onOpenChange={() => onClose()}>
      <DialogContent showCloseButton={false} className="max-w-3xl bg-card border-border p-0 overflow-hidden">
        <div className="relative">
          <img 
            src={image.url} 
            alt="预览图片"
            className="w-full h-auto max-h-[80vh] object-contain"
          />
          <div className="absolute top-4 right-4 flex gap-2">
            <Button
              onClick={handleDownload}
              size="icon"
              variant="secondary"
              className="bg-background/80 backdrop-blur-sm hover:bg-background"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              onClick={onClose}
              size="icon"
              variant="secondary"
              className="bg-background/80 backdrop-blur-sm hover:bg-background"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
