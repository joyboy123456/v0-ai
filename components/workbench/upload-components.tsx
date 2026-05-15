'use client'

import { Plus, Upload, X, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRef } from 'react'

interface ImageUploadBoxProps {
  label: string
  required?: boolean
  description?: string
  image?: { preview: string; name: string } | null
  exampleImage?: string
  onUpload: (file: File) => void
  onRemove: () => void
  className?: string
}

export function ImageUploadBox({
  label,
  required,
  description,
  image,
  exampleImage,
  onUpload,
  onRemove,
  className
}: ImageUploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onUpload(file)
    }
    e.target.value = ''
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1">
        {required && <span className="text-primary">*</span>}
        <span className="text-sm text-foreground">{label}</span>
        {required && <span className="text-xs text-muted-foreground">(必传)</span>}
        {description && (
          <Info className="w-3 h-3 text-muted-foreground ml-1" />
        )}
      </div>
      
      <div className="flex gap-2">
        {/* Upload area */}
        <div
          onClick={handleClick}
          className={cn(
            'flex-1 min-h-[100px] border border-dashed border-border rounded-lg',
            'flex flex-col items-center justify-center gap-2 cursor-pointer',
            'hover:border-primary/50 hover:bg-primary/5 transition-colors',
            image && 'border-solid'
          )}
        >
          {image ? (
            <div className="relative w-full h-full min-h-[100px]">
              <img
                src={image.preview}
                alt={image.name}
                className="w-full h-full object-contain rounded-lg"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove()
                }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-background border border-border rounded-full flex items-center justify-center hover:bg-destructive hover:border-destructive hover:text-destructive-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              <Plus className="w-5 h-5 text-muted-foreground" />
              {description ? (
                <p className="text-xs text-muted-foreground text-center px-2 leading-relaxed">
                  {description}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">拖放图片上传</p>
              )}
            </>
          )}
        </div>

        {/* Example image */}
        {exampleImage && (
          <div className="w-16 h-24 rounded-lg overflow-hidden border border-border shrink-0">
            <img
              src={exampleImage}
              alt="示例"
              className="w-full h-full object-cover"
            />
            <div className="text-[10px] text-center text-muted-foreground bg-card py-0.5">
              示例
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
    </div>
  )
}

interface SimpleUploadBoxProps {
  label?: string
  image?: { preview: string; name: string } | null
  onUpload: (file: File) => void
  onRemove: () => void
  className?: string
}

export function SimpleUploadBox({
  label,
  image,
  onUpload,
  onRemove,
  className
}: SimpleUploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onUpload(file)
    }
    e.target.value = ''
  }

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <div className="flex items-center gap-1">
          <span className="text-primary">*</span>
          <span className="text-sm text-foreground">{label}</span>
        </div>
      )}
      
      <div
        onClick={handleClick}
        className={cn(
          'h-24 border border-dashed border-border rounded-lg',
          'flex flex-col items-center justify-center gap-1 cursor-pointer',
          'hover:border-primary/50 hover:bg-primary/5 transition-colors'
        )}
      >
        {image ? (
          <div className="relative w-full h-full p-2">
            <img
              src={image.preview}
              alt={image.name}
              className="w-full h-full object-contain rounded"
            />
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="absolute top-1 right-1 w-4 h-4 bg-background/80 border border-border rounded-full flex items-center justify-center hover:bg-destructive hover:border-destructive hover:text-destructive-foreground transition-colors"
            >
              <X className="w-2 h-2" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">拖放图片上传</p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
    </div>
  )
}

interface TabButtonGroupProps {
  tabs: { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function TabButtonGroup({ tabs, value, onChange, className }: TabButtonGroupProps) {
  return (
    <div className={cn('flex gap-1 p-1 bg-secondary rounded-lg', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'px-3 py-1 text-xs rounded-md transition-colors',
            value === tab.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
