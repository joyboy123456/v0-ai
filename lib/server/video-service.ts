import type { VideoGenerationParams, ResultAsset } from '@/lib/types'
import {
  submitVideoGeneration,
  pollVideoTask,
} from './model-router-client'

export interface RunVideoGenerationOptions {
  taskId: string
  params: VideoGenerationParams
  /** 进度回调：把轮询的 status 透传给上游 task-store 更新 task.message */
  onProgress?: (info: {
    status: string
    elapsedMs: number
    attempt: number
  }) => void
}

/**
 * 把 "1920*1080" / "1280*720" / "832*480" 等 size 字符串解析成 width/height。
 * - 兼容 "*" / "x" 分隔
 * - 解析失败时退化到 1280x720（720p 横屏），不抛错
 */
export function parseVideoSize(size?: string): { width: number; height: number } {
  if (!size) return { width: 1280, height: 720 }
  const match = size.match(/^(\d+)\s*[*x×]\s*(\d+)$/i)
  if (!match) return { width: 1280, height: 720 }
  const w = Number(match[1])
  const h = Number(match[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 1280, height: 720 }
  }
  return { width: w, height: h }
}

/**
 * 视频生成 pipeline：提交 → 轮询 → 返回单条 ResultAsset。
 *
 * 这一层只负责调度 ModelRouter；视频字节流的归档由 task-store.persistOneResult
 * 在收到回调后做（与 photo-fission / pose-fission 走同一条流式持久化路径）。
 * 这里返回的 url 还是 OSS 签名 URL（有效期约 24h），task-store 会立即 fetch 落地。
 *
 * width/height 来自 params.size（按 ModelRouter 文档 "宽*高" 解析）；不传时 720p 兜底。
 */
export async function runVideoGenerationPipeline(
  options: RunVideoGenerationOptions,
): Promise<ResultAsset[]> {
  const { taskId, params, onProgress } = options

  const remoteTaskId = await submitVideoGeneration({
    model: params.model,
    prompt: params.prompt,
    size: params.size,
    duration: params.duration,
    imageUrl: params.imageUrl,
  })

  const videoUrl = await pollVideoTask(remoteTaskId, {
    onProgress,
  })

  const { width, height } = parseVideoSize(params.size)

  return [
    {
      assetId: `result_${taskId}_1`,
      url: videoUrl,
      downloadUrl: videoUrl,
      width,
      height,
      label: params.prompt,
      mediaType: 'video',
    },
  ]
}
