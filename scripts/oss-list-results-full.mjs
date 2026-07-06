import { readFileSync } from 'fs'
import OSS from 'ali-oss'
const envText = readFileSync('.env.local', 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
process.env = { ...process.env, ...env }
const client = new OSS({
  region: process.env.OSS_REGION || 'oss-cn-hangzhou',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  endpoint: process.env.OSS_INTERNAL_ENDPOINT,
  secure: !(process.env.OSS_INTERNAL_ENDPOINT || '').includes('-internal'),
  timeout: 30000,
})
const all = []
let marker
do {
  const r = await client.list({ prefix: 'yibai/results/', 'max-keys': 1000, marker }, {})
  for (const o of (r.objects || [])) all.push({ key: o.name, size: o.size, lastModified: o.lastModified })
  marker = r.nextMarker
} while (marker)
// 拆分图 vs 缩略图
const images = all.filter(o => !o.key.endsWith('_thumb.webp'))
const thumbs = all.filter(o => o.key.endsWith('_thumb.webp'))
console.log(`图: ${images.length}, 缩略图: ${thumbs.length}`)
// 从 key 提取 taskId：result_task_{num}_{rand}_{idx}.png
const re = /result_(task_\d+_\w+)_(\d+)\.(png|jpg|jpeg|webp)$/
const byTask = new Map()
for (const o of images) {
  const m = o.key.match(re)
  if (!m) { continue }
  const taskId = m[1]
  const shotIdx = parseInt(m[2], 10)
  if (!byTask.has(taskId)) byTask.set(taskId, [])
  byTask.get(taskId).push({ key: o.key, size: o.size, lastModified: o.lastModified, shotIdx })
}
console.log(`\n按 taskId 分组: ${byTask.size} 个 task`)
// 按 taskId 的最早 lastModified 排序
const sorted = [...byTask.entries()].sort((a,b) => {
  const ta = a[1].reduce((m,o)=> o.lastModified<m?o.lastModified:m, '9999')
  const tb = b[1].reduce((m,o)=> o.lastModified<m?o.lastModified:m, '9999')
  return ta.localeCompare(tb)
})
console.log('\ntaskId | 图片数 | 最早时间:')
for (const [taskId, imgs] of sorted) {
  const earliest = imgs.reduce((m,o)=> o.lastModified<m?o.lastModified:m, '9999')
  console.log(`  ${taskId} | ${imgs.length} | ${earliest}`)
}
