import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBetaMessage, AgentBetaToolTraceView } from '../../lib/agent-beta/types'
import {
  asPlainDisplayText,
  buildToolTraceView,
  cutoutNeedsExplicitRedo,
  cutoutNeedsVerification,
  toolTraceBusinessLabel,
  visibleToolTrace,
} from './tool-trace-view'

function message(toolTrace?: AgentBetaToolTraceView[], planTrace?: AgentBetaToolTraceView[]): AgentBetaMessage {
  return {
    id: 'message_1',
    role: 'assistant',
    content: '说明',
    createdAt: '2026-09-17T00:00:00.000Z',
    referenceNodeIds: [],
    toolTrace,
    plan: planTrace
      ? {
        id: 'plan_1',
        prompt: '保持服装细节',
        referenceNodeIds: [],
        settings: { model: 'nano-banana-2', imageRatio: '3:4', resolution: '2k' },
        status: 'proposed',
        protocol: 'agent-runtime-v1',
        toolTrace: planTrace,
      }
      : undefined,
  }
}

test('业务名称用中性动作，完成与否只由 status 表达', () => {
  assert.equal(toolTraceBusinessLabel('asset.inspect'), '检查素材')
  assert.equal(toolTraceBusinessLabel('fashion_photo.create'), '准备服饰生图方案')
  assert.equal(toolTraceBusinessLabel('garment.classify'), '服装分类')
  assert.equal(toolTraceBusinessLabel('task.cancel'), '取消任务')
  assert.equal(toolTraceBusinessLabel('cutout.prepare'), '准备服装抠图')
  assert.equal(toolTraceBusinessLabel('vendor.secret.execute'), '创作步骤')
  const cancelled = buildToolTraceView([
    { step: 1, toolName: 'task.cancel', status: 'rejected', reason: 'tool_execution_failed' },
  ])
  assert.equal(cancelled.rows[0]?.label, '取消任务')
  assert.equal(cancelled.rows[0]?.statusLabel, '未通过')
  assert.equal(cancelled.rows[0]?.label.includes('已取消'), false)
})

test('无 plan 的 assistant 消息仍展示 toolTrace，并保持服务器数组顺序', () => {
  const entries: AgentBetaToolTraceView[] = [
    { step: 3, toolName: 'fashion_photo.create', status: 'awaiting_approval', target: 'preview' },
    { step: 1, toolName: 'asset.inspect', status: 'completed', target: 'read_only' },
    { step: 2, toolName: 'session.list_nodes', status: 'completed', target: 'read_only' },
  ]
  const ordered = visibleToolTrace(message(entries))
  assert.deepEqual(ordered.map((entry) => entry.toolName), [
    'fashion_photo.create',
    'asset.inspect',
    'session.list_nodes',
  ])
})

test('同时存在 plan.toolTrace 时不重复拼接 message.toolTrace', () => {
  const planTrace: AgentBetaToolTraceView[] = [
    { step: 1, toolName: 'asset.inspect', status: 'completed', target: 'read_only' },
  ]
  const messageTrace: AgentBetaToolTraceView[] = [
    { step: 1, toolName: 'asset.inspect', status: 'completed', target: 'read_only' },
    { step: 2, toolName: 'garment.classify', status: 'completed', target: 'gateway' },
  ]
  const ordered = visibleToolTrace(message(messageTrace, planTrace))
  assert.equal(ordered.length, 1)
  assert.equal(ordered[0]?.toolName, 'asset.inspect')
})

test('HTML 原因只作纯文本系统说明，待核实默认展开且无重提按钮', () => {
  const view = buildToolTraceView([
    {
      step: 1,
      toolName: 'cutout.prepare',
      status: 'verification_required',
      target: 'gateway',
      reason: '<img src=x onerror=alert(1)>action_verification_required',
    },
  ])
  assert.equal(view.rows[0]?.label, '准备服装抠图')
  assert.equal(view.rows[0]?.statusLabel, '待核实')
  assert.equal(view.rows[0]?.note, '操作结果待核实，不会自动重提')
  assert.equal(view.rows[0]?.note?.includes('<img'), false)
  assert.equal(view.rows[0]?.isInstruction, false)
  assert.equal(view.defaultOpen, true)
  assert.match(view.accessibleName, /待核实/)
  assert.equal(view.showVendorRetry, false)
  assert.equal(view.cutoutNeedsVerification, true)
  assert.equal(view.cutoutNeedsExplicitRedo, false)
  assert.match(view.cutoutHint ?? '', /待核实/)
  assert.equal((view.cutoutHint ?? '').includes('重新'), false)
})

test('无 plan 轨迹：抠图待核实不引导重做，明确拒绝才提示再操作', () => {
  const unknown = visibleToolTrace(message([
    { step: 1, toolName: 'cutout.prepare', status: 'verification_required', target: 'gateway', reason: 'action_verification_required' },
  ]))
  const unknownView = buildToolTraceView(unknown)
  assert.equal(cutoutNeedsVerification(unknown), true)
  assert.equal(cutoutNeedsExplicitRedo(unknown), false)
  assert.equal(unknownView.cutoutNeedsExplicitRedo, false)
  assert.match(unknownView.cutoutHint ?? '', /刷新状态|人工核实/)
  assert.equal((unknownView.cutoutHint ?? '').includes('重新'), false)
  assert.equal(unknownView.showVendorRetry, false)

  const rejected = visibleToolTrace(message([
    { step: 1, toolName: 'cutout.prepare', status: 'rejected', target: 'gateway', reason: 'tool_execution_failed' },
  ]))
  const rejectedView = buildToolTraceView(rejected)
  assert.equal(cutoutNeedsVerification(rejected), false)
  assert.equal(cutoutNeedsExplicitRedo(rejected), true)
  assert.equal(rejectedView.rows[0]?.label, '准备服装抠图')
  assert.equal(rejectedView.rows[0]?.statusLabel, '未通过')
  assert.match(rejectedView.cutoutHint ?? '', /明确重新操作/)
  assert.equal(rejectedView.showVendorRetry, false)
})

test('去掉标记后的文本不再被当成可执行 HTML', () => {
  assert.equal(asPlainDisplayText('<b>立即重试</b>'), '立即重试')
  assert.equal(asPlainDisplayText('<script>execute()</script>'), 'execute()')
  assert.equal(cutoutNeedsExplicitRedo([
    { step: 1, toolName: 'fashion_photo.create', status: 'rejected', reason: 'tool_execution_failed' },
  ]), false)
})
