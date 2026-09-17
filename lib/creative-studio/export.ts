import type { CanvasNode } from './model'
const encoder = new TextEncoder()
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let n = 0; n < 8; n++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
/** Minimal ZIP STORE writer: no compression, UTF-8 names, explicit CRC. No renamed fake formats. */
export function zipStored(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [], directory: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name.replace(/[\\/]/g, '_')), size = file.bytes.length, crc = crc32(file.bytes)
    const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true)
    view.setUint32(14, crc, true); view.setUint32(18, size, true); view.setUint32(22, size, true); view.setUint16(26, name.length, true); local.set(name, 30)
    const central = new Uint8Array(46 + name.length), dv = new DataView(central.buffer)
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x800, true)
    dv.setUint32(16, crc, true); dv.setUint32(20, size, true); dv.setUint32(24, size, true); dv.setUint16(28, name.length, true); dv.setUint32(42, offset, true); central.set(name, 46)
    locals.push(local, file.bytes); directory.push(central); offset += local.length + size
  }
  const centralSize = directory.reduce((sum, item) => sum + item.length, 0), end = new Uint8Array(22), view = new DataView(end.buffer)
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true)
  const zip = new Uint8Array(offset + centralSize + end.length)
  let cursor = 0
  for (const part of [...locals, ...directory, end]) { zip.set(part, cursor); cursor += part.length }
  return zip
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export async function exportNodes(nodes: CanvasNode[], format: 'original' | 'png' | 'jpeg', prefix: string) {
  const files: { name: string; bytes: Uint8Array; type: string }[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!node.url || node.status !== 'ready') continue
    const response = await fetch(node.url)
    if (!response.ok) throw new Error(`无法读取「${node.name}」，未导出不完整文件`)
    let blob = await response.blob()
    if (!blob.type.startsWith('image/')) throw new Error('素材不是可导出的图片')
    if (format !== 'original') {
      const bitmap = await createImageBitmap(blob)
      if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error('图片过大，请按原格式导出') }
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) { bitmap.close(); throw new Error('浏览器无法转换图片格式') }
      if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
      context.drawImage(bitmap, 0, 0); bitmap.close()
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片编码失败')), `image/${format}`, .94))
    }
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[blob.type] ?? 'png'
    const safeName = `${prefix || '商拍'}_${String(i + 1).padStart(2, '0')}_${node.name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 110)
    files.push({ name: `${safeName}.${extension}`, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type })
  }
  if (!files.length) throw new Error('请先选择至少一张已完成的图片')
  if (files.length === 1) saveBlob(new Blob([files[0].bytes as BlobPart], { type: files[0].type }), files[0].name)
  else saveBlob(new Blob([zipStored(files) as BlobPart], { type: 'application/zip' }), `${prefix || '商拍素材'}.zip`)
  return files.length
}
