/**
 * scripts/seed-pose-templates.ts
 *
 * 从友商资料 (research/yibaiaigc/AI服装大片_全部提示词.json) 中按关键词分桶筛选
 * 30-50 张真姿势图，下载到 public/poses/，并输出 TypeScript 常量到
 * lib/pose-templates-seed.ts。
 *
 * 运行：npx tsx scripts/seed-pose-templates.ts
 *
 * 幂等：
 * - 已存在的图片文件不会重复下载
 * - 重新运行会覆盖 lib/pose-templates-seed.ts（基于桶配置稳定生成）
 *
 * 设计决策：
 * - id 命名按"我们的"语义：pose-front-stand-1 / pose-kid-run-1 等
 * - prompt 用正则抽取 prompt 中描述「姿态」「人物动作」的句子，限制 120 字
 * - 强制追加「保持原服装与人物身份不变」后缀
 * - 图片名 = templateId.jpg
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { spawn } from 'node:child_process'
import os from 'node:os'

// ---- 类型 ----

type AgeGroup = 'adult' | 'kid'
type BodyPart = 'full' | 'upper' | 'lower'

interface SourceRecord {
  id: number
  sort: number
  prompt: string
  model: string
  ratio: string
  imageUrl: string
  objectName: string
}

interface BucketDef {
  /** 内部 key，用于生成 id 前缀 */
  key: string
  /** Modal 展示名前缀，"正面站姿" → "正面站姿1" / "正面站姿2" */
  namePrefix: string
  ageGroup: AgeGroup
  bodyPart: BodyPart
  /** 必须命中至少一条的关键词正则（OR 关系） */
  includes: RegExp[]
  /** 必须**不**命中任一关键词（用于排除重叠） */
  excludes?: RegExp[]
  /** 目标数量 */
  target: number
}

interface SeedTemplate {
  id: string
  name: string
  imageUrl: string
  prompt: string
  ageGroup: AgeGroup
  bodyPart: BodyPart
}

// ---- 配置 ----

const REPO_ROOT = path.resolve(__dirname, '..')
const SOURCE_JSON = path.join(
  REPO_ROOT,
  '.trellis/tasks/05-18-pose-fission/research/yibaiaigc/AI服装大片_全部提示词.json',
)
const POSES_DIR = path.join(REPO_ROOT, 'public/poses')
const SEED_OUT = path.join(REPO_ROOT, 'lib/pose-templates-seed.ts')

const KID_KW = /儿童|童装|小孩|小朋友|小男孩|小女孩|男童|女童/
const ADULT_NEGATIVE_KID = /儿童|童装|小孩|小朋友|男童|女童/

