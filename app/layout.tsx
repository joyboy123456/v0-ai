import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

// 注：原本 import 了 `Geist` / `Geist_Mono` 两个 Google Fonts，但变量名带 `_`
// 前缀且全文未使用（body 用的是 tailwind `font-sans`）。Mac mini 部署环境
// 访问 fonts.googleapis.com 受限，next build 会失败。直接移除死代码。

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 让 env(safe-area-inset-*) 生效（iPhone 刘海/Home 指示条区域可绘制）
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: '商拍生成工作台',
  description: '服装电商创作工作台，帮助商家批量生成高质量电商素材',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="bg-background" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
