/** Actual repository transitions over atomic in-memory IO; no transport or browser claims. */
import assert from 'node:assert/strict'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import type { BodyProducerRequest, ProducerCampaignSnapshot } from '../src/types/bodyProducer'
import { createCampaignRepository, campaignKeys } from '../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createProducerCampaignRepository, producerKeys, sealProducerRequest, sealProducerResponse, sealProducerReview } from '../src/services/writerCampaign/producerStore'
import { producerMetadataBound, producerStorageAllowance } from '../src/services/writerCampaign/producerStorage'
import { compileProducedBodyEvidence, prepareBodyProducerInput } from '../src/services/writerCampaign/bodyProducerEvidence'
import { canonicalStringify, decodeStorageBytes, emptyCampaignBudget, encodeStorageBytes, hashText, sealCampaignManifest, utf8Bytes } from '../src/services/writerCampaign/protocol'
import { planningManifestOptions } from '../src/services/writerCampaign/planningProfile'
import { installNodePlanningAuthorityGuard } from './fixtures/writer-campaign-planning-authority.mjs'

class AtomicIO implements CampaignRepositoryIO {
  disk = new Map<string, string>()
  writes = 0
  writtenBytes = 0
  loseAck = false
  refuse = false
  beforeRead: ((keys: readonly string[]) => void) | null = null
  async getMany(keys: readonly string[]) {
    this.beforeRead?.(keys)
    return new Map(keys.map(key => [key, this.disk.get(key) ?? null]))
  }
  async compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit = () => true) {
    if (this.refuse || !canCommit() || entries.some(entry => (this.disk.get(entry.key) ?? null) !== entry.expectedValue)) return false
    assert.equal(new Set(entries.map(entry => entry.key)).size, entries.length)
    const charge = entries.reduce((sum, row) => sum + Buffer.byteLength(row.key) + Buffer.byteLength(row.value), 0)
    const receipt = entries.find(row => row.key.includes(':receipt:'))
    assert.ok(receipt)
    assert.equal(decodeStorageBytes(JSON.parse(receipt.value).serializedBytes), charge, 'independent exact key/value write oracle')
    this.writtenBytes += charge
    const checkpoint = entries.find(row => row.key.includes(':checkpoint:'))
    assert.ok(checkpoint)
    assert.equal(decodeStorageBytes(JSON.parse(checkpoint.value).storage.writtenBytes), this.writtenBytes, 'one cumulative ledger across v2 and v3')
    for (const row of entries) this.disk.set(row.key, row.value)
    this.writes++
    if (this.loseAck) { this.loseAck = false; throw new Error('ack_loss') }
    return true
  }
}
const identity = { runtimeIdentity: 'producer-store-smoke-v3', source: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }
const producer = { adapterId: 'local-test', adapterVersion: 'v1', mode: 'offline_control' as const, requestedModelId: 'synthetic', effectiveModelId: 'synthetic', configurationRevision: 'config-1', endpointIdentity: 'local-test-server' }
const guard = installNodePlanningAuthorityGuard()
const engines: Array<ReturnType<typeof createOfflineCampaignEngine>> = []
let cases = 0
async function setup(id: string, language: 'zh' | 'en' = 'en', steps = 9, attempts?: number, storageLimit?: number) {
  const io = new AtomicIO(), legacy = createCampaignRepository(io)
  let now = 1_900_000_000_000
  const engine = createOfflineCampaignEngine({ repository: legacy, identity: { runtimeIdentity: 'old-source-runtime', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }, clock: () => now })
  engines.push(engine)
  if (attempts !== undefined || storageLimit !== undefined) {
    const original = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language, now, identity: { runtimeIdentity: 'old-source-runtime', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }, profile: 'body-evidence-three-chapter' }))
    const { hash: _hash, ...payload } = original
    if (attempts !== undefined) payload.budget.attempts = attempts
    if (storageLimit !== undefined) payload.storage.limitBytes = encodeStorageBytes(storageLimit)
    await legacy.create(await sealCampaignManifest(payload), 'create')
  } else await engine.prepareBodyEvidence({ campaignId: id, language })
  for (let index = 0; index < steps; index++) await engine.step(id, `step-${index}`)
  const origin = (await legacy.read(id))!, repository = createProducerCampaignRepository({ io, clock: () => now })
  return { id, io, legacy, repository, origin, clock: () => now, setClock: (value: number) => { now = value } }
}
async function request(snapshot: ProducerCampaignSnapshot, id: string, now: number): Promise<BodyProducerRequest> {
  const artifact = [...snapshot.artifacts.values()].find(row => row.kind === 'chapter_body' && row.taskId === 'b-1' && row.hash === snapshot.checkpoint.tasks.find(task => task.taskId === 'b-1')!.artifact!.hash)!
  const prepared = await prepareBodyProducerInput(snapshot.source, { chapterOrdinal: 1, startUtf16: 0, endUtf16: artifact.text.length, planningRefs: [] })
  const reservation = emptyCampaignBudget()
  Object.assign(reservation, { attempts: 1, inputBytes: prepared.inputBytes, inputUtf16: prepared.inputUtf16, outputTokens: 1200, responseBytes: 65_536, activeMs: 60_000 })
  return sealProducerRequest({ schemaVersion: 1, protocol: 'body-producer-request-v1', campaignId: snapshot.manifest.campaignId, id, operationId: id,
    aggregateManifestHash: snapshot.manifest.hash, sourceEpoch: snapshot.checkpoint.sourceEpoch, prepared, producer, reservation, createdAt: now, expiresAt: now + 300_000 })
}
function phase(snapshot: ProducerCampaignSnapshot, id: string) {
  return snapshot.phases.get(snapshot.checkpoint.producerRequests.find(row => row.id === id)!.phaseHash)!
}
async function response(snapshot: ProducerCampaignSnapshot, origin: BodyProducerRequest, text = '{"protocol":"body-producer-output-v1","items":[],"saturated":false,"examination":{"status":"not_declared","intervals":[]}}') {
  const intent = phase(snapshot, origin.id)
  return sealProducerResponse({ schemaVersion: 1, protocol: 'body-producer-response-v1', campaignId: origin.campaignId, requestId: origin.id, requestHash: origin.hash,
    intentHash: intent.status === 'dispatch_intent' ? intent.hash : intent.intentHash!, evidenceId: `evidence-${origin.id}`, text, textHash: await hashText(text), bytes: utf8Bytes(text),
    usage: { provenance: 'synthetic_control', inputTokens: null, outputTokens: null, reasoningTokens: 0 }, reportedModelId: null })
}
async function test(action: () => Promise<void>) { await action(); cases++ }

