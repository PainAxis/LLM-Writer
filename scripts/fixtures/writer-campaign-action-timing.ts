/** Bounded scalar-only execution timings. Nearest-rank quantiles, no traces. */
export interface CampaignActionTiming {
  status: 'collected' | 'not_collected'
  samples: number
  minMs: number | null
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}
export function createCampaignActionTiming(limit = 123) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 123) throw new Error('action_timing_limit')
  const durations: number[] = []
  return {
    record(milliseconds: number) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || durations.length >= limit) throw new Error('action_timing_invalid')
      durations.push(milliseconds)
    },
    snapshot(): CampaignActionTiming {
      if (!durations.length) return { status: 'not_collected', samples: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null }
      const sorted = [...durations].sort((a, b) => a - b)
      const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]!
      return { status: 'collected', samples: sorted.length, minMs: sorted[0]!, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted[sorted.length - 1]! }
    },
  }
}
