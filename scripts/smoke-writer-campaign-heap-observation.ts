import assert from 'node:assert/strict'
import { createCampaignHeapObservation } from './fixtures/writer-campaign-heap-observation'
let passed = 0
const active = new Set<ReturnType<typeof createCampaignHeapObservation>>()
const create = (...args: Parameters<typeof createCampaignHeapObservation>) => {
  const collector = createCampaignHeapObservation(...args); active.add(collector); return collector
}
try {
  const values = [100, 180, 120]
  const collector = create({ method: 'node_process_samples', read: () => values.shift() })
  assert.equal(collector.snapshot().status, 'not_collected'); passed++
  collector.sample()
  const observed = collector.stop()
  assert.deepEqual(observed, { status: 'collected', method: 'node_process_samples', samples: 3,
    baselineHeapUsedBytes: 100, sampledPeakHeapUsedBytes: 180, finalHeapUsedBytes: 120 }); passed++
  observed.samples = 999
  assert.equal(collector.stop().samples, 3); collector.sample(); assert.equal(collector.snapshot().samples, 3); passed++
  for (const bad of [undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const c = create({ method: 'chromium_performance_memory_samples', read: () => bad })
    assert.deepEqual(c.stop(), { status: 'unavailable', method: 'chromium_performance_memory_samples', samples: 0,
      baselineHeapUsedBytes: null, sampledPeakHeapUsedBytes: null, finalHeapUsedBytes: null }); passed++
  }
  let reads = 0
  const partial = create({ method: 'node_process_samples', read: () => {
    if (++reads === 1) return 123
    throw new Error('private failure details must not be emitted')
  } })
  assert.equal(partial.stop().status, 'unavailable'); assert.equal(partial.snapshot().samples, 0); passed++
  const zero = create({ method: 'node_process_samples', read: () => 0 })
  assert.equal(zero.stop().sampledPeakHeapUsedBytes, 0); passed++
  console.log(JSON.stringify({ suite: 'writer-campaign-heap-observation', passed, liveCalls: 0, claim: 'controlled sampler only, not a heap measurement' }))
} catch {
  console.error(JSON.stringify({ suite: 'writer-campaign-heap-observation', passed, category: 'controlled_assertion_failed' }))
  process.exitCode = 1
} finally { for (const collector of active) collector.stop() }
