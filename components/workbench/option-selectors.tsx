'use client'

import { cn } from '@/lib/utils'

interface OptionSelectorProps {
  label: string
  required?: boolean
  options: { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
  showValue?: boolean
  className?: string
}

export function OptionSelector({
  label,
  required,
  options,
  value,
  onChange,
  showValue,
  className
}: OptionSelectorProps) {
  const selectedOption = options.find(o => o.id === value)
  
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {required && <span className="text-primary">*</span>}
          <span className="text-sm text-foreground">{label}</span>
        </div>
        {showValue && selectedOption && (
          <span className="text-sm text-muted-foreground">{selectedOption.label}</span>
        )}
      </div>
      
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md border transition-all duration-200',
              value === option.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground hover:border-primary/50 hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface AspectRatioSelectorProps {
  label: string
  required?: boolean
  options: { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function AspectRatioSelector({
  label,
  required,
  options,
  value,
  onChange,
  className
}: AspectRatioSelectorProps) {
  const selectedOption = options.find(o => o.id === value)
  
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {required && <span className="text-primary">*</span>}
          <span className="text-sm text-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">{selectedOption?.label}</span>
          <span className="text-muted-foreground">{'>'}</span>
        </div>
      </div>
      
      <div className="flex gap-2">
        {options.map((option) => {
          // Generate aspect ratio box preview
          let width = 24
          let height = 24
          if (option.id === '3:2') { width = 30; height = 20 }
          if (option.id === '2:3') { width = 20; height = 30 }
          if (option.id === '3:4') { width = 22; height = 30 }
          if (option.id === '4:3') { width = 30; height = 22 }
          
          return (
            <button
              key={option.id}
              onClick={() => onChange(option.id)}
              className={cn(
                'flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200',
                value === option.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-secondary hover:border-primary/50'
              )}
            >
              <div
                className={cn(
                  'border-2 rounded-sm',
                  value === option.id ? 'border-primary' : 'border-muted-foreground'
                )}
                style={{ width, height }}
              />
              <span className={cn(
                'text-[10px]',
                value === option.id ? 'text-primary' : 'text-muted-foreground'
              )}>
                {option.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface DropdownSelectorProps {
  label: string
  options: { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function DropdownSelector({
  label,
  options,
  value,
  onChange,
  className
}: DropdownSelectorProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <span className="text-sm text-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface FissionCountSelectorProps {
  label: string
  options: { id: number; label: string }[]
  value: number
  onChange: (value: number) => void
  description?: string
  showToggle?: boolean
  className?: string
}

export function FissionCountSelector({
  label,
  options,
  value,
  onChange,
  description,
  showToggle,
  className
}: FissionCountSelectorProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">{label}</span>
          {showToggle && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-4 bg-secondary rounded-full relative cursor-pointer">
                <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-muted-foreground rounded-full" />
              </div>
              <span className="text-xs text-muted-foreground">高级模式</span>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              'flex-1 px-3 py-1.5 text-xs rounded-md border transition-all duration-200',
              value === option.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground hover:border-primary/50 hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
