#!/usr/bin/env node
/**
 * 从 OSS + pm2 日志重建生成图 task 记录。
 *
 * 背景：store.json 损坏丢失了 tasks 数组，但 OSS yibai/results/ 上 7/3-7/6 的生成图
 * 仍在（Lifecycle 3 天规则尚未删到近 3 天），pm2 日志里有每个 task 的 featureType/shotCount。
 * 本脚本合并两路数据重建 task + asset，让前端历史记录正确显示生成图。
 *
 * 同时修复前一版 recover-tasks-from-assets.mjs 的错误：那版把上传原图塞进了
 * task.results（生成结果位置），导致上传图和生成图混在一起。本版：
 * - 删除错误的 14 个 recovered_* task
 * - 上传图 asset（412 张）保留但 taskId 置 null（不再关联到任何 task）
 * - 从 OSS 重建 205 个真正的生成图 task（results 指向 OSS 现存的生成图）
 * - 37 张已 404 的旧 asset：taskId 置 null（避免悬空引用）
 *
 * 限制：
 * - 重建 task 丢失原始 params/提示词/inputAssets，仅保留生成图本身
 * - inputAssets（参考图）无法恢复（日志只有 refs 数量，无 assetId）
 * - width/height 无法从 OSS list 获取，设为 0（前端用固定 aspect 显示，不受影响）
 *
 * 使用方式：先 pm2 stop yibai-fission，再 node scripts/rebuild-tasks-from-oss.mjs
 */
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'fs'
import { basename, join } from 'path'
import OSS from 'ali-oss'

const cwd = process.cwd()
const storePath = join(cwd, 'data', 'fashion-mvp-store.json')
const logPath = join(cwd, 'logs', 'yibai-fission-out.log')
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
const backupPath = join(cwd, 'data', `fashion-mvp-store.json.bak-rebuild-${ts}`)

// --- 读取 env ---
const envText = readFileSync(join(cwd, '.env.local'), 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
process.env = { ...process.env, ...env }
const publicUrl = (process.env.OSS_PUBLIC_URL || '').replace(/\/$/, '')

// --- OSS 客户端 ---
const client = new OSS({
  region: process.env.OSS_REGION || 'oss-cn-hangzhou',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  endpoint: process.env.OSS_INTERNAL_ENDPOINT,
  secure: !(process.env.OSS_INTERNAL_ENDPOINT || '').includes('-internal'),
  timeout: 60000,
})

const WORKFLOWS = {
  'ai-fashion-photo': 'ai_fashion_photo_v1',
  'photo-fission': 'photo_fission_v1',
  'pose-fission': 'pose_fission_v1',
}

// --- 1. 备份 ---
if (!existsSync(storePath)) {
  console.error('✗ store.json 不存在')
  process.exit(1)
}
copyFileSync(storePath, backupPath)
console.log('✓ 已备份:', backupPath)

// --- 2. 读当前 store ---
const store = JSON.parse(readFileSync(storePath, 'utf8'))
const oldAssets = Array.isArray(store.assets) ? store.assets : []
const oldTasks = Array.isArray(store.tasks) ? store.tasks : []
console.log(`当前: ${oldAssets.length} assets, ${oldTasks.length} tasks`)

// --- 3. 从日志解析 task 元数据 ---
const taskMeta = {} // taskId -> { featureType, shotCount }
if (existsSync(logPath)) {
  const logText = readFileSync(logPath, 'utf8')
  const re = /pool\.dispatch[^}]*?"taskId":"(task_\d+_\w+)"[^}]*?"stage":"([a-z-]+)"/g
  const re2 = /pool\.dispatch[^}]*?"taskId":"(task_\d+_\w+)"[^}]*?"shotCount":(\d+)/g
  let m
  while ((m = re.exec(logText)) !== null) {
    if (!taskMeta[m[1]]) taskMeta[m[1]] = {}
    taskMeta[m[1]].featureType = m[2]
  }
  while ((m = re2.exec(logText)) !== null) {
    if (!taskMeta[m[1]]) taskMeta[m[1]] = {}
    taskMeta[m[1]].shotCount = parseInt(m[2], 10)
  }
}
console.log(`日志 task 元数据: ${Object.keys(taskMeta).length} 个`)

