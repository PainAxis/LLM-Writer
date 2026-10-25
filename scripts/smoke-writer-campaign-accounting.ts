/** Independent v2 wire-size/arithmetic boundary checks. No browser, provider, or persistent IO. */
import assert from 'node:assert/strict'
import type {
  CampaignBudget, CampaignCheckpoint, CampaignHead, CampaignManifest, CampaignOperationKind,
  CampaignReceipt, CampaignRequest, CampaignStorageState, CampaignTaskState, StorageBytes16,
} from '../src/types/writerCampaign'
import {
  CAMPAIGN_LIMITS, canonicalStringify, decodeStorageBytes as dec, encodeStorageBytes as enc,
  emptyCampaignBudget, hashCampaignValue, hashText, parseCampaignRecord, sealCampaignArtifact, sealCampaignManifest,
  sealCampaignRequest, utf8Bytes, validateCampaignCheckpoint, validateCampaignManifest, validateCampaignReceipt,
  validateCampaignRequest, validateCampaignStorage, validateCampaignStorageEffect,
} from '../src/services/writerCampaign/protocol'
import {
  CAMPAIGN_MAX_OPEN_ALLOCATIONS, CAMPAIGN_RECOVERY_STORAGE_BYTES, addStorage, applyCampaignStorage,
  assertCampaignStorage, campaignFinalCancelBytes, campaignRequestBounds, campaignRequestFutureBound,
  campaignRequestPhaseBound, campaignRequestStorageAllowance, emptyCampaignStorage, subtractStorage,
} from '../src/services/writerCampaign/storageAccounting'
import { campaignKeys } from '../src/services/writerCampaign/store'

const SAFE = Number.MAX_SAFE_INTEGER
const H = 'f'.repeat(64)
const Z = enc(0)
const MAX_ID = `A${':'.repeat(127)}`
const CONTROL = '\u0000'
const MAX_TEXT = CONTROL.repeat(65_536)
const REASON = CONTROL.repeat(512)
const TOTAL_FIELDS = ['writtenBytes', 'allocatedBytes', 'allocationConsumedBytes', 'releasedBytes', 'outstandingBytes', 'recoveryRemainingBytes'] as const
const EFFECT_FIELDS = ['allocatedBytes', 'releasedBytes', 'remainingBytes'] as const
const STATUS_PATHS: CampaignRequest['status'][][] = [
  ['reserved', 'dispatch_intent', 'response_retained', 'committed'],
  ['reserved', 'dispatch_intent', 'outcome_unknown', 'response_retained', 'committed'],
  ['reserved', 'known_failed'],
  ['reserved', 'dispatch_intent', 'known_failed'],
  ['reserved', 'dispatch_intent', 'outcome_unknown', 'known_failed'],
]
const CASES = ['decimal_codecs', 'wire_field_inventory', 'numeric_cycle_and_frozen_write', 'escaping_and_allowance', 'maximal_record_envelopes', 'request_prefixes', 'cancel_envelopes', 'open_index_and_conservation', 'wire_schema_and_hashes'] as const
let activeCase: typeof CASES[number] = CASES[0]
let passed = 0
let prefixesChecked = 0
let decimalVectors = 0
let maxRecordBytes = 0
let maxAcceptBytes = 0
let maxCancelBytes = 0