// 桶定义（成人 18-24 + 上半身 8-12 + 下半身 6-9 + 儿童 4-6 ≈ 36-51，目标 36-48）
const BUCKETS: BucketDef[] = [
  // 成人 - 全身
  {
    key: 'front-stand',
    namePrefix: '正面站姿',
    ageGroup: 'adult',
    bodyPart: 'full',
    includes: [/正面.*站/, /面向镜头.*站/, /双脚自然/, /双手.*自然下垂/],
    excludes: [ADULT_NEGATIVE_KID, /侧身/, /蹲/, /坐/, /走/, /行走/],
    target: 4,
  },
  {
    key: 'side-stand',
    namePrefix: '侧身站姿',
    ageGroup: 'adult',
    bodyPart: 'full',
    includes: [/侧身.*站/, /侧面.*站/, /侧立/, /身体微侧/, /侧身倚靠/],
    excludes: [ADULT_NEGATIVE_KID, /蹲/, /坐/, /走/, /行走/],
    target: 4,
  },
  {
    key: 'walking',
    namePrefix: '行走姿',
    ageGroup: 'adult',
    bodyPart: 'full',
    includes: [/行走/, /走姿/, /走来/, /迈步/, /步伐/, /行进/],
    excludes: [ADULT_NEGATIVE_KID, /蹲/, /坐/],
    target: 4,
  },
  {
    key: 'sitting',
    namePrefix: '坐姿',
    ageGroup: 'adult',
    bodyPart: 'full',
    includes: [/坐在/, /坐姿/, /盘坐/, /半坐/, /斜坐/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 4,
  },
  {
    key: 'crouching',
    namePrefix: '蹲姿',
    ageGroup: 'adult',
    bodyPart: 'full',
    includes: [/蹲下/, /半蹲/, /蹲在/, /蹲姿/, /蹲坐/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },
  {
    key: 'back-turn',
    namePrefix: '回头侧脸',
    ageGroup: 'adult',
    bodyPart: 'full',
    includes: [/回头/, /回眸/, /转头/, /侧脸/, /回望/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },

  // 成人 - 上半身
  {
    key: 'hands-pocket',
    namePrefix: '手插口袋',
    ageGroup: 'adult',
    bodyPart: 'upper',
    includes: [/手插.*口袋/, /插.*口袋/, /插兜/, /双手.*口袋/, /插.*裤袋/, /插于裤袋/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },
  {
    key: 'arms-crossed',
    namePrefix: '抱胸',
    ageGroup: 'adult',
    bodyPart: 'upper',
    includes: [/抱胸/, /交叉.*手臂/, /双臂.*交叉/, /环抱/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },
  {
    key: 'touch-face',
    namePrefix: '抚面',
    ageGroup: 'adult',
    bodyPart: 'upper',
    includes: [/触.*下巴/, /手.*抚/, /捋.*头发/, /托.*脸/, /轻触下巴/, /拨.*头发/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },

  // 成人 - 下半身
  {
    key: 'leg-up',
    namePrefix: '抬腿',
    ageGroup: 'adult',
    bodyPart: 'lower',
    includes: [/抬腿/, /抬起.*腿/, /踩.*在/, /踏.*在/, /左腿抬起/, /右腿抬起/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },
  {
    key: 'cross-step',
    namePrefix: '交叉腿',
    ageGroup: 'adult',
    bodyPart: 'lower',
    includes: [/交叉腿/, /双腿.*交叠/, /腿.*交叉/, /右腿交叠/, /左腿交叠/, /腿.*交叠/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },
  {
    key: 'lean',
    namePrefix: '倚靠',
    ageGroup: 'adult',
    bodyPart: 'lower',
    includes: [/倚靠/, /斜靠/, /靠.*在/, /靠.*墙/, /倚.*墙/],
    excludes: [ADULT_NEGATIVE_KID],
    target: 3,
  },

  // 儿童
  {
    key: 'kid-stand',
    namePrefix: '儿童站姿',
    ageGroup: 'kid',
    bodyPart: 'full',
    includes: [KID_KW],
    excludes: [/跑/, /跳/, /蹲/],
    target: 3,
  },
  {
    key: 'kid-action',
    namePrefix: '儿童动态',
    ageGroup: 'kid',
    bodyPart: 'full',
    includes: [/(儿童|童|小孩|小朋友).*(跑|跳|玩|奔|跑跳)/],
    target: 2,
  },
]

// 主图候选（POSE_FISSION_CASES[0] 复用）的 6 个 templateId 槽位
// 实际用哪 6 个，由本脚本生成结束后从生成出的 id 中按优先级选
const CASE_TEMPLATE_PRIORITY: string[] = [
  'pose-front-stand-1',
  'pose-side-stand-1',
  'pose-walking-1',
  'pose-back-turn-1',
  'pose-sitting-1',
  'pose-crouching-1',
  'pose-hands-pocket-1',
  'pose-touch-face-1',
  'pose-leg-up-1',
]

const DEFAULT_TRIO_PRIORITY: string[] = [
  'pose-front-stand-1',
  'pose-side-stand-1',
  'pose-walking-1',
]

// ---- 工具函数 ----

function extractPosePrompt(rawPrompt: string): string {
  // 候选片段优先级队列
  const candidates: string[] = []

  // 1) 抓「姿态/姿势 ... 。」整句
  const poseSentenceRe = /(姿[态势])[^。！？]{6,100}[。！？]/g
  for (const m of rawPrompt.matchAll(poseSentenceRe)) {
    candidates.push(m[0])
  }

  // 2) 抓「人物/他/她/模特 + 动作动词 + ...」整句
  const fallbackRe =
    /(人物|他|她|模特|主体|男士|女士|男模特|女模特|男超模|女超模|网红|男网红|女网红)[^。！？]{6,100}(站|坐|蹲|走|行走|侧身|倚靠|靠在|插.*?口袋|抱胸|抬腿|交叉|回头|侧脸|蹲下|抚|靠|轻触|轻抚)[^。！？]{0,80}[。！？]/g
  for (const m of rawPrompt.matchAll(fallbackRe)) {
    candidates.push(m[0])
  }

  // 3) 抓"包含动作动词且 >= 20 字"的句子
  if (candidates.length === 0) {
    const sentences = rawPrompt.split(/[。！？]/)
    for (const s of sentences) {
      const trimmed = s.trim()
      if (trimmed.length < 20) continue
      if (
        /(站|坐|蹲|走|行走|侧身|倚靠|靠在|插.*?口袋|抱胸|抬腿|交叉|回头|侧脸|蹲下|抚|靠|轻触|轻抚|身体|姿态|姿势)/.test(
          trimmed,
        )
      ) {
        candidates.push(trimmed + '。')
      }
    }
  }

  // 4) 兜底：取 prompt 前 100 字
  let extracted = ''
  // 优先挑长度 30-120 之间的候选（信息密度好）
  const optimal = candidates.find((c) => c.length >= 30 && c.length <= 120)
  if (optimal) extracted = optimal
  else if (candidates.length > 0) {
    // 取最长的那个
    extracted = candidates.reduce((a, b) => (a.length >= b.length ? a : b))
  } else {
    extracted = rawPrompt.slice(0, 100)
  }

  // 5) 截断 120 字
  if (extracted.length > 120) {
    extracted = extracted.slice(0, 120)
  }

  // 6) 清理首尾标点 + 内部换行
  extracted = extracted
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，。、；,]+/, '')
    .replace(/[，。、；,]+$/, '')

  // 7) 强制追加约束后缀
  return `${extracted}。保持原服装与人物身份不变。`
}

function matchBucket(rec: SourceRecord, bucket: BucketDef): boolean {
  const text = rec.prompt
  const included = bucket.includes.some((re) => re.test(text))
  if (!included) return false
  if (bucket.excludes) {
    for (const re of bucket.excludes) {
      if (re.test(text)) return false
    }
  }
  return true
}

function downloadImage(
  url: string,
  destPath: string,
  attempt = 1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 跟随重定向
        res.resume()
        downloadImage(res.headers.location, destPath, attempt).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        if (attempt < 3) {
          setTimeout(
            () => downloadImage(url, destPath, attempt + 1).then(resolve, reject),
            500 * attempt,
          )
          return
        }
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', async () => {
        try {
          const buf = Buffer.concat(chunks)
          await fs.writeFile(destPath, buf)
          resolve()
        } catch (err) {
          reject(err)
        }
      })
      res.on('error', (err) => reject(err))
    })
    req.setTimeout(30_000, () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', (err) => {
      if (attempt < 3) {
        setTimeout(
          () => downloadImage(url, destPath, attempt + 1).then(resolve, reject),
          500 * attempt,
        )
        return
      }
      reject(err)
    })
  })
}