// --- 4. 从 OSS list 所有 yibai/results/ 对象 ---
console.log('正在列举 OSS yibai/results/ ...')
const allObjects = []
let marker
do {
  const r = await client.list({ prefix: 'yibai/results/', 'max-keys': 1000, marker }, {})
  for (const o of (r.objects || [])) allObjects.push({ key: o.name, size: o.size, lastModified: o.lastModified })
  marker = r.nextMarker
} while (marker)
console.log(`OSS 对象总数: ${allObjects.length}`)

// 拆分图和缩略图，按 taskId 分组
// 单 shot: result_{taskId}_{idx}.png        缩略图: result_{taskId}_{idx}_thumb.webp
// 多 shot: result_{taskId}_shot_{n}_{idx}.png  缩略图: result_{taskId}_shot_{n}_{idx}_thumb.webp
const imgRe = /^yibai\/results\/(\w+)\/result_(task_\d+_[a-z0-9]+)(?:_shot_(\d+))?_(\d+)\.(png|jpg|jpeg|webp)$/
const thumbRe = /^yibai\/results\/(\w+)\/result_(task_\d+_[a-z0-9]+)(?:_shot_(\d+))?_(\d+)_thumb\.webp$/

const taskImages = {} // taskId -> [{ key, size, lastModified, shotNum, idx }]
const taskThumbs = {} // taskId -> { "shotNum_idx": thumbKey }

for (const o of allObjects) {
  // 先试缩略图（更长的后缀）
  let m = o.key.match(thumbRe)
  if (m) {
    const taskId = m[2]
    const shotNum = m[3] || ''
    const idx = m[4]
    const thumbKey = `${shotNum}_${idx}`
    if (!taskThumbs[taskId]) taskThumbs[taskId] = {}
    taskThumbs[taskId][thumbKey] = o.key
    continue
  }
  m = o.key.match(imgRe)
  if (m) {
    const taskId = m[2]
    const shotNum = m[3] ? parseInt(m[3], 10) : null
    const idx = parseInt(m[4], 10)
    if (!taskImages[taskId]) taskImages[taskId] = []
    taskImages[taskId].push({ key: o.key, size: o.size, lastModified: o.lastModified, shotNum, idx })
    continue
  }
  // 不匹配的 key，跳过
}

const ossTaskIds = Object.keys(taskImages)
console.log(`OSS 生成图 task 数: ${ossTaskIds.length}，总图数: ${Object.values(taskImages).reduce((s,a)=>s+a.length,0)}`)

