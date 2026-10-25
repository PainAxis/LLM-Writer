/** Production repository read guards over deterministic atomic IO. No browser, provider, or persistent IO. */
import assert from 'node:assert/strict'
import type {
  CampaignBudget, CampaignCheckpoint, CampaignManifest, CampaignMutation, CampaignReceipt,
  CampaignRepositoryIO, CampaignRequest, CampaignSnapshot, CampaignState,
} from '../src/types/writerCampaign'
import { CAMPAIGN_CATALOG_KEY, campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'
import {
  canonicalStringify, decodeStorageBytes, emptyCampaignBudget, encodeStorageBytes, hashCampaignValue,
  hashText, sealCampaignArtifact, sealCampaignManifest, sealCampaignRequest, validateCampaignCheckpoint, validateCampaignReceipt,
} from '../src/services/writerCampaign/protocol'
import { campaignRequestStorageAllowance } from '../src/services/writerCampaign/storageAccounting'

type ReadHook = (keys: readonly string[]) => void | Promise<void>
type ReturnHook = (keys: readonly string[], values: Map<string, string | null>) => void | Promise<void>
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const eventKey = (key: string) => key.includes(':request:') || key.includes(':artifact:')

class AtomicIO implements CampaignRepositoryIO {
  disk = new Map<string, string>()
  writtenBytes = 0
  writes = 0
  casCalls = 0
  reads: string[][] = []
  onStart?: ReadHook
  onReturn?: ReturnHook

  async getMany(keys: readonly string[]) {
    this.reads.push([...keys])
    assert.equal(new Set(keys).size, keys.length, 'A read batch must not duplicate keys')
    await this.onStart?.(keys)
    const values = new Map(keys.map(key => [key, this.disk.get(key) ?? null]))
    await this.onReturn?.(keys, values)
    return values
  }

  async compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit = () => true) {
    this.casCalls++
    assert.equal(new Set(entries.map(entry => entry.key)).size, entries.length)
    if (entries.some(entry => (this.disk.get(entry.key) ?? null) !== entry.expectedValue) || !canCommit()) return false
    const charge = entries.reduce((sum, entry) => sum + bytes(entry.key) + bytes(entry.value), 0)
    const receipt = JSON.parse(entries.find(entry => entry.key.includes(':receipt:'))!.value) as CampaignReceipt
    const checkpoint = JSON.parse(entries.find(entry => entry.key.includes(':checkpoint:'))!.value) as CampaignCheckpoint
    assert.equal(decodeStorageBytes(receipt.serializedBytes), charge, 'Independent actual-write oracle')
    assert.equal(decodeStorageBytes(checkpoint.storage.writtenBytes), this.writtenBytes + charge)
    for (const entry of entries) this.disk.set(entry.key, entry.value)
    this.writtenBytes += charge
    this.writes++
    return true
  }

  fork() {
    const copy = new AtomicIO()
    copy.disk = new Map(this.disk)
    copy.writtenBytes = this.writtenBytes
    return copy
  }
}

