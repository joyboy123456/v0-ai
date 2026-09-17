import { readdirSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const AGENT_TEST_ROOTS = [
  'lib/agent', 'lib/server/agent', 'lib/agent-beta', 'lib/server/agent-beta',
  'components/agent-beta', 'app/api/beta/agent', 'app/api/events',
]

/** 只遍历明确的测试根，不跟随符号链接，也不搜索工作树或依赖目录。 */
export function discoverAgentTests(root) {
  const files = []
  function visit(directory) {
    if (!lstatSync(directory).isDirectory()) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile() && /\.test\.[cm]?[jt]sx?$/.test(entry.name)) files.push(target)
    }
  }
  for (const relative of AGENT_TEST_ROOTS) {
    const directory = path.join(root, relative)
    try { visit(directory) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (!files.length) throw new Error('Agent 测试发现结果为 0，拒绝以空测试集通过验收')
  return files.sort()
}

/** 使用当前 Node 与已安装的 tsx；透传测试进程退出状态。 */
export function runAgentTests(root, spawn = spawnSync) {
  const files = discoverAgentTests(root)
  return spawn(process.execPath, ['--import', 'tsx', '--test', ...files], { cwd: root, stdio: 'inherit' })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runAgentTests(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
    if (result.error) throw result.error
    if (result.signal) process.kill(process.pid, result.signal)
    else process.exitCode = result.status ?? 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
