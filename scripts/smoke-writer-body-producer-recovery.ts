/** Production engine/repository crash and lost-ACK matrix over atomic injected IO.
 * Dispatch uses the installed SDK against loopback only. Reload has no adapter;
 * its authority is limited to durable local recovery, never another invocation. */
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ApiConfig } from '../src/types/api'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import type { BodyProducerIdentity, ProducerCampaignReceipt, ProducerCampaignRepository, ProducerCampaignSnapshot, ProducerOperationKind } from '../src/types/bodyProducer'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { planningManifestOptions } from '../src/services/writerCampaign/planningProfile'
import { createProducerCampaignRepository, producerKeys } from '../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine } from '../src/services/writerCampaign/bodyProducerEngine'
import { createOfflineSdkBodyProducer } from '../src/services/writerCampaign/bodyProducerTransport'
import { decodeStorageBytes } from '../src/services/writerCampaign/protocol'

const settings = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => settings.get(key) ?? null,
  setItem: (key: string, value: string) => { settings.set(key, String(value)) },
  removeItem: (key: string) => { settings.delete(key) },
} })
const { useApiConfig } = await import('../src/services/apiConfig')
const now = 1_800_000_000_000
const legacyIdentity = { runtimeIdentity: 'recovery-legacy-control', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const runtimeIdentity = { runtimeIdentity: 'recovery-producer-control', source: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }
const bodyText = 'Iria set a copper compass beside the white bowl. 雨停了。😀\r\ne\u0301'
let attempts = 0, serverFailures = 0, status = 200, sequence = 0
const unhandled: unknown[] = [], onUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', onUnhandled)
const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/chat/completions')
    let raw = ''; for await (const chunk of req) raw += chunk
    const request = JSON.parse(raw), prompt = JSON.parse(request.messages[1].content)
    assert.equal(prompt.window.text, bodyText)
    assert.equal(request.max_tokens, 1200); assert.equal(request.messages.length, 2)
    assert.equal(request.tools, undefined); assert.equal(request.stream, undefined)
    res.writeHead(status, { 'content-type': 'application/json' })
    if (status !== 200) { res.end(JSON.stringify({ error: { message: 'synthetic recovery failure' } })); return }
    const output = JSON.stringify({ protocol: 'body-producer-output-v1', items: [{ kind: 'narrator_claim',
      statement: 'A literal source-bound proposal, not semantic approval.', reliability: 'unspecified', subjects: [],
      spans: [{ startUtf16: 0, endUtf16: bodyText.length, quote: bodyText }] }], saturated: false,
      examination: { status: 'not_declared', intervals: [] } })
    res.end(JSON.stringify({ id: 'synthetic-recovery-response', object: 'chat.completion', created: 1, model: 'synthetic-body-producer',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: output } }],
      usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } }))
  } catch { serverFailures++; res.destroy(new Error('synthetic recovery fixture failure')) }
})
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, endpoint = `${origin}/v1`
const config: ApiConfig = { provider: 'custom', baseURL: endpoint, apiKey: 'synthetic-placeholder-not-a-secret', selectedModel: 'synthetic-body-producer',
  maxTokens: null, unlimitedTokens: true, temperature: 0.1, thinkingProtocol: 'deepseek', thinkingMode: 'disabled', customHeaders: {}, proxyUrl: '' }
const identity: BodyProducerIdentity = { adapterId: 'bounded-sdk-v1', adapterVersion: 'body-producer-sdk-v1', mode: 'offline_control',
  requestedModelId: config.selectedModel, effectiveModelId: config.selectedModel, configurationRevision: 'recovery-control-1', endpointIdentity: endpoint }
