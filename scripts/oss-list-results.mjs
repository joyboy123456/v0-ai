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
// 列 yibai/results/ 前缀所有对象
const all = []
let marker
let count = 0
do {
  const r = await client.list({ prefix: 'yibai/results/', 'max-keys': 1000, marker }, {})
  const objs = r.objects || []
  for (const o of objs) {
    all.push({ key: o.name, size: o.size, lastModified: o.lastModified })
  }
  marker = r.nextMarker || r.isTruncated ? r.nextMarker : null
  count += objs.length
} while (marker)
console.log(`yibai/results/ 现存对象数: ${all.length}`)
// 按日期分桶
const byDay = {}
for (const o of all) {
  const d = (o.lastModified || '').slice(0, 10)
  byDay[d] = (byDay[d] || 0) + 1
}
console.log('按 lastModified 日期:')
for (const d of Object.keys(byDay).sort()) console.log(`  ${d}: ${byDay[d]}`)
console.log('\n最近 10 个对象:')
all.sort((a,b)=> (b.lastModified||'').localeCompare(a.lastModified||''))
for (const o of all.slice(0,10)) console.log(`  ${o.lastModified}  ${o.size}B  ${o.key}`)