// --- 5. 重建 task + asset ---
function taskIdToCreatedAt(taskId) {
  const m = taskId.match(/^task_(\d+)_/)
  if (m) {
    const ms = parseInt(m[1], 10)
    const d = new Date(ms)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

const newTasks = []
const newAssets = []
let metaHit = 0, metaMiss = 0

for (const taskId of ossTaskIds) {
  const imgs = taskImages[taskId].sort((a, b) => {
    if (a.shotNum !== b.shotNum) return (a.shotNum || 0) - (b.shotNum || 0)
    return a.idx - b.idx
  })
  const meta = taskMeta[taskId]
  const featureType = meta?.featureType || 'ai-fashion-photo'
  const workflowId = WORKFLOWS[featureType] || WORKFLOWS['ai-fashion-photo']
  if (meta) metaHit++; else metaMiss++

  const createdAt = taskIdToCreatedAt(taskId) || imgs[0].lastModified
  const finishedAt = imgs.reduce((latest, o) => (o.lastModified > latest ? o.lastModified : latest), imgs[0].lastModified)

  const results = imgs.map((img) => {
    const shotNum = img.shotNum
    const thumbKey = `${shotNum || ''}_${img.idx}`
    const thumb = taskThumbs[taskId]?.[thumbKey]
    const assetId = `oss_${taskId}_${shotNum || 's'}_${img.idx}`
    const url = `${publicUrl}/${img.key}`
    const result = {
      assetId,
      url,
      downloadUrl: url,
      width: 0,
      height: 0,
      kind: 'generated',
      thumbnailUrl: thumb ? `${publicUrl}/${thumb}` : undefined,
    }
    if (shotNum) result.shotId = `shot_${shotNum}`
    // asset 记录
    newAssets.push({
      assetId,
      userId: 'usr_local_user01',
      fileName: basename(img.key),
      fileUrl: url,
      fileType: img.key.endsWith('.png') ? 'image/png' : 'image/jpeg',
      width: 0,
      height: 0,
      createdAt,
      taskId,
    })
    return result
  })

  newTasks.push({
    taskId,
    userId: 'usr_local_user01',
    featureType,
    workflowId,
    inputAssetIds: [],
    inputAssets: [],
    params: featureType === 'photo-fission'
      ? { childrensCategory: 'pants', imageRatio: '3:4', resolution: '4k', generateCount: meta?.shotCount || imgs.length }
      : {
          prompt: '(OSS 重建，原始提示词已丢失)',
          userPrompt: '(OSS 重建)',
          finalPrompt: '(OSS 重建，原始提示词已丢失)',
          promptMode: 'raw',
          model: 'gemini-3-pro-image-preview',
          referenceImageCount: 1,
          imageRatio: '3:4',
          resolution: '4k',
          resultCount: 1,
          creditsCost: 35,
        },
    status: 'success',
    progress: 100,
    message: meta ? `生成图恢复（${imgs.length} 张，${featureType}）` : `生成图恢复（${imgs.length} 张，featureType 推断）`,
    resultAssetIds: results.map((r) => r.assetId),
    results,
    createdAt,
    finishedAt,
    creditsUsed: 0,
  })
}

console.log(`重建 task: ${newTasks.length}（元数据命中 ${metaHit}，推断 ${metaMiss}）`)
console.log(`重建 asset: ${newAssets.length}`)

// --- 6. 合并：清理旧数据 + 加入新数据 ---
// 6a. 删除错误的 recovered_* task
const cleanedOldTasks = oldTasks.filter((t) => !t.taskId.startsWith('recovered_'))
console.log(`删除错误 recovered task: ${oldTasks.length - cleanedOldTasks.length}`)

// 6b. 上传图 asset：去掉之前错误的 taskId 关联
let cleanedUploadAssets = 0
const cleanedOldAssets = oldAssets.map((a) => {
  // 之前 recovered 脚本给 412 张上传图关联了 recovered_* taskId，现在清掉
  if (a.taskId && a.taskId.startsWith('recovered_')) {
    cleanedUploadAssets++
    return { ...a, taskId: null }
  }
  // 37 张已 404 的 yibai/results/ asset：清掉 taskId 避免悬空
  if (a.taskId && a.fileUrl && a.fileUrl.includes('yibai/results/') && !ossTaskIds.includes(a.taskId)) {
    return { ...a, taskId: null }
  }
  return a
})
console.log(`清理上传图 taskId 关联: ${cleanedUploadAssets}`)

// 6c. 合并（新 asset 用新 assetId，不会和旧的冲突）
const finalAssets = [...cleanedOldAssets, ...newAssets]
const finalTasks = [...cleanedOldTasks, ...newTasks]
console.log(`最终: ${finalAssets.length} assets, ${finalTasks.length} tasks`)

// --- 7. 原子写入 ---
const tmpPath = storePath + '.tmp-write'
const payload = JSON.stringify({ assets: finalAssets, tasks: finalTasks }, null, 2)
writeFileSync(tmpPath, payload, 'utf8')
renameSync(tmpPath, storePath)
console.log('✓ 已原子写入 store.json')

// --- 8. 验证 ---
const verify = JSON.parse(readFileSync(storePath, 'utf8'))
console.log(`\n=== 验证 ===`)
console.log(`assets: ${verify.assets.length}, tasks: ${verify.tasks.length}`)
const statusDist = verify.tasks.reduce((m, t) => (m[t.status] = (m[t.status] || 0) + 1, m), {})
console.log(`task 状态:`, statusDist)
const ftDist = verify.tasks.reduce((m, t) => (m[t.featureType] = (m[t.featureType] || 0) + 1, m), {})
console.log(`task featureType:`, ftDist)
const totalResults = verify.tasks.reduce((s, t) => s + t.results.length, 0)
console.log(`task results 总图数: ${totalResults}`)
console.log(`\n完成。请重启 pm2：pm2 restart yibai-fission`)
