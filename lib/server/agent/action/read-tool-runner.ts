import { z } from 'zod'
import { AGENT_BUDGET, OBSERVATION_TTL_MS } from '@/lib/agent/budget'
import { assetDigest, canonicalize } from '@/lib/agent/contracts'
import type { GovernedAction, UserIntentReceipt } from '@/lib/agent/contracts'
import type { ContextHandle } from '@/lib/agent/context'
import type { AgentToolMeta } from '@/lib/agent/types'
import type { AssetRecord } from '@/lib/types'
import type { QueryPort, SessionQueryRecord } from '../ports'
import type { BoundToolProposal } from './provenance'
import type { ToolDispatchResult } from './tool-dispatch'
import { ToolRegistry } from './tool-registry'

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const version = z.string().min(1).max(160).refine((value) => value.trim() === value)
const scopeSchema = z.object({ userId: identifier, sessionId: identifier, messageId: identifier }).strict()

/** 身份必须由已认证服务端提供；工具参数和 handle 都不能改变它。 */
export type ReadToolScope = z.infer<typeof scopeSchema>

/** 只读调用参数由服务端选择绑定；模型原始提案仍遵循 C5 的 toolName/prompt 协议。 */
export const READ_TOOL_SCHEMAS = Object.freeze({
  'asset.inspect': z.object({ assetId: identifier }).strict(),
  'session.list_nodes': z.object({}).strict(),
  'task.get_status': z.object({ taskId: identifier }).strict(),
})
export const GARMENT_CLASSIFY_INPUT_SCHEMA = z.object({ assetId: identifier }).strict()

function metadata(name: string, inputSchema: AgentToolMeta['inputSchema'], description: string): AgentToolMeta {
  return Object.freeze({ name, inputSchema, description, whenToUse: description,
    whenNotToUse: Object.freeze(['资源不属于当前用户或当前会话时', '需要执行外部动作时']) as unknown as string[],
    readOnly: true, costClass: 'free', sideEffectClass: 'none', approvalPolicy: 'none',
    requiresFreshState: true, quotaPerTurn: AGENT_BUDGET.maxReadToolCallsPerTurn, rollbackCapability: 'none' })
}

/** 纯读取工具注册项；没有 handler 或供应商 capability。 */
export const READ_TOOL_METADATA: readonly AgentToolMeta[] = Object.freeze([
  metadata('asset.inspect', READ_TOOL_SCHEMAS['asset.inspect'], '读取当前会话素材的尺寸和版本'),
  metadata('session.list_nodes', READ_TOOL_SCHEMAS['session.list_nodes'], '列出当前会话仍可访问的素材节点'),
  metadata('task.get_status', READ_TOOL_SCHEMAS['task.get_status'], '读取当前会话任务的状态和进度'),
])

/** 分类读取语义不代表免费；必须由 Gateway 验证当前用户意图并执行每轮两次配额。 */
export const GARMENT_CLASSIFY_TOOL_METADATA: AgentToolMeta = Object.freeze({
  ...metadata('garment.classify', GARMENT_CLASSIFY_INPUT_SCHEMA, '用户要求分析当前素材类别时准备受治理分类动作'),
  whenNotToUse: Object.freeze(['用户未要求分析当前素材时', '素材未经过当前用户和会话归属校验时']) as unknown as string[],
  costClass: 'vendor_api', approvalPolicy: 'explicit_user_intent', quotaPerTurn: AGENT_BUDGET.maxClassificationsPerTurn,
})

/** 所有越权、跨会话和未知资源使用同一 404；错误不带原始输入或底层响应。 */
export class ReadToolError extends Error {
  constructor(readonly code: 'invalid_input' | 'not_found' | 'tool_not_read_only' | 'query_unavailable') {
    super(code)
    this.name = 'ReadToolError'
  }
  get status(): number { return this.code === 'not_found' ? 404 : this.code === 'query_unavailable' ? 503 : 400 }
}

function parsePlain<T>(schema: z.ZodType<T>, input: unknown, code: ReadToolError['code'] = 'invalid_input'): T {
  try { return schema.parse(JSON.parse(canonicalize(input))) } catch { throw new ReadToolError(code) }
}

const nodeSchema = z.object({ id: identifier, assetId: identifier, name: z.string().max(500), taskId: identifier.optional() }).strict()
const sessionSchema = z.object({ sessionId: identifier, userId: identifier, nodes: z.array(nodeSchema),
  taskIds: z.array(identifier).optional() }).strict()
