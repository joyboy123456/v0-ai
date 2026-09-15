import assert from 'node:assert/strict'
import test from 'node:test'
import { clampZoom, screenToCanvas, zoomAtPoint } from './canvas-geometry'

test('平移缩放后的坐标仍准确映射，缩放锚点不漂移', () => {
  const viewport = { x: 40, y: -20, zoom: 0.5 }
  const point = { x: 140, y: 80 }
  assert.deepEqual(screenToCanvas(point, viewport), { x: 200, y: 200 })
  assert.deepEqual(screenToCanvas(point, zoomAtPoint(viewport, point, 1.5)), { x: 200, y: 200 })
})

test('缩放边界与无效输入不会产生无限坐标', () => {
  assert.equal(clampZoom(0), 0.25)
  assert.equal(clampZoom(100), 2)
  assert.equal(clampZoom(Number.NaN), 1)
  assert.ok(Number.isFinite(screenToCanvas({ x: 1, y: 2 }, { x: 0, y: 0, zoom: 0 }).x))
})
