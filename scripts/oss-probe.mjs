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

console.log('bucket:', process.env.OSS_BUCKET)

async function probeVersioning() {
  try {
    const r = await client.getBucketVersioning(process.env.OSS_BUCKET)
    console.log('\n=== Versioning status ===')
    console.log(JSON.stringify(r, null, 2))
  } catch (e) {
    console.log('\n=== Versioning probe FAILED ===', e.code || e.name, e.status, (e.message || '').slice(0, 150))
  }
}

async function probeLifecycle() {
  try {
    const r = await client.getBucketLifecycle(process.env.OSS_BUCKET)
    console.log('\n=== Lifecycle rules ===')
    console.log(JSON.stringify(r, null, 2))
  } catch (e) {
    console.log('\n=== Lifecycle probe FAILED ===', e.code || e.name, e.status, (e.message || '').slice(0, 200))
  }
}

async function confirm404() {
  const key = 'yibai/results/usr_local_user01/result_task_1782186322946_tj9prr_1.png'
  try {
    const r = await client.head(key)
    console.log('\n=== HEAD deleted key === status:', r.status)
  } catch (e) {
    console.log('\n=== HEAD deleted key ===', e.code || e.name, e.status, (e.message || '').slice(0, 80))
  }
}

async function probeDeletedVersions() {
  const key = 'yibai/results/usr_local_user01/result_task_1782186322946_tj9prr_1.png'
  try {
    const r = await client.list({ prefix: key, 'max-keys': 10 }, { versions: true })
    console.log('\n=== Versions for deleted key ===')
    console.log(JSON.stringify(r, null, 2))
  } catch (e) {
    console.log('\n=== Versions probe FAILED ===', e.code || e.name, e.status, (e.message || '').slice(0, 200))
  }
}

await probeVersioning()
await probeLifecycle()
await confirm404()
await probeDeletedVersions()