const assetSchema = z.object({ assetId: identifier, userId: identifier, width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(), createdAt: z.string().datetime(), taskId: identifier.nullable().optional() }).strict()
const taskSchema = z.object({ taskId: identifier, userId: identifier,
  featureType: z.enum(['ai-fashion-photo', 'photo-fission', 'pose-fission', 'garment-detail']),
  status: z.enum(['pending', 'running', 'success', 'failed', 'partial', 'cancelled']),
  progress: z.number().finite().min(0).max(100), createdAt: z.string().datetime(), finishedAt: z.string().datetime().optional(),
}).strict()

/** 只提取显式数据属性，不执行存储记录上的 getter，也不复制 URL/任务参数/供应商文本。 */
function pickData(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new ReadToolError('not_found')
  const output: Record<string, unknown> = {}
  try {
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field)
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new ReadToolError('not_found')
      if (descriptor && descriptor.value !== undefined) output[field] = descriptor.value
    }
  } catch { throw new ReadToolError('not_found') }
  return output
}

async function queryResult<T>(read: () => Promise<T>): Promise<T> {
  try { return await read() } catch { throw new ReadToolError('query_unavailable') }
}

async function currentSession(query: QueryPort, scope: ReadToolScope): Promise<SessionQueryRecord> {
  const result = await queryResult(() => query.getSession(scope.sessionId))
  const session = parsePlain(sessionSchema, result, 'not_found')
  if (session.sessionId !== scope.sessionId || session.userId !== scope.userId) throw new ReadToolError('not_found')
  return session
}

type AssetIdentity = z.infer<typeof assetSchema>

async function currentAsset(query: QueryPort, scope: ReadToolScope, session: SessionQueryRecord, assetId: string): Promise<AssetIdentity> {
  if (!session.nodes.some((node) => node.assetId === assetId)) throw new ReadToolError('not_found')
  const record = await queryResult(() => query.getAsset(assetId))
  const asset = parsePlain(assetSchema, pickData(record, Object.keys(assetSchema.shape)), 'not_found')
  if (asset.assetId !== assetId || asset.userId !== scope.userId) throw new ReadToolError('not_found')
  return asset
}

async function assetView(asset: AssetIdentity) {
  return { assetId: asset.assetId, width: asset.width, height: asset.height, createdAt: asset.createdAt,
    assetDigest: await assetDigest(asset as AssetRecord) }
}

async function inspectAsset(query: QueryPort, scope: ReadToolScope, assetId: string) {
  const session = await currentSession(query, scope)
  return { toolName: 'asset.inspect' as const, asset: await assetView(await currentAsset(query, scope, session, assetId)) }
}

async function listNodes(query: QueryPort, scope: ReadToolScope) {
  const session = await currentSession(query, scope)
  const assets = new Map<string, Awaited<ReturnType<typeof assetView>>>()
  for (const node of session.nodes) {
    if (!assets.has(node.assetId)) assets.set(node.assetId, await assetView(await currentAsset(query, scope, session, node.assetId)))
  }
  return { toolName: 'session.list_nodes' as const, sessionId: scope.sessionId,
    nodes: session.nodes.map((node) => ({ id: node.id, name: node.name, ...assets.get(node.assetId)! })) }
}

async function taskStatus(query: QueryPort, scope: ReadToolScope, taskId: string) {
  const session = await currentSession(query, scope)
  if (!session.taskIds?.includes(taskId) && !session.nodes.some((node) => node.taskId === taskId)) {
    throw new ReadToolError('not_found')
  }
  const record = await queryResult(() => query.getTask(taskId))
  const task = parsePlain(taskSchema, pickData(record, Object.keys(taskSchema.shape)), 'not_found')
  if (task.taskId !== taskId || task.userId !== scope.userId) throw new ReadToolError('not_found')
  // userId 只参与鉴权；不返回错误文本、提示词、结果 URL 或未准入结果。
  const { userId: _userId, ...view } = task
  void _userId
  return { toolName: 'task.get_status' as const, task: view }
}

const boundSchema = z.object({ kind: z.literal('utility'), toolName: z.string(), prompt: z.string().optional(),
  userId: identifier, sessionId: identifier, messageId: identifier, idempotencyKey: z.string().min(1),
  assetIds: z.array(identifier), taskId: identifier.optional(), shotIds: z.array(identifier).optional(),
  origins: z.record(z.enum(['user_text', 'user_selection', 'system_policy', 'model_inference', 'image_observation', 'provider_response'])),
}).strict()