const campaignId = 'read-batches'
const headKey = campaignKeys.head(campaignId)
const now = 1_800_000_000_000
const stateOf = ({ checkpoint: c }: CampaignSnapshot): CampaignState => ({
  status: c.status, reason: c.reason, executionEpoch: c.executionEpoch, candidateId: c.candidateId,
  tasks: structuredClone(c.tasks), budget: { ...c.budget }, storage: structuredClone(c.storage), lastWallTime: c.lastWallTime,
})
function withRequest(snapshot: CampaignSnapshot, request: CampaignRequest) {
  const next = stateOf(snapshot), task = next.tasks.find(item => item.taskId === request.taskId)!
  task.request = { id: request.id, revision: request.revision, hash: request.hash }
  task.status = request.status
  return next
}
function plus(budget: CampaignBudget, delta: CampaignBudget) {
  return Object.fromEntries(Object.entries(budget).map(([key, value]) => [key, value + delta[key as keyof CampaignBudget]])) as unknown as CampaignBudget
}
async function revision(request: CampaignRequest, patch: Partial<CampaignRequest>) {
  const { hash: _hash, ...payload } = request
  return sealCampaignRequest({ ...payload, ...patch, revision: request.revision + 1, parentHash: request.hash })
}
async function buildFixture() {
  const io = new AtomicIO(), repository = createCampaignRepository(io)
  const manifest: CampaignManifest = await sealCampaignManifest({
    schemaVersion: 2, protocolVersion: 'campaign-v2', campaignId, candidateId: 'candidate-0', language: 'en',
    bodyTarget: { unit: 'unicode_scalar', characters: 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1',
    fixtureVersion: 'read-batches-v1', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: 'deterministic-read-smoke',
    source: { commit: null, tree: null }, createdAt: now, expiresAt: now + 86_400_000, maxRepairRounds: 0, maxProviderRetries: 0,
    tasks: [
      { id: 'o', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
      { id: 'c', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['o'] },
      { id: 'd', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['o', 'c'] },
      { id: 'co', kind: 'chapter_outline', chapterOrdinal: 1, dependsOn: ['d', 'c'] },
      { id: 'cb', kind: 'chapter_body', chapterOrdinal: 1, dependsOn: ['co'] },
    ],
    budget: { attempts: 128, inputBytes: 8_388_608, inputUtf16: 8_388_608, outputTokens: 8_388_608,
      reasoningTokens: 0, responseBytes: 8_388_608, activeMs: 1_600_000, artifacts: 256, operations: 2048 },
    storage: { limitBytes: encodeStorageBytes(67_108_864), recoveryReserveBytes: encodeStorageBytes(524_288) },
  })
  let snapshot = (await repository.create(manifest, 'create')).snapshot
  const start = stateOf(snapshot); start.status = 'running'; start.executionEpoch++
  snapshot = (await repository.commit(snapshot, { operationId: 'start', kind: 'start', next: start })).snapshot
  // Exercise the 32-checkpoint boundary without a wide graph or a capacity run.
  for (let index = 0; index < 12; index++) {
    const kind = index % 2 === 0 ? 'pause' : 'resume', next = stateOf(snapshot)
    next.status = kind === 'pause' ? 'paused' : 'running'; next.executionEpoch++
    snapshot = (await repository.commit(snapshot, { operationId: `control-${index}`, kind, next })).snapshot
  }
  for (const spec of manifest.tasks) {
    const input = canonicalStringify({ taskId: spec.id, dependencies: spec.dependsOn.map(id => snapshot.checkpoint.tasks.find(task => task.taskId === id)!.artifact!.hash) })
    const reservation = emptyCampaignBudget()
    Object.assign(reservation, { attempts: 1, inputBytes: bytes(input), inputUtf16: input.length, outputTokens: 1024, responseBytes: 1024, activeMs: 10_000 })
    let request = await sealCampaignRequest({
      schemaVersion: 2, campaignId, id: `r-${spec.id}`, revision: 0, parentHash: null, taskId: spec.id, taskRevision: 0,
      candidateId: manifest.candidateId, adapterId: manifest.adapterId, inputDigest: await hashText(input), preparedInput: input,
      commandId: `step-${spec.id}`, inputBytes: bytes(input), inputUtf16: input.length, status: 'reserved', reservation,
      storageAllocationBytes: campaignRequestStorageAllowance(input, manifest.tasks.length, reservation.responseBytes), response: null, failureReason: null,
    })
    const reserved = withRequest(snapshot, request); reserved.budget = plus(reserved.budget, reservation)
    snapshot = (await repository.commit(snapshot, { operationId: `${spec.id}-reserve`, kind: 'reserve', next: reserved, requests: [request] })).snapshot
    request = await revision(request, { status: 'dispatch_intent' })
    snapshot = (await repository.commit(snapshot, { operationId: `${spec.id}-intent`, kind: 'dispatch_intent', next: withRequest(snapshot, request), requests: [request] })).snapshot
    const text = `Fixture ${spec.id}\r\ne\u0301😀中`
    request = await revision(request, { status: 'response_retained', response: { requestId: request.id, inputDigest: request.inputDigest, text,
      usage: { provenance: 'fixture', inputTokens: null, outputTokens: null, reasoningTokens: null }, evidenceId: `completion-${spec.id}` } })
    snapshot = (await repository.commit(snapshot, { operationId: `${spec.id}-retain`, kind: 'retain_response', next: withRequest(snapshot, request), requests: [request] })).snapshot
    const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId, candidateId: manifest.candidateId, taskId: spec.id,
      taskRevision: 0, revision: 0, kind: spec.kind, dependencies: spec.dependsOn.map(id => snapshot.checkpoint.tasks.find(task => task.taskId === id)!.artifact!),
      parentHash: null, text, semanticStatus: 'not_reviewed' })
    request = await revision(request, { status: 'committed' })
    const accepted = withRequest(snapshot, request), task = accepted.tasks.find(item => item.taskId === spec.id)!
    task.artifact = { taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash }
    if (spec.kind === 'chapter_body') accepted.status = 'completed'
    snapshot = (await repository.commit(snapshot, { operationId: `${request.commandId}:artifact`, kind: 'accept_artifact', next: accepted, requests: [request], artifacts: [artifact] })).snapshot
  }
  assert.equal(snapshot.head.status, 'completed')
  assert.equal(snapshot.checkpoint.tasks.length, 5)
  assert.equal(snapshot.checkpoint.budget.attempts, 5)
  assert.equal(snapshot.checkpoint.storage.openAllocations.length, 0)
  assert.equal(decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes), 0)
  assert.ok(snapshot.head.sequence >= 32)
  return { io, repository, snapshot }
}

