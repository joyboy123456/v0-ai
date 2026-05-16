'use client'

import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Coins, Loader2, Sparkles, Upload, X, Zap } from 'lucide-react'
import { OptionSelector, RatioSelector } from './option-selectors'
import { UploadBox } from './upload-components'
import { cn } from '@/lib/utils'
import {
  ELEMENT_REPLACE_TYPES,
  FEATURE_LABELS,
  FASHION_IMAGE_RATIOS,
  FASHION_RESOLUTIONS,
  GENERATE_COUNTS,
  IMAGE_RATIOS,
  POSE_IMAGE_RATIOS,
  POSE_RESOLUTIONS,
  PRODUCT_CATEGORIES,
  type BackgroundReplaceParams,
  type CompanyModel,
  type ElementReplaceType,
  type FashionImageRatio,
  type FashionReferenceImage,
  type FashionResolution,
  type FeatureType,
  type GenerateCount,
  type ImageRatio,
  type PhotoFissionParams,
  type PoseCase,
  type PoseFissionParams,
  type PoseImageRatio,
  type PoseResolution,
  type ProductCategory,
  type AiFashionPhotoParams,
  type UploadedImage,
} from '@/lib/types'

interface LeftPanelProps {
  feature: FeatureType
  selectedPoseCase: PoseCase | null
  companyModels: CompanyModel[]
  selectedCompanyModel: CompanyModel | null
  onSelectCompanyModel: (model: CompanyModel) => void
  onOpenCompanyModelLibrary: () => void
  onOpenPoseLibrary: () => void
  onTaskCreated: (taskId: string) => void
}

