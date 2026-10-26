/** Session-enabled production owner controls. Fake monotonic time, actual atomic
 * IO/repository/compiler and loopback SDK; no sleeps, profiles or browser runs. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import type { BodyProducerVerificationEvent, ProducerActionScope, ProducerCampaignReceipt, ProducerCampaignRepository,
  ProducerCampaignSnapshot, ProducerVerificationContext, ProducerVerificationProgress } from '../src/types/bodyProducer'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createProducerCampaignRepository, producerKeys } from '../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine } from '../src/services/writerCampaign/bodyProducerEngine'
import { canonicalStringify, decodeStorageBytes } from '../src/services/writerCampaign/protocol'
import { createProducerNodeServer } from './fixtures/writer-body-producer-node-server'

const wall = 1_900_000_000_000, id = 'producer-session-owner-controls'
const identity = { runtimeIdentity: 'producer-session-control', source: { commit: null, tree: null } }
const body = 'Sera left the jade compass near the blue bowl. 晨光照亮了信封。😀\r\ne\u0301'
const selection = { chapterOrdinal: 3, startUtf16: 0, endUtf16: body.length, planningRefs: [] }
function detachedValue(value: unknown): unknown {
  if (value instanceof Map) return [...value].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, item]) => [key, detachedValue(item)])
  if (Array.isArray(value)) return value.map(detachedValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detachedValue(item)]))
  return value
}
const digest = (value: unknown) => createHash('sha256').update(canonicalStringify(detachedValue(value))).digest('hex')
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
  beforeRead: ((keys: readonly string[]) => void | Promise<void>) | null = null
  afterRead: ((keys: readonly string[]) => void | Promise<void>) | null = null
  beforeCas: ((receipt: ProducerCampaignReceipt | null) => void | Promise<void>) | null = null
  afterCas: ((receipt: ProducerCampaignReceipt | null) => void | Promise<void>) | null = null
  rejectCas = false
  rejectedCas = 0
  async getMany(keys: readonly string[]) {
    this.reads.push([...keys]); await this.beforeRead?.(keys)
    const value = new Map(keys.map(key => [key, this.disk.get(key) ?? null]))
    await this.afterRead?.(keys); return value
  }
  async compareAndSwapMany(entries: Entries, canCommit = () => true) {
    const receipt = entries.map(entry => JSON.parse(entry.value)).find(value => value?.protocolVersion === 'campaign-v3-receipt') as ProducerCampaignReceipt | undefined
    await this.beforeCas?.(receipt ?? null)
    if (!canCommit() || this.rejectCas || entries.some(entry => (this.disk.get(entry.key) ?? null) !== entry.expectedValue)) { this.rejectedCas++; return false }
    for (const entry of entries) this.disk.set(entry.key, entry.value)
    this.writes++; if (receipt) this.receipts.push(receipt)
    await this.afterCas?.(receipt ?? null); return true
  }
  fork() { const next = new AtomicIO(); next.disk = new Map(this.disk); return next }
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
function errorCode(error: unknown) { return error && typeof error === 'object' && 'code' in error ? String(error.code) : '' }
function tracked(io: AtomicIO) {
  const actual = createProducerCampaignRepository({ io, clock: () => wall })
  assert.equal(typeof actual.verifyCurrent, 'function'); assert.equal(typeof actual.adoptVerified, 'function')
  assert.equal(typeof actual.getVerificationStats, 'function')
  const live = new Set<ProducerActionScope>(), coldByScope = new Map<ProducerActionScope, number>()
  const contexts: Array<{ ownerStartedAt: number; deadline: number; kind: 'current' | 'adopt' }> = []
  let created = 0, disposed = 0, warmReads = 0
  const observed = (scope: ProducerActionScope, context: ProducerVerificationContext, kind: 'current' | 'adopt') => {
    assert.ok(live.has(scope)); assert.equal(context.signal.aborted, false)
    const count = (coldByScope.get(scope) ?? 0) + 1; coldByScope.set(scope, count)
    assert.equal(count, 1, 'One owner cannot acquire a second cold session or change its purpose')
    assert.equal(context.deadline, context.ownerStartedAt + 10_000, 'The first cold budget is fixed at owner creation')
    contexts.push({ ownerStartedAt: context.ownerStartedAt, deadline: context.deadline, kind })
  }
  const repository: ProducerCampaignRepository = { ...actual,
    createActionScope(campaignId) { const scope = actual.createActionScope!(campaignId); live.add(scope); created++; return scope },
    disposeActionScope(scope) { if (live.delete(scope)) disposed++; actual.disposeActionScope!(scope) },
    verifyCurrent(campaignId, context, scope) { observed(scope, context, 'current'); return actual.verifyCurrent!(campaignId, context, scope) },
    adoptVerified(campaignId, operationId, source, context, scope) { observed(scope, context, 'adopt'); return actual.adoptVerified!(campaignId, operationId, source, context, scope) },
    read(campaignId, check, scope) { warmReads++; return actual.read(campaignId, check, scope) },
    commit(expected, mutation, canCommit, scope) { return actual.commit(expected, mutation, canCommit, scope) },
    getReceipt(campaignId, operationId, check, scope) { return actual.getReceipt(campaignId, operationId, check, scope) },
  }
  const assertDisposed = () => {
    assert.equal(live.size, 0); assert.equal(disposed, created)
    const proof = actual.getActionProofStats!(), session = actual.getVerificationStats!()
    assert.equal(proof.retainedBytes, 0); assert.equal(proof.retainedEntries, 0); assert.equal(proof.activeRecords, 0)
    assert.equal(session.activeSessions, 0); assert.equal(session.retainedBytes, 0); assert.equal(session.retainedEntries, 0); assert.equal(session.activePayloadRecords, 0)
  }
  return { actual, repository, live, contexts, coldByScope, assertDisposed, get created() { return created }, get warmReads() { return warmReads } }
}
function latest(snapshot: ProducerCampaignSnapshot) {
  const index = snapshot.checkpoint.producerRequests.at(-1); assert.ok(index)
  const phase = snapshot.phases.get(index.phaseHash), request = snapshot.requests.get(index.requestHash); assert.ok(phase && request)
  return { index, phase, request, response: phase.responseHash ? snapshot.responses.get(phase.responseHash) : null }
}
function conserved(snapshot: ProducerCampaignSnapshot) {
  const state = snapshot.checkpoint.storage, outstanding = decodeStorageBytes(state.outstandingBytes)
  assert.equal(decodeStorageBytes(state.allocatedBytes) - decodeStorageBytes(state.allocationConsumedBytes) - decodeStorageBytes(state.releasedBytes), outstanding)
  assert.equal(state.openAllocations.reduce((sum, row) => sum + decodeStorageBytes(row.remainingBytes), 0), outstanding)
  assert.ok(decodeStorageBytes(state.writtenBytes) + outstanding + decodeStorageBytes(state.recoveryRemainingBytes) <= 67_108_864)
}
const progressKeys = ['purpose', 'stage', 'verifiedOperations', 'verifiedRecords', 'capturedBytes', 'capturedEntries', 'totalOperations'].sort()
function recordEvents(engine: ReturnType<typeof createBodyProducerEngine>) {
  assert.equal(typeof engine.subscribeVerification, 'function')
  const events: BodyProducerVerificationEvent[] = [], eventFailures: unknown[] = []
  const unsubscribe = engine.subscribeVerification!(event => {
    // Production intentionally isolates listener exceptions. Preserve assertion
    // failures outside that boundary so malformed progress cannot false-pass.
    try {
      assert.deepEqual(Object.keys(event).sort(), ['ownerId', 'campaignId', 'status', 'progress'].sort())
      assert.equal(event.campaignId, id); assert.ok(Number.isSafeInteger(event.ownerId))
      if (event.progress) {
        assert.deepEqual(Object.keys(event.progress).sort(), progressKeys)
        for (const key of ['verifiedOperations', 'verifiedRecords', 'capturedBytes', 'capturedEntries'] as const) assert.ok(Number.isSafeInteger(event.progress[key]) && event.progress[key] >= 0)
      }
      events.push(structuredClone(event))
    } catch (error) { eventFailures.push(error) }
  })
  return { events, off() { unsubscribe(); assert.equal(eventFailures.length, 0, 'Every progress event has the exact source-free schema') } }
}
const cases: string[] = [], unhandled: unknown[] = []
const onUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', onUnhandled)
const control = await createProducerNodeServer(), base = new AtomicIO()
const writer = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(base), clock: () => wall })
async function test(name: string, work: () => Promise<void>) { await work(); cases.push(name); console.log(`PASS ${name}`) }
try {
  await writer.prepareBodyEvidence({ campaignId: id, language: 'en' })
  for (let index = 0; index < 9; index++) await writer.step(id, `seed-${index}`)
  const v2 = base.fork(), original = (await createCampaignRepository(v2).read(id))!
  // Fixture construction uses the unchanged public path; all tested actions
  // below require the session capability rather than fabricating a snapshot.
  const setup = createProducerCampaignRepository({ io: base, clock: () => wall })
  const adoption = await setup.adopt(id, 'seed-adoption', identity)
  const accepted = (await setup.commit(adoption.snapshot, { kind: 'body_revision', operationId: 'seed-body', chapterOrdinal: 3, text: body })).snapshot
  const initialAttempts = accepted.checkpoint.budget.attempts
  const fixture = (disk = base) => {
    const io = disk.fork(), tracking = tracked(io)
    const engine = createBodyProducerEngine({ identity, repository: tracking.repository, adapters: [control.adapter], clock: () => wall })
    const events = recordEvents(engine)
    const reopen = () => createBodyProducerEngine({ identity, repository: createProducerCampaignRepository({ io, clock: () => wall }), clock: () => wall })
    return { io, tracking, engine, ...events, reopen }
  }

  await test('current_session_matches_monolithic_snapshot_without_writes_or_partial_authority', async () => {
    const f = fixture(), before = digest([...f.io.disk]), expected = (await f.tracking.actual.read(id))!
    const actual = (await f.engine.inspect(id))!
    assert.equal(digest(actual), digest(expected)); assert.equal(digest([...f.io.disk]), before); assert.equal(f.io.writes, 0)
    assert.equal(f.tracking.contexts.length, 1); assert.equal(f.events[0]!.status, 'started'); assert.equal(f.events.at(-1)!.status, 'completed')
    assert.ok(f.events.some(event => event.progress?.stage === 'final_fence'))
    const stats = f.tracking.actual.getVerificationStats!()
    assert.equal(stats.sessionsStarted, 1); assert.equal(stats.sessionsCompleted, 1); assert.equal(stats.finalFencePasses, 1)
    assert.equal(stats.finalFenceExpectedRecords, stats.finalFenceObservedRecords); assert.ok(stats.finalFenceExpectedRecords > 0)
    assert.ok(stats.maxOperationsPerAdvance <= 8); f.tracking.assertDisposed()
    actual.checkpoint.tasks.length = 0; actual.artifacts.clear(); actual.origin.artifacts.clear()
    const next = (await f.engine.inspect(id))!; assert.equal(digest(next), digest(expected)); f.tracking.assertDisposed()
    const lateEvents: BodyProducerVerificationEvent[] = [], off = f.engine.subscribeVerification!(event => lateEvents.push(event))
    assert.equal(lateEvents.length, 0, 'Subscriptions never replay a completed authority hint'); off(); f.off()
  })

  await test('prepare_and_real_sdk_invocation_use_one_cold_session_per_owner_then_warm_reads', async () => {
    const f = fixture(), beforeHttp = (await control.observeHttp()).attempts
    const handle = await f.engine.prepare(id, selection, control.adapter.identity.adapterId)
    assert.equal(f.tracking.contexts.length, 1); assert.ok(f.tracking.warmReads > 0)
    const result = await f.engine.invoke(handle, 'session-success'), state = latest(result)
    assert.equal(state.phase.resolution?.outcome, 'review_ready'); assert.ok(state.response)
    assert.equal(f.tracking.contexts.length, 2); assert.ok(f.tracking.warmReads > 4)
    assert.equal((await control.observeHttp()).attempts, beforeHttp + 1); assert.equal(result.checkpoint.budget.attempts, initialAttempts + 1)
    assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'reserve').length, 1); conserved(result); f.tracking.assertDisposed()
    const writes = f.io.writes
    assert.equal((await f.engine.invoke(handle, 'session-success')).rawHead, result.rawHead)
    assert.equal(f.io.writes, writes); assert.equal((await control.observeHttp()).attempts, beforeHttp + 1)
    for (const count of f.tracking.coldByScope.values()) assert.equal(count, 1)
    f.off()
  })

  await test('legacy_inspection_keeps_null_behavior_and_cannot_grant_an_adoption_baseline', async () => {
    const f = fixture(v2), before = digest([...f.io.disk])
    assert.equal(await f.engine.inspect(id), null); assert.equal(f.io.writes, 0); assert.equal(digest([...f.io.disk]), before)
    assert.equal(f.tracking.actual.getVerificationStats!().finalFencePasses, 0)
    assert.equal(f.tracking.contexts.length, 1, 'Legacy discovery still consumes this owner\'s one cold attempt')
    assert.equal(f.events.some(event => event.progress?.purpose === 'adoption_v2'), false); f.tracking.assertDisposed(); f.off()
  })

  await test('partial_session_capability_never_uses_a_half_configured_verification_path', async () => {
    for (const missing of ['verifyCurrent', 'adoptVerified'] as const) {
      const f = fixture(), wrapper: ProducerCampaignRepository = { ...f.tracking.repository,
        verifyCurrent: async () => { assert.fail('A partial capability must use the unchanged monolithic path') },
        adoptVerified: async () => { assert.fail('A partial capability cannot acquire adoption authority') },
        [missing]: undefined,
      }
      const engine = createBodyProducerEngine({ identity, repository: wrapper, clock: () => wall })
      assert.equal((await engine.inspect(id))!.rawHead, accepted.rawHead)
      assert.equal(f.tracking.contexts.length, 0); assert.equal(f.io.writes, 0); f.tracking.assertDisposed(); f.off()
    }
  })

  await test('mandatory_capture_admission_refuses_instead_of_falling_back_or_allocating_another_pool', async () => {
    const f = fixture(), occupied = f.tracking.actual.createActionScope!(id)
    await f.tracking.actual.read(id, undefined, occupied)
    const retained = f.tracking.actual.getActionProofStats!().retainedBytes; assert.ok(retained > 0)
    try {
      await assert.rejects(f.engine.inspect(id), { code: 'verification_capacity' })
      assert.equal(f.tracking.contexts.length, 1); assert.equal(f.tracking.warmReads, 0); assert.equal(f.tracking.live.size, 0)
      assert.equal(f.tracking.actual.getActionProofStats!().retainedBytes, retained, 'Refused capture cannot allocate a second transcript allowance')
      assert.equal(f.io.writes, 0); assert.equal(f.events.some(event => event.status === 'completed'), false)
    } finally { f.tracking.actual.disposeActionScope!(occupied) }
    f.tracking.assertDisposed()
    assert.equal((await f.engine.inspect(id))!.rawHead, accepted.rawHead)
    assert.equal(f.tracking.contexts.length, 2, 'Only a fresh explicit owner can try again after admission becomes available')
    f.tracking.assertDisposed(); f.off()
  })

  await test('cold_session_can_exceed_three_seconds_only_when_each_actual_io_is_timely', async () => {
    const f = fixture(), started = monotonic; let delayed = 0
    f.io.afterRead = () => { if (delayed < 40) { delayed++; advance(100) } }
    assert.equal((await f.engine.inspect(id))!.rawHead, accepted.rawHead)
    assert.equal(delayed, 40); assert.equal(monotonic - started, 4_000)
    const stats = f.tracking.actual.getVerificationStats!()
    assert.equal(stats.sessionsCompleted, 1); assert.ok(stats.sessionMaxMs >= 4_000); assert.ok(stats.rawIoMaxMs < 3_000)
    assert.equal(f.io.writes, 0); f.tracking.assertDisposed(); f.off()
  })

  await test('legacy_inspection_does_not_inherit_the_new_ten_second_cold_allowance', async () => {
    const f = fixture(v2); let delayed = 0
    f.io.afterRead = () => { delayed++; advance(1_000) }
    await assert.rejects(f.engine.inspect(id), error => ['operation_timeout', 'deadline_exceeded'].includes(errorCode(error)))
    assert.ok(delayed >= 3); assert.equal(f.io.writes, 0)
    assert.equal(f.tracking.actual.getVerificationStats!().sessionsCompleted, 0); f.tracking.assertDisposed(); f.off()
  })

  await test('raw_io_result_at_3000ms_is_refused_even_before_its_timer_can_fire', async () => {
    const f = fixture(), before = digest([...f.io.disk]); let hit = false
    f.io.afterRead = () => { if (!hit) { hit = true; advance(3_000) } }
    await assert.rejects(f.engine.inspect(id), { code: 'operation_timeout' })
    assert.equal(hit, true); assert.equal(f.io.writes, 0); assert.equal(digest([...f.io.disk]), before)
    assert.equal(f.events.some(event => event.status === 'completed'), false); f.tracking.assertDisposed(); f.off()
  })

  await test('many_timely_raw_io_waits_cannot_renew_the_fixed_10000ms_owner', async () => {
    const f = fixture(), started = monotonic; let reads = 0
    f.io.afterRead = () => { reads++; advance(1_000) }
    await assert.rejects(f.engine.inspect(id), { code: 'deadline_exceeded' })
    assert.ok(reads >= 10); assert.ok(monotonic - started >= 10_000); assert.equal(f.io.writes, 0)
    assert.equal(f.tracking.contexts.length, 1); assert.equal(f.events.some(event => event.status === 'completed'), false)
    f.tracking.assertDisposed(); f.off()
  })

  await test('late_completed_cold_snapshot_cannot_publish_at_its_fixed_owner_deadline', async () => {
    const f = fixture(), verify = f.tracking.repository.verifyCurrent!
    f.tracking.repository.verifyCurrent = async (...args) => { const value = await verify(...args); advance(10_000); return value }
    await assert.rejects(f.engine.inspect(id), { code: 'deadline_exceeded' })
    assert.equal(f.io.writes, 0); assert.equal(f.events.some(event => event.status === 'completed'), false); f.tracking.assertDisposed(); f.off()
  })

  await test('sixty_second_invocation_still_has_only_its_first_ten_seconds_for_cold_verification', async () => {
    const f = fixture(), handle = await f.engine.prepare(id, selection, control.adapter.identity.adapterId), beforeHttp = (await control.observeHttp()).attempts
    const verify = f.tracking.repository.verifyCurrent!; let injected = false
    f.tracking.repository.verifyCurrent = async (...args) => {
      const value = await verify(...args)
      if (!injected) { injected = true; advance(10_000) }
      return value
    }
    await assert.rejects(f.engine.invoke(handle, 'cold-owner-expired'), { code: 'deadline_exceeded' })
    assert.equal(f.io.writes, 0); assert.equal((await control.observeHttp()).attempts, beforeHttp)
    assert.equal(f.io.receipts.length, 0); f.tracking.assertDisposed(); f.off()
  })

  await test('completed_listener_cannot_let_cold_authority_escape_the_invocation_ten_second_deadline', async () => {
    const f = fixture(), handle = await f.engine.prepare(id, selection, control.adapter.identity.adapterId), beforeHttp = (await control.observeHttp()).attempts
    let expired = false
    const off = f.engine.subscribeVerification!(event => {
      if (!expired && event.status === 'completed') { expired = true; advance(10_000) }
    })
    await assert.rejects(f.engine.invoke(handle, 'completed-listener-expiry'), { code: 'deadline_exceeded' })
    assert.equal(expired, true); assert.equal(f.io.writes, 0); assert.equal((await control.observeHttp()).attempts, beforeHttp)
    const stats = f.engine.getExecutionStats!()
    assert.equal(stats.invocationOwnersStarted, 1); assert.ok(stats.ownersExpired >= 1); assert.equal(stats.activeOwners, 0)
    f.tracking.assertDisposed(); off(); f.off()
  })

  await test('verification_completed_event_is_not_action_authority_when_listener_cancels_synchronously', async () => {
    const f = fixture(), verify = f.tracking.repository.verifyCurrent!, beforeHttp = (await control.observeHttp()).attempts
    let retainedContext: ProducerVerificationContext | null = null, cancelled = false
    const callbackCodes: string[] = []
    f.tracking.repository.verifyCurrent = (campaignId, context, scope) => { retainedContext = context; return verify(campaignId, context, scope) }
    const off = f.engine.subscribeVerification!(event => {
      if (event.status === 'completed' || event.status === 'cancelled') {
        try { retainedContext!.onProgress!({ purpose: 'current_v3', stage: 'final_fence', verifiedOperations: 1,
          verifiedRecords: 1, capturedBytes: 1, capturedEntries: 1, totalOperations: 1 }); callbackCodes.push('unexpected_success') }
        catch (error) { callbackCodes.push(errorCode(error)) }
      }
      if (event.status === 'completed') { cancelled = true; f.engine.cancelLocal(id) }
    })
    await assert.rejects(f.engine.prepare(id, selection, control.adapter.identity.adapterId), { code: 'cancelled' })
    assert.equal(cancelled, true); assert.deepEqual(f.events.slice(-2).map(event => event.status), ['completed', 'cancelled'])
    assert.deepEqual(callbackCodes, ['verification_unavailable', 'verification_unavailable'])
    assert.equal(f.io.writes, 0); assert.equal((await control.observeHttp()).attempts, beforeHttp)
    assert.equal(f.engine.getExecutionStats!().ownersCancelled, 1); f.tracking.assertDisposed(); off(); f.off()
  })

  await test('expired_final_cas_guard_remains_an_expired_owner_even_when_repository_reports_conflict', async () => {
    const f = fixture(), commit = f.tracking.repository.commit; let wrappedConflict = false
    f.io.beforeCas = receipt => { if (receipt?.kind === 'body_revision') advance(3_000) }
    f.tracking.repository.commit = async (...args) => {
      try { return await commit(...args) }
      catch {
        wrappedConflict = true
        throw Object.assign(new Error('synthetic-repository-conflict-after-expiry'), { code: 'conflict' })
      }
    }
    await assert.rejects(f.engine.reviseBody(id, 3, `${body} Too late.`, accepted.rawHead, 'expired-final-cas'))
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(wrappedConflict, true); assert.equal(f.io.rejectedCas, 1); assert.equal(f.io.writes, 0)
    const stats = f.engine.getExecutionStats!()
    assert.equal(stats.ownersExpired, 1); assert.equal(stats.ownersRefused, 0); assert.equal(stats.deadlineRefusals, 1)
    f.tracking.assertDisposed(); f.off()
  })

  await test('wrapped_repository_conflict_at_cold_wait_deadline_keeps_original_error_and_expired_owner', async () => {
    const f = fixture(), verify = f.tracking.repository.verifyCurrent!
    f.tracking.repository.verifyCurrent = async (...args) => {
      await verify(...args); advance(10_000)
      throw Object.assign(new Error('synthetic-conflict-after-cold-deadline'), { code: 'conflict' })
    }
    await assert.rejects(f.engine.inspect(id), { code: 'conflict' })
    const stats = f.engine.getExecutionStats!()
    assert.equal(stats.ownersExpired, 1); assert.equal(stats.ownersRefused, 0); assert.equal(stats.deadlineRefusals, 1)
    assert.equal(f.io.writes, 0); f.tracking.assertDisposed(); f.off()
  })

  await test('progress_rejects_enumerable_symbols_and_captures_changing_getters_once', async () => {
    const progress = (): ProducerVerificationProgress => ({ purpose: 'current_v3', stage: 'discovery', verifiedOperations: 0,
      verifiedRecords: 0, capturedBytes: 0, capturedEntries: 0, totalOperations: null })
    const bad = fixture(), verifyBad = bad.tracking.repository.verifyCurrent!, symbolProgress = progress()
    Object.defineProperty(symbolProgress, Symbol('hidden-source'), { enumerable: true, value: body })
    bad.tracking.repository.verifyCurrent = async (campaignId, context, scope) => {
      context.onProgress!(symbolProgress); return verifyBad(campaignId, context, scope)
    }
    await assert.rejects(bad.engine.inspect(id), { code: 'verification_progress_invalid' })
    assert.equal(bad.events.some(event => event.status === 'progress'), false); assert.equal(bad.io.writes, 0)
    bad.tracking.assertDisposed(); bad.off()
    const good = fixture(), verifyGood = good.tracking.repository.verifyCurrent!, getterProgress = progress(); let getterReads = 0
    Object.defineProperty(getterProgress, 'capturedBytes', { enumerable: true, get() { getterReads++; return getterReads === 1 ? 0 : { body } } })
    good.tracking.repository.verifyCurrent = async (campaignId, context, scope) => {
      context.onProgress!(getterProgress); return verifyGood(campaignId, context, scope)
    }
    assert.equal((await good.engine.inspect(id))!.rawHead, accepted.rawHead); assert.equal(getterReads, 1)
    assert.equal(good.events.find(event => event.status === 'progress')!.progress!.capturedBytes, 0)
    assert.equal(good.io.writes, 0); good.tracking.assertDisposed(); good.off()
  })

  await test('retained_progress_callback_is_revoked_while_the_same_invocation_owner_continues', async () => {
    const f = fixture(), verify = f.tracking.repository.verifyCurrent!, commit = f.tracking.repository.commit
    const beforeHttp = (await control.observeHttp()).attempts; let retainedContext: ProducerVerificationContext | null = null, checked = false
    f.tracking.repository.verifyCurrent = (campaignId, context, scope) => {
      retainedContext = context; return verify(campaignId, context, scope)
    }
    f.tracking.repository.commit = async (...args) => {
      const result = await commit(...args)
      if (args[1].kind === 'reserve') {
        assert.ok(retainedContext); const count = f.events.length
        assert.throws(() => retainedContext!.onProgress!({ purpose: 'current_v3', stage: 'tail_replay', verifiedOperations: 1,
          verifiedRecords: 1, capturedBytes: 1, capturedEntries: 1, totalOperations: 1 }), { code: 'verification_unavailable' })
        assert.equal(f.events.length, count); checked = true
      }
      return result
    }
    const result = await f.engine.invoke(await f.engine.prepare(id, selection, control.adapter.identity.adapterId), 'revoked-progress')
    assert.equal(checked, true); assert.equal(latest(result).phase.resolution?.outcome, 'review_ready')
    assert.equal((await control.observeHttp()).attempts, beforeHttp + 1); conserved(result); f.tracking.assertDisposed(); f.off()
  })

  await test('pending_raw_io_cancel_disposes_before_late_completion_and_new_owner_can_verify', async () => {
    const f = fixture(), entered = deferred(), release = deferred(), finished = deferred(); let hold = true
    f.io.beforeRead = async () => { if (hold) { hold = false; entered.release(); try { await release.promise } finally { finished.release() } } }
    const rejected = assert.rejects(f.engine.inspect(id), { code: 'cancelled' })
    await entered.promise; const cancelledOwner = f.events[0]!.ownerId
    f.engine.cancelLocal(id); await rejected; f.tracking.assertDisposed()
    assert.equal((await f.engine.inspect(id))!.rawHead, accepted.rawHead); f.tracking.assertDisposed()
    release.release(); await finished.promise; await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(f.events.some(event => event.ownerId === cancelledOwner && event.status === 'completed'), false)
    assert.equal(f.io.writes, 0); f.tracking.assertDisposed(); f.off()
  })

  await test('host_task_cancellation_between_advances_prevents_preparation_not_just_microtasks', async () => {
    const f = fixture(); let scheduled = false, ran = false
    const off = f.engine.subscribeVerification!(event => {
      if (!scheduled && event.status === 'progress' && event.progress?.stage === 'origin_replay' && event.progress.verifiedOperations > 0) {
        scheduled = true; advance(60)
        setTimeout(() => { ran = true; f.engine.cancelLocal(id) }, 0)
      }
    })
    await assert.rejects(f.engine.prepare(id, selection, control.adapter.identity.adapterId), { code: 'cancelled' })
    assert.equal(scheduled, true); assert.equal(ran, true); assert.equal(f.io.writes, 0)
    assert.equal(f.events.some(event => event.status === 'completed'), false); assert.ok(f.tracking.actual.getVerificationStats!().hostYields > 0)
    f.tracking.assertDisposed(); off(); f.off()
  })

  await test('same_head_tail_tampering_before_final_fence_never_publishes_partial_snapshot', async () => {
    const f = fixture(); let tampered = false
    const off = f.engine.subscribeVerification!(event => {
      if (!tampered && event.progress?.stage === 'final_fence') {
        tampered = true; const key = producerKeys.checkpoint(id, accepted.head.sequence)
        f.io.disk.set(key, `${f.io.disk.get(key)!} `)
      }
    })
    await assert.rejects(f.engine.inspect(id))
    assert.equal(tampered, true); assert.equal(f.io.writes, 0); assert.equal(f.events.some(event => event.status === 'completed'), false)
    f.tracking.assertDisposed(); off(); f.off()
  })

  await test('real_second_author_source_movement_refuses_instead_of_rebasing_the_session', async () => {
    const f = fixture(); let revised = false
    f.io.beforeRead = async keys => {
      if (!revised && keys.length > 1) {
        revised = true; f.io.beforeRead = null
        await f.reopen().reviseBody(id, 3, `${body} A new author sentence.`, accepted.rawHead, 'other-author-revision')
      }
    }
    await assert.rejects(f.engine.inspect(id))
    assert.equal(revised, true); assert.equal(f.io.receipts.length, 1); assert.equal(f.io.receipts[0]!.kind, 'body_revision')
    assert.equal(f.events.some(event => event.status === 'completed'), false); f.tracking.assertDisposed(); f.off()
  })

  await test('explicit_adoption_consumes_one_verified_v2_baseline_and_no_second_cold_replay', async () => {
    const f = fixture(v2), result = await f.engine.adopt(id, 'session-adoption')
    assert.equal(result.manifest.adoptedRawHead, original.rawHead); assert.equal(f.io.writes, 1)
    assert.equal(f.io.receipts[0]!.kind, 'adopt'); assert.equal(f.tracking.contexts.length, 1); assert.equal(f.tracking.contexts[0]!.kind, 'adopt')
    assert.ok(f.events.some(event => event.progress?.purpose === 'adoption_v2'))
    assert.equal(f.events.some(event => event.progress?.purpose === 'current_v3'), false)
    assert.equal(result.checkpoint.producerRequests.length, 0); conserved(result); f.tracking.assertDisposed(); f.off()
  })

  await test('adoption_false_cas_ends_owner_and_requires_a_new_explicit_attempt', async () => {
    const f = fixture(v2); f.io.rejectCas = true
    await assert.rejects(f.engine.adopt(id, 'false-cas-adoption'), { code: 'conflict' })
    assert.equal(f.io.rejectedCas, 1); assert.equal(f.io.writes, 0); assert.equal(f.tracking.contexts.length, 1); f.tracking.assertDisposed()
    f.io.rejectCas = false
    const result = await f.engine.adopt(id, 'false-cas-adoption')
    assert.equal(result.manifest.adoptedRawHead, original.rawHead); assert.equal(f.io.writes, 1); assert.equal(f.tracking.contexts.length, 2)
    f.tracking.assertDisposed(); f.off()
  })

  await test('adoption_lost_ack_has_no_inline_reconciliation_and_exact_explicit_retry_reads_receipt', async () => {
    const f = fixture(v2); let readIndex = 0, lost = false
    f.io.afterCas = receipt => {
      if (receipt?.kind === 'adopt' && !lost) { lost = true; readIndex = f.io.reads.length; throw new Error('synthetic-adoption-ack-lost') }
    }
    await assert.rejects(f.engine.adopt(id, 'lost-adoption-ack'), { code: 'storage_unknown' })
    assert.equal(lost, true); assert.equal(f.io.writes, 1); assert.equal(f.io.reads.length, readIndex, 'A consumed v2 baseline cannot switch to a new current-v3 session')
    assert.equal(f.tracking.contexts.length, 1); f.tracking.assertDisposed()
    const retry = f.reopen(), result = await retry.adopt(id, 'lost-adoption-ack')
    assert.equal(f.io.writes, 1); assert.equal(result.receipt.operationId, 'lost-adoption-ack')
    assert.ok(f.io.reads.slice(readIndex).some(keys => keys.includes(producerKeys.receipt(id, 'lost-adoption-ack'))))
    await assert.rejects(retry.adopt(id, 'another-adoption-command'), { code: 'operation_conflict' })
    assert.equal(f.io.writes, 1); conserved(result); f.off()
  })

  await test('adoption_final_cas_at_3000ms_has_no_write_or_inline_retry', async () => {
    const f = fixture(v2); let hit = false
    f.io.beforeCas = receipt => { if (receipt?.kind === 'adopt') { hit = true; advance(3_000) } }
    await assert.rejects(f.engine.adopt(id, 'late-adoption-cas'), { code: 'storage_unknown' })
    assert.equal(hit, true); assert.equal(f.io.rejectedCas, 1); assert.equal(f.io.writes, 0); assert.equal(f.tracking.contexts.length, 1)
    assert.equal(f.tracking.actual.getVerificationStats!().casMaxMs, 3_000)
    f.tracking.assertDisposed(); f.off()
  })

  await test('adoption_timely_cas_late_ack_stays_durable_until_an_explicit_receipt_retry', async () => {
    const f = fixture(v2); let hit = false
    f.io.afterCas = receipt => { if (receipt?.kind === 'adopt' && !hit) { hit = true; advance(3_000) } }
    await assert.rejects(f.engine.adopt(id, 'late-adoption-ack'), error => ['operation_timeout', 'deadline_exceeded', 'storage_unknown'].includes(errorCode(error)))
    assert.equal(hit, true); assert.equal(f.io.writes, 1); assert.equal(f.tracking.contexts.length, 1); f.tracking.assertDisposed()
    const result = await f.reopen().adopt(id, 'late-adoption-ack')
    assert.equal(f.io.writes, 1); assert.equal(result.receipt.operationId, 'late-adoption-ack'); conserved(result); f.off()
  })

  await test('old_v2_writer_advancement_before_adoption_cas_cannot_be_rebased', async () => {
    const f = fixture(v2); let changed = false
    const oldWriter = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(f.io), clock: () => wall })
    f.io.beforeCas = async receipt => {
      if (receipt?.kind === 'adopt' && !changed) { changed = true; await oldWriter.cancel(id, 'other-v2-cancel') }
    }
    try {
      await assert.rejects(f.engine.adopt(id, 'stale-v2-adoption'), { code: 'conflict' })
      assert.equal(changed, true); assert.equal(f.io.receipts.length, 0); assert.equal(f.io.writes, 1)
      const current = (await createCampaignRepository(f.io).read(id))!
      assert.equal(current.head.status, 'cancelled'); assert.notEqual(current.rawHead, original.rawHead)
      assert.equal(f.tracking.contexts.length, 1); f.tracking.assertDisposed()
    } finally { oldWriter.dispose(); f.off() }
  })

  await test('session_enabled_late_intent_ack_has_zero_http_one_spent_reservation_and_unknown', async () => {
    const f = fixture(), beforeHttp = (await control.observeHttp()).attempts; let intent: ProducerCampaignReceipt | null = null
    f.io.afterCas = receipt => { if (receipt?.kind === 'dispatch_intent' && !intent) { intent = receipt; advance(3_000) } }
    const handle = await f.engine.prepare(id, selection, control.adapter.identity.adapterId)
    const result = await f.engine.invoke(handle, 'session-late-intent'), state = latest(result)
    assert.ok(intent); assert.equal(state.phase.status, 'outcome_unknown'); assert.equal(state.response, null)
    assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'reserve').length, 1); assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'dispatch_intent').length, 1)
    assert.equal(result.checkpoint.budget.attempts, initialAttempts + 1); assert.equal((await control.observeHttp()).attempts, beforeHttp)
    assert.equal((await f.reopen().recover(id, state.index.id)).rawHead, result.rawHead)
    assert.equal((await control.observeHttp()).attempts, beforeHttp); conserved(result); f.tracking.assertDisposed(); f.off()
  })

  await test('session_enabled_late_retention_ack_reopens_retained_then_compiles_without_replay', async () => {
    const f = fixture(), beforeHttp = (await control.observeHttp()).attempts; let retained = false
    f.io.afterCas = receipt => { if (receipt?.kind === 'retain_response' && !retained) { retained = true; advance(3_000) } }
    const result = await f.engine.invoke(await f.engine.prepare(id, selection, control.adapter.identity.adapterId), 'session-late-retain'), state = latest(result)
    assert.equal(retained, true); assert.equal(state.phase.status, 'response_retained'); assert.ok(state.response); assert.equal(result.reviews.size, 0)
    assert.equal((await control.observeHttp()).attempts, beforeHttp + 1); assert.equal(result.checkpoint.budget.attempts, initialAttempts + 1)
    const recovered = await f.reopen().recover(id, state.index.id), final = latest(recovered)
    assert.equal(final.phase.resolution?.outcome, 'review_ready'); assert.equal(final.phase.responseHash, state.phase.responseHash)
    assert.equal(recovered.checkpoint.budget.attempts, initialAttempts + 1); assert.equal((await control.observeHttp()).attempts, beforeHttp + 1)
    assert.equal(f.io.receipts.filter(receipt => receipt.kind === 'reserve').length, 1); conserved(recovered); f.tracking.assertDisposed(); f.off()
  })

  assert.equal(unhandled.length, 0); assert.equal((await control.observeHttp()).errors, 0)
  console.log(JSON.stringify({ suite: 'body-producer-session-engine', passed: cases.length, cases, loopbackRequests: (await control.observeHttp()).attempts,
    externalRequests: 0, coldSessionDeadlineMs: 10000, rawIoDeadlineMs: 3000, maxOperationsPerAdvance: 8,
    clock: 'deterministic performance.now; no CPU sleeps', nativeUiExecuted: false }))
} finally {
  writer.dispose(); await control.close(); process.removeListener('unhandledRejection', onUnhandled)
  if (originalNow) Object.defineProperty(performance, 'now', originalNow); else Reflect.deleteProperty(performance, 'now')
}