function boundArgs(input: unknown, scope: ReadToolScope): { toolName: string; args: unknown } {
  const proposal = parsePlain(boundSchema, input)
  if (proposal.userId !== scope.userId || proposal.sessionId !== scope.sessionId || proposal.messageId !== scope.messageId) {
    throw new ReadToolError('not_found')
  }
  if (proposal.toolName === 'asset.inspect' || proposal.toolName === 'garment.classify') {
    if (proposal.assetIds.length !== 1) throw new ReadToolError('invalid_input')
    return { toolName: proposal.toolName, args: { assetId: proposal.assetIds[0] } }
  }
  return { toolName: proposal.toolName, args: proposal.toolName === 'task.get_status' ? { taskId: proposal.taskId } : {} }
}

/** 只有 QueryPort；即使上游误把 vendor 工具标为 read_only，也会重新核对全部治理轴。 */
export class ReadToolRunner {
  private readonly registry: ToolRegistry
  constructor(private readonly options: { query: QueryPort; registry?: ToolRegistry; now?: () => Date }) {
    this.registry = options.registry ?? new ToolRegistry([...READ_TOOL_METADATA, GARMENT_CLASSIFY_TOOL_METADATA])
  }

  async run(input: { toolName: string; args: unknown }, authenticatedScope: ReadToolScope) {
    const scope = parsePlain(scopeSchema, authenticatedScope)
    const call = parsePlain(z.object({ toolName: z.string(), args: z.unknown() }).strict(), input)
    const tool = this.registry.get(call.toolName)
    if (!tool || !tool.readOnly || tool.costClass !== 'free' || tool.sideEffectClass !== 'none'
      || tool.approvalPolicy !== 'none' || tool.rollbackCapability !== 'none') throw new ReadToolError('tool_not_read_only')
    if (call.toolName === 'asset.inspect') {
      const args = parsePlain(READ_TOOL_SCHEMAS['asset.inspect'], call.args)
      return inspectAsset(this.options.query, scope, args.assetId)
    }
    if (call.toolName === 'session.list_nodes') {
      parsePlain(READ_TOOL_SCHEMAS['session.list_nodes'], call.args)
      return listNodes(this.options.query, scope)
    }
    if (call.toolName === 'task.get_status') {
      const args = parsePlain(READ_TOOL_SCHEMAS['task.get_status'], call.args)
      return taskStatus(this.options.query, scope, args.taskId)
    }
    throw new ReadToolError('tool_not_read_only')
  }

  /** 仅消费服务端 Dispatcher 的准入结果；不把 admitted 标签当作身份或资源权限。 */
  async runAdmitted(input: ToolDispatchResult, authenticatedScope: ReadToolScope) {
    const scope = parsePlain(scopeSchema, authenticatedScope)
    const admitted = parsePlain(z.object({ status: z.literal('admitted'), target: z.literal('read_only'),
      proposal: boundSchema }).strict(), input)
    return this.run(boundArgs(admitted.proposal, scope), scope)
  }
}

