import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { spawnSync } from 'node:child_process'
import test from 'node:test'
import { checkAgentArchitecture, readAgentSources } from '../../../scripts/check-agent-architecture.mjs'
import { AGENT_TEST_ROOTS, discoverAgentTests, runAgentTests } from '../../../scripts/test-agent.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const runtime = 'lib/server/agent/runtime.ts'
const legacyRuntime = 'lib/server/agent-beta/runtime.ts'
const turn = 'lib/server/agent/turn.ts'

function check(file: string, source: string) {
  return checkAgentArchitecture(new Map([[file, source]]))
}

function rejects(file: string, source: string, rule: string) {
  const result = check(file, source)
  assert.ok(result.some((item) => item.rule === rule), JSON.stringify(result))
  assert.ok(result.every((item) => item.line >= 1 && item.column >= 1))
}

test('当前源码满足架构边界，测试 normalizer 导入不进入产品规则', () => {
  assert.deepEqual(checkAgentArchitecture(readAgentSources(root)), [])
  assert.deepEqual(check('lib/agent/fixture.test.ts', "import { createTask } from '@/lib/server/task-store'"), [])
})

test('静态导入、export-from、动态 import、require 均受架构规则约束', () => {
  for (const source of [
    "import { createTask } from '@/lib/server/task-store'",
    "export { createTask } from '@/lib/server/task-store'",
    "export * from '@/lib/server/task-store'",
    "const tasks = await import('@/lib/server/task-store')",
    "const tasks = require('@/lib/server/task-store')",
    "import tasks = require('@/lib/server/task-store')",
    "type Store = typeof import('@/lib/server/task-store')",
  ]) rejects(turn, source, 'external-capability-import')
})

test('别名、相对路径、扩展名和路径归一化不能绕过架构边界', () => {
  for (const target of ['@/lib/server/task-store.ts', '../task-store', '.././task-store.ts',
    './action/../../task-store', '@/lib/server/governance/../task-store']) {
    rejects(turn, `import * as tasks from '${target}'`, 'external-capability-import')
  }
  rejects('lib/server/agent/action/tools.ts', "const tasks = require('../../task-store')", 'external-capability-import')
  rejects(turn, "import { generate } from '../grsai-image-adapter'", 'external-capability-import')
})

test('架构范围拒绝无法静态核验的动态模块路径', () => {
  rejects(runtime, 'const tasks = await import(moduleName)', 'unresolved-import')
  rejects(turn, 'const tasks = require(moduleName)', 'unresolved-import')
})

test('同构产品模块禁止服务端依赖、Node I/O 和浏览器 I/O', () => {
  for (const source of ["import fs from 'node:fs/promises'", "import fs from 'fs'",
    "import { helper } from '../server/agent/ports'", "import type { TaskQueryPort } from '../server/agent/ports'",
    "const result = fetch('/api/tasks')", "globalThis.fetch('/api/tasks')", 'localStorage.setItem("a", "b")']) {
    rejects('lib/agent/contracts.ts', source, 'pure-io')
  }
  assert.deepEqual(check('lib/agent/contracts.ts', "export const sha = (data: Uint8Array) => crypto.subtle.digest('SHA-256', data)"), [])
})

test('observation、reasoning、action 和 turn 不持有命令端口或其别名', () => {
  for (const file of [turn, 'lib/server/agent/perception/observation.ts',
    'lib/server/agent/reasoning/planner.ts', 'lib/server/agent/action/tool-dispatch.ts']) {
    rejects(file, "import type { TaskCommandPort as Commands } from '@/lib/server/agent/ports'; function run(command: Commands) {}", 'write-port-outside-governance')
    rejects(file, "import type { VendorActionPort } from '@/lib/server/agent/ports'; function run(command: VendorActionPort) {}", 'write-port-outside-governance')
  }
  assert.deepEqual(check(turn, "import type { TaskQueryPort, GovernedActionPort } from './ports'; function run(query: TaskQueryPort, gateway: GovernedActionPort) {}"), [])
  rejects(turn, 'function run(command: { createTask(input: unknown): Promise<unknown> }) {}', 'write-port-outside-governance')
})