try {
  assert.equal(producerMetadataBound(128), 237_568); assert.equal(producerStorageAllowance(128), 1_515_520)
  for (const language of ['zh', 'en'] as const) await test(async () => {
    const t = await setup(`adopt-${language}`, language), oldEntries = [...t.io.disk]
    const adopted = await t.repository.adopt(t.id, 'adopt', identity)
    assert.equal(adopted.replayed, false)
    assert.equal(adopted.snapshot.checkpoint.budget.attempts, t.origin.checkpoint.budget.attempts)
    assert.equal(adopted.snapshot.checkpoint.budget.operations, t.origin.checkpoint.budget.operations + 1)
    assert.equal(adopted.snapshot.manifest.adoptedManifestHash, t.origin.manifest.hash)
    assert.equal(adopted.snapshot.manifest.runtimeIdentity, identity.runtimeIdentity)
    for (const [key, value] of oldEntries) if (key !== campaignKeys.head(t.id)) assert.equal(t.io.disk.get(key), value)
    assert.deepEqual((await t.repository.read(t.id))!.checkpoint, adopted.snapshot.checkpoint)
    const writes = t.io.writes
    assert.equal((await t.repository.adopt(t.id, 'adopt', identity)).replayed, true); assert.equal(t.io.writes, writes)
    await assert.rejects(t.legacy.read(t.id), /Unsupported/)
  })
  await test(async () => {
    const t = await setup('active-refusal', 'en', 8), before = [...t.io.disk]
    await assert.rejects(t.repository.adopt(t.id, 'adopt', identity), /completed/)
    assert.deepEqual([...t.io.disk], before)
  })
  await test(async () => {
    const t = await setup('adoption-ack')
    t.io.loseAck = true
    await assert.rejects(t.repository.adopt(t.id, 'adopt', identity), /acknowledgment/)
    const writes = t.io.writes
    assert.equal((await t.repository.adopt(t.id, 'adopt', identity)).replayed, true)
    assert.equal(t.io.writes, writes); assert.equal((await t.repository.getReceipt(t.id, 'adopt'))!.kind, 'adopt')
  })
  await test(async () => {
    const t = await setup('source-revision'), adopted = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const beforeInput = await request(adopted, 'before', t.clock())
    const revised = (await t.repository.commit(adopted, { operationId: 'revise', kind: 'body_revision', chapterOrdinal: 1, text: 'New names: Sora saw a violet kite.\r\nA\u030A 😀 新人物。' })).snapshot
    assert.equal(revised.checkpoint.sourceEpoch, 1)
    assert.deepEqual(revised.checkpoint.tasks.filter(row => ['b-2', 'b-3'].includes(row.taskId)).map(row => row.status), ['invalidated', 'invalidated'])
    const afterInput = await request(revised, 'after', t.clock())
    assert.notEqual(afterInput.prepared.inputDigest, beforeInput.prepared.inputDigest)
    assert.ok(afterInput.prepared.wire.prompt.includes('Sora'))
    await assert.rejects(t.repository.commit(revised, { operationId: `${beforeInput.operationId}:reserve`, kind: 'reserve', request: beforeInput }), /source identity/)
    const reread = (await t.repository.read(t.id))!
    assert.equal(reread.checkpoint.bodyCharacters, [...reread.artifacts.values()].find(row => row.hash === reread.checkpoint.tasks.find(task => task.taskId === 'b-1')!.artifact!.hash)!.canonical.scalars)
    const reaccepted = (await t.repository.commit(reread, { operationId: 'readmit-two', kind: 'body_revision', chapterOrdinal: 2, text: 'The next accepted body follows the new first chapter.' })).snapshot
    assert.equal(reaccepted.checkpoint.tasks.find(row => row.taskId === 'b-2')!.status, 'committed')
    assert.equal((await t.repository.read(t.id))!.checkpoint.sourceEpoch, 2)
  })
  await test(async () => {
    const t = await setup('complete-request')
    let snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const origin = await request(snapshot, 'r1', t.clock()), startAttempts = snapshot.checkpoint.budget.attempts
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin })).snapshot
    const afterReserve = snapshot, storage = snapshot.checkpoint.storage
    assert.equal(snapshot.checkpoint.budget.attempts, startAttempts + 1)
    assert.equal(decodeStorageBytes(storage.allocatedBytes) - decodeStorageBytes(t.origin.checkpoint.storage.allocatedBytes), producerStorageAllowance(9))
    const writes = t.io.writes
    assert.equal((await t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin })).replayed, true)
    assert.equal(t.io.writes, writes)
    await assert.rejects(t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'cancel' }), /another payload/)
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:intent`, kind: 'dispatch_intent', requestId: origin.id })).snapshot
    assert.equal((await t.repository.commit(afterReserve, { operationId: `${origin.operationId}:intent`, kind: 'dispatch_intent', requestId: origin.id })).replayed, true)
    const completed = await response(snapshot, origin)
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:retain`, kind: 'retain_response', requestId: origin.id, response: completed })).snapshot
    const compiled = await compileProducedBodyEvidence(snapshot.source, origin.prepared, completed.text, { requestId: origin.id, requestHash: origin.hash, responseHash: completed.hash, intentHash: completed.intentHash,
      aggregateManifestHash: origin.aggregateManifestHash, sourceEpoch: origin.sourceEpoch, producer: origin.producer, reportedModelId: completed.reportedModelId })
    const review = await sealProducerReview({ schemaVersion: 1, protocol: 'body-producer-review-v1', campaignId: t.id, requestId: origin.id, requestHash: origin.hash, responseHash: completed.hash, result: compiled })
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:resolve`, kind: 'resolve', requestId: origin.id, outcome: 'review_ready', reason: null, review })).snapshot
    assert.equal(phase(snapshot, origin.id).status, 'resolved'); assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
    assert.equal(snapshot.checkpoint.budget.attempts, startAttempts + 1)
    assert.deepEqual((await t.repository.read(t.id))!.checkpoint, snapshot.checkpoint)
    for (const key of [producerKeys.head(t.id), producerKeys.manifest(t.id, snapshot.manifest.hash), producerKeys.checkpoint(t.id, snapshot.head.sequence),
      producerKeys.receipt(t.id, snapshot.receipt.operationId), producerKeys.request(t.id, origin.hash), producerKeys.phase(t.id, phase(snapshot, origin.id).hash),
      producerKeys.response(t.id, completed.hash), producerKeys.review(t.id, review.hash)]) {
      const original = t.io.disk.get(key)!, parsed = JSON.parse(original)
      const reordered = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()))
      assert.equal(Buffer.byteLength(reordered), Buffer.byteLength(original), 'same-length alternate member order defeats byte-count-only checks')
      assert.notEqual(reordered, original)
      t.io.disk.set(key, reordered)
      await assert.rejects(t.repository.read(t.id), /not canonical/)
      const [member, value] = Object.entries(parsed)[0]!
      t.io.disk.set(key, `{${JSON.stringify(member)}:${JSON.stringify(value)},${original.slice(1)}`)
      await assert.rejects(t.repository.read(t.id), /not canonical/)
      t.io.disk.set(key, original)
    }
    snapshot = (await t.repository.commit(snapshot, { operationId: 'later-source', kind: 'body_revision', chapterOrdinal: 1, text: 'A later revision does not erase historical resolved evidence.' })).snapshot
    assert.equal((await t.repository.read(t.id))!.checkpoint.sourceEpoch, 1, 'history replays reviews against their own resolution-time source')
  })
  await test(async () => {
    const t = await setup('unknown-recovery')
    let snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const origin = await request(snapshot, 'uncertain', t.clock())
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin })).snapshot
    t.io.loseAck = true
    await assert.rejects(t.repository.commit(snapshot, { operationId: `${origin.operationId}:intent`, kind: 'dispatch_intent', requestId: origin.id }), /acknowledgment/)
    snapshot = (await t.repository.read(t.id))!
    assert.equal(phase(snapshot, origin.id).status, 'dispatch_intent')
    const active = snapshot.checkpoint.budget.activeMs
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:unknown`, kind: 'outcome_unknown', requestId: origin.id, reason: 'timeout', recovery: true })).snapshot
    assert.equal(snapshot.checkpoint.budget.activeMs, active + 10_000)
    const attempts = snapshot.checkpoint.budget.attempts, outstanding = snapshot.checkpoint.storage.outstandingBytes
    snapshot = (await t.repository.commit(snapshot, { operationId: 'revise', kind: 'body_revision', chapterOrdinal: 1, text: 'Replacement after an uncertain invocation.' })).snapshot
    assert.equal(snapshot.checkpoint.storage.outstandingBytes, outstanding)
    snapshot = (await t.repository.commit(snapshot, { operationId: 'cancel', kind: 'cancel' })).snapshot
    assert.equal(snapshot.checkpoint.budget.attempts, attempts)
    assert.equal(snapshot.checkpoint.storage.openAllocations.length, 1)
    assert.equal((await t.repository.commit(snapshot, { operationId: `${origin.operationId}:intent`, kind: 'dispatch_intent', requestId: origin.id })).replayed, true, 'historical intent replay never grants a new dispatch permit')
    const late = await response(snapshot, origin, 'not-json')
    await assert.rejects(t.repository.commit(snapshot, { operationId: `${origin.operationId}:retain`, kind: 'retain_response', requestId: origin.id, response: late }), /Standalone recovery marker required/)
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:retain`, kind: 'retain_response', requestId: origin.id, response: late, recovery: true })).snapshot
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:resolve`, kind: 'resolve', requestId: origin.id, outcome: 'refused', reason: 'source_changed', recovery: true })).snapshot
    assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
    assert.equal(snapshot.checkpoint.budget.attempts, attempts)
    assert.equal((await t.repository.read(t.id))!.checkpoint.status, 'cancelled')
  })
  await test(async () => {
    const t = await setup('before-intent')
    let snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const origin = await request(snapshot, 'never-sent', t.clock())
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin })).snapshot
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:resolve`, kind: 'resolve', requestId: origin.id, outcome: 'not_dispatched', reason: 'cancelled', recovery: true })).snapshot
    assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
    assert.equal(snapshot.checkpoint.budget.attempts, t.origin.checkpoint.budget.attempts + 1)
    assert.equal((await t.repository.read(t.id))!.checkpoint.producerRequests.length, 1)
  })
  await test(async () => {
    const t = await setup('immutable-tamper'), snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const key = campaignKeys.checkpoint(t.id, 0), before = t.io.disk.get(key)!
    t.io.disk.set(key, before.replace('"prepared"', '"paused"'))
    await assert.rejects(t.repository.read(t.id)); t.io.disk.set(key, before)
    const v3key = producerKeys.checkpoint(t.id, snapshot.head.sequence), v3before = t.io.disk.get(v3key)!
    t.io.disk.set(v3key, v3before.replace('"sourceEpoch":0', '"sourceEpoch":1'))
    await assert.rejects(t.repository.read(t.id)); t.io.disk.set(v3key, v3before)
    assert.equal((await t.repository.read(t.id))!.rawHead, snapshot.rawHead)
  })
  await test(async () => {
    const t = await setup('recognized-version')
    assert.equal(await t.repository.read(t.id), null)
    const key = campaignKeys.head(t.id), raw = t.io.disk.get(key)!
    t.io.disk.set(key, raw.replace('"schemaVersion":2', '"schemaVersion":4'))
    await assert.rejects(t.repository.read(t.id), (error: unknown) => (error as { code: string }).code === 'unsupported_schema')
    t.io.disk.set(key, raw.replace('"checkpointHash":"', '"checkpointHash":"bad'))
    await assert.rejects(t.repository.read(t.id))
    t.io.disk.set(key, raw)
  })
  await test(async () => {
    const t = await setup('duplicate-cas'), snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const origin = await request(snapshot, 'one-command', t.clock()), writes = t.io.writes
    const mutation = { operationId: `${origin.operationId}:reserve`, kind: 'reserve' as const, request: origin }
    const results = await Promise.all([t.repository.commit(snapshot, mutation), t.repository.commit(snapshot, mutation)])
    assert.deepEqual(results.map(row => row.replayed).sort(), [false, true])
    assert.equal(t.io.writes, writes + 1)
    assert.equal((await t.repository.read(t.id))!.checkpoint.budget.attempts, snapshot.checkpoint.budget.attempts + 1)
  })
  await test(async () => {
    const t = await setup('forged-snapshot'), snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const originalBudget = { ...snapshot.checkpoint.budget }, originalStorage = { ...snapshot.checkpoint.storage }
    snapshot.checkpoint.budget.attempts = 0
    snapshot.checkpoint.storage.writtenBytes = '0000000000000000' as typeof snapshot.checkpoint.storage.writtenBytes
    snapshot.origin.manifest.budget.attempts = 9999
    const changed = (await t.repository.commit(snapshot, { operationId: 'manual', kind: 'body_revision', chapterOrdinal: 1, text: 'Caller snapshots carry no accounting authority.' })).snapshot
    assert.equal(changed.checkpoint.budget.attempts, originalBudget.attempts)
    assert.ok(decodeStorageBytes(changed.checkpoint.storage.writtenBytes) > decodeStorageBytes(originalStorage.writtenBytes))
    assert.equal(changed.origin.manifest.budget.attempts, 128)
  })
  await test(async () => {
    const t = await setup('shared-attempt-exhaustion', 'en', 9, 9), snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const origin = await request(snapshot, 'over-budget', t.clock()), writes = t.io.writes
    await assert.rejects(t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin }), /Shared Campaign budget exhausted/)
    assert.equal(t.io.writes, writes)
    assert.equal((await t.repository.read(t.id))!.checkpoint.budget.attempts, 9)
  })
  await test(async () => {
    const t = await setup('eight-origin-limit')
    let snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    for (let index = 0; index < 8; index++) {
      const origin = await request(snapshot, `bounded-${index}`, t.clock())
      snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin })).snapshot
      snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:resolve`, kind: 'resolve', requestId: origin.id, outcome: 'not_dispatched', reason: 'cancelled' })).snapshot
    }
    const ninth = await request(snapshot, 'ninth', t.clock()), writes = t.io.writes
    await assert.rejects(t.repository.commit(snapshot, { operationId: `${ninth.operationId}:reserve`, kind: 'reserve', request: ninth }), /capacity conflict/)
    assert.equal(t.io.writes, writes)
    assert.equal((await t.repository.read(t.id))!.checkpoint.producerRequests.length, 8)
  })
  await test(async () => {
    const t = await setup('serialization-envelope'), snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const origin = await request(snapshot, 'size-check', t.clock())
    const { hash: _hash, ...payload } = origin
    payload.prepared.window.text = '\u0000'.repeat(16_384)
    await assert.rejects(sealProducerRequest(payload), /serialization exceeds bound/)
    // Independent conservative metadata shape: maxima of every indexed string and 128 allocations.
    const longId = 'x'.repeat(128), digest = 'f'.repeat(64), reference = { taskId: longId, revision: 2048, hash: digest }
    const checkpoint = structuredClone(snapshot.checkpoint)
    checkpoint.campaignId = longId; checkpoint.operationId = longId; checkpoint.candidateId = longId
    checkpoint.tasks = Array.from({ length: 128 }, () => ({ taskId: longId, revision: 2048, status: 'committed', artifact: reference, priorArtifact: reference, request: { id: longId, revision: 2048, hash: digest } }))
    checkpoint.producerRequests = Array.from({ length: 8 }, () => ({ id: longId, requestHash: digest, phaseHash: digest, phaseRevision: 4 }))
    checkpoint.storage.openAllocations = Array.from({ length: 128 }, () => ({ request: { id: longId, revision: 4, hash: digest }, remainingBytes: '0000000015155200' as typeof checkpoint.storage.writtenBytes }))
    const phaseRecord = { schemaVersion: 1, protocol: 'body-producer-phase-v1', campaignId: longId, requestId: longId, requestHash: digest, revision: 4, parentHash: digest, status: 'resolved', intentHash: digest, responseHash: digest,
      resolution: { outcome: 'not_dispatched', reason: 'x'.repeat(64), reviewHash: digest }, reason: 'x'.repeat(64), hash: digest }
    const receipt = { ...snapshot.receipt, campaignId: longId, operationId: longId, event: { requestHash: digest, phaseHash: digest, responseHash: digest, reviewHash: digest, artifact: reference } }
    const head = { ...snapshot.head, campaignId: longId, receiptId: longId }
    const rows = [[producerKeys.checkpoint(longId, 2047), checkpoint], [producerKeys.receipt(longId, longId), receipt], [producerKeys.phase(longId, digest), phaseRecord], [producerKeys.head(longId), head]] as const
    const measured = rows.reduce((sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(canonicalStringify(value)), 0)
    assert.ok(measured < producerMetadataBound(128), `${measured} <= frozen metadata envelope`)
  })
  await test(async () => {
    const ceiling = 4 * 1_048_576, t = await setup('shared-storage-exhaustion', 'en', 9, undefined, ceiling)
    let snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot, revision = 0
    const free = () => ceiling - decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes) - decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes) - decodeStorageBytes(snapshot.checkpoint.storage.recoveryRemainingBytes)
    while (free() >= producerStorageAllowance(9)) {
      assert.ok(revision < 80, 'bounded source revisions reach the same aggregate storage edge')
      snapshot = (await t.repository.commit(snapshot, { operationId: `capacity-${revision}`, kind: 'body_revision', chapterOrdinal: 3, text: `${revision++}:` + 'x'.repeat(65_500) })).snapshot
    }
    const origin = await request(snapshot, 'no-second-pool', t.clock()), before = t.io.writes
    await assert.rejects(t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin }), /storage admission exhausted/)
    assert.equal(t.io.writes, before)
    assert.equal((await t.repository.read(t.id))!.checkpoint.storage.writtenBytes, snapshot.checkpoint.storage.writtenBytes)
    assert.ok(decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes) + decodeStorageBytes(snapshot.checkpoint.storage.recoveryRemainingBytes) < ceiling)
  })
  await test(async () => {
    const t = await setup('expired-owner-recovery')
    let snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const origin = await request(snapshot, 'expired-owner', t.clock())
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:reserve`, kind: 'reserve', request: origin })).snapshot
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:intent`, kind: 'dispatch_intent', requestId: origin.id })).snapshot
    t.setClock(t.clock() + 60_000)
    const writes = t.io.writes, activeMs = snapshot.checkpoint.budget.activeMs
    await assert.rejects(t.repository.commit(snapshot, { operationId: `${origin.operationId}:unknown`, kind: 'outcome_unknown', requestId: origin.id, reason: 'timeout' }), /Standalone recovery marker required/)
    assert.equal(t.io.writes, writes)
    snapshot = (await t.repository.commit(snapshot, { operationId: `${origin.operationId}:unknown`, kind: 'outcome_unknown', requestId: origin.id, reason: 'timeout', recovery: true })).snapshot
    assert.equal(snapshot.checkpoint.budget.activeMs, activeMs + 10_000)
    assert.equal((await t.repository.read(t.id))!.checkpoint.storage.openAllocations.length, 1)
  })
  await test(async () => {
    const t = await setup('head-fence'), snapshot = (await t.repository.adopt(t.id, 'adopt', identity)).snapshot
    const headKey = campaignKeys.head(t.id), raw = t.io.disk.get(headKey)!
    let fired = false
    t.io.beforeRead = keys => { if (!fired && keys.some(key => key.includes(':checkpoint:0'))) { fired = true; t.io.disk.set(headKey, raw.replace('"active"', '"cancelled"')) } }
    await assert.rejects(t.repository.read(t.id), /head changed/)
    t.io.beforeRead = null; t.io.disk.set(headKey, raw)
    assert.equal((await t.repository.read(t.id))!.rawHead, snapshot.rawHead)
  })
  console.log(JSON.stringify({ status: 'passed', cases, transportCalls: 0, nativeIndexedDB: 'not_run', envelopeMaximum: producerStorageAllowance(128) }))
} finally {
  for (const engine of engines) engine.dispose()
  guard.restore()
}
