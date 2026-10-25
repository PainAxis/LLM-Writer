/** Action-capability lifecycle through the production engine and repository. Offline synthetic data only. */
import assert from 'node:assert/strict'
import type { CampaignActionScope, CampaignRepository, CampaignRepositoryIO } from '../src/types/writerCampaign'
import { campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createOfflineFixtureHost } from '../src/services/writerCampaign/fixtureAdapter'

const identity = { runtimeIdentity: 'action-proof-engine-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const originalFetch = globalThis.fetch
let passed = 0
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
type Entries = Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]
const kindOf = (entries: Entries) => JSON.parse(entries.find(entry => entry.key.includes(':receipt:'))!.value).kind as string
function storageFrom(seed?: Map<string, string>) {
  const rows = new Map(seed)
  let writes = 0
  const hooks: { beforeRead?: (keys: readonly string[]) => Promise<void>; beforeCAS?: (entries: Entries) => Promise<void>; afterCAS?: (entries: Entries) => Promise<void> } = {}
  const io: CampaignRepositoryIO = {
    async getMany(keys) { await hooks.beforeRead?.(keys); return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit) {
      await hooks.beforeCAS?.(entries)
      if (canCommit && !canCommit()) return false
      if (entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
      for (const entry of entries) rows.set(entry.key, entry.value)
      writes++
      await hooks.afterCAS?.(entries)
      return true
    },
  }
  return { rows, hooks, io, get writes() { return writes } }
}
function trackedRepository(io: CampaignRepositoryIO, dropScope = false) {
  const base = createCampaignRepository(io), live = new Set<CampaignActionScope>(), created: CampaignActionScope[] = []
  const reads: Array<CampaignActionScope | undefined> = [], commits: Array<CampaignActionScope | undefined> = []
  assert.equal(typeof base.createActionScope, 'function')
  assert.equal(typeof base.disposeActionScope, 'function')
  const repository: CampaignRepository = {
    ...base,
    createActionScope(id) { const scope = base.createActionScope!(id); created.push(scope); live.add(scope); return scope },
    disposeActionScope(scope) { assert.equal(live.delete(scope), true, 'An engine scope is disposed exactly once'); base.disposeActionScope!(scope) },
    read(id, scope) { reads.push(scope); return base.read(id, dropScope ? undefined : scope) },
    commit(expected, mutation, canCommit, scope) { commits.push(scope); return base.commit(expected, mutation, canCommit, dropScope ? undefined : scope) },
  }
  return { base, repository, live, created, reads, commits }
}
function setup(seed?: Map<string, string>, dropScope = false) {
  const storage = storageFrom(seed), tracked = trackedRepository(storage.io, dropScope)
  let calls = 0
  const host = createOfflineFixtureHost({ onDispatch: () => { calls++ } })
  const engine = createOfflineCampaignEngine({ identity, repository: tracked.repository, host })
  return { storage, ...tracked, host, engine, calls: () => calls }
}
async function microtasks() { for (let i = 0; i < 12; i++) await Promise.resolve() }
function noProof(t: ReturnType<typeof setup>) {
  const stats = t.base.getActionProofStats!()
  assert.equal(stats.retainedBytes, 0)
  assert.equal(stats.retainedEntries, 0)
  assert.equal(stats.activeRecords, 0)
}
function scopedOnce(t: ReturnType<typeof setup>, before: number) {
  assert.equal(t.created.length, before + 1)
  assert.equal(t.live.size, 0)
  noProof(t)
  const token = t.created[before]!
  assert.ok(t.reads.includes(token))
  assert.ok(t.commits.includes(token))
}
try {
  globalThis.fetch = async () => { throw new Error('network_forbidden') }

  // Create/inspect stay cold. An ordinary action uses one token through every
  // read/commit wrapper; its durable duplicate and next action get fresh tokens.
  for (const dropScope of [false, true]) {
    const t = setup(undefined, dropScope), id = 'action-routing'
    await t.engine.prepare({ campaignId: id, language: 'en' })
    await t.engine.inspect(id)
    assert.equal(t.created.length, 0)
    const before = t.base.getActionProofStats!()
    const a = t.engine.step(id, 'original'), b = t.engine.step(id, 'original')
    assert.equal(a, b)
    const done = await a
    assert.equal(done.checkpoint.tasks[0]!.status, 'committed')
    scopedOnce(t, 0)
    const after = t.base.getActionProofStats!()
    if (!dropScope) {
      assert.equal(after.coldReplaysCompleted - before.coldReplaysCompleted, 1)
      assert.equal(after.exactPasses - before.exactPasses, 5)
      assert.equal(after.transitions - before.transitions, 5)
      assert.ok(after.peakRetainedBytes > 0)
    } else assert.equal(after.exactPasses - before.exactPasses, 0)
    assert.ok(t.commits.every(token => token === t.created[0]))
    const writes = t.storage.writes
    await t.engine.step(id, 'original')
    assert.equal(t.storage.writes, writes); assert.equal(t.calls(), 1)
    assert.equal(t.created.length, 2); assert.notEqual(t.created[0], t.created[1]); assert.equal(t.live.size, 0)
    await t.engine.step(id, 'next')
    scopedOnce(t, 2); assert.equal(t.calls(), 2)
    t.engine.dispose(); assert.equal(t.live.size, 0); passed++
  }
  // Missing either optional lifecycle method never grants an unmanaged scope.
  for (const missing of ['createActionScope', 'disposeActionScope'] as const) {
    const t = setup(), id = `missing-${missing}`
    t.repository[missing] = undefined
    await t.engine.prepare({ campaignId: id, language: 'en' })
    const snapshot = await t.engine.step(id, 'ordinary')
    assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed')
    assert.equal(t.created.length, 0); assert.ok(t.reads.every(token => token === undefined)); assert.ok(t.commits.every(token => token === undefined))
    t.engine.dispose(); passed++
  }

  // Seed settled, replaced history which is absent from the current active and
  // prior maps. Every later transition must still observe its immutable bytes.
  const seed = setup(), id = 'inactive-history'
  const genesis = await seed.engine.prepare({ campaignId: id, language: 'en' })
  const first = await seed.engine.step(id, 'old-outline')
  const originalRequest = [...first.requests.values()].find(request => request.commandId === 'old-outline')!
  await seed.engine.replaceCandidate(id, 'outline', 'Synthetic replacement one.', 'replace-one')
  await seed.engine.replaceCandidate(id, 'outline', 'Synthetic replacement two.', 'replace-two')
  const seeded = await seed.engine.resume(id, 'ready')
  assert.equal(seeded.artifacts.has(first.checkpoint.tasks[0]!.artifact!.hash), false)
  const keys = {
    manifest: campaignKeys.manifest(id, genesis.manifest.hash),
    checkpoint: campaignKeys.checkpoint(id, 1),
    receipt: campaignKeys.receipt(id, 'old-outline:start'),
    request: campaignKeys.request(id, originalRequest.id, 0),
    artifact: campaignKeys.artifact(id, 'outline', 0),
  }
  seed.engine.dispose()
  // Even an injected wrapper cannot fan one action token out into concurrent
  // readers and retain trust. Both actual reads finish cold; the engine stays
  // correct, but the capability cannot be admitted again during this action.
  {
    const t = setup(seed.storage.rows), entered = deferred<void>(), release = deferred<void>()
    let held = false, joined = false
    t.storage.hooks.beforeRead = async () => { if (!held) { held = true; entered.resolve(); await release.promise } }
    const read = t.repository.read.bind(t.repository)
    t.repository.read = async (campaign, scope) => {
      const initial = read(campaign, scope)
      if (!scope || joined) return initial
      joined = true; await entered.promise
      const concurrent = t.base.read(campaign, scope)
      release.resolve()
      const [a, b] = await Promise.all([initial, concurrent])
      assert.equal(a!.rawHead, b!.rawHead)
      return a
    }
    const snapshot = await t.engine.step(id, 'single-flight')
    assert.equal(snapshot.checkpoint.tasks.find(task => task.taskId === 'characters')!.status, 'committed')
    assert.equal(t.calls(), 1); assert.equal(t.created.length, 1)
    const stats = t.base.getActionProofStats!()
    assert.equal(stats.disposalReasons.concurrent, 1); assert.equal(stats.exactPasses, 0)
    assert.equal(t.live.size, 0); noProof(t); t.engine.dispose(); passed++
  }
  // A local control closes its predecessor before admitting its own scope,
  // even when the dispatched provider promise ignores the abort signal.
  {
    const t = setup(seed.storage.rows), entered = deferred<void>(), release = deferred<void>()
    const dispatch = t.host.provider.dispatch.bind(t.host.provider)
    t.host.provider.dispatch = async (...args) => { const response = await dispatch(...args); entered.resolve(); await release.promise; return response }
    const pending = t.engine.step(id, 'local-pending')
    await entered.promise; assert.equal(t.live.size, 1)
    const firstScope = t.created[0]!
    const cancelling = t.engine.cancel(id, 'local-cancel')
    assert.equal(t.live.has(firstScope), false)
    const cancelled = await cancelling; await pending
    const writes = t.storage.writes
    release.resolve(); await microtasks()
    assert.equal(cancelled.head.status, 'cancelled'); assert.equal(t.storage.writes, writes)
    assert.equal(t.calls(), 1); assert.equal(t.created.length, 2); assert.equal(t.live.size, 0); noProof(t)
    assert.equal(await t.base.getReceipt(id, 'local-pending:retain'), null)
    t.engine.dispose(); passed++
  }
  for (const phase of ['reserve', 'dispatch_intent', 'provider_return', 'retain_response'] as const) {
    for (const family of Object.keys(keys) as Array<keyof typeof keys>) {
      const t = setup(seed.storage.rows), key = keys[family]
      let damaged: Array<[string, string]> | undefined
      const corrupt = () => {
        if (damaged) return
        // Whitespace is semantically identical JSON but not the exact observed
        // raw value. It cannot be silently blessed by replay or reserialization.
        t.storage.rows.set(key, `${t.storage.rows.get(key)!} `)
        damaged = [...t.storage.rows.entries()]
      }
      if (phase === 'provider_return') {
        const dispatch = t.host.provider.dispatch.bind(t.host.provider)
        t.host.provider.dispatch = async (...args) => { const response = await dispatch(...args); corrupt(); return response }
      } else t.storage.hooks.afterCAS = async entries => { if (kindOf(entries) === phase) corrupt() }
      await assert.rejects(t.engine.step(id, 'new-character'))
      assert.ok(damaged); assert.deepEqual([...t.storage.rows.entries()], damaged)
      assert.equal(t.calls(), phase === 'reserve' ? 0 : 1)
      assert.equal(await t.base.getReceipt(id, 'new-character:artifact'), null)
      assert.equal(t.live.size, 0)
      t.engine.dispose(); passed++
    }
  }

  // An independent owner can win between every phase. It cannot revoke an
  // already durable intent, but the old response cannot settle either candidate.
  for (const phase of ['reserve', 'dispatch_intent', 'provider_return', 'retain_response'] as const) {
    for (const control of ['cancel', 'replace'] as const) {
      const t = setup(seed.storage.rows)
      const other = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
      let changed = false
      const change = async () => {
        if (changed) return
        changed = true
        if (control === 'cancel') await other.cancel(id, 'other-cancel')
        else await other.replaceCandidate(id, 'outline', 'Synthetic concurrent replacement.', 'other-replace')
      }
      if (phase === 'provider_return') {
        const dispatch = t.host.provider.dispatch.bind(t.host.provider)
        t.host.provider.dispatch = async (...args) => { const response = await dispatch(...args); await change(); return response }
      } else t.storage.hooks.afterCAS = async entries => { if (kindOf(entries) === phase) await change() }
      const snapshot = await t.engine.step(id, 'new-character')
      assert.equal(changed, true); assert.equal(snapshot.head.status, control === 'cancel' ? 'cancelled' : 'paused')
      assert.equal(t.calls(), phase === 'reserve' ? 0 : 1)
      assert.equal(snapshot.checkpoint.tasks.find(task => task.taskId === 'characters')!.artifact, null)
      assert.equal(snapshot.checkpoint.storage.openAllocations.length, 1)
      assert.equal(await t.base.getReceipt(id, 'new-character:artifact'), null)
      assert.equal(t.live.size, 0); assert.equal(t.reads.at(-1), undefined, 'Conflict recovery is an independent cold read')
      t.engine.dispose(); other.dispose(); passed++
    }
  }

  // A lost ACK destroys local authority before cold receipt/read recovery.
  // Retained-response restart performs save-only work without a new scope/call.
  for (const kind of ['dispatch_intent', 'retain_response', 'accept_artifact'] as const) {
    const t = setup(), id = `ack-${kind}`
    await t.engine.prepare({ campaignId: id, language: 'en' })
    let lost = false
    t.storage.hooks.afterCAS = async entries => {
      if (!lost && kindOf(entries) === kind) { lost = true; throw new Error('synthetic_ack_loss') }
    }
    let snapshot = await t.engine.step(id, 'original')
    t.storage.hooks.afterCAS = undefined
    assert.equal(lost, true); assert.equal(t.live.size, 0)
    assert.equal(t.reads.at(-1), undefined)
    const writes = t.storage.writes
    await t.engine.step(id, 'original'); assert.equal(t.storage.writes, writes)
    if (kind === 'retain_response') {
      assert.equal(snapshot.checkpoint.tasks[0]!.status, 'response_retained')
      const scopes = t.created.length, commits = t.commits.length
      const restarted = createOfflineCampaignEngine({ identity, repository: t.repository })
      snapshot = await restarted.recoverSaveOnly(id, 'save-only')
      assert.equal(t.created.length, scopes)
      assert.ok(t.commits.slice(commits).every(token => token === undefined))
      assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed')
      assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
      assert.equal(snapshot.checkpoint.budget.attempts, 1)
      restarted.dispose()
    } else if (kind === 'dispatch_intent') {
      assert.equal(snapshot.checkpoint.tasks[0]!.status, 'outcome_unknown')
      const restart = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
      await restart.resume(id, 'fresh-owner')
      snapshot = await restart.step(id, 'no-replay')
      assert.equal(snapshot.checkpoint.tasks[0]!.status, 'outcome_unknown')
      assert.equal(snapshot.checkpoint.storage.openAllocations.length, 1)
      assert.equal(snapshot.checkpoint.budget.attempts, 1); restart.dispose()
    } else assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
    assert.equal(t.calls(), kind === 'dispatch_intent' ? 0 : 1)
    t.engine.dispose(); passed++
  }

  // Stop, dispose and timeout invalidate synchronously while the real cold read
  // or CAS is still held. Later settlement cannot publish a proof or a write.
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout
  const originalNow = Object.getOwnPropertyDescriptor(performance, 'now')
  let now = 0, serial = 0
  const timers = new Map<number, { callback: () => void; delay: number }>()
  try {
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
    globalThis.setTimeout = ((callback: () => void, delay: number) => { const serialId = ++serial; timers.set(serialId, { callback, delay }); return serialId }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((timer: number) => { timers.delete(timer) }) as unknown as typeof clearTimeout
    for (const heldPhase of ['read', 'commit'] as const) for (const ending of ['stop', 'dispose', 'timeout'] as const) {
      now = 0
      const t = setup(seed.storage.rows), gate = deferred<void>(), entered = deferred<void>(), completed = deferred<void>()
      let held = false
      const hold = async () => { if (!held) { held = true; entered.resolve(); await gate.promise } }
      if (heldPhase === 'read') t.storage.hooks.beforeRead = hold
      else t.storage.hooks.beforeCAS = hold
      if (heldPhase === 'read') {
        const read = t.repository.read.bind(t.repository)
        t.repository.read = async (...args) => { try { return await read(...args) } finally { completed.resolve() } }
      } else {
        const commit = t.repository.commit.bind(t.repository)
        t.repository.commit = async (...args) => { try { return await commit(...args) } finally { completed.resolve() } }
      }
      const pending = t.engine.pause(id, 'held-action')
      const rejected = assert.rejects(pending, { code: ending === 'timeout' ? 'operation_timeout' : 'local_stopped' })
      await entered.promise
      assert.equal(t.live.size, 1)
      if (ending === 'stop') t.engine.stopLocal(id)
      else if (ending === 'dispose') t.engine.dispose()
      else {
        assert.equal(timers.size, 1)
        const timer = [...timers.values()][0]!
        assert.equal(timer.delay, 3000); now += timer.delay; timer.callback()
      }
      assert.equal(t.live.size, 0, 'Disposal happens before a held operation settles')
      noProof(t)
      await rejected
      gate.resolve(); await completed.promise; await microtasks()
      assert.equal(t.storage.writes, 0); assert.equal(t.live.size, 0); assert.equal(timers.size, 0); noProof(t)
      const fresh = createOfflineCampaignEngine({ identity, repository: t.repository })
      await fresh.pause(id, 'fresh-action')
      assert.equal(t.live.size, 0); assert.equal(t.storage.writes, 1)
      t.engine.dispose(); fresh.dispose(); passed++
    }
    // Replacement replay receipt/artifact lookups now share the original Run
    // deadline. This is an intentional deadline tightening, not a new budget.
    for (const phase of ['receipt', 'artifact'] as const) {
      now = 0
      const t = setup(seed.storage.rows), entered = deferred<void>(), release = deferred<void>(), completed = deferred<void>()
      if (phase === 'receipt') {
        const receipt = t.repository.getReceipt.bind(t.repository)
        t.repository.getReceipt = (...args) => {
          now = 9200.25
          return (async () => { const value = await receipt(...args); entered.resolve(); await release.promise; completed.resolve(); return value })()
        }
      } else {
        const artifacts = t.repository.getOperationArtifacts.bind(t.repository)
        t.repository.getOperationArtifacts = (...args) => {
          now = 9200.25
          return (async () => { const value = await artifacts(...args); entered.resolve(); await release.promise; completed.resolve(); return value })()
        }
      }
      const pending = t.engine.replaceCandidate(id, 'outline', 'Synthetic replacement two.', 'replace-two')
      const rejected = assert.rejects(pending, { code: 'operation_timeout' })
      await entered.promise
      assert.equal(t.live.size, 1); assert.equal(timers.size, 1)
      const timer = [...timers.values()][0]!
      assert.equal(timer.delay, 799.75)
      now += timer.delay; timer.callback()
      assert.equal(t.live.size, 0, 'Replacement replay deadline disposes before lookup settlement'); noProof(t)
      await rejected
      assert.equal(t.storage.writes, 0); assert.equal(t.calls(), 0)
      release.resolve(); await completed.promise; await microtasks()
      assert.equal(t.storage.writes, 0); assert.equal(timers.size, 0); noProof(t)
      const [event] = t.engine.readTimeoutDiagnostics().events
      assert.equal(event!.phase, phase === 'receipt' ? 'receipt' : 'read')
      assert.equal(event!.selectedBudget, 'action'); assert.equal(event!.operationTimeoutMs, 3000)
      assert.equal(event!.scheduledTimeoutMs, 799.75); assert.equal(event!.actionElapsedMs, 10000)
      t.engine.dispose(); passed++
    }
    // Within-budget replay still succeeds without a new write. Exact payload
    // identity remains mandatory even when the command receipt already exists.
    for (const mismatch of ['none', 'text', 'task'] as const) {
      now = 0
      const t = setup(seed.storage.rows)
      const receipt = t.repository.getReceipt.bind(t.repository), artifacts = t.repository.getOperationArtifacts.bind(t.repository)
      t.repository.getReceipt = (...args) => { now = 8000; return receipt(...args) }
      t.repository.getOperationArtifacts = (...args) => { now = 9999.75; return artifacts(...args) }
      const pending = t.engine.replaceCandidate(id, mismatch === 'task' ? 'characters' : 'outline', mismatch === 'text' ? 'Different synthetic replacement.' : 'Synthetic replacement two.', 'replace-two')
      if (mismatch === 'none') assert.equal((await pending).rawHead, seeded.rawHead)
      else await assert.rejects(pending, { code: 'operation_conflict' })
      assert.equal(t.storage.writes, 0); assert.equal(t.calls(), 0)
      assert.equal(t.created.length, 1); assert.equal(t.live.size, 0); assert.equal(timers.size, 0); noProof(t)
      assert.equal(t.engine.readTimeoutDiagnostics().status, 'not_observed')
      t.engine.dispose(); passed++
    }
    // A fully resolved read may be cancelled before the engine continuation.
    {
      now = 0
      const t = setup(seed.storage.rows), read = t.repository.read.bind(t.repository)
      t.repository.read = async (...args) => { const snapshot = await read(...args); t.engine.stopLocal(id); assert.equal(t.live.size, 0); return snapshot }
      await assert.rejects(t.engine.pause(id, 'cancel-after-resolution'), { code: 'local_stopped' })
      assert.equal(t.storage.writes, 0); assert.equal(t.live.size, 0); assert.equal(timers.size, 0); noProof(t)
      t.engine.dispose(); passed++
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout
    if (originalNow) Object.defineProperty(performance, 'now', originalNow); else Reflect.deleteProperty(performance, 'now')
  }
  console.log(JSON.stringify({ suite: 'writer-campaign-action-proof-engine', passed, liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
} catch {
  console.error(JSON.stringify({ suite: 'writer-campaign-action-proof-engine', passed, failedCase: passed + 1, category: 'check_failed', longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
} finally { globalThis.fetch = originalFetch }
