import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

type JsonParser<T> = (value: unknown) => T

interface JsonFileOptions<T> {
  filePath: string
  label: string
  parse: JsonParser<T>
}

type ReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'unreadable'; error: unknown }
  | { status: 'invalid'; error: unknown }

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

async function readJsonFile<T>(
  filePath: string,
  parse: JsonParser<T>,
): Promise<ReadResult<T>> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return { status: 'missing' }
    return { status: 'unreadable', error }
  }

  try {
    return { status: 'ok', value: parse(JSON.parse(raw) as unknown) }
  } catch (error) {
    return { status: 'invalid', error }
  }
}

function createCorruptPath(filePath: string): string {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
  return `${filePath}.corrupt-${timestamp}-${process.pid}`
}

async function preserveCorruptFile(
  filePath: string,
  label: string,
  error: unknown,
): Promise<void> {
  const corruptPath = createCorruptPath(filePath)
  console.error(
    `[${label}] JSON 文件损坏，正在保留现场到 ${path.basename(corruptPath)}。原因：`,
    error,
  )

  try {
    await rename(filePath, corruptPath)
  } catch (renameError) {
    console.error(`[${label}] 损坏文件改名失败：`, renameError)
  }
}

/**
 * 加载 JSON 文件；主文件损坏时保留现场，并尝试从完整临时文件或最近备份恢复。
 */
export async function loadJsonFileWithRecovery<T>({
  filePath,
  label,
  parse,
}: JsonFileOptions<T>): Promise<T | undefined> {
  const primary = await readJsonFile(filePath, parse)
  if (primary.status === 'ok') return primary.value

  if (primary.status === 'invalid') {
    await preserveCorruptFile(filePath, label, primary.error)
  } else if (primary.status === 'unreadable') {
    console.error(`[${label}] JSON 主文件读取失败，正在尝试恢复文件：`, primary.error)
  }

  const recoveryPaths = [`${filePath}.tmp-write`, `${filePath}.bak`]
  for (const recoveryPath of recoveryPaths) {
    const recovered = await readJsonFile(recoveryPath, parse)
    if (recovered.status !== 'ok') continue

    console.error(
      `[${label}] 已从 ${path.basename(recoveryPath)} 恢复 JSON 数据。`,
    )
    try {
      await writeJsonFileAtomic(filePath, recovered.value, label)
    } catch (error) {
      console.error(`[${label}] 恢复数据已加载到内存，但回写主文件失败：`, error)
    }
    return recovered.value
  }

  if (primary.status === 'invalid' || primary.status === 'unreadable') {
    console.error(`[${label}] 没有可用恢复文件，将保留当前内存状态。`)
  }
  return undefined
}

/**
 * 原子写入 JSON：先完整写入临时文件，再通过同一目录内的 rename 替换主文件。
 * 主文件成功落盘后，同时保存一份最近可解析快照，供冷启动损坏恢复使用。
 */
export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
  label: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })

  const payload = JSON.stringify(value, null, 2)
  const tmpPath = `${filePath}.tmp-write`
  await writeFile(tmpPath, payload, 'utf8')
  await rename(tmpPath, filePath)

  const backupPath = `${filePath}.bak`
  const backupTmpPath = `${backupPath}.tmp-write`
  try {
    await writeFile(backupTmpPath, payload, 'utf8')
    await rename(backupTmpPath, backupPath)
  } catch (error) {
    // 主文件已经成功落盘，备份失败不应让业务操作表现为失败。
    console.error(`[${label}] JSON 主文件已保存，但最近备份写入失败：`, error)
  }
}
