import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

// 注：原本 import 了 `Geist` / `Geist_Mono` 两个 Google Fonts，但变量名带 `_`
// 前缀且全文未使用（body 用的是 tailwind `font-sans`）。Mac mini 部署环境
// 访问 fonts.googleapis.com 受限，next build 会失败。直接移除死代码。

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
    <html lang="zh-CN" className="bg-background">
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
