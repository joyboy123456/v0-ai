/**
 * 轻量结构化日志（JSON-line），用于 Google 生图链路稳定性观测。
 *
 * 规则：
 * - 输出到 stdout（成功/重试） 或 stderr（失败），便于 docker/k8s 标准捕获
 * - 字段固定：lvl / evt / ts / traceId / taskId / shotId / attempt + 业务 payload
 * - 不引入额外依赖（pino/winston 太重，本期不需要）
 */

export type ImageEventName =
  | 'gimg.attempt'
  | 'gimg.success'
  | 'gimg.fail'
  | 'gimg.retry'
  | 'gimg.throttle'
  | 'pool.dispatch'
  | 'pool.failover'
  | 'pool.circuit'

export interface LogContext {
  traceId: string
  taskId: string
  shotId?: string
  attempt?: number
}

const eventLevel: Record<ImageEventName, 'info' | 'warn' | 'error'> = {
  'gimg.attempt': 'info',
  'gimg.success': 'info',
  'gimg.fail': 'error',
  'gimg.retry': 'warn',
  'gimg.throttle': 'info',
  'pool.dispatch': 'info',
  'pool.failover': 'warn',
  'pool.circuit': 'error',
}

export function logImageEvent(
  evt: ImageEventName,
  ctx: LogContext,
  payload: Record<string, unknown> = {},
): void {
  const lvl = eventLevel[evt]
  const line = JSON.stringify({
    lvl,
    evt,
    ts: new Date().toISOString(),
    traceId: ctx.traceId,
    taskId: ctx.taskId,
    ...(ctx.shotId ? { shotId: ctx.shotId } : {}),
    ...(typeof ctx.attempt === 'number' ? { attempt: ctx.attempt } : {}),
    ...payload,
  })
  // error / warn 走 stderr，info 走 stdout，便于线上日志聚合管道分流
  if (lvl === 'error' || lvl === 'warn') {
    // eslint-disable-next-line no-console
    console.error(line)
  } else {
    // eslint-disable-next-line no-console
    console.log(line)
  }
}
