/** Exact old/new CPU-reuse equivalence. Bounded in-memory fixtures, no provider or browser. */
import assert from 'node:assert/strict'
import type { CampaignBudget, CampaignCheckpoint, CampaignManifest, CampaignOperationKind, CampaignReceipt, CampaignRepositoryIO, CampaignRequest, CampaignSnapshot, CampaignState, CampaignStorageState } from '../src/types/writerCampaign'
import { CAMPAIGN_LIMITS, canonicalStringify, decodeStorageBytes as dec, emptyCampaignBudget, encodeStorageBytes as enc, hashText, parseCampaignRecord, sealCampaignArtifact, sealCampaignManifest, sealCampaignRequest, utf8Bytes } from '../src/services/writerCampaign/protocol'
import * as current from '../src/services/writerCampaign/storageAccounting'
import * as prior from './fixtures/writer-campaign-storage-cpu-oracle'
import { CAMPAIGN_CATALOG_KEY, campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'

const H = 'a'.repeat(64), SAFE = Number.MAX_SAFE_INTEGER
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const inputs = ['', 'plain', '\\"\b\t\n\r\f\u0000', '中😀e\u0301\r\n', canonicalStringify({ nested: '\u0000\\"中😀' }), '\u0000'.repeat(65_536), '中'.repeat(21_845) + 'x', '😀'.repeat(16_384)]
const statuses: CampaignRequest['status'][] = ['reserved', 'dispatch_intent', 'outcome_unknown', 'response_retained', 'committed', 'known_failed']
let activeCase = 'bounds', comparisons = 0, refusals = 0, measuredWrites = 0, stableReads = 0, rawRefusals = 0
function manifest(taskCount = 5): CampaignManifest {
  return { schemaVersion: 2, protocolVersion: 'campaign-v2', campaignId: 'cpu-equivalence', candidateId: 'candidate', language: 'en',
    bodyTarget: { unit: 'unicode_scalar', characters: 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1', fixtureVersion: 'cpu-equivalence-v1', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: 'node-smoke',
    source: { commit: null, tree: null }, createdAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000, maxRepairRounds: 0, maxProviderRetries: 0,
    tasks: Array.from({ length: taskCount }, (_, i) => ({ id: `task-${i}`, kind: 'outline', chapterOrdinal: null, dependsOn: [] })),
    budget: { attempts: 128, inputBytes: 8_388_608, inputUtf16: 8_388_608, outputTokens: 8_388_608, reasoningTokens: 0, responseBytes: 8_388_608, activeMs: 1_600_000, artifacts: 256, operations: 2048 },
    storage: { limitBytes: enc(67_108_864), recoveryReserveBytes: enc(524_288) }, hash: H }
}
function requestFor(m: CampaignManifest, input = '{}', responseBytes = 65_536): CampaignRequest {
  return { schemaVersion: 2, campaignId: m.campaignId, id: 'request', revision: 0, parentHash: null, taskId: m.tasks[0]!.id, taskRevision: 0, candidateId: m.candidateId, adapterId: m.adapterId,
    inputDigest: H, preparedInput: input, commandId: 'step', inputBytes: bytes(input), inputUtf16: input.length, status: 'reserved',
    reservation: { ...emptyCampaignBudget(), attempts: 1, inputBytes: bytes(input), inputUtf16: input.length, outputTokens: responseBytes, responseBytes, activeMs: 10_000 },
    storageAllocationBytes: prior.campaignRequestStorageAllowance(input, m.tasks.length, responseBytes), response: null, failureReason: null, hash: H }
}
function seed(request: CampaignRequest, remaining: number): CampaignStorageState {
  return { ...current.emptyCampaignStorage(524_288), allocatedBytes: enc(remaining), outstandingBytes: enc(remaining), openAllocations: [{ request: { id: request.id, revision: request.revision, hash: request.hash }, remainingBytes: enc(remaining) }] }
}
function kind(status: CampaignRequest['status']): Exclude<CampaignOperationKind, 'create'> {
  return status === 'reserved' ? 'reserve' : status === 'dispatch_intent' ? 'dispatch_intent' : status === 'response_retained' ? 'retain_response' : status === 'committed' ? 'accept_artifact' : 'reconcile'
}
function outcome<T>(run: () => T) {
  try { return { value: run() } } catch (error) {
    assert.ok(error instanceof Error)
    return { error: { name: error.name, message: error.message, code: 'code' in error ? error.code : null } }
  }
}
function equivalent<T>(old: () => T, next: () => T) {
  const expected = outcome(old), actual = outcome(next)
  assert.deepEqual(actual, expected); comparisons++
  if (actual.error) refusals++
  return actual
}
function apply(m: CampaignManifest, previous: CampaignStorageState, operation: CampaignOperationKind, request: CampaignRequest | null, charge: number) {
  const before = structuredClone({ m, previous, request })
  const result = equivalent(() => prior.applyCampaignStorage(m, previous, operation, request, charge), () => current.applyCampaignStorage(m, previous, operation, request, charge))
  assert.deepEqual({ m, previous, request }, before, 'Success and refusal preserve caller-owned inputs')
  if (result.value) {
    const storage = result.value.storage
    assert.equal(dec(storage.allocatedBytes) - dec(storage.allocationConsumedBytes) - dec(storage.releasedBytes), dec(storage.outstandingBytes))
    assert.equal(storage.openAllocations.reduce((sum, row) => sum + dec(row.remainingBytes), 0), dec(storage.outstandingBytes))
    assert.ok(dec(storage.writtenBytes) + dec(storage.outstandingBytes) + dec(storage.recoveryRemainingBytes) <= dec(m.storage.limitBytes))
  }
  return result
}
function encodeCalls(run: () => unknown) {
  const original = TextEncoder.prototype.encode
  let calls = 0
  TextEncoder.prototype.encode = function (input) { calls++; return original.call(this, input) }
  try { run(); return calls } finally { TextEncoder.prototype.encode = original }
}
function arithmetic() {
  for (const input of inputs) for (const tasks of [1, 5, 128]) for (const response of [1, 65_536]) {
    const m = manifest(tasks), request = requestFor(m, input, response)
    assert.equal(utf8Bytes(input), bytes(input))
    const bounds = equivalent(() => prior.campaignRequestBounds(input, tasks, response), () => current.campaignRequestBounds(input, tasks, response)).value!
    assert.equal(bounds.Q, 8192 + bytes(JSON.stringify(input)))
    equivalent(() => prior.campaignRequestStorageAllowance(input, tasks, response), () => current.campaignRequestStorageAllowance(input, tasks, response))
    for (const status of statuses) {
      const phase = { ...request, status }, operation = kind(status)
      const phaseBound = equivalent(() => prior.campaignRequestPhaseBound(phase, tasks), () => current.campaignRequestPhaseBound(phase, tasks)).value!
      const futureBound = equivalent(() => prior.campaignRequestFutureBound(phase, tasks), () => current.campaignRequestFutureBound(phase, tasks)).value!
      for (const charge of [0, 1, phaseBound - 1, phaseBound, phaseBound + 1]) {
        const previous = status === 'reserved' ? current.emptyCampaignStorage(524_288) : seed(phase, bounds.allowance)
        apply(m, previous, operation, phase, charge)
      }
      if (status !== 'reserved') for (const delta of [-1, 0, 1]) apply(m, seed(phase, phaseBound + futureBound + delta), operation, phase, phaseBound)
      if (status === 'known_failed' || status === 'outcome_unknown') {
        const result = apply(m, seed(phase, bounds.allowance), 'reconcile', phase, 1).value!
        assert.equal(result.storage.openAllocations.length, 1, 'Failure/unknown obligations stay open')
        assert.equal(result.effect.releasedBytes, enc(0))
        apply(m, result.storage, 'cancel', null, 1)
      }
    }
  }
  activeCase = 'rejection_boundaries'
  for (const input of ['x'.repeat(65_537), '中'.repeat(21_846), '😀'.repeat(16_385), '\ud800', '\udc00', '\ud800x']) {
    equivalent(() => prior.campaignRequestBounds(input, 5, 1), () => current.campaignRequestBounds(input, 5, 1))
    const m = manifest(), request = { ...requestFor(m), preparedInput: input }
    apply(m, current.emptyCampaignStorage(524_288), 'reserve', request, 0)
    apply(m, seed(request, dec(request.storageAllocationBytes)), 'dispatch_intent', { ...request, status: 'dispatch_intent' }, 0)
  }
  for (const tasks of [0, 129, -1, 0.5, NaN, Infinity, SAFE + 1]) equivalent(() => prior.campaignRequestBounds('x', tasks, 1), () => current.campaignRequestBounds('x', tasks, 1))
  for (const response of [0, 65_537, -1, 0.5, NaN, Infinity, SAFE + 1]) {
    equivalent(() => prior.campaignRequestBounds('x', 5, response), () => current.campaignRequestBounds('x', 5, response))
    const m = manifest(), request = requestFor(m); request.reservation.responseBytes = response
    apply(m, current.emptyCampaignStorage(524_288), 'reserve', request, 0)
    apply(m, seed(request, 2_000_000), 'dispatch_intent', { ...request, status: 'dispatch_intent' }, 0)
  }
  const m = manifest(), request = requestFor(m), allowance = dec(request.storageAllocationBytes), empty = current.emptyCampaignStorage(524_288)
  for (const charge of [-1, 0.5, NaN, Infinity, SAFE, SAFE + 1]) apply(m, empty, 'reserve', request, charge)
  for (const allocation of [enc(allowance - 1), enc(allowance + 1), '1', '9999999999999999']) apply(m, empty, 'reserve', { ...request, storageAllocationBytes: allocation as CampaignRequest['storageAllocationBytes'] }, 1)
  apply(m, seed(request, allowance), 'reserve', request, 1)
  apply(m, empty, 'dispatch_intent', { ...request, status: 'dispatch_intent' }, 1)
  apply(m, seed(request, 0), 'dispatch_intent', { ...request, status: 'dispatch_intent' }, 1)
  apply(m, seed(request, allowance), 'accept_artifact', { ...request, status: 'response_retained' }, 1)
  const full = { ...empty, allocatedBytes: enc(128), outstandingBytes: enc(128), openAllocations: Array.from({ length: 128 }, (_, i) => ({ request: { id: `other-${String(i).padStart(3, '0')}`, revision: 0, hash: H }, remainingBytes: enc(1) })) }
  apply(m, full, 'reserve', request, 1)
  for (const delta of [-1, 0, 1]) apply({ ...m, storage: { ...m.storage, limitBytes: enc(524_288 + allowance + delta) } }, empty, 'reserve', request, 1)
  for (const storage of [
    { ...empty, writtenBytes: enc(SAFE) }, { ...empty, outstandingBytes: enc(1) }, { ...empty, allocatedBytes: enc(1) },
    { ...empty, recoveryRemainingBytes: enc(524_289) }, { ...empty, allocatedBytes: enc(1), allocationConsumedBytes: enc(1) },
    { ...empty, openAllocations: [{ request: { id: request.id, revision: 0, hash: H }, remainingBytes: enc(1) }] },
    { ...empty, extra: 1 },
  ]) apply(m, storage, 'start', null, 0)
  for (const operation of ['start', 'pause', 'block', 'reconcile', 'cancel'] as const) for (const delta of [-1, 0, 1]) {
    const final = current.campaignFinalCancelBytes(m.tasks.length)
    apply(m, { ...empty, recoveryRemainingBytes: enc(final + 100 + delta) }, operation, null, 100)
  }
  apply(m, { ...empty, recoveryRemainingBytes: enc(0) }, 'cancel', null, 1)
  activeCase = 'local_reuse_count'
  const oldReserve = encodeCalls(() => prior.applyCampaignStorage(m, empty, 'reserve', request, 1))
  const newReserve = encodeCalls(() => current.applyCampaignStorage(m, empty, 'reserve', request, 1))
  const open = seed(request, allowance), dispatched = { ...request, status: 'dispatch_intent' as const }
  const oldPhase = encodeCalls(() => prior.applyCampaignStorage(m, open, 'dispatch_intent', dispatched, 1))
  const newPhase = encodeCalls(() => current.applyCampaignStorage(m, open, 'dispatch_intent', dispatched, 1))
  assert.deepEqual({ oldReserve, newReserve, oldPhase, newPhase }, { oldReserve: 6, newReserve: 2, oldPhase: 4, newPhase: 2 })
  // Mutate an already used object and call again: no request, revision, or cross-call cache is valid.
  request.preparedInput = 'changed中'; request.storageAllocationBytes = prior.campaignRequestStorageAllowance(request.preparedInput, 5, request.reservation.responseBytes)
  apply(m, empty, 'reserve', request, 1)
  request.preparedInput = '\ud800'; apply(m, empty, 'reserve', request, 1)
  return { oldReserve, newReserve, oldPhase, newPhase }
}

const stateOf = ({ checkpoint: c }: CampaignSnapshot): CampaignState => ({ status: c.status, reason: c.reason, executionEpoch: c.executionEpoch, candidateId: c.candidateId, tasks: structuredClone(c.tasks), budget: { ...c.budget }, storage: structuredClone(c.storage), lastWallTime: c.lastWallTime })
async function wireFixture(input: string, text: string) {
  const base = manifest(), { hash: _hash, ...payload } = base
  payload.tasks = [
    { id: 'o', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
    { id: 'c', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['o'] },
    { id: 'd', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['o', 'c'] },
    { id: 'co', kind: 'chapter_outline', chapterOrdinal: 1, dependsOn: ['d', 'c'] },
    { id: 'cb', kind: 'chapter_body', chapterOrdinal: 1, dependsOn: ['co'] },
  ]
  const m = await sealCampaignManifest(payload), disk = new Map<string, string>(), reads: string[][] = []
  let oracleStorage = prior.emptyCampaignStorage(m.storage.recoveryReserveBytes), writes = 0
  const io: CampaignRepositoryIO = {
    async getMany(keys) { reads.push([...keys]); return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (entries.some(entry => (disk.get(entry.key) ?? null) !== entry.expectedValue) || !canCommit()) return false
      const D = entries.reduce((sum, entry) => sum + bytes(entry.key) + bytes(entry.value), 0)
      const receipt = JSON.parse(entries.find(entry => entry.key.includes(':receipt:'))!.value) as CampaignReceipt
      const checkpoint = JSON.parse(entries.find(entry => entry.key.includes(':checkpoint:'))!.value) as CampaignCheckpoint
      const rawRequest = entries.find(entry => entry.key.includes(':request:'))?.value
      assert.equal(dec(receipt.serializedBytes), D, 'D equals the exact raw bytes delivered to atomic IO')
      for (const entry of entries) { assert.equal(utf8Bytes(entry.value), bytes(entry.value)); assert.ok(bytes(entry.value) <= CAMPAIGN_LIMITS.recordBytes) }
      const rebuilt = prior.applyCampaignStorage(m, oracleStorage, receipt.kind, rawRequest ? JSON.parse(rawRequest) : null, D)
      assert.deepEqual(checkpoint.storage, rebuilt.storage); assert.deepEqual(receipt.storageEffect, rebuilt.effect)
      oracleStorage = rebuilt.storage
      for (const entry of entries) disk.set(entry.key, entry.value)
      writes++; measuredWrites++; return true
    },
  }
  const repo = createCampaignRepository(io)
  let snapshot = (await repo.create(m, 'create')).snapshot
  const start = stateOf(snapshot); start.status = 'running'; start.executionEpoch++
  snapshot = (await repo.commit(snapshot, { operationId: 'start', kind: 'start', next: start })).snapshot
  const r = requestFor(m, input), { hash: _requestHash, ...requestPayload } = r
  let request = await sealCampaignRequest({ ...requestPayload, inputDigest: await hashText(input) })
  for (const status of ['reserved', 'dispatch_intent', 'response_retained', 'committed'] as const) {
    if (status !== 'reserved') {
      const { hash: parentHash, ...old } = request
      request = await sealCampaignRequest({ ...old, status, revision: request.revision + 1, parentHash,
        response: status === 'dispatch_intent' ? null : { requestId: request.id, inputDigest: request.inputDigest, text, usage: { provenance: 'fixture', inputTokens: null, outputTokens: null, reasoningTokens: null }, evidenceId: 'completion' } })
    }
    const next = stateOf(snapshot), task = next.tasks[0]!
    task.request = { id: request.id, revision: request.revision, hash: request.hash }; task.status = status
    if (status === 'reserved') for (const key of Object.keys(next.budget) as Array<keyof CampaignBudget>) next.budget[key] += request.reservation[key]
    const artifacts = status === 'committed' ? [await sealCampaignArtifact({ schemaVersion: 2, campaignId: m.campaignId, candidateId: m.candidateId, taskId: task.taskId, taskRevision: 0, revision: 0, kind: 'outline', dependencies: [], parentHash: null, text, semanticStatus: 'not_reviewed' })] : []
    if (artifacts[0]) task.artifact = { taskId: task.taskId, revision: 0, hash: artifacts[0].hash }
    snapshot = (await repo.commit(snapshot, { operationId: status === 'committed' ? `${request.commandId}:artifact` : `phase-${status}`, kind: kind(status), next, requests: [request], artifacts })).snapshot
  }
  const headKey = campaignKeys.head(m.campaignId), successorKey = campaignKeys.checkpoint(m.campaignId, snapshot.head.sequence + 1)
  const checkpointKeys = Array.from({ length: snapshot.head.sequence + 1 }, (_, i) => campaignKeys.checkpoint(m.campaignId, i))
  const receiptKeys = checkpointKeys.map(key => campaignKeys.receipt(m.campaignId, JSON.parse(disk.get(key)!).operationId))
  const events = [...Array.from({ length: 4 }, (_, revision) => campaignKeys.request(m.campaignId, request.id, revision)), campaignKeys.artifact(m.campaignId, request.taskId, 0)]
  const before = new Map(disk), writesBefore = writes
  for (let read = 0; read < 2; read++) {
    reads.length = 0
    const originalEncode = TextEncoder.prototype.encode, eventCounts = new Map(events.map(key => [disk.get(key)!, 0]))
    TextEncoder.prototype.encode = function (input) { if (input !== undefined && eventCounts.has(input)) eventCounts.set(input, eventCounts.get(input)! + 1); return originalEncode.call(this, input) }
    let restored: CampaignSnapshot | null
    try { restored = await repo.read(m.campaignId) } finally { TextEncoder.prototype.encode = originalEncode }
    assert.ok([...eventCounts.values()].every(count => count === 2), 'Each exact event raw value is measured at the IO frontier and independently by the public parser, not again for D or retention')
    assert.deepEqual(restored, snapshot)
    assert.deepEqual(reads, [[headKey], [headKey, CAMPAIGN_CATALOG_KEY], [headKey, campaignKeys.manifest(m.campaignId, m.hash), checkpointKeys.at(-1)!, receiptKeys.at(-1)!, successorKey], [headKey, ...checkpointKeys], [headKey, ...receiptKeys], [headKey, ...events], [headKey, CAMPAIGN_CATALOG_KEY, successorKey]], 'Stable IO coverage and order are unchanged')
    assert.deepEqual(disk, before); assert.equal(writes, writesBefore); stableReads++
  }
  // Exact raw values must be parsed again even under the same head on this same instance.
  const target = campaignKeys.request(m.campaignId, request.id, 0), original = disk.get(target)!
  for (const bad of [null, '', original + ' ', original.replace('"schemaVersion":2', '"schemaVersion": 2'), canonicalStringify({ ...JSON.parse(original), extra: 1 }), canonicalStringify({ ...JSON.parse(original), hash: '0'.repeat(64) }), '\ud800', ' '.repeat(CAMPAIGN_LIMITS.recordBytes + 1)]) {
    if (bad === null) disk.delete(target); else disk.set(target, bad)
    const corruptDisk = new Map(disk)
    await assert.rejects(repo.read(m.campaignId))
    assert.deepEqual(disk, corruptDisk); assert.equal(writes, writesBefore); rawRefusals++
  }
  disk.set(target, original)
  assert.deepEqual(await repo.read(m.campaignId), snapshot)
}
async function main() {
  const calls = arithmetic()
  activeCase = 'exact_raw_wire_bytes'
  for (const input of [inputs[2]!, inputs[3]!, inputs[5]!]) await wireFixture(input, input)
  activeCase = 'public_parser_still_independent'
  const exact = canonicalStringify({ schemaVersion: 2, text: '中😀\u0000\\"' })
  assert.deepEqual(parseCampaignRecord(exact), JSON.parse(exact))
  for (const raw of [exact + ' ', '\ud800', ' '.repeat(CAMPAIGN_LIMITS.recordBytes + 1)]) assert.throws(() => parseCampaignRecord(raw))
  console.log(JSON.stringify({ suite: 'writer-campaign-cpu-equivalence', result: 'PASS', comparisons, refusals, measuredWrites, stableReads, rawRefusals, encodeCalls: calls, liveCalls: 0 }))
}
void main().catch(() => { console.error(JSON.stringify({ suite: 'writer-campaign-cpu-equivalence', result: 'FAIL', case: activeCase, comparisons, refusals, measuredWrites, stableReads, rawRefusals, liveCalls: 0 })); process.exitCode = 1 })
