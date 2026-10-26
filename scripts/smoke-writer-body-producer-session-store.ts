/** Exact session/monolithic equivalence and mandatory capture controls. No profile or SDK. */
import assert from 'node:assert/strict'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import type { ProducerCampaignSnapshot, ProducerVerificationContext } from '../src/types/bodyProducer'
import { CAMPAIGN_CATALOG_KEY, campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createProducerCampaignRepository, producerKeys, sealProducerRequest, sealProducerResponse, sealProducerReview } from '../src/services/writerCampaign/producerStore'
import { CampaignActionProofPool, CAMPAIGN_PROOF_ENTRY_LIMIT } from '../src/services/writerCampaign/actionProof'
import { emptyVerificationStats, ProducerVerificationExecutor } from '../src/services/writerCampaign/verificationSession'
import { compileProducedBodyEvidence, prepareBodyProducerInput } from '../src/services/writerCampaign/bodyProducerEvidence'
import { decodeStorageBytes, emptyCampaignBudget, hashText, utf8Bytes } from '../src/services/writerCampaign/protocol'
import { installNodePlanningAuthorityGuard } from './fixtures/writer-campaign-planning-authority.mjs'

class IO implements CampaignRepositoryIO {
  disk = new Map<string, string>()
  reads: string[][] = []
  writes = 0
  loseAck = false
  onRead: ((keys: readonly string[]) => void | Promise<void>) | null = null
  async getMany(keys: readonly string[]) { assert.ok(keys.length <= 33); this.reads.push([...keys]); await this.onRead?.(keys); return new Map(keys.map(key => [key, this.disk.get(key) ?? null])) }
  async compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit = () => true) {
    if (!canCommit() || entries.some(row => (this.disk.get(row.key) ?? null) !== row.expectedValue)) return false
    const receipt = entries.find(row => row.key.includes(':receipt:'))!
    assert.equal(decodeStorageBytes(JSON.parse(receipt.value).serializedBytes), entries.reduce((sum, row) => sum + Buffer.byteLength(row.key) + Buffer.byteLength(row.value), 0))
    for (const row of entries) this.disk.set(row.key, row.value)
    this.writes++
    if (this.loseAck) { this.loseAck = false; throw new Error('lost_ack') }
    return true
  }
  fork() { const result = new IO(); result.disk = new Map(this.disk); return result }
}
const id = 'session-store', now = 1_900_000_000_000
const identity = { runtimeIdentity: 'session-store-runtime', source: { commit: null, tree: null } }
const producer = { adapterId: 'control', adapterVersion: 'v1', mode: 'offline_control' as const, requestedModelId: 'synthetic', effectiveModelId: 'synthetic', configurationRevision: 'v1', endpointIdentity: 'no-network' }
const guard = installNodePlanningAuthorityGuard(), io = new IO(), legacy = createCampaignRepository(io)
const writer = createOfflineCampaignEngine({ repository: legacy, identity, clock: () => now })
const repository = createProducerCampaignRepository({ io, clock: () => now })
const context = (onProgress?: ProducerVerificationContext['onProgress']): ProducerVerificationContext => {
  const ownerStartedAt = performance.now()
  return { ownerStartedAt, deadline: ownerStartedAt + 10_000, signal: new AbortController().signal, check() {}, onProgress }
}
let cases = 0
async function test(run: () => Promise<void>) { await run(); cases++ }
const zeroRetention = (repo: ReturnType<typeof createProducerCampaignRepository>) => {
  const value = repo.getVerificationStats!()
  assert.equal(value.activeSessions, 0); assert.equal(value.retainedBytes, 0); assert.equal(value.retainedEntries, 0); assert.equal(value.activePayloadRecords, 0)
  assert.equal(value.sessionsStarted, value.sessionsCompleted + value.sessionsFailed + value.sessionsCancelled)
  assert.equal(value.sessionsDisposed, value.sessionsStarted)
}
try {
  await writer.prepareBodyEvidence({ campaignId: id, language: 'en' })
  for (let index = 0; index < 9; index++) await writer.step(id, `source-${index}`)
  const source = io.fork(), oldHead = source.disk.get(campaignKeys.head(id))!
  let snapshot = (await repository.adopt(id, 'adopt', identity)).snapshot
  const states: Array<{ label: string; io: IO; snapshot: ProducerCampaignSnapshot }> = [{ label: 'adopted', io: io.fork(), snapshot }]
  snapshot = (await repository.commit(snapshot, { kind: 'body_revision', operationId: 'manual', chapterOrdinal: 1, text: 'An arbitrary accepted sentence. 新人物。' })).snapshot
  states.push({ label: 'revised', io: io.fork(), snapshot })
  const prepared = await prepareBodyProducerInput(snapshot.source, { chapterOrdinal: 1, startUtf16: 0, endUtf16: 30, planningRefs: [] })
  const reservation = { ...emptyCampaignBudget(), attempts: 1, inputBytes: prepared.inputBytes, inputUtf16: prepared.inputUtf16, outputTokens: 1200, responseBytes: 65_536, activeMs: 60_000 }
  const request = await sealProducerRequest({ schemaVersion: 1, protocol: 'body-producer-request-v1', campaignId: id, id: 'request', operationId: 'request', aggregateManifestHash: snapshot.manifest.hash,
    sourceEpoch: snapshot.checkpoint.sourceEpoch, prepared, producer, reservation, createdAt: now, expiresAt: now + 60_000 })
  snapshot = (await repository.commit(snapshot, { kind: 'reserve', operationId: 'request:reserve', request })).snapshot
  states.push({ label: 'reserved', io: io.fork(), snapshot })
  snapshot = (await repository.commit(snapshot, { kind: 'dispatch_intent', operationId: 'request:intent', requestId: request.id })).snapshot
  const intentHash = snapshot.checkpoint.producerRequests[0]!.phaseHash
  states.push({ label: 'intent', io: io.fork(), snapshot })
  const unknownIo = io.fork(), unknownRepository = createProducerCampaignRepository({ io: unknownIo, clock: () => now })
  const unknown = await unknownRepository.commit(snapshot, { kind: 'outcome_unknown', operationId: 'request:unknown', requestId: request.id, reason: 'operation_timeout', recovery: true })
  states.push({ label: 'unknown', io: unknownIo, snapshot: unknown.snapshot })
  const text = '{"protocol":"body-producer-output-v1","items":[],"saturated":false,"examination":{"status":"not_declared","intervals":[]}}'
  const response = await sealProducerResponse({ schemaVersion: 1, protocol: 'body-producer-response-v1', campaignId: id, requestId: request.id, requestHash: request.hash,
    intentHash, evidenceId: 'synthetic', text, textHash: await hashText(text), bytes: utf8Bytes(text), usage: { provenance: 'synthetic_control', inputTokens: null, outputTokens: null, reasoningTokens: 0 }, reportedModelId: null })
  snapshot = (await repository.commit(snapshot, { kind: 'retain_response', operationId: 'request:retain', requestId: request.id, response })).snapshot
  states.push({ label: 'retained', io: io.fork(), snapshot })
  const result = await compileProducedBodyEvidence(snapshot.source, prepared, text, { requestId: request.id, requestHash: request.hash, responseHash: response.hash, intentHash,
    aggregateManifestHash: request.aggregateManifestHash, sourceEpoch: request.sourceEpoch, producer, reportedModelId: null })
  const review = await sealProducerReview({ schemaVersion: 1, protocol: 'body-producer-review-v1', campaignId: id, requestId: request.id, requestHash: request.hash, responseHash: response.hash, result })
  snapshot = (await repository.commit(snapshot, { kind: 'resolve', operationId: 'request:resolve', requestId: request.id, outcome: 'review_ready', reason: null, review })).snapshot
  states.push({ label: 'resolved', io: io.fork(), snapshot })

  for (const state of states) await test(async () => {
    const disk = state.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    const monolithic = await createProducerCampaignRepository({ io: state.io.fork(), clock: () => now }).read(id)
    assert.deepEqual(monolithic, state.snapshot, `${state.label}: old replay equals transition result`)
    let fenceReadIndex = -1, lastProgressOperations = 0
    const rows = [...disk.disk], observed = await repo.verifyCurrent!(id, context(progress => {
      assert.ok(progress.verifiedOperations - lastProgressOperations <= 8)
      assert.ok(progress.verifiedOperations >= lastProgressOperations)
      lastProgressOperations = progress.verifiedOperations
      if (progress.stage === 'final_fence' && fenceReadIndex < 0) fenceReadIndex = disk.reads.length
    }), scope)
    assert.deepEqual(observed, monolithic, `${state.label}: session equals unchanged monolithic verifier`)
    assert.deepEqual([...disk.disk], rows); assert.equal(disk.writes, 0)
    const immutable = rows.filter(([key]) => key !== campaignKeys.head(id) && key !== CAMPAIGN_CATALOG_KEY)
    const stats = repo.getVerificationStats!()
    assert.equal(stats.finalFenceExpectedRecords, immutable.length); assert.equal(stats.finalFenceObservedRecords, immutable.length); assert.equal(stats.finalFencePasses, 1)
    assert.equal(stats.retainedBytes, immutable.reduce((sum, [key, raw]) => sum + Buffer.byteLength(key) + Buffer.byteLength(raw), 0))
    assert.equal(stats.retainedEntries, immutable.length)
    // Independent retained decoded-payload oracle from raw records: original
    // request/artifact rows remain in the preserved baseline; old replacement
    // bodies do not, except the current one selected by the aggregate checkpoint.
    const activeBodyHashes = new Set(state.snapshot.checkpoint.tasks.flatMap(task => task.artifact ? [task.artifact.hash] : []))
    const originHead = JSON.parse(state.snapshot.manifest.adoptedRawHead) as { sequence: number }
    const originCheckpoint = JSON.parse(disk.disk.get(campaignKeys.checkpoint(id, originHead.sequence))!) as { tasks: Array<{ artifact?: { hash: string }; request?: { hash: string } }> }
    const originalHashes = new Set(originCheckpoint.tasks.flatMap(task => [task.artifact?.hash, task.request?.hash].filter((hash): hash is string => Boolean(hash))))
    const payloadHashes = new Set(immutable.flatMap(([key, raw]) => {
      const row = JSON.parse(raw) as { hash?: string }
      const payload = key.startsWith(`writer-campaign:${id}:v3:`)
        ? /:(request|phase|response|review):/.test(key) || key.includes(':artifact:') && activeBodyHashes.has(row.hash!)
        : /:(request|artifact):/.test(key) && originalHashes.has(row.hash!)
      return payload ? [row.hash!] : []
    }))
    assert.equal(stats.activePayloadRecords, payloadHashes.size); assert.ok(stats.activePayloadRecords <= 512)
    assert.ok(fenceReadIndex >= 0)
    for (const [key] of immutable) assert.ok(disk.reads.slice(fenceReadIndex).some(batch => batch.includes(key)), `${state.label}: ${key} freshly re-observed in final fence`)
    assert.ok(stats.hostYields > 0); assert.ok(stats.maxOperationsPerAdvance <= 8)
    assert.equal(stats.sessionsCompleted, 1); assert.equal(stats.activeSessions, 0)
    observed!.origin.artifacts.clear(); observed!.checkpoint.tasks.length = 0
    assert.deepEqual(await repo.read(id, undefined, scope), state.snapshot, 'Returned graphs cannot poison the retained original proof')
    assert.equal(repo.getActionProofStats!().coldReplays, 1)
    repo.disposeActionScope!(scope); zeroRetention(repo)
  })
  await test(async () => {
    const disk = source.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    const result = await repo.adoptVerified!(id, 'adopt', identity, context(), scope)
    assert.deepEqual(result.snapshot, states[0]!.snapshot); assert.deepEqual([...disk.disk], [...states[0]!.io.disk]); assert.equal(result.replayed, false)
    assert.equal(repo.getVerificationStats!().casCalls, 1); repo.disposeActionScope!(scope); zeroRetention(repo)
    assert.notEqual(disk.disk.get(campaignKeys.head(id)), oldHead)
    assert.equal(await disk.compareAndSwapMany([{ key: campaignKeys.head(id), expectedValue: oldHead, value: oldHead }]), false, 'Loaded old writer cannot restore its old head')
  })
  await test(async () => {
    const disk = source.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    assert.equal(await repo.verifyCurrent!(id, context(), scope), null)
    assert.equal(repo.getVerificationStats!().finalFencePasses, 0)
    await createProducerCampaignRepository({ io: disk, clock: () => now }).adopt(id, 'adopt', identity)
    await assert.rejects(repo.read(id, undefined, scope), /cannot reseed/)
    await assert.rejects(repo.verifyCurrent!(id, context(), scope), /closed/); zeroRetention(repo)
  })
  await test(async () => {
    const disk = states.at(-1)!.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now })
    const first = repo.createActionScope!(id), second = repo.createActionScope!(id)
    await repo.read(id, undefined, first); const retained = repo.getActionProofStats!().retainedBytes
    let discovery = 0
    await assert.rejects(repo.verifyCurrent!(id, context(progress => {
      discovery++; assert.equal(progress.capturedBytes, 0); assert.equal(progress.capturedEntries, 0)
    }), second), { code: 'verification_capacity' })
    assert.ok(discovery > 0, "An unadmitted owner never reports the other owner's capture")
    assert.equal(repo.getActionProofStats!().retainedBytes, retained); assert.equal(repo.getActionProofStats!().admittedScopes, 1)
    repo.disposeActionScope!(first); zeroRetention(repo)
    await assert.rejects(repo.verifyCurrent!(id, context(), second), /closed/)
    assert.equal(repo.getVerificationStats!().sessionsStarted, 1); zeroRetention(repo)
  })
  await test(async () => {
    const disk = states.at(-1)!.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    await repo.verifyCurrent!(id, context(), scope)
    await assert.rejects(repo.verifyCurrent!(id, context(), scope), /already consumed/)
    assert.equal(repo.getVerificationStats!().sessionsStarted, 1)
    assert.equal(repo.getActionProofStats!().coldReplays, 1); zeroRetention(repo)
  })
  await test(async () => {
    const disk = states.at(-1)!.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    let release!: () => void, entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve }), waiting = new Promise<void>(resolve => { entered = resolve })
    disk.onRead = async () => { entered(); await held }
    const first = repo.verifyCurrent!(id, context(), scope), firstRefusal = assert.rejects(first, /closed|conflict/)
    await waiting
    await assert.rejects(repo.verifyCurrent!(id, context(), scope), /Concurrent/)
    assert.equal(repo.getVerificationStats!().sessionsStarted, 1); zeroRetention(repo)
    release(); await firstRefusal
    assert.equal(disk.writes, 0); zeroRetention(repo)
  })
  await test(async () => {
    const disk = states.at(-1)!.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    const controller = new AbortController(), ctx = { ...context(), signal: controller.signal }
    let release!: () => void, entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve }), waiting = new Promise<void>(resolve => { entered = resolve })
    disk.onRead = async () => { entered(); await held }
    // The engine disposes its scope synchronously from the abort listener; the
    // captured reason must classify this as expiry, not ordinary cancellation.
    controller.signal.addEventListener('abort', () => repo.disposeActionScope!(scope), { once: true })
    const pending = assert.rejects(repo.verifyCurrent!(id, ctx, scope))
    await waiting; controller.abort({ code: 'deadline_exceeded' })
    assert.equal(repo.getVerificationStats!().sessionsFailed, 1)
    assert.equal(repo.getVerificationStats!().sessionsCancelled, 0); zeroRetention(repo)
    release(); await pending; assert.equal(disk.writes, 0); zeroRetention(repo)
  })
  await test(async () => {
    for (const key of [campaignKeys.checkpoint(id, 0), producerKeys.manifest(id, snapshot.manifest.hash), producerKeys.checkpoint(id, snapshot.head.sequence),
      producerKeys.receipt(id, snapshot.receipt.operationId), producerKeys.request(id, request.hash), producerKeys.phase(id, snapshot.checkpoint.producerRequests[0]!.phaseHash),
      producerKeys.response(id, response.hash), producerKeys.review(id, review.hash)]) {
      const disk = states.at(-1)!.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
      let altered = false
      await assert.rejects(repo.verifyCurrent!(id, context(progress => {
        if (progress.stage === 'final_fence' && !altered) {
          altered = true; const raw = disk.disk.get(key)!, decoded = JSON.parse(raw)
          const reordered = JSON.stringify(Object.fromEntries(Object.entries(decoded).reverse()))
          assert.notEqual(reordered, raw); assert.equal(Buffer.byteLength(reordered), Buffer.byteLength(raw)); assert.deepEqual(JSON.parse(reordered), decoded)
          disk.disk.set(key, reordered)
        }
      }), scope), /differs from its verified action prefix/)
      assert.equal(altered, true); assert.equal(disk.writes, 0); assert.equal(repo.getVerificationStats!().finalFencePasses, 0); zeroRetention(repo)
    }
  })
  await test(async () => {
    const disk = states.at(-1)!.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    let scheduled = false, changed = false
    await assert.rejects(repo.verifyCurrent!(id, context(progress => {
      if (!scheduled && progress.verifiedOperations >= 8) { scheduled = true; setTimeout(() => { changed = true; disk.disk.delete(campaignKeys.head(id)) }, 0) }
    }), scope), /across verification suspension/)
    assert.equal(changed, true); assert.equal(disk.writes, 0); zeroRetention(repo)
  })
  await test(async () => {
    const disk = states.at(-1)!.io.fork(), repo = createProducerCampaignRepository({ io: disk, clock: () => now }), scope = repo.createActionScope!(id)
    const ctx = context(function (this: void) { assert.equal(this, undefined) })
    ctx.check = function (this: void) { assert.equal(this, undefined) }
    await repo.verifyCurrent!(id, ctx, scope)
    repo.disposeActionScope!(scope); zeroRetention(repo)
  })
  await test(async () => {
    const stats = emptyVerificationStats(), executor = new ProducerVerificationExecutor(context(), stats, () => {}, id)
    executor.start(); executor.setPurpose('current_v3')
    const entries = new Map<string, string>(), originKey = campaignKeys.manifest(id, 'a'.repeat(64)), tailKey = producerKeys.manifest(id, 'b'.repeat(64))
    executor.bindCapture((key, raw) => { entries.set(key, raw) }, () => ({ bytes: 4, entries: entries.size, active: 0 }))
    executor.captureRaw('origin', originKey, '{}', 2); executor.validated(originKey)
    executor.captureRaw('tail', tailKey, '{}', 2)
    assert.throws(() => executor.assertCoverage(entries), /incomplete/)
    executor.validated(tailKey); executor.assertCoverage(entries)
    assert.throws(() => executor.assertCoverage(new Map([[originKey, '{}']])), /incomplete/)
    assert.throws(() => executor.captureRaw('origin', tailKey, '{}', 2), /partition/)
    executor.fail(new Error('controlled_end'))
    assert.equal(stats.sessionsFailed, 1); assert.equal(stats.sessionsDisposed, 1); assert.equal(stats.activeSessions, 0)
  })
  await test(async () => {
    // The production pool accepts reduced caps only for focused boundary tests;
    // sessions do not get another allowance or a caller-supplied verified W.
    for (const limits of [{ bytes: 10, entries: 2 }, { bytes: 9, entries: 3 }, { bytes: 100, entries: 1 }]) {
      const pool = new CampaignActionProofPool(limits), token = pool.create(id), lease = pool.begin(token, id)!
      pool.capture(lease); pool.observe(lease, 'one', '{}', 2)
      assert.equal(pool.observations().retainedBytes, 5)
      pool.observe(lease, 'two', '{}', 2)
      if (limits.bytes === 10) {
        assert.equal(pool.observations().retainedBytes, 10); assert.equal(pool.observations().retainedEntries, 2)
        pool.observe(lease, 'tri', '{}', 2)
      }
      assert.equal(pool.collecting(lease), false)
      assert.equal(pool.observations().retainedBytes, 0); assert.equal(pool.observations().retainedEntries, 0)
      assert.equal(pool.observations().disposalReasons.capacity, 1)
    }
    assert.throws(() => new CampaignActionProofPool({ bytes: 67_108_865 }))
    assert.equal(CAMPAIGN_PROOF_ENTRY_LIMIT, 8193)
    assert.throws(() => new CampaignActionProofPool({ entries: 8194 }))
    const pool = new CampaignActionProofPool(), token = pool.create(id), lease = pool.begin(token, id)!
    pool.capture(lease); pool.observe(lease, 'one', '{}', 2); pool.seal(lease, states[0]!.snapshot.origin, [id])
    assert.throws(() => pool.sealAggregate(lease, 4, 1), /capacity/)
    pool.sealAggregate(lease, 5, 512); assert.equal(pool.observations().activeRecords, 512)
    assert.throws(() => pool.sealAggregate(lease, 5, 513))
    assert.equal(pool.observations().activeRecords, 512)
    pool.dispose(token); assert.equal(pool.observations().activeRecords, 0)
  })
  await test(async () => {
    let monotonic = 0
    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now')
    Object.defineProperty(performance, 'now', { configurable: true, value: () => monotonic })
    try {
      const stats = emptyVerificationStats(), executor = new ProducerVerificationExecutor(context(), stats, () => {}, id)
      executor.start(); monotonic += 120
      await executor.io('read', async () => null) // Promise-only IO must not erase the first CPU segment.
      monotonic += 129; executor.check()
      assert.equal(stats.synchronousSegmentMaxMs, 249)
      monotonic++
      assert.throws(() => executor.check(), { code: 'verification_quantum_exceeded' })
      assert.equal(stats.synchronousSegmentMaxMs, 250)
      executor.fail({ code: 'verification_quantum_exceeded' })
      assert.equal(stats.sessionsFailed, 1); assert.equal(stats.sessionsDisposed, 1)

      const awaitedStats = emptyVerificationStats(), awaited = new ProducerVerificationExecutor(context(), awaitedStats, () => {}, id)
      awaited.start()
      await awaited.io('read', async () => { await Promise.resolve(); monotonic += 1000; return null })
      awaited.check(); assert.equal(awaitedStats.rawIoMaxMs, 1000); assert.equal(awaitedStats.synchronousSegmentMaxMs, 0)
      awaited.complete()

      // Fixed monotonic time isolates operation-count yielding from the separate
      // 50 ms host-yield trigger: 18 operations must publish full 8, 8, 2 advances.
      const counts: number[] = [], quantumStats = emptyVerificationStats()
      const quantum = new ProducerVerificationExecutor(context(progress => { counts.push(progress.verifiedOperations) }), quantumStats, () => {}, id)
      quantum.start(); quantum.setPurpose('current_v3'); quantum.bindResumeFence(async () => {})
      for (let index = 0; index < 18; index++) await quantum.checkpoint(true)
      quantum.complete()
      const deltas = counts.map((count, index) => count - (counts[index - 1] ?? 0))
      assert.deepEqual(deltas, [0, 8, 8, 2]); assert.equal(quantumStats.maxOperationsPerAdvance, 8); assert.equal(quantumStats.hostYields, 2)
    } finally { if (originalNow) Object.defineProperty(performance, 'now', originalNow); else Reflect.deleteProperty(performance, 'now') }
  })
  console.log(JSON.stringify({ suite: 'body-producer-session-store', cases, immutableTamperFamilies: 8, sdkCalls: 0, profilesExecuted: false, browserExecuted: false }))
} finally { writer.dispose(); guard.restore() }
