import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_FASHION_MODEL } from '@/lib/types'
import { isAgentRuntimeV1Enabled } from './v1-service'
import {
  AgentBetaError,
  executeInputSchema,
  messageInputSchema,
  parseInput,
  repreviewInputSchema,
} from './validation'

const hash = 'a'.repeat(64)
const message = {
  clientMessageId: 'client_1',
  text: '生成一张服装图',
  referenceNodeIds: ['node_1'],
  settings: { model: DEFAULT_FASHION_MODEL, imageRatio: '3:4', resolution: '2k' },
}

function rejected(schema: Parameters<typeof parseInput>[0], value: unknown): void {
  assert.throws(() => parseInput(schema, value), (error: unknown) =>
    error instanceof AgentBetaError && error.code === 'AGENT_BETA_INVALID_REQUEST')
}

test('AGENT_RUNTIME_V1_ENABLED 默认关闭且只接受显式 true', () => {
  assert.equal(isAgentRuntimeV1Enabled({}), false)
  assert.equal(isAgentRuntimeV1Enabled({ AGENT_RUNTIME_V1_ENABLED: 'false' }), false)
  assert.equal(isAgentRuntimeV1Enabled({ AGENT_RUNTIME_V1_ENABLED: '1' }), false)
  assert.equal(isAgentRuntimeV1Enabled({ AGENT_RUNTIME_V1_ENABLED: 'true' }), true)
})

test('消息 HTTP schema 只接受正常业务输入，拒绝身份/状态/预算/origin 注入', () => {
  assert.deepEqual(parseInput(messageInputSchema, message), message)
  for (const injected of [
    { userId: 'user_2' },
    { approval: true },
    { status: 'passed' },
    { budget: { maxModelCalls: 999 } },
    { origin: 'system_policy' },
    { intent: { actionKind: 'generate' } },
  ]) rejected(messageInputSchema, { ...message, ...injected })
})

test('execute 严格区分 legacy 与 v1，v1 不接受 prompt/receipt/status', () => {
  const legacy = { messageId: 'message_1', prompt: '旧版可编辑提示词' }
  const v1 = { messageId: 'message_1', proposalId: 'proposal_1', previewVersion: 2, previewDigest: hash }
  assert.deepEqual(parseInput(executeInputSchema, legacy), legacy)
  assert.deepEqual(parseInput(executeInputSchema, v1), v1)
  rejected(executeInputSchema, { ...v1, prompt: '试图编辑并提交' })
  rejected(executeInputSchema, { ...v1, approvalReceipt: { approved: true } })
  rejected(executeInputSchema, { ...v1, userId: 'user_2' })
  rejected(executeInputSchema, { ...v1, status: 'ADMITTED' })
  rejected(executeInputSchema, { ...v1, previewVersion: 0 })
  rejected(executeInputSchema, { ...v1, previewDigest: 'not-a-digest' })
})

test('repreview 只接受旧版本 identity 与新 prompt，不接受执行或授权控制字段', () => {
  const value = {
    messageId: 'message_1', proposalId: 'proposal_1', previewVersion: 1,
    previewDigest: hash, prompt: '新版要求',
  }
  assert.deepEqual(parseInput(repreviewInputSchema, value), value)
  for (const injected of [
    { execute: true }, { approved: true }, { userId: 'user_2' },
    { requestDigest: hash }, { normalizedParams: {} }, { origin: 'user_selection' },
  ]) rejected(repreviewInputSchema, { ...value, ...injected })
})
