/** Deterministic production engine/repository contract tests. No network or real model calls. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { CampaignRepositoryIO, CampaignSnapshot, CampaignMutation } from '../src/types/writerCampaign'
import { campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createOfflineFixtureHost } from '../src/services/writerCampaign/fixtureAdapter'
import { decodeStorageBytes, canonicalStringify, utf8Bytes } from '../src/services/writerCampaign/protocol'
import { campaignRequestStorageAllowance, campaignRequestReservation, checkedCampaignAdd, emptyCampaignBudget, reserveCampaignBudget } from '../src/services/writerCampaign/budget'

const oldFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Network forbidden in offline campaign') }
const identity = { runtimeIdentity: 'controlled-engine-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
let count = 0
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function memoryIO() {
  const rows = new Map<string, string>()
  let writes = 0, cumulativeBytes = 0
  let after: ((entries: ReadonlyArray<{key: string; expectedValue: string | null; value: string}>) => Promise<void>) | undefined
  let hook: ((entries: ReadonlyArray<{key: string; expectedValue: string | null; value: string}>) => Promise<void>) | undefined
  const io: CampaignRepositoryIO = {
    async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit) {
      await hook?.(entries)
      if (canCommit && !canCommit()) return false
      if (entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
      const charge = entries.reduce((sum, entry) => sum + new TextEncoder().encode(entry.key).length + new TextEncoder().encode(entry.value).length, 0)
      const receiptEntry = entries.find(entry => entry.key.includes(':receipt:'))!
      const checkpointEntry = entries.find(entry => entry.key.includes(':checkpoint:'))!
      const receipt = JSON.parse(receiptEntry.value), checkpoint = JSON.parse(checkpointEntry.value)
      assert.equal(decodeStorageBytes(receipt.serializedBytes), charge)
      assert.equal(decodeStorageBytes(checkpoint.storage.writtenBytes), cumulativeBytes + charge)
      const ledger = checkpoint.storage
      const outstanding = decodeStorageBytes(ledger.outstandingBytes)
      assert.equal(decodeStorageBytes(ledger.allocatedBytes) - decodeStorageBytes(ledger.allocationConsumedBytes) - decodeStorageBytes(ledger.releasedBytes), outstanding)
      assert.equal(ledger.openAllocations.reduce((sum: number, row: { remainingBytes: string }) => sum + decodeStorageBytes(row.remainingBytes), 0), outstanding)
      assert.ok(cumulativeBytes + charge + outstanding + decodeStorageBytes(ledger.recoveryRemainingBytes) <= 67_108_864)
      for (const entry of entries) rows.set(entry.key, entry.value)
      cumulativeBytes += charge; writes++
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
  let snapshot = (await engine.inspect(id))! as CampaignSnapshot
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
  assert.equal(decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes), 0); assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
  assert.ok(decodeStorageBytes(snapshot.checkpoint.storage.releasedBytes) > 0)
  assert.equal(snapshot.checkpoint.budget.attempts, 5)
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
  const raw = t.storage.rows.get(headKey)!, value = JSON.parse(raw); value.schemaVersion = 3
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
// Immutable allowances measure the actual outer JSON input layer, not its UTF-8 input count.
{
  const t = setup({ responseFor: () => 'Escaped input: "\\\u0000\n\t中😀', responseBytesFor: () => 256 })
  await t.engine.prepare({ campaignId: 'outer-json', language: 'en' })
  await t.engine.step('outer-json', 'first'); const snapshot = await t.engine.step('outer-json', 'second')
  const request = [...snapshot.requests.values()].find(request => request.commandId === 'second')!
  const outerBytes = utf8Bytes(canonicalStringify(request.preparedInput))
  assert.ok(outerBytes > request.inputBytes)
  assert.equal(decodeStorageBytes(request.storageAllocationBytes), 5 * (16_384 + 1_024 * 5 + 512 * 128) + 5 * (8_192 + outerBytes) + 3 * (6 * 256 + 2) + 4_096 + 256 * 5)
  assert.equal(request.storageAllocationBytes, campaignRequestStorageAllowance(request.preparedInput, 5, 256))
  assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
  assert.equal(snapshot.checkpoint.budget.attempts, 2); assert.equal(t.calls(), 2); count++
}
// Replacement detaches eligibility, never the unresolved allocation, across every open phase.
for (const phase of ['reserve', 'dispatch_intent', 'retain_response'] as const) {
  const t = setup(), id = `detached-${phase}`
  await t.engine.prepare({ campaignId: id, language: 'en' }); await t.engine.step(id, 'outline')
  let interrupted = false
  t.storage.setAfter(async entries => {
    if (!interrupted && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === phase)) {
      interrupted = true; throw new Error('Interrupt after exact open phase')
    }
  })
  const before = await t.engine.step(id, 'old-character'); t.storage.setAfter()
  assert.equal(interrupted, true)
  assert.equal(before.checkpoint.storage.openAllocations.length, 1)
  const obligation = structuredClone(before.checkpoint.storage.openAllocations[0]!)
  const attempts = before.checkpoint.budget.attempts, released = before.checkpoint.storage.releasedBytes
  const replaced = await t.engine.replaceCandidate(id, 'outline', 'New synthetic outline.', 'replace-outline')
  assert.deepEqual(replaced.checkpoint.storage.openAllocations, [obligation])
  assert.equal(replaced.checkpoint.storage.releasedBytes, released)
  assert.equal(replaced.checkpoint.budget.attempts, attempts)
  assert.equal(replaced.checkpoint.tasks.find(task => task.taskId === 'characters')!.request, null)
  // Neither the detached latest request nor its origin may disappear from cold verification.
  for (const revision of new Set([0, obligation.request.revision])) {
    const key = campaignKeys.request(id, obligation.request.id, revision), raw = t.storage.rows.get(key)!
    const damaged = JSON.parse(raw); damaged.failureReason = 'Corrupt inactive request evidence'
    t.storage.rows.set(key, JSON.stringify(damaged)); const unchanged = [...t.storage.rows.entries()]
    await assert.rejects(() => createCampaignRepository(t.storage.io).read(id))
    assert.deepEqual([...t.storage.rows.entries()], unchanged, 'A rejecting read must preserve damaged bytes')
    t.storage.rows.set(key, raw)
  }
  const cold = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  const inspection = await cold.inspect(id) as CampaignSnapshot
  assert.deepEqual(inspection.checkpoint.storage.openAllocations, [obligation])
  assert.ok(inspection.requests.has(obligation.request.hash))
  await cold.resume(id, 'resume-new'); const accepted = await cold.step(id, 'new-character')
  assert.deepEqual(accepted.checkpoint.storage.openAllocations, [obligation])
  assert.equal(accepted.checkpoint.budget.attempts, attempts + 1)
  const nextRequest = accepted.requests.get(accepted.checkpoint.tasks.find(task => task.taskId === 'characters')!.request!.hash)!
  assert.notEqual(nextRequest.id, obligation.request.id)
  assert.equal(await t.repository.getReceipt(id, 'old-character:artifact'), null)
  assert.equal((await t.repository.getReceipt(id, 'new-character:artifact'))!.storageEffect.requestId, nextRequest.id)
  count++
}
// A different owner replaces an ancestor while dispatch is alive; the old callback cannot settle either candidate.
{
  const entered = deferred<void>(), release = deferred<void>()
  const t = setup({ onDispatch: async request => { if (request.taskId === 'characters') { entered.resolve(); await release.promise } } })
  const id = 'replacement-late-response'
  await t.engine.prepare({ campaignId: id, language: 'zh' }); await t.engine.step(id, 'original-outline')
  const pending = t.engine.step(id, 'old-character'); await entered.promise
  const before = (await t.repository.read(id))!, obligation = structuredClone(before.checkpoint.storage.openAllocations[0]!)
  let newCalls = 0
  const other = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io), fixture: { onDispatch() { newCalls++ } } })
  await other.replaceCandidate(id, 'outline', 'Replacement while old response is pending.', 'other-replace')
  release.resolve(); await pending
  let current = (await t.repository.read(id))!
  assert.deepEqual(current.checkpoint.storage.openAllocations, [obligation])
  assert.equal(current.checkpoint.tasks.find(task => task.taskId === 'characters')!.artifact, null)
  await other.resume(id, 'other-resume'); current = await other.step(id, 'new-character')
  assert.deepEqual(current.checkpoint.storage.openAllocations, [obligation])
  assert.equal(current.checkpoint.budget.attempts, 3)
  assert.equal(t.calls(), 2); assert.equal(newCalls, 1)
  assert.equal(await t.repository.getReceipt(id, 'old-character:artifact'), null); count++
}
// The original retained response/accept intent cannot be attached or settled after its candidate is replaced.
{
  const t = setup(), id = 'stale-accept'
  await t.engine.prepare({ campaignId: id, language: 'en' }); await t.engine.step(id, 'outline')
  const commit = t.repository.commit.bind(t.repository)
  let stale: { expected: CampaignSnapshot; mutation: CampaignMutation } | null = null
  t.repository.commit = async (expected, mutation, canCommit) => {
    if (!stale && mutation.operationId === 'old-character:artifact') { stale = { expected, mutation: structuredClone(mutation) }; throw new Error('Hold original acceptance') }
    return commit(expected, mutation, canCommit)
  }
  await t.engine.step(id, 'old-character'); t.repository.commit = commit
  assert.ok(stale)
  const captured = stale as unknown as { expected: CampaignSnapshot; mutation: CampaignMutation }
  const replaced = await t.engine.replaceCandidate(id, 'outline', 'Replacement makes old retained response ineligible.', 'replace')
  const writes = t.storage.writes, storage = structuredClone(replaced.checkpoint.storage)
  await assert.rejects(() => t.repository.commit(captured.expected, captured.mutation))
  await assert.rejects(() => t.repository.commit(replaced, captured.mutation))
  assert.equal(t.storage.writes, writes)
  assert.deepEqual((await t.repository.read(id))!.checkpoint.storage, storage)
  assert.equal(await t.repository.getReceipt(id, 'old-character:artifact'), null); count++
}
// Unknown allocations survive repeated control/reconciliation cycles, then terminal cancellation/replay.
{
  const t = setup({ onDispatch() { throw new Error('No trusted completion evidence') } }), id = 'unknown-controls'
  await t.engine.prepare({ campaignId: id, language: 'en' })
  const unknown = await t.engine.step(id, 'unknown-call'), obligation = structuredClone(unknown.checkpoint.storage.openAllocations[0]!)
  const reservation = { ...unknown.checkpoint.budget }, released = unknown.checkpoint.storage.releasedBytes
  let current = unknown
  for (let i = 0; i < 3; i++) {
    await t.engine.pause(id, `pause-${i}`); await t.engine.resume(id, `resume-${i}`)
    current = await t.engine.step(id, `reconcile-${i}`)
    assert.deepEqual(current.checkpoint.storage.openAllocations, [obligation])
    assert.equal(current.checkpoint.storage.releasedBytes, released)
    for (const key of ['attempts', 'inputBytes', 'inputUtf16', 'outputTokens', 'reasoningTokens', 'responseBytes'] as const) assert.equal(current.checkpoint.budget[key], reservation[key])
  }
  current = await t.engine.cancel(id, 'terminal')
  assert.deepEqual(current.checkpoint.storage.openAllocations, [obligation])
  assert.ok(decodeStorageBytes(current.checkpoint.storage.recoveryRemainingBytes) < decodeStorageBytes(unknown.checkpoint.storage.recoveryRemainingBytes))
  const writes = t.storage.writes
  await t.engine.cancel(id, 'terminal'); await t.engine.resume(id, 'no-revive'); await t.engine.step(id, 'no-replay')
  assert.equal(t.storage.writes, writes); assert.equal(t.calls(), 1); count++
}
// Lost acceptance ACK after a newer head is durable still proves one release and exact read-only replay.
{
  const t = setup(), id = 'advanced-accept-ack'
  await t.engine.prepare({ campaignId: id, language: 'en' })
  const other = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  let lost = false
  t.storage.setAfter(async entries => {
    if (!lost && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === 'accept_artifact')) {
      lost = true; await other.pause(id, 'newer-head'); throw new Error('Lost original accept acknowledgement')
    }
  })
  const accepted = await t.engine.step(id, 'original'); t.storage.setAfter()
  assert.equal(accepted.head.status, 'paused'); assert.equal(accepted.checkpoint.tasks[0]!.status, 'committed')
  assert.equal(accepted.checkpoint.storage.openAllocations.length, 0)
  const receipt = (await t.repository.getReceipt(id, 'original:artifact'))!
  assert.ok(decodeStorageBytes(receipt.storageEffect.releasedBytes) > 0)
  const writes = t.storage.writes, storage = structuredClone(accepted.checkpoint.storage)
  await other.step(id, 'original')
  assert.equal(t.storage.writes, writes); assert.deepEqual((await t.repository.read(id))!.checkpoint.storage, storage)
  assert.equal(t.calls(), 1); count++
}

// Two save-only owners may race, but one original acceptance/settlement wins without a new attempt.
{
  const t = setup(), id = 'two-recovery-owners'
  await t.engine.prepare({ campaignId: id, language: 'en' })
  let stopped = false
  t.storage.setHook(async entries => {
    if (!stopped && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === 'accept_artifact')) { stopped = true; throw new Error('Retain without acceptance') }
  })
  await t.engine.step(id, 'original'); t.storage.setHook()
  const a = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  const b = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  const results = await Promise.allSettled([a.recoverSaveOnly(id, 'recover-a'), b.recoverSaveOnly(id, 'recover-b')])
  assert.ok(results.some(result => result.status === 'fulfilled'))
  const final = (await t.repository.read(id))!
  assert.equal(final.checkpoint.tasks[0]!.status, 'committed'); assert.equal(final.checkpoint.storage.openAllocations.length, 0)
  assert.equal(final.checkpoint.budget.attempts, 1); assert.equal(t.calls(), 1)
  assert.equal([...t.storage.rows.entries()].filter(([key, raw]) => key.includes(':receipt:') && JSON.parse(raw).kind === 'accept_artifact').length, 1)
  assert.equal((await t.repository.getReceipt(id, 'original:artifact'))!.storageEffect.requestId, [...final.requests.values()][0]!.id)
  count++
}
// A cancel winning immediately before acceptance preserves the retained allocation and prevents release.
{
  const t = setup(), id = 'cancel-before-accept', entered = deferred<void>(), release = deferred<void>()
  await t.engine.prepare({ campaignId: id, language: 'en' })
  let held = false
  t.storage.setHook(async entries => {
    if (!held && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === 'accept_artifact')) { held = true; entered.resolve(); await release.promise }
  })
  const pending = t.engine.step(id, 'original'); await entered.promise
  const before = (await t.repository.read(id))!, obligation = structuredClone(before.checkpoint.storage.openAllocations[0]!)
  const other = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  await other.cancel(id, 'winning-cancel'); release.resolve(); await pending; t.storage.setHook()
  const final = (await t.repository.read(id))!
  assert.equal(final.head.status, 'cancelled'); assert.equal(final.artifacts.size, 0)
  assert.deepEqual(final.checkpoint.storage.openAllocations, [obligation])
  assert.equal(final.checkpoint.storage.releasedBytes, before.checkpoint.storage.releasedBytes)
  assert.equal(await t.repository.getReceipt(id, 'original:artifact'), null)
  assert.equal(final.checkpoint.budget.attempts, 1); assert.equal(t.calls(), 1); count++
}

// A normal step has only its entry read at the engine layer; each commit still fully verifies independently.
{
  const t = setup(), id = 'single-engine-read'
  await t.engine.prepare({ campaignId: id, language: 'en' }); await t.engine.resume(id, 'already-running')
  const read = t.repository.read.bind(t.repository); let reads = 0
  t.repository.read = async campaignId => { reads++; return read(campaignId) }
  const snapshot = await t.engine.step(id, 'one-step')
  assert.equal(reads, 1); assert.equal(snapshot.checkpoint.tasks[0]!.status, 'committed')
  assert.equal(t.calls(), 1); assert.equal(snapshot.checkpoint.budget.attempts, 1); count++
}
// A different owner changes the head after reserve ACK but before intent: no authorization or permit is minted.
for (const control of ['pause', 'cancel'] as const) {
  const t = setup(), id = `reserve-before-${control}`
  await t.engine.prepare({ campaignId: id, language: 'en' })
  const other = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  let changed = false
  t.storage.setAfter(async entries => {
    if (!changed && entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === 'reserve')) {
      changed = true; await other[control](id, 'winning-control')
    }
  })
  const snapshot = await t.engine.step(id, 'original'); t.storage.setAfter()
  assert.equal(changed, true); assert.equal(snapshot.head.status, control === 'cancel' ? 'cancelled' : 'paused')
  assert.equal(snapshot.checkpoint.tasks[0]!.status, 'reserved'); assert.equal(snapshot.checkpoint.budget.attempts, 1)
  assert.equal(snapshot.checkpoint.storage.openAllocations.length, 1)
  assert.equal(await t.repository.getReceipt(id, 'original:intent'), null); assert.equal(t.calls(), 0)
  const writes = t.storage.writes; await other.step(id, 'original')
  assert.equal(t.storage.writes, writes); assert.equal(t.calls(), 0); count++
}
// A control after authorized dispatch cannot retract its one call, but must reject retention against the old head.
for (const control of ['pause', 'cancel'] as const) {
  const id = `dispatch-before-${control}`, t = setup({ onDispatch: async () => { await other[control](id, 'winning-control') } })
  await t.engine.prepare({ campaignId: id, language: 'en' })
  const other = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  const snapshot = await t.engine.step(id, 'original')
  assert.equal(snapshot.head.status, control === 'cancel' ? 'cancelled' : 'paused')
  assert.equal(snapshot.checkpoint.tasks[0]!.status, 'dispatch_intent'); assert.equal(snapshot.artifacts.size, 0)
  assert.equal(await t.repository.getReceipt(id, 'original:retain'), null)
  assert.equal(snapshot.checkpoint.storage.openAllocations.length, 1); assert.equal(snapshot.checkpoint.budget.attempts, 1); assert.equal(t.calls(), 1)
  if (control === 'pause') {
    await other.resume(id, 'fresh-owner')
    const unknown = await other.step(id, 'no-completion-evidence')
    assert.equal(unknown.checkpoint.tasks[0]!.status, 'outcome_unknown')
    assert.equal(unknown.checkpoint.storage.openAllocations[0]!.request.id, snapshot.checkpoint.storage.openAllocations[0]!.request.id)
    assert.equal(unknown.checkpoint.budget.attempts, 1)
  } else {
    const writes = t.storage.writes; await other.resume(id, 'terminal-no-revive'); await other.step(id, 'terminal-no-replay')
    assert.equal(t.storage.writes, writes)
  }
  assert.equal(t.calls(), 1); count++
}
// An unchanged head never makes corrupted immutable bytes trusted: the next commit does a complete fresh read.
for (const phase of ['reserve', 'dispatch'] as const) for (const target of ['request', 'manifest'] as const) {
  const id = `same-head-${phase}-${target}`
  const t = setup({ onDispatch: () => { if (phase === 'dispatch') corrupt() } })
  const prepared = await t.engine.prepare({ campaignId: id, language: 'en' })
  let changed = false, key = '', original = '', rawHead = '', damaged: Array<[string, string]> = []
  function corrupt() {
    if (changed) return
    changed = true
    const head = JSON.parse(t.storage.rows.get(campaignKeys.head(id))!)
    const checkpoint = JSON.parse(t.storage.rows.get(campaignKeys.checkpoint(id, head.sequence))!)
    const request = checkpoint.tasks[0].request
    key = target === 'manifest' ? campaignKeys.manifest(id, prepared.manifest.hash) : campaignKeys.request(id, request.id, request.revision)
    original = t.storage.rows.get(key)!; const invalid = JSON.parse(original)
    if (target === 'manifest') invalid.source.tree = 'c'.repeat(40)
    else invalid.failureReason = 'Changed bytes with no corresponding new hash'
    rawHead = t.storage.rows.get(campaignKeys.head(id))!
    t.storage.rows.set(key, JSON.stringify(invalid)); damaged = [...t.storage.rows.entries()]
  }
  if (phase === 'reserve') t.storage.setAfter(async entries => {
    if (entries.some(entry => entry.key.includes(':receipt:') && JSON.parse(entry.value).kind === 'reserve')) corrupt()
  })
  await assert.rejects(() => t.engine.step(id, 'original')); t.storage.setAfter()
  assert.equal(changed, true); assert.equal(t.storage.rows.get(campaignKeys.head(id)), rawHead)
  assert.deepEqual([...t.storage.rows.entries()], damaged, 'Corrupt evidence must not be rewritten or reset')
  assert.equal(t.calls(), phase === 'dispatch' ? 1 : 0)
  t.storage.rows.set(key, original)
  const restored = (await t.repository.read(id))!
  assert.equal(restored.checkpoint.budget.attempts, 1); assert.equal(restored.checkpoint.storage.openAllocations.length, 1)
  assert.equal(await t.repository.getReceipt(id, phase === 'dispatch' ? 'original:retain' : 'original:intent'), null)
  const fresh = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) })
  if (phase === 'dispatch') {
    await fresh.resume(id, 'new-owner'); const unknown = await fresh.step(id, 'no-reconstructed-evidence')
    assert.equal(unknown.checkpoint.tasks[0]!.status, 'outcome_unknown'); assert.equal(unknown.checkpoint.budget.attempts, 1)
  } else {
    const writes = t.storage.writes; await fresh.step(id, 'original'); assert.equal(t.storage.writes, writes)
  }
  assert.equal(t.calls(), phase === 'dispatch' ? 1 : 0); count++
}

// Accepted-main v1 bytes remain inspectable even with the exact current runtime identity, never mutable.
{
  const frozen = JSON.parse(fs.readFileSync(new URL('./fixtures/campaign-v1-genesis.json', import.meta.url), 'utf8'))
  const storage = memoryIO()
  for (const [key, value] of frozen.entries) storage.rows.set(key, value)
  const repository = createCampaignRepository(storage.io), engine = createOfflineCampaignEngine({ identity: frozen.identity, repository })
  const legacy = await engine.inspect(frozen.campaignId)
  assert.equal(legacy!.manifest.schemaVersion, 1)
  assert.equal(legacy!.manifest.runtimeIdentity, frozen.identity.runtimeIdentity)
  const original = [...storage.rows.entries()]
  await assert.rejects(() => engine.step(frozen.campaignId))
  await assert.rejects(() => engine.pause(frozen.campaignId))
  await assert.rejects(() => engine.resume(frozen.campaignId))
  await assert.rejects(() => engine.cancel(frozen.campaignId))
  await assert.rejects(() => engine.recoverSaveOnly(frozen.campaignId))
  await assert.rejects(() => engine.replaceCandidate(frozen.campaignId, 'outline', 'Must not replace legacy'))
  await assert.rejects(() => engine.prepare({ campaignId: frozen.campaignId, language: 'en' }))
  await assert.rejects(() => engine.prepare(legacy!.manifest as never))
  assert.equal(storage.writes, 0); assert.deepEqual([...storage.rows.entries()], original)
  assert.equal((await engine.inspect(frozen.campaignId))!.manifest.schemaVersion, 1); count++
}

console.log(JSON.stringify({ suite: 'writer-campaign-engine', passed: count, liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
} catch {
  console.error(JSON.stringify({ suite: 'writer-campaign-engine', passed: count, failedCase: count + 1, category: 'check_failed', longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
} finally {
  globalThis.fetch = oldFetch
}
