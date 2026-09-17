import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalize } from '@/lib/agent/contracts'
import { parseAgentPlanOutput } from './plan-adapter'
import {
  parseNonPlanningStageOutput,
  parseToolResultStageOutput,
  parseUnderstandingStageOutput,
  STAGE_OUTPUT_LIMITS,
} from './stage-outputs'

function understanding() {
  return {
    kind: 'understanding' as const,
    content: '需要先核实当前任务状态',
    goal: '保留服饰细节并整理商品图方案',
    constraints: ['保持版型', '不重复提交未知任务'],
    evidenceRefs: ['goal:1', 'task:1'],
    uncertainties: ['任务是否已经创建'],
    questions: ['是否等待状态核实完成？'],
  }
}

function toolResult() {
  return {
    kind: 'tool_result' as const,
    content: '状态查询仍未确认任务是否创建',
    evidenceRefs: ['call:1'],
    uncertainties: ['外部副作用未知'],
    blockers: ['task_status_unknown'],
    next: 'wait' as const,
  }
}

test('understanding 接受直接对象和 JSON 文本并返回相同的脱离副本', () => {
  const input = understanding()
  const direct = parseUnderstandingStageOutput(input)
  const text = parseUnderstandingStageOutput(JSON.stringify(input))
  assert.deepEqual(direct, input)
  assert.deepEqual(text, input)
  assert.equal(canonicalize(direct), canonicalize(text))
  assert.notEqual(direct, input)
  assert.notEqual(direct.constraints, input.constraints)
  input.constraints[0] = '调用者随后修改'
  assert.equal(direct.constraints[0], '保持版型')
  assert.deepEqual(parseNonPlanningStageOutput('understanding', JSON.stringify(understanding())), understanding())
})

test('tool_result 接受四种 next，且直接对象与 JSON 文本结果一致', () => {
  for (const next of ['answer', 'clarify', 'plan', 'wait'] as const) {
    const input = { ...toolResult(), next }
    assert.deepEqual(parseToolResultStageOutput(input), input)
    assert.deepEqual(parseToolResultStageOutput(JSON.stringify(input)), input)
    assert.deepEqual(parseNonPlanningStageOutput('tool_result', input), input)
  }
})

test('严格 schema 拒绝额外字段、CoT、错误 kind、缺字段和错误 next', () => {
  for (const input of [
    { ...understanding(), reasoning: '隐藏思维链' },
    { ...understanding(), chainOfThought: ['第一步', '第二步'] },
    { ...understanding(), kind: 'plan' },
    { ...understanding(), questions: undefined },
    { ...understanding(), constraints: [''] },
  ]) assert.throws(() => parseUnderstandingStageOutput(input), /invalid_understanding_stage_output/)

  for (const input of [
    { ...toolResult(), approval: true },
    { ...toolResult(), cot: '隐藏推理' },
    { ...toolResult(), kind: 'understanding' },
    { ...toolResult(), next: 'execute' },
    { ...toolResult(), blockers: undefined },
  ]) assert.throws(() => parseToolResultStageOutput(input), /invalid_tool_result_stage_output/)
})

test('canonical 门拒绝 getter、隐藏字段、自定义原型、symbol、稀疏数组和 undefined，getter 不执行', () => {
  let executed = false
  const getter = understanding()
  Object.defineProperty(getter, 'content', { enumerable: true, get: () => { executed = true; return '不得执行' } })
  assert.throws(() => parseUnderstandingStageOutput(getter), /invalid_understanding_stage_output/)
  assert.equal(executed, false)

  const hidden = toolResult()
  Object.defineProperty(hidden, 'reasoning', { enumerable: false, value: '隐藏字段' })
  assert.throws(() => parseToolResultStageOutput(hidden), /invalid_tool_result_stage_output/)

  const prototype = Object.assign(Object.create({ privileged: true }), understanding())
  assert.throws(() => parseUnderstandingStageOutput(prototype), /invalid_understanding_stage_output/)

  const symbol = toolResult() as ReturnType<typeof toolResult> & { [key: symbol]: string }
  Object.defineProperty(symbol, Symbol('cot'), { enumerable: true, value: '隐藏推理' })
  assert.throws(() => parseToolResultStageOutput(symbol), /invalid_tool_result_stage_output/)

  const sparse = understanding()
  sparse.questions = new Array(1)
  assert.throws(() => parseUnderstandingStageOutput(sparse), /invalid_understanding_stage_output/)

  assert.throws(() => parseToolResultStageOutput({ ...toolResult(), uncertainties: [undefined] }), /invalid_tool_result_stage_output/)
})

test('字段、列表项、引用和列表数量超过显式上限时拒绝', () => {
  assert.throws(() => parseUnderstandingStageOutput({ ...understanding(), content: '字'.repeat(STAGE_OUTPUT_LIMITS.contentCharacters + 1) }))
  assert.throws(() => parseUnderstandingStageOutput({ ...understanding(), goal: '字'.repeat(STAGE_OUTPUT_LIMITS.goalCharacters + 1) }))
  assert.throws(() => parseUnderstandingStageOutput({ ...understanding(), constraints: ['字'.repeat(STAGE_OUTPUT_LIMITS.listItemCharacters + 1)] }))
  assert.throws(() => parseUnderstandingStageOutput({ ...understanding(), evidenceRefs: ['r'.repeat(STAGE_OUTPUT_LIMITS.evidenceRefCharacters + 1)] }))
  assert.throws(() => parseToolResultStageOutput({ ...toolResult(), blockers: Array.from({ length: STAGE_OUTPUT_LIMITS.listItems + 1 }, (_, index) => `b${index}`) }))
  assert.throws(() => parseToolResultStageOutput({ ...toolResult(), evidenceRefs: ['call:1', 'call:1'] }))
})

test('planning 不进入非 planning schema，仍由 parseAgentPlanOutput/C11 解析', () => {
  const plan = {
    kind: 'clarify', content: '需要补充主图', claims: [], proposedToolCalls: [], blockers: ['missing_asset'],
  }
  assert.throws(() => parseUnderstandingStageOutput(plan), /invalid_understanding_stage_output/)
  assert.throws(() => parseToolResultStageOutput(plan), /invalid_tool_result_stage_output/)
  assert.throws(() => (parseNonPlanningStageOutput as (stage: string, input: unknown) => unknown)('planning', plan),
    /planning_stage_requires_parse_agent_plan_output/)
  const parsed = parseAgentPlanOutput(plan, { format: 'structured_v1' })
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.plan, plan)
})
