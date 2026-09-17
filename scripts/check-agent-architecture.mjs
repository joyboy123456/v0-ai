import { builtinModules } from 'node:module'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const RUNTIME = 'lib/server/agent/runtime.ts'
const LEGACY_RUNTIME = 'lib/server/agent-beta/runtime.ts'
const ADAPTER = 'lib/server/agent/governance/task-adapter'
const LEGACY_IMPORTS = new Set([
  'lib/server/task-store', 'lib/server/image-work-scheduler', 'lib/server/fission-prompt-planner',
])
const COMMAND_TYPES = new Set(['TaskCommandPort', 'VendorActionPort'])
const WRITES = new Set(['createTask', 'createPreparedTask', 'retryPreparedShots', 'cancelTask', 'retryTaskShots',
  'retryShots', 'prepareCutout', 'classify'])
const TASK_READS = new Set(['getTask', 'getAsset', 'getIdempotentTaskId', 'isTaskExecutionActive'])
const IO_GLOBALS = new Set(['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'Worker',
  'localStorage', 'sessionStorage', 'navigator', 'process', 'console'])
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
const EMPTY = { origins: [], writes: [] }
const normalize = (value) => value.replaceAll('\\', '/')
const moduleName = (value) => value.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '')
const isTest = (file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.d.ts')
const isNew = (file) => file.startsWith('lib/server/agent/')
const isPure = (file) => file.startsWith('lib/agent/')
const isRuntime = (file) => file === RUNTIME || file === LEGACY_RUNTIME
const isGovernance = (file) => file.startsWith('lib/server/agent/governance/')
const isRestricted = (file) => isNew(file) && !isRuntime(file) && !isGovernance(file) && !file.endsWith('/ports.ts')

function resolveImport(file, specifier) {
  if (specifier.startsWith('@/')) return moduleName(path.posix.normalize(specifier.slice(2)))
  if (specifier.startsWith('.')) return moduleName(path.posix.join(path.posix.dirname(file), specifier))
  return specifier
}

function isExternalCapability(target) {
  return /^lib\/server\/(?:task-store|image-work-scheduler|fission-prompt-planner|cutout-session-service|garment-detail-classifier)$/.test(target)
    || /^lib\/server\/.*(?:provider|image-adapter|genai-adapter|cutout-adapter)(?:\/|$)/.test(target)
}

function merge(...values) {
  return {
    origins: [...new Set(values.flatMap((value) => value.origins))].sort(),
    writes: [...new Set(values.flatMap((value) => value.writes))].sort(),
  }
}

function imported(target, name) {
  const taskQuery = target === 'lib/server/task-store' && TASK_READS.has(name)
  const legacyQuery = (target === 'lib/server/image-work-scheduler' && name === 'assertImageQueueCapacity')
    || (target === 'lib/server/fission-prompt-planner' && name === 'invokeFissionPromptPlanner')
  return {
    origins: [`${target}#${name}`],
    writes: COMMAND_TYPES.has(name) || WRITES.has(name)
      || (isExternalCapability(target) && !taskQuery && !legacyQuery) ? [name] : [],
  }
}

/** 读取明确的架构边界；测试代码有意允许导入真实 normalizer。 */
export function readAgentSources(root) {
  const sources = new Map()
  function visit(directory) {
    if (!lstatSync(directory).isDirectory()) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !isTest(entry.name)) {
        sources.set(normalize(path.relative(root, target)), readFileSync(target, 'utf8'))
      }
    }
  }
  for (const relative of ['lib/agent', 'lib/server/agent', 'lib/server/agent-beta']) {
    try { visit(path.join(root, relative)) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return sources
}

/** AST + 本文件符号数据流检查；不是运行时沙箱，不解析反射生成的任意 JavaScript。 */
export function checkAgentArchitecture(input) {
  const sources = new Map([...input].filter(([file]) => !isTest(file)).map(([file, source]) => [normalize(file), source]))
  const options = { noResolve: true, noLib: true, allowJs: true, target: ts.ScriptTarget.Latest }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (file) => sources.has(file)
    ? ts.createSourceFile(file, sources.get(file), ts.ScriptTarget.Latest, true) : undefined
  host.fileExists = (file) => sources.has(file)
  host.readFile = (file) => sources.get(file)
  const program = ts.createProgram([...sources.keys()], options, host)
  const checker = program.getTypeChecker()
  const violations = []
  const seen = new Set()
  function report(source, node, rule, message) {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source))
    const violation = { file: source.fileName, line: position.line + 1, column: position.character + 1, rule, message }
    const key = `${violation.file}:${violation.line}:${violation.column}:${rule}`
    if (!seen.has(key)) { seen.add(key); violations.push(violation) }
  }

  for (const source of program.getSourceFiles()) {
    const file = source.fileName
    if (!isPure(file) && !isNew(file) && !file.startsWith('lib/server/agent-beta/')) continue
    const nodes = []
    const values = new Map()
    const symbol = (node) => checker.getSymbolAtLocation(node)
    function visit(node) { nodes.push(node); ts.forEachChild(node, visit) }
    visit(source)

    function checkImport(node, specifier) {
      const target = resolveImport(file, specifier)
      if (isPure(file) && (target.startsWith('lib/server/') || target === 'server-only'
        || BUILTINS.has(target.replace(/^node:/, '')) || /^(?:fs-extra|axios|undici|node-fetch|ali-oss)(?:\/|$)/.test(target))) {
        report(source, node, 'pure-io', `同构 Agent 模块禁止服务端或 I/O 依赖：${specifier}`)
      }
      if (isExternalCapability(target) && file !== RUNTIME && moduleName(file) !== ADAPTER
        && !(file === LEGACY_RUNTIME && LEGACY_IMPORTS.has(target))) {
        report(source, node, 'external-capability-import', `具体任务/供应商能力只能在 composition root 或 task-adapter 加载：${specifier}`)
      }
      if (file.startsWith('lib/server/agent/observability/') && (
        target.startsWith('lib/server/agent-beta/') || isExternalCapability(target)
        || (/^lib\/server\/agent\//.test(target) && !target.startsWith('lib/server/agent/observability/')
          && target !== 'lib/server/agent/ports')
      )) report(source, node, 'observability-backedge', `可观测模块不能反向依赖业务实现：${specifier}`)
      return target
    }

    function setBinding(name, info) {
      if (ts.isIdentifier(name)) {
        const key = symbol(name)
        if (key) values.set(key, info)
      } else if (ts.isObjectBindingPattern(name)) {
        for (const item of name.elements) {
          const key = (item.propertyName ?? item.name).getText(source).replace(/^['"]|['"]$/g, '')
          setBinding(item.name, item.dotDotDotToken ? info : property(info, key))
        }
      } else if (ts.isArrayBindingPattern(name)) {
        name.elements.forEach((item, index) => {
          if (ts.isBindingElement(item)) setBinding(item.name, info.items?.[index] ?? EMPTY)
        })
      }
    }

    function property(info, name) {
      if (info.members?.has(name)) return info.members.get(name)
      const namespace = info.origins.filter((origin) => origin.endsWith('#*'))
      if (namespace.length) return merge(...namespace.map((origin) => imported(origin.slice(0, -2), name)))
      if (WRITES.has(name)) return { origins: info.origins, writes: [name] }
      return EMPTY
    }

    function expression(node) {
      if (!node) return EMPTY
      if (ts.isIdentifier(node)) return values.get(symbol(node)) ?? EMPTY
      if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node)
        || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return expression(node.expression)
      if (ts.isPropertyAccessExpression(node)) return property(expression(node.expression), node.name.text)
      if (ts.isElementAccessExpression(node)) {
        const base = expression(node.expression)
        return ts.isStringLiteralLike(node.argumentExpression) ? property(base, node.argumentExpression.text) : base
      }
      if (ts.isArrayLiteralExpression(node)) {
        const items = node.elements.map(expression)
        return { ...merge(...items), items }
      }
      if (ts.isObjectLiteralExpression(node)) {
        const members = new Map()
        const parts = node.properties.map((item) => {
          if (ts.isSpreadAssignment(item)) {
            const value = expression(item.expression)
            for (const [key, member] of value.members ?? []) members.set(key, member)
            return value
          }
          const value = ts.isShorthandPropertyAssignment(item)
            ? values.get(checker.getShorthandAssignmentValueSymbol(item)) ?? EMPTY
            : expression(ts.isPropertyAssignment(item) ? item.initializer : item)
          members.set(item.name?.getText(source).replace(/^['"]|['"]$/g, ''), value)
          return value
        })
        return { ...merge(...parts), members }
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        const captured = [expression(node.body)]
        function collectCalls(child) {
          if (ts.isCallExpression(child)) captured.push(expression(child.expression))
          ts.forEachChild(child, collectCalls)
        }
        collectCalls(node.body)
        return merge(...captured)
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
          const arg = node.arguments?.[0]
          return arg && ts.isStringLiteralLike(arg) ? imported(resolveImport(file, arg.text), '*') : EMPTY
        }
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'Promise'
          && node.expression.name.text === 'all') return expression(node.arguments?.[0])
        const callee = expression(node.expression)
        return callee.origins.some((origin) => origin.startsWith(`${ADAPTER}#`))
          ? { origins: callee.origins, writes: ['TaskCommandPort'] } : EMPTY
      }
      const children = []
      ts.forEachChild(node, (child) => { children.push(expression(child)) })
      return merge(...children)
    }

    for (const node of nodes) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const target = checkImport(node, node.moduleSpecifier.text)
        if (ts.isImportDeclaration(node) && node.importClause) {
          if (node.importClause.name) setBinding(node.importClause.name, imported(target, 'default'))
          const bindings = node.importClause.namedBindings
          if (bindings && ts.isNamespaceImport(bindings)) setBinding(bindings.name, imported(target, '*'))
          else if (bindings) for (const item of bindings.elements) setBinding(item.name, imported(target, (item.propertyName ?? item.name).text))
        }
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const specifier = node.moduleReference.expression
        if (specifier && ts.isStringLiteralLike(specifier)) setBinding(node.name, imported(checkImport(node, specifier.text), '*'))
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        checkImport(node, node.argument.literal.text)
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const specifier = node.arguments[0]
        if (specifier && ts.isStringLiteralLike(specifier)) checkImport(node, specifier.text)
        else report(source, node, 'unresolved-import', '架构边界内的模块加载必须使用可静态核验的字面量路径')
      }
    }

    // 通过 TS 符号区分不同作用域同名变量，迭代传播别名、解构、对象及包装函数中的能力。
    for (let pass = 0; pass < 20; pass++) {
      const before = JSON.stringify([...values.values()].map(({ writes, origins }) => [writes, origins]))
      for (const node of nodes) {
        if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
          const info = merge(expression(node.initializer), expression(node.type))
          const original = expression(node.initializer)
          setBinding(node.name, { ...original, ...info })
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
          const old = values.get(symbol(node.left)) ?? EMPTY
          setBinding(node.left, merge(old, expression(node.right)))
        }
      }
      if (before === JSON.stringify([...values.values()].map(({ writes, origins }) => [writes, origins]))) break
    }

    for (const node of nodes) {
      if (isPure(file) && ts.isIdentifier(node) && IO_GLOBALS.has(node.text) && !symbol(node)) {
        report(source, node, 'pure-io', `同构 Agent 模块禁止 I/O 全局能力：${node.text}`)
      }
      if (isPure(file) && ts.isElementAccessExpression(node)
        && ts.isStringLiteralLike(node.argumentExpression) && IO_GLOBALS.has(node.argumentExpression.text)) {
        let base = node.expression
        while (ts.isParenthesizedExpression(base) || ts.isAsExpression(base)) base = base.expression
        if (ts.isIdentifier(base) && ['globalThis', 'window', 'self', 'global'].includes(base.text)) {
          report(source, node, 'pure-io', `同构 Agent 模块禁止以索引读取 I/O 全局能力：${node.argumentExpression.text}`)
        }
      }
      // 组装写端口统一用可审核的对象字面量；禁止后赋值隐藏来源，包括对象别名和动态下标。
      if ((isRuntime(file) || isRestricted(file)) && ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
        && expression(node.right).writes.length) {
        report(source, node, 'write-capability-assignment', '不能通过对象后赋值隐藏写能力；请在治理接线处使用明确的对象字面量')
      }
      if (isRestricted(file) && ((ts.isIdentifier(node) && COMMAND_TYPES.has(node.text))
        || (ts.isTypeReferenceNode(node) && expression(node.typeName).writes.length))) {
        report(source, node, 'write-port-outside-governance', '此模块不能持有 TaskCommandPort / VendorActionPort')
      }
      if (isRestricted(file) && (ts.isPropertySignature(node) || ts.isMethodSignature(node))
        && WRITES.has(node.name.getText(source).replace(/^['"]|['"]$/g, ''))) {
        report(source, node, 'write-port-outside-governance', '不能用匿名结构类型绕过写端口的治理边界')
      }
      if (isRestricted(file) && ((ts.isVariableDeclaration(node) || ts.isParameter(node))
        && expression(node.name).writes.length)) report(source, node, 'write-capability-holder', '写 capability 只能交给治理层')
      if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) continue
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') continue
      const callee = expression(node.expression)
      let directCallee = node.expression
      while (ts.isParenthesizedExpression(directCallee)) directCallee = directCallee.expression
      const immediateFunction = ts.isArrowFunction(directCallee) || ts.isFunctionExpression(directCallee)
      if ((isRuntime(file) || isRestricted(file)) && callee.writes.length && !immediateFunction) {
        report(source, node, 'direct-write-call', 'runtime 只负责组装，业务层不能直接执行写 capability')
      }
      const args = node.arguments ?? []
      const capability = merge(...args.map(expression))
      if (!capability.writes.length || (!isRuntime(file) && !isRestricted(file))) continue
      const governance = callee.origins.length > 0
        && callee.origins.every((origin) => origin.startsWith('lib/server/agent/governance/'))
      const legacyMembers = expression(args[1]).members
      const exactLegacyMembers = legacyMembers && [...legacyMembers].every(([name, value]) => !value.writes.length
        || ((name === 'createTask' || name === 'cancelTask') && value.writes.length === 1 && value.writes[0] === name
          && value.origins.length === 1 && value.origins[0] === `lib/server/task-store#${name}`))
      const legacy = file === LEGACY_RUNTIME && ts.isNewExpression(node) && args.length === 2
        && callee.origins.length === 1 && callee.origins[0] === 'lib/server/agent-beta/service#AgentBetaService'
        && exactLegacyMembers
        && capability.writes.every((name) => name === 'createTask' || name === 'cancelTask')
      // Promise.all 仅承载模块加载，不是把模块能力交给业务调用者。
      const moduleLoad = ts.isPropertyAccessExpression(node.expression) && node.expression.getText(source) === 'Promise.all'
        && args.length === 1 && ts.isArrayLiteralExpression(args[0]) && args[0].elements.every((item) =>
          ts.isCallExpression(item) && item.expression.kind === ts.SyntaxKind.ImportKeyword)
      if (!governance && !legacy && !moduleLoad) report(source, node, 'capability-injection', '写能力接收者必须是治理模块；旧 service 仅保留现有精确接线')
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const violations = checkAgentArchitecture(readAgentSources(root))
  for (const item of violations) console.error(`${item.file}:${item.line}:${item.column} [${item.rule}] ${item.message}`)
  if (violations.length) process.exitCode = 1
  else console.log('Agent 架构检查通过')
}
