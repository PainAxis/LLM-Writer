/** Production protocol/repository with a deterministic atomic IO seam. Browser IDB is tested separately. */
import assert from 'node:assert/strict'
import type { CampaignArtifact, CampaignBudget, CampaignManifest, CampaignMutation, CampaignRepositoryIO, CampaignRequest, CampaignSnapshot, CampaignState } from '../src/types/writerCampaign'
import { CAMPAIGN_CATALOG_KEY, campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'
import { canonicalCampaignText, canonicalStringify, emptyCampaignBudget, hashText, measureCampaignText, sealCampaignArtifact, sealCampaignManifest, sealCampaignRequest, utf8Bytes, validateCampaignArtifact, validateCampaignManifest, validateCampaignRequest } from '../src/services/writerCampaign/protocol'

class AtomicIO implements CampaignRepositoryIO {
  disk = new Map<string, string>()
  writes = 0
  fail = false
  ackLoss = false
  maxReadKeys = 0
  maxReadBytes = 0
  async getMany(keys: readonly string[]) {
    this.maxReadKeys = Math.max(this.maxReadKeys, keys.length)
    const result = new Map(keys.map(key => [key, this.disk.get(key) ?? null]))
    this.maxReadBytes = Math.max(this.maxReadBytes, [...result.values()].reduce((sum, value) => sum + (value ? utf8Bytes(value) : 0), 0))
    return result
  }
  async compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit = () => true) {
    assert.equal(new Set(entries.map(entry => entry.key)).size, entries.length)
    if (entries.some(entry => (this.disk.get(entry.key) ?? null) !== entry.expectedValue) || !canCommit()) return false
    if (this.fail) { this.fail = false; throw new Error('injected atomic abort') }
    for (const entry of entries) this.disk.set(entry.key, entry.value)
    this.writes++
    if (this.ackLoss) { this.ackLoss = false; throw new Error('injected acknowledgment loss after commit') }
    return true
  }
}
const now = 1_800_000_000_000
async function manifest(id: string): Promise<CampaignManifest> {
  return sealCampaignManifest({ schemaVersion: 1, protocolVersion: 'campaign-v1', campaignId: id, candidateId: 'candidate-0', language: 'zh',
    bodyTarget: { unit: 'unicode_scalar', characters: 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1', fixtureVersion: 'store-smoke-v1', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: 'node-smoke',
    source: { commit: '1'.repeat(40), tree: '2'.repeat(40) }, createdAt: now, expiresAt: now + 86_400_000, maxRepairRounds: 0, maxProviderRetries: 0,
    tasks: [{ id: 'o', kind: 'outline', chapterOrdinal: null, dependsOn: [] }, { id: 'c', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['o'] }, { id: 'd', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['o', 'c'] }, { id: 'co', kind: 'chapter_outline', chapterOrdinal: 1, dependsOn: ['d', 'c'] }, { id: 'cb', kind: 'chapter_body', chapterOrdinal: 1, dependsOn: ['co'] }],
    budget: { attempts: 128, inputBytes: 8_388_608, inputUtf16: 8_388_608, outputTokens: 8_388_608, reasoningTokens: 0, responseBytes: 8_388_608, activeMs: 1_600_000, serializedBytes: 67_108_864, storageReservedBytes: 67_108_864, artifacts: 256, operations: 2048 }, recoveryReserveBytes: 524_288 })
}
function state(snapshot: CampaignSnapshot): CampaignState {
  const c = snapshot.checkpoint
  return { status: c.status, reason: c.reason, executionEpoch: c.executionEpoch, candidateId: c.candidateId, tasks: structuredClone(c.tasks), budget: { ...c.budget }, lastWallTime: c.lastWallTime }
}
function plus(budget: CampaignBudget, delta: CampaignBudget) { return Object.fromEntries(Object.entries(budget).map(([key, value]) => [key, value + delta[key as keyof CampaignBudget]])) as unknown as CampaignBudget }
function patchRequest(snapshot: CampaignSnapshot, request: CampaignRequest): CampaignState {
  const next = state(snapshot), task = next.tasks.find(item => item.taskId === request.taskId)!
  task.request = { id: request.id, revision: request.revision, hash: request.hash }; task.status = request.status
  return next
}
async function revision(request: CampaignRequest, patch: Partial<CampaignRequest>): Promise<CampaignRequest> {
  const { hash: _hash, ...payload } = request
  return sealCampaignRequest({ ...payload, ...patch, revision: request.revision + 1, parentHash: request.hash })
}

let activeCase = 'protocol_vectors'
let completedCases = 0
async function main() {
const raw = 'a\r\ne\u0301😀中'
assert.equal(canonicalCampaignText(raw), 'a\né😀中')
assert.deepEqual(await measureCampaignText(raw), { hash: await hashText(raw), utf8Bytes: 13, utf16Units: 8, scalars: 7 })
assert.deepEqual(await measureCampaignText(canonicalCampaignText(raw)), { hash: await hashText('a\né😀中'), utf8Bytes: 11, utf16Units: 6, scalars: 5 })
await assert.rejects(measureCampaignText('\ud800'), /surrogate/)
await assert.rejects(measureCampaignText('\udc00'), /surrogate/)
assert.notEqual(await hashText('é'), await hashText('e\u0301'))
assert.equal(await hashText(canonicalCampaignText('é')), await hashText(canonicalCampaignText('e\u0301')))

completedCases++; activeCase = 'create_and_schema'
const io = new AtomicIO(), repo = createCampaignRepository(io), m = await manifest('store-smoke')
for (const bad of [{ ...m, schemaVersion: 2 }, { ...m, extra: 1 }, { ...m, language: 'xx' }, { ...m, hash: '' }, { ...m, budget: { ...m.budget, attempts: Number.MAX_SAFE_INTEGER + 1 } }, { ...m, tasks: m.tasks.map((task, index) => index === 2 ? { ...task, dependsOn: [] } : task) }]) await assert.rejects(validateCampaignManifest(bad))
let snapshot = (await repo.create(m, 'create')).snapshot
const createdBytes = new Map(io.disk)
assert.deepEqual(await repo.list(), ['store-smoke'])
assert.equal((await repo.create(m, 'create')).receipt.hash, snapshot.receipt.hash)
assert.equal(io.writes, 1)
await assert.rejects(repo.create(m, 'another-create'), /already exists/)
assert.deepEqual(io.disk, createdBytes)
const changedManifest = await sealCampaignManifest({ ...m, language: 'en', hash: undefined } as unknown as Omit<CampaignManifest, 'hash'>).catch(() => null)
assert.equal(changedManifest, null, 'builders reject hidden extra fields, including hash')

completedCases++; activeCase = 'head_cas_and_replay'
const start = state(snapshot); start.status = 'running'; start.executionEpoch++; start.budget.storageReservedBytes += 65_536
const startMutation: CampaignMutation = { operationId: 'start', kind: 'start', next: start }
const beforeStart = snapshot
await assert.rejects(repo.commit(snapshot, { ...startMutation, operationId: 'guard-refuses' }, () => false), /CAS failed/)
assert.deepEqual(io.disk, createdBytes)
snapshot = (await repo.commit(snapshot, startMutation)).snapshot
assert.equal(snapshot.head.executionEpoch, 1)
assert.equal((await repo.commit(beforeStart, startMutation)).replayed, true)
await assert.rejects(repo.commit(beforeStart, { ...startMutation, next: { ...startMutation.next, reason: 'different business' } }), /another payload/)
await assert.rejects(repo.commit(beforeStart, { operationId: 'stale', kind: 'start', next: start }), /head\/epoch changed/)

completedCases++; activeCase = 'request_and_artifact_chain'
const capacityBody = 'a'.repeat(65_523) + raw
const bodyCanonicalCharacters = 65_528
assert.equal(utf8Bytes(capacityBody), 65_536)
let firstArtifact: CampaignArtifact | null = null
for (const spec of m.tasks) {
  const input = canonicalStringify({ taskId: spec.id, dependencyHashes: spec.dependsOn.map(id => snapshot.checkpoint.tasks.find(task => task.taskId === id)!.artifact!.hash) })
  const reservation = emptyCampaignBudget()
  Object.assign(reservation, { attempts: 1, inputBytes: utf8Bytes(input), inputUtf16: input.length, outputTokens: 65_536, responseBytes: 65_536, activeMs: 10000, storageReservedBytes: 4_194_304 })
  let request = await sealCampaignRequest({ schemaVersion: 1, campaignId: m.campaignId, id: `r-${spec.id}`, revision: 0, parentHash: null, taskId: spec.id, taskRevision: 0, candidateId: m.candidateId, adapterId: 'offline-fixture-v1', inputDigest: await hashText(input), preparedInput: input, commandId: `step-${spec.id}`, inputBytes: utf8Bytes(input), inputUtf16: input.length, status: 'reserved', reservation, response: null, failureReason: null })
  await assert.rejects(validateCampaignRequest({ ...request, inputDigest: '0'.repeat(64) }), /input identity/)
  const reserved = patchRequest(snapshot, request); reserved.budget = plus(reserved.budget, reservation)
  snapshot = (await repo.commit(snapshot, { operationId: `${spec.id}-reserve`, kind: 'reserve', next: reserved, requests: [request] })).snapshot
  request = await revision(request, { status: 'dispatch_intent' })
  if (spec.id === 'o') {
    const bytes = new Map(io.disk)
    await assert.rejects(repo.commit(snapshot, { operationId: 'hidden-dispatch', kind: 'pause', next: { ...patchRequest(snapshot, request), status: 'paused', executionEpoch: snapshot.head.executionEpoch + 1 }, requests: [request] }), /not authorized/)
    assert.deepEqual(io.disk, bytes)
  }
  snapshot = (await repo.commit(snapshot, { operationId: `${spec.id}-intent`, kind: 'dispatch_intent', next: patchRequest(snapshot, request), requests: [request] })).snapshot
  const text = spec.kind === 'chapter_body' ? capacityBody : `固定规划 ${spec.id}\r\ne\u0301`
  request = await revision(request, { status: 'response_retained', response: { requestId: request.id, inputDigest: request.inputDigest, text, usage: { provenance: 'fixture', inputTokens: null, outputTokens: null, reasoningTokens: null }, evidenceId: `completion-${spec.id}` } })
  snapshot = (await repo.commit(snapshot, { operationId: `${spec.id}-retain`, kind: 'retain_response', next: patchRequest(snapshot, request), requests: [request] })).snapshot
  const artifact = await sealCampaignArtifact({ schemaVersion: 1, campaignId: m.campaignId, candidateId: m.candidateId, taskId: spec.id, taskRevision: 0, revision: 0, kind: spec.kind, dependencies: spec.dependsOn.map(id => snapshot.checkpoint.tasks.find(task => task.taskId === id)!.artifact!), parentHash: null, text, semanticStatus: 'not_reviewed' })
  if (!firstArtifact) firstArtifact = artifact
  request = await revision(request, { status: 'committed' })
  const accepted = patchRequest(snapshot, request), task = accepted.tasks.find(item => item.taskId === spec.id)!
  task.artifact = { taskId: spec.id, revision: 0, hash: artifact.hash }
  if (spec.kind === 'chapter_body') accepted.status = 'completed'
  const mutation: CampaignMutation = { operationId: `${spec.id}-accept`, kind: 'accept_artifact', next: accepted, artifacts: [artifact], requests: [request] }
  if (spec.id === 'o') {
    const before = new Map(io.disk)
    io.fail = true
    await assert.rejects(repo.commit(snapshot, mutation), /unconfirmed/)
    assert.deepEqual(io.disk, before, 'atomic abort must leave every key unchanged')
    const conflictKey = campaignKeys.artifact(m.campaignId, spec.id, 0)
    io.disk.set(conflictKey, 'future-or-corrupt-existing-bytes')
    await assert.rejects(repo.commit(snapshot, mutation), /CAS failed/)
    assert.equal(io.disk.get(conflictKey), 'future-or-corrupt-existing-bytes', 'immutable target is create-only')
    io.disk.delete(conflictKey)
    io.ackLoss = true
    await assert.rejects(repo.commit(snapshot, mutation), /acknowledgment is unconfirmed/)
    assert.equal((await repo.getReceipt(m.campaignId, mutation.operationId))?.artifactHashes[0], artifact.hash)
    const writes: number = io.writes
    const replay = await repo.commit(snapshot, mutation)
    assert.equal(replay.replayed, true); assert.equal(io.writes, writes)
    snapshot = replay.snapshot
  } else snapshot = (await repo.commit(snapshot, mutation)).snapshot
  assert.equal(snapshot.checkpoint.bodyCharacters, spec.kind === 'chapter_body' ? bodyCanonicalCharacters : 0, 'planning text never contributes to body count')
}
assert.equal((await repo.create(m, 'create')).receipt.hash, beforeStart.receipt.hash, 'create replay returns its original receipt even after head advanced')
const restored = await repo.read(m.campaignId)
assert.equal(restored?.head.status, 'completed')
assert.equal(restored?.checkpoint.bodyCharacters, bodyCanonicalCharacters)
assert.deepEqual((await repo.getOperationArtifacts(m.campaignId, 'o-accept'))?.map(artifact => artifact.text), [firstArtifact!.text])
assert.ok(io.maxReadKeys <= 33, `reader batch size ${io.maxReadKeys}`)

completedCases++; activeCase = 'terminal_cancellation'
const cancelNext = state(snapshot); cancelNext.status = 'cancelled'; cancelNext.executionEpoch++; cancelNext.reason = 'user_cancelled'
const cancelMutation: CampaignMutation = { operationId: 'cancel', kind: 'cancel', next: cancelNext }
const beforeCancel = snapshot
snapshot = (await repo.commit(snapshot, cancelMutation)).snapshot
assert.equal((await repo.commit(beforeCancel, cancelMutation)).receipt.hash, snapshot.receipt.hash)
const rogue = state(snapshot); rogue.status = 'running'; rogue.executionEpoch++
await assert.rejects(repo.commit(snapshot, { operationId: 'uncancel', kind: 'resume', next: rogue }), /terminal/)

completedCases++; activeCase = 'corruption_and_rollback'
const original = new Map(io.disk)
for (const [key, corruption] of [
  [campaignKeys.head(m.campaignId), JSON.stringify({ ...snapshot.head, schemaVersion: 9 })],
  [campaignKeys.head(m.campaignId), beforeStart.rawHead],
  [campaignKeys.artifact(m.campaignId, 'o', 0), JSON.stringify({ ...firstArtifact!, text: 'changed exact text' })],
  [campaignKeys.checkpoint(m.campaignId, 0), '{broken'],
  [campaignKeys.receipt(m.campaignId, 'create'), JSON.stringify({ ...beforeStart.receipt, schemaVersion: 2 })],
] as const) {
  io.disk = new Map(original); io.disk.set(key, corruption)
  const bytes = new Map(io.disk)
  await assert.rejects(repo.read(m.campaignId))
  assert.deepEqual(io.disk, bytes, 'validation preserves corrupt/future bytes')
}
io.disk = new Map(original); io.disk.delete(campaignKeys.request(m.campaignId, 'r-o', 0))
await assert.rejects(repo.read(m.campaignId), /Missing/)
io.disk = new Map(original)
await assert.rejects(validateCampaignArtifact({ ...firstArtifact!, text: 'x'.repeat(65_537) }), /text bound/)
await assert.rejects(validateCampaignArtifact({ ...firstArtifact!, raw: { ...firstArtifact!.raw, scalars: 0 } }), /metrics/)

completedCases++; activeCase = 'catalog_and_budget'
const catalogIO = new AtomicIO(); catalogIO.disk.set(CAMPAIGN_CATALOG_KEY, '{"schemaVersion":99,"ids":[]}')
await assert.rejects(createCampaignRepository(catalogIO).create(await manifest('future-catalog'), 'create'), /catalog/)
assert.equal(catalogIO.disk.size, 1)
const tinyIO = new AtomicIO(), tinyRepo = createCampaignRepository(tinyIO), tiny = await manifest('budget-small')
const { hash: _tinyHash, ...tinyPayload } = tiny
tinyPayload.budget = { ...tiny.budget, serializedBytes: 98_304, storageReservedBytes: 98_304 }
tinyPayload.recoveryReserveBytes = 32_768
const tinySnapshot = (await tinyRepo.create(await sealCampaignManifest(tinyPayload), 'create')).snapshot
const tooBig = state(tinySnapshot); tooBig.status = 'running'; tooBig.executionEpoch++; tooBig.budget.storageReservedBytes = 98_305
const tinyBytes = new Map(tinyIO.disk)
await assert.rejects(tinyRepo.commit(tinySnapshot, { operationId: 'overflow', kind: 'start', next: tooBig }), /budget/)
assert.deepEqual(tinyIO.disk, tinyBytes)
const fenceIO = new AtomicIO(), fenceRepo = createCampaignRepository(fenceIO), fence = (await fenceRepo.create(await manifest('fence'), 'create')).snapshot
const pause = state(fence); pause.status = 'paused'; pause.executionEpoch++
const cancel = state(fence); cancel.status = 'cancelled'; cancel.executionEpoch++
const race = await Promise.allSettled([fenceRepo.commit(fence, { operationId: 'pause', kind: 'pause', next: pause }), fenceRepo.commit(fence, { operationId: 'cancel', kind: 'cancel', next: cancel })])
assert.equal(race.filter(result => result.status === 'fulfilled').length, 1)
assert.equal((await fenceRepo.read('fence'))!.head.sequence, 1)

// Production-path bounded metadata/resume observation, deliberately not a
// million-character generation or quality claim. 127 is the largest complete
// three-planning-plus-paired-chapter graph under the 128-task safety ceiling.
completedCases++; activeCase = 'bounded_capacity'
const wideIO = new AtomicIO(), wideRepo = createCampaignRepository(wideIO)
const { hash: _wideHash, ...widePayload } = await manifest('capacity-index')
widePayload.source = { commit: null, tree: null }
widePayload.tasks = widePayload.tasks.slice(0, 3)
for (let chapter = 1; chapter <= 62; chapter++) {
  widePayload.tasks.push({ id: `co-${chapter}`, kind: 'chapter_outline', chapterOrdinal: chapter, dependsOn: ['d', 'c'] })
  widePayload.tasks.push({ id: `cb-${chapter}`, kind: 'chapter_body', chapterOrdinal: chapter, dependsOn: [`co-${chapter}`, ...(chapter > 1 ? [`cb-${chapter - 1}`] : [])] })
}
const wideManifest = await sealCampaignManifest(widePayload)
await assert.rejects(validateCampaignManifest({ ...wideManifest, source: { commit: null, tree: '1'.repeat(40) } }), /both/)
let wide = (await wideRepo.create(wideManifest, 'create')).snapshot
for (let index = 0; index < 40; index++) {
  const next = state(wide), kind = index === 0 ? 'start' : index % 2 ? 'pause' : 'resume'
  next.executionEpoch++; next.status = kind === 'pause' ? 'paused' : 'running'
  if (kind !== 'pause') next.budget.storageReservedBytes += 32768 + next.tasks.length * 1024
  wide = (await wideRepo.commit(wide, { operationId: `capacity-${index}`, kind, next })).snapshot
}
const resumeStarted = performance.now()
const wideRestored = await wideRepo.read(wideManifest.campaignId)
const resumeMs = Math.round((performance.now() - resumeStarted) * 100) / 100
assert.equal(wideRestored!.checkpoint.tasks.length, 127)
assert.equal(wideRestored!.head.sequence, 40)
assert.equal(wideIO.maxReadKeys, 33)
assert.ok(wideIO.maxReadBytes < 1_048_576, 'Measured metadata read batch stays below 1 MiB for the bounded fixture')

console.log(JSON.stringify({ result: 'PASS', scope: 'production Campaign protocol/repository; deterministic IO seam, not real IndexedDB', assertions: 'schemas, exact/canonical scalar vectors, create-only, immutable revision chains, receipt replay/conflict, failed atomic write, ACK loss, CAS epoch race, body-only counts, missing/corrupt bytes, budget overflow', maxReadKeys: io.maxReadKeys, maxReadBytes: io.maxReadBytes, committedOperations: snapshot.checkpoint.budget.operations, maxArtifactTextBytes: utf8Bytes(capacityBody), capacityObservation: { tasks: 127, checkpoints: 41, maxReadKeys: wideIO.maxReadKeys, maxReadBytes: wideIO.maxReadBytes, resumeMs, serializedPayloadBytes: wide.checkpoint.budget.serializedBytes }, serializedPayloadBytes: snapshot.checkpoint.budget.serializedBytes, longformAcceptance: 'NOT_RUN' }))

}
void main().catch(() => {
  // CI evidence must never contain assertion actual/expected values, narrative
  // text, stored JSON, request payloads, or an exception stack.
  console.error(JSON.stringify({ result: 'FAIL', case: activeCase, completedCases, category: 'campaign_store_test_failure' }))
  process.exitCode = 1
})
