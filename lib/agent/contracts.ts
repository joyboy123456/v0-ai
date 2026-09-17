import type { AssetRecord, CutoutScene, FeatureType, TaskParams, TaskStatus } from '@/lib/types'
import type { JsonValue } from './types'

/** 服务端准备并持久化；客户端只读展示，不得提交 normalizedParams 覆盖此工件。 */
export interface PreviewArtifact {
  schemaVersion: 1
  proposalId: string
  version: number
  userId: string
  sessionId: string
  messageId: string
  toolName: string
  featureType: FeatureType
  normalizedParams: TaskParams
  inputAssetIds: string[]
  assetDigests: string[]
  paramsDigest: string
  policyVersion: string
  estimatedResultCount: number
  normalizationSeed: string
  resolvedModelId?: string
  promptTemplateVersion?: string
  blockers: string[]
  riskNotices: string[]
  createdAt: string
  expiresAt: string
}

/** 服务端从原任务构建重试预览；原任务参数摘要、重试镜头和轮次均冻结。 */
export interface RetryPreviewArtifact extends Omit<PreviewArtifact, 'normalizedParams' | 'normalizationSeed' | 'inputAssetIds'> {
  taskId: string
  shotIds: string[]
  attempt: number
}

/** 仅在验证人工确认后由服务端签发；模型不持有写入权。 */
export interface ApprovalReceipt {
  schemaVersion: 1
  approvalId: string
  userId: string
  proposalId: string
  previewVersion: number
  paramsDigest: string
  assetDigests: string[]
  requestDigest: string
  approvedAt: string
}

/** HTTP 身份认证与意图绑定后的证据；不是模型可设置的 consent 布尔值。 */
export interface UserIntentReceipt {
  schemaVersion: 1
  intentId: string
  userId: string
  sessionId: string
  messageId: string
  actionKind: 'classify' | 'cutout_prepare' | 'cancel'
  targetId: string
  verifiedAt: string
}

/** 服务端绑定资产与当前请求；分类仍要经 Gateway 配额。 */
export interface ClassifyPayload {
  schemaVersion: 1
  userId: string
  sessionId: string
  messageId: string
  assetId: string
  assetDigest: string
  intent: UserIntentReceipt
}

/** 服务端绑定抠图输入，不将供应商会话伪装成生图任务。 */
export interface CutoutPreparePayload extends ClassifyPayload {
  scene: CutoutScene
}

/** 取消仅作用于明确选定的原任务；不能表示供应商已撤销。 */
export interface CancelPayload {
  schemaVersion: 1
  userId: string
  sessionId: string
  messageId: string
  taskId: string
  intent: UserIntentReceipt
}

/** Gateway 的动作联合；真实执行只消费服务端冻结载荷。 */
export type GovernedAction =
  | { actionKind: 'generate'; payload: PreviewArtifact }
  | { actionKind: 'classify'; payload: ClassifyPayload }
  | { actionKind: 'cutout_prepare'; payload: CutoutPreparePayload }
  | { actionKind: 'cancel'; payload: CancelPayload }
  | { actionKind: 'retry_shots'; payload: RetryPreviewArtifact }

/** 三个事实轴及结果准入均由服务端证据驱动；SUBMITTED 不代表任务成功。 */
export type SubmissionState = 'NOT_STARTED' | 'STARTING' | 'SUBMITTED' | 'UNKNOWN' | 'VERIFYING'
export type GateOutcome = 'NOT_RUN' | 'PASSED_PRE' | 'BLOCKED_PRE' | 'BLOCKED_POST_SUBMIT' | 'BLOCKED_RESULT'
export type SideEffectState = 'NONE' | 'POSSIBLE' | 'CONFIRMED'
export type ResultAdmission = 'NOT_APPLICABLE' | 'PENDING' | 'ADMITTED' | 'QUARANTINED'

/** 账本可核实的状态；taskStatus 只复制真实任务值。 */
export interface LedgerFacts {
  submissionState: SubmissionState
  taskStatus?: TaskStatus
  gateOutcome: GateOutcome
  sideEffectState: SideEffectState
  resultAdmission: ResultAdmission
  evidenceRefs: string[]
  updatedAt: string
}

