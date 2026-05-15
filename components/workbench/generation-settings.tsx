'use client'

import { OptionGroup } from './option-group'
import type { FeatureType, GenerationSettings } from '@/lib/types'

interface GenerationSettingsProps {
  feature: FeatureType
  settings: GenerationSettings
  onSettingsChange: (settings: GenerationSettings) => void
}

export function GenerationSettingsPanel({ feature, settings, onSettingsChange }: GenerationSettingsProps) {
  const updateSetting = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">2</span>
        <h3 className="text-sm font-medium text-foreground">生成设置</h3>
      </div>

      <div className="space-y-4">
        {/* AI服装大片 Settings */}
        {feature === 'ai-fashion-photo' && (
          <>
            <OptionGroup
              label="场景风格"
              options={[
                { value: 'all', label: '全部' },
                { value: 'studio', label: '室内棚拍' },
                { value: 'outdoor', label: '户外自然' },
                { value: 'street', label: '街拍风' },
                { value: 'lifestyle', label: '生活场景' },
              ]}
              value={settings.sceneStyle}
              onChange={(v) => updateSetting('sceneStyle', v)}
            />
            <OptionGroup
              label="模特类型"
              options={[
                { value: 'all', label: '全部' },
                { value: 'female', label: '女模' },
                { value: 'male', label: '男模' },
              ]}
              value={settings.modelType}
              onChange={(v) => updateSetting('modelType', v)}
            />
            <OptionGroup
              label="生成数量"
              options={[
                { value: '4', label: '4张' },
                { value: '8', label: '8张' },
                { value: '12', label: '12张' },
                { value: '16', label: '16张' },
              ]}
              value={settings.count.toString()}
              onChange={(v) => updateSetting('count', parseInt(v))}
            />
            <OptionGroup
              label="图片比例"
              options={[
                { value: '3:4', label: '3:4' },
                { value: '1:1', label: '1:1' },
                { value: '9:16', label: '9:16' },
                { value: '16:9', label: '16:9' },
              ]}
              value={settings.aspectRatio}
              onChange={(v) => updateSetting('aspectRatio', v)}
            />
          </>
        )}

        {/* 服装大片-元素替换 Settings */}
        {feature === 'element-replace' && (
          <>
            <OptionGroup
              label="替换类型"
              options={[
                { value: 'clothing', label: '替换服装' },
                { value: 'face', label: '替换模特脸部' },
                { value: 'background', label: '替换背景' },
              ]}
              value={settings.replaceType || 'background'}
              onChange={(v) => updateSetting('replaceType', v)}
            />
            <OptionGroup
              label="替换强度"
              options={[
                { value: 'light', label: '轻度' },
                { value: 'medium', label: '中度' },
                { value: 'strong', label: '强度' },
              ]}
              value={settings.replaceStrength || 'medium'}
              onChange={(v) => updateSetting('replaceStrength', v)}
            />
            {settings.replaceType === 'background' && (
              <OptionGroup
                label="背景类型"
                options={[
                  { value: 'solid', label: '纯色棚拍' },
                  { value: 'outdoor', label: '户外自然' },
                  { value: 'street', label: '街拍场景' },
                  { value: 'premium', label: '高级商拍' },
                ]}
                value={settings.backgroundType || 'solid'}
                onChange={(v) => updateSetting('backgroundType', v)}
              />
            )}
            <OptionGroup
              label="生成数量"
              options={[
                { value: '4', label: '4张' },
                { value: '8', label: '8张' },
                { value: '12', label: '12张' },
              ]}
              value={settings.count.toString()}
              onChange={(v) => updateSetting('count', parseInt(v))}
            />
          </>
        )}

        {/* 服装大片裂变 Settings */}
        {feature === 'photo-variation' && (
          <>
            <OptionGroup
              label="裂变方向"
              options={[
                { value: 'angle', label: '多角度' },
                { value: 'scene', label: '多场景' },
                { value: 'composition', label: '多构图' },
                { value: 'style', label: '多风格' },
              ]}
              value={settings.variationDirection || 'angle'}
              onChange={(v) => updateSetting('variationDirection', v)}
            />
            <OptionGroup
              label="场景风格"
              options={[
                { value: 'all', label: '全部' },
                { value: 'studio', label: '室内棚拍' },
                { value: 'outdoor', label: '户外自然' },
                { value: 'street', label: '街拍风' },
                { value: 'lifestyle', label: '生活场景' },
              ]}
              value={settings.sceneStyle}
              onChange={(v) => updateSetting('sceneStyle', v)}
            />
            <OptionGroup
              label="生成数量"
              options={[
                { value: '4', label: '4张' },
                { value: '8', label: '8张' },
                { value: '12', label: '12张' },
                { value: '16', label: '16张' },
              ]}
              value={settings.count.toString()}
              onChange={(v) => updateSetting('count', parseInt(v))}
            />
            <OptionGroup
              label="图片比例"
              options={[
                { value: '3:4', label: '3:4' },
                { value: '1:1', label: '1:1' },
                { value: '9:16', label: '9:16' },
                { value: '16:9', label: '16:9' },
              ]}
              value={settings.aspectRatio}
              onChange={(v) => updateSetting('aspectRatio', v)}
            />
          </>
        )}

        {/* 姿势裂变 Settings */}
        {feature === 'pose-variation' && (
          <>
            <OptionGroup
              label="姿势类型"
              options={[
                { value: 'standing', label: '站姿' },
                { value: 'sitting', label: '坐姿' },
                { value: 'walking', label: '走姿' },
                { value: 'looking-back', label: '回头' },
                { value: 'side', label: '侧身' },
              ]}
              value={settings.poseType || 'standing'}
              onChange={(v) => updateSetting('poseType', v)}
            />
            <OptionGroup
              label="镜头角度"
              options={[
                { value: 'front', label: '正面' },
                { value: 'side', label: '侧面' },
                { value: 'back', label: '背面' },
                { value: 'half', label: '半身' },
                { value: 'full', label: '全身' },
              ]}
              value={settings.cameraAngle || 'full'}
              onChange={(v) => updateSetting('cameraAngle', v)}
            />
            <OptionGroup
              label="生成数量"
              options={[
                { value: '4', label: '4张' },
                { value: '8', label: '8张' },
                { value: '12', label: '12张' },
                { value: '16', label: '16张' },
              ]}
              value={settings.count.toString()}
              onChange={(v) => updateSetting('count', parseInt(v))}
            />
            <OptionGroup
              label="图片比例"
              options={[
                { value: '3:4', label: '3:4' },
                { value: '1:1', label: '1:1' },
                { value: '9:16', label: '9:16' },
                { value: '16:9', label: '16:9' },
              ]}
              value={settings.aspectRatio}
              onChange={(v) => updateSetting('aspectRatio', v)}
            />
          </>
        )}
      </div>
    </div>
  )
}
