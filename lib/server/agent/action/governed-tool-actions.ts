import { z } from 'zod'
import { AGENT_BUDGET } from '@/lib/agent/budget'
import { assetDigest, canonicalize } from '@/lib/agent/contracts'
import type { GovernedAction, UserIntentReceipt } from '@/lib/agent/contracts'
import { isFieldOriginAllowed, type FieldOrigin } from '@/lib/agent/provenance'
import type { AgentToolMeta } from '@/lib/agent/types'
import type { CutoutScene } from '@/lib/types'
import type { QueryPort, SessionQueryRecord } from '../ports'
import type { BoundToolProposal } from './provenance'
import {
  bindClassificationAction,
  GARMENT_CLASSIFY_TOOL_METADATA,
  ReadToolError,
  type ReadToolScope,
} from './read-tool-runner'

/** 模型只选择工具；素材、任务、scene 与意图均由可信服务端上下文另行绑定。 */
export const GOVERNED_UTILITY_INPUT_SCHEMAS = Object.freeze({
  'cutout.prepare': z.object({}).strict(),
  'task.cancel': z.object({}).strict(),
})

const CONTROLLED_UTILITY_QUOTA = Math.min(
  AGENT_BUDGET.maxReadToolCallsPerTurn,
  AGENT_BUDGET.maxCutoutPreparationsPerTurn,
)

function metadata(
  name: 'cutout.prepare' | 'task.cancel',
  description: string,
  whenNotToUse: readonly string[],
  options: Pick<AgentToolMeta, 'costClass' | 'sideEffectClass' | 'rollbackCapability' | 'quotaPerTurn'>,
): AgentToolMeta {
  return Object.freeze({
    name,
    description,
    whenToUse: description,
    whenNotToUse: Object.freeze([...whenNotToUse]) as unknown as string[],
    inputSchema: GOVERNED_UTILITY_INPUT_SCHEMAS[name],
    readOnly: false,
    costClass: options.costClass,
    sideEffectClass: options.sideEffectClass,
    approvalPolicy: 'explicit_user_intent',
    requiresFreshState: true,
    quotaPerTurn: options.quotaPerTurn,
    rollbackCapability: options.rollbackCapability,
  })
}

/** 会调用抠图供应商并创建短期会话；业务结果可放弃，但不声称撤销已发生的供应商请求。 */
export const CUTOUT_PREPARE_TOOL_METADATA: AgentToolMeta = metadata(
  'cutout.prepare',
  '用户明确要求从当前单一素材准备受治理的智能抠图会话时使用',
  ['用户未明确要求抠图时', '没有服务端绑定的当前会话素材时', '需要生成新图片而不是抠图时'],
  {
    costClass: 'vendor_api',
    sideEffectClass: 'external_irreversible',
    rollbackCapability: 'irreversible_after_submit',
    quotaPerTurn: AGENT_BUDGET.maxCutoutPreparationsPerTurn,
  },
)

/** 当前取消只保证本地任务控制，不声称供应商请求或费用已经撤销。 */
export const TASK_CANCEL_TOOL_METADATA: AgentToolMeta = metadata(
  'task.cancel',
  '用户明确要求取消当前会话中服务端选定的单一任务时使用',
  ['用户只询问任务状态时', '用户否定取消时', '没有服务端绑定的当前会话任务时'],
  {
    costClass: 'free',
    sideEffectClass: 'local_write',
    rollbackCapability: 'local_polling_only',
    quotaPerTurn: CONTROLLED_UTILITY_QUOTA,
  },
)

/** C9 注册时可与既有分类元数据一起安装；元数据本身不携带 handler。 */
export const GOVERNED_TOOL_METADATA: readonly AgentToolMeta[] = Object.freeze([
  GARMENT_CLASSIFY_TOOL_METADATA,
  CUTOUT_PREPARE_TOOL_METADATA,
  TASK_CANCEL_TOOL_METADATA,
])

