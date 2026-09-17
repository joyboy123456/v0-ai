import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_BUDGET, OBSERVATION_TTL_MS, PREVIEW_TTL_MS, UNKNOWN_MANUAL_REVIEW_AFTER_MS } from './budget'
import { assertFieldOrigin, FIELD_ORIGINS, isFieldOriginAllowed, type FieldOrigin } from './provenance'

test('模型与图片观察不能改变控制平面，供应商文本不能进入任何字段', () => {
  for (const field of ['featureType', 'model', 'resultCount', 'assetIds', 'taskId', 'shotIds', 'creditsCost',
    'userId', 'idempotencyKey', 'imageRatio', 'resolution']) {
    for (const origin of ['model_inference', 'image_observation', 'provider_response'] as const) {
      assert.equal(isFieldOriginAllowed(field, origin), false, `${field} <- ${origin}`)
      assert.throws(() => assertFieldOrigin(field, origin), /provenance_violation/)
    }
  }
  for (const field of Object.keys(FIELD_ORIGINS)) assert.equal(isFieldOriginAllowed(field, 'provider_response'), false)
  assert.equal(isFieldOriginAllowed('prompt', 'image_observation'), true)
  assert.equal(isFieldOriginAllowed('toolName', 'model_inference'), true)
  assert.equal(isFieldOriginAllowed('model', 'user_selection'), true)
  assert.equal(isFieldOriginAllowed('featureType', 'system_policy'), true)
  assert.equal(isFieldOriginAllowed('userId', 'user_selection'), false)
  assert.equal(isFieldOriginAllowed('unknown_field', 'system_policy'), false)
  assert.equal(isFieldOriginAllowed('__proto__', 'system_policy'), false)
  assert.equal(isFieldOriginAllowed('prompt', 'made_up' as FieldOrigin), false)
})

test('新 Agent 单任务单张及供应商调用上限不可被调用方提升', () => {
  assert.equal(AGENT_BUDGET.maxPaidTasksPerApproval, 1)
  assert.equal(AGENT_BUDGET.maxResultsPerApproval, 1)
  assert.equal(AGENT_BUDGET.maxClassificationsPerTurn, 2)
  assert.equal(AGENT_BUDGET.maxCutoutPreparationsPerTurn, 1)
  assert.equal(PREVIEW_TTL_MS, 30 * 60_000)
  assert.equal(OBSERVATION_TTL_MS, 24 * 60 * 60_000)
  assert.equal(UNKNOWN_MANUAL_REVIEW_AFTER_MS, 60 * 60_000)
  assert.equal(Object.isFrozen(AGENT_BUDGET), true)
  assert.equal(Object.isFrozen(FIELD_ORIGINS), true)
  for (const origins of Object.values(FIELD_ORIGINS)) assert.equal(Object.isFrozen(origins), true)
})
