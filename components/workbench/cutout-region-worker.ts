/**
 * 服饰智能分层 - 候选区域分析 Web Worker（PRD §39.2 / info.md §4.1）。
 *
 * 纯计算，无网络。主线程通过
 * `new Worker(new URL("./cutout-region-worker.ts", import.meta.url))` 加载，
 * 以 transferable 传入单个类别的工作尺寸灰度 Mask（>0 = 前景），
 * Worker 做连通区域分析（4 邻域 flood fill，Uint32 label map），输出：
 * 1. 区域列表（id/category/label/bbox/area，工作尺寸坐标）；
 * 2. 工作尺寸 label map（Uint32Array，0 = 空，供主线程点击增删选区）；
 * 3. 降采样 regionIndexMap（Uint32Array，最长边 ≤ indexMaxEdge，悬停命中查表）；
 * 4. 每区域 index 尺寸 previewMask（Uint8Array，255 = 该区域，供悬停蓝色高亮）。
 */

export interface CutoutRegionWorkerRequest {
  category: string
  width: number
  height: number
  /** 工作尺寸灰度像素（width*height 的 Uint8Array buffer，>0 = 前景）。 */
  mask: ArrayBuffer
  /** regionIndexMap / previewMask 的最长边上限（通常 1024）。 */
  indexMaxEdge: number
}

export interface CutoutRegionInfo {
  /** `${category}-${n}`，n 为该类内按发现顺序的序号。 */
  id: string
  category: string
  /** label map / regionIndexMap 中的像素值（从 1 开始，0 = 空）。 */
  label: number
  /** 工作尺寸坐标 [x, y, width, height]。 */
  bbox: [number, number, number, number]
  /** 前景像素数（工作尺寸）。 */
  area: number
}

export interface CutoutRegionPreview {
  label: number
  /** indexWidth*indexHeight 的 Uint8Array buffer（255 = 属于该区域）。 */
  data: ArrayBuffer
}

export interface CutoutRegionWorkerResponse {
  category: string
  width: number
  height: number
  /** 工作尺寸 Uint32Array buffer：每像素所属区域 label（0 = 空）。 */
  labelMap: ArrayBuffer
  regions: CutoutRegionInfo[]
  indexWidth: number
  indexHeight: number
  /** indexWidth*indexHeight 的 Uint32Array buffer：像素值 = label（0 = 空）。 */
  indexMap: ArrayBuffer
  previews: CutoutRegionPreview[]
}

/** 过小连通区域视为噪点丢弃（工作尺寸像素数）。 */
const MIN_REGION_AREA = 16

function analyzeRegions(
  request: CutoutRegionWorkerRequest,
): CutoutRegionWorkerResponse {
  const { category, width, height } = request
  const pixelCount = Math.max(0, width * height)
  const mask = new Uint8Array(request.mask, 0, pixelCount)
  const labelMap = new Uint32Array(pixelCount)

  let nextLabel = 0
  const keptLabels = new Set<number>()
  const regions: CutoutRegionInfo[] = []
  const stack: number[] = []

  for (let start = 0; start < pixelCount; start += 1) {
    if (mask[start] === 0 || labelMap[start] !== 0) continue

    nextLabel += 1
    const label = nextLabel
    let area = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    labelMap[start] = label
    stack.length = 0
    stack.push(start)

    while (stack.length > 0) {
      const position = stack.pop() as number
      const x = position % width
      const y = (position / width) | 0
      area += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      // 4 邻域扩散。
      if (x > 0) {
        const neighbor = position - 1
        if (mask[neighbor] > 0 && labelMap[neighbor] === 0) {
          labelMap[neighbor] = label
          stack.push(neighbor)
        }
      }
      if (x < width - 1) {
        const neighbor = position + 1
        if (mask[neighbor] > 0 && labelMap[neighbor] === 0) {
          labelMap[neighbor] = label
          stack.push(neighbor)
        }
      }
      if (y > 0) {
        const neighbor = position - width
        if (mask[neighbor] > 0 && labelMap[neighbor] === 0) {
          labelMap[neighbor] = label
          stack.push(neighbor)
        }
      }
      if (y < height - 1) {
        const neighbor = position + width
        if (mask[neighbor] > 0 && labelMap[neighbor] === 0) {
          labelMap[neighbor] = label
          stack.push(neighbor)
        }
      }
    }

    if (area < MIN_REGION_AREA) continue

    keptLabels.add(label)
    regions.push({
      id: `${category}-${regions.length + 1}`,
      category,
      label,
      bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
      area,
    })
  }

  // 降采样索引图：最长边 ≤ indexMaxEdge，最近邻取样 label。
  const maxEdge = Math.max(width, height, 1)
  const indexScale = Math.min(1, Math.max(1, request.indexMaxEdge) / maxEdge)
  const indexWidth = Math.max(1, Math.round(width * indexScale))
  const indexHeight = Math.max(1, Math.round(height * indexScale))
  const indexMap = new Uint32Array(indexWidth * indexHeight)
  const previewMap = new Map<number, Uint8Array>()

  for (let iy = 0; iy < indexHeight; iy += 1) {
    const sampleY = Math.min(height - 1, Math.floor((iy * height) / indexHeight))
    const rowOffset = iy * indexWidth
    const sampleRowOffset = sampleY * width
    for (let ix = 0; ix < indexWidth; ix += 1) {
      const sampleX = Math.min(width - 1, Math.floor((ix * width) / indexWidth))
      const label = labelMap[sampleRowOffset + sampleX]
      if (label === 0 || !keptLabels.has(label)) continue
      indexMap[rowOffset + ix] = label
      let preview = previewMap.get(label)
      if (!preview) {
        preview = new Uint8Array(indexWidth * indexHeight)
        previewMap.set(label, preview)
      }
      preview[rowOffset + ix] = 255
    }
  }

  const previews: CutoutRegionPreview[] = []
  for (const [label, data] of previewMap) {
    previews.push({ label, data: data.buffer as ArrayBuffer })
  }

  return {
    category,
    width,
    height,
    labelMap: labelMap.buffer as ArrayBuffer,
    regions,
    indexWidth,
    indexHeight,
    indexMap: indexMap.buffer as ArrayBuffer,
    previews,
  }
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<CutoutRegionWorkerRequest>) => void) | null
  postMessage(message: CutoutRegionWorkerResponse, transfer: Transferable[]): void
}

const workerScope = self as unknown as WorkerScope

workerScope.onmessage = (event) => {
  const response = analyzeRegions(event.data)
  const transfer: Transferable[] = [response.labelMap, response.indexMap]
  for (const preview of response.previews) transfer.push(preview.data)
  workerScope.postMessage(response, transfer)
}

export {}