test('字面量索引不能绕过同构模块的全局 I/O 限制', () => {
  for (const source of ["globalThis['fetch']('/api/tasks')", "window['localStorage'].getItem('x')",
    "(self)['WebSocket']", "global['process'].exit()"] ) {
    rejects('lib/agent/io.ts', source, 'pure-io')
  }
  assert.deepEqual(check('lib/agent/io.ts', "const data = { fetch: 'name' }; export const label = data['fetch']"), [])
})

test('observability 不能反向导入业务实现或旧 service', () => {
  for (const target of ['../turn', '../reasoning/planner', '../governance/action-ledger', '../../agent-beta/service']) {
    rejects('lib/server/agent/observability/events.ts', `import * as implementation from '${target}'`, 'observability-backedge')
  }
  assert.deepEqual(check('lib/server/agent/observability/events.ts', "import type { JsonValue } from '@/lib/agent/types'; import { store } from './event-store'"), [])
})

test('runtime 将写能力交给治理模块，通过变量别名指向的 turn 仍被拒绝', () => {
  const imports = "import * as tasks from '@/lib/server/task-store'; import { runTurn } from './turn';"
  for (const wiring of [
    'runTurn({ createTask: tasks.createTask })',
    'const create = tasks.createTask; runTurn({ create })',
    'const { createTask: create } = tasks; const commands = { create }; runTurn(commands)',
    'const port = { make: tasks.createTask }; const alias = port; runTurn(alias)',
    'const start = runTurn; const create = tasks["createTask"]; start({ create })',
    'let make; make = tasks.createTask; runTurn({ make })',
    'const commands = { createTask: (...args) => tasks.createTask(...args) }; runTurn(commands)',
    'const commands = tasks; runTurn(commands)',
  ]) rejects(runtime, `${imports} ${wiring}`, 'capability-injection')
  assert.deepEqual(check(runtime, "import * as tasks from '@/lib/server/task-store'; import { createGateway } from './governance/gateway'; createGateway({ createTask: tasks.createTask, cancelTask: tasks.cancelTask })"), [])
})

test('TaskAdapter 产出的端口不能注入 turn，runtime 本身不能执行命令', () => {
  rejects(runtime, "import { createAdapter } from './governance/task-adapter'; import { runTurn } from './turn'; const commands = createAdapter(); runTurn(commands)", 'capability-injection')
  rejects(runtime, "import * as tasks from '@/lib/server/task-store'; const create = tasks.createTask; create({})", 'direct-write-call')
  rejects(runtime, "import { createAdapter } from './governance/task-adapter'; const port = createAdapter(); port.createPreparedTask({})", 'direct-write-call')
})

test('对象后赋值不能掩盖向业务模块传递或调用写能力', () => {
  const imports = "import * as tasks from '@/lib/server/task-store'; import { runTurn } from './turn';"
  for (const wiring of [
    'const commands = {}; commands.make = tasks.createTask; runTurn(commands)',
    'const commands = {}; commands["make"] = tasks.createTask; commands.make({})',
    'const commands = { nested: {} }; const alias = commands.nested; alias.make = tasks.createTask; runTurn(commands)',
    'const commands = {}; const make = tasks.createTask; commands[key] = make; runTurn(commands)',
  ]) rejects(runtime, `${imports} ${wiring}`, 'write-capability-assignment')
  assert.deepEqual(check(runtime, `${imports} const query = {}; query.getTask = tasks.getTask; runTurn(query)`), [])
})

test('符号绑定区分局部同名变量，只读查询可以注入主循环', () => {
  const source = "import * as tasks from '@/lib/server/task-store'; import { runTurn } from './turn'; const operation = tasks.createTask; function wire(operation: () => void) { runTurn(operation) }; runTurn({ getTask: tasks.getTask, getAsset: tasks.getAsset })"
  assert.deepEqual(check(runtime, source), [])
})