/**
 * 用 macOS 内置 sips 压缩：短边 ≤ 640px + 70 质量 JPEG。
 * 目标：单图 < 200KB，45 张总共 < 10MB（git 可接受）。
 */
function compressImage(srcPath: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sips', [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', '70',
      '-Z', '640',
      srcPath,
      '--out', destPath,
    ])
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`sips exit ${code}: ${stderr.slice(0, 200)}`))
    })
  })
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function escapeForTsLiteral(s: string): string {
  // 单引号字符串里需要转义 \、'、换行、回车、Tab
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---- 主流程 ----

async function main() {
  console.log(`[seed] 读取源数据: ${SOURCE_JSON}`)
  const raw = await fs.readFile(SOURCE_JSON, 'utf8')
  const records: SourceRecord[] = JSON.parse(raw)
  console.log(`[seed] 共 ${records.length} 条候选 prompt`)

  await fs.mkdir(POSES_DIR, { recursive: true })

  const usedIds = new Set<number>()
  const allTemplates: SeedTemplate[] = []
  const downloadJobs: Array<{ url: string; destPath: string; templateId: string }> = []

  for (const bucket of BUCKETS) {
    const matched = records.filter(
      (rec) => !usedIds.has(rec.id) && matchBucket(rec, bucket),
    )
    // 按 sort 倒序（sort 数字越大越靠前）
    matched.sort((a, b) => b.sort - a.sort)
    const picked = matched.slice(0, bucket.target)
    console.log(
      `[seed] 桶 ${bucket.key}: 匹配 ${matched.length}, 取 ${picked.length} (目标 ${bucket.target})`,
    )

    let seq = 1
    for (const rec of picked) {
      usedIds.add(rec.id)
      const templateId = `pose-${bucket.key}-${seq}`
      const name = `${bucket.namePrefix}${seq}`
      const fileName = `${templateId}.jpg`
      const destPath = path.join(POSES_DIR, fileName)
      const imageUrl = `/poses/${fileName}`
      const prompt = extractPosePrompt(rec.prompt)

      allTemplates.push({
        id: templateId,
        name,
        imageUrl,
        prompt,
        ageGroup: bucket.ageGroup,
        bodyPart: bucket.bodyPart,
      })
      downloadJobs.push({ url: rec.imageUrl, destPath, templateId })
      seq++
    }
  }

  console.log(
    `[seed] 待生成模板 ${allTemplates.length} 个，开始下载 + 压缩图片到 ${POSES_DIR}/...`,
  )

  // 用系统临时目录暂存原图，压缩后写入 public/poses/，最后删除原图
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pose-seed-'))
  console.log(`[seed] 临时目录: ${tmpDir}`)

  // 并发下载 + 压缩，最多 4 个并发（sips 是 CPU 密集型，太多会拖慢）
  const succeeded = new Set<string>()
  const failed: Array<{ templateId: string; reason: string }> = []
  const CONCURRENCY = 4
  let cursor = 0

  async function worker() {
    while (cursor < downloadJobs.length) {
      const idx = cursor++
      const job = downloadJobs[idx]
      // 幂等：destPath 已存在则跳过整套流程
      if (await fileExists(job.destPath)) {
        succeeded.add(job.templateId)
        process.stdout.write(`. (cache: ${job.templateId})\n`)
        continue
      }
      const tmpPath = path.join(tmpDir, `${job.templateId}.bin`)
      try {
        await downloadImage(job.url, tmpPath)
        await compressImage(tmpPath, job.destPath)
        await fs.unlink(tmpPath).catch(() => undefined)
        succeeded.add(job.templateId)
        process.stdout.write(`+ (ok: ${job.templateId})\n`)
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => undefined)
        failed.push({
          templateId: job.templateId,
          reason: (err as Error).message,
        })
        process.stdout.write(`x (fail: ${job.templateId} ${(err as Error).message})\n`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  // 清理临时目录
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)

  // 过滤掉下载失败的
  const finalTemplates = allTemplates.filter((t) => succeeded.has(t.id))
  console.log(
    `[seed] 下载完成：成功 ${succeeded.size}，失败 ${failed.length}（已跳过）`,
  )
  if (failed.length) {
    for (const f of failed) {
      console.log(`  - 失败 ${f.templateId}: ${f.reason}`)
    }
  }

  if (finalTemplates.length < 30) {
    console.warn(
      `[seed] 警告：最终模板数 ${finalTemplates.length} < 30，可能桶关键词命中率不足`,
    )
  }
  if (finalTemplates.length > 50) {
    console.warn(
      `[seed] 警告：最终模板数 ${finalTemplates.length} > 50，超出 PRD 上限`,
    )
  }

  // 生成 default trio：从优先级里选最先出现的 3 个
  const finalIds = new Set(finalTemplates.map((t) => t.id))
  const trio = DEFAULT_TRIO_PRIORITY.filter((id) => finalIds.has(id))
  while (trio.length < 3) {
    // 补足：从 adult+full 桶里随便挑
    const candidate = finalTemplates.find(
      (t) => t.ageGroup === 'adult' && t.bodyPart === 'full' && !trio.includes(t.id),
    )
    if (!candidate) break
    trio.push(candidate.id)
  }

  // 生成 case 用的 6 个 id
  const caseIds: string[] = []
  for (const cand of CASE_TEMPLATE_PRIORITY) {
    if (caseIds.length >= 6) break
    if (finalIds.has(cand)) caseIds.push(cand)
  }
  // 补足到 6 个：从剩余成人全身里挑
  if (caseIds.length < 6) {
    for (const t of finalTemplates) {
      if (caseIds.length >= 6) break
      if (caseIds.includes(t.id)) continue
      if (t.ageGroup === 'adult' && t.bodyPart === 'full') {
        caseIds.push(t.id)
      }
    }
  }

  // 写 lib/pose-templates-seed.ts
  const lines: string[] = []
  lines.push("import type { PoseTemplate } from './types'")
  lines.push('')
  lines.push('/**')
  lines.push(' * 姿势裂变姿势模板种子数据。')
  lines.push(' *')
  lines.push(' * 由 scripts/seed-pose-templates.ts 从友商资料按关键词分桶筛选生成，')
  lines.push(' * 图片已下载到 public/poses/<id>.jpg。')
  lines.push(' *')
  lines.push(' * 修改请直接重跑脚本，不要手改本文件（除非临时调整 prompt 文案）。')
  lines.push(' */')
  lines.push('export const POSE_TEMPLATES_SEED: PoseTemplate[] = [')
  for (const t of finalTemplates) {
    lines.push('  {')
    lines.push(`    id: '${t.id}',`)
    lines.push(`    name: '${escapeForTsLiteral(t.name)}',`)
    lines.push(`    imageUrl: '${t.imageUrl}',`)
    lines.push(`    prompt: '${escapeForTsLiteral(t.prompt)}',`)
    lines.push(`    ageGroup: '${t.ageGroup}',`)
    lines.push(`    bodyPart: '${t.bodyPart}',`)
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')
  lines.push('/**')
  lines.push(' * 「基础搭配 3 张」一键预设的姿势模板 id 集合（PRD D8）。')
  lines.push(' * 优先选正面站姿/侧身站姿/行走姿。')
  lines.push(' */')
  lines.push('export const POSE_TEMPLATES_DEFAULT_TRIO_SEED: string[] = [')
  for (const id of trio) {
    lines.push(`  '${id}',`)
  }
  lines.push(']')
  lines.push('')
  lines.push('/**')
  lines.push(' * POSE_FISSION_CASES[0] 引用的 6 个 templateId（黑色蕾丝裙 6 姿势套图）。')
  lines.push(' * 仅保证 id 存在于 POSE_TEMPLATES_SEED 中。')
  lines.push(' */')
  lines.push('export const POSE_FISSION_CASE_BLACK_DRESS_TEMPLATE_IDS_SEED: string[] = [')
  for (const id of caseIds) {
    lines.push(`  '${id}',`)
  }
  lines.push(']')
  lines.push('')

  await fs.writeFile(SEED_OUT, lines.join('\n'), 'utf8')
  console.log(`[seed] 写入 ${SEED_OUT}`)
  console.log(`[seed] 默认三件套: ${trio.join(', ')}`)
  console.log(`[seed] 案例库 6 id: ${caseIds.join(', ')}`)
  console.log(`[seed] 完成。总模板数: ${finalTemplates.length}`)
}

main().catch((err) => {
  console.error('[seed] FATAL:', err)
  process.exit(1)
})