// Use a separate byte counter so a bug in the production UTF-8 helper cannot validate its own bounds.
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
const valueBytes = (value: unknown) => bytes(canonicalStringify(value))
const entryBytes = (key: string, value: unknown) => bytes(key) + valueBytes(value)
const maxId = (index: number) => `A${String(index).padStart(3, '0')}${':'.repeat(124)}`
const maximumBudget = (): CampaignBudget => ({ attempts: SAFE, inputBytes: SAFE, inputUtf16: SAFE, outputTokens: SAFE, reasoningTokens: SAFE, responseBytes: SAFE, activeMs: SAFE, artifacts: SAFE, operations: SAFE })
const requestRef = (index: number) => ({ id: maxId(index), revision: 2048, hash: H })
const artifactRef = (index: number) => ({ taskId: maxId(index), revision: 2048, hash: H })
function maximalTasks(count: number): CampaignTaskState[] {
  // A deliberate fieldwise superset: longest status and all refs cannot coexist in a valid task.
  return Array.from({ length: count }, (_, i) => ({ taskId: maxId(i), revision: 2048, status: 'response_retained', artifact: artifactRef(i), priorArtifact: artifactRef(i), request: requestRef(i) }))
}
function openRows(count: number, remaining = 1) {
  return Array.from({ length: count }, (_, i) => ({ request: requestRef(i), remainingBytes: enc(remaining) }))
}
function maximumStorage(open: number): CampaignStorageState {
  return { writtenBytes: enc(SAFE), allocatedBytes: enc(SAFE), allocationConsumedBytes: enc(SAFE), releasedBytes: enc(SAFE), outstandingBytes: enc(SAFE), recoveryRemainingBytes: enc(SAFE), openAllocations: openRows(open, SAFE) }
}
function envelopeRecords(tasks: number, open: number, cancel: boolean) {
  const checkpoint: CampaignCheckpoint = {
    schemaVersion: 2, campaignId: MAX_ID, sequence: 2047, manifestHash: H, previousHash: H, operationId: MAX_ID,
    bodyCharacters: 8_388_608, status: cancel ? 'cancelled' : 'completed', reason: cancel ? 'user_cancelled' : REASON,
    executionEpoch: 2048, candidateId: MAX_ID, tasks: maximalTasks(tasks), budget: maximumBudget(),
    storage: maximumStorage(open), lastWallTime: SAFE, hash: H,
  }
  const receipt: CampaignReceipt = {
    schemaVersion: 2, campaignId: MAX_ID, operationId: MAX_ID, kind: cancel ? 'cancel' : 'accept_artifact',
    businessDigest: H, expectedSequence: 2046, sequence: 2047, executionEpoch: 2048, manifestHash: H,
    checkpointHash: H, artifactHashes: cancel ? [] : [H], requestHashes: cancel ? [] : [H], serializedBytes: enc(SAFE),
    storageEffect: { source: cancel ? 'recovery' : 'request', requestId: cancel ? null : MAX_ID, allocatedBytes: Z, releasedBytes: Z, remainingBytes: Z }, hash: H,
  }
  const head: CampaignHead = { schemaVersion: 2, campaignId: MAX_ID, sequence: 2047, manifestHash: H, checkpointHash: H, executionEpoch: 2048, status: checkpoint.status, receiptId: MAX_ID }
  return { checkpoint, receipt, head }
}
function metadataBytes(records: ReturnType<typeof envelopeRecords>): number {
  return entryBytes(campaignKeys.checkpoint(MAX_ID, 2047), records.checkpoint)
    + entryBytes(campaignKeys.receipt(MAX_ID, MAX_ID), records.receipt) + entryBytes(campaignKeys.head(MAX_ID), records.head)
}
function bareManifest(taskCount = 5): CampaignManifest {
  // Arithmetic-only manifest with an explicit task count. Full semantic manifest validation is tested separately.
  return { schemaVersion: 2, protocolVersion: 'campaign-v2', campaignId: 'accounting-smoke', candidateId: 'candidate', language: 'en',
    bodyTarget: { unit: 'unicode_scalar', characters: 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1', fixtureVersion: 'accounting-smoke-v2', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: 'node-smoke',
    source: { commit: null, tree: null }, createdAt: 1, expiresAt: 1_800_000_000_000, maxRepairRounds: 0, maxProviderRetries: 0,
    tasks: Array.from({ length: taskCount }, (_, i) => ({ id: `task-${i}`, kind: 'outline', chapterOrdinal: null, dependsOn: [] })),
    budget: { attempts: 128, inputBytes: 8_388_608, inputUtf16: 8_388_608, outputTokens: 8_388_608, reasoningTokens: 0, responseBytes: 8_388_608, activeMs: 1_600_000, artifacts: 256, operations: 2048 },
    storage: { limitBytes: enc(67_108_864), recoveryReserveBytes: enc(524_288) }, hash: H }
}
function requestFor(manifest: CampaignManifest, preparedInput = '{}', responseBytes = 65_536): CampaignRequest {
  return { schemaVersion: 2, campaignId: manifest.campaignId, id: 'new-request', revision: 0, parentHash: null,
    taskId: manifest.tasks[0]!.id, taskRevision: 0, candidateId: manifest.candidateId, adapterId: 'offline-fixture-v1',
    inputDigest: H, preparedInput, commandId: 'step', inputBytes: bytes(preparedInput), inputUtf16: preparedInput.length,
    status: 'reserved', reservation: { ...emptyCampaignBudget(), attempts: 1, inputBytes: bytes(preparedInput), inputUtf16: preparedInput.length, outputTokens: responseBytes, responseBytes, activeMs: 10_000 },
    storageAllocationBytes: campaignRequestStorageAllowance(preparedInput, manifest.tasks.length, responseBytes), response: null, failureReason: null, hash: H }
}
function phase(request: CampaignRequest, status: CampaignRequest['status'], revision: number): CampaignRequest {
  return { ...request, status, revision, parentHash: revision === 0 ? null : H,
    response: status === 'response_retained' || status === 'committed' ? { requestId: request.id, inputDigest: request.inputDigest, text: '', usage: { provenance: 'fixture', inputTokens: null, outputTokens: null, reasoningTokens: null }, evidenceId: 'completion' } : null,
    failureReason: status === 'known_failed' ? 'fixture_failure' : null }
}
function phaseKind(status: CampaignRequest['status']): CampaignOperationKind {
  return status === 'reserved' ? 'reserve' : status === 'dispatch_intent' ? 'dispatch_intent' : status === 'response_retained' ? 'retain_response' : status === 'committed' ? 'accept_artifact' : 'reconcile'
}
function conservedSeed(open: number, remaining = 1): CampaignStorageState {
  // Conserved arithmetic/index seeds, not claimed reachable histories. Repository tests verify allocation origins.
  return { ...emptyCampaignStorage(524_288), allocatedBytes: enc(open * remaining), outstandingBytes: enc(open * remaining), openAllocations: openRows(open, remaining) }
}
function independentBounds(input: string, tasks: number, response: number) {
  const M = 16_384 + 1024 * tasks + 512 * 128
  const Q = 8192 + bytes(JSON.stringify(input))
  const X = 6 * response + 2
  const G = 4096 + 256 * tasks
  return { M, Q, X, G, allowance: 5 * M + 5 * Q + 3 * X + G }
}
function independentPhase(status: CampaignRequest['status'], b: ReturnType<typeof independentBounds>): number {
  return b.M + b.Q + (status === 'committed' ? 2 * b.X + b.G : status === 'response_retained' ? b.X : 0)
}
function independentFuture(status: CampaignRequest['status'], b: ReturnType<typeof independentBounds>): number {
  if (status === 'reserved') return 4 * (b.M + b.Q) + 3 * b.X + b.G
  if (status === 'dispatch_intent') return 3 * (b.M + b.Q) + 3 * b.X + b.G
  if (status === 'outcome_unknown') return 2 * (b.M + b.Q) + 3 * b.X + b.G
  if (status === 'response_retained') return b.M + b.Q + 2 * b.X + b.G
  return 0
}
function decimalBoundaries(): number[] {
  const values = new Set([0, 1, SAFE - 1, SAFE])
  for (let power = 1; power <= 15; power++) for (const delta of [-1, 0, 1]) values.add(10 ** power + delta)
  return [...values].sort((a, b) => a - b)
}

async function main() {
  for (const value of decimalBoundaries()) {
    const encoded = enc(value)
    assert.match(encoded, /^[0-9]{16}$/)
    assert.equal(bytes(encoded), 16)
    assert.equal(valueBytes(encoded), 18)
    assert.equal(dec(encoded), value)
    assert.equal(enc(dec(encoded)), encoded)
    decimalVectors++
  }
  const malformed: unknown[] = [0, 1, -1, null, undefined, true, false, [], {}, new String('0000000000000000'),
    '', '0', '000000000000000', '00000000000000000', '+000000000000000', '-000000000000000',
    ' 000000000000000', '000000000000000 ', '000000000000000\n', '00000000000000.0', '0000000000000e00',
    '１'.repeat(16), '٠'.repeat(16), '9007199254740992', '9999999999999999', '000000000000000x']
  for (const value of malformed) assert.throws(() => dec(value))
  for (const value of [-1, 0.5, NaN, Infinity, -Infinity, SAFE + 1, '0000000000000000', null, undefined, 0n]) assert.throws(() => enc(value as number))
  assert.equal(addStorage(SAFE - 1, 1), SAFE)
  assert.equal(subtractStorage(SAFE, SAFE), 0)
  assert.throws(() => addStorage(SAFE, 1))
  assert.throws(() => subtractStorage(0, 1))
  assert.throws(() => addStorage(enc(1) as unknown as number, 1))
  assert.throws(() => subtractStorage(1, enc(1) as unknown as number))

  passed++; activeCase = 'wire_field_inventory'
  const wire = { ...envelopeRecords(1, 1, false), requestAllocation: Z, storagePolicy: { limitBytes: Z, recoveryReserveBytes: Z } }
  const slots: Array<(value: StorageBytes16) => void> = [
    ...TOTAL_FIELDS.map(field => (value: StorageBytes16) => { wire.checkpoint.storage[field] = value }),
    (value) => { wire.checkpoint.storage.openAllocations[0]!.remainingBytes = value },
    (value) => { wire.receipt.serializedBytes = value },
    ...EFFECT_FIELDS.map(field => (value: StorageBytes16) => { wire.receipt.storageEffect[field] = value }),
    (value) => { wire.requestAllocation = value },
    (value) => { wire.storagePolicy.limitBytes = value },
    (value) => { wire.storagePolicy.recoveryReserveBytes = value },
  ]
  assert.equal(slots.length, 14, 'Inventory includes every feedback-dependent byte field and immutable storage policy/allocation slots')
  slots.forEach(set => set(Z))
  const fixedWidth = valueBytes(wire)
  for (const set of slots) {
    for (const value of decimalBoundaries()) { set(enc(value)); assert.equal(valueBytes(wire), fixedWidth) }
    set(Z)
  }
  for (const value of decimalBoundaries()) { slots.forEach(set => set(enc(value))); assert.equal(valueBytes(wire), fixedWidth) }
  validateCampaignStorage(wire.checkpoint.storage)
  validateCampaignStorageEffect(wire.receipt.storageEffect)
  for (const field of TOTAL_FIELDS) assert.throws(() => validateCampaignStorage({ ...wire.checkpoint.storage, [field]: 1 }))
  assert.throws(() => validateCampaignStorage({ ...wire.checkpoint.storage, openAllocations: [{ request: requestRef(0), remainingBytes: 1 }] }))
  for (const field of EFFECT_FIELDS) assert.throws(() => validateCampaignStorageEffect({ ...wire.receipt.storageEffect, [field]: 1 }))

  passed++; activeCase = 'numeric_cycle_and_frozen_write'
  const numericSize = (charge: number) => 87 + String(charge).length + String(100 - charge).length
  assert.equal(numericSize(90), 91)
  assert.equal(numericSize(91), 90)
  let cycle = 90
  for (let i = 0; i < 64; i++) { cycle = numericSize(cycle); assert.equal(cycle, i % 2 === 0 ? 91 : 90) }
  const fm = bareManifest(), fr = requestFor(fm, 'frozen-input', 256)
  let beforeAccept = emptyCampaignStorage(524_288)
  for (const [revision, status] of (['reserved', 'dispatch_intent', 'response_retained'] as const).entries()) beforeAccept = applyCampaignStorage(fm, beforeAccept, phaseKind(status), phase(fr, status, revision), 100).storage
  const committedPhase = phase(fr, 'committed', 3)
  const { hash: _frozenRequestHash, ...frozenRequestPayload } = committedPhase
  const frozenInputDigest = await hashText(fr.preparedInput)
  const committed = await sealCampaignRequest({ ...frozenRequestPayload, inputDigest: frozenInputDigest, response: { ...committedPhase.response!, inputDigest: frozenInputDigest } })
  const frozenArtifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: fm.campaignId, candidateId: fm.candidateId, taskId: fr.taskId, taskRevision: 0, revision: 0, kind: 'outline', dependencies: [], parentHash: null, text: '', semanticStatus: 'not_reviewed' })
  function frozenAccept(charge: number) {
    const records = envelopeRecords(5, 1, false)
    const applied = applyCampaignStorage(fm, beforeAccept, 'accept_artifact', committed, charge)
    records.checkpoint.storage = applied.storage
    records.receipt.serializedBytes = enc(charge)
    records.receipt.storageEffect = applied.effect
    return records
  }
  const frozenWriteBytes = (records: ReturnType<typeof envelopeRecords>) => metadataBytes(records)
    + entryBytes(campaignKeys.request(fm.campaignId, committed.id, committed.revision), committed)
    + entryBytes(campaignKeys.artifact(fm.campaignId, frozenArtifact.taskId, frozenArtifact.revision), frozenArtifact)
  const K = frozenWriteBytes(frozenAccept(90))
  assert.equal(frozenWriteBytes(frozenAccept(91)), K)
  assert.equal(frozenWriteBytes(frozenAccept(K)), K)
  assert.equal(frozenAccept(K).checkpoint.storage.openAllocations.length, 0)
  const frozenFinal = frozenAccept(K)
  const { hash: _checkpointHash, ...checkpointPayload } = frozenFinal.checkpoint
  frozenFinal.checkpoint.hash = await hashCampaignValue('campaign-checkpoint-v2', checkpointPayload)
  frozenFinal.receipt.checkpointHash = frozenFinal.checkpoint.hash
  const { hash: _receiptHash, ...receiptPayload } = frozenFinal.receipt
  frozenFinal.receipt.hash = await hashCampaignValue('campaign-receipt-v2', receiptPayload)
  frozenFinal.head.checkpointHash = frozenFinal.checkpoint.hash
  assert.equal(frozenWriteBytes(frozenFinal), K, 'Filling real fixed-width hash bindings cannot alter the measured five-record charge')
  assert.equal(dec(frozenFinal.checkpoint.storage.writtenBytes), 300 + K)
  assert.equal(dec(frozenFinal.checkpoint.storage.releasedBytes), dec(fr.storageAllocationBytes) - 300 - K)
  assert.equal(beforeAccept.openAllocations.length, 1, 'Measure/fill is pure and never edits the previous state')

  passed++; activeCase = 'escaping_and_allowance'
  const nestedInput = canonicalStringify({ dependency: `${CONTROL.repeat(10_000)}\\\"\b\t\n\r\f中😀` })
  assert.ok(bytes(nestedInput) <= 65_536)
  assert.ok(bytes(JSON.stringify(nestedInput)) > bytes(nestedInput), 'Prepared JSON is a string field with an additional escaping layer')
  for (const input of ['', 'plain', '中😀', '\\"\b\t\n\r\f', nestedInput, MAX_TEXT]) {
    assert.equal(utf8Bytes(input), bytes(input))
    assert.ok(bytes(JSON.stringify(input)) <= 6 * bytes(input) + 2)
    for (const taskCount of [5, 128]) for (const responseBytes of [1, 65_536]) {
      const b = independentBounds(input, taskCount, responseBytes)
      assert.deepEqual(campaignRequestBounds(input, taskCount, responseBytes), b)
      assert.equal(dec(campaignRequestStorageAllowance(input, taskCount, responseBytes)), b.allowance)
    }
  }
  assert.equal(bytes(JSON.stringify(MAX_TEXT)), 393_218)
  assert.deepEqual(campaignRequestBounds(MAX_TEXT, 128, 65_536), { M: 212_992, Q: 401_410, X: 393_218, G: 36_864, allowance: 4_288_528 })
  for (const [input, taskCount, responseBytes] of [[MAX_TEXT + CONTROL, 5, 1], ['x', 0, 1], ['x', 129, 1], ['x', 5, 0], ['x', 5, 65_537], ['\ud800', 5, 1]] as const) assert.throws(() => campaignRequestBounds(input, taskCount, responseBytes))

  passed++; activeCase = 'maximal_record_envelopes'
  const bounds = independentBounds(MAX_TEXT, 128, 65_536)
  const maxRequest = {
    schemaVersion: 2, campaignId: MAX_ID, id: MAX_ID, revision: 2048, parentHash: H, taskId: MAX_ID, taskRevision: 2048, candidateId: MAX_ID,
    adapterId: 'offline-fixture-v1', inputDigest: H, preparedInput: MAX_TEXT, commandId: MAX_ID, inputBytes: SAFE, inputUtf16: SAFE,
    status: 'response_retained', reservation: maximumBudget(), storageAllocationBytes: enc(SAFE),
    response: { requestId: MAX_ID, inputDigest: H, text: MAX_TEXT, usage: { provenance: 'unavailable', inputTokens: SAFE, outputTokens: SAFE, reasoningTokens: SAFE }, evidenceId: MAX_ID },
    failureReason: REASON, hash: H,
  }
  const metrics = { hash: H, utf8Bytes: SAFE, utf16Units: SAFE, scalars: SAFE }
  const maxArtifact = { schemaVersion: 2, campaignId: MAX_ID, candidateId: MAX_ID, taskId: MAX_ID, taskRevision: 2048, revision: 2048,
    kind: 'detailed_outline', dependencies: Array.from({ length: 128 }, (_, i) => artifactRef(i)), parentHash: H, text: MAX_TEXT,
    raw: metrics, canonical: metrics, semanticStatus: 'not_reviewed', hash: H }
  const requestKey = campaignKeys.request(MAX_ID, MAX_ID, 2048), artifactKey = campaignKeys.artifact(MAX_ID, MAX_ID, 2048)
  assert.ok(bytes(requestKey) <= 797)
  assert.ok(bytes(artifactKey) <= 798)
  const requestSkeleton = { ...maxRequest, preparedInput: '', response: { ...maxRequest.response, text: '' } }
  const artifactSkeleton = { ...maxArtifact, text: '', dependencies: [] }
  assert.ok(valueBytes(requestSkeleton) <= 5091)
  assert.ok(entryBytes(requestKey, requestSkeleton) <= 5888)
  assert.ok(valueBytes(artifactSkeleton) <= 1066)
  assert.ok(entryBytes(artifactKey, artifactSkeleton) <= 1864)
  assert.ok(valueBytes(artifactRef(0)) + 1 <= 232)
  assert.ok(entryBytes(requestKey, { ...maxRequest, response: { ...maxRequest.response, text: '' } }) <= bounds.Q)
  assert.ok(entryBytes(requestKey, maxRequest) <= bounds.Q + bounds.X)
  assert.ok(entryBytes(artifactKey, { ...maxArtifact, text: '' }) <= bounds.G)
  assert.ok(entryBytes(artifactKey, maxArtifact) <= bounds.G + bounds.X)
  assert.ok(valueBytes(maximalTasks(1)[0]) + 1 <= 916)
  assert.ok(valueBytes(maximumStorage(1).openAllocations[0]) + 1 <= 276)
  const maxMetadata = envelopeRecords(128, 128, false)
  assert.ok(metadataBytes(envelopeRecords(0, 0, false)) < 8192)
  assert.ok(metadataBytes(maxMetadata) <= bounds.M)
  assert.ok(bytes(campaignKeys.checkpoint(MAX_ID, 2047)) <= 415)
  assert.ok(bytes(campaignKeys.receipt(MAX_ID, MAX_ID)) <= 792)
  assert.ok(bytes(campaignKeys.head(MAX_ID)) <= 404)
  assert.ok(valueBytes(maxMetadata.head) <= 531)
  assert.ok(valueBytes(maxMetadata.receipt) < 8192)
  maxAcceptBytes = metadataBytes(maxMetadata) + entryBytes(requestKey, maxRequest) + entryBytes(artifactKey, maxArtifact)
  assert.ok(maxAcceptBytes <= bounds.M + bounds.Q + 2 * bounds.X + bounds.G)
  assert.equal(bounds.M + bounds.Q + 2 * bounds.X + bounds.G, 1_437_702)
  assert.ok(maxAcceptBytes > CAMPAIGN_LIMITS.recordBytes, 'Five individually bounded records may total more than one MiB')
  for (const value of [maxRequest, maxArtifact, maxMetadata.checkpoint, maxMetadata.receipt, maxMetadata.head]) {
    const size = valueBytes(value)
    maxRecordBytes = Math.max(maxRecordBytes, size)
    assert.ok(size <= CAMPAIGN_LIMITS.recordBytes)
    assert.deepEqual(parseCampaignRecord(canonicalStringify(value)), value)
  }
  assert.ok(valueBytes(maxRequest) <= 794_628)
  assert.ok(valueBytes(maxArtifact) <= 430_082)
  assert.ok(valueBytes(maxMetadata.checkpoint) <= 212_992)
  assert.throws(() => parseCampaignRecord(' '.repeat(CAMPAIGN_LIMITS.recordBytes + 1)), /oversized/)
  // These separately sealed records are valid protocol vectors; the larger fieldwise envelopes above need not be semantically reachable.
  const validBudget = { ...maximumBudget(), attempts: 2048, artifacts: 2048, operations: 2048 }
  const { hash: _maxRequestHash, ...validRequestPayload } = maxRequest
  const validRequest = await sealCampaignRequest({ ...validRequestPayload, schemaVersion: 2, adapterId: 'offline-fixture-v1', status: 'response_retained', inputDigest: await hashText(MAX_TEXT), inputBytes: 65_536, inputUtf16: 65_536, reservation: validBudget,
    response: { ...maxRequest.response, inputDigest: await hashText(MAX_TEXT), usage: { ...maxRequest.response.usage, provenance: 'unavailable' } } })
  assert.ok(valueBytes(validRequest) <= 794_628)
  const { hash: _maxArtifactHash, raw: _raw, canonical: _canonical, ...validArtifactPayload } = maxArtifact
  const validArtifact = await sealCampaignArtifact({ ...validArtifactPayload, schemaVersion: 2, kind: 'detailed_outline', semanticStatus: 'not_reviewed' })
  assert.ok(valueBytes(validArtifact) <= 430_082)

  passed++; activeCase = 'request_prefixes'
  for (const taskCount of [5, 128]) for (const responseBytes of [1, 65_536]) for (const preexisting of [0, 127]) for (const path of STATUS_PATHS) {
    const m = bareManifest(taskCount), request = requestFor(m, nestedInput, responseBytes)
    const b = independentBounds(request.preparedInput, taskCount, responseBytes)
    let storage = conservedSeed(preexisting), spent = 0
    const untouched = structuredClone(storage.openAllocations)
    for (const [revision, status] of path.entries()) {
      const current = phase(request, status, revision), charge = independentPhase(status, b)
      assert.equal(campaignRequestPhaseBound(current, taskCount), charge)
      assert.equal(campaignRequestFutureBound(current, taskCount), independentFuture(status, b))
      const previous = structuredClone(storage)
      const result = applyCampaignStorage(m, storage, phaseKind(status), current, charge)
      assert.deepEqual(storage, previous, 'All helpers are pure on successful transitions')
      storage = result.storage; spent += charge; prefixesChecked++
      assertCampaignStorage(m, storage)
      assert.equal(dec(storage.writtenBytes), spent)
      assert.equal(dec(storage.allocationConsumedBytes), spent)
      assert.equal(dec(storage.allocatedBytes), preexisting + b.allowance)
      assert.equal(dec(storage.recoveryRemainingBytes), 524_288)
      assert.equal(result.effect.source, 'request')
      assert.equal(result.effect.requestId, request.id)
      assert.equal(dec(result.effect.allocatedBytes), revision === 0 ? b.allowance : 0)
      assert.deepEqual(storage.openAllocations.filter(row => row.request.id !== request.id), untouched)
      if (status === 'committed') {
        assert.equal(dec(result.effect.releasedBytes), b.allowance - spent)
        assert.equal(dec(storage.releasedBytes), b.allowance - spent)
        assert.equal(dec(storage.outstandingBytes), preexisting)
        assert.equal(storage.openAllocations.length, preexisting)
      } else {
        const row = storage.openAllocations.find(row => row.request.id === request.id)!
        assert.equal(dec(row.remainingBytes), b.allowance - spent)
        assert.equal(dec(result.effect.remainingBytes), b.allowance - spent)
        assert.equal(dec(result.effect.releasedBytes), 0)
        assert.equal(dec(storage.releasedBytes), 0)
        assert.equal(dec(storage.outstandingBytes), preexisting + b.allowance - spent)
        assert.equal(storage.openAllocations.length, preexisting + 1)
        assert.ok(dec(row.remainingBytes) >= independentFuture(status, b))
      }
    }
    if (path.length === 5) assert.equal(dec(storage.releasedBytes), 0, 'Exact maximum charges consume the whole five-phase allowance')
    if (path.at(-1) === 'known_failed') assert.ok(dec(storage.outstandingBytes) > preexisting, 'Known failure never settles the remaining grant')
  }
  const pm = bareManifest(), pr = requestFor(pm)
  const pBefore = emptyCampaignStorage(524_288), pOriginal = structuredClone(pBefore)
  assert.throws(() => applyCampaignStorage(pm, pBefore, 'reserve', pr, campaignRequestPhaseBound(pr, 5) + 1))
  assert.deepEqual(pBefore, pOriginal)
  const retained = phase(pr, 'response_retained', 2)
  const insufficient = campaignRequestPhaseBound(retained, 5) + campaignRequestFutureBound(retained, 5) - 1
  const short = { ...emptyCampaignStorage(524_288), allocatedBytes: enc(insufficient), outstandingBytes: enc(insufficient), openAllocations: [{ request: { id: pr.id, revision: 1, hash: H }, remainingBytes: enc(insufficient) }] }
  const shortOriginal = structuredClone(short)
  assert.throws(() => applyCampaignStorage(pm, short, 'retain_response', retained, campaignRequestPhaseBound(retained, 5)), /remaining phases/)
  assert.deepEqual(short, shortOriginal)

  passed++; activeCase = 'cancel_envelopes'
  for (const taskCount of [5, 128]) for (const open of [0, 128]) {
    const records = envelopeRecords(taskCount, open, true), D = metadataBytes(records)
    const fieldwise = 4485 + (taskCount ? 916 * taskCount - 1 : 0) + (open ? 276 * open - 1 : 0)
    const F = 16_384 + 1024 * taskCount + 512 * 128
    assert.equal(campaignFinalCancelBytes(taskCount), F)
    assert.ok(D <= fieldwise)
    assert.ok(fieldwise <= F)
    assert.ok(F <= 524_288)
    assert.equal(records.checkpoint.reason, 'user_cancelled')
    assert.equal(records.receipt.kind, 'cancel')
    assert.equal(records.receipt.storageEffect.source, 'recovery')
    assert.equal(records.receipt.storageEffect.requestId, null)
    assert.deepEqual(records.receipt.artifactHashes, [])
    assert.deepEqual(records.receipt.requestHashes, [])
    assert.ok(EFFECT_FIELDS.every(field => dec(records.receipt.storageEffect[field]) === 0))
    maxCancelBytes = Math.max(maxCancelBytes, D)
    const m = bareManifest(taskCount), storage = conservedSeed(open)
    storage.recoveryRemainingBytes = enc(F)
    const original = structuredClone(storage)
    const cancelled = applyCampaignStorage(m, storage, 'cancel', null, D)
    assert.equal(dec(cancelled.storage.recoveryRemainingBytes), F - D)
    assert.equal(dec(cancelled.storage.writtenBytes), D)
    assert.equal(dec(cancelled.storage.outstandingBytes), open)
    assert.deepEqual(cancelled.storage.openAllocations, storage.openAllocations)
    assert.deepEqual(storage, original)
    assert.deepEqual(cancelled.effect, { source: 'recovery', requestId: null, allocatedBytes: Z, releasedBytes: Z, remainingBytes: Z })
    const tight = { ...storage, recoveryRemainingBytes: enc(F + 99) }
    assert.throws(() => applyCampaignStorage(m, tight, 'pause', null, 100), /Final cancel/)
    assert.equal(dec(tight.recoveryRemainingBytes), F + 99)
    assert.equal(dec(applyCampaignStorage(m, { ...tight, recoveryRemainingBytes: enc(F + 100) }, 'pause', null, 100).storage.recoveryRemainingBytes), F)
    assert.equal(dec(applyCampaignStorage(m, storage, 'start', null, 100).storage.recoveryRemainingBytes), F)
  }
  assert.equal(campaignFinalCancelBytes(128), 212_992)
  assert.equal(524_288 - campaignFinalCancelBytes(128), 311_296)
  assert.equal(4485 + 128 * 916 - 1 + 128 * 276 - 1, 157_059)

  passed++; activeCase = 'open_index_and_conservation'
  assert.equal(CAMPAIGN_MAX_OPEN_ALLOCATIONS, 128)
  assert.equal(CAMPAIGN_RECOVERY_STORAGE_BYTES, 524_288)
  const full = conservedSeed(128), fullCopy = structuredClone(full)
  validateCampaignStorage(full)
  assertCampaignStorage(pm, full)
  assert.throws(() => applyCampaignStorage(pm, full, 'reserve', pr, 1), /Open allocation/)
  assert.deepEqual(full, fullCopy, 'The 129th open allocation refuses without removing or refunding anything')
  assert.throws(() => validateCampaignStorage({ ...full, openAllocations: openRows(129) }))
  assert.throws(() => validateCampaignStorage({ ...full, openAllocations: [...full.openAllocations].reverse() }))
  assert.throws(() => validateCampaignStorage({ ...full, openAllocations: [full.openAllocations[0], full.openAllocations[0]] }))
  const zeroSeed = { ...emptyCampaignStorage(524_288), allocatedBytes: enc(100), outstandingBytes: enc(100), openAllocations: [{ request: { id: pr.id, revision: 0, hash: H }, remainingBytes: enc(100) }] }
  const failedZero = applyCampaignStorage(pm, zeroSeed, 'reconcile', phase(pr, 'known_failed', 1), 100).storage
  assert.equal(dec(failedZero.openAllocations[0]!.remainingBytes), 0)
  assert.equal(failedZero.openAllocations.length, 1, 'A zero residual does not determine row removal')
  assert.deepEqual(applyCampaignStorage(pm, failedZero, 'cancel', null, 100).storage.openAllocations, failedZero.openAllocations)
  const direct = applyCampaignStorage(pm, emptyCampaignStorage(524_288), 'start', null, 100)
  assert.deepEqual(direct.effect, { source: 'direct', requestId: null, allocatedBytes: Z, releasedBytes: Z, remainingBytes: Z })
  assert.equal(dec(direct.storage.writtenBytes), 100)
  assert.equal(dec(direct.storage.allocationConsumedBytes), 0)
  for (const invalid of [
    { ...full, outstandingBytes: enc(129) },
    { ...full, allocatedBytes: enc(127) },
    { ...full, allocatedBytes: enc(129), allocationConsumedBytes: enc(1) },
    { ...full, recoveryRemainingBytes: enc(524_289) },
    { ...full, writtenBytes: enc(67_108_864) },
    { ...full, allocatedBytes: enc(SAFE), releasedBytes: enc(SAFE) },
  ]) assert.throws(() => assertCampaignStorage(pm, invalid))

  passed++; activeCase = 'wire_schema_and_hashes'
  const manifestPayload = bareManifest()
  manifestPayload.tasks = [
    { id: 'o', kind: 'outline', chapterOrdinal: null, dependsOn: [] }, { id: 'c', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['o'] },
    { id: 'd', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['o', 'c'] }, { id: 'co', kind: 'chapter_outline', chapterOrdinal: 1, dependsOn: ['d', 'c'] },
    { id: 'cb', kind: 'chapter_body', chapterOrdinal: 1, dependsOn: ['co'] },
  ]
  const { hash: _manifestHash, ...mp } = manifestPayload
  const sealedManifest = await sealCampaignManifest(mp)
  assert.equal(typeof sealedManifest.storage.limitBytes, 'string')
  for (const storage of [
    { ...mp.storage, limitBytes: 67_108_864 }, { ...mp.storage, recoveryReserveBytes: 524_288 },
    { ...mp.storage, limitBytes: enc(67_108_865) }, { ...mp.storage, recoveryReserveBytes: enc(524_289) },
    { ...mp.storage, recoveryReserveBytes: enc(campaignFinalCancelBytes(5) - 1) },
  ]) await assert.rejects(validateCampaignManifest({ ...sealedManifest, storage }))
  await sealCampaignManifest({ ...mp, storage: { ...mp.storage, recoveryReserveBytes: enc(campaignFinalCancelBytes(5)) } })
  await assert.rejects(validateCampaignManifest({ ...sealedManifest, budget: { ...mp.budget, serializedBytes: 0 } }))
  await assert.rejects(validateCampaignManifest({ ...sealedManifest, recoveryReserveBytes: 524_288 }))
  const rawRequest = requestFor(sealedManifest, nestedInput, 65_536)
  const { hash: _requestHash, ...rp } = rawRequest
  const sealedRequest = await sealCampaignRequest({ ...rp, inputDigest: await hashText(rp.preparedInput) })
  assert.equal((await validateCampaignRequest(parseCampaignRecord(canonicalStringify(sealedRequest)))).storageAllocationBytes, sealedRequest.storageAllocationBytes)
  await assert.rejects(validateCampaignRequest({ ...sealedRequest, storageAllocationBytes: dec(sealedRequest.storageAllocationBytes) }))
  await assert.rejects(validateCampaignRequest({ ...sealedRequest, storageAllocationBytes: enc(dec(sealedRequest.storageAllocationBytes) + 1) }), /digest/)
  assert.notEqual(await hashCampaignValue('campaign-request-v1', { ...rp, inputDigest: sealedRequest.inputDigest }), sealedRequest.hash)
  const response = { requestId: sealedRequest.id, inputDigest: sealedRequest.inputDigest, text: 'bounded', usage: { provenance: 'fixture' as const, inputTokens: null, outputTokens: null, reasoningTokens: null }, evidenceId: 'exact-completion' }
  for (const status of ['reserved', 'dispatch_intent', 'outcome_unknown', 'known_failed'] as const) await assert.rejects(sealCampaignRequest({ ...rp, inputDigest: sealedRequest.inputDigest, status, response }))
  for (const status of ['response_retained', 'committed'] as const) await assert.rejects(sealCampaignRequest({ ...rp, inputDigest: sealedRequest.inputDigest, status, response: null }))
  const cpPayload: Omit<CampaignCheckpoint, 'hash'> = { schemaVersion: 2, campaignId: sealedManifest.campaignId, sequence: 0, manifestHash: sealedManifest.hash, previousHash: null, operationId: 'create', bodyCharacters: 0,
    status: 'prepared', reason: null, executionEpoch: 0, candidateId: sealedManifest.candidateId, tasks: sealedManifest.tasks.map(task => ({ taskId: task.id, revision: 0, status: 'pending', artifact: null, priorArtifact: null, request: null })),
    budget: emptyCampaignBudget(), storage: emptyCampaignStorage(524_288), lastWallTime: 1 }
  const cp: CampaignCheckpoint = { ...cpPayload, hash: await hashCampaignValue('campaign-checkpoint-v2', cpPayload) }
  const receiptPayload2: Omit<CampaignReceipt, 'hash'> = { schemaVersion: 2, campaignId: sealedManifest.campaignId, operationId: 'create', kind: 'create', businessDigest: H, expectedSequence: null, sequence: 0, executionEpoch: 0,
    manifestHash: sealedManifest.hash, checkpointHash: cp.hash, artifactHashes: [], requestHashes: [], serializedBytes: Z, storageEffect: { source: 'direct', requestId: null, allocatedBytes: Z, releasedBytes: Z, remainingBytes: Z } }
  const receipt = { ...receiptPayload2, hash: await hashCampaignValue('campaign-receipt-v2', receiptPayload2) }
  assert.deepEqual(await validateCampaignCheckpoint(parseCampaignRecord(canonicalStringify(cp))), cp)
  assert.deepEqual(await validateCampaignReceipt(parseCampaignRecord(canonicalStringify(receipt))), receipt)
  for (const field of TOTAL_FIELDS) await assert.rejects(validateCampaignCheckpoint({ ...cp, storage: { ...cp.storage, [field]: 0 } }))
  await assert.rejects(validateCampaignReceipt({ ...receipt, serializedBytes: 0 }))
  await assert.rejects(validateCampaignReceipt({ ...receipt, serializedBytes: enc(1) }), /digest/)
  assert.throws(() => parseCampaignRecord(JSON.stringify(cp, null, 2)), /Noncanonical/)
  passed++
  console.log(JSON.stringify({ suite: 'writer-campaign-accounting', passed, decimalVectors, prefixesChecked, maxRecordBytes, maxAcceptBytes, maxCancelBytes, liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
}

void main().catch(() => {
  // Never print assertion objects, prepared inputs, response text, or raw error prose to CI artifacts.
  console.error(JSON.stringify({ suite: 'writer-campaign-accounting', passed, failedCase: activeCase, category: 'check_failed', liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
})
