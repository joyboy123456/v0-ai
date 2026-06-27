const mib = 1024 * 1024

export function formatImageLimitMb(bytes: number): string {
  return (bytes / mib).toFixed(1)
}
