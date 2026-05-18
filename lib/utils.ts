import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/**
 * Reject files that would exceed the third-party image proxy's effective body limit
 * (the proxy recommends ≤ 10MB per image, base64 inflates ~1.33×, so we cap at 8MB
 * raw to leave headroom for prompt + multi-image batches).
 *
 * @returns null when the file is acceptable, or a Chinese error message string otherwise.
 */
export function validateUploadSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1)
    return `图片体积 ${sizeMb}MB 超过 8MB 上限，请压缩后再上传`
  }
  return null
}