export function LeftPanel({
  feature,
  selectedPoseCase,
  companyModels,
  selectedCompanyModel,
  onSelectCompanyModel,
  onOpenCompanyModelLibrary,
  onOpenPoseLibrary,
  onTaskCreated,
}: LeftPanelProps) {
  const [fashionReferences, setFashionReferences] = useState<FashionReferenceImage[]>([])
  const [fashionPrompt, setFashionPrompt] = useState('')
  const [fashionImageRatio, setFashionImageRatio] = useState<FashionImageRatio>('3:4')
  const [fashionResolution, setFashionResolution] = useState<FashionResolution>('4k')
  const [fashionImage, setFashionImage] = useState<UploadedImage | null>(null)
  const [replacementImage, setReplacementImage] = useState<UploadedImage | null>(null)
  const [fissionMainImage, setFissionMainImage] = useState<UploadedImage | null>(null)
  const [frontDetailImage, setFrontDetailImage] = useState<UploadedImage | null>(null)
  const [backDetailImage, setBackDetailImage] = useState<UploadedImage | null>(null)
  const [poseMainImage, setPoseMainImage] = useState<UploadedImage | null>(null)
  const [poseFrontDetailImage, setPoseFrontDetailImage] = useState<UploadedImage | null>(null)
  const [poseBackDetailImage, setPoseBackDetailImage] = useState<UploadedImage | null>(null)
  const [generateCount, setGenerateCount] = useState<GenerateCount>(4)
  const [imageRatio, setImageRatio] = useState<ImageRatio>('3:4')
  const [poseImageRatio, setPoseImageRatio] = useState<PoseImageRatio>('3:4')
  const [poseResolution, setPoseResolution] = useState<PoseResolution>('4k')
  const [productCategory, setProductCategory] = useState<ProductCategory>('tops')
  const [elementType, setElementType] = useState<ElementReplaceType>('clothing')
  const [prompt, setPrompt] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const activeImage =
    feature === 'photo-fission'
        ? fissionMainImage
        : feature === 'pose-fission'
          ? poseMainImage
          : fashionImage
  const isPoseFission = feature === 'pose-fission'
  const isAiFashionPhoto = feature === 'ai-fashion-photo'
  const credits = isPoseFission || isAiFashionPhoto ? 35 : generateCount

  const helperText = useMemo(() => {
    if (feature === 'ai-fashion-photo') return '上传服装、姿势或场景参考图'
    if (feature === 'element-replace') return '上传需要修改的服装大片原图'
    if (feature === 'photo-fission') return '上传清晰服装产品图，系统会自动生成多张模特展示图'
    return '请上传需要姿势裂变的清晰主图'
  }, [feature])

  const handleCreateTask = async () => {
    if (feature === 'ai-fashion-photo') {
      if (!selectedCompanyModel && !fashionReferences.length) {
        setError('请先上传参考图或在我的模特库选择模特')
        return
      }

      if (!fashionPrompt.trim()) {
        setError('请输入提示词')
        return
      }
    } else if (!activeImage) {
      setError('请先上传图片')
      return
    }

    if (feature === 'element-replace' && !replacementImage) {
      setError('请上传替换元素')
      return
    }

    if (feature === 'pose-fission' && !selectedPoseCase) {
      setError('请先去姿势库选择合适的姿势')
      return
    }

    setError('')
    setIsCreating(true)

    try {
      const taskInputAssetIds = getInputAssetIds()
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureType: feature,
          inputAssetIds: taskInputAssetIds,
          params: getParams(),
        }),
      })

      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || '创建任务失败')
      }

      const data = (await response.json()) as { taskId: string }
      onTaskCreated(data.taskId)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建任务失败')
    } finally {
      setIsCreating(false)
    }
  }

  const getInputAssetIds = () => {
    if (feature === 'ai-fashion-photo') {
      return [
        ...(selectedCompanyModel ? [selectedCompanyModel.assetId] : []),
        ...fashionReferences.map((reference) => reference.assetId),
      ]
    }

    if (!activeImage) return []

    if (feature === 'element-replace' && replacementImage) {
      return [activeImage.assetId, replacementImage.assetId]
    }

    if (feature === 'pose-fission') {
      return [
        activeImage.assetId,
        ...(poseFrontDetailImage ? [poseFrontDetailImage.assetId] : []),
        ...(poseBackDetailImage ? [poseBackDetailImage.assetId] : []),
      ]
    }

    if (feature === 'photo-fission') {
      return [
        activeImage.assetId,
        ...(frontDetailImage ? [frontDetailImage.assetId] : []),
        ...(backDetailImage ? [backDetailImage.assetId] : []),
      ]
    }

    return [activeImage.assetId]
  }

  const getParams = (): AiFashionPhotoParams | PhotoFissionParams | BackgroundReplaceParams | PoseFissionParams => {
    if (feature === 'ai-fashion-photo') {
      return {
        prompt: fashionPrompt.trim(),
        referenceImageCount: (selectedCompanyModel ? 1 : 0) + fashionReferences.length,
        officialModelName: selectedCompanyModel?.name,
        imageRatio: fashionImageRatio,
        resolution: fashionResolution,
        resultCount: 1,
        creditsCost: 35,
      }
    }

    if (feature === 'photo-fission') {
      return {
        productCategory,
        hasFrontDetail: Boolean(frontDetailImage),
        hasBackDetail: Boolean(backDetailImage),
        generateCount,
        imageRatio,
      }
    }

    if (feature === 'pose-fission') {
      return {
        version: 'advanced',
        poseCaseId: selectedPoseCase?.id ?? '',
        poseName: selectedPoseCase?.name ?? '',
        posePrompt: selectedPoseCase?.prompt ?? '',
        hasFrontDetail: Boolean(poseFrontDetailImage),
        hasBackDetail: Boolean(poseBackDetailImage),
        imageRatio: poseImageRatio,
        resolution: poseResolution,
        resultCount: 6,
        creditsCost: 35,
      }
    }

    return {
      elementType,
      prompt,
      generateCount,
      imageRatio,
    }
  }

  return (
    <aside className="w-[320px] min-h-screen bg-card border-r border-border flex flex-col">
      <div className="p-5 border-b border-border">
        {!isPoseFission && <p className="text-xs text-muted-foreground">固定 Workflow</p>}
        <h2 className="mt-1 text-lg font-semibold text-foreground">{FEATURE_LABELS[feature]}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {isPoseFission ? (
          <PoseFissionForm
            mainImage={poseMainImage}
            frontDetailImage={poseFrontDetailImage}
            backDetailImage={poseBackDetailImage}
            selectedPoseCase={selectedPoseCase}
            imageRatio={poseImageRatio}
            resolution={poseResolution}
            helperText={helperText}
            onMainUploaded={setPoseMainImage}
            onFrontDetailUploaded={setPoseFrontDetailImage}
            onBackDetailUploaded={setPoseBackDetailImage}
            onMainRemove={() => setPoseMainImage(null)}
            onFrontDetailRemove={() => setPoseFrontDetailImage(null)}
            onBackDetailRemove={() => setPoseBackDetailImage(null)}
            onOpenPoseLibrary={onOpenPoseLibrary}
            onImageRatioChange={setPoseImageRatio}
            onResolutionChange={setPoseResolution}
          />
        ) : (
          <>
            {feature === 'ai-fashion-photo' ? (
              <AiFashionPhotoForm
                references={fashionReferences}
                prompt={fashionPrompt}
                imageRatio={fashionImageRatio}
                resolution={fashionResolution}
                helperText={helperText}
                companyModels={companyModels}
                selectedCompanyModel={selectedCompanyModel}
                onSelectCompanyModel={onSelectCompanyModel}
                onOpenCompanyModelLibrary={onOpenCompanyModelLibrary}
                onAddUploadReference={(image) => {
                  setFashionReferences((currentReferences) => [
                    ...currentReferences,
                    {
                      assetId: image.assetId,
                      source: 'upload' as const,
                      preview: image.preview,
                      name: image.name,
                      width: image.width,
                      height: image.height,
                    },
                  ].slice(0, 10))
                }}
                onRemoveReference={(assetId) => {
                  setFashionReferences((currentReferences) => currentReferences.filter((item) => item.assetId !== assetId))
                }}
                onPromptChange={setFashionPrompt}
                onImageRatioChange={setFashionImageRatio}
                onResolutionChange={setFashionResolution}
              />
            ) : feature === 'element-replace' ? (
              <>
                <UploadBox
                  label="上传原图"
                  helper={helperText}
                  image={fashionImage}
                  onUploaded={setFashionImage}
                  onRemove={() => setFashionImage(null)}
                />
                <div className="space-y-3">
                  <OptionSelector
                    label="替换类型"
                    required
                    options={ELEMENT_REPLACE_TYPES}
                    value={elementType}
                    onChange={setElementType}
                  />
                  <UploadBox
                    label="上传替换元素"
                    helper="上传要替换进去的服装、环境参考或人像元素"
                    image={replacementImage}
                    onUploaded={setReplacementImage}
                    onRemove={() => setReplacementImage(null)}
                  />
                </div>
              </>
            ) : feature === 'photo-fission' ? (
              <>
                <OptionSelector
                  label="品类"
                  required
                  options={PRODUCT_CATEGORIES}
                  value={productCategory}
                  onChange={setProductCategory}
                />
                <UploadBox
                  label="主图"
                  helper={helperText}
                  image={fissionMainImage}
                  onUploaded={setFissionMainImage}
                  onRemove={() => setFissionMainImage(null)}
                />
                <UploadBox
                  label="产品正面细节图"
                  helper="可选：上传领口、面料、logo、图案等正面细节，帮助保持商品一致"
                  image={frontDetailImage}
                  onUploaded={setFrontDetailImage}
                  onRemove={() => setFrontDetailImage(null)}
                  required={false}
                />
                <UploadBox
                  label="产品背面细节图"
                  helper="可选：上传背面完整图或背部特殊细节，图片不是越多越好"
                  image={backDetailImage}
                  onUploaded={setBackDetailImage}
                  onRemove={() => setBackDetailImage(null)}
                  required={false}
                />
              </>
            ) : (
              <UploadBox
                label="服装大片"
                helper={helperText}
                image={fashionImage}
                onUploaded={setFashionImage}
                onRemove={() => setFashionImage(null)}
              />
            )}

            {feature === 'element-replace' && (
              <div className="space-y-2">
                <span className="text-sm text-foreground">提示词</span>
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="请输入提示词，例如：将原图背景替换为室内高级商拍场景，保持人物和服装不变"
                    maxLength={800}
                    className="w-full h-24 resize-none rounded-lg border border-border bg-black p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
                    {prompt.length}/800
                  </span>
                </div>
              </div>
            )}

            {feature !== 'ai-fashion-photo' && (
              <>
                <OptionSelector
                  label="生成数量"
                  required
                  options={GENERATE_COUNTS}
                  value={generateCount}
                  onChange={setGenerateCount}
                />
                <RatioSelector
                  label="图片比例"
                  required
                  options={IMAGE_RATIOS}
                  value={imageRatio}
                  onChange={setImageRatio}
                />
              </>
            )}
          </>
        )}
      </div>

      <div className="p-5 border-t border-border space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          onClick={handleCreateTask}
          disabled={isCreating}
          className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-4 h-4" />
          <span>{isCreating ? '创建任务中...' : '立即生成'}</span>
          <Coins className="w-4 h-4" />
          <span>{credits}</span>
        </button>
        {!isPoseFission && !isAiFashionPhoto && (
          <p className="text-xs text-muted-foreground">
            MVP 当前按每生成 1 张消耗 1 点额度计算。
          </p>
        )}
      </div>
    </aside>
  )
}