test('旧 runtime 只保留已有精确例外，不能复制到新 turn 或注入其他 service', () => {
  const baseline = readFileSync(path.join(root, legacyRuntime), 'utf8')
  assert.deepEqual(check(legacyRuntime, baseline), [])
  rejects(turn, baseline, 'external-capability-import')
  rejects(legacyRuntime, `${baseline}\nimport { createImage } from '../grsai-image-adapter'`, 'external-capability-import')
  rejects(legacyRuntime, `${baseline}\nimport { runTurn } from '../agent/turn'; import { createTask } from '../task-store'; const create = createTask; runTurn({ create })`, 'capability-injection')
  rejects(legacyRuntime, "import * as tasks from '../task-store'; import { AgentBetaService as AnotherService } from './other-service'; new AnotherService({}, { createTask: tasks.createTask })", 'capability-injection')
  rejects(legacyRuntime, "import * as tasks from '../task-store'; import { AgentBetaService } from './service'; new AgentBetaService({}, { tasks })", 'capability-injection')
  rejects(legacyRuntime, "import * as tasks from '../task-store'; import { AgentBetaService } from './service'; new AgentBetaService({}, { retryShots: tasks.retryShots })", 'capability-injection')
  rejects(legacyRuntime, "import * as tasks from '../task-store'; import { AgentBetaService } from './service'; new AgentBetaService({}, { getTask: tasks.createTask })", 'capability-injection')
})

test('测试入口递归覆盖全部明确根，不跟符号链接，不搜 .delta/node_modules', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-test-discovery-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const expected = AGENT_TEST_ROOTS.map((relative, index) => {
    const folder = path.join(directory, relative, 'nested')
    mkdirSync(folder, { recursive: true })
    const file = path.join(folder, `case-${index}.test.ts`)
    writeFileSync(file, '')
    return file
  })
  for (const relative of ['.delta/worktrees/test', 'node_modules/a', 'lib/agent/.hidden', 'lib/agent/node_modules/a']) {
    const folder = path.join(directory, relative)
    mkdirSync(folder, { recursive: true })
    writeFileSync(path.join(folder, 'excluded.test.ts'), '')
  }
  symlinkSync(path.join(directory, '.delta'), path.join(directory, 'lib/agent/linked-directory'))
  symlinkSync(expected[0], path.join(directory, 'lib/agent/linked.test.ts'))
  assert.deepEqual(discoverAgentTests(directory), expected.sort())
})

test('空测试集失败，测试根本身为符号链接也不跟随', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-empty-tests-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  assert.throws(() => discoverAgentTests(directory), /0/)
  mkdirSync(path.join(directory, 'outside'), { recursive: true })
  mkdirSync(path.join(directory, 'lib'), { recursive: true })
  writeFileSync(path.join(directory, 'outside/fake.test.ts'), '')
  symlinkSync(path.join(directory, 'outside'), path.join(directory, 'lib/agent'))
  assert.throws(() => discoverAgentTests(directory), /0/)
})

test('测试入口使用 node --import tsx --test 并原样返回失败退出码', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-runner-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(path.join(directory, 'lib/agent'), { recursive: true })
  const file = path.join(directory, 'lib/agent/failure.test.ts')
  writeFileSync(file, '')
  const spawn = ((command: string, args: string[], options: { cwd: string; stdio: string }) => {
    assert.equal(command, process.execPath)
    assert.deepEqual(args, ['--import', 'tsx', '--test', file])
    assert.deepEqual(options, { cwd: directory, stdio: 'inherit' })
    return { pid: 1, output: [], stdout: null, stderr: null, status: 17, signal: null }
  }) as unknown as typeof spawnSync
  assert.equal(runAgentTests(directory, spawn).status, 17)
})