/** 历史原字段逐项保留；迁移不可补造不存在的历史批准。 */
export interface LegacyLedgerEntry extends LedgerFacts {
  schemaVersion: 1
  recordKind: 'legacy'
  approvalEvidence: 'unavailable'
  key: string
  userId: string
  sessionId: string
  messageId: string
  prompt: string
  taskId: string
  createdAt: string
  submitted?: boolean
}

/** v1 安全账的公共字段，由治理层强持久化。 */
interface V1LedgerBase extends LedgerFacts {
  schemaVersion: 1
  recordKind: 'v1'
  key: string
  userId: string
  sessionId: string
  messageId: string
  toolName: string
  requestDigest: string
  assetDigests: string[]
  providerRequestIds: string[]
  createdAt: string
}

/** 生成与重试必须有审批摘要；非生成动作保持自己的身份与输出形状。 */
export type ActionLedgerEntry = V1LedgerBase & (
  | {
    actionKind: 'generate' | 'retry_shots'
    approvalEvidence: 'receipt'
    approvalDigest: string
    proposalId: string
    previewVersion: number
    featureType: FeatureType
    taskId: string
  }
  | {
    actionKind: 'classify' | 'cutout_prepare'
    approvalEvidence: 'explicit_user_intent'
    approvalDigest: null
    intentId: string
    assetId: string
  }
  | {
    actionKind: 'cancel'
    approvalEvidence: 'explicit_user_intent'
    approvalDigest: null
    intentId: string
    taskId: string
  }
)

/** 仓储必须保留未知分支外的另一种记录，不得将 v1 条目交给旧执行路径。 */
export type ActionLedgerRecord = LegacyLedgerEntry | ActionLedgerEntry
export interface ActionLedgerFile {
  schemaVersion: 1
  entries: ActionLedgerRecord[]
}

function dataKeys(value: object, array: boolean): string[] {
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('canonical: only plain objects and arrays are supported')
  }
  const keys = Reflect.ownKeys(value)
  const result: string[] = []
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError('canonical: symbol keys are not supported')
    if (array && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('canonical: hidden properties and accessors are not supported')
    }
    result.push(key)
  }
  return result
}

/** 严格 JSON canonical；不执行 getter/toJSON，不忽略 undefined 或数组空洞。 */
export function canonicalize(value: unknown): string {
  const ancestors = new Set<object>()
  function encode(current: unknown): string {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current)
    if (typeof current === 'number' && Number.isFinite(current)) return JSON.stringify(current)
    if (typeof current !== 'object' || current === null) throw new TypeError('canonical: unsupported JSON value')
    if (ancestors.has(current)) throw new TypeError('canonical: cyclic value')
    ancestors.add(current)
    try {
      const array = Array.isArray(current)
      const keys = dataKeys(current, array)
      if (array) {
        if (keys.length !== current.length || keys.some((key, index) => key !== String(index))) {
          throw new TypeError('canonical: sparse arrays and extra array properties are not supported')
        }
        return `[${keys.map((key) => encode(Object.getOwnPropertyDescriptor(current, key)!.value)).join(',')}]`
      }
      return `{${keys.sort().map((key) => `${JSON.stringify(key)}:${encode(Object.getOwnPropertyDescriptor(current, key)!.value)}`).join(',')}}`
    } finally {
      ancestors.delete(current)
    }
  }
  return encode(value)
}

