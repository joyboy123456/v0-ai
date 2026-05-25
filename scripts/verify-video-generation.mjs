/**
 * scripts/verify-video-generation.mjs
 *
 * ModelRouter 视频生成 API 端到端探针：
 * 1) 读取 .env.local 拿到 VIDEO_API_KEY
 * 2) POST /v1/videos/generations 提交一个 happyhorse-1.0-t2v 任务
 * 3) 轮询 GET /v1/tasks/{task_id} 直到 SUCCEEDED / FAILED
 * 4) 把每一次原始响应打印出来，便于核对真实字段（task_status / video_url / output 嵌套结构）
 *
 * 用途：在改动 model-router-client.ts 前先用真实 API 校准协议字段，
 * 避免线上才发现字段名不匹配。
 *
 * 运行方式：
 *   node scripts/verify-video-generation.mjs
 *   node scripts/verify-video-generation.mjs --model qwen/wan2.7-t2v --prompt "一只在花园奔跑的猫"
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')
const envPath = resolve(projectRoot, '.env.local')

const BASE_URL = 'https://model-router.edu-aliyun.com/v1'

// 解析命令行：--model xxx --prompt xxx
function parseArgs() {
  const argv = process.argv.slice(2)
  const out = {
    model: 'qwen/happyhorse-1.0-t2v',
    prompt:
      '电商展示场景：一位亚洲女性模特身穿白色连衣裙，在阳光明媚的花园里缓缓转身，镜头从全身平拍切到半身近景，5 秒画面流畅自然。',
    size: undefined,
    duration: undefined,
  }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const value = argv[i + 1]
    if (key && value) out[key] = value
  }
  return out
}

// 读 .env.local 拿到指定 key
function readEnvKey(filePath, key) {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const k = trimmed.slice(0, eqIdx).trim()
    if (k !== key) continue
    let v = trimmed.slice(eqIdx + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    return v
  }
  return null
}

function maskKey(key) {
  if (!key || key.length < 12) return '***'
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

async function main() {
  const args = parseArgs()
  const apiKey =
    readEnvKey(envPath, 'VIDEO_API_KEY') ??
    readEnvKey(envPath, 'MODELROUTER_API_KEY')

  if (!apiKey) {
    console.error('[FATAL] .env.local 没有 VIDEO_API_KEY / MODELROUTER_API_KEY')
    process.exit(1)
  }

  console.log('===== ModelRouter 视频生成 API 探针 =====')
  console.log(`Base URL : ${BASE_URL}`)
  console.log(`API Key  : ${maskKey(apiKey)}`)
  console.log(`Model    : ${args.model}`)
  console.log(`Prompt   : ${args.prompt}`)
  if (args.size) console.log(`Size     : ${args.size}`)
  if (args.duration) console.log(`Duration : ${args.duration}`)
  console.log('')

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  // ---- 阶段 1：提交任务 ----
  console.log('[1/3] 提交视频生成任务...')
  const submitBody = {
    model: args.model,
    prompt: args.prompt,
  }
  if (args.size) submitBody.size = args.size
  if (args.duration) submitBody.duration = args.duration

  const submitStart = Date.now()
  const submitResp = await fetch(`${BASE_URL}/videos/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(submitBody),
  })
  const submitText = await submitResp.text()
  console.log(
    `  HTTP ${submitResp.status} (${Date.now() - submitStart}ms)`,
  )
  console.log(`  Raw response:\n${submitText}`)

  if (!submitResp.ok) {
    console.error('[FATAL] 提交失败')
    process.exit(2)
  }

  let submitJson
  try {
    submitJson = JSON.parse(submitText)
  } catch (error) {
    console.error('[FATAL] 提交响应不是 JSON:', error)
    process.exit(2)
  }

  // 兼容两种字段位置（DashScope native vs OpenAI-like）
  const taskId =
    submitJson?.output?.task_id ??
    submitJson?.task_id ??
    submitJson?.id ??
    submitJson?.data?.task_id

  if (!taskId) {
    console.error('[FATAL] 响应里找不到 task_id，请人工排查字段名')
    process.exit(2)
  }

  console.log(`  → task_id = ${taskId}`)
  console.log('')

  // ---- 阶段 2：轮询 ----
  console.log('[2/3] 轮询任务状态（最长 10 分钟，每 8s 一次）...')
  const startTime = Date.now()
  const maxWaitMs = 10 * 60 * 1000
  let pollIdx = 0
  let videoUrl = null
  let lastStatus = ''

  while (Date.now() - startTime < maxWaitMs) {
    pollIdx += 1
    const pollResp = await fetch(`${BASE_URL}/tasks/${taskId}`, {
      method: 'GET',
      headers,
    })
    const pollText = await pollResp.text()
    if (!pollResp.ok) {
      console.error(
        `  [poll #${pollIdx}] HTTP ${pollResp.status} - ${pollText}`,
      )
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }

    let pollJson
    try {
      pollJson = JSON.parse(pollText)
    } catch {
      console.error(`  [poll #${pollIdx}] 响应非 JSON: ${pollText}`)
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }

    const status =
      pollJson?.output?.task_status ??
      pollJson?.status ??
      pollJson?.data?.status ??
      'UNKNOWN'

    if (status !== lastStatus) {
      console.log(
        `  [poll #${pollIdx} | +${Math.round((Date.now() - startTime) / 1000)}s] status changed: ${lastStatus || 'INIT'} → ${status}`,
      )
      console.log(`    Raw: ${pollText.slice(0, 800)}`)
      lastStatus = status
    } else if (pollIdx % 5 === 0) {
      console.log(
        `  [poll #${pollIdx} | +${Math.round((Date.now() - startTime) / 1000)}s] still ${status}`,
      )
    }

    if (status === 'SUCCEEDED' || status === 'succeeded') {
      // 摸索 video_url 可能的位置
      videoUrl =
        pollJson?.output?.results?.video_url ??
        pollJson?.output?.video_url ??
        pollJson?.output?.results?.[0]?.url ??
        pollJson?.output?.results?.[0]?.video_url ??
        pollJson?.result?.video_url ??
        pollJson?.data?.video_url ??
        pollJson?.video_url
      console.log('')
      console.log('  ✅ 完整成功响应：')
      console.log(JSON.stringify(pollJson, null, 2))
      break
    }
    if (status === 'FAILED' || status === 'failed') {
      console.error('')
      console.error('  ❌ 任务失败完整响应：')
      console.error(JSON.stringify(pollJson, null, 2))
      process.exit(3)
    }

    await new Promise((r) => setTimeout(r, 8000))
  }

  if (!videoUrl) {
    console.error('[FATAL] 任务超时或未拿到 video_url')
    process.exit(4)
  }

  // ---- 阶段 3：报告结果 ----
  console.log('')
  console.log('[3/3] 探测结果总结')
  console.log(`  taskId   = ${taskId}`)
  console.log(`  videoUrl = ${videoUrl}`)
  console.log(`  elapsed  = ${Math.round((Date.now() - startTime) / 1000)}s`)
  console.log('')
  console.log('===== 探针完成。请把上面的 SUCCEEDED 响应贴回主对话以核对字段名 =====')
}

main().catch((error) => {
  console.error('[FATAL] 未捕获异常:', error)
  process.exit(99)
})
