import { z } from 'zod'
import { AGENT_BUDGET, PREVIEW_TTL_MS } from '@/lib/agent/budget'
import {
  approvalDigest, assetDigest, canonicalize, paramsDigest, requestDigest,
  type ActionLedgerEntry, type ActionLedgerRecord, type ApprovalReceipt, type GovernedAction,
} from '@/lib/agent/contracts'
import { SELECTABLE_FASHION_MODELS, type GenerationTask } from '@/lib/types'
import type { GovernedActionPort, GovernedActionResult, PostSubmitPort, QueryPort, SessionQueryRecord, TaskCommandPort, VendorActionPort } from '../ports'
import type { TaskPreparationWithRetryPort } from '../action/task-preparation'
import { FEATURE_PROMPT_TEMPLATE_VERSIONS } from '../action/task-preparation'
import { ActionLedgerStore } from './action-ledger'
import { ApprovalStore, validateVendorResult, type AuthenticatedActionScope } from './approval-store'
import { preparationArtifactKey, type CurrentTaskPreparationArtifactStorePort } from './preparation-artifact-store'

export interface GovernanceGatewayDependencies {
  queries: QueryPort
  commands: TaskCommandPort
  vendors: VendorActionPort
  preparation: TaskPreparationWithRetryPort
  artifacts: CurrentTaskPreparationArtifactStorePort
  approvals: ApprovalStore
  ledger: ActionLedgerStore
  /** TOOL 返回后同步强写证据并核对冻结执行身份。 */
  postSubmit: PostSubmitPort
  /** 身份来自当前已认证请求；不能读取 action 中的 userId 作为登录身份。 */
  authenticate: () => Promise<AuthenticatedActionScope>
  /** 注入 task-store 原始 getIdempotentTaskId，保持历史算法。 */
  getTaskId: (userId: string, key: string) => string
  assertQueueCapacity: () => void | Promise<void>
  isTaskExecutionActive: (taskId: string) => boolean
  /** 必须注入服务端策略；异常、空响应或拒绝均不允许调用。 */
  contentPolicy: (action: GovernedAction) => Promise<{ allowed: boolean; reason?: string }>
  now?: () => Date
}

export class GovernanceGatewayError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'GovernanceGatewayError' }
}
function fail(code: string, message: string): never { throw new GovernanceGatewayError(code, message) }
const text = z.string().min(1).max(256)
const legacyIdentifier = text.regex(/^[a-zA-Z0-9_-]+$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const identity = { schemaVersion: z.literal(1), userId: text, sessionId: legacyIdentifier, messageId: legacyIdentifier }
const scopeSchema = z.object({ userId: text, sessionId: legacyIdentifier, messageId: legacyIdentifier }).strict()
const assetPayload = z.object({ ...identity, assetId: text, assetDigest: hash, intent: z.record(z.unknown()) }).strict()
const actionSchema = z.discriminatedUnion('actionKind', [
  z.object({ actionKind: z.literal('generate'), payload: z.object({ ...identity }).passthrough() }).strict(),
  z.object({ actionKind: z.literal('retry_shots'), payload: z.object({ ...identity }).passthrough() }).strict(),
  z.object({ actionKind: z.literal('classify'), payload: assetPayload }).strict(),
  z.object({ actionKind: z.literal('cutout_prepare'), payload: assetPayload.extend({ scene: z.enum(['garment', 'person', 'product']) }) }).strict(),
  z.object({ actionKind: z.literal('cancel'), payload: z.object({ ...identity, taskId: text, intent: z.record(z.unknown()) }).strict() }).strict(),
])
type PaidAction = Extract<GovernedAction, { actionKind: 'generate' | 'retry_shots' }>
const isPaid = (action: GovernedAction): action is PaidAction => action.actionKind === 'generate' || action.actionKind === 'retry_shots'
const paidRecord = (entry: ActionLedgerRecord) => entry.recordKind === 'legacy'
  || entry.actionKind === 'generate' || entry.actionKind === 'retry_shots'
const active = (task: GenerationTask) => task.status === 'pending' || task.status === 'running'
const dayKey = (date: Date) => new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10)