/** 所有摘要输入必须带显式 schemaVersion；Web Crypto 可同时用于 Node 与浏览器。 */
export async function digest(value: unknown): Promise<string> {
  const serialized = canonicalize(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !Object.hasOwn(value, 'schemaVersion')
    || !Number.isSafeInteger((value as { schemaVersion: unknown }).schemaVersion)
    || ((value as { schemaVersion: number }).schemaVersion) < 1) {
    throw new TypeError('digest: positive schemaVersion is required')
  }
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 只对明确声明为可选的字段补 null；其他非法值交给 canonical 拒绝。 */
function optionalPayload(value: object, optionalKeys: readonly string[]): Record<string, unknown> {
  const keys = dataKeys(value, false)
  const output: Record<string, unknown> = Object.create(null)
  for (const key of keys) output[key] = Object.getOwnPropertyDescriptor(value, key)!.value
  for (const key of optionalKeys) if (!Object.hasOwn(output, key) || output[key] === undefined) output[key] = null
  return output
}

const photoOptional = ['childrensCategory', 'hasSideDetail', 'frontDetailCount', 'sideDetailCount', 'backDetailCount',
  'pantsMainHandVisibility', 'pantsPoseDrawSeed', 'plannerReasoningEnabled', 'referenceAssetKey', 'faceIdModelId', 'faceMaskAssetId']
const shotOptional = ['pantsPoseCardId', 'pantsMainHandVisibility', 'pantsPlannerView', 'pantsPlannerAngle',
  'pantsPlannerSelfCheck', 'pantsMayRevealHandsWhenMainHidden']
const previewOptional = ['resolvedModelId', 'promptTemplateVersion']

/** 对 TaskParams 已声明的可选字段补 null，保持缺失与显式 undefined 语义一致。 */
export function paramsDigestPayload(featureType: FeatureType, normalizedParams: TaskParams): object {
  const optional = featureType === 'photo-fission' ? photoOptional
    : featureType === 'pose-fission' ? ['hasFrontDetail', 'hasBackDetail', 'lowerBodyMainArmVisibility']
      : featureType === 'garment-detail' ? previewOptional : []
  const payload = optionalPayload(normalizedParams, optional)
  if (featureType === 'photo-fission' && Array.isArray(payload.shotPlan)) {
    // 先验证数组形状；不能用 map 悄悄忽略空洞或带行为的数组。
    const keys = dataKeys(payload.shotPlan, true)
    if (keys.length !== payload.shotPlan.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError('canonical: sparse shotPlan or extra array properties')
    }
    payload.shotPlan = payload.shotPlan.map((shot) => optionalPayload(shot, shotOptional))
  }
  return { schemaVersion: 1, featureType, normalizedParams: payload }
}

export async function paramsDigest(featureType: FeatureType, normalizedParams: TaskParams): Promise<string> {
  return digest(paramsDigestPayload(featureType, normalizedParams))
}

/** 完整冻结载荷参与摘要，防止模型/策略/有效期等游离在审批之外。 */
export function requestDigestPayload(action: GovernedAction): object {
  dataKeys(action, false)
  let payload: object = action.payload
  if (action.actionKind === 'generate') {
    const preview = optionalPayload(action.payload, previewOptional)
    preview.normalizedParams = (paramsDigestPayload(action.payload.featureType, action.payload.normalizedParams) as { normalizedParams: unknown }).normalizedParams
    payload = preview
  } else if (action.actionKind === 'retry_shots') {
    payload = optionalPayload(action.payload, previewOptional)
  }
  return { schemaVersion: 1, actionKind: action.actionKind, payload }
}

export async function requestDigest(action: GovernedAction): Promise<string> {
  return digest(requestDigestPayload(action))
}

export async function approvalDigest(receipt: ApprovalReceipt): Promise<string> {
  return digest(receipt)
}

/** 资产摘要不含可轮换 fileUrl；调用方仍必须重查所有权和存在性。 */
export async function assetDigest(asset: Pick<AssetRecord, 'assetId' | 'userId' | 'createdAt' | 'width' | 'height' | 'taskId'>): Promise<string> {
  // 先检查描述符，避免从带 getter 的输入提取字段时产生隐藏行为。
  dataKeys(asset, false)
  return digest({ schemaVersion: 1, assetId: asset.assetId, userId: asset.userId, createdAt: asset.createdAt,
    width: asset.width, height: asset.height, taskId: asset.taskId ?? null })
}

/** 请求工件只接受严格 JSON；供事件层复用验证与复制，不做 I/O。 */
export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalize(value)) as JsonValue
}
