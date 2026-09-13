/**
 * 坐标换算改编自 VOZEB-PRO canvas-surface-geometry.ts 的 worldFromScreen。
 * 上游版本：3573154a12bab922c132df0159787cbe430eee17；BUSL-1.1。
 * 来源与完整许可见 third-party/vozeb-pro/NOTICE.md，仅用于本地开发验证。
 */
export interface CanvasPoint { x: number; y: number }
export interface CanvasViewport { x: number; y: number; zoom: number }

export function clampZoom(value: number): number {
  return Number.isFinite(value) ? Math.min(2, Math.max(0.25, value)) : 1
}

/** point 为相对画布容器左上角的屏幕坐标。 */
export function screenToCanvas(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  const zoom = clampZoom(viewport.zoom)
  return { x: (point.x - viewport.x) / zoom, y: (point.y - viewport.y) / zoom }
}

export function zoomAtPoint(viewport: CanvasViewport, point: CanvasPoint, nextZoom: number): CanvasViewport {
  const world = screenToCanvas(point, viewport)
  const zoom = clampZoom(nextZoom)
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom }
}
