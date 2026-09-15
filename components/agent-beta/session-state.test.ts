import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBetaSession } from '../../lib/agent-beta/types'
import { hasRunningTask, toggleNodeSelection, withLocalPositions, nodeDisplaySize } from './session-state'

const session: AgentBetaSession = {
  id: 'session', title: '测试', createdAt: '', updatedAt: '', messages: [],
  nodes: [{ id: 'image', assetId: 'asset', name: '原图', url: '/image.png', width: 100, height: 200, x: 0, y: 0 }],
}

test('任务进度刷新保留尚未保存的位置，同时接收新增结果', () => {
  const refreshed = { ...session, nodes: [...session.nodes, { ...session.nodes[0], id: 'result', taskId: 'task', x: 300 }] }
  const result = withLocalPositions(refreshed, new Map([['image', { id: 'image', x: 90, y: 140 }]]))
  assert.equal(result.nodes[0].x, 90)
  assert.equal(result.nodes[1].taskId, 'task')
  assert.equal(session.nodes[0].x, 0)
})

test('参考图多选维持顺序，取消和单选不会留下旧选择', () => {
  assert.deepEqual(toggleNodeSelection(['a'], 'b', true), ['a', 'b'])
  assert.deepEqual(toggleNodeSelection(['a', 'b'], 'a', true), ['b'])
  assert.deepEqual(toggleNodeSelection(['a', 'b'], 'c', false), ['c'])
})

test('仅 pending 和 running 需要继续轮询', () => {
  for (const status of ['pending', 'running', 'success', 'partial', 'failed', 'cancelled'] as const) {
    const current: AgentBetaSession = { ...session, messages: [{ id: 'msg', role: 'assistant', content: '', createdAt: '', referenceNodeIds: [], plan: { id: 'plan', status: 'submitted', prompt: '', referenceNodeIds: [], settings: { model: 'gpt-image-2', imageRatio: '1:1', resolution: '2k' }, task: { taskId: 'task', status, progress: 0, message: '' } } }] }
    assert.equal(hasRunningTask(current), status === 'pending' || status === 'running')
  }
  assert.equal(hasRunningTask(null), false)
})

test('画布图片限制显示尺寸，不使用原始像素撑开节点', () => {
  assert.deepEqual(nodeDisplaySize({ width: 4000, height: 4000 }), { width: 240, height: 240 })
  assert.ok(nodeDisplaySize({ width: 100, height: 10000 }).height <= 300)
})
