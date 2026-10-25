/** Action-private proof contract through production repository and deterministic IO. */
import assert from 'node:assert/strict'
import type {
  CampaignActionScope, CampaignArtifact, CampaignBudget, CampaignCheckpoint, CampaignManifest, CampaignMutation, CampaignReceipt,
  CampaignRepository, CampaignRepositoryIO, CampaignRequest, CampaignSnapshot, CampaignState,
} from '../src/types/writerCampaign'
import { CAMPAIGN_CATALOG_KEY, campaignKeys, createCampaignRepository } from '../src/services/writerCampaign/store'
import {
  CAMPAIGN_LIMITS, canonicalStringify, decodeStorageBytes, emptyCampaignBudget, encodeStorageBytes, hashCampaignValue,
  hashText, sealCampaignArtifact, sealCampaignManifest, sealCampaignRequest,
} from '../src/services/writerCampaign/protocol'
import { CampaignActionProofPool, CAMPAIGN_PROOF_ENTRY_LIMIT } from '../src/services/writerCampaign/actionProof'
import { campaignRequestStorageAllowance } from '../src/services/writerCampaign/storageAccounting'

type ReadHook = (keys: readonly string[]) => void | Promise<void>
type ReturnHook = (keys: readonly string[], values: Map<string, string | null>) => void | Promise<void>
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const immutableKey = (key: string) => key !== headKey && key !== CAMPAIGN_CATALOG_KEY

class AtomicIO implements CampaignRepositoryIO {
  disk = new Map<string, string>()
  writtenBytes = 0
  writes = 0
  casCalls = 0
  reads: string[][] = []
  onStart?: ReadHook
  onReturn?: ReturnHook
  onCas?: () => void | Promise<void>
  ackLoss = false

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
    await this.onCas?.()
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
    if (this.ackLoss) { this.ackLoss = false; throw new Error('injected lost acknowledgment') }
    return true
  }

  fork() {
    const copy = new AtomicIO()
    copy.disk = new Map(this.disk)
    copy.writtenBytes = this.writtenBytes
    return copy
  }
}

const campaignId = 'action-proof'
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

