import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBetaPlan, AgentBetaSession } from '../../lib/agent-beta/types'
import {
  hasRunningTask,
  manualSessionRefresh,
  nodeDisplaySize,
  sessionPollAction,
  toggleNodeSelection,
  withLocalPositions,
} from './session-state'

const session: AgentBetaSession = {
  id: 'session', title: '测试', createdAt: '', updatedAt: '', messages: [],
  nodes: [{ id: 'image', assetId: 'asset', name: '原图', url: '/image.png', width: 100, height: 200, x: 0, y: 0 }],
}

function withPlan(plan: AgentBetaPlan): AgentBetaSession {
  return {
    ...session,
    messages: [{
      id: 'msg', role: 'assistant', content: '', createdAt: '', referenceNodeIds: [], plan,
    }],
  }
}

function plan(overrides: Partial<AgentBetaPlan> = {}): AgentBetaPlan {
  return {
    id: 'plan',
    status: 'submitted',
    protocol: 'agent-runtime-v1',
    prompt: '保持服装细节',
    referenceNodeIds: [],
    settings: { model: 'nano-banana-2', imageRatio: '1:1', resolution: '2k' },
    ...overrides,
  }
}

test('旧 GET 快照不能覆盖本地坐标，同时仍接收新增结果', () => {
  const refreshed = {
    ...session,
    nodes: [...session.nodes, { ...session.nodes[0], id: 'result', taskId: 'task', x: 300 }],
  }
  const result = withLocalPositions(refreshed, new Map([['image', { id: 'image', x: 90, y: 140 }]]))
  assert.equal(result.nodes[0].x, 90)
  assert.equal(result.nodes[0].y, 140)
  assert.equal(result.nodes[1].taskId, 'task')
  assert.equal(result.nodes[1].x, 300)
  assert.equal(session.nodes[0].x, 0)
})

test('参考图多选维持顺序，取消和单选不会留下旧选择', () => {
  assert.deepEqual(toggleNodeSelection(['a'], 'b', true), ['a', 'b'])
  assert.deepEqual(toggleNodeSelection(['a', 'b'], 'a', true), ['b'])
  assert.deepEqual(toggleNodeSelection(['a', 'b'], 'c', false), ['c'])
})

test('任务运行及结果 pending/verifying 只产生 refresh 判定', () => {
  const pendingTask = withPlan(plan({
    task: { taskId: 'task', status: 'pending', progress: 0, message: '' },
    resultAdmission: { state: 'not_submitted' },
  }))
  const runningTask = withPlan(plan({
    task: { taskId: 'task', status: 'running', progress: 50, message: '' },
    resultAdmission: { state: 'pending' },
  }))
  const pendingAdmission = withPlan(plan({
    task: { taskId: 'task', status: 'success', progress: 100, message: '' },
    resultAdmission: { state: 'pending' },
  }))
  const verifyingAdmission = withPlan(plan({
    task: { taskId: 'task', status: 'success', progress: 100, message: '' },
    resultAdmission: { state: 'verifying' },
  }))

  const actions: unknown[] = [pendingTask, runningTask, pendingAdmission, verifyingAdmission]
    .map((value) => sessionPollAction(value))
  assert.deepEqual(actions, ['refresh', 'refresh', 'refresh', 'refresh'])
  assert.equal(actions.includes('execute'), false)
  assert.equal(hasRunningTask(verifyingAdmission), false, '结果核验刷新不应伪装成运行任务')
})

test('终态准入、隔离及空会话保持 idle，不会自动提交', () => {
  const admitted = withPlan(plan({
    task: { taskId: 'task', status: 'success', progress: 100, message: '' },
    resultAdmission: { state: 'admitted' },
  }))
  const quarantined = withPlan(plan({
    task: { taskId: 'task', status: 'success', progress: 100, message: '' },
    resultAdmission: { state: 'quarantined' },
  }))
  const actions: unknown[] = [sessionPollAction(admitted), sessionPollAction(quarantined), sessionPollAction(null)]
  assert.deepEqual(actions, ['idle', 'idle', 'idle'])
  assert.equal(actions.includes('execute'), false)
})

test('旧任务 helper 仍仅把 pending/running 视为运行中', () => {
  for (const status of ['pending', 'running', 'success', 'partial', 'failed', 'cancelled'] as const) {
    const current = withPlan(plan({
      protocol: 'legacy',
      task: { taskId: 'task', status, progress: 0, message: '' },
    }))
    assert.equal(hasRunningTask(current), status === 'pending' || status === 'running')
  }
  assert.equal(hasRunningTask(null), false)
})

test('手动刷新只封装安全 GET，不含 execute 或 retry', () => {
  const spec = manualSessionRefresh('session/with space')
  assert.equal(spec.method, 'GET')
  assert.equal(spec.path, '/api/beta/agent/sessions/session%2Fwith%20space')
  assert.equal(spec.path.includes('/execute'), false)
  assert.equal(spec.path.includes('/retry'), false)
})

test('画布图片限制显示尺寸，不使用原始像素撑开节点', () => {
  assert.deepEqual(nodeDisplaySize({ width: 4000, height: 4000 }), { width: 240, height: 240 })
  assert.ok(nodeDisplaySize({ width: 100, height: 10000 }).height <= 300)
})
