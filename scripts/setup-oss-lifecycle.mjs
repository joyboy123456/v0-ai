#!/usr/bin/env node
/**
 * OSS Lifecycle 规则配置脚本
 *
 * 为 OSS Bucket 设置生命周期规则：
 *   - `yibai/results/` 前缀下的生成图 + 缩略图：N 天后自动删除（兜底，防止 API 漏删）
 *   - 用户上传素材 `yibai/assets/` 不受影响，不会被 Lifecycle 删除
 *   - 可通过参数调整天数（默认 3 天）
 *
 * 使用方式：
 *   node scripts/setup-oss-lifecycle.mjs [expireDays]
 *
 * 环境变量（同 .env）：
 *   OSS_REGION, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET,
 *   OSS_INTERNAL_ENDPOINT (可选)
 *
 * 注意：OSS Lifecycle 规则最小粒度为 1 天，且规则生效后最多 24 小时内执行。
 * 这意味着 Lifecycle 是兜底机制，精确清理仍由 /api/cleanup API 负责。
 */

import OSS from 'ali-oss'

const expireDays = parseInt(process.argv[2] || '3', 10)

const region = process.env.OSS_REGION?.trim() || 'oss-cn-hangzhou'
const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim()
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET?.trim()
const bucket = process.env.OSS_BUCKET?.trim()
const internalEndpoint = process.env.OSS_INTERNAL_ENDPOINT?.trim() || `${region}-internal.aliyuncs.com`

if (!accessKeyId || !accessKeySecret || !bucket) {
  console.error('缺少 OSS 环境变量，请检查 .env 文件')
  process.exit(1)
}

const client = new OSS({
  region,
  accessKeyId,
  accessKeySecret,
  bucket,
  endpoint: internalEndpoint,
  secure: !internalEndpoint.includes('-internal'),
})

const ruleId = 'auto-delete-unfavorited-results'

async function setupLifecycle() {
  const rules = [
    {
      id: ruleId,
      // 仅兑底生成图（results bucket）；上传素材 yibai/assets/ 不受影响。
      prefix: 'yibai/results/',
      status: 'Enabled',
      expiration: {
        days: expireDays,
      },
    },
  ]

  try {
    await client.putBucketLifecycle(bucket, rules)
    console.log(`✓ Lifecycle 规则已设置：yibai/results/ 前缀下生成图 ${expireDays} 天后自动删除（上传素材不受影响）`)
  } catch (err) {
    console.error('✗ 设置 Lifecycle 规则失败：', err.message || err)
    process.exit(1)
  }
}

setupLifecycle()