export const GOVERNED_UTILITY_TOOL_METADATA: readonly AgentToolMeta[] = Object.freeze([
  CUTOUT_PREPARE_TOOL_METADATA,
  TASK_CANCEL_TOOL_METADATA,
])

export type BoundGovernedToolAction =
  | Extract<GovernedAction, { actionKind: 'classify' }>
  | Extract<GovernedAction, { actionKind: 'cutout_prepare' }>
  | Extract<GovernedAction, { actionKind: 'cancel' }>

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const originsSchema = z.record(z.string()).superRefine((origins, context) => {
  for (const [field, value] of Object.entries(origins)) {
    if (!isFieldOriginAllowed(field, value as FieldOrigin)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: '字段来源不符合共享契约' })
    }
  }
}).transform((origins) => origins as Record<string, FieldOrigin>)
const scopeSchema = z.object({ userId: identifier, sessionId: identifier, messageId: identifier }).strict()
const boundProposalSchema = z.object({
  kind: z.literal('utility'),
  toolName: z.enum(['garment.classify', 'cutout.prepare', 'task.cancel']),
  prompt: z.string().trim().min(1).max(8000).optional(),
  userId: identifier,
  sessionId: identifier,
  messageId: identifier,
  idempotencyKey: z.string().trim().min(1).max(512),
  assetIds: z.array(identifier),
  taskId: identifier.optional(),
  shotIds: z.array(identifier).optional(),
  origins: originsSchema,
}).strict()
const nodeSchema = z.object({
  id: identifier,
  assetId: identifier,
  name: z.string().max(500),
  taskId: identifier.optional(),
}).strict()
const sessionSchema = z.object({
  sessionId: identifier,
  userId: identifier,
  nodes: z.array(nodeSchema),
  taskIds: z.array(identifier).optional(),
}).strict()
const assetIdentitySchema = z.object({
  assetId: identifier,
  userId: identifier,
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  taskId: identifier.nullable().optional(),
}).strict()
const taskIdentitySchema = z.object({ taskId: identifier, userId: identifier }).strict()
const intentBase = {
  schemaVersion: z.literal(1),
  intentId: identifier,
  userId: identifier,
  sessionId: identifier,
  messageId: identifier,
  targetId: identifier,
  verifiedAt: z.string().datetime(),
}
const cutoutIntentSchema = z.object({ ...intentBase, actionKind: z.literal('cutout_prepare') }).strict()
const cancelIntentSchema = z.object({ ...intentBase, actionKind: z.literal('cancel') }).strict()
const cutoutSceneSchema = z.literal('garment')

function parsePlain<T>(schema: z.ZodType<T>, input: unknown, code: ReadToolError['code'] = 'invalid_input'): T {
  try {
    return schema.parse(JSON.parse(canonicalize(input)))
  } catch {
    throw new ReadToolError(code)
  }
}

/** 只读取显式数据属性；查询对象上的 getter、秘密字段和错误文本均不会进入动作或异常。 */
function projectData(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new ReadToolError('not_found')
  const output: Record<string, unknown> = {}
  try {
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field)
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new ReadToolError('not_found')
      if (descriptor?.value !== undefined) output[field] = descriptor.value
    }
  } catch {
    throw new ReadToolError('not_found')
  }
  return output
}

async function queryResult<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch {
    throw new ReadToolError('query_unavailable')
  }
}

async function currentSession(query: QueryPort, scope: ReadToolScope): Promise<SessionQueryRecord> {
  const raw = await queryResult(() => query.getSession(scope.sessionId))
  const session = parsePlain(
    sessionSchema,
    projectData(raw, Object.keys(sessionSchema.shape)),
    'not_found',
  )
  if (session.sessionId !== scope.sessionId || session.userId !== scope.userId) {
    throw new ReadToolError('not_found')
  }
  return session
}

