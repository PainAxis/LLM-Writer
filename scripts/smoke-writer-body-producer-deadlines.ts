/** Deterministic monotonic-deadline controls over the real engine/repository.
 * No CPU sleeps, widened deadlines, external endpoints or browser execution. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import type { BodyProducerAdapter, ProducerActionScope, ProducerCampaignReceipt, ProducerCampaignRepository, ProducerCampaignSnapshot } from '../src/types/bodyProducer'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createProducerCampaignRepository, producerKeys } from '../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine } from '../src/services/writerCampaign/bodyProducerEngine'
import { canonicalStringify, decodeStorageBytes } from '../src/services/writerCampaign/protocol'
import { createProducerNodeServer } from './fixtures/writer-body-producer-node-server'

const wall = 1_900_000_000_000, campaignId = 'producer-deadline-controls'
const identity = { runtimeIdentity: 'producer-deadline-runtime', source: { commit: null, tree: null } }
const body = 'Mira left the violet compass beside the amber bowl. 雨停了。😀\r\ne\u0301'
const selection = { chapterOrdinal: 3, startUtf16: 0, endUtf16: body.length, planningRefs: [] }
const digest = (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
let monotonic = 0
const originalNow = Object.getOwnPropertyDescriptor(performance, 'now')
Object.defineProperty(performance, 'now', { configurable: true, value: () => monotonic })
const advance = (milliseconds: number) => { monotonic += milliseconds }
type Entries = Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]
class AtomicIO implements CampaignRepositoryIO {
  disk = new Map<string, string>()
  reads: string[][] = []
  writes = 0
  receipts: ProducerCampaignReceipt[] = []
  beforeCas: ((receipt: ProducerCampaignReceipt | null) => void | Promise<void>) | null = null
  afterCas: ((receipt: ProducerCampaignReceipt | null) => void | Promise<void>) | null = null
  rejectedCas = 0
  async getMany(keys: readonly string[]) {
    this.reads.push([...keys])
    return new Map(keys.map(key => [key, this.disk.get(key) ?? null]))
  }
  async compareAndSwapMany(entries: Entries, canCommit = () => true) {
    const receipt = entries.map(entry => JSON.parse(entry.value)).find(value => value?.protocolVersion === 'campaign-v3-receipt') as ProducerCampaignReceipt | undefined
    await this.beforeCas?.(receipt ?? null)
    if (!canCommit() || entries.some(entry => (this.disk.get(entry.key) ?? null) !== entry.expectedValue)) { this.rejectedCas++; return false }
    for (const entry of entries) this.disk.set(entry.key, entry.value)
    this.writes++
    if (receipt) this.receipts.push(receipt)
    await this.afterCas?.(receipt ?? null)
    return true
  }
  fork() { const next = new AtomicIO(); next.disk = new Map(this.disk); return next }
}
function monolithic(repository: ProducerCampaignRepository): ProducerCampaignRepository {
  // Keep the original public/monolithic three-second contract independently
  // tested, including cold reopen. Session owners have their separate suite.
  return { ...repository, verifyCurrent: undefined, adoptVerified: undefined, getVerificationStats: undefined }
}
function trackedRepository(io: AtomicIO) {
  const actual = createProducerCampaignRepository({ io, clock: () => wall }), scopes = new Set<ProducerActionScope>()
  let created = 0, disposed = 0
  const repository: ProducerCampaignRepository = { ...monolithic(actual),
    createActionScope(id) { const scope = actual.createActionScope!(id); scopes.add(scope); created++; return scope },
    disposeActionScope(scope) { if (scopes.delete(scope)) disposed++; actual.disposeActionScope!(scope) },
  }
  const assertDisposed = () => {
    assert.ok(created > 0); assert.equal(scopes.size, 0); assert.equal(disposed, created)
    const stats = actual.getActionProofStats!()
    assert.equal(stats.retainedBytes, 0); assert.equal(stats.retainedEntries, 0); assert.equal(stats.activeRecords, 0)
  }
  return { actual, repository, scopes, assertDisposed }
}
function latest(snapshot: ProducerCampaignSnapshot) {
  const index = snapshot.checkpoint.producerRequests.at(-1)
  assert.ok(index)
  const phase = snapshot.phases.get(index.phaseHash), request = snapshot.requests.get(index.requestHash)
  assert.ok(phase && request)
  return { index, phase, request, response: phase.responseHash ? snapshot.responses.get(phase.responseHash) : null }
}
function conservation(snapshot: ProducerCampaignSnapshot) {
  const state = snapshot.checkpoint.storage, outstanding = decodeStorageBytes(state.outstandingBytes)
  assert.equal(decodeStorageBytes(state.allocatedBytes) - decodeStorageBytes(state.allocationConsumedBytes) - decodeStorageBytes(state.releasedBytes), outstanding)
  assert.equal(state.openAllocations.reduce((sum, row) => sum + decodeStorageBytes(row.remainingBytes), 0), outstanding)
  assert.ok(decodeStorageBytes(state.writtenBytes) + outstanding + decodeStorageBytes(state.recoveryRemainingBytes) <= 67_108_864)
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
const cases: string[] = [], unhandled: unknown[] = []
const onUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', onUnhandled)
const control = await createProducerNodeServer()
const base = new AtomicIO(), writer = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(base), clock: () => wall })
async function test(name: string, action: () => Promise<void>) { await action(); cases.push(name); console.log(`PASS ${name}`) }
try {
  await writer.prepareBodyEvidence({ campaignId, language: 'en' })
  for (let index = 0; index < 9; index++) await writer.step(campaignId, `seed-${index}`)
  const author = createBodyProducerEngine({ identity, repository: createProducerCampaignRepository({ io: base, clock: () => wall }), clock: () => wall })
  const adopted = await author.adopt(campaignId, 'adopt')
  const accepted = await author.reviseBody(campaignId, 3, body, adopted.rawHead, 'author-source')
  const initialAttempts = accepted.checkpoint.budget.attempts
  const fixture = (adapter: BodyProducerAdapter = control.adapter) => {
    const io = base.fork(), tracked = trackedRepository(io)
    const engine = createBodyProducerEngine({ identity, repository: tracked.repository, adapters: [adapter], clock: () => wall })
    const reopen = () => createBodyProducerEngine({ identity, repository: monolithic(createProducerCampaignRepository({ io, clock: () => wall })), clock: () => wall })
    return { io, ...tracked, engine, reopen }
  }

  await test('verified_read_returned_at_3000ms_is_refused_before_timer_and_disposed', async () => {
    const f = fixture(), before = digest([...f.io.disk]), read = f.repository.read
    f.repository.read = async (...args) => { const value = await read(...args); advance(3_000); return value }
    await assert.rejects(f.engine.inspect(campaignId), { code: 'deadline_exceeded' })
    assert.equal(f.io.writes, 0); assert.equal(digest([...f.io.disk]), before); f.assertDisposed()
    f.repository.read = read
    assert.equal((await f.engine.inspect(campaignId))!.rawHead, accepted.rawHead); f.assertDisposed()
  })

  await test('final_cas_gate_at_3000ms_refuses_without_writes_or_rebased_source', async () => {
    const f = fixture(), before = digest([...f.io.disk])
    let entered = false
    f.io.beforeCas = receipt => { if (receipt?.kind === 'body_revision') { entered = true; advance(3_000) } }
    await assert.rejects(f.engine.reviseBody(campaignId, 3, `${body} A forbidden late revision.`, accepted.rawHead, 'late-cas'), { code: 'deadline_exceeded' })
    assert.equal(entered, true); assert.equal(f.io.rejectedCas, 1); assert.equal(f.io.writes, 0)
    assert.equal(digest([...f.io.disk]), before); f.assertDisposed()
    assert.equal(await f.actual.getReceipt(campaignId, 'late-cas'), null)
    assert.equal((await f.reopen().inspect(campaignId))!.rawHead, accepted.rawHead)
  })

  await test('timely_intent_cas_late_ack_gets_no_dispatch_permit_and_recovers_exact_unknown', async () => {
    const f = fixture(), beforeHttp = (await control.observeHttp()).attempts
    let intent: ProducerCampaignReceipt | null = null, readsAfterIntent = 0
    f.io.afterCas = receipt => { if (receipt?.kind === 'dispatch_intent' && !intent) { intent = receipt; readsAfterIntent = f.io.reads.length; advance(3_000) } }
    const handle = await f.engine.prepare(campaignId, selection, control.adapter.identity.adapterId)
    const result = await f.engine.invoke(handle, 'late-intent-ack'), state = latest(result)
    assert.ok(intent); assert.equal(state.phase.status, 'outcome_unknown'); assert.equal(state.response, null)
    assert.equal(state.phase.intentHash, (intent as ProducerCampaignReceipt).event.phaseHash)
    assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'reserve').length, 1)
    assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'dispatch_intent').length, 1)
    assert.equal(result.checkpoint.producerRequests.length, 1); assert.equal(result.checkpoint.budget.attempts, initialAttempts + 1)
    assert.ok(f.io.reads.slice(readsAfterIntent).some(keys => keys.includes(producerKeys.receipt(campaignId, 'late-intent-ack:intent'))))
    assert.ok(decodeStorageBytes(result.checkpoint.storage.outstandingBytes) > 0); conservation(result); f.assertDisposed()
    const writes = f.io.writes
    assert.equal((await f.engine.invoke(handle, 'late-intent-ack')).rawHead, result.rawHead)
    assert.equal((await f.reopen().recover(campaignId, state.index.id)).rawHead, result.rawHead)
    assert.equal(f.io.writes, writes); assert.equal((await control.observeHttp()).attempts, beforeHttp); f.assertDisposed()
  })

  await test('timely_retention_cas_late_ack_stays_retained_and_local_recovery_never_replays', async () => {
    const f = fixture(), beforeHttp = (await control.observeHttp()).attempts
    let retained: ProducerCampaignReceipt | null = null
    f.io.afterCas = receipt => { if (receipt?.kind === 'retain_response' && !retained) { retained = receipt; advance(3_000) } }
    const result = await f.engine.invoke(await f.engine.prepare(campaignId, selection, control.adapter.identity.adapterId), 'late-retention-ack'), state = latest(result)
    assert.ok(retained); assert.equal(state.phase.status, 'response_retained'); assert.ok(state.response); assert.equal(result.reviews.size, 0)
    assert.equal(state.phase.responseHash, (retained as ProducerCampaignReceipt).event.responseHash)
    assert.equal(result.checkpoint.budget.attempts, initialAttempts + 1); assert.ok(decodeStorageBytes(result.checkpoint.storage.outstandingBytes) > 0)
    assert.equal((await control.observeHttp()).attempts, beforeHttp + 1); conservation(result); f.assertDisposed()
    const reopened = f.reopen(), reloaded = await reopened.inspect(campaignId)
    assert.ok(reloaded); assert.equal(reloaded.rawHead, result.rawHead)
    const recovered = await reopened.recover(campaignId, state.index.id), complete = latest(recovered)
    assert.equal(complete.phase.status, 'resolved'); assert.equal(complete.phase.resolution?.outcome, 'review_ready')
    assert.equal(complete.phase.responseHash, state.phase.responseHash); assert.equal(recovered.checkpoint.budget.attempts, initialAttempts + 1)
    assert.equal(decodeStorageBytes(recovered.checkpoint.storage.outstandingBytes), 0)
    assert.equal((await control.observeHttp()).attempts, beforeHttp + 1); conservation(recovered)
  })

  await test('nested_intent_wait_cannot_renew_the_parent_transport_deadline', async () => {
    // Advance time before entering the actual SDK; the engine's 30 s parent
    // wait has only 2 s left even though a fresh repository wait allows 3 s.
    const delayedAdapter: BodyProducerAdapter = {
      identity: control.adapter.identity,
      assertCurrent: () => control.adapter.assertCurrent(),
      invoke(input) { advance(28_000); return control.adapter.invoke(input) },
    }
    const f = fixture(delayedAdapter), beforeHttp = (await control.observeHttp()).attempts
    let entered = false
    f.io.beforeCas = receipt => { if (receipt?.kind === 'dispatch_intent') { entered = true; advance(2_000) } }
    const result = await f.engine.invoke(await f.engine.prepare(campaignId, selection, control.adapter.identity.adapterId), 'nested-deadline'), state = latest(result)
    assert.equal(entered, true); assert.equal(f.io.rejectedCas, 1)
    assert.equal(state.phase.status, 'resolved'); assert.equal(state.phase.resolution?.outcome, 'not_dispatched')
    assert.equal(state.phase.resolution?.reason, 'deadline_exceeded'); assert.equal(state.phase.intentHash, null)
    assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'dispatch_intent').length, 0)
    assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'reserve').length, 1)
    assert.equal(result.checkpoint.budget.attempts, initialAttempts + 1); assert.equal(decodeStorageBytes(result.checkpoint.storage.outstandingBytes), 0)
    assert.equal((await control.observeHttp()).attempts, beforeHttp); conservation(result); f.assertDisposed()
  })

  await test('pending_verified_io_is_disposed_at_deadline_before_its_late_completion', async () => {
    const f = fixture(), read = f.repository.read, entered = deferred(), release = deferred(), finished = deferred()
    const before = digest([...f.io.disk]), realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout
    const pendingTimers = new Map<ReturnType<typeof setTimeout>, () => void>()
    let fired = 0
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay !== 3_000) return realSetTimeout(callback, delay, ...args)
      const token = {} as ReturnType<typeof setTimeout>
      pendingTimers.set(token, () => callback(...args)); return token
    }) as typeof setTimeout
    globalThis.clearTimeout = ((token: ReturnType<typeof setTimeout>) => {
      if (!pendingTimers.delete(token)) realClearTimeout(token)
    }) as typeof clearTimeout
    try {
      f.repository.read = async (...args) => {
        const value = await read(...args)
        entered.release()
        try { await release.promise; return value } finally { finished.release() }
      }
      const rejected = assert.rejects(f.engine.inspect(campaignId), { code: 'deadline_exceeded' })
      await entered.promise
      assert.equal(f.scopes.size, 1); assert.ok(f.actual.getActionProofStats!().retainedBytes > 0)
      assert.equal(pendingTimers.size, 1); const expire = [...pendingTimers.values()][0]!
      advance(3_000); fired++; expire(); await rejected
      assert.equal(fired, 1); f.assertDisposed()
      release.release(); await finished.promise; await Promise.resolve(); await Promise.resolve()
      f.assertDisposed(); assert.equal(f.io.writes, 0); assert.equal(digest([...f.io.disk]), before)
    } finally {
      release.release(); globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout
    }
  })

  assert.equal((await control.observeHttp()).errors, 0); assert.equal(unhandled.length, 0)
  console.log(JSON.stringify({ suite: 'body-producer-deadlines', passed: cases.length, cases, loopbackRequests: (await control.observeHttp()).attempts,
    externalRequests: 0, ioDeadlineMs: 3000, verificationMode: 'legacy_monolithic', clock: 'deterministic performance.now; no CPU sleeps', nativeUiExecuted: false }))
} finally {
  writer.dispose(); await control.close(); process.removeListener('unhandledRejection', onUnhandled)
  if (originalNow) Object.defineProperty(performance, 'now', originalNow)
  else Reflect.deleteProperty(performance, 'now')
}
