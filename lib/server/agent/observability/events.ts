import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@/lib/agent/types'
import { toJsonValue } from '@/lib/agent/contracts'

/** 服务端权威事件；不能添加到客户端 /api/events 的事件白名单。 */
export const AGENT_EVENT_NAMES = Object.freeze([
  'turn.started', 'turn.finished', 'observation.created', 'triage.decided', 'route.decided',
  'plan.proposed', 'plan.approved', 'plan.patched', 'tool.proposed', 'tool.admitted', 'tool.rejected',
  'gate.pre', 'gate.post_submit', 'gate.result_admission', 'task.created', 'task.observed',
  'task.recovered', 'critique.issued', 'stop.reason',
] as const)
export type AgentEventName = typeof AGENT_EVENT_NAMES[number]

/** 身份字段由服务端认证上下文填写；data 不允许覆盖信任边界。 */
export interface AgentEvent {
  schemaVersion: 1
  eventId: string
  userId: string
  sessionId: string
  turnId: string
  name: AgentEventName
  createdAt: string
  data: JsonValue
}

/** 强写端口供安全记录使用；失败由调用方处理，不能冒充已持久化。 */
export interface AgentEventSink {
  appendRequiredEvent(event: AgentEvent): Promise<void>
}

export type AgentEventInput = Pick<AgentEvent, 'userId' | 'sessionId' | 'turnId' | 'name' | 'data'>

/** 普通统计事件尽力写入；Approval/Ledger/请求工件不得使用此吞错入口。 */
export async function recordAgentEvent(sink: AgentEventSink, input: AgentEventInput): Promise<boolean> {
  try {
    await sink.appendRequiredEvent({
      schemaVersion: 1, eventId: randomUUID(), userId: input.userId, sessionId: input.sessionId,
      turnId: input.turnId, name: input.name, createdAt: new Date().toISOString(), data: toJsonValue(input.data),
    })
    return true
  } catch {
    return false
  }
}