async function currentAssetDigest(
  query: QueryPort,
  scope: ReadToolScope,
  session: SessionQueryRecord,
  assetId: string,
): Promise<string> {
  if (!session.nodes.some((node) => node.assetId === assetId)) throw new ReadToolError('not_found')
  const raw = await queryResult(() => query.getAsset(assetId))
  const asset = parsePlain(
    assetIdentitySchema,
    projectData(raw, Object.keys(assetIdentitySchema.shape)),
    'not_found',
  )
  if (asset.assetId !== assetId || asset.userId !== scope.userId) throw new ReadToolError('not_found')
  return assetDigest(asset)
}

async function assertCurrentTask(
  query: QueryPort,
  scope: ReadToolScope,
  session: SessionQueryRecord,
  taskId: string,
): Promise<void> {
  if (!session.taskIds?.includes(taskId) && !session.nodes.some((node) => node.taskId === taskId)) {
    throw new ReadToolError('not_found')
  }
  const raw = await queryResult(() => query.getTask(taskId))
  const task = parsePlain(
    taskIdentitySchema,
    projectData(raw, Object.keys(taskIdentitySchema.shape)),
    'not_found',
  )
  if (task.taskId !== taskId || task.userId !== scope.userId) throw new ReadToolError('not_found')
}

function assertIntentScope(
  intent: UserIntentReceipt,
  scope: ReadToolScope,
  targetId: string,
): void {
  if (intent.userId !== scope.userId || intent.sessionId !== scope.sessionId
    || intent.messageId !== scope.messageId || intent.targetId !== targetId) {
    throw new ReadToolError('not_found')
  }
}

function freezeAction<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeAction(child)
    Object.freeze(value)
  }
  return value
}

/**
 * 将 C5 冻结提案绑定为纯 GovernedAction。这里只核验结构、当前成员关系、owner 和身份；
 * 不执行供应商/任务命令，也不把 verifiedAt 的时间值当作最终新鲜度判定，TTL 仍由 Gateway 负责。
 */
export async function bindGovernedToolAction(
  proposal: BoundToolProposal,
  authenticatedScope: ReadToolScope,
  trustedIntent: UserIntentReceipt,
  query: QueryPort,
  serverCutoutScene?: CutoutScene,
): Promise<BoundGovernedToolAction> {
  const scope = parsePlain(scopeSchema, authenticatedScope)
  const bound = parsePlain(boundProposalSchema, proposal)
  if (bound.userId !== scope.userId || bound.sessionId !== scope.sessionId || bound.messageId !== scope.messageId) {
    throw new ReadToolError('not_found')
  }

  if (bound.toolName === 'garment.classify') {
    return bindClassificationAction(proposal, scope, trustedIntent, query)
  }

  if (bound.toolName === 'cutout.prepare') {
    if (bound.assetIds.length !== 1 || bound.taskId !== undefined || bound.shotIds !== undefined) {
      throw new ReadToolError('invalid_input')
    }
    const scene = parsePlain(cutoutSceneSchema, serverCutoutScene)
    const intent = parsePlain(cutoutIntentSchema, trustedIntent)
    const assetId = bound.assetIds[0]
    assertIntentScope(intent, scope, assetId)
    const session = await currentSession(query, scope)
    const digest = await currentAssetDigest(query, scope, session, assetId)
    return freezeAction({
      actionKind: 'cutout_prepare' as const,
      payload: { schemaVersion: 1 as const, ...scope, assetId, assetDigest: digest, scene, intent },
    })
  }

  if (bound.assetIds.length !== 0 || bound.taskId === undefined || bound.shotIds !== undefined) {
    throw new ReadToolError('invalid_input')
  }
  const intent = parsePlain(cancelIntentSchema, trustedIntent)
  assertIntentScope(intent, scope, bound.taskId)
  const session = await currentSession(query, scope)
  await assertCurrentTask(query, scope, session, bound.taskId)
  return freezeAction({
    actionKind: 'cancel' as const,
    payload: { schemaVersion: 1 as const, ...scope, taskId: bound.taskId, intent },
  })
}

/** 名称兼容调用方语义；两者均只做纯绑定。 */
export const bindGovernedUtilityAction = bindGovernedToolAction