function assertFullRead(io: AtomicIO, snapshot: CampaignSnapshot) {
  const expected = [...io.disk.keys()].filter(eventKey).sort(), counts = new Map<string, number>()
  for (const keys of io.reads) {
    assert.ok(keys.length <= 33, 'At most 32 records plus the head per batch')
    const events = keys.filter(eventKey)
    if (events.length) {
      assert.equal(keys[0], headKey, 'Every event batch is fenced by the actual head')
      assert.equal(keys.length, events.length + 1, 'Event batches contain only events and their head fence')
    }
    for (const key of events) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  assert.deepEqual([...counts.keys()].sort(), expected, 'Every persisted request/artifact is fetched')
  assert.ok([...counts.values()].every(count => count === 1), 'No request/artifact is fetched twice within one stable read')
  assert.equal(expected.filter(key => key.includes(':request:')).length, 20)
  assert.equal(expected.filter(key => key.includes(':artifact:')).length, 5)
  const readKeys = new Set(io.reads.flat())
  for (const key of io.disk.keys()) if (key.includes(':checkpoint:') || key.includes(':receipt:')) assert.ok(readKeys.has(key), 'Every history checkpoint and receipt is fetched')
  const checkpointBatches = io.reads.filter(keys => keys.length > 1 && keys.slice(1).every(key => key.includes(':checkpoint:')))
  const eventBatches = io.reads.filter(keys => keys.some(eventKey))
  assert.equal(checkpointBatches.length, Math.ceil((snapshot.head.sequence + 1) / 32))
  assert.ok(eventBatches.every(keys => keys.length > 2), 'Events are batched rather than fetched one by one')
  assert.equal(eventBatches.length, 2, 'The five-task history has event records in both checkpoint batches')

  const wanted = new Map<string, string>()
  for (const task of snapshot.checkpoint.tasks) {
    for (const ref of [task.artifact, task.priorArtifact]) if (ref) wanted.set(campaignKeys.artifact(campaignId, ref.taskId, ref.revision), ref.hash)
    if (task.request) wanted.set(campaignKeys.request(campaignId, task.request.id, task.request.revision), task.request.hash)
  }
  for (const row of snapshot.checkpoint.storage.openAllocations) wanted.set(campaignKeys.request(campaignId, row.request.id, row.request.revision), row.request.hash)
  const returned = new Map<string, string>()
  for (const artifact of snapshot.artifacts.values()) returned.set(campaignKeys.artifact(campaignId, artifact.taskId, artifact.revision), artifact.hash)
  for (const request of snapshot.requests.values()) returned.set(campaignKeys.request(campaignId, request.id, request.revision), request.hash)
  assert.deepEqual(returned, wanted, 'Returned maps cover exactly the final wanted key/id/revision/hash set')
  assert.ok(wanted.size <= 512)
  const retainedSerializedBytes = [...wanted.keys()].reduce((sum, key) => sum + bytes(key) + bytes(io.disk.get(key)!), 0)
  assert.ok(retainedSerializedBytes <= decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes))
  assert.ok(decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes) <= 67_108_864)
  return { eventRecords: expected.length, eventBatches: eventBatches.length, checkpointBatches: checkpointBatches.length,
    maxReadKeys: Math.max(...io.reads.map(keys => keys.length)), retainedRecords: wanted.size, retainedSerializedBytes }
}

