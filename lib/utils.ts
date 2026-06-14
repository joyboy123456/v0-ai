import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
