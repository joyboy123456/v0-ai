export type ImageResolutionTier = '1K' | '2K' | '3K' | '4K'

export interface ImageSizePreset {
  ratio: string
  size1K: string
  size2K: string
  size3K: string
  size4K: string
}

export interface ResolvedImageSize {
  ratio: string
  resolution: ImageResolutionTier
  width: number
  height: number
  size: string
  pixels: number
}

const DEFAULT_RATIO = '1:1'
const DEFAULT_RESOLUTION: ImageResolutionTier = '2K'

const SIZE_PRESETS: Record<string, ImageSizePreset> = {
  '1:1': {
    ratio: '1:1',
    size1K: '1024x1024',
    size2K: '2048x2048',
    size3K: '3072x3072',
    size4K: '4096x4096',
  },
  '4:3': {
    ratio: '4:3',
    size1K: '1344x1024',
    size2K: '2304x1728',
    size3K: '3456x2592',
    size4K: '4704x3520',
  },
  '3:4': {
    ratio: '3:4',
    size1K: '1024x1344',
    size2K: '1728x2304',
    size3K: '2592x3456',
    size4K: '3520x4704',
  },
  '16:9': {
    ratio: '16:9',
    size1K: '1536x864',
    size2K: '2848x1600',
    size3K: '4096x2304',
    size4K: '5504x3040',
  },
  '9:16': {
    ratio: '9:16',
    size1K: '864x1536',
    size2K: '1600x2848',
    size3K: '2304x4096',
    size4K: '3040x5504',
  },
  '3:2': {
    ratio: '3:2',
    size1K: '1536x1024',
    size2K: '2496x1664',
    size3K: '3744x2496',
    size4K: '4992x3328',
  },
  '2:3': {
    ratio: '2:3',
    size1K: '1024x1536',
    size2K: '1664x2496',
    size3K: '2496x3744',
    size4K: '3328x4992',
  },
  '4:5': {
    ratio: '4:5',
    size1K: '1024x1280',
    size2K: '1792x2304',
    size3K: '2760x3450',
    size4K: '3584x4480',
  },
  '5:4': {
    ratio: '5:4',
    size1K: '1280x1024',
    size2K: '2304x1792',
    size3K: '3450x2760',
    size4K: '4480x3584',
  },
  '21:9': {
    ratio: '21:9',
    size1K: '1536x658',
    size2K: '3136x1344',
    size3K: '4704x2016',
    size4K: '6240x2656',
  },
}

export function resolveImageSize(
  ratio: string | undefined,
  resolution: string | undefined,
): ResolvedImageSize {
  const normalizedRatio = normalizeRatio(ratio)
  const normalizedResolution = normalizeResolution(resolution)
  const preset = SIZE_PRESETS[normalizedRatio] ?? SIZE_PRESETS[DEFAULT_RATIO]!
  const size = pickPresetSize(preset, normalizedResolution)
  const { width, height } = parseSize(size)

  return {
    ratio: preset.ratio,
    resolution: normalizedResolution,
    width,
    height,
    size,
    pixels: width * height,
  }
}

export function normalizeResolution(
  resolution: string | undefined,
): ImageResolutionTier {
  const normalized = resolution?.trim().toUpperCase()
  if (
    normalized === '1K' ||
    normalized === '2K' ||
    normalized === '3K' ||
    normalized === '4K'
  ) {
    return normalized
  }
  return DEFAULT_RESOLUTION
}

export function normalizeRatio(ratio: string | undefined): string {
  const normalized = ratio?.trim().replace('：', ':')
  if (!normalized) return DEFAULT_RATIO
  return SIZE_PRESETS[normalized] ? normalized : DEFAULT_RATIO
}

export function parseSize(size: string): { width: number; height: number } {
  const match = size.match(/^(\d+)x(\d+)$/i)
  if (!match) return { width: 2048, height: 2048 }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}

function pickPresetSize(
  preset: ImageSizePreset,
  resolution: ImageResolutionTier,
): string {
  switch (resolution) {
    case '4K':
      return preset.size4K
    case '3K':
      return preset.size3K
    case '2K':
      return preset.size2K
    case '1K':
    default:
      return preset.size1K
  }
}
