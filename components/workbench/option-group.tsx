'use client'

import { cn } from '@/lib/utils'

interface OptionGroupProps {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

export function OptionGroup({ label, options, value, onChange }: OptionGroupProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm transition-all duration-200 border',
              value === option.value
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80 hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
