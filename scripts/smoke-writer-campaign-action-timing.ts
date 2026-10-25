import assert from 'node:assert/strict'
import { createCampaignActionTiming } from './fixtures/writer-campaign-action-timing'
let passed = 0
try {
  const empty = createCampaignActionTiming()
  assert.deepEqual(empty.snapshot(), { status: 'not_collected', samples: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null }); passed++
  const singleton = createCampaignActionTiming(1); singleton.record(0)
  assert.deepEqual(singleton.snapshot(), { status: 'collected', samples: 1, minMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }); passed++
  assert.throws(() => singleton.record(1)); passed++
  const measured = createCampaignActionTiming()
  for (let i = 123; i >= 1; i--) measured.record(i)
  assert.deepEqual(measured.snapshot(), { status: 'collected', samples: 123, minMs: 1, p50Ms: 62, p95Ms: 117, maxMs: 123 }); passed++
  const detached = measured.snapshot(); detached.samples = 0; assert.equal(measured.snapshot().samples, 123); passed++
  for (const bad of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) { assert.throws(() => empty.record(bad)); passed++ }
  for (const bad of [-1, 0, 124, NaN, Infinity, 1.5]) { assert.throws(() => createCampaignActionTiming(bad)); passed++ }
  assert.equal(empty.snapshot().samples, 0); passed++
  console.log(JSON.stringify({ suite: 'writer-campaign-action-timing', passed, liveCalls: 0, claim: 'controlled quantile calculation only' }))
} catch { console.error(JSON.stringify({ suite: 'writer-campaign-action-timing', passed, category: 'controlled_assertion_failed' })); process.exitCode = 1 }