function PoseFissionForm({
  mainImage,
  frontDetailImage,
  backDetailImage,
  selectedPoseCase,
  imageRatio,
  resolution,
  helperText,
  onMainUploaded,
  onFrontDetailUploaded,
  onBackDetailUploaded,
  onMainRemove,
  onFrontDetailRemove,
  onBackDetailRemove,
  onOpenPoseLibrary,
  onImageRatioChange,
  onResolutionChange,
}: {
  mainImage: UploadedImage | null
  frontDetailImage: UploadedImage | null
  backDetailImage: UploadedImage | null
  selectedPoseCase: PoseCase | null
  imageRatio: PoseImageRatio
  resolution: PoseResolution
  helperText: string
  onMainUploaded: (image: UploadedImage) => void
  onFrontDetailUploaded: (image: UploadedImage) => void
  onBackDetailUploaded: (image: UploadedImage) => void
  onMainRemove: () => void
  onFrontDetailRemove: () => void
  onBackDetailRemove: () => void
  onOpenPoseLibrary: () => void
  onImageRatioChange: (value: PoseImageRatio) => void
  onResolutionChange: (value: PoseResolution) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground">版本</span>
          <button className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-xs font-medium text-foreground">
            高级版
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <UploadBox
        label="主图"
        helper={helperText}
        image={mainImage}
        onUploaded={onMainUploaded}
        onRemove={onMainRemove}
        variant="compact"
      />
      <UploadBox
        label="产品正面细节图（非必填）"
        helper="请上传模板的正面种类细节图，如领口、图案、logo等。仅上传必要细节，图片不是越多越好"
        image={frontDetailImage}
        onUploaded={onFrontDetailUploaded}
        onRemove={onFrontDetailRemove}
        required={false}
        variant="compact"
      />
      <UploadBox
        label="产品背面细节图（非必填）"
        helper="请上传模板的完整背面图以及背面特殊细节图，图片不是越多越好"
        image={backDetailImage}
        onUploaded={onBackDetailUploaded}
        onRemove={onBackDetailRemove}
        required={false}
        variant="compact"
      />

      <div className="space-y-2">
        <RequiredLabel label="选择姿势" />
        <button
          type="button"
          onClick={onOpenPoseLibrary}
          className={cn(
            'flex min-h-[58px] w-full items-center justify-center gap-3 rounded-md border bg-secondary px-3 py-3',
            'text-center text-xs transition-colors hover:border-primary/60 hover:bg-primary/5',
            selectedPoseCase ? 'border-primary/60 text-foreground' : 'border-border text-muted-foreground',
          )}
        >
          {selectedPoseCase ? (
            <>
              <img
                src={selectedPoseCase.imageUrl}
                alt={selectedPoseCase.name}
                className="h-10 w-8 rounded object-cover"
              />
              <span className="font-medium">{selectedPoseCase.name}</span>
            </>
          ) : (
            <>
              <span className="text-2xl leading-none">+</span>
              <span>去姿势库选择合适的姿势</span>
            </>
          )}
        </button>
      </div>

      <PoseRatioSelector value={imageRatio} onChange={onImageRatioChange} />
      <ResolutionSelector value={resolution} onChange={onResolutionChange} />
    </div>
  )
}

