#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command, InvalidArgumentError } from 'commander'
import type {
  FashionImageRatio,
  FashionModelId,
  FashionPromptMode,
  FashionResolution,
  PhotoFissionCategory,
  PhotoFissionImageRatio,
  PhotoFissionResolution,
  PoseImageRatio,
  PoseResolution,
} from '../lib/types'

type Feature = 'ai-fashion-photo' | 'photo-fission' | 'pose-fission'

interface RunOptions {
  image?: string[]
  frontDetail?: string
  backDetail?: string
  prompt?: string
  promptMode?: string
  category?: string
  poses?: string
  ratio?: string
  resolution?: string
  model?: string
  out?: string
  userId?: string
  timeoutMs?: number
  pollMs?: number
  json?: boolean
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

loadProjectEnv(projectRoot)

const program = new Command()

program
  .name('fashion-ai')
  .description('AI 服装生图平台的 Agent CLI')
  .version('0.1.0')

program
  .command('run')
  .argument('<feature>', 'ai-fashion-photo | photo-fission | pose-fission')
  .option('-i, --image <path>', '输入图片；ai-fashion-photo 可重复传多张', collect, [])
  .option('--front-detail <path>', '正面细节图，仅 photo-fission / pose-fission 使用')
  .option('--back-detail <path>', '背面细节图，仅 photo-fission / pose-fission 使用')
  .option('-p, --prompt <text>', 'AI 服装大片提示词')
  .option('--prompt-mode <mode>', 'AI 服装大片提示词模式：enhanced | raw', 'enhanced')
  .option('--category <category>', '服装大片裂变品类：tops | pants | skirts | suit | outerwear | childrens', 'tops')
  .option('--poses <ids>', '姿势模板 id，逗号分隔；不传则使用基础 3 张')
  .option('--ratio <ratio>', '图片比例', '3:4')
  .option('--resolution <resolution>', '分辨率：1k | 2k | 4k', '2k')
  .option('--model <model>', 'Gemini 图片模型')
  .option('-o, --out <dir>', '结果保存目录')
  .option('--user-id <id>', '任务归属用户 id，默认 usr_local_user01')
  .option('--timeout-ms <ms>', '等待任务超时时间', parsePositiveInteger)
  .option('--poll-ms <ms>', '轮询间隔', parsePositiveInteger, 1000)
  .option('--json', '只输出 JSON，方便 Agent 解析')
  .action(async (featureRaw: string, options: RunOptions) => {
    try {
      const feature = readFeature(featureRaw)
      const output = await runFeature(feature, options)
      if (options.json) {
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
        return
      }

      process.stdout.write(`任务完成：${output.taskId}\n`)
      process.stdout.write(`状态：${output.status}\n`)
      process.stdout.write(`结果目录：${output.outDir}\n`)
      for (const result of output.results) {
        process.stdout.write(`- ${result.filePath}\n`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`)
      } else {
        process.stderr.write(`错误：${message}\n`)
      }
      process.exitCode = 1
    }
  })

program.parseAsync(process.argv)

async function runFeature(feature: Feature, options: RunOptions) {
  const { runAgentGeneration } = await import('../lib/server/agent-runner')
  const imagePaths = options.image ?? []
  const common = {
    imagePaths,
    frontDetailPath: options.frontDetail,
    backDetailPath: options.backDetail,
    model: readFashionModel(options.model),
    outDir: options.out ? path.resolve(options.out) : undefined,
    userId: options.userId,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollMs,
  }

  if (feature === 'ai-fashion-photo') {
    if (!options.prompt?.trim()) {
      throw new Error('ai-fashion-photo 必须传 --prompt')
    }
    return runAgentGeneration({
      ...common,
      featureType: feature,
      prompt: options.prompt,
      promptMode: readPromptMode(options.promptMode),
      imageRatio: readFashionImageRatio(options.ratio),
      resolution: readFashionResolution(options.resolution),
    })
  }

  if (feature === 'photo-fission') {
    return runAgentGeneration({
      ...common,
      featureType: feature,
      category: readPhotoFissionCategory(options.category),
      imageRatio: readPhotoFissionImageRatio(options.ratio),
      resolution: readPhotoFissionResolution(options.resolution),
    })
  }

  return runAgentGeneration({
    ...common,
    featureType: feature,
    poseTemplateIds: splitCsv(options.poses),
    imageRatio: readPoseImageRatio(options.ratio),
    resolution: readPoseResolution(options.resolution),
  })
}

function readFeature(value: string): Feature {
  if (
    value === 'ai-fashion-photo' ||
    value === 'photo-fission' ||
    value === 'pose-fission'
  ) {
    return value
  }
  throw new Error(`不支持的功能：${value}`)
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? items : undefined
}

function collect(value: string, previous: string[]) {
  previous.push(value)
  return previous
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('必须是正整数')
  }
  return parsed
}

function readPromptMode(value: string | undefined): FashionPromptMode {
  if (value === 'enhanced' || value === 'raw') return value
  throw new Error(`AI 服装大片提示词模式无效：${value}`)
}

function readFashionModel(value: string | undefined): FashionModelId | undefined {
  if (!value) return undefined
  if (value === 'gemini-3.1-flash-image-preview' || value === 'gemini-3-pro-image-preview') {
    return value
  }
  throw new Error(`AI 图片模型无效：${value}`)
}

function readFashionImageRatio(value: string | undefined): FashionImageRatio {
  return readEnumValue(
    value,
    ['1:1', '3:2', '2:3', '3:4', '4:3', 'more'],
    'AI 服装大片图片比例无效',
  )
}

function readPhotoFissionCategory(value: string | undefined): PhotoFissionCategory {
  return readEnumValue(
    value,
    ['tops', 'pants', 'skirts', 'suit', 'outerwear', 'childrens'],
    '服装大片裂变品类无效',
  )
}

function readPhotoFissionImageRatio(value: string | undefined): PhotoFissionImageRatio {
  return readEnumValue(
    value,
    ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    '服装大片裂变图片比例无效',
  )
}

function readPoseImageRatio(value: string | undefined): PoseImageRatio {
  return readEnumValue(
    value,
    ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    '姿势裂变图片比例无效',
  )
}

function readFashionResolution(value: string | undefined): FashionResolution {
  return readResolution(value, 'AI 服装大片分辨率无效')
}

function readPhotoFissionResolution(value: string | undefined): PhotoFissionResolution {
  return readResolution(value, '服装大片裂变分辨率无效')
}

function readPoseResolution(value: string | undefined): PoseResolution {
  return readResolution(value, '姿势裂变分辨率无效')
}

function readResolution<T extends FashionResolution | PhotoFissionResolution | PoseResolution>(
  value: string | undefined,
  errorPrefix: string,
): T {
  return readEnumValue(value, ['1k', '2k', '4k'], errorPrefix) as T
}

function readEnumValue<const T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  errorPrefix: string,
): T {
  if (value && allowed.includes(value as T)) return value as T
  throw new Error(`${errorPrefix}：${value}`)
}

function loadProjectEnv(root: string) {
  // 与 Next 本地开发习惯保持一致：本地覆盖优先，已存在的 shell env 不覆盖。
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.join(root, filename)
    if (!existsSync(filePath)) continue
    const content = readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseEnvLine(line)
      if (!parsed) continue
      const [key, value] = parsed
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (!match) return null
  return [match[1], unquoteEnvValue(match[2].trim())]
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  const commentIndex = value.indexOf(' #')
  return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value
}
