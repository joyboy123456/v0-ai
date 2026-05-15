'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface GenerateButtonProps {
  isGenerating: boolean
  estimatedCount: number
  onGenerate: () => void
  disabled?: boolean
}

export function GenerateButton({ isGenerating, estimatedCount, onGenerate, disabled }: GenerateButtonProps) {
  return (
    <div className="flex items-center gap-4">
      <Button 
        onClick={onGenerate}
        disabled={isGenerating || disabled}
        className={cn(
          'flex-1 h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium',
          isGenerating && 'opacity-80'
        )}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            生成中...
          </>
        ) : (
          '立即生成'
        )}
      </Button>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        预计消耗：{estimatedCount}张
      </span>
    </div>
  )
}
