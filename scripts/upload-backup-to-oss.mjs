#!/usr/bin/env node
/**
 * 把 store.json 备份上传到 OSS 异地保留（30 天后 OSS Lifecycle 自动清理）。
 *
 * 使用方式：node scripts/upload-backup-to-oss.mjs <localBackupPath>
 * 由 backup-store.sh 在每天凌晨调用。
 *
 * OSS 路径：yibai/store-backups/fashion-mvp-store-<timestamp>.json
 * 保留策略：OSS Lifecycle 规则 30 天后自动删除（需在 OSS 控制台配置，或手动）。
 */
import { readFileSync, existsSync } from 'fs'
import { basename } from 'path'
import OSS from 'ali-oss'

const localPath = process.argv[2]
if (!localPath || !existsSync(localPath)) {
  console.error('用法：node scripts/upload-backup-to-oss.mjs <localBackupPath>')
  process.exit(1)
}

// 读 env
const envText = readFileSync('.env.local', 'utf8')
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
  timeout: 60000,
})

const ossKey = `yibai/store-backups/${basename(localPath)}`
try {
  const body = readFileSync(localPath)
  await client.put(ossKey, body)
  console.log(`✓ OSS 异地备份完成：${ossKey} (${body.length} bytes)`)
} catch (err) {
  console.error('✗ OSS 上传失败：', err.code || err.name, err.message)
  process.exit(1)
}