/** 每个服务端批准/意图绑定唯一调用身份，不能由客户端指定幂等键。 */
export function governedActionKey(action: GovernedAction): string {
  const payload = action.payload
  if (action.actionKind === 'generate') return `agent-beta:${payload.sessionId}:${payload.messageId}`
  if (action.actionKind === 'retry_shots') return `agent-v1:retry:${canonicalize([
    payload.sessionId, payload.messageId, action.payload.taskId, action.payload.attempt,
  ])}`
  return `agent-v1:${canonicalize([payload.sessionId, payload.messageId, action.actionKind, action.payload.intent.intentId])}`
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** PRE 和 TOOL 只接收冻结工件；结果上画布仍须经过后续 C8 准入。 */
export function createGovernanceGateway(dependencies: GovernanceGatewayDependencies): GovernedActionPort {
  const now = dependencies.now ?? (() => new Date())
  function time(): Date {
    const value = now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail('dependency_failure', '时钟无效')
    return value
  }
  function assertIntentFresh(action: Exclude<GovernedAction, PaidAction>): void {
    const verified = Date.parse(action.payload.intent.verifiedAt)
    if (!Number.isFinite(verified) || verified > time().getTime() || time().getTime() - verified >= PREVIEW_TTL_MS) {
      fail('intent_expired', '当前请求意图凭证已失效')
    }
  }

  async function sessionFor(action: GovernedAction): Promise<SessionQueryRecord> {
    const scope = scopeSchema.parse(await dependencies.authenticate())
    const payload = action.payload
    if (scope.userId !== payload.userId || scope.sessionId !== payload.sessionId || scope.messageId !== payload.messageId) {
      fail('identity_mismatch', '动作与当前认证请求不一致')
    }
    const session = await dependencies.queries.getSession(scope.sessionId)
    if (!session || session.userId !== scope.userId || session.sessionId !== scope.sessionId || !Array.isArray(session.nodes)) {
      fail('session_forbidden', '当前会话不存在或不属于用户')
    }
    return session
  }

  async function ownedTask(taskId: string, userId: string, session?: SessionQueryRecord): Promise<GenerationTask> {
    if (session && !session.taskIds?.includes(taskId) && !session.nodes.some((node) => node.taskId === taskId)) {
      fail('task_not_in_session', '任务不是当前会话成员')
    }
    const task = await dependencies.queries.getTask(taskId)
    if (!task || task.taskId !== taskId || task.userId !== userId) fail('task_unavailable', '任务不存在或归属不匹配')
    return task
  }

  async function checkAssets(action: GovernedAction, session: SessionQueryRecord, entries: ActionLedgerRecord[]): Promise<void> {
    if (action.actionKind === 'cancel') { await ownedTask(action.payload.taskId, action.payload.userId, session); return }
    let ids: string[]
    let digests: string[]
    if (action.actionKind === 'generate') { ids = action.payload.inputAssetIds; digests = action.payload.assetDigests }
    else if (action.actionKind === 'retry_shots') {
      const task = await ownedTask(action.payload.taskId, action.payload.userId, session)
      ids = task.inputAssetIds; digests = action.payload.assetDigests
    } else { ids = [action.payload.assetId]; digests = [action.payload.assetDigest] }
    if (!Array.isArray(ids) || !ids.length || ids.length > 10 || new Set(ids).size !== ids.length
      || !Array.isArray(digests) || ids.length !== digests.length) fail('invalid_assets', '参考素材数量或摘要无效')
    for (let index = 0; index < ids.length; index += 1) {
      const nodes = session.nodes.filter((node) => node.assetId === ids[index])
      if (!nodes.length) fail('asset_not_in_session', '素材不是当前会话成员')
      const asset = await dependencies.queries.getAsset(ids[index])
      if (!asset || asset.assetId !== ids[index] || asset.userId !== action.payload.userId
        || !asset.fileUrl || asset.fileUrl.startsWith('data:')) fail('asset_forbidden', '素材不可访问或不属于用户')
      if (await assetDigest(asset) !== digests[index]) fail('asset_changed', '素材摘要已变化')
      const taskIds = [asset.taskId, ...nodes.map((node) => node.taskId)].filter((id): id is string => Boolean(id))
      if (entries.some((entry) => entry.recordKind === 'v1' && 'taskId' in entry && taskIds.includes(entry.taskId)
        && paidRecord(entry) && entry.resultAdmission !== 'ADMITTED')) fail('asset_not_admitted', '原任务结果尚未通过准入')
    }
  }

  async function validateFrozen(action: PaidAction, requireCurrent = false): Promise<void> {
    const preview = action.payload
    const reference = await dependencies.artifacts.get(preparationArtifactKey(preview.userId, preview.proposalId, preview.version))
    if (!reference || reference.kind !== action.actionKind || canonicalize(reference.artifact) !== canonicalize(preview)
      || reference.requestDigest !== await requestDigest(action)) fail('artifact_mismatch', '预览与服务端冻结工件不一致')
    if (requireCurrent) {
      const latest = await dependencies.artifacts.getLatest(preview.userId, preview.proposalId)
      if (!latest || latest.artifact.version !== preview.version) fail('preview_superseded', '预览已有更新版本')
    }
  }

  async function validatePaidPre(action: PaidAction, session: SessionQueryRecord): Promise<void> {
    const preview = action.payload
    if (!Array.isArray(preview.blockers) || preview.blockers.length) fail('preview_blocked', '预览包含未解除的决策阻断')
    if (preview.estimatedResultCount !== AGENT_BUDGET.maxResultsPerApproval) fail('multiple_results_disabled', '每次批准仅允许一张图片')
    if (preview.promptTemplateVersion !== FEATURE_PROMPT_TEMPLATE_VERSIONS[preview.featureType]) {
      fail('template_unavailable', '冻结模板没有当前可执行版本，请重新预览')
    }
    if (action.actionKind === 'generate') await dependencies.preparation.validatePrepared(action.payload)
    else await dependencies.preparation.validateRetry(action.payload)
    if (session.nodes.length >= 50) fail('node_limit', '画布图片已达上限')
    const model = SELECTABLE_FASHION_MODELS.find((item) => item.id === preview.resolvedModelId && item.provider === 'grsai')
    if (!model) fail('model_not_allowed', 'Agent 仅允许已冻结 Grsai 模型')
    const task = action.actionKind === 'retry_shots' ? await ownedTask(action.payload.taskId, preview.userId, session) : undefined
    const params = action.actionKind === 'generate' ? action.payload.normalizedParams : task!.params
    const inputs = action.actionKind === 'generate' ? action.payload.inputAssetIds : task!.inputAssetIds
    if (inputs.length > model.maxInputImages) fail('input_limit', '参考素材超出模型上限')
    if (!params || !('resolution' in params) || !Number.isFinite(Number.parseInt(params.resolution, 10))
      || Number.parseInt(params.resolution, 10) > Number.parseInt(model.maxResolutionLabel, 10)) {
      fail('resolution_limit', '分辨率超出模型上限')
    }
    if (await paramsDigest(preview.featureType, params) !== preview.paramsDigest) fail('params_changed', '冻结参数摘要不一致')
    const created = Date.parse(preview.createdAt); const expires = Date.parse(preview.expiresAt)
    if (!Number.isFinite(created) || expires - created !== PREVIEW_TTL_MS || created > time().getTime() || expires <= time().getTime()) {
      fail('preview_expired', '预览已过期或有效期无效')
    }
  }

  async function checkQuotas(action: GovernedAction, entries: ActionLedgerRecord[]): Promise<void> {
    if (!isPaid(action)) {
      const limit = action.actionKind === 'classify' ? AGENT_BUDGET.maxClassificationsPerTurn
        : action.actionKind === 'cutout_prepare' ? AGENT_BUDGET.maxCutoutPreparationsPerTurn : Infinity
      const used = entries.filter((entry) => entry.recordKind === 'v1' && entry.userId === action.payload.userId
        && entry.sessionId === action.payload.sessionId && entry.messageId === action.payload.messageId
        && entry.actionKind === action.actionKind && entry.sideEffectState !== 'NONE').length
      if (used >= limit) fail('turn_quota', '本轮供应商调用次数已达上限')
      return
    }
    const paid = entries.filter(paidRecord)
    const today = dayKey(time())
    if (paid.filter((entry) => entry.userId === action.payload.userId && entry.sideEffectState !== 'NONE'
      && dayKey(new Date(entry.createdAt)) === today).length >= AGENT_BUDGET.maxPaidApprovalsPerUserPerDay) {
      fail('daily_limit', '今日生成次数已达上限')
    }
    for (const entry of paid) {
      if (entry.sideEffectState === 'NONE') continue
      if (entry.submissionState !== 'SUBMITTED' || !('taskId' in entry)) fail('unresolved_generation', '存在未知调用，请先核实')
      const task = await dependencies.queries.getTask(entry.taskId)
      if (!task || task.taskId !== entry.taskId || task.userId !== entry.userId) fail('unresolved_generation', '原任务事实缺失，请先核实')
      if (active(task) || dependencies.isTaskExecutionActive(task.taskId)) fail('busy', '当前有图片仍在处理')
    }
    await dependencies.assertQueueCapacity()
  }

  async function taskResult(action: GovernedAction, entry: ActionLedgerEntry): Promise<GovernedActionResult> {
    if (!('taskId' in entry)) fail('ledger_conflict', '任务身份缺失')
    const task = await ownedTask(entry.taskId, action.payload.userId)
    if (isPaid(action)) {
      if (task.featureType !== action.payload.featureType || await paramsDigest(task.featureType, task.params) !== action.payload.paramsDigest) {
        fail('task_mismatch', '提交任务参数与批准不一致')
      }
      return { actionKind: action.actionKind, task }
    }
    if (action.actionKind !== 'cancel') fail('ledger_conflict', '动作类型不一致')
    return { actionKind: 'cancel', task, intent: action.payload.intent }
  }

  async function execute(raw: GovernedAction, approval?: ApprovalReceipt): Promise<GovernedActionResult> {
    const action = freeze(actionSchema.parse(JSON.parse(canonicalize(raw))) as unknown as GovernedAction)
    // 先复制请求，再 await；调用方后续修改对象不会改变已验证载荷。
    const receipt = approval === undefined ? undefined : JSON.parse(canonicalize(approval)) as ApprovalReceipt
    await sessionFor(action)
    const key = governedActionKey(action)
    const fullDigest = await requestDigest(action)
    if (isPaid(action)) { await validateFrozen(action); await dependencies.approvals.verifyApproval(action, receipt) }
    else await dependencies.approvals.verifyIntent(action)

    return dependencies.ledger.withEntries(async (entries, save) => {
      // 锁内重查会话和资源；读取与配额决策到 STARTING 强写之间不能被同进程另一调用插队。
      const currentSession = await sessionFor(action)
      const existing = entries.find((entry) => entry.userId === action.payload.userId && entry.key === key)
      if (existing?.recordKind === 'legacy') fail('legacy_protected', '旧执行记录必须走原核实链路')
      if (existing && (existing.requestDigest !== fullDigest || existing.actionKind !== action.actionKind)) {
        fail('idempotency_conflict', '相同调用身份已绑定不同请求')
      }
      if (isPaid(action) && entries.some((entry) => entry.recordKind === 'legacy' && entry.userId === action.payload.userId
        && entry.sessionId === action.payload.sessionId && entry.messageId === action.payload.messageId)) {
        fail('legacy_protected', '当前消息已有旧调用证据，不能重新提交')
      }
      await checkAssets(action, currentSession, entries)
      if (existing) {
        if (existing.submissionState !== 'SUBMITTED' || existing.sideEffectState !== 'CONFIRMED') {
          // UNKNOWN/STARTING 不自动重提；即使未取得任务也不能推断从未调用。
          fail('action_unknown', '原动作状态待核实，不得重复提交')
        }
        if (existing.gateOutcome === 'BLOCKED_POST_SUBMIT' || existing.gateOutcome === 'BLOCKED_RESULT') {
          fail('result_quarantined', '原调用已发生，结果仍被隔离')
        }
        if (action.actionKind === 'classify' || action.actionKind === 'cutout_prepare') {
          const result = await dependencies.approvals.getVendorResult(action.payload.userId, key, fullDigest)
          if (!result || result.actionKind !== action.actionKind) fail('action_unknown', '原供应商返回证据缺失，不得重提')
          return result
        }
        return taskResult(action, existing)
      }

      if (isPaid(action)) {
        await validateFrozen(action, true)
        await validatePaidPre(action, currentSession)
        const approvalHash = await approvalDigest(receipt!)
        if (entries.some((entry) => entry.recordKind === 'v1' && entry.approvalDigest === approvalHash)) {
          fail('approval_used', '本次批准已有调用身份')
        }
      } else {
        if (action.actionKind === 'cutout_prepare' && action.payload.scene !== 'garment') {
          fail('cutout_scene_unavailable', '当前仅支持服装抠图')
        }
        assertIntentFresh(action)
      }
      await checkQuotas(action, entries)
      const policy = z.object({ allowed: z.boolean(), reason: z.string().optional() }).strict().parse(await dependencies.contentPolicy(action))
      if (!policy.allowed) fail('content_blocked', policy.reason ?? '内容策略未通过')
      // hook 可能等待外部状态；强写前重新核实当前授权、成员、摘要和预览版本。
      const finalSession = await sessionFor(action)
      await checkAssets(action, finalSession, entries)
      if (isPaid(action)) { await validateFrozen(action, true); await validatePaidPre(action, finalSession) }
      const stamp = time().toISOString()
      const common = {
        schemaVersion: 1 as const, recordKind: 'v1' as const, key,
        userId: action.payload.userId, sessionId: action.payload.sessionId, messageId: action.payload.messageId,
        toolName: isPaid(action) ? action.payload.toolName : action.actionKind === 'classify' ? 'garment.classify'
          : action.actionKind === 'cutout_prepare' ? 'cutout.prepare' : 'task.cancel',
        requestDigest: fullDigest, assetDigests: isPaid(action) ? [...action.payload.assetDigests]
          : action.actionKind === 'cancel' ? [] : [action.payload.assetDigest], providerRequestIds: [],
        submissionState: 'STARTING' as const, sideEffectState: 'POSSIBLE' as const, gateOutcome: 'PASSED_PRE' as const,
        resultAdmission: isPaid(action) ? 'PENDING' as const : 'NOT_APPLICABLE' as const,
        evidenceRefs: [], createdAt: stamp, updatedAt: stamp,
      }
      const entry: ActionLedgerEntry = isPaid(action) ? {
        ...common, actionKind: action.actionKind, approvalEvidence: 'receipt', approvalDigest: await approvalDigest(receipt!),
        proposalId: action.payload.proposalId, previewVersion: action.payload.version, featureType: action.payload.featureType,
        taskId: action.actionKind === 'generate' ? dependencies.getTaskId(action.payload.userId, key) : action.payload.taskId,
      } : action.actionKind === 'cancel' ? {
        ...common, actionKind: 'cancel', approvalEvidence: 'explicit_user_intent', approvalDigest: null,
        intentId: action.payload.intent.intentId, taskId: action.payload.taskId,
      } : {
        ...common, actionKind: action.actionKind, approvalEvidence: 'explicit_user_intent', approvalDigest: null,
        intentId: action.payload.intent.intentId, assetId: action.payload.assetId,
      }
      if (isPaid(action)) {
        // 版本保存与 STARTING 强写共用工件锁，确定本次接受的线性化点。
        // STARTING 落账以后产生的新编辑不能撤销已经接受的调用。
        await dependencies.artifacts.withCurrent({ userId: action.payload.userId, proposalId: action.payload.proposalId,
          version: action.payload.version, requestDigest: fullDigest }, async () => { entries.push(entry); await save() })
      } else {
        assertIntentFresh(action)
        entries.push(entry)
        await save()
      }
      let postSubmitBlocked = false
      let paidTaskReturned = false
      try {
        let result: GovernedActionResult
        if (action.actionKind === 'classify' || action.actionKind === 'cutout_prepare') {
          result = validateVendorResult(action.actionKind === 'classify'
            ? { actionKind: 'classify', result: await dependencies.vendors.classify(action.payload) }
            : { actionKind: 'cutout_prepare', result: await dependencies.vendors.prepareCutout(action.payload) })
          if (result.actionKind === 'classify' && result.result.assetId !== action.payload.assetId) fail('vendor_result_mismatch', '分类返回了其他素材')
          await dependencies.approvals.saveVendorResult(action.payload.userId, key, fullDigest, result)
          entry.evidenceRefs = [`vendor-result:${key}`]
        } else {
          const task = action.actionKind === 'generate' ? await dependencies.commands.createPreparedTask(action.payload, key)
            : action.actionKind === 'retry_shots' ? await dependencies.commands.retryPreparedShots(action.payload, key)
              : await dependencies.commands.cancelTask(action.payload.taskId, action.payload.userId)
          if (isPaid(action)) {
            paidTaskReturned = true
            if (!('taskId' in entry) || entry.approvalDigest === null) fail('ledger_conflict', '付费任务账本身份缺失')
            const post = await dependencies.postSubmit.postSubmit({
              action,
              key,
              expectedTaskId: entry.taskId,
              approvalDigest: entry.approvalDigest,
              task,
            })
            entry.evidenceRefs = [...new Set([...entry.evidenceRefs, post.evidenceRef])]
            if (post.outcome !== 'accepted' || !post.confirmedTask || !post.taskStatus) {
              entry.submissionState = 'UNKNOWN'
              entry.sideEffectState = 'POSSIBLE'
              entry.gateOutcome = 'BLOCKED_POST_SUBMIT'
              entry.resultAdmission = 'QUARANTINED'
              delete entry.taskStatus
              entry.updatedAt = time().toISOString()
              await save()
              postSubmitBlocked = true
              fail('task_mismatch', `提交后任务与批准不一致：${post.reasonCodes.join(',') || 'post_submit_unverifiable'}`)
            }
            entry.taskStatus = post.taskStatus
            entry.evidenceRefs = [...new Set([...entry.evidenceRefs, `task:${task.taskId}`])]
            result = { actionKind: action.actionKind, task }
          } else {
            if (!('taskId' in entry) || task.taskId !== entry.taskId || task.userId !== action.payload.userId) {
              fail('task_mismatch', '返回任务身份与冻结身份不一致')
            }
            entry.taskStatus = z.enum(['pending', 'running', 'success', 'partial', 'failed', 'cancelled']).parse(task.status)
            entry.evidenceRefs = [`task:${task.taskId}`]
            result = { actionKind: 'cancel', task, intent: action.payload.intent }
          }
        }
        entry.submissionState = 'SUBMITTED'; entry.sideEffectState = 'CONFIRMED'; entry.updatedAt = time().toISOString()
        await save()
        return result
      } catch (error) {
        // 已强写的 post-submit 隔离不能被通用 UNKNOWN 分支覆盖。
        if (postSubmitBlocked) throw error
        // 调用后的任何异常都保留债务；重试/取消不能用“旧任务仍存在”证明本次调用成功。
        entry.submissionState = 'UNKNOWN'; entry.sideEffectState = 'POSSIBLE'; entry.updatedAt = time().toISOString()
        delete entry.taskStatus
        if ((paidTaskReturned && isPaid(action))
          || (error instanceof GovernanceGatewayError && ['task_mismatch', 'vendor_result_mismatch'].includes(error.code))) {
          entry.gateOutcome = 'BLOCKED_POST_SUBMIT'
          if (isPaid(action)) entry.resultAdmission = 'QUARANTINED'
        }
        await save()
        throw error
      }
    })
  }
  return Object.freeze({ execute })
}
