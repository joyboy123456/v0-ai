import { canonicalize } from '@/lib/agent/contracts'
import type { AgentPlanDraft } from '@/lib/agent/types'
import { plannerOutputSchema } from '@/lib/server/agent-beta/validation'
import { parseAgentPlanDraft } from './validators'

export const PLAN_ADAPTER_VERSION = 'agent-plan-adapter-v1'
export interface PlanAdapterTelemetry {
  event: 'agent_plan_legacy_adapter'
  adapterVersion: typeof PLAN_ADAPTER_VERSION
  sourceSchema: 'legacy_v0'
  outcome: 'adapted' | 'rejected'
  reason: 'explicit_legacy' | 'invalid_legacy' | 'missing_bound_tool'
}
export type PlanAdapterResult =
  | { ok: true; plan: AgentPlanDraft; telemetry: PlanAdapterTelemetry | null }
  | { ok: false; error: 'invalid_structured_plan' | 'invalid_legacy_plan' | 'missing_bound_tool'; telemetry: PlanAdapterTelemetry | null }

/** 旧入口只有单张服装大片；工具名由服务端选择，不能从模型文案推断功能。 */
export interface PlanAdapterOptions {
  format: 'structured_v1' | 'legacy_v0'
  legacyToolName?: 'fashion_photo.create'
}

/** 返回必需 telemetry 供 A2/C9 记录；无 I/O，不从新 schema 解析失败静默回退。 */
export function parseAgentPlanOutput(input: unknown, options: PlanAdapterOptions): PlanAdapterResult {
  if (options.format === 'structured_v1') {
    try { return { ok: true, plan: parseAgentPlanDraft(input), telemetry: null } }
    catch { return { ok: false, error: 'invalid_structured_plan', telemetry: null } }
  }
  if (options.format !== 'legacy_v0') return { ok: false, error: 'invalid_structured_plan', telemetry: null }
  const telemetry = (outcome: PlanAdapterTelemetry['outcome'], reason: PlanAdapterTelemetry['reason']): PlanAdapterTelemetry => ({
    event: 'agent_plan_legacy_adapter', adapterVersion: PLAN_ADAPTER_VERSION, sourceSchema: 'legacy_v0', outcome, reason,
  })
  try {
    const legacy = plannerOutputSchema.parse(JSON.parse(canonicalize(input)))
    if (legacy.kind === 'plan' && options.legacyToolName !== 'fashion_photo.create') return {
      ok: false, error: 'missing_bound_tool', telemetry: telemetry('rejected', 'missing_bound_tool'),
    }
    return {
      ok: true,
      plan: {
        kind: legacy.kind, content: legacy.content, claims: [],
        proposedToolCalls: legacy.kind === 'plan' ? [{ tool: options.legacyToolName!, args: { prompt: legacy.prompt! }, dryRun: true }] : [],
        blockers: ['legacy_plan_requires_revalidation'],
      },
      telemetry: telemetry('adapted', 'explicit_legacy'),
    }
  } catch {
    return { ok: false, error: 'invalid_legacy_plan', telemetry: telemetry('rejected', 'invalid_legacy') }
  }
}