function AiFashionPhotoForm({
  references,
  prompt,
  imageRatio,
  resolution,
  helperText,
  companyModels,
  selectedCompanyModel,
  onSelectCompanyModel,
  onOpenCompanyModelLibrary,
  onAddUploadReference,
  onRemoveReference,
  onPromptChange,
  onImageRatioChange,
  onResolutionChange,
}: {
  references: FashionReferenceImage[]
  prompt: string
  imageRatio: FashionImageRatio
  resolution: FashionResolution
  helperText: string
  companyModels: CompanyModel[]
  selectedCompanyModel: CompanyModel | null
  onSelectCompanyModel: (model: CompanyModel) => void
  onOpenCompanyModelLibrary: () => void
  onAddUploadReference: (image: UploadedImage) => void
  onRemoveReference: (assetId: string) => void
  onPromptChange: (value: string) => void
  onImageRatioChange: (value: FashionImageRatio) => void
  onResolutionChange: (value: FashionResolution) => void
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground">版本</span>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-xs font-medium text-foreground"
          >
            高级版
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <FashionReferenceUploader
        references={references}
        helperText={helperText}
        onAddUploadReference={onAddUploadReference}
        onRemoveReference={onRemoveReference}
      />

      <CompanyModelStrip
        models={companyModels}
        selectedModel={selectedCompanyModel}
        onSelectModel={onSelectCompanyModel}
        onOpenLibrary={onOpenCompanyModelLibrary}
      />

      <div className="space-y-2">
        <RequiredLabel label="提示词" />
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="请输入提示词"
            maxLength={800}
            className="h-[112px] w-full resize-none rounded-md border border-border bg-black p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
            {prompt.length}/800
          </span>
        </div>
      </div>

      <FashionRatioSelector value={imageRatio} onChange={onImageRatioChange} />
      <FashionResolutionSelector value={resolution} onChange={onResolutionChange} />
    </div>
  )
}

