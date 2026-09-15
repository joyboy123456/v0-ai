import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 使用双主题语义色，保证 Beta 主操作在暗色背景下的文字对比度。 */
export function AgentActionButton({ className, ...props }: Omit<ComponentProps<typeof Button>, 'variant'>) {
  return <Button variant="secondary" {...props} className={cn('border-transparent bg-foreground text-background hover:bg-foreground/90', className)} />
}
