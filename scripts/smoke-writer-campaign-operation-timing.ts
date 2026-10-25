/** Fixed-size operation timing observations only. No network, browser or capacity run. */
import assert from 'node:assert/strict'
import type { CampaignRepository, CampaignRepositoryIO } from '../src/types/writerCampaign'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { CAMPAIGN_OPERATION_TIMING_UPPER_MS, CAMPAIGN_TIMEOUT_PHASES, createOfflineCampaignEngine, type CampaignOperationTimings } from '../src/services/writerCampaign/engine'

const identity = { runtimeIdentity: 'operation-timing-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const oldFetch = globalThis.fetch, oldSetTimeout = globalThis.setTimeout, oldClearTimeout = globalThis.clearTimeout
const oldNow = Object.getOwnPropertyDescriptor(performance, 'now')
let now = 0, serial = 0, passed = 0
const timers = new Map<number, { callback: () => void; delay: number }>()
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
function timer() { assert.equal(timers.size, 1); return [...timers.values()][0]! }
function engineWith(repository: Partial<CampaignRepository>) {
  const unused = async (): Promise<never> => { throw new Error('unexpected_repository_call') }
  return createOfflineCampaignEngine({ identity, repository: { read: unused, inspect: unused, list: unused, create: unused, commit: unused, getReceipt: unused, getOperationArtifacts: unused, ...repository } })
}
function valid(report: CampaignOperationTimings) {
  assert.deepEqual(report.phases.map(row => row.phase), CAMPAIGN_TIMEOUT_PHASES)
  for (const row of report.phases) {
    assert.equal(row.histogram.length, 14)
    assert.ok([row.count, row.success, row.error, row.abort, row.timeout, ...row.histogram].every(value => Number.isSafeInteger(value) && value >= 0))
    assert.equal(row.success + row.error + row.abort + row.timeout, row.count)
    assert.equal(row.histogram.reduce((a, b) => a + b, 0), row.count)
    if (!row.count) { assert.equal(row.minMs, null); assert.equal(row.maxMs, null) }
    else { assert.ok(Number.isFinite(row.minMs)); assert.ok(Number.isFinite(row.maxMs)); assert.ok(row.minMs! >= 0 && row.maxMs! >= row.minMs!) }
  }
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false)
}
function unavailable(report: CampaignOperationTimings) {
  valid(report); assert.equal(report.status, 'not_collected')
  assert.ok(report.phases.every(row => row.count === 0 && row.minMs === null && row.maxMs === null))
}
try {
  globalThis.fetch = async () => { throw new Error('network_forbidden') }
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
  globalThis.setTimeout = ((callback: () => void, delay: number) => { const id = ++serial; timers.set(id, { callback, delay }); return id }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout
  assert.deepEqual(CAMPAIGN_OPERATION_TIMING_UPPER_MS, [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 3000, 5000, 10000, Infinity])
  assert.ok(Object.isFrozen(CAMPAIGN_OPERATION_TIMING_UPPER_MS))

  // Every exclusive upper edge, including the final unbounded bucket. The
  // operation is still invoked before timer scheduling, as before observation.
  {
    let elapsed = 0
    const order: string[] = []
    const engine = engineWith({ inspect() { order.push('operation'); assert.equal(timers.size, 0); now += elapsed; return Promise.resolve(null) } })
    const initial = engine.readOperationTimings(); valid(initial); assert.equal(initial.status, 'collected')
    const samples = [0, ...CAMPAIGN_OPERATION_TIMING_UPPER_MS.filter(Number.isFinite).flatMap(bound => [bound - 0.25, bound]), 10001]
    const expected = Array<number>(14).fill(0)
    for (const sample of samples) {
      now = 0; elapsed = sample
      const pending = engine.inspect('PRIVATE_ID'), staleTimer = timer()
      assert.equal(order.at(-1), 'operation'); assert.equal(staleTimer.delay, 3000)
      await pending; staleTimer.callback()
      expected[CAMPAIGN_OPERATION_TIMING_UPPER_MS.findIndex(bound => sample < bound)]++
    }
    const report = engine.readOperationTimings(); valid(report)
    const row = report.phases[0]!
    assert.equal(row.count, samples.length); assert.equal(row.success, samples.length)
    assert.equal(row.minMs, 0); assert.equal(row.maxMs, 10001); assert.deepEqual(row.histogram, expected)
    assert.equal(engine.readTimeoutDiagnostics().events.length, 0)
    report.phases[0]!.histogram.fill(99); report.phases[0]!.count = 99; report.phases.length = 0
    assert.deepEqual(engine.readOperationTimings().phases[0]!.histogram, expected)
    const before = engine.readOperationTimings(); engine.dispose(); assert.deepEqual(engine.readOperationTimings(), before)
    passed++
  }
  // Sync throws and rejected promises preserve the original object/result and
  // each contribute exactly once. Never record private exception properties.
  {
    now = 0
    const error = new Error('PRIVATE_ERROR')
    let sync = true
    const engine = engineWith({ inspect() { now += sync ? 3 : 7; if (sync) throw error; return Promise.reject(error) } })
    assert.throws(() => engine.inspect('PRIVATE_ID'), value => value === error)
    assert.equal(timers.size, 0)
    sync = false; await assert.rejects(engine.inspect('PRIVATE_ID'), value => value === error)
    const report = engine.readOperationTimings(); valid(report)
    assert.equal(report.phases[0]!.count, 2); assert.equal(report.phases[0]!.error, 2)
    assert.equal(report.phases[0]!.minMs, 3); assert.equal(report.phases[0]!.maxMs, 7)
    assert.equal(engine.readTimeoutDiagnostics().events.length, 0); passed++
  }
  for (const ending of ['abort', 'timeout'] as const) for (const settlement of ['resolve', 'reject'] as const) {
    now = 0
    const gate = deferred<null>()
    const engine = engineWith({ read: () => gate.promise, inspect: () => gate.promise })
    const pending = ending === 'abort' ? engine.pause('PRIVATE_ID', 'pause') : engine.inspect('PRIVATE_ID')
    const rejected = assert.rejects(pending, { code: ending === 'abort' ? 'local_stopped' : 'operation_timeout' })
    const stale = timer()
    if (ending === 'abort') { now = 7.5; engine.stopLocal('PRIVATE_ID') }
    else { now = stale.delay + 0.25; stale.callback() }
    await rejected
    const before = engine.readOperationTimings(); valid(before)
    assert.equal(before.phases[0]!.count, 1); assert.equal(before.phases[0]![ending], 1)
    assert.equal(before.phases[0]!.minMs, now); assert.equal(before.phases[0]!.maxMs, now)
    if (settlement === 'resolve') gate.resolve(null); else gate.reject(new Error('PRIVATE_LATE_REJECTION'))
    await Promise.resolve(); await Promise.resolve(); stale.callback()
    assert.deepEqual(engine.readOperationTimings(), before)
    assert.equal(timers.size, 0); passed++
  }
  // Real orchestration routes measurements by the finite phase inventory.
  {
    now = 0
    const rows = new Map<string, string>()
    const io: CampaignRepositoryIO = {
      async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
      async compareAndSwapMany(entries, canCommit) {
        if ((canCommit && !canCommit()) || entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
        for (const entry of entries) rows.set(entry.key, entry.value)
        return true
      },
    }
    const engine = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(io) })
    await engine.prepare({ campaignId: 'PRIVATE_PHASES', language: 'en' })
    await engine.step('PRIVATE_PHASES', 'ordinary')
    const report = engine.readOperationTimings(); valid(report)
    const counts = Object.fromEntries(report.phases.map(row => [row.phase, row.count]))
    assert.deepEqual(counts, { read: 2, receipt: 5, commit: 5, prepare: 2, dispatch: 1, reconcile: 0, save: 1, recovery_read: 0, recovery_receipt: 0, recovery_commit: 0 })
    assert.ok(report.phases.every(row => row.success === row.count)); engine.dispose(); passed++
  }
  // Recovery is separately labeled and still owns its preexisting independent
  // budget; the original late result cannot add another completion sample.
  {
    now = 0
    const entered = deferred<void>(); let reads = 0
    const engine = engineWith({ read() { if (++reads === 2) entered.resolve(); return new Promise(() => {}) } })
    const pending = engine.step('PRIVATE_ID', 'ordinary'), rejected = assert.rejects(pending, { code: 'operation_timeout' })
    const first = timer(); now += first.delay; first.callback(); await entered.promise
    const second = timer(); now += second.delay; second.callback(); await rejected
    const report = engine.readOperationTimings(); valid(report)
    for (const phase of ['read', 'recovery_read']) {
      const row = report.phases.find(row => row.phase === phase)!
      assert.equal(row.count, 1); assert.equal(row.timeout, 1); assert.equal(row.minMs, 3000); assert.equal(row.maxMs, 3000)
    }
    passed++
  }
  // Bad/throwing time samples invalidate the entire report, including any
  // earlier good measurements, without changing successful operation results.
  for (const bad of ['start_throw', 'finish_throw', 'negative', 'nonfinite'] as const) {
    now = 0
    const engine = engineWith({ inspect: async () => null })
    await engine.inspect('PRIVATE_ID')
    let sample = 0
    Object.defineProperty(performance, 'now', { configurable: true, value: () => {
      sample++
      if (bad === 'start_throw' || bad === 'finish_throw' && sample === 2) throw new Error('PRIVATE_CLOCK')
      if (bad === 'negative') return sample === 1 ? 10 : 5
      if (bad === 'nonfinite') return NaN
      return now
    } })
    assert.equal(await engine.inspect('PRIVATE_ID'), null)
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    unavailable(engine.readOperationTimings())
    await engine.inspect('PRIVATE_ID'); unavailable(engine.readOperationTimings())
    passed++
  }
  // Aggregation failure also invalidates globally after normal settlement.
  {
    now = 0
    const engine = engineWith({ inspect: async () => null })
    await engine.inspect('PRIVATE_ID')
    const indexOf = Array.prototype.indexOf
    try {
      Array.prototype.indexOf = function (value, fromIndex) {
        if (Object.is(this, CAMPAIGN_TIMEOUT_PHASES)) throw new Error('PRIVATE_OBSERVER')
        return indexOf.call(this, value, fromIndex)
      }
      assert.equal(await engine.inspect('PRIVATE_ID'), null)
    } finally { Array.prototype.indexOf = indexOf }
    unavailable(engine.readOperationTimings()); passed++
  }
  assert.equal(timers.size, 0)
  console.log(JSON.stringify({ suite: 'writer-campaign-operation-timings', passed, liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
} catch {
  console.error(JSON.stringify({ suite: 'writer-campaign-operation-timings', passed, failedCase: passed + 1, category: 'check_failed', longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
} finally {
  globalThis.fetch = oldFetch; globalThis.setTimeout = oldSetTimeout; globalThis.clearTimeout = oldClearTimeout
  if (oldNow) Object.defineProperty(performance, 'now', oldNow); else Reflect.deleteProperty(performance, 'now')
}
