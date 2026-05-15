'use client'

import { useState } from 'react'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'
import { FeatureHeader } from './feature-header'
import { Workbench } from './workbench'
import type { FeatureType } from '@/lib/types'

export function AppLayout() {
  const [currentFeature, setCurrentFeature] = useState<FeatureType>('ai-fashion-photo')

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <Sidebar currentFeature={currentFeature} onFeatureChange={setCurrentFeature} />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0">
        <TopBar />
        
        <main className="flex-1 flex flex-col p-6 pb-0 gap-4 min-h-0 overflow-hidden">
          <FeatureHeader currentFeature={currentFeature} />
          <div className="flex-1 min-h-0 -mx-6 -mb-0">
            <Workbench currentFeature={currentFeature} />
          </div>
        </main>
      </div>
    </div>
  )
}
