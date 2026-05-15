'use client'

import { useState } from 'react'
import { ImageUploadBox, SimpleUploadBox, TabButtonGroup } from './upload-components'
import { OptionSelector, AspectRatioSelector, DropdownSelector, FissionCountSelector } from './option-selectors'
import { ASPECT_RATIOS, RESOLUTIONS, FISSION_COUNTS, PRODUCT_CATEGORIES, VERSIONS, ELEMENT_TYPES, MODEL_LIBRARY, type FeatureType } from '@/lib/types'
import { Coins, HelpCircle } from 'lucide-react'

interface LeftPanelProps {
  feature: FeatureType
  credits: number
  onGenerate: () => void
  isGenerating: boolean
}

interface UploadedImage {
  preview: string
  name: string
}

export function LeftPanel({ feature, credits, onGenerate, isGenerating }: LeftPanelProps) {
  const [version, setVersion] = useState('advanced')
  const [category, setCategory] = useState('tops')
  const [aspectRatio, setAspectRatio] = useState('3:4')
  const [resolution, setResolution] = useState('4k')
  const [fissionCount, setFissionCount] = useState(4)
  const [prompt, setPrompt] = useState('')
  const [elementType, setElementType] = useState('clothing')
  
  const [originalImage, setOriginalImage] = useState<UploadedImage | null>(null)
  const [replacementImage, setReplacementImage] = useState<UploadedImage | null>(null)
  const [mainImage, setMainImage] = useState<UploadedImage | null>(null)
  const [frontDetailImage, setFrontDetailImage] = useState<UploadedImage | null>(null)
  const [backDetailImage, setBackDetailImage] = useState<UploadedImage | null>(null)
  const [poseImage, setPoseImage] = useState<UploadedImage | null>(null)
  const [fissionTypeImage, setFissionTypeImage] = useState<UploadedImage | null>(null)
  const [referenceImages, setReferenceImages] = useState<UploadedImage[]>([])

  const handleFileUpload = (file: File, setter: (img: UploadedImage | null) => void) => {
    const preview = URL.createObjectURL(file)
    setter({ preview, name: file.name })
  }

  const handleReferenceUpload = (file: File) => {
    if (referenceImages.length >= 10) return
    const preview = URL.createObjectURL(file)
    setReferenceImages([...referenceImages, { preview, name: file.name }])
  }

  const handleRemoveReference = (index: number) => {
    setReferenceImages(referenceImages.filter((_, i) => i !== index))
  }

  const renderAIPhotoPanel = () => (
    <div className="space-y-5">
      {/* 版本 */}
      <DropdownSelector
        label="版本"
        options={VERSIONS}
        value={version}
        onChange={setVersion}
        icon={<HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />}
      />

      {/* 参考图 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-primary">*</span>
          <span className="text-sm text-foreground">参考图</span>
          <span className="text-xs text-muted-foreground">(最多支持10张参考图)</span>
        </div>
        <div
          onClick={() => document.getElementById('reference-upload')?.click()}
          className="h-20 border border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
        >
          <span className="text-muted-foreground text-sm">拖放图片上传</span>
        </div>
        <input
          id="reference-upload"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleReferenceUpload(e.target.files[0])}
        />
        {referenceImages.length > 0 && (
          <div className="flex gap-2 flex-wrap mt-2">
            {referenceImages.map((img, idx) => (
              <div key={idx} className="relative w-12 h-12 rounded overflow-hidden group">
                <img src={img.preview} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => handleRemoveReference(idx)}
                  className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <span className="text-white text-xs">X</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 找灵感 + 模特库 */}
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">找灵感可以试试官方素材</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">模特库</span>
          <div className="flex gap-1 flex-1">
            {MODEL_LIBRARY.map((model) => (
              <button
                key={model.id}
                className="w-8 h-8 rounded-full overflow-hidden border-2 border-transparent hover:border-primary transition-colors"
              >
                <img src={model.avatar} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
          <button className="text-xs text-muted-foreground hover:text-foreground px-2">More</button>
        </div>
      </div>

      {/* 提示词 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-primary">*</span>
          <span className="text-sm text-foreground">提示词</span>
        </div>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="请输入提示词"
            maxLength={800}
            className="w-full h-24 bg-secondary border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
            {prompt.length}/800
          </span>
        </div>
      </div>

      {/* 图片比例 */}
      <AspectRatioSelector
        label="图片比例"
        required
        options={ASPECT_RATIOS}
        value={aspectRatio}
        onChange={setAspectRatio}
      />

      {/* 分辨率 */}
      <OptionSelector
        label="分辨率"
        options={RESOLUTIONS}
        value={resolution}
        onChange={setResolution}
      />
    </div>
  )

  const renderElementReplacePanel = () => (
    <div className="space-y-5">
      {/* 上传原图 */}
      <SimpleUploadBox
        label="上传原图"
        image={originalImage}
        onUpload={(file) => handleFileUpload(file, setOriginalImage)}
        onRemove={() => setOriginalImage(null)}
      />

      {/* 上传替换元素 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-primary">*</span>
          <span className="text-sm text-foreground">上传替换元素</span>
        </div>
        <TabButtonGroup
          tabs={ELEMENT_TYPES}
          value={elementType}
          onChange={setElementType}
        />
        <SimpleUploadBox
          image={replacementImage}
          onUpload={(file) => handleFileUpload(file, setReplacementImage)}
          onRemove={() => setReplacementImage(null)}
        />
      </div>

      {/* 提示词 */}
      <div className="space-y-2">
        <span className="text-sm text-foreground">提示词</span>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="请输入提示词"
            maxLength={800}
            className="w-full h-24 bg-secondary border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
            {prompt.length}/800
          </span>
        </div>
      </div>

      {/* 图片比例 */}
      <AspectRatioSelector
        label="图片比例"
        required
        options={ASPECT_RATIOS}
        value={aspectRatio}
        onChange={setAspectRatio}
      />

      {/* 分辨率 */}
      <OptionSelector
        label="分辨率"
        options={RESOLUTIONS}
        value={resolution}
        onChange={setResolution}
      />
    </div>
  )

  const renderDetailFissionPanel = () => (
    <div className="space-y-5">
      {/* 版本 & 品类 */}
      <DropdownSelector
        label="版本"
        options={VERSIONS}
        value={version}
        onChange={setVersion}
      />
      <DropdownSelector
        label="品类"
        options={PRODUCT_CATEGORIES}
        value={category}
        onChange={setCategory}
      />

      {/* 主图 */}
      <ImageUploadBox
        label="主图"
        required
        description="请上传产品的清晰完整正面图，白底图最佳，产品在画面中需占比较大"
        image={mainImage}
        exampleImage="https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setMainImage)}
        onRemove={() => setMainImage(null)}
      />

      {/* 正面细节图 */}
      <ImageUploadBox
        label="正面细节图"
        required
        description="上传服装正面的清晰特殊细节图，如领口、面料、logo等,仅上传必要细节，图片不超越多越好"
        image={frontDetailImage}
        exampleImage="https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setFrontDetailImage)}
        onRemove={() => setFrontDetailImage(null)}
      />

      {/* 背面细节图 */}
      <ImageUploadBox
        label="背面细节图"
        required
        description="请上传产品的清晰背面图图以及背部特殊细节图等，仅上传必要细节，图片不超越多越好"
        image={backDetailImage}
        exampleImage="https://images.unsplash.com/photo-1562157873-818bc0726f68?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setBackDetailImage)}
        onRemove={() => setBackDetailImage(null)}
      />

      {/* 裂变类型 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-primary">*</span>
          <span className="text-sm text-foreground">裂变类型</span>
        </div>
        <div
          className="h-20 border border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
        >
          <span className="text-lg text-muted-foreground">+</span>
          <span className="text-xs text-muted-foreground">去选择裂变类型</span>
        </div>
      </div>

      {/* 图片比例 */}
      <AspectRatioSelector
        label="图片比例"
        required
        options={ASPECT_RATIOS}
        value={aspectRatio}
        onChange={setAspectRatio}
      />

      {/* 分辨率 */}
      <OptionSelector
        label="分辨率"
        options={RESOLUTIONS}
        value={resolution}
        onChange={setResolution}
      />
    </div>
  )

  const renderPhotoFissionPanel = () => (
    <div className="space-y-5">
      {/* 版本 & 品类 */}
      <DropdownSelector
        label="版本"
        options={VERSIONS}
        value={version}
        onChange={setVersion}
      />
      <DropdownSelector
        label="品类"
        options={PRODUCT_CATEGORIES}
        value={category}
        onChange={setCategory}
      />

      {/* 主图 */}
      <ImageUploadBox
        label="主图"
        required
        description="请上传需要裂变的清晰主图"
        image={mainImage}
        exampleImage="https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setMainImage)}
        onRemove={() => setMainImage(null)}
      />

      {/* 产品正面细节图 */}
      <ImageUploadBox
        label="产品正面细节图"
        required
        description="请上传服装的正面特殊细节图，如领口、面料、logo等，仅上传必要细节，图片不超越多越好"
        image={frontDetailImage}
        exampleImage="https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setFrontDetailImage)}
        onRemove={() => setFrontDetailImage(null)}
      />

      {/* 产品背面细节图 */}
      <ImageUploadBox
        label="产品背面细节图"
        required
        description="请上传服装的完整背面图以及背部特殊细节图等，仅上传必要细节，图片不超越多越好"
        image={backDetailImage}
        exampleImage="https://images.unsplash.com/photo-1562157873-818bc0726f68?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setBackDetailImage)}
        onRemove={() => setBackDetailImage(null)}
      />

      {/* 图片比例 */}
      <AspectRatioSelector
        label="图片比例"
        required
        options={ASPECT_RATIOS}
        value={aspectRatio}
        onChange={setAspectRatio}
      />

      {/* 分辨率 */}
      <OptionSelector
        label="分辨率"
        options={RESOLUTIONS}
        value={resolution}
        onChange={setResolution}
      />

      {/* 裂变数量 */}
      <FissionCountSelector
        label="裂变数量"
        options={FISSION_COUNTS}
        value={fissionCount}
        onChange={setFissionCount}
        showToggle
        description={`已选择: ${fissionCount}张 (近景1+中景1+产品特写1+远景1)`}
      />
    </div>
  )

  const renderPoseFissionPanel = () => (
    <div className="space-y-5">
      {/* 版本 */}
      <DropdownSelector
        label="版本"
        options={VERSIONS}
        value={version}
        onChange={setVersion}
      />

      {/* 主图 */}
      <ImageUploadBox
        label="主图"
        required
        description="请上传需要姿势裂变的清晰主图"
        image={mainImage}
        exampleImage="https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setMainImage)}
        onRemove={() => setMainImage(null)}
      />

      {/* 产品正面细节图 */}
      <ImageUploadBox
        label="产品正面细节图"
        required
        description="请上传服装的正面特殊细节图，如领口、面料、logo等，仅上传必要细节，图片不超越多越好"
        image={frontDetailImage}
        exampleImage="https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setFrontDetailImage)}
        onRemove={() => setFrontDetailImage(null)}
      />

      {/* 产品背面细节图 */}
      <ImageUploadBox
        label="产品背面细节图"
        required
        description="请上传服装的完整背面图以及背部特殊细节图等，仅上传必要细节，图片不超越多越好"
        image={backDetailImage}
        exampleImage="https://images.unsplash.com/photo-1562157873-818bc0726f68?w=100&h=150&fit=crop"
        onUpload={(file) => handleFileUpload(file, setBackDetailImage)}
        onRemove={() => setBackDetailImage(null)}
      />

      {/* 选择姿势 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-primary">*</span>
          <span className="text-sm text-foreground">选择姿势</span>
        </div>
        <div
          className="h-20 border border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
        >
          <span className="text-lg text-muted-foreground">+</span>
          <span className="text-xs text-muted-foreground">去姿势库选择合适的姿势</span>
        </div>
      </div>

      {/* 图片比例 */}
      <AspectRatioSelector
        label="图片比例"
        required
        options={ASPECT_RATIOS}
        value={aspectRatio}
        onChange={setAspectRatio}
      />

      {/* 分辨率 */}
      <OptionSelector
        label="分辨率"
        options={RESOLUTIONS}
        value={resolution}
        onChange={setResolution}
      />
    </div>
  )

  const renderPanel = () => {
    switch (feature) {
      case 'ai-photo':
        return renderAIPhotoPanel()
      case 'element-replace':
        return renderElementReplacePanel()
      case 'detail-fission':
        return renderDetailFissionPanel()
      case 'photo-fission':
        return renderPhotoFissionPanel()
      case 'pose-fission':
        return renderPoseFissionPanel()
      default:
        return renderAIPhotoPanel()
    }
  }

  return (
    <div className="w-56 min-h-screen bg-card border-r border-border flex flex-col">
      {/* Feature title */}
      <div className="p-4 border-b border-border">
        <h1 className="text-base font-medium text-foreground">
          {feature === 'ai-photo' && 'AI服装大片'}
          {feature === 'element-replace' && '服装大片 - 元素替换'}
          {feature === 'detail-fission' && '服装详情图裂变'}
          {feature === 'photo-fission' && '服装大片裂变'}
          {feature === 'pose-fission' && '姿势裂变'}
        </h1>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-4">
        {renderPanel()}
      </div>

      {/* Generate button */}
      <div className="p-4 border-t border-border">
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full py-2.5 px-4 bg-transparent border border-primary text-primary rounded-full flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>{isGenerating ? '生成中...' : '立即生成'}</span>
          <Coins className="w-4 h-4" />
          <span>{credits}</span>
        </button>
      </div>
    </div>
  )
}
