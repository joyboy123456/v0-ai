import type { Metadata } from 'next'
import CreativeStudio from '@/components/creative-studio/studio'

export const metadata: Metadata = {
  title: '创作白板 · V0 AI',
  description: '面向服装电商的 Agent 创作白板前端原型。',
}

export default function WhiteboardDemoPage() {
  return <CreativeStudio />
}