function CompanyModelStrip({
  models,
  selectedModel,
  onSelectModel,
  onOpenLibrary,
}: {
  models: CompanyModel[]
  selectedModel: CompanyModel | null
  onSelectModel: (model: CompanyModel) => void
  onOpenLibrary: () => void
}) {
  const previewModels = models.slice(0, 5)

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">从我的模特库选择常用模特</p>
      <div className="flex items-center gap-2 rounded-md bg-secondary p-2">
        <span className="w-12 shrink-0 text-xs text-muted-foreground">模特库</span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {previewModels.map((model) => (
            <button
              key={model.assetId}
              type="button"
              onClick={() => onSelectModel(model)}
              className={cn(
                'h-9 w-9 overflow-hidden rounded border bg-background',
                selectedModel?.assetId === model.assetId ? 'border-primary' : 'border-border',
              )}
              aria-label={`选择${model.name}`}
            >
              <img src={model.preview} alt={model.name} className="h-full w-full object-cover" />
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenLibrary}
            className="ml-auto h-9 min-w-10 rounded bg-card px-2 text-[10px] font-medium text-foreground hover:text-primary"
          >
            More
          </button>
        </div>
      </div>
    </div>
  )
}

function FashionReferenceUploader({
  references,
  helperText,
  onAddUploadReference,
  onRemoveReference,
}: {
  references: FashionReferenceImage[]
  helperText: string
  onAddUploadReference: (image: UploadedImage) => void
  onRemoveReference: (assetId: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const canAddMore = references.length < 10

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return

    const availableSlots = 10 - references.length
    if (availableSlots <= 0) {
      setUploadError('参考图最多上传10张')
      return
    }

    setIsUploading(true)
    setUploadError('')

    try {
      for (const file of files.slice(0, availableSlots)) {
        const preview = URL.createObjectURL(file)
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/assets/upload', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const data = (await response.json()) as { error?: string }
          throw new Error(data.error || '上传失败')
        }

        const data = (await response.json()) as {
          assetId: string
          fileName: string
          width: number
          height: number
        }

        onAddUploadReference({
          assetId: data.assetId,
          preview,
          name: data.fileName,
          width: data.width,
          height: data.height,
        })
      }

      if (files.length > availableSlots) {
        setUploadError('参考图最多上传10张，已自动忽略超出图片')
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <RequiredLabel label="参考图（最多支持10张参考图）" />
      <div className="grid grid-cols-2 gap-2">
        {references.map((reference) => (
          <div
            key={reference.assetId}
            className="group relative aspect-square overflow-hidden rounded-md border border-border bg-background"
          >
            <img
              src={reference.preview}
              alt={reference.name}
              className="h-full w-full object-cover"
            />
            <span className="absolute left-1.5 top-1.5 max-w-[72px] truncate rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-foreground">
              {reference.source === 'model' ? '模特' : '参考'}
            </span>
            <button
              type="button"
              onClick={() => onRemoveReference(reference.assetId)}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/90 opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
              aria-label="移除参考图"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {canAddMore && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-md border border-dashed border-border bg-secondary px-3 text-center transition-colors hover:border-primary/60 hover:bg-primary/5"
          >
            <span className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
              <span>{isUploading ? '上传中...' : helperText}</span>
            </span>
          </button>
        )}
      </div>
      {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  )
}

function FashionRatioSelector({
  value,
  onChange,
}: {
  value: FashionImageRatio
  onChange: (value: FashionImageRatio) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <RequiredLabel label="图片比例" />
        <span className="text-xs text-muted-foreground">{value}</span>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {FASHION_IMAGE_RATIOS.map((option) => {
          const ratioStyle = getFashionRatioStyle(option.id)

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                'flex h-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors',
                value === option.id ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:border-primary/50',
              )}
            >
              <span
                className={cn(
                  'rounded-sm border',
                  value === option.id ? 'border-primary' : 'border-muted-foreground',
                )}
                style={ratioStyle}
              />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FashionResolutionSelector({
  value,
  onChange,
}: {
  value: FashionResolution
  onChange: (value: FashionResolution) => void
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-foreground">分辨率</span>
      <div className="grid grid-cols-3 gap-2">
        {FASHION_RESOLUTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              'flex h-10 items-center justify-center rounded-md border text-xs font-medium transition-colors',
              value === option.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground hover:border-primary/50',
            )}
          >
            {option.id === '4k' && <Zap className="mr-1.5 h-3.5 w-3.5 fill-current" />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function getFashionRatioStyle(id: FashionImageRatio) {
  if (id === '3:4') return { width: 15, height: 22 }
  if (id === '4:3') return { width: 22, height: 15 }
  if (id === '2:3') return { width: 15, height: 22 }
  if (id === '3:2') return { width: 22, height: 15 }
  if (id === 'more') return { width: 17, height: 20 }
  return { width: 18, height: 18 }
}

function RequiredLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-primary">*</span>
      <span className="text-sm text-foreground">{label}</span>
    </div>
  )
}

function PoseRatioSelector({
  value,
  onChange,
}: {
  value: PoseImageRatio
  onChange: (value: PoseImageRatio) => void
}) {
  return (
    <div className="space-y-2">
      <RequiredLabel label="图片比例" />
      <div className="grid grid-cols-6 gap-2">
        {POSE_IMAGE_RATIOS.map((option) => {
          const ratioStyle = getPoseRatioStyle(option.id)

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                'flex h-[54px] flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-[10px] transition-colors',
                value === option.id ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:border-primary/50',
              )}
            >
              <span
                className={cn(
                  'rounded-sm border',
                  value === option.id ? 'border-primary' : 'border-muted-foreground',
                  option.id === 'more' && 'relative',
                )}
                style={ratioStyle}
              />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ResolutionSelector({
  value,
  onChange,
}: {
  value: PoseResolution
  onChange: (value: PoseResolution) => void
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-foreground">分辨率</span>
      <div className="grid grid-cols-3 gap-2">
        {POSE_RESOLUTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              'flex h-10 items-center justify-center rounded-md border text-xs font-medium transition-colors',
              value === option.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground hover:border-primary/50',
            )}
          >
            {option.id === '4k' && <Zap className="mr-1.5 h-3.5 w-3.5 fill-current" />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function getPoseRatioStyle(id: PoseImageRatio) {
  if (id === '3:4') return { width: 15, height: 22 }
  if (id === '4:3') return { width: 22, height: 15 }
  if (id === '2:3') return { width: 15, height: 22 }
  if (id === '3:2') return { width: 22, height: 15 }
  if (id === 'more') return { width: 17, height: 20 }
  return { width: 18, height: 18 }
}
