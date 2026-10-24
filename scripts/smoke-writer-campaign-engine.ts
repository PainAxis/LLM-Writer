/** Deterministic production engine/repository contract tests. No network or real model calls. */
import assert from 'node:assert/strict'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createOfflineFixtureHost } from '../src/services/writerCampaign/fixtureAdapter'
import { campaignRequestReservation, checkedCampaignAdd, emptyCampaignBudget, reserveCampaignBudget } from '../src/services/writerCampaign/budget'

const oldFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Network forbidden in offline campaign') }
const identity = { runtimeIdentity: 'controlled-engine-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
let count = 0
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function memoryIO() {
  const rows = new Map<string, string>()
  let writes = 0
  let after: ((entries: ReadonlyArray<{key: string; expectedValue: string | null; value: string}>) => Promise<void>) | undefined
  let hook: ((entries: ReadonlyArray<{key: string; expectedValue: string | null; value: string}>) => Promise<void>) | undefined
  const io: CampaignRepositoryIO = {
    async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit) {
      await hook?.(entries)
      if (canCommit && !canCommit()) return false
      if (entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
      for (const entry of entries) rows.set(entry.key, entry.value)
      writes++
      await after?.(entries)
      return true
    },
  }
  return { io, rows, get writes() { return writes }, setHook(fn?: typeof hook) { hook = fn }, setAfter(fn?: typeof after) { after = fn } }
}
const setup = (options: Parameters<typeof createOfflineFixtureHost>[0] = {}) => {
  const storage = memoryIO(), repository = createCampaignRepository(storage.io)
  let calls = 0
  const host = createOfflineFixtureHost({ ...options, onDispatch: async request => { calls++; await options.onDispatch?.(request) } })
  const engine = createOfflineCampaignEngine({ identity, repository, host })
  return { storage, repository, host, engine, calls: () => calls }
}
async function finish(engine: ReturnType<typeof createOfflineCampaignEngine>, id: string) {
  let snapshot = (await engine.inspect(id))!
  for (let i = 0; i < 128 && snapshot.head.status !== 'completed'; i++) {
    snapshot = await engine.step(id)
    assert.equal(snapshot.checkpoint.reason, null)
  }
  assert.equal(snapshot.head.status, 'completed')
  return snapshot
}
try {
for (const language of ['zh', 'en'] as const) {
  const t = setup(); await t.engine.prepare({ campaignId: language, language })
  const snapshot = await finish(t.engine, language)
  assert.equal(t.calls(), 5); assert.equal(snapshot.checkpoint.tasks.filter(task => task.status === 'committed').length, 5)
  assert.equal(snapshot.checkpoint.bodyCharacters, [...snapshot.artifacts.values()].filter(a => a.kind === 'chapter_body').reduce((n, a) => n + a.canonical.scalars, 0))
  assert.ok(snapshot.checkpoint.bodyCharacters < snapshot.manifest.bodyTarget.characters)
  for (const request of snapshot.requests.values()) { assert.equal(request.response!.usage.inputTokens, null); assert.equal(request.response!.usage.outputTokens, null) }
  const restarted = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  assert.equal((await restarted.inspect(language))!.head.status, 'completed')
  count++
}
// Same command joins in-flight; its durable replay must not advance the next task or spend again.
{
  const t = setup(); await t.engine.prepare({ campaignId: 'duplicates', language: 'en' })
  const a = t.engine.step('duplicates', 'same'), b = t.engine.step('duplicates', 'same')
  assert.equal(a, b); await a
  const writes = t.storage.writes
  await t.engine.prepare({ campaignId: 'duplicates', language: 'en' })
  assert.equal(t.storage.writes, writes)
  await assert.rejects(() => t.engine.prepare({ campaignId: 'duplicates', language: 'zh' }))
  await t.engine.step('duplicates', 'same')
  assert.equal(t.calls(), 1); assert.equal(t.storage.writes, writes)
  await t.engine.pause('duplicates', 'pause-same'); const pausedWrites = t.storage.writes
  await t.engine.pause('duplicates', 'pause-same'); assert.equal(t.storage.writes, pausedWrites)
  count++
}
// Cancellation settles an adapter which ignores abort; its late result cannot become an artifact.
{
  const gate = deferred<void>(), entered = deferred<void>(), t = setup({ onDispatch: async () => { entered.resolve(); await gate.promise } })
  await t.engine.prepare({ campaignId: 'cancel-race', language: 'zh' })
  const pending = t.engine.step('cancel-race'); await entered.promise
  const cancelled = await t.engine.cancel('cancel-race', 'cancel')
  assert.equal(cancelled.head.status, 'cancelled'); await pending
  gate.resolve(); await new Promise(r => setTimeout(r, 0))
  const final = (await t.engine.inspect('cancel-race'))!
  assert.equal(final.head.status, 'cancelled'); assert.equal(final.artifacts.size, 0); assert.equal(t.calls(), 1)
  const writes = t.storage.writes; await t.engine.resume('cancel-race'); assert.equal(t.storage.writes, writes)
  count++
}
// Old owner is fenced by a second instance; absence of evidence never replays an intent.
{
  const gate = deferred<void>(), entered = deferred<void>(), t = setup({ onDispatch: async () => { entered.resolve(); await gate.promise } })
  await t.engine.prepare({ campaignId: 'unknown', language: 'en' })
  const pending = t.engine.step('unknown'); await entered.promise
  const other = createOfflineCampaignEngine({ identity, repository: t.repository })
  await other.resume('unknown', 'takeover')
  const snapshot = await other.step('unknown')
  assert.equal(snapshot.head.status, 'blocked'); assert.equal(snapshot.checkpoint.reason, 'dispatch_outcome_unknown')
  gate.resolve(); await pending
  assert.equal((await other.inspect('unknown'))!.artifacts.size, 0); assert.equal(t.calls(), 1)
  count++
}
// Exact numeric edge and overflow, including a request exceeding one bounded envelope.
{
  const manifest = await createOfflineCampaignManifest({ identity, campaignId: 'budget', language: 'zh' })
  const delta = emptyCampaignBudget(); delta.attempts = manifest.budget.attempts
  assert.equal(reserveCampaignBudget(manifest, emptyCampaignBudget(), delta).attempts, manifest.budget.attempts)
  delta.attempts++; assert.throws(() => reserveCampaignBudget(manifest, emptyCampaignBudget(), delta))
  for (const bad of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => checkedCampaignAdd(bad, 1))
  assert.throws(() => campaignRequestReservation(65_537, 65_537, 5))
  count++
}
// Clock rollback/deadline block execution without a dispatch or budget reset.
for (const change of [-1, 7 * 86_400_000]) {
  let now = 1_800_000_000_000
  const storage = memoryIO(), repository = createCampaignRepository(storage.io)
  const engine = createOfflineCampaignEngine({ identity, repository, clock: () => now })
  await engine.prepare({ campaignId: `clock-${change < 0 ? 'back' : 'deadline'}`, language: 'en' })
  now += change
  const snapshot = await engine.step(`clock-${change < 0 ? 'back' : 'deadline'}`)
  assert.equal(snapshot.head.status, 'blocked'); assert.equal(snapshot.checkpoint.budget.attempts, 0); count++
}

// Inject every durable boundary through the production repository, never rewriting its checkpoint in a fixture.
for (const kind of ['reserve', 'dispatch_intent', 'retain_response', 'accept_artifact']) for (const after of [false, true]) {
  const t = setup(), id = `boundary-${kind}-${after ? 'after' : 'before'}`
  await t.engine.prepare({ campaignId: id, language: 'en' })
  let fired = false
  const fault = async (entries: ReadonlyArray<{key: string; value: string}>) => {
    if (!fired && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === kind)) { fired = true; throw new Error('injected boundary failure') }
  }
  if (after) t.storage.setAfter(fault); else t.storage.setHook(fault)
  let snapshot = await t.engine.step(id, 'boundary')
  assert.equal(fired, true)
  t.storage.setAfter(); t.storage.setHook()
  const previousWrites = t.storage.writes
  await t.engine.step(id, 'boundary'); assert.equal(t.storage.writes, previousWrites)
  const restart = createOfflineCampaignEngine({ identity, repository: t.repository })
  if ((kind === 'retain_response' && after) || (kind === 'accept_artifact' && !after)) {
    assert.ok(snapshot.checkpoint.tasks.some(task => task.status === 'response_retained'))
    snapshot = await restart.recoverSaveOnly(id, 'save-only')
    assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed'); assert.equal(t.calls(), 1)
  } else if (kind === 'accept_artifact' && after) {
    assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed'); assert.equal(snapshot.head.status, 'running')
    assert.equal(t.calls(), 1)
  } else if (kind === 'dispatch_intent' && after || kind === 'retain_response' && !after) {
    await restart.resume(id, 'resume-unknown')
    snapshot = await restart.step(id)
    assert.equal(snapshot.head.status, 'blocked'); assert.equal(snapshot.checkpoint.reason, 'dispatch_outcome_unknown')
    assert.equal(t.calls(), kind === 'dispatch_intent' ? 0 : 1)
  } else {
    const attempts = snapshot.checkpoint.budget.attempts
    await restart.resume(id, 'resume-safe')
    snapshot = await restart.step(id)
    assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed')
    assert.equal(snapshot.checkpoint.budget.attempts, attempts || 1)
  }
  count++
}
// Same host may reconcile an already completed invocation; a fresh host must not fabricate evidence.
{
  const t = setup(); await t.engine.prepare({ campaignId: 'existing-evidence', language: 'en' })
  let fired = false
  t.storage.setHook(async entries => {
    if (!fired && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === 'retain_response')) { fired = true; throw new Error('retention interrupted') }
  })
  await t.engine.step('existing-evidence'); t.storage.setHook()
  await t.engine.resume('existing-evidence')
  const snapshot = await t.engine.step('existing-evidence')
  assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed'); assert.equal(t.calls(), 1); count++
}
// A late old save may still be pending: a winning epoch fence, not receipt absence, makes a save-only retry safe.
{
  const t = setup(), gate = deferred<void>(), entered = deferred<void>()
  const engine = createOfflineCampaignEngine({ identity, repository: t.repository, host: t.host, ioTimeoutMs: 20 })
  await engine.prepare({ campaignId: 'late-save', language: 'en' })
  let held = false
  t.storage.setHook(async entries => {
    if (!held && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === 'accept_artifact')) { held = true; entered.resolve(); await gate.promise }
  })
  const pending = engine.step('late-save', 'original'); await entered.promise
  await pending
  const restart = createOfflineCampaignEngine({ identity, repository: t.repository })
  const snapshot = await restart.recoverSaveOnly('late-save', 'fenced-save')
  gate.resolve(); await new Promise(r => setTimeout(r, 0))
  assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed'); assert.equal(t.calls(), 1)
  assert.equal((await restart.inspect('late-save'))!.checkpoint.tasks[0]!.artifact!.revision, 0); count++
}
// Dispatch authorization predating cancel may physically invoke later; cancellation never promises zero calls.
{
  const t = setup(), gate = deferred<void>(), entered = deferred<void>()
  const dispatch = t.host.provider.dispatch.bind(t.host.provider)
  t.host.provider.dispatch = async (...args) => { entered.resolve(); await gate.promise; return dispatch(...args) }
  await t.engine.prepare({ campaignId: 'late-invoke', language: 'zh' })
  const pending = t.engine.step('late-invoke'); await entered.promise
  await t.engine.cancel('late-invoke'); await pending
  assert.equal(t.calls(), 0)
  gate.resolve(); await new Promise(r => setTimeout(r, 5))
  assert.equal(t.calls(), 1)
  const snapshot = (await t.engine.inspect('late-invoke'))!
  assert.equal(snapshot.head.status, 'cancelled'); assert.equal(snapshot.artifacts.size, 0); assert.equal(snapshot.checkpoint.budget.attempts, 1)
  count++
}
// Revision replacement atomically drops transitive body eligibility/counts and preserves immutable lineage.
{
  const t = setup(); await t.engine.prepare({ campaignId: 'revisions', language: 'zh' })
  const original = await finish(t.engine, 'revisions'), attempts = original.checkpoint.budget.attempts
  let snapshot = await t.engine.replaceCandidate('revisions', 'outline', 'Replacement synthetic outline.', 'replace')
  assert.equal(snapshot.checkpoint.bodyCharacters, 0)
  assert.equal(snapshot.checkpoint.tasks.filter(task => task.status === 'invalidated').length, 4)
  assert.equal(snapshot.checkpoint.budget.attempts, attempts)
  const writes = t.storage.writes
  await t.engine.replaceCandidate('revisions', 'outline', 'Replacement synthetic outline.', 'replace')
  assert.equal(t.storage.writes, writes)
  await assert.rejects(() => t.engine.replaceCandidate('revisions', 'outline', 'Different text.', 'replace'))
  await assert.rejects(() => t.engine.replaceCandidate('revisions', 'characters', 'Replacement synthetic outline.', 'replace'))
  await t.engine.resume('revisions')
  snapshot = await finish(t.engine, 'revisions')
  assert.equal(snapshot.checkpoint.tasks.every(task => task.artifact!.revision === 1), true)
  assert.equal(snapshot.checkpoint.budget.attempts, attempts + 4)
  assert.ok(snapshot.checkpoint.bodyCharacters > 0); count++
}
// Concurrent commands on the same durable head have one reservation winner and no second provider call.
{
  const t = setup(); await t.engine.prepare({ campaignId: 'concurrent', language: 'en' }); await t.engine.resume('concurrent')
  const other = createOfflineCampaignEngine({ identity, repository: t.repository })
  await Promise.all([t.engine.step('concurrent', 'a'), other.step('concurrent', 'b')])
  const snapshot = (await t.engine.inspect('concurrent'))!
  assert.equal(snapshot.checkpoint.budget.attempts, 1); assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed'); assert.equal(t.calls(), 1)
  count++
}
// Future schemas are delegated to strict repository validation and never overwritten by recovery.
{
  const t = setup(); await t.engine.prepare({ campaignId: 'future', language: 'en' })
  const headKey = [...t.storage.rows.keys()].find(key => key.endsWith(':head'))!
  const raw = t.storage.rows.get(headKey)!, value = JSON.parse(raw); value.schemaVersion = 2
  t.storage.rows.set(headKey, JSON.stringify(value)); const writes = t.storage.writes
  await assert.rejects(() => t.engine.step('future')); assert.equal(t.storage.writes, writes)
  assert.equal(t.storage.rows.get(headKey), JSON.stringify(value)); count++
}
// A changed build identity remains inspectable, but cannot start, recover or mutate the stored campaign.
{
  const t = setup(); await t.engine.prepare({ campaignId: 'identity-change', language: 'en' })
  const other = createOfflineCampaignEngine({ identity: { ...identity, runtimeIdentity: 'different-controlled-build' }, repository: t.repository })
  assert.ok(await other.inspect('identity-change'))
  const writes = t.storage.writes
  await assert.rejects(() => other.step('identity-change'))
  await assert.rejects(() => other.resume('identity-change'))
  await assert.rejects(() => other.recoverSaveOnly('identity-change'))
  assert.equal(t.storage.writes, writes); count++
}
// Host permits are private, bound and consumed once; stored request JSON cannot mint another authorization.
{
  const t = setup()
  let captured: Parameters<typeof t.host.provider.dispatch> | null = null
  const dispatch = t.host.provider.dispatch.bind(t.host.provider)
  t.host.provider.dispatch = async (...args) => { captured = args; return dispatch(...args) }
  await t.engine.prepare({ campaignId: 'permit', language: 'en' })
  await t.engine.step('permit')
  assert.ok(captured)
  const args = captured as unknown as Parameters<typeof t.host.provider.dispatch>
  await assert.rejects(() => dispatch(...args))
  assert.throws(() => t.host.issuePermit(args[0]))
  await assert.rejects(() => dispatch(args[0], {} as typeof args[1], new AbortController().signal))
  assert.equal(t.calls(), 1); count++
}
console.log(JSON.stringify({ suite: 'writer-campaign-engine', passed: count, liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
} catch {
  console.error(JSON.stringify({ suite: 'writer-campaign-engine', passed: count, failedCase: count + 1, category: 'check_failed', longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
} finally {
  globalThis.fetch = oldFetch
}
