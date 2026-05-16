'use client'

import { cn } from '@/lib/utils'

interface OptionSelectorProps<T extends string | number> {
  label: string
  required?: boolean
  options: { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
  columns?: 'auto' | 'equal'
  className?: string
}

export function OptionSelector<T extends string | number>({
  label,
  required,
  options,
  value,
  onChange,
  columns = 'auto',
  className,
}: OptionSelectorProps<T>) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1">
        {required && <span className="text-primary">*</span>}
        <span className="text-sm text-foreground">{label}</span>
      </div>

      <div className={cn('flex flex-wrap gap-2', columns === 'equal' && 'grid grid-cols-2')}>
        {options.map((option) => (
          <button
            key={String(option.id)}
            onClick={() => onChange(option.id)}
            className={cn(
              'px-3 py-2 text-xs rounded-md border transition-all duration-200',
              columns === 'equal' && 'w-full',
              value === option.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground hover:border-primary/50 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface RatioSelectorProps<T extends string> {
  label: string
  required?: boolean
  options: { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function RatioSelector<T extends string>({
  label,
  required,
  options,
  value,
  onChange,
}: RatioSelectorProps<T>) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {required && <span className="text-primary">*</span>}
        <span className="text-sm text-foreground">{label}</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => {
          const size = getRatioSize(option.id)

          return (
            <button
              key={option.id}
              onClick={() => onChange(option.id)}
              className={cn(
                'h-[72px] rounded-lg border bg-secondary flex flex-col items-center justify-center gap-1 transition-all',
                value === option.id ? 'border-primary text-primary' : 'border-border text-muted-foreground',
              )}
            >
              <span
                className={cn('border-2 rounded-sm', value === option.id ? 'border-primary' : 'border-muted-foreground')}
                style={size}
              />
              <span className="text-[10px]">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getRatioSize(id: string) {
  if (id === '3:4') return { width: 20, height: 28 }
  if (id === '4:3') return { width: 28, height: 20 }
  if (id === '2:3') return { width: 19, height: 28 }
  return { width: 24, height: 24 }
}
