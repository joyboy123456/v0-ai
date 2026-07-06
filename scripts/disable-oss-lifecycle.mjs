#!/usr/bin/env node
/**
 * 禁用 OSS Lifecycle 规则（止血）。
 *
 * 背景：setup-oss-lifecycle.mjs 设置的 auto-delete-unfavorited-results 规则
 * 无差别删除 yibai/results/ 下所有图（OSS Lifecycle 不支持按业务 favorited 字段
 * 过滤），导致 37 张生成图被误删。本脚本删除该 Lifecycle 规则止血。
 *
 * 规则配置在 scripts/setup-oss-lifecycle.mjs 有记录，需要时可重新设置（但
 * 重新设置前必须先解决"无差别删除 vs 仅删未收藏"的设计缺陷）。
 *
 * 使用方式：node scripts/disable-oss-lifecycle.mjs
 */
import { readFileSync } from 'fs'
import OSS from 'ali-oss'

const envText = readFileSync('.env.local', 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
process.env = { ...process.env, ...env }

const region = process.env.OSS_REGION?.trim() || 'oss-cn-hangzhou'
const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim()
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET?.trim()
const bucket = process.env.OSS_BUCKET?.trim()
const internalEndpoint = process.env.OSS_INTERNAL_ENDPOINT?.trim() || `${region}-internal.aliyuncs.com`

const client = new OSS({
  region,
  accessKeyId,
  accessKeySecret,
  bucket,
  endpoint: internalEndpoint,
  secure: !internalEndpoint.includes('-internal'),
})

async function showCurrent() {
  try {
    const r = await client.getBucketLifecycle(bucket)
    const rules = r.rules || []
    console.log(`当前 Lifecycle 规则数：${rules.length}`)
    for (const rule of rules) {
      console.log(`  - id=${rule.id} prefix=${rule.prefix} status=${rule.status} expiration.days=${rule.expiration?.days}`)
    }
    return rules
  } catch (e) {
    if (e.code === 'NoSuchLifecycleConfiguration' || e.status === 404) {
      console.log('当前无 Lifecycle 规则')
      return []
    }
    throw e
  }
}

async function run() {
  console.log('=== 删除前 ===')
  const before = await showCurrent()
  if (before.length === 0) {
    console.log('\n无需删除，本就没有 Lifecycle 规则')
    return
  }
  console.log(`\n即将删除 ${before.length} 条 Lifecycle 规则...`)
  await client.deleteBucketLifecycle(bucket)
  console.log('✓ Lifecycle 规则已删除')
  console.log('\n=== 删除后 ===')
  await showCurrent()
}

run().catch((err) => {
  console.error('✗ 禁用 Lifecycle 失败：', err.code || err.name, err.status, err.message)
  process.exit(1)
})
