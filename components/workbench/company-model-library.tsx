'use client'

import { useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { CompanyModel } from '@/lib/types'

interface CompanyModelLibraryProps {
  models: CompanyModel[]
  selectedModel: CompanyModel | null
  onAddModel: (model: CompanyModel) => void
  onSelectModel: (model: CompanyModel) => void
}

export function CompanyModelLibrary({
  models,
  selectedModel,
  onAddModel,
  onSelectModel,
}: CompanyModelLibraryProps) {
  const [open, setOpen] = useState(false)
  const previewModels = models.slice(0, 4)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="text-primary">*</span>
        <span className="text-sm text-foreground">我的模特库</span>
      </div>

      <div className="rounded-lg border border-border bg-secondary p-3">
        {selectedModel ? (
          <div className="mb-3 flex items-center gap-3">
            <img
              src={selectedModel.preview}
              alt={selectedModel.name}
              className="w-12 h-12 rounded-md object-cover bg-white"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{selectedModel.name}</p>
              <p className="text-xs text-muted-foreground">生成时会把产品穿到该模特身上</p>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">
            上传并选择公司常用模特，适合内部两三个固定模特复用。
          </p>
        )}

        <div className="flex items-center gap-2">
          {previewModels.map((model) => (
            <button
              key={model.assetId}
              onClick={() => onSelectModel(model)}
              className={cn(
                'relative w-11 h-11 rounded-md overflow-hidden border bg-white',
                selectedModel?.assetId === model.assetId ? 'border-primary' : 'border-border',
              )}
            >
              <img src={model.preview} alt={model.name} className="w-full h-full object-cover" />
              {selectedModel?.assetId === model.assetId && (
                <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </button>
          ))}

          <button
            onClick={() => setOpen(true)}
            className="h-11 min-w-14 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            管理
          </button>
        </div>
      </div>

      <CompanyModelDialog
        open={open}
        models={models}
        selectedModel={selectedModel}
        onOpenChange={setOpen}
        onAddModel={onAddModel}
        onSelectModel={onSelectModel}
      />
    </div>
  )
}

function CompanyModelDialog({
  open,
  models,
  selectedModel,
  onOpenChange,
  onAddModel,
  onSelectModel,
}: CompanyModelLibraryProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    setIsUploading(true)

    try {
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
        url: string
        fileName: string
        width: number
        height: number
      }
      // A-fix: 使用 server 返回的稳定 URL（/generated/assets/xxx.png），
      // 刷新页面或换浏览器都能正常显示，不再使用 blob URL。
      const model: CompanyModel = {
        assetId: data.assetId,
        preview: data.url,
        name: data.fileName,
        width: data.width,
        height: data.height,
        createdAt: new Date().toISOString(),
      }

      onAddModel(model)
      onSelectModel(model)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-4xl bg-[#101010] border-border p-0 overflow-hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">我的模特库</DialogTitle>

        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">我的模特库</h2>
            <p className="mt-1 text-xs text-muted-foreground">上传公司常用模特，AI服装大片直接复用。</p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => inputRef.current?.click()}
              className="aspect-[3/4] rounded-lg border border-dashed border-border bg-secondary flex flex-col items-center justify-center gap-2 hover:border-primary/60"
            >
              <Plus className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-foreground">{isUploading ? '上传中...' : '上传模特'}</span>
            </button>

            {models.map((model) => {
              const isSelected = selectedModel?.assetId === model.assetId

              return (
                <button
                  key={model.assetId}
                  onClick={() => onSelectModel(model)}
                  className={cn(
                    'relative overflow-hidden rounded-lg border bg-card text-left',
                    isSelected ? 'border-primary' : 'border-border hover:border-primary/60',
                  )}
                >
                  <div className="aspect-[3/4] bg-white">
                    <img src={model.preview} alt={model.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="px-3 py-2">
                    <p className="truncate text-xs text-foreground">{model.name}</p>
                  </div>
                  {isSelected && (
                    <span className="absolute right-2 top-2 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check className="w-4 h-4" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-full border border-border px-8 py-3 text-sm text-foreground hover:border-primary/60"
          >
            取消
          </button>
          <button
            onClick={() => onOpenChange(false)}
            disabled={!selectedModel}
            className="rounded-full border border-primary bg-primary/10 px-8 py-3 text-sm text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
          >
            确定
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
