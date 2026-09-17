import { z } from 'zod'
import { canonicalize } from '@/lib/agent/contracts'

/** 非 planning 阶段输出的显式资源上限；planning 继续使用 C11 自己的 schema。 */
export const STAGE_OUTPUT_LIMITS = Object.freeze({
  contentCharacters: 8_000,
  goalCharacters: 8_000,
  listItems: 64,
  listItemCharacters: 1_000,
  evidenceRefCharacters: 256,
} as const)

const content = z.string().trim().min(1).max(STAGE_OUTPUT_LIMITS.contentCharacters)
const goal = z.string().trim().min(1).max(STAGE_OUTPUT_LIMITS.goalCharacters)
const listItem = z.string().trim().min(1).max(STAGE_OUTPUT_LIMITS.listItemCharacters)
const evidenceRef = z.string().trim().min(1).max(STAGE_OUTPUT_LIMITS.evidenceRefCharacters)
const list = z.array(listItem).max(STAGE_OUTPUT_LIMITS.listItems)
const evidenceRefs = z.array(evidenceRef).max(STAGE_OUTPUT_LIMITS.listItems)
  .refine((refs) => new Set(refs).size === refs.length)

const understandingStageOutputSchema = z.object({
  kind: z.literal('understanding'),
  content,
  goal,
  constraints: list,
  evidenceRefs,
  uncertainties: list,
  questions: list,
}).strict()

const toolResultStageOutputSchema = z.object({
  kind: z.literal('tool_result'),
  content,
  evidenceRefs,
  uncertainties: list,
  blockers: list,
  next: z.enum(['answer', 'clarify', 'plan', 'wait']),
}).strict()

export type UnderstandingStageOutput = z.infer<typeof understandingStageOutputSchema>
export type ToolResultStageOutput = z.infer<typeof toolResultStageOutputSchema>
export type NonPlanningStageOutput = UnderstandingStageOutput | ToolResultStageOutput
export type NonPlanningStage = NonPlanningStageOutput['kind']

/**
 * JSON 文本先解码；对象先 canonical 再交给 Zod，避免 getter、隐藏字段、
 * 自定义原型、undefined 或其他非 JSON 值在解析期间被执行或静默丢弃。
 */
function parseCanonical<T>(input: unknown, schema: z.ZodType<T>, errorCode: string): T {
  try {
    const decoded: unknown = typeof input === 'string' ? JSON.parse(input) : input
    const plain: unknown = JSON.parse(canonicalize(decoded))
    return schema.parse(plain)
  } catch {
    throw new TypeError(errorCode)
  }
}

export function parseUnderstandingStageOutput(input: unknown): UnderstandingStageOutput {
  return parseCanonical(input, understandingStageOutputSchema, 'invalid_understanding_stage_output')
}

export function parseToolResultStageOutput(input: unknown): ToolResultStageOutput {
  return parseCanonical(input, toolResultStageOutputSchema, 'invalid_tool_result_stage_output')
}

/** 仅分派两个非 planning schema；planning 必须显式调用 parseAgentPlanOutput/C11。 */
export function parseNonPlanningStageOutput(stage: 'understanding', input: unknown): UnderstandingStageOutput
export function parseNonPlanningStageOutput(stage: 'tool_result', input: unknown): ToolResultStageOutput
export function parseNonPlanningStageOutput(stage: NonPlanningStage, input: unknown): NonPlanningStageOutput {
  if (stage === 'understanding') return parseUnderstandingStageOutput(input)
  if (stage === 'tool_result') return parseToolResultStageOutput(input)
  throw new TypeError('planning_stage_requires_parse_agent_plan_output')
}
