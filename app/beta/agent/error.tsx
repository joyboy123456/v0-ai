'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function AgentBetaError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8">
        <p className="text-xs font-semibold text-primary">创作助手 Beta</p>
        <h1 className="mt-3 text-xl font-semibold">创作助手暂时无法打开</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">可以重试，或返回原工作台继续创作。已提交的生成任务可在原工作台查看。</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={reset}>重试</Button>
          <Button variant="outline" asChild><Link href="/">返回原工作台</Link></Button>
        </div>
      </div>
    </main>
  )
}
