/** Execution-only heap samples, not a heap bound or a true allocation peak.
 * Chromium performance.memory may be bucketed. Never force GC or emit a dump. */
export type CampaignHeapMethod = 'node_process_samples' | 'chromium_performance_memory_samples'
export interface CampaignHeapObservation {
  status: 'collected' | 'unavailable' | 'not_collected'
  method: CampaignHeapMethod | null
  samples: number
  baselineHeapUsedBytes: number | null
  sampledPeakHeapUsedBytes: number | null
  finalHeapUsedBytes: number | null
}
interface HeapSource { method: CampaignHeapMethod; read: () => number | undefined }
function heapSource(): HeapSource {
  const host = globalThis as typeof globalThis & { process?: { memoryUsage?: () => { heapUsed: number } } }
  if (typeof host.process?.memoryUsage === 'function') {
    const process = host.process
    return { method: 'node_process_samples', read: () => process.memoryUsage!().heapUsed }
  }
  return { method: 'chromium_performance_memory_samples', read: () =>
    (globalThis.performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize }
}
export function createCampaignHeapObservation(source: HeapSource = heapSource()) {
  let samples = 0, baseline: number | null = null, peak: number | null = null, final: number | null = null
  let unavailable = false, stopped = false
  function sample() {
    if (unavailable || stopped) return
    try {
      const value = source.read()
      if (!Number.isSafeInteger(value) || value! < 0) throw new Error('heap_sample_unavailable')
      baseline ??= value!
      peak = Math.max(peak ?? 0, value!)
      final = value!
      samples = Math.min(Number.MAX_SAFE_INTEGER, samples + 1)
    } catch {
      // A partial or failed collector must not pretend its last valid sample
      // describes the end of execution. Discard the optional observation.
      unavailable = true; samples = 0; baseline = peak = final = null
    }
  }
  function snapshot(): CampaignHeapObservation {
    return { status: unavailable ? 'unavailable' : samples >= 2 ? 'collected' : 'not_collected',
      method: samples < 2 && !unavailable ? null : source.method,
      samples: samples < 2 && !unavailable ? 0 : samples,
      baselineHeapUsedBytes: samples < 2 && !unavailable ? null : baseline,
      sampledPeakHeapUsedBytes: samples < 2 && !unavailable ? null : peak,
      finalHeapUsedBytes: samples < 2 && !unavailable ? null : final }
  }
  sample()
  const timer = setInterval(sample, 100)
  return {
    sample,
    snapshot,
    stop(): CampaignHeapObservation {
      if (!stopped) { sample(); stopped = true; clearInterval(timer) }
      return snapshot()
    },
  }
}
