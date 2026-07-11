export interface ProviderSelectionSignals {
  weight: number
  active: number
  limit: number
  successRate: number | null
  p95DurationMs: number | null
}

export function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(quantile * sorted.length) - 1),
  )
  return sorted[index]
}

export function computeProviderSelectionScore(
  signals: ProviderSelectionSignals,
): number {
  const limit = Math.max(1, signals.limit)
  if (signals.active >= limit) return 0
  const saturation = Math.max(0.05, 1 - signals.active / limit)
  const successFactor = signals.successRate === null
    ? 0.9
    : Math.max(0.1, signals.successRate)
  const latencyFactor = signals.p95DurationMs === null
    ? 1
    : Math.max(0.1, 60_000 / Math.max(60_000, signals.p95DurationMs))
  return Math.max(1, signals.weight) * saturation * successFactor * latencyFactor
}