async function replacement(snapshot: CampaignSnapshot, n: number): Promise<CampaignMutation> {
  const next = stateOf(snapshot), old = snapshot.artifacts.get(snapshot.checkpoint.tasks[0]!.artifact!.hash)!
  next.candidateId = `replacement-${n}`; next.executionEpoch++; next.status = 'running'; next.reason = null
  const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId, candidateId: next.candidateId,
    taskId: 'o', taskRevision: old.taskRevision + 1, revision: old.revision + 1, kind: 'outline', dependencies: [], parentHash: old.hash,
    text: `Replacement ${n}`, semanticStatus: 'not_reviewed' })
  for (const task of next.tasks) {
    task.revision++; task.priorArtifact = task.artifact ?? task.priorArtifact; task.request = null
    task.artifact = task.taskId === 'o' ? { taskId: 'o', revision: artifact.revision, hash: artifact.hash } : null
    task.status = task.taskId === 'o' ? 'committed' : 'invalidated'
  }
  return { operationId: `replace-${n}`, kind: 'replace_candidate', next, artifacts: [artifact] }
}
function control(snapshot: CampaignSnapshot, operationId: string): CampaignMutation {
  const next = stateOf(snapshot), kind = snapshot.checkpoint.status === 'paused' ? 'resume' : 'pause'
  next.status = kind === 'pause' ? 'paused' : 'running'; next.executionEpoch++
  return { operationId, kind, next }
}
async function seed(base: AtomicIO) {
  const io = base.fork(), repository = createCampaignRepository(io), scope = repository.createActionScope!(campaignId)
  const snapshot = (await repository.read(campaignId, scope))!
  return { io, repository, scope, snapshot }
}
function zero(repository: CampaignRepository) {
  const stats = repository.getActionProofStats!()
  assert.equal(stats.retainedBytes, 0); assert.equal(stats.retainedEntries, 0); assert.equal(stats.activeRecords, 0)
}
function assertObservation(io: AtomicIO, oldDisk: Map<string, string>, lastOrder?: string[]) {
  const expected = [...oldDisk.keys()].filter(immutableKey).sort()
  const observed = io.reads.flat().filter(key => expected.includes(key))
  assert.deepEqual([...new Set(observed)].sort(), expected, 'Every immutable prefix key must be returned by actual IO')
  if (lastOrder) assert.deepEqual(observed, lastOrder, 'Capture retains last-observation order, not initial final-record metadata order')
  for (const keys of io.reads) {
    assert.ok(keys.length <= 33)
    if (keys.some(key => expected.includes(key))) {
      assert.equal(keys[0], headKey, 'Exact prefix batches have a head fence')
      const payload = keys.slice(1).reduce((sum, key) => sum + bytes(key) + bytes(oldDisk.get(key)!), 0)
      assert.ok(payload <= CAMPAIGN_LIMITS.recordBytes || keys.length === 2, 'Byte target permits only one bounded oversized-to-target record')
    }
  }
  assert.ok(observed.every(key => observed.filter(other => other === key).length === 1), 'Each proven key is reobserved exactly once')
}
function mutatePublic(snapshot: CampaignSnapshot) {
  snapshot.manifest.language = 'zh'; snapshot.manifest.tasks[0]!.dependsOn.push('foreign'); snapshot.manifest.budget.attempts = 0
  snapshot.checkpoint.tasks[0]!.status = 'pending'; snapshot.checkpoint.budget.attempts += 100; snapshot.checkpoint.storage.writtenBytes = encodeStorageBytes(1)
  snapshot.head.sequence = 0; snapshot.receipt.businessDigest = '0'.repeat(64)
  for (const artifact of snapshot.artifacts.values()) { artifact.text = 'mutated'; artifact.dependencies.length = 0; artifact.raw.scalars = 0; artifact.canonical.scalars = 0 }
  for (const request of snapshot.requests.values()) { request.preparedInput = 'mutated'; if (request.response) request.response.text = 'mutated'; request.reservation.attempts = 0 }
  snapshot.artifacts.clear(); snapshot.requests.clear()
}
let activeCase = 'fixture', passed = 0
async function main() {
  const fixture = await buildFixture()
  let current = fixture.snapshot
  for (let n = 1; n <= 2; n++) current = (await fixture.repository.commit(current, await replacement(current, n))).snapshot
  // Keep a known unknown allocation after it is detached by candidate replacement.
  const input = '{}', reservation = emptyCampaignBudget()
  Object.assign(reservation, { attempts: 1, inputBytes: 2, inputUtf16: 2, outputTokens: 1024, responseBytes: 1024, activeMs: 10_000 })
  let request = await sealCampaignRequest({ schemaVersion: 2, campaignId, id: 'inactive-unknown', revision: 0, parentHash: null, taskId: 'c', taskRevision: current.checkpoint.tasks[1]!.revision,
    candidateId: current.checkpoint.candidateId, adapterId: 'offline-fixture-v1', inputDigest: await hashText(input), preparedInput: input, commandId: 'unknown-command', inputBytes: 2, inputUtf16: 2,
    status: 'reserved', reservation, storageAllocationBytes: campaignRequestStorageAllowance(input, 5, 1024), response: null, failureReason: null })
  const reserved = withRequest(current, request); reserved.budget = plus(reserved.budget, reservation)
  current = (await fixture.repository.commit(current, { operationId: 'unknown-reserve', kind: 'reserve', next: reserved, requests: [request] })).snapshot
  request = await revision(request, { status: 'dispatch_intent' })
  current = (await fixture.repository.commit(current, { operationId: 'unknown-intent', kind: 'dispatch_intent', next: withRequest(current, request), requests: [request] })).snapshot
  request = await revision(request, { status: 'outcome_unknown', failureReason: 'fixture_unknown' })
  const blocked = withRequest(current, request); blocked.status = 'blocked'; blocked.reason = 'fixture_unknown'; blocked.executionEpoch++
  current = (await fixture.repository.commit(current, { operationId: 'unknown-block', kind: 'block', next: blocked, requests: [request] })).snapshot
  current = (await fixture.repository.commit(current, await replacement(current, 3))).snapshot
  const base = fixture.io, inactiveArtifact = campaignKeys.artifact(campaignId, 'o', 0), inactiveOrigin = campaignKeys.request(campaignId, 'r-o', 0)
  assert.ok(!current.artifacts.has((JSON.parse(base.disk.get(inactiveArtifact)!) as CampaignArtifact).hash))
  assert.equal(current.checkpoint.tasks.some(task => task.request?.id === request.id), false)
  assert.equal(current.checkpoint.storage.openAllocations[0]!.request.hash, request.hash)

  activeCase = 'complete_capture_and_appended_observation'
  {
    const { io, repository, scope, snapshot } = await seed(base)
    const stats = repository.getActionProofStats!(), immutable = [...io.disk].filter(([key]) => immutableKey(key))
    assert.equal(stats.coldReplays, 1); assert.equal(stats.coldReplaysCompleted, 1)
    assert.equal(stats.retainedEntries, immutable.length)
    assert.equal(stats.retainedBytes, immutable.reduce((sum, [key, value]) => sum + bytes(key) + bytes(value), 0))
    assert.ok(stats.retainedBytes <= decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes))
    assert.equal(stats.activeRecords, snapshot.artifacts.size + snapshot.requests.size)
    const coldKeys = io.reads.flat().filter(key => io.disk.has(key) && immutableKey(key))
    const lastOrder = coldKeys.filter((key, index) => coldKeys.lastIndexOf(key) === index)
    let next = snapshot
    for (let n = 0; n < 3; n++) {
      const before = new Map(io.disk); io.reads = []
      next = (await repository.commit(next, control(next, `proof-control-${n}`), undefined, scope)).snapshot
      assertObservation(io, before, n === 0 ? lastOrder : undefined)
      assert.equal(next.checkpoint.storage.openAllocations[0]!.request.hash, request.hash, 'Inactive unknown obligation is unchanged')
    }
    const after = repository.getActionProofStats!()
    assert.equal(after.coldReplays, 1); assert.equal(after.exactPasses, 3); assert.equal(after.transitions, 3)
    assert.equal(after.retainedEntries, immutable.length + 6)
    assert.equal(after.exactRecords, immutable.length * 3 + 6)
    assert.ok(after.exactBytes > stats.retainedBytes * 3)
    assert.equal(next.checkpoint.budget.attempts, snapshot.checkpoint.budget.attempts)
    assert.equal(next.checkpoint.bodyCharacters, 0)
    assert.deepEqual((await repository.read(campaignId))!.checkpoint, next.checkpoint, 'Independent cold replay accepts appended writes')
    repository.disposeActionScope!(scope); zero(repository)
    assert.equal(repository.getActionProofStats!().peakActiveRecords, after.activeRecords)
    const detached = repository.getActionProofStats!(); detached.disposalReasons.completed = 999; detached.retainedBytes = 999
    assert.notEqual(repository.getActionProofStats!().disposalReasons.completed, 999)
    passed++
  }

  activeCase = 'public_objects_are_not_authority'
  {
    const { io, repository, scope, snapshot } = await seed(base)
    let expected = structuredClone(snapshot), mutation = control(expected, 'public-mutation-1')
    mutatePublic(snapshot)
    const result = await repository.commit(snapshot, mutation, undefined, scope)
    expected = structuredClone(result.snapshot); mutation = control(expected, 'public-mutation-2')
    mutatePublic(result.snapshot); result.receipt.hash = '0'.repeat(64)
    const final = await repository.commit(result.snapshot, mutation, undefined, scope)
    assert.equal(final.snapshot.manifest.language, current.manifest.language)
    assert.equal(final.snapshot.checkpoint.budget.attempts, current.checkpoint.budget.attempts)
    assert.equal(repository.getActionProofStats!().exactPasses, 2)
    assert.deepEqual((await createCampaignRepository(io).read(campaignId))!.checkpoint, final.snapshot.checkpoint)
    repository.disposeActionScope!(scope); zero(repository); passed++
  }

  // Exact comparison refuses all substitutions, even semantically equal JSON
  // or individually valid resealed records. No parser/rehash can bless them.
  const families = [
    ['manifest', campaignKeys.manifest(campaignId, current.manifest.hash)],
    ['checkpoint', campaignKeys.checkpoint(campaignId, 2)],
    ['receipt', campaignKeys.receipt(campaignId, 'control-0')],
    ['request', inactiveOrigin], ['artifact', inactiveArtifact],
    ['open_unknown', campaignKeys.request(campaignId, request.id, request.revision)],
    ['active_prior', campaignKeys.artifact(campaignId, 'c', 0)],
    ['final_checkpoint', campaignKeys.checkpoint(campaignId, current.head.sequence)],
    ['final_receipt', campaignKeys.receipt(campaignId, current.head.receiptId)],
  ] as const
  const substitutions: Array<[string, (raw: string, family: string) => Promise<string | null> | string | null]> = [
    ['missing', () => null], ['malformed', () => '{'], ['oversized', () => ' '.repeat(CAMPAIGN_LIMITS.recordBytes + 1)],
    ['whitespace', raw => `${raw} `], ['unexpected_field', raw => canonicalStringify({ ...JSON.parse(raw), extra: 1 })],
    ['same_length_hash', raw => raw.replace(/"hash":"[a-f0-9]{64}"/, `"hash":"${'0'.repeat(64)}"`)],
    ['resealed', async (raw, family) => {
      const changed = JSON.parse(raw)
      if (family === 'manifest') changed.runtimeIdentity = 'changed-runtime'
      else if (family.includes('checkpoint')) changed.lastWallTime++
      else if (family.includes('receipt')) changed.businessDigest = '0'.repeat(64)
      else if (family === 'artifact' || family === 'active_prior') return canonicalStringify(await sealCampaignArtifact({ schemaVersion: 2, campaignId: changed.campaignId, candidateId: changed.candidateId, taskId: changed.taskId, taskRevision: changed.taskRevision, revision: changed.revision, kind: changed.kind, dependencies: changed.dependencies, parentHash: changed.parentHash, text: `${changed.text}!`, semanticStatus: 'not_reviewed' }))
      else changed.commandId = 'another-command'
      const { hash: _hash, ...payload } = changed
      const domain = family === 'manifest' ? 'manifest' : family.includes('checkpoint') ? 'checkpoint' : family.includes('receipt') ? 'receipt' : 'request'
      changed.hash = await hashCampaignValue(`campaign-${domain}-v2`, payload)
      return canonicalStringify(changed)
    }],
  ]
  for (const [family, target] of families) for (const [label, change] of substitutions) for (const phase of ['before', 'entry', 'return'] as const) {
    activeCase = `${family}_${label}_${phase}`
    const { io, repository, scope, snapshot } = await seed(base)
    const raw = await change(io.disk.get(target)!, family); let fired = 0
    const replace = () => { if (raw === null) io.disk.delete(target); else io.disk.set(target, raw); fired++ }
    if (phase === 'before') replace()
    if (phase === 'entry') io.onStart = keys => { if (keys.includes(target)) { io.onStart = undefined; replace() } }
    if (phase === 'return') io.onReturn = (keys, values) => { if (keys.includes(target)) { io.onReturn = undefined; values.set(target, raw); fired++ } }
    await assert.rejects(repository.commit(snapshot, control(snapshot, 'corruption-control'), undefined, scope), /Immutable Campaign record differs/)
    assert.equal(fired, 1); assert.equal(io.casCalls, 0); assert.equal(io.writes, 0)
    if (phase === 'return') assert.deepEqual(io.disk, base.disk)
    else assert.equal(io.disk.get(target) ?? null, raw)
    zero(repository); passed++
  }

  activeCase = 'fresh_catalog_and_successor_fences'
  for (const mode of ['append', 'remove', 'reorder', 'head_missing', 'head_rollback', 'successor'] as const) {
    const { io, repository, scope, snapshot } = await seed(base)
    if (mode === 'append') io.disk.set(CAMPAIGN_CATALOG_KEY, canonicalStringify({ schemaVersion: 1, ids: [campaignId, 'other'] }))
    if (mode === 'remove') io.disk.set(CAMPAIGN_CATALOG_KEY, canonicalStringify({ schemaVersion: 1, ids: [] }))
    if (mode === 'reorder') io.disk.set(CAMPAIGN_CATALOG_KEY, canonicalStringify({ schemaVersion: 1, ids: ['other', campaignId] }))
    if (mode === 'head_missing') io.disk.delete(headKey)
    if (mode === 'head_rollback') io.disk.set(headKey, canonicalStringify({ ...snapshot.head, sequence: snapshot.head.sequence - 1 }))
    if (mode === 'successor') io.disk.set(campaignKeys.checkpoint(campaignId, snapshot.head.sequence + 1), '{}')
    if (mode === 'append') { await repository.commit(snapshot, control(snapshot, 'catalog-control'), undefined, scope); assert.equal(repository.getActionProofStats!().exactPasses, 1) }
    else { await assert.rejects(repository.commit(snapshot, control(snapshot, 'catalog-control'), undefined, scope)); assert.equal(io.casCalls, 0); zero(repository) }
    repository.disposeActionScope!(scope); zero(repository); passed++
  }

  activeCase = 'forged_foreign_disposed_scope_fallback'
  for (const tokenKind of ['forged', 'cloned', 'other_repository', 'other_campaign', 'disposed'] as const) {
    const { io, repository, scope, snapshot } = await seed(base)
    let token = scope
    if (tokenKind === 'forged') token = {} as CampaignActionScope
    if (tokenKind === 'cloned') token = structuredClone(scope)
    if (tokenKind === 'other_repository') token = createCampaignRepository(io).createActionScope!(campaignId)
    if (tokenKind === 'other_campaign') token = repository.createActionScope!('elsewhere')
    if (tokenKind === 'disposed') repository.disposeActionScope!(scope)
    await repository.commit(snapshot, control(snapshot, 'fallback-control'), undefined, token)
    assert.equal(repository.getActionProofStats!().exactPasses, 0)
    assert.equal(repository.getActionProofStats!().coldReplays, 2)
    repository.disposeActionScope!(scope); zero(repository); passed++
  }

  activeCase = 'historical_identity_survives_untrusted_negative_lookup'
  {
    const { io, repository, scope, snapshot } = await seed(base)
    const reused = campaignKeys.receipt(campaignId, 'control-0')
    io.onReturn = (keys, values) => { if (keys.length === 1 && keys[0] === reused) values.set(reused, null) }
    await assert.rejects(repository.commit(snapshot, control(snapshot, 'control-0'), undefined, scope), /Operation identity already exists/)
    assert.equal(io.casCalls, 0); zero(repository); passed++
  }
  {
    const { io, repository, scope, snapshot } = await seed(base)
    const original = JSON.parse(io.disk.get(campaignKeys.request(campaignId, 'r-c', 0))!) as CampaignRequest
    const { hash: _hash, ...payload } = original
    const reused = await sealCampaignRequest({ ...payload, candidateId: snapshot.checkpoint.candidateId, taskRevision: snapshot.checkpoint.tasks[1]!.revision, commandId: 'reused-allocation' })
    const next = withRequest(snapshot, reused); next.budget = plus(next.budget, reused.reservation)
    const origin = campaignKeys.request(campaignId, reused.id, 0)
    io.onReturn = (keys, values) => { if (keys.length === 1 && keys[0] === origin) values.set(origin, null) }
    await assert.rejects(repository.commit(snapshot, { operationId: 'reused-allocation-reserve', kind: 'reserve', next, requests: [reused] }, undefined, scope), /allocation identity already used/)
    assert.equal(io.casCalls, 0); zero(repository); passed++
  }

  activeCase = 'cold_capture_duplicate_split_view'
  for (const family of ['checkpoint', 'receipt'] as const) {
    const io = base.fork(), repository = createCampaignRepository(io), scope = repository.createActionScope!(campaignId)
    const target = family === 'checkpoint' ? campaignKeys.checkpoint(campaignId, current.head.sequence) : campaignKeys.receipt(campaignId, current.head.receiptId)
    const changed = JSON.parse(io.disk.get(target)!)
    if (family === 'checkpoint') changed.lastWallTime++
    else changed.businessDigest = '0'.repeat(64)
    const { hash: _hash, ...payload } = changed
    changed.hash = await hashCampaignValue(`campaign-${family}-v2`, payload)
    let seen = 0
    io.onReturn = (keys, values) => {
      if (keys.includes(target) && ++seen === 2) values.set(target, canonicalStringify(changed))
    }
    await assert.rejects(repository.read(campaignId, scope), /changed during proof capture/)
    assert.equal(seen, 2); assert.equal(io.casCalls, 0); zero(repository); passed++
  }

  activeCase = 'single_admission_and_reentrant_scope'
  {
    const { io, repository, scope, snapshot } = await seed(base)
    const competing = repository.createActionScope!(campaignId)
    await repository.read(campaignId, competing)
    assert.equal(repository.getActionProofStats!().disposalReasons.admission, 1)
    await repository.commit(snapshot, control(snapshot, 'competing-control'), undefined, competing)
    await assert.rejects(repository.commit(snapshot, control(snapshot, 'owner-control'), undefined, scope), /head\/epoch changed/)
    zero(repository); assert.equal(io.writes, 1); passed++
  }
  {
    const { io, repository, scope, snapshot } = await seed(base)
    let reentered = false
    io.onStart = async keys => {
      if (!keys.includes(inactiveOrigin)) return
      io.onStart = undefined; reentered = true
      const fresh = await repository.read(campaignId, scope)
      assert.ok(fresh)
    }
    await assert.rejects(repository.commit(snapshot, control(snapshot, 'reentrant-control'), undefined, scope), /expired/)
    assert.equal(reentered, true); assert.equal(repository.getActionProofStats!().disposalReasons.concurrent, 1)
    assert.equal(io.casCalls, 0); zero(repository); passed++
  }

  activeCase = 'dispose_while_awaiting_cold_read'
  {
    const io = base.fork(), repository = createCampaignRepository(io), scope = repository.createActionScope!(campaignId)
    let release!: () => void, entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
    io.onStart = async keys => { if (keys.includes(inactiveOrigin)) { io.onStart = undefined; entered(); await held } }
    const reading = repository.read(campaignId, scope); await started
    repository.disposeActionScope!(scope); zero(repository); release()
    const snapshot = (await reading)!
    zero(repository)
    await repository.commit(snapshot, control(snapshot, 'late-read-cold-fallback'), undefined, scope)
    assert.equal(repository.getActionProofStats!().exactPasses, 0); zero(repository); passed++
  }

  activeCase = 'dispose_during_first_scoped_cold_commit'
  {
    const io = base.fork(), repository = createCampaignRepository(io), scope = repository.createActionScope!(campaignId)
    let release!: () => void, entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
    io.onStart = async keys => { if (keys.includes(inactiveOrigin)) { io.onStart = undefined; entered(); await held } }
    const committing = repository.commit(current, control(current, 'late-cold-commit'), undefined, scope)
    await started; repository.disposeActionScope!(scope); zero(repository); release()
    await assert.rejects(committing, /CAS failed/)
    assert.equal(io.writes, 0); zero(repository); passed++
  }

  activeCase = 'post_cas_proof_extension_failure_preserves_success'
  {
    const { io, repository, scope, snapshot } = await seed(base)
    const original = globalThis.structuredClone
    let failClone = false
    io.onCas = () => { io.onCas = undefined; failClone = true }
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
      if (failClone) throw new Error('injected optional cache allocation failure')
      return original(value, options)
    }) as typeof structuredClone
    let result
    try { result = await repository.commit(snapshot, control(snapshot, 'post-cas-cache-failure'), undefined, scope) }
    finally { globalThis.structuredClone = original }
    assert.equal(result.replayed, false); assert.equal(io.writes, 1)
    assert.equal(repository.getActionProofStats!().disposalReasons.capacity, 1); zero(repository)
    assert.deepEqual((await repository.read(campaignId))!.checkpoint, result.snapshot.checkpoint)
    repository.disposeActionScope!(scope); passed++
  }

  activeCase = 'dispose_during_cas_and_ack_loss'
  for (const mode of ['guard_false', 'dispose_cas', 'ack_loss', 'operation_replay'] as const) {
    const { io, repository, scope, snapshot } = await seed(base), mutation = control(snapshot, 'failure-control')
    if (mode === 'guard_false') await assert.rejects(repository.commit(snapshot, mutation, () => false, scope), /CAS failed/)
    if (mode === 'dispose_cas') {
      io.onCas = () => { io.onCas = undefined; repository.disposeActionScope!(scope) }
      await assert.rejects(repository.commit(snapshot, mutation, undefined, scope), /CAS failed/)
    }
    if (mode === 'ack_loss') {
      io.ackLoss = true
      await assert.rejects(repository.commit(snapshot, mutation, undefined, scope), /acknowledgment/)
      zero(repository)
      const recovered = await repository.commit(snapshot, mutation, undefined, scope)
      assert.equal(recovered.replayed, true); assert.equal(io.writes, 1)
    }
    if (mode === 'operation_replay') {
      await repository.commit(snapshot, mutation, undefined, scope)
      const replay = await repository.commit(snapshot, mutation, undefined, scope)
      assert.equal(replay.replayed, true); assert.equal(io.writes, 1)
      assert.equal(repository.getActionProofStats!().disposalReasons.replay, 1)
    }
    zero(repository); passed++
  }

  activeCase = 'proof_pool_caps_and_post_success_eviction'
  {
    const source = (await seed(base)).snapshot, key = 'key', raw = 'raw', size = bytes(key) + bytes(raw)
    for (const bound of [size - 1, size, size + 1]) {
      const pool = new CampaignActionProofPool({ bytes: bound, entries: 1 }), token = pool.create(campaignId), lease = pool.begin(token, campaignId)
      pool.capture(lease); pool.observe(lease, key, raw, bytes(raw)); pool.seal(lease, source, [campaignId])
      assert.equal(pool.observations().retainedBytes, bound < size ? 0 : size)
      assert.equal(Boolean(lease?.snapshot), bound >= size)
      if (bound >= size) pool.extend(lease, source, [{ key: 'next', value: 'entry' }], new Map([['next', 5]]))
      assert.equal(pool.observations().retainedBytes, 0)
      pool.end(lease); pool.dispose(token)
    }
    assert.throws(() => new CampaignActionProofPool({ bytes: CAMPAIGN_LIMITS.serializedBytes + 1 }))
    assert.throws(() => new CampaignActionProofPool({ entries: CAMPAIGN_PROOF_ENTRY_LIMIT + 1 }))
    const pool = new CampaignActionProofPool({ bytes: 100_000, entries: 2 }), token = pool.create(campaignId), lease = pool.begin(token, campaignId)
    pool.capture(lease); pool.observe(lease, 'a', 'b', 1); pool.observe(lease, 'a', 'b', 1)
    assert.equal(pool.observations().retainedEntries, 1)
    assert.throws(() => pool.observe(lease, 'a', 'c', 1), /changed/)
    pool.observe(lease, 'c', 'd', 1); assert.equal(pool.observations().retainedEntries, 2)
    pool.observe(lease, 'e', 'f', 1); assert.equal(pool.observations().retainedEntries, 0)
    pool.capture(lease); assert.equal(pool.observations().admittedScopes, 1, 'No repeated capture attempt after capacity rejection')
    passed++
  }

  activeCase = 'historical_semantics_are_not_rehashed'
  {
    const io = base.fork(), repository = createCampaignRepository(io), scope = repository.createActionScope!(campaignId)
    const original = crypto.subtle.digest.bind(crypto.subtle)
    let calls = 0
    const instrumented: SubtleCrypto['digest'] = (...args) => { calls++; return original(...args) }
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: instrumented })
    try {
      const snapshot = (await repository.read(campaignId, scope))!, cold = calls; calls = 0
      await repository.commit(snapshot, control(snapshot, 'digest-count-control'), undefined, scope)
      assert.ok(cold > 100); assert.ok(calls < 10); assert.equal(repository.getActionProofStats!().exactPasses, 1)
    } finally { Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: original }); repository.disposeActionScope!(scope) }
    zero(repository); passed++
  }

  console.log(JSON.stringify({ result: 'PASS', cases: passed, fixtureOperations: current.checkpoint.budget.operations, fixtureImmutableRecords: [...base.disk.keys()].filter(immutableKey).length,
    limits: { immutableEntries: CAMPAIGN_PROOF_ENTRY_LIMIT, serializedBytes: CAMPAIGN_LIMITS.serializedBytes, batchKeys: 33, activeRecords: 512 },
    coverage: 'actual raw coverage; inactive settled/replaced/unknown history; all record-family substitutions at before/entry/return; public graph detachment; fences; authority/lifecycle/admission/caps; receipt recovery; semantic-work elimination', liveCalls: 0 }))
}
main().catch(() => { console.error(JSON.stringify({ result: 'FAIL', case: activeCase })); process.exitCode = 1 })
