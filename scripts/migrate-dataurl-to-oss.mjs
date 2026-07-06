#!/usr/bin/env node
/**
 * 把 store.json 中残留的 base64 dataUrl asset 迁移到 OSS，消除内存炸弹。
 *
 * 背景：storeAssetFromDataUrl 曾静默吞错，OSS 上传失败时 base64 留在 store.json。
 * 每次 persistStore 的 JSON.stringify 会把 base64 序列化进内存，1MB+ 的 base64
 * 叠加并发请求会撑爆内存 → OOM Kill → store.json 截断。
 *
 * 本脚本：
 *   1. 扫描 store.json 中所有 fileUrl 或 dataUrl 是 data: 开头的 asset
 *   2. 上传到 OSS（yibai/assets/{userId}/）
 *   3. 把 asset.fileUrl 替换为 OSS URL，清除 dataUrl 字段
 *   4. 原子写入 store.json
 *
 * 使用方式：先 pm2 stop yibai-fission，再 node scripts/migrate-dataurl-to-oss.mjs
 */
import { readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs'
import { join } from 'path'
import OSS from 'ali-oss'

const cwd = process.cwd()
const storePath = join(cwd, 'data', 'fashion-mvp-store.json')
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
const backupPath = `${storePath}.bak-migrate-${ts}`

// 读 env
const envText = readFileSync(join(cwd, '.env.local'), 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const client = new OSS({
  region: process.env.OSS_REGION || 'oss-cn-hangzhou',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID || env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET || env.OSS_BUCKET,
  endpoint: process.env.OSS_INTERNAL_ENDPOINT || env.OSS_INTERNAL_ENDPOINT,
  secure: !((process.env.OSS_INTERNAL_ENDPOINT || env.OSS_INTERNAL_ENDPOINT || '').includes('-internal')),
  timeout: 120000,
})
const publicUrl = (process.env.OSS_PUBLIC_URL || env.OSS_PUBLIC_URL || '').replace(/\/$/, '')

// 备份
copyFileSync(storePath, backupPath)
console.log('✓ 已备份:', backupPath)

const store = JSON.parse(readFileSync(storePath, 'utf8'))
const assets = store.assets || []
console.log(`扫描 ${assets.length} 个 asset...`)

// 找 base64 asset
const dataUrlAssets = assets.filter(
  (a) => (a.fileUrl && a.fileUrl.startsWith('data:')) || (a.dataUrl && a.dataUrl.startsWith('data:')),
)
console.log(`含 base64 dataUrl 的 asset: ${dataUrlAssets.length}`)

if (dataUrlAssets.length === 0) {
  console.log('无需迁移，退出')
  process.exit(0)
}

// 从 dataUrl 提取 mime 和 base64
function parseDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return null
  return { mime: m[1], base64: m[2] }
}

function getExtension(mime) {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'jpg'
}

// 逐个上传
let migrated = 0
let failed = 0
for (const asset of dataUrlAssets) {
  const rawDataUrl = asset.fileUrl?.startsWith('data:') ? asset.fileUrl : asset.dataUrl
  const parsed = parseDataUrl(rawDataUrl)
  if (!parsed) {
    console.log(`  ✗ ${asset.assetId}: dataUrl 格式无法解析，跳过`)
    failed++
    continue
  }

  const userId = asset.userId || 'usr_local_user01'
  const ext = getExtension(parsed.mime)
  const ossKey = `yibai/assets/${userId}/${asset.assetId}.${ext}`

  try {
    const body = Buffer.from(parsed.base64, 'base64')
    await client.put(ossKey, body, { mime: parsed.mime })
    const newUrl = `${publicUrl}/${ossKey}`
    console.log(`  ✓ ${asset.assetId}: ${rawDataUrl.length} bytes → ${newUrl}`)

    // 更新 asset
    asset.fileUrl = newUrl
    asset.dataUrl = undefined
    migrated++
  } catch (err) {
    console.log(`  ✗ ${asset.assetId}: OSS 上传失败 ${err.code || err.name} ${err.message}`)
    failed++
  }
}

console.log(`\n迁移完成：成功 ${migrated}，失败 ${failed}`)

if (migrated > 0) {
  // 原子写入
  const tmpPath = storePath + '.tmp-write'
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmpPath, storePath)
  console.log('✓ 已原子写入 store.json')
  const verify = JSON.parse(readFileSync(storePath, 'utf8'))
  const remaining = verify.assets.filter(
    (a) => (a.fileUrl && a.fileUrl.startsWith('data:')) || (a.dataUrl && a.dataUrl.startsWith('data:')),
  )
  console.log(`验证：剩余 base64 asset ${remaining.length} 个`)
}