const corrupt = (raw: string) => canonicalStringify({ ...JSON.parse(raw), hash: '0'.repeat(64) })
const cancelMutation = (snapshot: CampaignSnapshot, operationId: string): CampaignMutation => {
  const next = stateOf(snapshot); next.status = 'cancelled'; next.reason = 'user_cancelled'; next.executionEpoch++
  return { operationId, kind: 'cancel', next }
}
let activeCase = 'build_fixture', passed = 0
let corruptReads = 0, concurrentRetries = 0
async function main() {
  const fixture = await buildFixture(), base = fixture.io
  const originKey = campaignKeys.request(campaignId, 'r-o', 0)
  const wantedRequestKey = campaignKeys.request(campaignId, 'r-cb', 3)
  const wantedArtifactKey = campaignKeys.artifact(campaignId, 'cb', 0)
  const origin = JSON.parse(base.disk.get(originKey)!) as CampaignRequest
  assert.equal(fixture.snapshot.requests.has(origin.hash), false, 'Settled origin is absent from final wanted requests')
  passed++

  activeCase = 'repeat_full_history_reads'
  const stable = base.fork(), repository = createCampaignRepository(stable), before = new Map(stable.disk)
  let metrics!: ReturnType<typeof assertFullRead>
  for (let read = 0; read < 2; read++) {
    stable.reads = []
    const snapshot = await repository.read(campaignId)
    assert.ok(snapshot)
    assert.equal(snapshot.rawHead, fixture.snapshot.rawHead)
    metrics = assertFullRead(stable, snapshot)
    assert.deepEqual(stable.disk, before); assert.equal(stable.writes, 0); assert.equal(stable.casCalls, 0)
  }
  passed++

  activeCase = 'same_head_rejects_changed_history'
  // Reuse the repository that has already returned this exact head twice.
  for (const key of [originKey, wantedArtifactKey]) {
    stable.disk.set(key, corrupt(before.get(key)!))
    const corrupted = new Map(stable.disk)
    assert.equal(stable.disk.get(headKey), before.get(headKey))
    await assert.rejects(repository.read(campaignId))
    assert.deepEqual(stable.disk, corrupted); assert.equal(stable.writes, 0); assert.equal(stable.casCalls, 0)
    stable.disk = new Map(before)
    corruptReads++
  }
  // Recovery on the same instance must still read all history, not reuse either outcome.
  stable.reads = []
  assertFullRead(stable, (await repository.read(campaignId))!)
  passed++

  for (const phase of ['start', 'return'] as const) for (const [label, target] of [
    ['settled_origin', originKey], ['wanted_request', wantedRequestKey], ['wanted_artifact', wantedArtifactKey],
  ] as const) {
    activeCase = `${phase}_${label}_corruption`
    const io = base.fork(), repo = createCampaignRepository(io)
    let fired = 0, expectedDisk = new Map(io.disk)
    if (phase === 'start') io.onStart = keys => {
      if (!keys.includes(target)) return
      io.onStart = undefined; fired++
      io.disk.set(target, corrupt(io.disk.get(target)!)); expectedDisk = new Map(io.disk)
    }
    else io.onReturn = (keys, values) => {
      if (!keys.includes(target)) return
      io.onReturn = undefined; fired++
      values.set(target, corrupt(values.get(target)!))
    }
    await assert.rejects(repo.read(campaignId))
    assert.equal(fired, 1)
    assert.deepEqual(io.disk, expectedDisk, 'Read corruption cannot trigger repair or overwrites')
    assert.equal(io.writes, 0); assert.equal(io.casCalls, 0)
    corruptReads++; passed++
  }

  for (const [label, target] of [
    ['missing_wanted_request', wantedRequestKey], ['missing_wanted_artifact', wantedArtifactKey],
    ['missing_request_parent', campaignKeys.request(campaignId, 'r-o', 1)],
  ] as const) {
    activeCase = label
    const io = base.fork(), repo = createCampaignRepository(io)
    io.disk.delete(target)
    const expectedDisk = new Map(io.disk)
    await assert.rejects(repo.read(campaignId), /Missing/)
    assert.deepEqual(io.disk, expectedDisk); assert.equal(io.writes, 0); assert.equal(io.casCalls, 0)
    corruptReads++; passed++
  }

  activeCase = 'resealed_request_parent_damage'
  {
    const io = base.fork(), repo = createCampaignRepository(io)
    const request = JSON.parse(io.disk.get(wantedRequestKey)!) as CampaignRequest
    const { hash: _requestHash, ...requestPayload } = request
    const changed = await sealCampaignRequest({ ...requestPayload, parentHash: '0'.repeat(64) })
    const checkpoint = structuredClone(fixture.snapshot.checkpoint)
    checkpoint.tasks.find(task => task.taskId === changed.taskId)!.request!.hash = changed.hash
    const { hash: _checkpointHash, ...checkpointPayload } = checkpoint
    checkpoint.hash = await hashCampaignValue('campaign-checkpoint-v2', checkpointPayload)
    const receipt = { ...fixture.snapshot.receipt, requestHashes: [changed.hash], checkpointHash: checkpoint.hash }
    const { hash: _receiptHash, ...receiptPayload } = receipt
    receipt.hash = await hashCampaignValue('campaign-receipt-v2', receiptPayload)
    io.disk.set(wantedRequestKey, canonicalStringify(changed))
    io.disk.set(campaignKeys.checkpoint(campaignId, checkpoint.sequence), canonicalStringify(checkpoint))
    io.disk.set(campaignKeys.receipt(campaignId, receipt.operationId), canonicalStringify(receipt))
    io.disk.set(headKey, canonicalStringify({ ...fixture.snapshot.head, checkpointHash: checkpoint.hash }))
    const expectedDisk = new Map(io.disk)
    // Matching record hashes and final key references cannot hide a broken parent link.
    await assert.rejects(repo.read(campaignId), /Request revision\/parent mismatch/)
    assert.deepEqual(io.disk, expectedDisk); assert.equal(io.writes, 0); assert.equal(io.casCalls, 0)
    corruptReads++; passed++
  }

  activeCase = 'final_fence_rejects_new_successor'
  {
    const io = base.fork(), repo = createCampaignRepository(io)
    const successorKey = campaignKeys.checkpoint(campaignId, fixture.snapshot.head.sequence + 1)
    let fired = 0, expectedDisk = new Map(io.disk)
    io.onStart = keys => {
      if (keys.length !== 3 || !keys.includes(headKey) || !keys.includes(CAMPAIGN_CATALOG_KEY) || !keys.includes(successorKey)) return
      io.onStart = undefined; fired++
      io.disk.set(successorKey, 'existing-successor-sentinel'); expectedDisk = new Map(io.disk)
    }
    await assert.rejects(repo.read(campaignId), /rolled back|successor/i)
    assert.equal(fired, 1)
    assert.equal(io.disk.get(headKey), fixture.snapshot.rawHead)
    assert.deepEqual(io.disk, expectedDisk); assert.equal(io.writes, 0); assert.equal(io.casCalls, 0)
    corruptReads++; passed++
  }

  for (const change of ['checkpoint', 'receipt'] as const) {
    activeCase = `resealed_${change}_split_view`
    const io = base.fork(), repo = createCampaignRepository(io), expectedDisk = new Map(io.disk)
    const checkpoint = structuredClone(fixture.snapshot.checkpoint), receipt = structuredClone(fixture.snapshot.receipt)
    if (change === 'checkpoint') {
      checkpoint.lastWallTime++
      const { hash: _checkpointHash, ...payload } = checkpoint
      checkpoint.hash = await hashCampaignValue('campaign-checkpoint-v2', payload)
      receipt.checkpointHash = checkpoint.hash
    } else receipt.businessDigest = '0'.repeat(64)
    const { hash: _receiptHash, ...receiptPayload } = receipt
    receipt.hash = await hashCampaignValue('campaign-receipt-v2', receiptPayload)
    await validateCampaignCheckpoint(checkpoint); await validateCampaignReceipt(receipt)
    const checkpointKey = campaignKeys.checkpoint(campaignId, checkpoint.sequence)
    const receiptKey = campaignKeys.receipt(campaignId, receipt.operationId)
    let changedReturns = 0
    io.onReturn = (keys, values) => {
      // The initial five-key metadata fetch stays untouched. Only chronological
      // replay sees the independently valid, resealed replacement records.
      if (change === 'checkpoint' && keys.includes(checkpointKey) && keys.slice(1).every(key => key.includes(':checkpoint:'))) {
        values.set(checkpointKey, canonicalStringify(checkpoint)); changedReturns++
      }
      if (keys.includes(receiptKey) && keys.slice(1).every(key => key.includes(':receipt:'))) {
        values.set(receiptKey, canonicalStringify(receipt)); changedReturns++
      }
    }
    await assert.rejects(repo.read(campaignId), /Final immutable records changed/)
    assert.equal(changedReturns, change === 'checkpoint' ? 2 : 1)
    assert.deepEqual(io.disk, expectedDisk); assert.equal(io.writes, 0); assert.equal(io.casCalls, 0)
    corruptReads++; passed++
  }

  for (const reference of ['active', 'prior'] as const) {
    activeCase = `resealed_genesis_${reference}_artifact`
    const io = base.fork(), repo = createCampaignRepository(io)
    let previousHash: string | null = null
    for (let sequence = 0; sequence <= fixture.snapshot.head.sequence; sequence++) {
      const checkpointKey = campaignKeys.checkpoint(campaignId, sequence)
      const checkpoint = JSON.parse(io.disk.get(checkpointKey)!) as CampaignCheckpoint
      checkpoint.previousHash = previousHash
      if (sequence === 0) {
        const task = checkpoint.tasks[0]!, phantom = structuredClone(fixture.snapshot.checkpoint.tasks[0]!.artifact!)
        if (reference === 'active') { task.status = 'committed'; task.artifact = phantom }
        else task.priorArtifact = phantom
      }
      const { hash: _checkpointHash, ...checkpointPayload } = checkpoint
      checkpoint.hash = await hashCampaignValue('campaign-checkpoint-v2', checkpointPayload)
      await validateCampaignCheckpoint(checkpoint)
      const receiptKey = campaignKeys.receipt(campaignId, checkpoint.operationId)
      const receipt = JSON.parse(io.disk.get(receiptKey)!) as CampaignReceipt
      receipt.checkpointHash = checkpoint.hash
      const { hash: _receiptHash, ...receiptPayload } = receipt
      receipt.hash = await hashCampaignValue('campaign-receipt-v2', receiptPayload)
      await validateCampaignReceipt(receipt)
      io.disk.set(checkpointKey, canonicalStringify(checkpoint)); io.disk.set(receiptKey, canonicalStringify(receipt))
      previousHash = checkpoint.hash
    }
    io.disk.set(headKey, canonicalStringify({ ...fixture.snapshot.head, checkpointHash: previousHash }))
    const expectedDisk = new Map(io.disk)
    // All schemas, record hashes, head links, and predecessor hashes match.
    // A genesis with an uncreated artifact still cannot seed trusted lineage.
    await assert.rejects(repo.read(campaignId), /Invalid genesis state/)
    assert.deepEqual(io.disk, expectedDisk); assert.equal(io.writes, 0); assert.equal(io.casCalls, 0)
    corruptReads++; passed++
  }

  for (const phase of ['start', 'return'] as const) {
    activeCase = `${phase}_event_batch_head_advance`
    const io = base.fork(), repo = createCampaignRepository(io)
    let fired = 0, fresh: CampaignSnapshot | undefined, expectedDisk: Map<string, string> | undefined
    const advance = async (keys: readonly string[]) => {
      if (!keys.some(eventKey)) return
      // Disable both hooks before reentrant repository work. The commit is real,
      // not a synthetic head overwrite, so its replacement history is valid.
      io.onStart = undefined; io.onReturn = undefined; fired++
      fresh = (await repo.commit(fixture.snapshot, cancelMutation(fixture.snapshot, `concurrent-${phase}`))).snapshot
      expectedDisk = new Map(io.disk)
    }
    if (phase === 'start') io.onStart = advance
    else io.onReturn = advance
    const actual = await repo.read(campaignId)
    assert.equal(fired, 1); assert.ok(fresh); assert.ok(actual)
    assert.notEqual(actual.rawHead, fixture.snapshot.rawHead)
    assert.equal(actual.rawHead, fresh.rawHead)
    assert.equal(actual.head.status, 'cancelled')
    assert.equal(actual.head.sequence, fixture.snapshot.head.sequence + 1)
    assert.deepEqual(actual.checkpoint, fresh.checkpoint)
    assert.deepEqual(actual.artifacts, fresh.artifacts); assert.deepEqual(actual.requests, fresh.requests)
    assert.equal(io.writes, 1); assert.equal(io.casCalls, 1)
    assert.deepEqual(io.disk, expectedDisk, 'The reader adds no writes to the valid concurrent commit')
    concurrentRetries++; passed++
  }

  activeCase = 'refused_commit_preserves_all_bytes'
  {
    const io = base.fork(), repo = createCampaignRepository(io), expectedDisk = new Map(io.disk)
    await assert.rejects(repo.commit(fixture.snapshot, cancelMutation(fixture.snapshot, 'refused-cancel'), () => false), /CAS failed/)
    assert.deepEqual(io.disk, expectedDisk); assert.equal(io.writes, 0); assert.equal(io.casCalls, 1)
    passed++
  }

  console.log(JSON.stringify({ result: 'PASS', cases: passed, tasks: 5, stableReads: 3, corruptReads, concurrentRetries,
    checkpoints: fixture.snapshot.head.sequence + 1, ...metrics, writtenBytes: base.writtenBytes }))
}

void main().catch(() => {
  // Never print stored JSON, request/artifact text, assertion values, or stacks.
  console.error(JSON.stringify({ result: 'FAIL', case: activeCase, completedCases: passed, corruptReads, concurrentRetries }))
  process.exitCode = 1
})
