'use client'

import { Crown, Bell, ChevronDown } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export function TopBar() {
  return (
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-end px-6 gap-4">
      {/* 会员中心 */}
      <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted transition-colors">
        <Crown className="w-4 h-4 text-yellow-500" />
        <span className="text-sm text-foreground">会员中心</span>
      </button>

      {/* 剩余额度 */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
        <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
          <span className="text-xs font-bold text-primary">张</span>
        </div>
        <span className="text-sm text-foreground">剩余额度：<span className="text-primary font-medium">1,256 张</span></span>
      </div>

      {/* 通知 */}
      <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
        <Bell className="w-5 h-5 text-muted-foreground" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
      </button>

      {/* 用户信息 */}
      <button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted transition-colors">
        <Avatar className="w-8 h-8">
          <AvatarImage src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop" />
          <AvatarFallback className="bg-primary/20 text-primary text-xs">王</AvatarFallback>
        </Avatar>
        <span className="text-sm text-foreground">设计师小王</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
    </header>
  )
}