const handleSchema = z.object({ schemaVersion: z.literal(1), kind: z.enum(['asset', 'task', 'observation', 'session_nodes']),
  userId: identifier, sessionId: identifier, resourceId: identifier, assetDigest: hash.optional(), observerVersion: version.optional(),
}).strict()
const observationSchema = z.object({ observerVersion: version, observation: z.object({ assetId: identifier, assetDigest: hash,
  observedAt: z.string().datetime(), origin: z.literal('image_observation'),
  subject: z.enum(['garment_flat', 'garment_on_model', 'person', 'detail_shot', 'other', 'unknown']),
  category: z.enum(['tops', 'coat', 'skirt', 'pants', 'bag', 'shoes', 'hat', 'dress', 'suit', 'accessory', 'unknown']),
  dominantColors: z.array(z.string().regex(/^#[a-fA-F0-9]{6}$/)).max(32), hasFace: z.boolean(),
  hasVisibleText: z.boolean(), quality: z.object({ blurry: z.boolean(), lowResolution: z.boolean(), watermark: z.boolean() }).strict(),
  confidence: z.number().finite().min(0).max(1),
}).strict() }).strict()
const cachedObservationSchema = z.object({ observerVersion: version,
  observation: observationSchema.shape.observation.extend({ observerModel: z.string().min(1).max(200),
    silhouette: z.string().max(4000), keyDetails: z.array(z.string().max(2000)).max(64), notes: z.string().max(8000),
  }).strict(),
}).strict()

/** P3 handle 是定位符；每次解引用都读取当前会话成员和资源归属，观察 miss 不触发计算。 */
export async function resolveContextHandle(input: ContextHandle, authenticatedScope: ReadToolScope, query: QueryPort,
  options: { now?: () => Date } = {}) {
  const scope = parsePlain(scopeSchema, authenticatedScope)
  const handle = parsePlain(handleSchema, input)
  if (handle.userId !== scope.userId || handle.sessionId !== scope.sessionId) throw new ReadToolError('not_found')
  if (handle.kind === 'session_nodes') {
    if (handle.resourceId !== scope.sessionId) throw new ReadToolError('not_found')
    return listNodes(query, scope)
  }
  if (handle.kind === 'task') return taskStatus(query, scope, handle.resourceId)
  if (!handle.assetDigest || (handle.kind === 'observation' && !handle.observerVersion)) throw new ReadToolError('invalid_input')
  const session = await currentSession(query, scope)
  const asset = await currentAsset(query, scope, session, handle.resourceId)
  const view = await assetView(asset)
  if (handle.assetDigest !== undefined && handle.assetDigest !== view.assetDigest) throw new ReadToolError('not_found')
  if (handle.kind === 'asset') return { toolName: 'asset.inspect' as const, asset: view }
  if (!query.getObservation) return null
  const cached = await queryResult(() => query.getObservation!({ userId: scope.userId, assetId: asset.assetId,
    observerVersion: handle.observerVersion! }))
  if (!cached) return null
  let parsed: z.infer<typeof observationSchema>
  try {
    // 先验证完整 cache；无行为的文本也只用来确认缓存未损坏，不传给模型。
    const envelope: Record<string, unknown> = parsePlain(cachedObservationSchema, cached)
    envelope.observation = pickData(envelope.observation, Object.keys(observationSchema.shape.observation.shape))
    parsed = parsePlain(observationSchema, envelope)
  } catch { return null }
  const observation = parsed.observation
  const now = (options.now ?? (() => new Date()))().getTime()
  const observedAt = Date.parse(observation.observedAt)
  if (parsed.observerVersion !== handle.observerVersion || observation.assetId !== asset.assetId
    || observation.assetDigest !== view.assetDigest || !Number.isFinite(now)
    || observedAt > now || now - observedAt >= OBSERVATION_TTL_MS) return null
  const latest = await currentAsset(query, scope, await currentSession(query, scope), asset.assetId)
  if ((await assetView(latest)).assetDigest !== view.assetDigest) return null
  return { kind: 'observation' as const, observerVersion: parsed.observerVersion, observation,
    limitations: ['观察只提供弱信号；false 不代表检测已执行或已确认不存在，不得用于权限或安全闸门。'] }
}

const intentSchema = z.object({ schemaVersion: z.literal(1), intentId: identifier, userId: identifier, sessionId: identifier,
  messageId: identifier, actionKind: z.literal('classify'), targetId: identifier, verifiedAt: z.string().datetime() }).strict()

/** 仅绑定分类动作；intent 必须来自可信服务端签发入口，结构校验不能证明用户曾同意。C7 仍须验证回执与配额。 */
export async function bindClassificationAction(proposal: BoundToolProposal, authenticatedScope: ReadToolScope,
  trustedIntent: UserIntentReceipt, query: QueryPort): Promise<Extract<GovernedAction, { actionKind: 'classify' }>> {
  const scope = parsePlain(scopeSchema, authenticatedScope)
  const call = boundArgs(proposal, scope)
  if (call.toolName !== 'garment.classify') throw new ReadToolError('invalid_input')
  const args = parsePlain(GARMENT_CLASSIFY_INPUT_SCHEMA, call.args)
  const intent = parsePlain(intentSchema, trustedIntent)
  if (intent.userId !== scope.userId || intent.sessionId !== scope.sessionId || intent.messageId !== scope.messageId
    || intent.targetId !== args.assetId) throw new ReadToolError('not_found')
  const asset = await currentAsset(query, scope, await currentSession(query, scope), args.assetId)
  return Object.freeze({ actionKind: 'classify', payload: Object.freeze({ schemaVersion: 1, ...scope, assetId: args.assetId,
    assetDigest: (await assetView(asset)).assetDigest, intent: Object.freeze(intent) }) })
}
