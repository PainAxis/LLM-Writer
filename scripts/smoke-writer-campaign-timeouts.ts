/** Deterministic timeout observation contract only. No network, browser or capacity evidence. */
import assert from 'node:assert/strict'
import type { CampaignRepository, CampaignRepositoryIO, CampaignSnapshot } from '../src/types/writerCampaign'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest, CAMPAIGN_TIMEOUT_DIAGNOSTIC_LIMIT, CAMPAIGN_TIMEOUT_PHASES } from '../src/services/writerCampaign/engine'
import { createOfflineFixtureHost } from '../src/services/writerCampaign/fixtureAdapter'
import { CampaignRuntimeError } from '../src/services/writerCampaign/budget'
import { CAMPAIGN_STORAGE_TIMEOUT_PHASES } from './campaign-evidence.mjs'

const identity = { runtimeIdentity: 'timeout-diagnostic-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const oldFetch = globalThis.fetch, oldSetTimeout = globalThis.setTimeout, oldClearTimeout = globalThis.clearTimeout
const oldNow = Object.getOwnPropertyDescriptor(performance, 'now')
let now = 0, serial = 0, checks = 0
const timers = new Map<number, { callback: () => void; delay: number }>()
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function nextTimer() { assert.equal(timers.size, 1); return [...timers.values()][0]! }
function fire(elapsed?: number) { const timer = nextTimer(); now += elapsed ?? timer.delay; timer.callback(); return timer }
function engineWith(repository: Partial<CampaignRepository>) {
  const unused = async (): Promise<never> => { throw new Error('unexpected_repository_call') }
  return createOfflineCampaignEngine({ identity, repository: { read: unused, inspect: unused, list: unused, create: unused, commit: unused, getReceipt: unused, getOperationArtifacts: unused, ...repository } })
}
const rows = new Map<string, string>()
const io: CampaignRepositoryIO = {
  async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
  async compareAndSwapMany(entries, canCommit) {
    if (canCommit && !canCommit()) return false
    if (entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
    for (const entry of entries) rows.set(entry.key, entry.value)
    return true
  },
}
try {
  globalThis.fetch = async () => { throw new Error('network_forbidden') }
  const repository = createCampaignRepository(io)
  const manifest = await createOfflineCampaignManifest({ identity, campaignId: 'PRIVATE_CAMPAIGN_CANARY', language: 'en' })
  const snapshot = (await repository.create(manifest, 'create')).snapshot
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
  globalThis.setTimeout = ((callback: () => void, delay: number) => { const id = ++serial; timers.set(id, { callback, delay }); return id }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout
  assert.deepEqual(CAMPAIGN_TIMEOUT_PHASES, CAMPAIGN_STORAGE_TIMEOUT_PHASES)
  assert.ok(Object.isFrozen(CAMPAIGN_TIMEOUT_PHASES)); checks++

  // Exact monotonic elapsed includes synchronous operation work, while timer
  // scheduling and budget choice still happen after operation invocation.
  for (const [syncMs, selectedBudget, scheduledTimeoutMs] of [[0, 'operation', 3000], [7300.25, 'action', 2699.75], [7000, 'tie', 3000]] as const) {
    now = 0
    const gate = deferred<CampaignSnapshot | null>()
    let writes = 0
    const engine = engineWith({ read() { now += syncMs; return gate.promise }, async commit() { writes++; throw new Error('unexpected_commit') } })
    const pending = engine.pause('PRIVATE_CAMPAIGN_CANARY', 'pause')
    const rejected = assert.rejects(pending, { code: 'operation_timeout' })
    assert.equal(nextTimer().delay, scheduledTimeoutMs)
    fire(scheduledTimeoutMs + 0.125)
    await rejected
    assert.deepEqual(engine.readTimeoutDiagnostics(), { status: 'observed', overflow: 0, events: [{
      phase: 'read', trigger: 'timer', selectedBudget, operationTimeoutMs: 3000, actionTimeoutMs: 10000,
      actionRemainingMs: 10000 - syncMs, scheduledTimeoutMs, operationElapsedMs: syncMs + scheduledTimeoutMs + 0.125,
      actionElapsedMs: syncMs + scheduledTimeoutMs + 0.125,
    }] })
    gate.resolve(snapshot); await Promise.resolve(); await Promise.resolve()
    assert.equal(writes, 0, 'Late read completion cannot commit')
    const clone = engine.readTimeoutDiagnostics(); clone.events[0]!.phase = 'dispatch'; clone.events.length = 0; clone.overflow = 99
    assert.equal(engine.readTimeoutDiagnostics().events[0]!.phase, 'read')
    engine.dispose(); assert.equal(engine.readTimeoutDiagnostics().events.length, 1)
    assert.equal(JSON.stringify(engine.readTimeoutDiagnostics()).includes('PRIVATE'), false)
    checks++
  }

  // Deadline checks are separate from timer selection, preserve local_stopped,
  // and do not invent an operation elapsed measurement.
  {
    now = 0
    const engine = engineWith({ async read() { now = 10000.375; return snapshot } })
    await assert.rejects(engine.pause('id', 'pause'), { code: 'local_stopped' })
    assert.deepEqual(engine.readTimeoutDiagnostics().events, [{ phase: 'read', trigger: 'action_deadline_check', selectedBudget: 'action',
      operationTimeoutMs: null, actionTimeoutMs: 10000, actionRemainingMs: null, scheduledTimeoutMs: null, operationElapsedMs: null, actionElapsedMs: 10000.375 }])
    assert.equal(timers.size, 0); checks++
  }
  // Existing canCommit deadline refusal is observed, without changing its
  // return value, commit count or original repository error.
  {
    now = 0; let attempts = 0
    const engine = engineWith({ async read() { return snapshot }, async getReceipt() { return null }, async commit(_expected, _mutation, canCommit) {
      attempts++; now = 10001.5; assert.equal(canCommit!(), false); assert.equal(canCommit!(), false)
      throw new CampaignRuntimeError('conflict')
    } })
    await assert.rejects(engine.pause('id', 'pause'), { code: 'conflict' })
    assert.equal(attempts, 1); assert.equal(engine.readTimeoutDiagnostics().events.length, 1)
    assert.equal(engine.readTimeoutDiagnostics().events[0]!.phase, 'commit'); checks++
  }

  // Cancellation and disposal are not timeouts; cleared timers and late results
  // cannot manufacture an observation or another repository operation.
  for (const dispose of [false, true]) {
    now = 0
    const gate = deferred<CampaignSnapshot | null>(), engine = engineWith({ read: () => gate.promise })
    const pending = engine.pause('id', 'pause'), timer = nextTimer()
    const rejected = assert.rejects(pending, { code: 'local_stopped' })
    if (dispose) engine.dispose(); else engine.stopLocal('id')
    await rejected; now = 12000; timer.callback(); gate.resolve(snapshot); await Promise.resolve()
    assert.deepEqual(engine.readTimeoutDiagnostics(), { status: 'not_observed', events: [], overflow: 0 })
    assert.equal(timers.size, 0); checks++
  }
  {
    now = 0
    const gate = deferred<void>(), entered = deferred<void>(); let accepted = 0
    const engine = engineWith({ async read() { return snapshot }, async getReceipt() { return null }, async commit(_expected, _mutation, canCommit) {
      entered.resolve(); await gate.promise; now = 12000
      if (canCommit!()) accepted++
      throw new CampaignRuntimeError('conflict')
    } })
    const pending = engine.pause('id', 'pause'), rejected = assert.rejects(pending, { code: 'local_stopped' })
    await entered.promise; engine.stopLocal('id'); await rejected; gate.resolve(); await Promise.resolve(); await Promise.resolve()
    assert.equal(accepted, 0); assert.equal(engine.readTimeoutDiagnostics().status, 'not_observed'); checks++
  }

  // Sync throws, already rejected/resolved promises and stale timer callbacks
  // keep their prior error/result behavior and produce no timeout event.
  {
    const error = new Error('PRIVATE_ERROR_CANARY')
    const throwing = engineWith({ inspect() { throw error } })
    assert.throws(() => throwing.inspect('id'), candidate => candidate === error)
    const rejecting = engineWith({ inspect: () => Promise.reject(error) })
    await assert.rejects(rejecting.inspect('id'), candidate => candidate === error)
    const resolved = engineWith({ inspect: () => Promise.resolve(null) })
    const pending = resolved.inspect('id'), timer = nextTimer()
    assert.equal(await pending, null); timer.callback()
    for (const engine of [throwing, rejecting, resolved]) assert.equal(engine.readTimeoutDiagnostics().status, 'not_observed')
    assert.equal(timers.size, 0); checks++
  }
  // Diagnostic recording failure happens after settlement/abort and cannot
  // change the command outcome. No observer callback or command reentry exists.
  {
    now = 0
    const engine = engineWith({ read: () => new Promise(() => {}) })
    const pending = engine.pause('id', 'pause'), rejected = assert.rejects(pending, { code: 'operation_timeout' })
    const push = Array.prototype.push
    try {
      Array.prototype.push = function (...items) {
        if (items[0]?.trigger === 'timer') throw new Error('PRIVATE_DIAGNOSTIC_CANARY')
        return push.apply(this, items)
      }
      fire()
    } finally { Array.prototype.push = push }
    await rejected; assert.equal(engine.readTimeoutDiagnostics().status, 'not_observed')
    assert.equal(timers.size, 0); checks++
  }
  {
    now = 0
    const engine = engineWith({ inspect: () => new Promise(() => {}) })
    Object.defineProperty(performance, 'now', { configurable: true, value: () => { throw new Error('PRIVATE_CLOCK_CANARY') } })
    const rejected = assert.rejects(engine.inspect('id'), { code: 'operation_timeout' })
    fire(); await rejected
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    assert.equal(engine.readTimeoutDiagnostics().status, 'not_observed'); checks++
  }
  // Retention is engine-lifetime bounded, not reset by new commands or dispose.
  {
    now = 0
    const engine = engineWith({ inspect: () => new Promise(() => {}) })
    for (let i = 0; i < CAMPAIGN_TIMEOUT_DIAGNOSTIC_LIMIT + 2; i++) {
      const rejected = assert.rejects(engine.inspect(`private-${i}`), { code: 'operation_timeout' }); fire(); await rejected
    }
    const diagnostics = engine.readTimeoutDiagnostics()
    assert.equal(diagnostics.events.length, 8); assert.equal(diagnostics.overflow, 2)
    assert.ok(diagnostics.events.every(event => event.actionTimeoutMs === null && event.actionElapsedMs === null && event.actionRemainingMs === null))
    engine.dispose(); assert.deepEqual(engine.readTimeoutDiagnostics(), diagnostics)
    assert.equal(engineWith({}).readTimeoutDiagnostics().status, 'not_observed'); checks++
  }
  // Primary and recovery timeouts retain independent action clocks. A recovery
  // failure does not overwrite the original operation_timeout outcome.
  {
    now = 0
    const recoveryEntered = deferred<void>(); let reads = 0
    const engine = engineWith({ read() { if (++reads === 2) recoveryEntered.resolve(); return new Promise(() => {}) } })
    const pending = engine.step('id', 'step'), rejected = assert.rejects(pending, { code: 'operation_timeout' })
    fire(); await recoveryEntered.promise; fire(); await rejected
    const diagnostics = engine.readTimeoutDiagnostics()
    assert.deepEqual(diagnostics.events.map(event => event.phase), ['read', 'recovery_read'])
    assert.deepEqual(diagnostics.events.map(event => event.actionElapsedMs), [3000, 3000]); checks++
  }
  // The production dispatch limit remains 5s and its existing fail-closed
  // recovery runs without exposing provider request text to diagnostics.
  {
    now = 0
    const gate = deferred<void>(), entered = deferred<void>(); let calls = 0
    const host = createOfflineFixtureHost({ onDispatch: async () => { calls++; entered.resolve(); await gate.promise } })
    const originalDispatch = host.provider.dispatch
    let sameCommand: Promise<CampaignSnapshot> | undefined
    host.provider.dispatch = (request, permit, signal) => {
      signal.addEventListener('abort', () => { now += 700; sameCommand = engine.step(manifest.campaignId, 'dispatch-timeout') }, { once: true })
      return originalDispatch(request, permit, signal)
    }
    const engine = createOfflineCampaignEngine({ identity, repository, host })
    const pending = engine.step(manifest.campaignId, 'dispatch-timeout'); await entered.promise
    assert.equal(nextTimer().delay, 5000); fire()
    const blocked = await pending
    assert.equal(sameCommand, pending, 'Abort-listener reentry still joins the same command')
    assert.equal(engine.readTimeoutDiagnostics().events[0]!.operationElapsedMs, 5000, 'Abort listener time is not timeout latency')
    assert.equal(engine.readTimeoutDiagnostics().events[0]!.actionElapsedMs, 5000)
    assert.equal(blocked.head.status, 'blocked'); assert.equal(blocked.checkpoint.reason, 'operation_timeout')
    assert.equal(engine.readTimeoutDiagnostics().events[0]!.phase, 'dispatch')
    assert.equal(engine.readTimeoutDiagnostics().events[0]!.operationTimeoutMs, 5000)
    gate.resolve(); await Promise.resolve(); await Promise.resolve()
    assert.equal(calls, 1); assert.equal((await repository.read(manifest.campaignId))!.artifacts.size, 0)
    const before = engine.readTimeoutDiagnostics(); await engine.step(manifest.campaignId, 'later-command')
    assert.deepEqual(engine.readTimeoutDiagnostics(), before); engine.dispose(); checks++
  }
  assert.equal(timers.size, 0)
  console.log(`Campaign timeout diagnostics: ${checks} deterministic checks passed; no browser, capacity run, or provider network calls.`)
} catch {
  console.error(`Campaign timeout diagnostics failed after ${checks} checks.`)
  process.exitCode = 1
} finally {
  globalThis.fetch = oldFetch; globalThis.setTimeout = oldSetTimeout; globalThis.clearTimeout = oldClearTimeout
  if (oldNow) Object.defineProperty(performance, 'now', oldNow); else Reflect.deleteProperty(performance, 'now')
}