const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  assert.equal(url.origin, origin, 'Only the synthetic loopback endpoint is permitted')
  assert.equal(url.pathname, '/v1/chat/completions'); assert.equal(init?.redirect, 'error')
  attempts++; return originalFetch(input, init)
}
class AtomicIO implements CampaignRepositoryIO {
  readonly disk = new Map<string, string>()
  readonly commits: ProducerCampaignReceipt[] = []
  readonly reads: string[][] = []
  writes = 0
  writtenBytes = 0
  loseAck: ProducerOperationKind | null = null
  lost: { receipt: ProducerCampaignReceipt; readIndex: number } | null = null
  async getMany(keys: readonly string[]) {
    this.reads.push([...keys])
    return new Map(keys.map(key => [key, this.disk.get(key) ?? null]))
  }
  async compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit = () => true) {
    if (!canCommit() || entries.some(row => (this.disk.get(row.key) ?? null) !== row.expectedValue)) return false
    assert.equal(new Set(entries.map(row => row.key)).size, entries.length)
    const receiptRow = entries.find(row => row.key.includes(':receipt:'))
    assert.ok(receiptRow)
    const receipt = JSON.parse(receiptRow.value)
    const charge = entries.reduce((sum, row) => sum + Buffer.byteLength(row.key) + Buffer.byteLength(row.value), 0)
    assert.equal(decodeStorageBytes(receipt.serializedBytes), charge, 'Exact independent atomic key/value charge')
    this.writtenBytes += charge
    for (const row of entries) this.disk.set(row.key, row.value)
    this.writes++
    if (receipt.schemaVersion === 3) {
      this.commits.push(receipt)
      if (this.loseAck === receipt.kind) {
        this.loseAck = null; this.lost = { receipt, readIndex: this.reads.length }
        throw new Error('injected_lost_ack_after_atomic_commit')
      }
    }
    return true
  }
}
async function fixture(label: string) {
  const io = new AtomicIO(), id = `producer-recovery-${label}-${++sequence}`
  const legacy = createOfflineCampaignEngine({ repository: createCampaignRepository(io), identity: legacyIdentity, clock: () => now })
  const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language: 'en', identity: legacyIdentity, now, profile: 'body-evidence-three-chapter' }))
  let completed = await legacy.prepare(manifest)
  for (let i = 0; i < 9; i++) completed = await legacy.step(id, `legacy-step-${i}`)
  assert.equal(completed.head.status, 'completed')
  const repository = createProducerCampaignRepository({ io, clock: () => now })
  assert.equal(typeof repository.verifyCurrent, 'function', 'The durability matrix must exercise the production session capability')
  assert.equal(typeof repository.adoptVerified, 'function')
  const engine = (repo: ProducerCampaignRepository = repository, adapter = true) => createBodyProducerEngine({ repository: repo, identity: runtimeIdentity, clock: () => now,
    adapters: adapter ? [createOfflineSdkBodyProducer({ identity, currentConfigurationRevision: () => identity.configurationRevision })] : [] })
  const author = engine()
  await author.adopt(id, 'explicit-adoption')
  const source = await author.reviseBody(id, 3, bodyText, (await author.inspect(id))!.rawHead, 'explicit-source-revision')
  const selection = { chapterOrdinal: 3, startUtf16: 0, endUtf16: bodyText.length, planningRefs: [] }
  return { id, io, repository, engine, source, selection }
}
function latest(snapshot: ProducerCampaignSnapshot) {
  assert.equal(snapshot.checkpoint.producerRequests.length, 1)
  const index = snapshot.checkpoint.producerRequests[0]!, phase = snapshot.phases.get(index.phaseHash)!, request = snapshot.requests.get(index.requestHash)!
  assert.ok(phase && request)
  return { index, phase, request, response: phase.responseHash ? snapshot.responses.get(phase.responseHash)! : null,
    review: phase.resolution?.reviewHash ? snapshot.reviews.get(phase.resolution.reviewHash)! : null }
}
function conserved(f: Awaited<ReturnType<typeof fixture>>, snapshot: ProducerCampaignSnapshot) {
  const s = snapshot.checkpoint.storage, outstanding = decodeStorageBytes(s.outstandingBytes)
  assert.equal(decodeStorageBytes(s.writtenBytes), f.io.writtenBytes)
  assert.equal(decodeStorageBytes(s.allocatedBytes) - decodeStorageBytes(s.allocationConsumedBytes) - decodeStorageBytes(s.releasedBytes), outstanding)
  assert.equal(s.openAllocations.reduce((sum, row) => sum + decodeStorageBytes(row.remainingBytes), 0), outstanding)
  assert.ok(decodeStorageBytes(s.writtenBytes) + outstanding + decodeStorageBytes(s.recoveryRemainingBytes) <= 67_108_864)
  assert.equal(snapshot.checkpoint.budget.attempts, f.source.checkpoint.budget.attempts + 1, 'Exactly one request allowance, including recovery')
  assert.equal(f.io.commits.filter(row => row.kind === 'reserve').length, 1)
  assert.equal(snapshot.checkpoint.bodyCharacters, f.source.checkpoint.bodyCharacters, 'Recovery never changes accepted body progress')
  const finalPhase = latest(snapshot).phase
  assert.equal(f.io.commits.filter(row => row.kind === 'resolve').length, finalPhase.status === 'resolved' ? 1 : 0)
  if (finalPhase.status === 'resolved') assert.equal(outstanding, 0, 'A terminal resolution releases the one request allocation')
  else assert.ok(outstanding > 0, 'Unknown outcomes retain their existing allocation instead of authorizing a replacement')
  const operationIds = f.io.commits.map(row => row.operationId)
  assert.equal(new Set(operationIds).size, operationIds.length, 'A durable operation commits exactly once')
}
function observedLostReceipt(io: AtomicIO) {
  assert.ok(io.lost, 'The selected post-commit acknowledgment was actually lost')
  const { receipt, readIndex } = io.lost
  const key = producerKeys.receipt(receipt.campaignId, receipt.operationId)
  assert.ok(io.reads.slice(readIndex).some(keys => keys.includes(key)), 'Recovery reads and validates the committed receipt, not a blind write retry')
  assert.equal(io.commits.filter(row => row.operationId === receipt.operationId).length, 1)
}
async function recoverFresh(f: Awaited<ReturnType<typeof fixture>>, requestId: string) {
  // New repository and new engine have neither old owner/handle nor transport.
  const freshRepository = createProducerCampaignRepository({ io: f.io, clock: () => now })
  const fresh = f.engine(freshRepository, false), before = attempts
  const prior = (await fresh.inspect(f.id))!, priorPhase = latest(prior).phase
  const changes = priorPhase.status === 'resolved' || priorPhase.status === 'outcome_unknown' ? 0 : 1
  const result = await fresh.recover(f.id, requestId)
  assert.equal(attempts, before, 'Reload recovery never invokes the SDK')
  assert.equal(result.checkpoint.budget.operations, prior.checkpoint.budget.operations + changes)
  assert.equal(result.checkpoint.budget.activeMs, prior.checkpoint.budget.activeMs + changes * 10_000, 'Committed local recovery uses its metadata allowance, never another call allowance')
  const writes = f.io.writes, budget = structuredClone(result.checkpoint.budget)
  const duplicate = await fresh.recover(f.id, requestId)
  assert.equal(duplicate.rawHead, result.rawHead); assert.equal(f.io.writes, writes)
  assert.deepEqual(duplicate.checkpoint.budget, budget)
  return result
}
type CrashBoundary = 'after_reserve' | 'after_intent' | 'before_retain' | 'after_retain' | 'before_resolve'
function crashRepository(repository: ProducerCampaignRepository, boundary: CrashBoundary) {
  let closed = false, hit = false
  const crashed = () => { throw new Error('injected_crash_repository_unavailable') }
  const wrapper: ProducerCampaignRepository = { ...repository,
    async read(id, check, scope) { if (closed) return crashed(); return repository.read(id, check, scope) },
    async getReceipt(id, operationId, check, scope) { if (closed) return crashed(); return repository.getReceipt(id, operationId, check, scope) },
    verifyCurrent: repository.verifyCurrent && (async (id, context, scope) => {
      if (closed) return crashed()
      return repository.verifyCurrent!(id, context, scope)
    }),
    adoptVerified: repository.adoptVerified && (async (id, operationId, identity, context, scope) => {
      if (closed) return crashed()
      return repository.adoptVerified!(id, operationId, identity, context, scope)
    }),
    async commit(expected, mutation, canCommit, scope) {
      if (closed) return crashed()
      if ((boundary === 'before_resolve' && mutation.kind === 'resolve')
        || (boundary === 'before_retain' && mutation.kind === 'retain_response')) { hit = closed = true; return crashed() }
      const result = await repository.commit(expected, mutation, canCommit, scope)
      if ((boundary === 'after_reserve' && mutation.kind === 'reserve')
        || (boundary === 'after_intent' && mutation.kind === 'dispatch_intent')
        || (boundary === 'after_retain' && mutation.kind === 'retain_response')) { hit = closed = true; return crashed() }
      return result
    },
  }
  return { repository: wrapper, get hit() { return hit } }
}
const cases: string[] = []
async function test(name: string, work: () => Promise<void>) { status = 200; await work(); cases.push(name); console.log(`PASS ${name}`) }
try {
  useApiConfig().updateConfig(config)
  await test('revision_lost_ack_exact_command_recovers_receipt_without_replacing_again', async () => {
    const f = await fixture('revision-ack'), author = f.engine(), expectedRawHead = f.source.rawHead
    const text = bodyText + ' The compass needle turned east.', operationId = 'author-revision-with-lost-ack', before = attempts
    f.io.loseAck = 'body_revision'
    await assert.rejects(author.reviseBody(f.id, 3, text, expectedRawHead, operationId), /acknowledgment/)
    assert.equal(f.io.lost!.receipt.kind, 'body_revision')
    const disk = [...f.io.disk], writes = f.io.writes
    // A fresh engine possesses no old in-memory receipt or author-operation state.
    const reopened = f.engine(createProducerCampaignRepository({ io: f.io, clock: () => now }), false)
    const recovered = await reopened.reviseBody(f.id, 3, text, expectedRawHead, operationId)
    observedLostReceipt(f.io)
    assert.notEqual(recovered.rawHead, expectedRawHead)
    assert.equal(recovered.checkpoint.sourceEpoch, f.source.checkpoint.sourceEpoch + 1)
    const task = recovered.checkpoint.tasks.find(row => row.taskId === 'b-3')
    assert.ok(task?.artifact)
    assert.equal(recovered.artifacts.get(task.artifact.hash)!.text, text)
    assert.equal(f.io.writes, writes); assert.deepEqual([...f.io.disk], disk, 'Exact retry creates no second artifact, receipt, checkpoint or head')
    await assert.rejects(reopened.reviseBody(f.id, 3, text + ' Conflicting replacement.', expectedRawHead, operationId), { code: 'operation_conflict' })
    await assert.rejects(reopened.reviseBody(f.id, 3, text + ' Stale new command.', expectedRawHead, 'different-revision-command'), { code: 'source_changed' })
    assert.equal(f.io.writes, writes); assert.deepEqual([...f.io.disk], disk)
    assert.equal(f.io.commits.filter(row => row.operationId === operationId).length, 1)
    assert.equal(recovered.checkpoint.producerRequests.length, 0); assert.equal(attempts, before)
  })
  for (const kind of ['reserve', 'dispatch_intent', 'retain_response', 'resolve', 'outcome_unknown'] as const) {
    await test(`lost_ack_${kind}_reads_receipt_without_duplicate_authority`, async () => {
      const f = await fixture(`ack-${kind}`), active = f.engine(), handle = await active.prepare(f.id, f.selection, identity.adapterId), before = attempts
      f.io.loseAck = kind
      if (kind === 'outcome_unknown') status = 503
      let outcome: ProducerCampaignSnapshot
      if (kind === 'outcome_unknown') {
        // Recovery's own lost ACK is surfaced, then a fresh owner reads it.
        await assert.rejects(active.invoke(handle, `invoke-${kind}`), /acknowledgment/)
        outcome = (await f.repository.read(f.id))!
      } else outcome = await active.invoke(handle, `invoke-${kind}`)
      observedLostReceipt(f.io)
      const expectedCalls = ['reserve', 'dispatch_intent'].includes(kind) ? 0 : 1
      assert.equal(attempts - before, expectedCalls)
      const state = latest(outcome)
      if (kind === 'reserve') {
        assert.equal(state.phase.resolution?.outcome, 'not_dispatched'); assert.equal(state.phase.intentHash, null)
      } else if (kind === 'dispatch_intent' || kind === 'outcome_unknown') {
        assert.equal(state.phase.status, 'outcome_unknown'); assert.equal(state.response, null)
      } else if (kind === 'retain_response') {
        assert.equal(state.phase.status, 'response_retained'); assert.ok(state.response); assert.equal(state.review, null)
        assert.equal(f.io.commits.filter(row => row.kind === 'resolve').length, 0)
      } else assert.equal(state.phase.resolution?.outcome, 'review_ready')
      const recovered = await recoverFresh(f, state.request.id), final = latest(recovered)
      if (kind === 'retain_response' || kind === 'resolve') {
        assert.equal(final.phase.resolution?.outcome, 'review_ready'); assert.equal(final.review!.result.compiledClaimCount, 1)
        assert.equal(f.io.commits.filter(row => row.kind === 'retain_response').length, 1)
        assert.equal(f.io.commits.filter(row => row.kind === 'resolve').length, 1)
        assert.equal(decodeStorageBytes(recovered.checkpoint.storage.outstandingBytes), 0)
      }
      const writes = f.io.writes
      if (kind !== 'outcome_unknown') await active.invoke(handle, `invoke-${kind}`)
      assert.equal(f.io.writes, writes); assert.equal(attempts - before, expectedCalls)
      conserved(f, recovered)
    })
  }
  for (const boundary of ['after_reserve', 'after_intent', 'before_retain', 'after_retain', 'before_resolve'] as const) {
    await test(`crash_${boundary}_fresh_engine_recovers_only_committed_evidence`, async () => {
      const f = await fixture(`crash-${boundary}`), crashed = crashRepository(f.repository, boundary), active = f.engine(crashed.repository)
      const handle = await active.prepare(f.id, f.selection, identity.adapterId), before = attempts
      await assert.rejects(active.invoke(handle, `invoke-${boundary}`), /injected_crash_repository_unavailable/)
      assert.equal(crashed.hit, true)
      const surviving = (await createProducerCampaignRepository({ io: f.io, clock: () => now }).read(f.id))!, state = latest(surviving)
      assert.equal(state.phase.status, boundary === 'after_reserve' ? 'reserved' : boundary === 'after_intent' || boundary === 'before_retain' ? 'dispatch_intent' : 'response_retained')
      assert.equal(f.io.commits.filter(row => row.kind === 'resolve').length, 0, 'Crash cut precedes the final durable resolution')
      const calls = boundary === 'after_reserve' || boundary === 'after_intent' ? 0 : 1
      assert.equal(attempts - before, calls)
      const recovered = await recoverFresh(f, state.request.id), final = latest(recovered)
      if (boundary === 'after_reserve') {
        assert.equal(final.phase.resolution?.outcome, 'not_dispatched'); assert.equal(final.phase.intentHash, null)
        assert.equal(final.phase.resolution?.reason, 'recovered_before_intent')
      } else if (boundary === 'after_intent' || boundary === 'before_retain') {
        assert.equal(final.phase.status, 'outcome_unknown'); assert.ok(decodeStorageBytes(recovered.checkpoint.storage.outstandingBytes) > 0)
        assert.equal(final.response, null); assert.equal(f.io.commits.filter(row => row.kind === 'retain_response').length, 0)
      } else {
        assert.equal(final.phase.resolution?.outcome, 'review_ready'); assert.equal(final.response!.hash, state.response!.hash)
        assert.equal(final.review!.result.compiledClaimCount, 1); assert.equal(final.review!.result.packet.coverage.semanticReview.status, 'not_reviewed')
        assert.equal(f.io.commits.filter(row => row.kind === 'retain_response').length, 1)
        assert.equal(f.io.commits.filter(row => row.kind === 'resolve').length, 1)
      }
      assert.equal(attempts - before, calls); conserved(f, recovered)
    })
  }
  for (const boundary of ['after_reserve', 'after_retain'] as const) {
    await test(`recovery_resolve_lost_ack_${boundary}_reopens_without_recommit`, async () => {
      const f = await fixture(`recovery-ack-${boundary}`), crashed = crashRepository(f.repository, boundary), active = f.engine(crashed.repository)
      const handle = await active.prepare(f.id, f.selection, identity.adapterId), before = attempts
      await assert.rejects(active.invoke(handle, `invoke-${boundary}`), /injected_crash_repository_unavailable/)
      const snapshot = (await f.repository.read(f.id))!, requestId = latest(snapshot).request.id
      f.io.loseAck = 'resolve'
      const recovery = f.engine(createProducerCampaignRepository({ io: f.io, clock: () => now }), false)
      await assert.rejects(recovery.recover(f.id, requestId), /acknowledgment/)
      const writes = f.io.writes, recovered = await recoverFresh(f, requestId)
      observedLostReceipt(f.io)
      assert.equal(f.io.writes, writes); assert.equal(f.io.commits.filter(row => row.kind === 'resolve').length, 1)
      assert.equal(latest(recovered).phase.resolution?.outcome, boundary === 'after_reserve' ? 'not_dispatched' : 'review_ready')
      assert.equal(attempts - before, boundary === 'after_reserve' ? 0 : 1)
      conserved(f, recovered)
    })
  }
  assert.equal(serverFailures, 0); assert.equal(unhandled.length, 0)
  console.log(JSON.stringify({ protocol: 'body-producer-recovery-controls-v1', passed: cases.length, cases, loopbackRequests: attempts,
    externalRequests: 0, browserExecution: 'not_run', io: 'production repository over injected atomic memory IO',
    recoveryAuthority: 'fresh production engine without adapters; no transport reacquisition', semanticReview: 'not_run' }, null, 2))
} finally {
  globalThis.fetch = originalFetch; process.removeListener('unhandledRejection', onUnhandled)
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
}
