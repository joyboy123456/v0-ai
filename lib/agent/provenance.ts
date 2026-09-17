/** 标签只能由服务端依据真实输入通道绑定，不能信任模型或客户端自报 origin。 */
export type FieldOrigin = 'user_text' | 'user_selection' | 'system_policy'
  | 'model_inference' | 'image_observation' | 'provider_response'

/** 控制平面由机械真值填充；用户选择仍需经过服务端所有权与范围校验。 */
export type GovernedField = 'toolName' | 'prompt' | 'featureType' | 'model' | 'resultCount'
  | 'assetId' | 'assetIds' | 'taskId' | 'shotId' | 'shotIds' | 'imageRatio' | 'resolution'
  | 'creditsCost' | 'idempotencyKey' | 'userId' | 'providerRequestId'

const selection = Object.freeze(['user_selection', 'system_policy'] as const)
const system = Object.freeze(['system_policy'] as const)

/** 准入矩阵本身不可变；费用、身份与幂等键比普通选择项更严格。 */
export const FIELD_ORIGINS: Readonly<Record<GovernedField, readonly FieldOrigin[]>> = Object.freeze({
  toolName: Object.freeze(['model_inference', 'user_selection', 'system_policy'] as const),
  prompt: Object.freeze(['user_text', 'model_inference', 'image_observation', 'system_policy'] as const),
  featureType: selection, model: selection, resultCount: selection,
  assetId: selection, assetIds: selection, taskId: selection, shotId: selection, shotIds: selection,
  imageRatio: selection, resolution: selection,
  creditsCost: system, idempotencyKey: system, userId: system,
  providerRequestId: system,
})

/** Dispatch 的纯准入查询；未知字段、供应商文本一律 fail closed。 */
export function isFieldOriginAllowed(field: string, origin: FieldOrigin): boolean {
  return Object.hasOwn(FIELD_ORIGINS, field)
    && FIELD_ORIGINS[field as GovernedField].includes(origin)
}

/** 仅证明来源准入，不能代替 schema、资产归属或 Gateway 审批。 */
export function assertFieldOrigin(field: string, origin: FieldOrigin): void {
  if (!isFieldOriginAllowed(field, origin)) throw new Error(`provenance_violation: ${field} <- ${origin}`)
}
