import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * OSS 图片实时处理 —— 在 URL 后附加 x-oss-process 参数，OSS 服务端实时返回缩略图。
 * 无需生成额外文件，无需后端改动，历史图片也能立即生效。
 */
export function getOssThumbnailUrl(
  url: string | undefined,
  width: number = 400,
): string {
  if (!url) return ''
  if (!url.includes('aliyuncs.com')) return url
  if (url.includes('x-oss-process')) return url
  return `${url}?x-oss-process=image/resize,w_${width}/format,webp/quality,q_80`
}

// Gemini 3 Pro Image inline data 官方限制：单张图片最大 7 MB
// 文档：https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-pro-image
export const MAX_UPLOAD_BYTES = 7 * 1024 * 1024

/**
 * 验证上传文件大小是否符合 Gemini 3 Pro Image 限制。
 *
 * @returns null when the file is acceptable, or a Chinese error message string otherwise.
 */
export function validateUploadSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1)
    return `图片尺寸过大（${sizeMb}MB），请使用小于 7MB 的图片`
  }
  return null
}
