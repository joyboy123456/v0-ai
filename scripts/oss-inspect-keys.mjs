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
// 看一个多 shot task 的 key
const r = await client.list({ prefix: 'yibai/results/usr_local_user01/result_task_1783300527155_6zd5t0', 'max-keys': 20 }, {})
console.log('多 shot task keys:')
for (const o of (r.objects||[])) console.log(`  ${o.name} (${o.size}B)`)
// 看一个单 shot task 的 key
const r2 = await client.list({ prefix: 'yibai/results/usr_local_user01/result_task_1783309794361_hwzh61', 'max-keys': 10 }, {})
console.log('\n单 shot task keys:')
for (const o of (r2.objects||[])) console.log(`  ${o.name} (${o.size}B)`)
