/** Real repository admission at 128 detached allocations. No forged snapshots, browser, network, or provider. */
import assert from 'node:assert/strict'
import type { CampaignArtifact, CampaignBudget, CampaignManifest, CampaignRepositoryIO, CampaignRequest, CampaignSnapshot, CampaignState } from '../src/types/writerCampaign'
import { campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'
import { CampaignProtocolError, decodeStorageBytes as dec, encodeStorageBytes as enc, emptyCampaignBudget, hashText, sealCampaignArtifact, sealCampaignManifest, sealCampaignRequest } from '../src/services/writerCampaign/protocol'
import { campaignFinalCancelBytes, campaignRequestStorageAllowance } from '../src/services/writerCampaign/storageAccounting'

class AtomicIO implements CampaignRepositoryIO {
  readonly disk = new Map<string, string>()
  writes = 0
  casCalls = 0
  writtenBytes = 0
  lastEntryCount = 0
  async getMany(keys: readonly string[]) { return new Map(keys.map(key => [key, this.disk.get(key) ?? null])) }
  async compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit = () => true) {
    this.casCalls++
    assert.equal(new Set(entries.map(entry => entry.key)).size, entries.length)
    if (!canCommit() || entries.some(entry => (this.disk.get(entry.key) ?? null) !== entry.expectedValue)) return false
    const D = entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.key, 'utf8') + Buffer.byteLength(entry.value, 'utf8'), 0)
    const receipt = JSON.parse(entries.find(entry => entry.key.includes(':receipt:'))!.value)
    const checkpoint = JSON.parse(entries.find(entry => entry.key.includes(':checkpoint:'))!.value)
    const s = checkpoint.storage
    assert.equal(dec(receipt.serializedBytes), D)
    assert.equal(dec(s.writtenBytes), this.writtenBytes + D)
    assert.equal(dec(s.allocatedBytes) - dec(s.allocationConsumedBytes) - dec(s.releasedBytes), dec(s.outstandingBytes))
    assert.equal(s.openAllocations.reduce((sum: number, row: { remainingBytes: string }) => sum + dec(row.remainingBytes), 0), dec(s.outstandingBytes))
    assert.ok(dec(s.writtenBytes) + dec(s.outstandingBytes) + dec(s.recoveryRemainingBytes) <= 67_108_864)
    for (const entry of entries) {
      if (!entry.key.endsWith(':head') && !entry.key.endsWith(':catalog')) assert.equal(entry.expectedValue, null, 'Immutable targets stay create-only')
      assert.ok(Buffer.byteLength(entry.value, 'utf8') <= 1_048_576)
      this.disk.set(entry.key, entry.value)
    }
    this.writtenBytes += D; this.writes++; this.lastEntryCount = entries.length
    return true
  }
}
function state(snapshot: CampaignSnapshot): CampaignState {
  const c = snapshot.checkpoint
  return { status: c.status, reason: c.reason, executionEpoch: c.executionEpoch, candidateId: c.candidateId, tasks: structuredClone(c.tasks), budget: { ...c.budget }, storage: structuredClone(c.storage), lastWallTime: c.lastWallTime }
}
function plus(budget: CampaignBudget, delta: CampaignBudget): CampaignBudget {
  return Object.fromEntries(Object.entries(budget).map(([key, value]) => [key, value + delta[key as keyof CampaignBudget]])) as unknown as CampaignBudget
}
function requestState(snapshot: CampaignSnapshot, request: CampaignRequest): CampaignState {
  const next = state(snapshot), task = next.tasks.find(item => item.taskId === request.taskId)!
  task.request = { id: request.id, revision: request.revision, hash: request.hash }; task.status = request.status
  return next
}
async function revise(request: CampaignRequest, patch: Partial<CampaignRequest>): Promise<CampaignRequest> {
  const { hash: _hash, ...payload } = request
  return sealCampaignRequest({ ...payload, ...patch, revision: request.revision + 1, parentHash: request.hash })
}
async function manifest(): Promise<CampaignManifest> {
  return sealCampaignManifest({ schemaVersion: 2, protocolVersion: 'campaign-v2', campaignId: 'open-limit-smoke', candidateId: 'candidate-0', language: 'en',
    bodyTarget: { unit: 'unicode_scalar', characters: 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1', fixtureVersion: 'open-limit-smoke-v2', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: 'node-smoke',
    source: { commit: null, tree: null }, createdAt: 1, expiresAt: 1_800_000_000_000, maxRepairRounds: 0, maxProviderRetries: 0,
    tasks: [{ id: 'o', kind: 'outline', chapterOrdinal: null, dependsOn: [] }, { id: 'c', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['o'] }, { id: 'd', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['o', 'c'] }, { id: 'co', kind: 'chapter_outline', chapterOrdinal: 1, dependsOn: ['d', 'c'] }, { id: 'cb', kind: 'chapter_body', chapterOrdinal: 1, dependsOn: ['co'] }],
    // The protocol permits this attempt ceiling. It must not erase the independent 128-row limit.
    budget: { attempts: 2048, inputBytes: 8_388_608, inputUtf16: 8_388_608, outputTokens: 8_388_608, reasoningTokens: 0, responseBytes: 8_388_608, activeMs: 1_600_000, artifacts: 256, operations: 2048 },
    storage: { limitBytes: enc(67_108_864), recoveryReserveBytes: enc(524_288) } })
}

let activeStage = 'create'
let detachedAllocations = 0
let reservedAttempts = 0
const io = new AtomicIO()
const started = performance.now()
async function main() {
  const m = await manifest(), repo = createCampaignRepository(io)
  let snapshot = (await repo.create(m, 'create')).snapshot
  const startedState = state(snapshot); startedState.status = 'running'; startedState.executionEpoch++
  snapshot = (await repo.commit(snapshot, { operationId: 'start', kind: 'start', next: startedState })).snapshot
  async function reserve(taskId: string, requestId: string, commandId: string): Promise<CampaignRequest> {
    const task = snapshot.checkpoint.tasks.find(item => item.taskId === taskId)!
    const reservation = { ...emptyCampaignBudget(), attempts: 1, outputTokens: 1, responseBytes: 1, activeMs: 10_000 }
    const request = await sealCampaignRequest({ schemaVersion: 2, campaignId: m.campaignId, id: requestId, revision: 0, parentHash: null, taskId, taskRevision: task.revision,
      candidateId: snapshot.checkpoint.candidateId, adapterId: 'offline-fixture-v1', inputDigest: await hashText(''), preparedInput: '', commandId, inputBytes: 0, inputUtf16: 0,
      status: 'reserved', reservation, storageAllocationBytes: campaignRequestStorageAllowance('', 5, 1), response: null, failureReason: null })
    const next = requestState(snapshot, request); next.budget = plus(next.budget, reservation)
    snapshot = (await repo.commit(snapshot, { operationId: `${commandId}:reserve`, kind: 'reserve', next, requests: [request] })).snapshot
    reservedAttempts = snapshot.checkpoint.budget.attempts
    return request
  }

  activeStage = 'establish_root_artifact'
  let rootRequest = await reserve('o', 'root-request', 'root-step')
  rootRequest = await revise(rootRequest, { status: 'dispatch_intent' })
  snapshot = (await repo.commit(snapshot, { operationId: 'root-step:intent', kind: 'dispatch_intent', next: requestState(snapshot, rootRequest), requests: [rootRequest] })).snapshot
  // Deterministic offline completion is constructed only after the durable intent, then retained before acceptance.
  rootRequest = await revise(rootRequest, { status: 'response_retained', response: { requestId: rootRequest.id, inputDigest: rootRequest.inputDigest, text: 'x', usage: { provenance: 'fixture', inputTokens: null, outputTokens: null, reasoningTokens: null }, evidenceId: 'root-completion' } })
  snapshot = (await repo.commit(snapshot, { operationId: 'root-step:retain', kind: 'retain_response', next: requestState(snapshot, rootRequest), requests: [rootRequest] })).snapshot
  let root: CampaignArtifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: m.campaignId, candidateId: m.candidateId, taskId: 'o', taskRevision: 0, revision: 0, kind: 'outline', dependencies: [], parentHash: null, text: 'x', semanticStatus: 'not_reviewed' })
  rootRequest = await revise(rootRequest, { status: 'committed' })
  const accepted = requestState(snapshot, rootRequest); accepted.tasks[0]!.artifact = { taskId: 'o', revision: root.revision, hash: root.hash }
  snapshot = (await repo.commit(snapshot, { operationId: 'root-step:artifact', kind: 'accept_artifact', next: accepted, requests: [rootRequest], artifacts: [root] })).snapshot
  assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
  const rootReleased = snapshot.checkpoint.storage.releasedBytes
  assert.equal(dec(campaignRequestStorageAllowance('', 5, 1)), 481_570)

  for (let i = 0; i < 128; i++) {
    activeStage = 'reserve_detachable_request'
    const request = await reserve('c', `request-${String(i).padStart(3, '0')}`, `step-${i}`)
    assert.equal(snapshot.checkpoint.storage.openAllocations.length, i + 1)
    const beforeReplacement = structuredClone(snapshot.checkpoint.storage.openAllocations)
    activeStage = 'replace_root_and_detach'
    const next = state(snapshot), candidateId = `candidate-${i + 1}`
    for (const task of next.tasks) {
      task.revision++; task.status = 'invalidated'; task.priorArtifact = task.artifact ?? task.priorArtifact; task.artifact = null; task.request = null
    }
    root = await sealCampaignArtifact({ schemaVersion: 2, campaignId: m.campaignId, candidateId, taskId: 'o', taskRevision: next.tasks[0]!.revision,
      revision: root.revision + 1, kind: 'outline', dependencies: [], parentHash: root.hash, text: 'x', semanticStatus: 'not_reviewed' })
    next.tasks[0]!.status = 'committed'; next.tasks[0]!.artifact = { taskId: 'o', revision: root.revision, hash: root.hash }
    next.candidateId = candidateId; next.executionEpoch++; next.reason = 'candidate_replaced'
    // This is the repository-level allowed running replacement, not the engine's extra pause/resume controls.
    // Replacement is direct-storage-charged, leaves provider reservations unchanged, and preserves every old open row.
    snapshot = (await repo.commit(snapshot, { operationId: `replace-${i}`, kind: 'replace_candidate', next, artifacts: [root] })).snapshot
    assert.equal(snapshot.head.status, 'running')
    assert.deepEqual(snapshot.checkpoint.storage.openAllocations, beforeReplacement)
    assert.equal(snapshot.checkpoint.storage.releasedBytes, rootReleased)
    assert.ok(snapshot.checkpoint.tasks.every(task => task.request === null))
    assert.equal(snapshot.requests.get(request.hash)?.id, request.id, 'Detached allocation remains independently reachable')
    detachedAllocations++
  }

  activeStage = 'cold_read_128_allocations'
  const restarted = createCampaignRepository(io)
  snapshot = (await restarted.read(m.campaignId))!
  assert.equal(snapshot.checkpoint.storage.openAllocations.length, 128)
  assert.equal(snapshot.requests.size, 128)
  assert.equal(snapshot.checkpoint.budget.attempts, 129)
  assert.equal(snapshot.checkpoint.storage.releasedBytes, rootReleased)
  assert.equal(snapshot.checkpoint.tasks[1]!.request, null)
  assert.equal(snapshot.checkpoint.tasks[1]!.status, 'invalidated')
  assert.ok(snapshot.checkpoint.budget.attempts < m.budget.attempts)
  const headroom = dec(m.storage.limitBytes) - dec(snapshot.checkpoint.storage.writtenBytes) - dec(snapshot.checkpoint.storage.outstandingBytes) - dec(snapshot.checkpoint.storage.recoveryRemainingBytes)
  assert.ok(headroom >= 481_570, 'The row cap, not exhausted storage, must reject the next attempt')

  activeStage = 'refuse_129th_before_cas'
  const before = new Map(io.disk), writes = io.writes, casCalls = io.casCalls, budget = structuredClone(snapshot.checkpoint.budget)
  await assert.rejects(reserve('c', 'request-129th', 'step-129th'), (error: unknown) => error instanceof CampaignProtocolError && error.code === 'budget' && /Open allocation/.test(error.message))
  assert.equal(io.writes, writes)
  assert.equal(io.casCalls, casCalls, 'Refusal occurs before the atomic writer is entered')
  assert.deepEqual(io.disk, before)
  assert.equal(io.disk.has(campaignKeys.request(m.campaignId, 'request-129th', 0)), false)
  assert.equal(io.disk.has(campaignKeys.receipt(m.campaignId, 'step-129th:reserve')), false)
  const refused = (await restarted.read(m.campaignId))!
  assert.equal(refused.rawHead, snapshot.rawHead)
  assert.deepEqual(refused.checkpoint.budget, budget)
  assert.equal(refused.checkpoint.storage.openAllocations.length, 128)
  assert.equal(refused.checkpoint.budget.attempts, 129)

  activeStage = 'cancel_with_128_allocations'
  const cancel = state(refused); cancel.status = 'cancelled'; cancel.reason = 'user_cancelled'; cancel.executionEpoch++
  const cancelled = (await restarted.commit(refused, { operationId: 'cancel-at-open-limit', kind: 'cancel', next: cancel })).snapshot
  assert.equal(io.lastEntryCount, 3)
  assert.equal(cancelled.receipt.storageEffect.source, 'recovery')
  assert.ok(dec(cancelled.receipt.serializedBytes) <= campaignFinalCancelBytes(5))
  assert.equal(dec(cancelled.checkpoint.storage.recoveryRemainingBytes), dec(refused.checkpoint.storage.recoveryRemainingBytes) - dec(cancelled.receipt.serializedBytes))
  assert.deepEqual(cancelled.checkpoint.storage.openAllocations, refused.checkpoint.storage.openAllocations)
  assert.equal(cancelled.checkpoint.storage.releasedBytes, rootReleased)
  const final = (await createCampaignRepository(io).read(m.campaignId))!
  assert.equal(final.head.status, 'cancelled')
  assert.equal(final.checkpoint.storage.openAllocations.length, 128)
  assert.equal(final.checkpoint.budget.attempts, 129)
  assert.equal(dec(final.checkpoint.storage.writtenBytes), io.writtenBytes)
  assert.equal(io.writes, 263)
  console.log(JSON.stringify({ suite: 'writer-campaign-open-limit', status: 'pass', openAllocations: 128, attempts: 129, attemptCeiling: 2048,
    reserveRefusalBeforeCas: true, committedTransactions: io.writes, cumulativeWrittenBytes: io.writtenBytes,
    outstandingBytes: dec(final.checkpoint.storage.outstandingBytes), recoveryRemainingBytes: dec(final.checkpoint.storage.recoveryRemainingBytes),
    availableBytesBeforeRefusal: headroom, finalCancelBytes: dec(cancelled.receipt.serializedBytes), durationMs: Math.round(performance.now() - started),
    liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
}
void main().catch((error: unknown) => {
  console.error(JSON.stringify({ suite: 'writer-campaign-open-limit', status: 'fail', failedStage: activeStage, detachedAllocations, reservedAttempts,
    committedTransactions: io.writes, category: error instanceof CampaignProtocolError ? error.code : 'check_failed', durationMs: Math.round(performance.now() - started), liveCalls: 0, longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
})
