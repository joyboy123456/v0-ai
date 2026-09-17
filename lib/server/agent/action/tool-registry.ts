import type { AgentToolMeta } from '../../../agent/types'

const COST_CLASSES = new Set(['free', 'vendor_api', 'paid_generation'])
const SIDE_EFFECT_CLASSES = new Set(['none', 'local_write', 'external_reversible', 'external_irreversible'])
const APPROVAL_POLICIES = new Set(['none', 'explicit_user_intent', 'preview_confirmation', 'always'])
const ROLLBACK_CAPABILITIES = new Set([
  'none',
  'cancel_before_provider_accept',
  'local_polling_only',
  'irreversible_after_submit',
])

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/
const FEATURE_TYPES = new Set([
  'ai-fashion-photo',
  'photo-fission',
  'pose-fission',
  'garment-detail',
])

type VerifiableZodObject = AgentToolMeta['inputSchema'] & {
  _def?: {
    typeName?: unknown
    unknownKeys?: unknown
    catchall?: { _def?: { typeName?: unknown } }
  }
}

function requireText(value: unknown, field: string, toolName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`工具 ${toolName} 缺少 ${field}`)
  }
}

function assertStrictInputSchema(tool: AgentToolMeta, toolName: string): void {
  if (!tool.inputSchema || typeof tool.inputSchema.parse !== 'function') {
    throw new Error(`工具 ${toolName} 缺少 inputSchema.parse`)
  }

  // 当前只接受能够直接核验 unknownKeys 与 catchall 的 ZodObject，包装器需先在注册前解开。
  const definition = (tool.inputSchema as VerifiableZodObject)._def
  if (definition?.typeName !== 'ZodObject'
    || definition.unknownKeys !== 'strict'
    || definition.catchall?._def?.typeName !== 'ZodNever') {
    throw new Error(`工具 ${toolName} 的 inputSchema 必须是可验证的 strict ZodObject（catchall 为 ZodNever）`)
  }
}

function validateTool(tool: AgentToolMeta, index: number): void {
  const toolName = typeof tool?.name === 'string' && tool.name.trim() !== ''
    ? tool.name
    : `#${index + 1}`

  requireText(tool?.name, 'name', toolName)
  if (tool.name.length > 100 || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(`工具 ${toolName} 的工具名格式无效`)
  }
  requireText(tool.description, 'description', toolName)
  requireText(tool.whenToUse, 'whenToUse', toolName)

  if (!Array.isArray(tool.whenNotToUse) || tool.whenNotToUse.length === 0
    || tool.whenNotToUse.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`工具 ${toolName} 缺少有效的 whenNotToUse`)
  }
  assertStrictInputSchema(tool, toolName)

  if (!COST_CLASSES.has(tool.costClass)) throw new Error(`工具 ${toolName} 的 costClass 无效`)
  if (!SIDE_EFFECT_CLASSES.has(tool.sideEffectClass)) throw new Error(`工具 ${toolName} 的 sideEffectClass 无效`)
  if (!APPROVAL_POLICIES.has(tool.approvalPolicy)) throw new Error(`工具 ${toolName} 的 approvalPolicy 无效`)
  if (!ROLLBACK_CAPABILITIES.has(tool.rollbackCapability)) {
    throw new Error(`工具 ${toolName} 缺少有效的 rollbackCapability`)
  }
  if (tool.featureType !== undefined && !FEATURE_TYPES.has(tool.featureType)) {
    throw new Error(`工具 ${toolName} 的 featureType 无效`)
  }
  if (typeof tool.readOnly !== 'boolean' || typeof tool.requiresFreshState !== 'boolean') {
    throw new Error(`工具 ${toolName} 的布尔配置无效`)
  }
  if (!Number.isInteger(tool.quotaPerTurn) || tool.quotaPerTurn < 1) {
    throw new Error(`工具 ${toolName} 的 quotaPerTurn 必须为正整数`)
  }
  if (tool.costClass === 'paid_generation') {
    if (tool.approvalPolicy !== 'preview_confirmation') {
      throw new Error(`工具 ${toolName} 的付费生成必须使用 preview_confirmation`)
    }
    if (tool.readOnly) throw new Error(`工具 ${toolName} 的付费生成不能声明 readOnly`)
    if (tool.sideEffectClass === 'none') throw new Error(`工具 ${toolName} 的付费生成必须声明写副作用`)
    if (tool.name !== 'task.retry_shots' && tool.featureType === undefined) {
      throw new Error(`生成工具 ${toolName} 缺少 featureType`)
    }
  }
  if (tool.readOnly && tool.sideEffectClass !== 'none') {
    throw new Error(`工具 ${toolName} 声明只读却包含写副作用`)
  }
  if (tool.sideEffectClass !== 'none' && tool.approvalPolicy === 'none') {
    throw new Error(`工具 ${toolName} 包含写副作用却没有审批策略`)
  }
  if (tool.sideEffectClass !== 'none' && tool.rollbackCapability === 'none') {
    throw new Error(`工具 ${toolName} 包含写副作用却没有回滚说明`)
  }
  if (tool.sideEffectClass === 'none' && tool.rollbackCapability !== 'none') {
    throw new Error(`工具 ${toolName} 没有写副作用却声明了回滚能力`)
  }
}

function immutableMetadata(tool: AgentToolMeta): AgentToolMeta {
  const whenNotToUse = [...tool.whenNotToUse]
  Object.freeze(whenNotToUse)

  // 只冻结代理外壳；原解析器保留为 this，允许 Zod 更新内部缓存。
  const parser = tool.inputSchema
  const inputSchema = { parse: parser.parse.bind(parser) }
  Object.freeze(inputSchema)

  const copy: AgentToolMeta = { ...tool, whenNotToUse, inputSchema }
  return Object.freeze(copy)
}

/** 仅保存可审计的工具元数据，不持有或安装真实 handler。 */
export class ToolRegistry {
  readonly #tools: readonly AgentToolMeta[]
  readonly #byName: ReadonlyMap<string, AgentToolMeta>

  constructor(tools: readonly AgentToolMeta[]) {
    const byName = new Map<string, AgentToolMeta>()
    const copies: AgentToolMeta[] = []

    tools.forEach((tool, index) => {
      validateTool(tool, index)
      if (byName.has(tool.name)) throw new Error(`工具名称重复：${tool.name}`)
      const copy = immutableMetadata(tool)
      byName.set(copy.name, copy)
      copies.push(copy)
    })

    Object.freeze(copies)
    this.#tools = copies
    this.#byName = byName
  }

  get(name: string): AgentToolMeta | undefined {
    return this.#byName.get(name)
  }

  list(): readonly AgentToolMeta[] {
    return this.#tools
  }
}
