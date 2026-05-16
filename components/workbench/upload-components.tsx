'use client'

import { useRef, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UploadedImage } from '@/lib/types'

interface UploadBoxProps {
  label: string
  helper: string
  image: UploadedImage | null
  onUploaded: (image: UploadedImage) => void
  onRemove: () => void
  required?: boolean
  className?: string
  variant?: 'standard' | 'compact'
}

export function UploadBox({
  label,
  helper,
  image,
  onUploaded,
  onRemove,
  required = true,
  className,
  variant = 'standard',
}: UploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    setError('')
    setIsUploading(true)

    try {
      const preview = URL.createObjectURL(file)
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/assets/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || '上传失败')
      }

      const data = (await response.json()) as {
        assetId: string
        fileName: string
        width: number
        height: number
      }

      onUploaded({
        assetId: data.assetId,
        preview,
        name: data.fileName,
        width: data.width,
        height: data.height,
      })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1">
        {required && <span className="text-primary">*</span>}
        <span className="text-sm text-foreground">{label}</span>
      </div>

      {variant === 'compact' ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'relative w-full min-h-[132px] rounded-md border border-border bg-secondary',
            'flex items-center gap-3 overflow-hidden p-3 text-left transition-colors',
            'hover:border-primary/60 hover:bg-primary/5',
            image && 'border-primary/40',
          )}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            ) : (
              <span className="text-2xl leading-none text-foreground">+</span>
            )}
            <span className="max-w-[138px] text-center text-[11px] font-medium leading-relaxed text-foreground">
              {isUploading ? '上传中...' : helper}
            </span>
          </div>

          <div className="relative h-[112px] w-[82px] shrink-0 overflow-hidden rounded-md border border-border bg-background">
            {image ? (
              <>
                <img src={image.preview} alt={image.name} className="h-full w-full object-cover" />
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      onRemove()
                    }
                  }}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/90 hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </>
            ) : (
              <div className="flex h-full w-full items-end justify-center bg-card p-1">
                <span className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-foreground">
                  示例
                </span>
              </div>
            )}
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'relative w-full min-h-[168px] rounded-lg border border-dashed border-border bg-secondary',
            'flex flex-col items-center justify-center gap-2 overflow-hidden transition-colors',
            'hover:border-primary/60 hover:bg-primary/5',
            image && 'border-solid',
          )}
        >
          {image ? (
            <>
              <img src={image.preview} alt={image.name} className="absolute inset-0 w-full h-full object-contain p-2" />
              <span className="absolute bottom-2 left-2 max-w-[80%] truncate rounded bg-background/80 px-2 py-1 text-xs text-foreground">
                {image.name}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    onRemove()
                  }
                }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/90 border border-border flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
              >
                <X className="w-4 h-4" />
              </span>
            </>
          ) : (
            <>
              {isUploading ? (
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              ) : (
                <Upload className="w-6 h-6 text-muted-foreground" />
              )}
              <span className="text-sm text-foreground">{isUploading ? '上传中...' : '上传图片'}</span>
              <span className="max-w-[220px] text-center text-xs text-muted-foreground leading-relaxed">{helper}</span>
            </>
          )}
        </button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
    </div>
  )
}
