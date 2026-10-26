/** Complete production engine → bounded SDK → local HTTP → durable repository → shared compiler.
 * Dynamic body revisions are actual Campaign author operations, not forged snapshots or fixture proposals. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { ApiConfig } from '../src/types/api'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import type { BodyProducerEngine, BodyProducerIdentity, ProducerCampaignRepository, ProducerCampaignSnapshot } from '../src/types/bodyProducer'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { planningManifestOptions } from '../src/services/writerCampaign/planningProfile'
import { createProducerCampaignRepository } from '../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine, BodyProducerEngineError } from '../src/services/writerCampaign/bodyProducerEngine'
import { createOfflineSdkBodyProducer } from '../src/services/writerCampaign/bodyProducerTransport'
import { deriveBodyEvidencePrefixFromSource } from '../src/services/writerCampaign/bodyEvidence'
import { canonicalStringify, decodeStorageBytes, hashCampaignValue } from '../src/services/writerCampaign/protocol'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, String(value)) }, removeItem: (key: string) => { storage.delete(key) },
} })
const { useApiConfig } = await import('../src/services/apiConfig')
const now = 1_800_000_000_000
const legacyIdentity = { runtimeIdentity: 'legacy-producer-control', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const runtimeIdentity = { runtimeIdentity: 'current-producer-control', source: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }
let configRevision = 1, sequence = 0, attempts = 0
const sourceBodies = {
  zh: '阿雨把银钥匙放在陶杯旁。窗外飘着蓝色的雪。她说：“我还不知道来信人的名字。”𠮷🙂\r\nA\u030A',
  en: 'Neris placed a silver key beside the ceramic cup. Blue snow fell outside. “I do not know the sender,” she said. 𠮷🙂\r\nA\u030A',
}
const prefixText = 'LOCAL-UNSELECTED-PREFIX|', suffixText = '|LOCAL-UNSELECTED-SUFFIX'
const output = (items: unknown[] = [], saturated = false) => JSON.stringify({ protocol: 'body-producer-output-v1', items, saturated,
  examination: { status: 'not_declared', intervals: [] } })
const span = (text: string) => ({ startUtf16: 0, endUtf16: text.length, quote: text })
const narrator = (text: string, statement = 'A source-anchored proposal, not a semantic verdict.') => ({
  kind: 'narrator_claim', statement, reliability: 'unspecified', spans: [span(text)], subjects: [],
})
type Scenario = { reply?: (prompt: any) => string; status?: number; hold?: boolean; finish?: string }
let scenario: Scenario = {}, arrived: (() => void) | null = null, release: (() => void) | null = null
const calls: Array<{ wire: { system: string; prompt: string }; prompt: any }> = []
let serverFailures = 0
const digest = (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/chat/completions')
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), prompt = JSON.parse(body.messages[1].content)
    assert.equal(body.max_tokens, 1200); assert.deepEqual(body.thinking, { type: 'disabled' })
    assert.equal(body.tools, undefined); assert.equal(body.stream, undefined); assert.equal(body.messages.length, 2)
    calls.push({ wire: { system: body.messages[0].content, prompt: body.messages[1].content }, prompt })
    const captured = scenario
    const finish = () => {
      res.writeHead(captured.status ?? 200, { 'content-type': 'application/json' })
      if (captured.status && captured.status !== 200) { res.end(JSON.stringify({ error: { message: 'synthetic-provider-diagnostic' } })); return }
      res.end(JSON.stringify({ id: 'synthetic-engine-control', object: 'chat.completion', created: 1, model: 'unverified-provider-assertion',
        choices: [{ index: 0, finish_reason: captured.finish ?? 'stop', message: { role: 'assistant', content: captured.reply?.(prompt) ?? output([narrator(prompt.window.text)]) } }],
        usage: { prompt_tokens: 37, completion_tokens: 21, total_tokens: 58 } }))
    }
    if (captured.hold) release = finish; else finish()
    arrived?.()
  } catch { serverFailures++; res.destroy(new Error('local fixture failure')) }
})
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, endpoint = `${origin}/v1`
const baseConfig: ApiConfig = { provider: 'custom', baseURL: endpoint, apiKey: 'synthetic-placeholder-not-a-secret', selectedModel: 'synthetic-body-producer',
  maxTokens: null, unlimitedTokens: true, temperature: 0.9, thinkingProtocol: 'deepseek', thinkingMode: 'disabled', customHeaders: {}, proxyUrl: '' }
function configure(patch: Partial<ApiConfig> = {}) { configRevision++; useApiConfig().updateConfig({ ...baseConfig, ...patch }) }
function producer() {
  const identity: BodyProducerIdentity = { adapterId: 'bounded-sdk-v1', adapterVersion: 'body-producer-sdk-v1', mode: 'offline_control',
    requestedModelId: baseConfig.selectedModel, effectiveModelId: baseConfig.selectedModel, configurationRevision: `configuration-${configRevision}`, endpointIdentity: endpoint }
  return createOfflineSdkBodyProducer({ identity, currentConfigurationRevision: () => `configuration-${configRevision}` })
}
const originalFetch = globalThis.fetch
const unhandled: unknown[] = [], onUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', onUnhandled)
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  assert.equal(url.origin, origin, 'Only the approved synthetic loopback endpoint may receive input')
  assert.equal(init?.redirect, 'error'); attempts++
  return originalFetch(input, init)
}
function memoryIO() {
  const disk = new Map<string, string>(); let writes = 0
  const io: CampaignRepositoryIO = {
    async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(row => (disk.get(row.key) ?? null) !== row.expectedValue)) return false
      for (const row of entries) disk.set(row.key, row.value); writes++; return true
    },
  }
  return { io, disk, get writes() { return writes } }
}
async function fixture(label: string, language: 'zh' | 'en' = 'en') {
  const local = memoryIO(), id = `dynamic-${language}-${label}-${++sequence}`, legacyRepository = createCampaignRepository(local.io)
  const legacy = createOfflineCampaignEngine({ identity: legacyIdentity, clock: () => now, repository: legacyRepository })
  const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language, identity: legacyIdentity, now, profile: 'body-evidence-three-chapter' }))
  let old = await legacy.prepare(manifest)
  for (let i = 0; i < 9; i++) old = await legacy.step(id, `legacy-step-${i}`)
  assert.equal(old.head.status, 'completed')
  const repository = createProducerCampaignRepository({ io: local.io, clock: () => now })
  assert.equal(typeof repository.verifyCurrent, 'function', 'The SDK vertical must exercise the production session capability')
  assert.equal(typeof repository.adoptVerified, 'function')
  const buildEngine = (repo: ProducerCampaignRepository = repository, enabled = true): BodyProducerEngine => createBodyProducerEngine({ repository: repo, identity: runtimeIdentity,
    adapters: enabled ? [producer()] : [], clock: () => now })
  const engine = buildEngine()
  await engine.adopt(id, 'explicit-adoption')
  const text = sourceBodies[language]
  const source = await engine.reviseBody(id, 3, prefixText + text + suffixText, (await engine.inspect(id))!.rawHead, 'author-body-revision')
  const selection = { chapterOrdinal: 3, startUtf16: prefixText.length, endUtf16: prefixText.length + text.length, planningRefs: [] }
  return { id, local, repository, engine, buildEngine, selection, text, source, legacyRepository, old }
}
function latest(snapshot: ProducerCampaignSnapshot) {
  const row = snapshot.checkpoint.producerRequests.at(-1)
  assert.ok(row)
  const phase = snapshot.phases.get(row.phaseHash), request = snapshot.requests.get(row.requestHash)
  assert.ok(phase && request)
  const review = phase.resolution?.reviewHash ? snapshot.reviews.get(phase.resolution.reviewHash) : null
  const response = phase.responseHash ? snapshot.responses.get(phase.responseHash) : null
  return { row, phase, request, review, response }
}
function isReviewResolution(entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]): boolean {
  return entries.some(entry => {
    const value = JSON.parse(entry.value)
    return value.protocolVersion === 'campaign-v3-receipt' && value.kind === 'resolve' && value.event.reviewHash !== null
  })
}
function assertConservation(snapshot: ProducerCampaignSnapshot) {
  const s = snapshot.checkpoint.storage, W = decodeStorageBytes(s.writtenBytes), U = decodeStorageBytes(s.outstandingBytes), P = decodeStorageBytes(s.recoveryRemainingBytes)
  assert.equal(decodeStorageBytes(s.allocatedBytes) - decodeStorageBytes(s.allocationConsumedBytes) - decodeStorageBytes(s.releasedBytes), U)
  assert.equal(s.openAllocations.reduce((sum, row) => sum + decodeStorageBytes(row.remainingBytes), 0), U)
  assert.ok(W + U + P <= 67_108_864)
}
const cases: string[] = []
async function test(id: string, action: () => Promise<void>) { await action(); cases.push(id); console.log(`PASS ${id}`) }
async function prepared(f: Awaited<ReturnType<typeof fixture>>, engine = f.engine) { return engine.prepare(f.id, f.selection, 'bounded-sdk-v1') }
function hold() { scenario = { hold: true }; release = null; return new Promise<void>(resolve => { arrived = resolve }) }
try {
  configure()
  for (const language of ['zh', 'en'] as const) await test(`dynamic_${language}_actual_source_sdk_durable_compiler`, async () => {
    scenario = {}
    const f = await fixture('generic', language), beforeAttempts = attempts, beforeWrites = f.local.writes, beforeDisk = [...f.local.disk]
    const handle = await prepared(f)
    assert.equal(digest([...f.local.disk]), digest(beforeDisk)); assert.equal(f.local.writes, beforeWrites); assert.equal(attempts, beforeAttempts)
    assert.equal(digest(handle.prepared.window.text), digest(f.text)); assert.deepEqual(handle.prepared.catalog, [])
    const result = await f.engine.invoke(handle, 'explicit-one-call'), state = latest(result)
    assert.equal(attempts - beforeAttempts, 1); assert.equal(state.phase.status, 'resolved'); assert.equal(state.phase.resolution?.outcome, 'review_ready')
    assert.ok(state.review && state.response)
    assert.equal(digest(calls.at(-1)!.wire), digest(handle.prepared.wire))
    assert.equal(digest(calls.at(-1)!.prompt.window.text), digest(f.text))
    assert.deepEqual(calls.at(-1)!.prompt.planningCatalog, [])
    assert.ok(!calls.at(-1)!.wire.prompt.includes(prefixText) && !calls.at(-1)!.wire.prompt.includes(suffixText))
    assert.equal(state.review.result.packet.producer.kind, 'registered_producer')
    assert.equal(state.review.result.packet.producer.reportedModelId, null)
    assert.equal(state.review.result.packet.producer.aggregateManifestHash, result.manifest.hash)
    assert.equal(state.review.result.packet.coverage.semanticReview.status, 'not_reviewed')
    assert.equal(state.review.result.packet.coverage.examinedDeclaration.status, 'not_run')
    assert.equal(state.review.result.compiledClaimCount, 1)
    assert.equal(state.response.usage.provenance, 'synthetic_control')
    assert.equal(result.checkpoint.bodyCharacters, f.source.checkpoint.bodyCharacters, 'Proposal production cannot change body progress')
    assert.equal(result.checkpoint.budget.attempts, f.source.checkpoint.budget.attempts + 1)
    assert.equal(decodeStorageBytes(result.checkpoint.storage.outstandingBytes), 0)
    assertConservation(result)
    const reloaded = await f.buildEngine().inspect(f.id)
    assert.ok(reloaded); assert.equal(reloaded.rawHead, result.rawHead); assert.equal(attempts - beforeAttempts, 1)
  })
  await test('duplicate_clicks_and_reconstructed_handles_do_not_dispatch_twice', async () => {
    const f = await fixture('duplicate'), handle = await prepared(f), arrival = hold(), before = attempts
    const first = f.engine.invoke(handle, 'same-command'), second = f.engine.invoke(handle, 'same-command')
    assert.equal(first, second)
    await arrival; release!()
    const result = await first; await second
    assert.equal(attempts - before, 1); assert.equal(latest(result).phase.resolution?.outcome, 'review_ready')
    const writes = f.local.writes
    await f.engine.invoke(handle, 'same-command')
    assert.equal(attempts - before, 1); assert.equal(f.local.writes, writes)
    await assert.rejects(f.engine.invoke(handle, 'changed-command'), error => error instanceof BodyProducerEngineError && error.code === 'operation_conflict')
    await assert.rejects(f.buildEngine().invoke(structuredClone(handle), 'same-command'), error => error instanceof BodyProducerEngineError && error.code === 'invalid_prepared_handle')
  })
  await test('counterfactual_body_revision_changes_input_and_invalidates_old_preparation', async () => {
    scenario = {}; const f = await fixture('counterfactual'), old = await prepared(f), before = attempts
    const changed = f.text.replace('silver key', 'glass compass')
    await f.engine.reviseBody(f.id, 3, prefixText + changed + suffixText, (await f.engine.inspect(f.id))!.rawHead, 'counterfactual-revision')
    for (let retry = 0; retry < 2; retry++) await assert.rejects(f.engine.invoke(old, 'stale-source-call'), error => error instanceof BodyProducerEngineError && error.code === 'source_changed')
    const discarded = await f.engine.inspect(f.id)
    assert.equal(discarded!.checkpoint.producerRequests.length, 0); assert.equal(attempts, before)
    const selection = { ...f.selection, endUtf16: prefixText.length + changed.length }
    const current = await f.engine.prepare(f.id, selection, 'bounded-sdk-v1')
    assert.notEqual(current.prepared.inputDigest, old.prepared.inputDigest)
    assert.notEqual(current.prepared.source.rawBodyHash, old.prepared.source.rawBodyHash)
    assert.notEqual(current.prepared.source.currentCandidateId, old.prepared.source.currentCandidateId)
    await f.engine.invoke(current, 'current-source-call')
    assert.equal(digest(calls.at(-1)!.prompt.window.text), digest(changed)); assert.equal(attempts - before, 1)
  })
  await test('no_live_host_and_changed_configuration_refuse_without_intent', async () => {
    scenario = {}; const f = await fixture('no-host'), unconfigured = f.buildEngine(f.repository, false), before = attempts
    const disabled = await unconfigured.prepare(f.id, f.selection, 'bounded-sdk-v1'), writes = f.local.writes
    assert.equal(disabled.invocationAllowed, false)
    await assert.rejects(unconfigured.invoke(disabled), error => error instanceof BodyProducerEngineError && error.code === 'producer_not_authorized')
    assert.equal(f.local.writes, writes); assert.equal(attempts, before)
    const configured = await prepared(f)
    configure()
    await assert.rejects(f.engine.invoke(configured, 'stale-config'), error => error instanceof BodyProducerEngineError && error.code === 'configuration_changed')
    const unchanged = await f.engine.inspect(f.id)
    assert.equal(unchanged!.checkpoint.producerRequests.length, 0); assert.equal(attempts, before)
  })
  await test('configuration_change_after_reserve_is_durable_not_dispatched', async () => {
    scenario = {}; const f = await fixture('reserve-guard'), before = attempts
    let changed = false
    const wrapped: ProducerCampaignRepository = { ...f.repository, async commit(expected, mutation, canCommit, scope) {
      const result = await f.repository.commit(expected, mutation, canCommit, scope)
      if (!changed && mutation.kind === 'reserve') { changed = true; configure() }
      return result
    } }
    const engine = f.buildEngine(wrapped), handle = await prepared(f, engine), result = await engine.invoke(handle, 'reserve-config-change'), state = latest(result)
    assert.equal(changed, true); assert.equal(attempts, before)
    assert.equal(state.phase.status, 'resolved'); assert.equal(state.phase.resolution?.outcome, 'not_dispatched'); assert.equal(state.phase.intentHash, null)
    assert.equal(result.checkpoint.budget.attempts, f.source.checkpoint.budget.attempts + 1)
    assert.equal(decodeStorageBytes(result.checkpoint.storage.outstandingBytes), 0); assertConservation(result)
  })
  await test('source_revision_after_intent_cas_before_ack_blocks_http_and_stays_unknown', async () => {
    scenario = {}; const f = await fixture('intent-ack-source'), before = attempts
    const other = f.buildEngine(createProducerCampaignRepository({ io: f.local.io, clock: () => now }))
    let changed = false
    const wrapped: ProducerCampaignRepository = { ...f.repository, async commit(expected, mutation, canCommit, scope) {
      const result = await f.repository.commit(expected, mutation, canCommit, scope)
      if (!changed && mutation.kind === 'dispatch_intent') {
        const revised = await other.reviseBody(f.id, 3, prefixText + f.text + ' Source changed after intent.' + suffixText,
          (await other.inspect(f.id))!.rawHead, 'between-intent-and-ack')
        assert.equal(revised.checkpoint.sourceEpoch, f.source.checkpoint.sourceEpoch + 1)
        changed = true
      }
      return result
    } }
    const engine = f.buildEngine(wrapped), handle = await prepared(f, engine)
    const result = await engine.invoke(handle, 'fenced-intent-call'), state = latest(result)
    assert.equal(changed, true); assert.equal(attempts, before)
    assert.equal(result.checkpoint.sourceEpoch, f.source.checkpoint.sourceEpoch + 1, 'The source really changed; a failed competing verification cannot stand in for this race')
    assert.equal(state.phase.status, 'outcome_unknown'); assert.ok(state.phase.intentHash)
    assert.equal(state.response, null); assert.ok(decodeStorageBytes(result.checkpoint.storage.outstandingBytes) > 0)
    assert.equal(result.checkpoint.budget.attempts, f.source.checkpoint.budget.attempts + 1)
    assertConservation(result)
  })
  await test('configuration_change_during_http_retains_response_but_refuses_review', async () => {
    const f = await fixture('held-config'), handle = await prepared(f), arrival = hold(), before = attempts
    const pending = f.engine.invoke(handle, 'old-configuration-call')
    await arrival; configure(); release!()
    const result = await pending, state = latest(result)
    assert.equal(attempts - before, 1); assert.ok(state.response)
    assert.equal(state.phase.resolution?.outcome, 'refused'); assert.equal(state.phase.resolution?.reason, 'configuration_changed')
    assert.equal(state.review, null); assertConservation(result)
  })
  await test('configuration_change_at_final_resolve_cas_refuses_review_and_preserves_response', async () => {
    scenario = {}; const f = await fixture('resolve-cas-config'), before = attempts
    const original = f.local.io.compareAndSwapMany.bind(f.local.io)
    let injected = false, deniedReviewGates = 0, reviewCasAttempts = 0
    f.local.io.compareAndSwapMany = async (entries, canCommit = () => true) => {
      if (!isReviewResolution(entries)) return original(entries, canCommit)
      reviewCasAttempts++
      return original(entries, () => {
        if (!injected) { injected = true; configure() }
        const permitted = canCommit()
        if (!permitted) deniedReviewGates++
        return permitted
      })
    }
    const result = await f.engine.invoke(await prepared(f), 'final-cas-config-call'), state = latest(result)
    assert.equal(injected, true); assert.equal(reviewCasAttempts, 1); assert.equal(deniedReviewGates, 1)
    assert.equal(attempts - before, 1); assert.ok(state.response); assert.equal(state.phase.status, 'resolved')
    assert.equal(state.phase.resolution?.outcome, 'refused'); assert.equal(state.phase.resolution?.reason, 'configuration_changed')
    assert.equal(state.review, null); assert.equal(result.reviews.size, 0)
    assert.equal(result.checkpoint.budget.attempts, f.source.checkpoint.budget.attempts + 1)
    assert.equal(decodeStorageBytes(result.checkpoint.storage.outstandingBytes), 0); assertConservation(result)
    const reloaded = await f.buildEngine().inspect(f.id)
    assert.ok(reloaded); assert.equal(reloaded.rawHead, result.rawHead); assert.ok(latest(reloaded).response)
    assert.equal(reloaded.reviews.size, 0); assert.equal(attempts - before, 1)
  })
  await test('review_capacity_failure_disposes_real_scope_then_refuses_cold_without_reseeding', async () => {
    scenario = {}; const f = await fixture('review-capacity-scope'), before = attempts
    let rejected = false, scopesCreated = 0, scopesDisposed = 0, coldReads = 0, coldCommits = 0, sessions = 0
    const wrapped: ProducerCampaignRepository = { ...f.repository,
      createActionScope(id) { scopesCreated++; return f.repository.createActionScope!(id) },
      disposeActionScope(scope) { scopesDisposed++; f.repository.disposeActionScope!(scope) },
      async verifyCurrent(id, context, scope) {
        assert.equal(rejected, false, 'Handled capacity refusal cannot acquire another cold verification session')
        sessions++; return f.repository.verifyCurrent!(id, context, scope)
      },
      async read(id, check, scope) {
        if (rejected) { assert.equal(scope, undefined, 'Handled failure must not reuse its closed proof token'); coldReads++ }
        return f.repository.read(id, check, scope)
      },
      getReceipt(id, command, check, scope) { return f.repository.getReceipt(id, command, check, scope) },
      async commit(expected, mutation, canCommit, scope) {
        if (!rejected && mutation.kind === 'resolve' && mutation.outcome === 'review_ready' && mutation.review) {
          assert.ok(scope, 'The capacity refusal must happen inside an actual admitted repository action')
          // Inject only the oversized candidate at the repository boundary. The
          // real hash/size validator rejects it and closes the real scope; no
          // mocked exception, forged stored snapshot or altered raw reply is used.
          const { hash: _hash, ...payload } = structuredClone(mutation.review)
          payload.result.packetText += 'x'.repeat(131_072)
          const review = { ...payload, hash: await hashCampaignValue('body-producer-review-v1', payload) }, writes = f.local.writes
          try { return await f.repository.commit(expected, { ...mutation, review }, canCommit, scope) }
          catch (error) {
            assert.equal((error as { code?: string }).code, 'budget')
            assert.equal(f.local.writes, writes); assert.equal(f.repository.getActionProofStats!().retainedBytes, 0)
            rejected = true; throw error
          }
        }
        if (rejected) {
          assert.equal(scope, undefined, 'Fallback stays cold within the same invocation owner')
          assert.equal(mutation.kind, 'resolve'); assert.ok(mutation.kind === 'resolve')
          assert.equal(mutation.outcome, 'refused'); assert.equal(mutation.reason, 'review_capacity'); coldCommits++
        }
        return f.repository.commit(expected, mutation, canCommit, scope)
      },
    }
    const engine = f.buildEngine(wrapped), result = await engine.invoke(await prepared(f, engine), 'bounded-review-capacity'), state = latest(result)
    assert.equal(rejected, true); assert.ok(coldReads > 0); assert.equal(coldCommits, 1)
    assert.equal(scopesCreated, 2, 'Preparation and invocation only; fallback cannot acquire another scope')
    assert.equal(sessions, 2, 'Each owner has one initial cold session; handled failure stays on the old bounded fallback')
    assert.equal(scopesDisposed, 2); assert.equal(f.repository.getActionProofStats!().retainedBytes, 0)
    assert.equal(state.phase.status, 'resolved'); assert.equal(state.phase.resolution?.outcome, 'refused')
    assert.equal(state.phase.resolution?.reason, 'review_capacity'); assert.ok(state.response)
    assert.equal(state.review, null); assert.equal(result.reviews.size, 0); assert.equal(attempts - before, 1)
    assert.equal(result.checkpoint.budget.attempts, f.source.checkpoint.budget.attempts + 1)
    assert.equal(decodeStorageBytes(result.checkpoint.storage.outstandingBytes), 0); assertConservation(result)
    const reloaded = await f.buildEngine().inspect(f.id)
    assert.ok(reloaded); assert.equal(reloaded.rawHead, result.rawHead); assert.equal(reloaded.reviews.size, 0)
  })
  await test('second_repository_revision_before_final_resolve_cas_preserves_stale_recoverable_outcome', async () => {
    scenario = {}; const f = await fixture('resolve-cas-source'), before = attempts
    const original = f.local.io.compareAndSwapMany.bind(f.local.io)
    const otherRepository = createProducerCampaignRepository({ io: f.local.io, clock: () => now }), otherEngine = f.buildEngine(otherRepository)
    let injected = false, refusedReviewCas = 0, reviewCasAttempts = 0
    f.local.io.compareAndSwapMany = async (entries, canCommit = () => true) => {
      if (!isReviewResolution(entries)) return original(entries, canCommit)
      reviewCasAttempts++
      if (!injected) {
        injected = true
        const current = await otherEngine.inspect(f.id)
        assert.ok(current); assert.equal(latest(current).phase.status, 'response_retained'); assert.ok(latest(current).response)
        await otherEngine.reviseBody(f.id, 3, prefixText + f.text + ' Changed just before publication.' + suffixText,
          current.rawHead, 'author-revision-before-resolve-cas')
      }
      const committed = await original(entries, canCommit)
      if (!committed) refusedReviewCas++
      return committed
    }
    const result = await f.engine.invoke(await prepared(f), 'final-cas-source-call'), state = latest(result)
    assert.equal(injected, true); assert.equal(reviewCasAttempts, 1); assert.equal(refusedReviewCas, 1)
    assert.equal(attempts - before, 1); assert.equal(state.phase.status, 'response_retained'); assert.ok(state.response)
    assert.equal(state.review, null); assert.equal(result.reviews.size, 0); assert.equal(result.checkpoint.sourceEpoch, f.source.checkpoint.sourceEpoch + 1)
    assert.ok(state.request.sourceEpoch < result.checkpoint.sourceEpoch); assert.ok(decodeStorageBytes(result.checkpoint.storage.outstandingBytes) > 0)
    assert.equal(result.checkpoint.budget.attempts, f.source.checkpoint.budget.attempts + 1); assertConservation(result)
    const reopened = f.buildEngine(), reloaded = await reopened.inspect(f.id)
    assert.ok(reloaded); assert.equal(reloaded.rawHead, result.rawHead); assert.equal(latest(reloaded).phase.status, 'response_retained')
    const recovered = await reopened.recover(f.id, state.row.id), refusal = latest(recovered)
    assert.ok(refusal.response); assert.equal(refusal.phase.status, 'resolved'); assert.equal(refusal.phase.resolution?.outcome, 'refused')
    assert.equal(refusal.phase.resolution?.reason, 'source_changed'); assert.equal(refusal.review, null); assert.equal(recovered.reviews.size, 0)
    assert.equal(decodeStorageBytes(recovered.checkpoint.storage.outstandingBytes), 0)
    assert.equal(recovered.checkpoint.budget.attempts, result.checkpoint.budget.attempts); assert.equal(attempts - before, 1); assertConservation(recovered)
  })
  await test('cancel_local_revokes_prepared_handle_without_reserve_or_http', async () => {
    scenario = {}; const f = await fixture('revoked-handle'), handle = await prepared(f), before = attempts, writes = f.local.writes
    f.engine.cancelLocal(f.id)
    for (let retry = 0; retry < 2; retry++) await assert.rejects(f.engine.invoke(handle, 'revoked-call'),
      error => error instanceof BodyProducerEngineError && error.code === 'prepared_revoked')
    assert.equal(attempts, before); assert.equal(f.local.writes, writes)
    assert.equal((await f.engine.inspect(f.id))!.checkpoint.producerRequests.length, 0)
  })
  await test('late_response_after_source_revision_is_retained_but_not_published', async () => {
    const f = await fixture('late-source'), handle = await prepared(f), arrival = hold(), before = attempts
    const other = f.buildEngine(createProducerCampaignRepository({ io: f.local.io, clock: () => now }))
    const pending = f.engine.invoke(handle, 'old-source-request')
    await arrival
    const revised = await other.reviseBody(f.id, 3, prefixText + f.text + ' Another current sentence.' + suffixText,
      (await other.inspect(f.id))!.rawHead, 'concurrent-author-revision')
    assert.equal(revised.checkpoint.sourceEpoch, f.source.checkpoint.sourceEpoch + 1)
    release!()
    const result = await pending, state = latest(result)
    assert.equal(attempts - before, 1); assert.equal(state.phase.resolution?.outcome, 'refused'); assert.equal(state.phase.resolution?.reason, 'source_changed')
    assert.equal(result.checkpoint.sourceEpoch, revised.checkpoint.sourceEpoch)
    assert.ok(state.response); assert.equal(state.review, null)
    assert.equal(digest(state.request.prepared.window.text), digest(f.text)); assertConservation(result)
  })
  await test('malformed_empty_and_wrong_meaning_responses_have_distinct_outcomes', async () => {
    const f = await fixture('outcomes'), before = attempts
    scenario = { reply: () => '{ malformed' }
    let result = await f.engine.invoke(await prepared(f), 'malformed'), state = latest(result)
    assert.equal(state.phase.resolution?.outcome, 'refused'); assert.ok(state.response?.text === '{ malformed'); assert.equal(state.review, null)
    scenario = { reply: () => output() }
    result = await f.engine.invoke(await prepared(f), 'empty'); state = latest(result)
    assert.equal(state.phase.resolution?.outcome, 'review_ready'); assert.equal(state.review?.result.responseItemCount, 0)
    assert.equal(state.review?.result.packet.coverage.examinedDeclaration.status, 'not_run')
    assert.equal(state.review?.result.packet.coverage.semanticReview.status, 'not_reviewed')
    scenario = { reply: prompt => output([{ kind: 'world_assertion', statement: 'No silver key exists anywhere in this scene.', polarity: 'affirmed', spans: [span(prompt.window.text)], subjects: [] }]) }
    result = await f.engine.invoke(await prepared(f), 'wrong-meaning'); state = latest(result)
    assert.equal(state.review?.result.compiledClaimCount, 1)
    assert.ok(state.review?.result.packet.claims[0]!.statement === 'No silver key exists anywhere in this scene.')
    assert.equal(state.review?.result.packet.coverage.semanticReview.status, 'not_reviewed')
    assert.equal(state.review?.result.packet.coverage.semanticAdjudication, 'not_run')
    assert.equal(attempts - before, 3); assertConservation(result)
  })
  await test('unmapped_and_out_of_scope_inventory_survives_full_vertical', async () => {
    const f = await fixture('inventory')
    scenario = { reply: prompt => {
      const text = prompt.window.text as string, label = text.slice(0, text.indexOf(' '))
      return output([{ ...narrator(text), subjects: [{ spanIndex: 1, label, planningReference: null, role: 'holder' }] },
        { kind: 'unresolved', reason: 'setup_payoff_out_of_scope', intendedKind: 'setup_payoff', explanation: 'The earlier setup premise is outside this input.', spans: [span(text)], subjects: [] }], true)
    } }
    const result = await f.engine.invoke(await prepared(f), 'inventory-call'), state = latest(result), review = state.review!.result
    assert.equal(review.responseItemCount, 2); assert.equal(review.compiledClaimCount, 1); assert.equal(review.unresolvedObservationCount, 3)
    assert.deepEqual(review.inventory.unresolved.map(item => item.reason), ['unmapped_subject', 'setup_payoff_out_of_scope', 'output_capacity'])
    assert.equal(review.packet.inventory.unresolvedObservationCount, 3); assert.equal(review.packet.inventory.digest, review.inventoryDigest)
    assert.equal(review.packet.inventory.scope, 'standalone_subset_only'); assert.equal(review.inventory.semanticCompleteness, 'not_assessed')
    assert.equal(review.requestInterval.suppliedUtf16Units, f.text.length); assertConservation(result)
  })
  await test('selected_planning_closure_is_the_only_disclosed_catalog', async () => {
    scenario = {}; const f = await fixture('disclosure'), prefix = await deriveBodyEvidencePrefixFromSource(f.source.source, 3)
    const record = prefix.canon.records.find(row => row.recordKind === 'world_fact')!
    const handle = await f.engine.prepare(f.id, { ...f.selection, planningRefs: [{ artifact: record.artifact, recordKind: record.recordKind, recordId: record.recordId }] }, 'bounded-sdk-v1')
    assert.ok(handle.prepared.catalog.length > 0 && handle.prepared.catalog.length < prefix.canon.records.length)
    await f.engine.invoke(handle, 'selected-closure')
    const prompt = calls.at(-1)!.prompt
    assert.deepEqual(Object.keys(prompt).sort(), ['language', 'outputSchema', 'planningCatalog', 'promptVersion', 'protocol', 'window'])
    assert.equal(digest(prompt.planningCatalog), digest(handle.prepared.catalog.map(row => ({ token: row.token, recordKind: row.identity.recordKind, value: row.value }))))
    assert.ok(!canonicalStringify(prompt).includes(prefixText) && !canonicalStringify(prompt).includes(suffixText))
  })
  await test('unknown_after_intent_survives_reload_recovery_and_new_explicit_call', async () => {
    scenario = { status: 503 }; const f = await fixture('unknown'), before = attempts
    let result = await f.engine.invoke(await prepared(f), 'uncertain-call'), state = latest(result)
    assert.equal(attempts - before, 1); assert.equal(state.phase.status, 'outcome_unknown'); assert.equal(state.response, null)
    const unknownRequestId = state.row.id, outstanding = decodeStorageBytes(result.checkpoint.storage.outstandingBytes), budget = { ...result.checkpoint.budget }
    assert.ok(outstanding > 0)
    const reopened = f.buildEngine(), writes = f.local.writes
    const recovered = await reopened.recover(f.id, unknownRequestId)
    assert.equal(recovered.rawHead, result.rawHead); assert.deepEqual(recovered.checkpoint.budget, budget)
    assert.equal(decodeStorageBytes(recovered.checkpoint.storage.outstandingBytes), outstanding); assert.equal(f.local.writes, writes); assert.equal(attempts - before, 1)
    scenario = {}
    result = await reopened.invoke(await prepared(f, reopened), 'separately-authorized-call'); state = latest(result)
    assert.equal(state.phase.resolution?.outcome, 'review_ready'); assert.equal(attempts - before, 2)
    const oldRow = result.checkpoint.producerRequests.find(row => row.id === unknownRequestId)!
    assert.equal(result.phases.get(oldRow.phaseHash)?.status, 'outcome_unknown')
    assert.equal(result.checkpoint.budget.attempts, budget.attempts + 1)
    assert.equal(decodeStorageBytes(result.checkpoint.storage.outstandingBytes), outstanding); assertConservation(result)
  })
  await test('local_cancel_after_dispatch_becomes_unknown_without_replay', async () => {
    const f = await fixture('cancel'), handle = await prepared(f), arrival = hold(), before = attempts
    const pending = f.engine.invoke(handle, 'cancelled-call')
    await arrival; f.engine.cancelLocal(f.id)
    const result = await pending; release!()
    assert.equal(latest(result).phase.status, 'outcome_unknown'); assert.equal(attempts - before, 1)
    const reloaded = f.buildEngine()
    await reloaded.recover(f.id, latest(result).row.id)
    assert.equal(attempts - before, 1); assertConservation(result)
  })
  await test('durable_cancel_during_dispatch_preserves_unknown_and_reservation', async () => {
    const f = await fixture('durable-cancel'), handle = await prepared(f), arrival = hold(), before = attempts
    const pending = f.engine.invoke(handle, 'durable-cancel-call')
    await arrival
    const cancellation = f.engine.cancel(f.id, 'author-final-cancel')
    const outcomes = await Promise.allSettled([pending, cancellation])
    release!()
    assert.equal(outcomes[1]!.status, 'fulfilled', 'Explicit cancellation must have a durable result')
    assert.equal(outcomes[0]!.status, 'fulfilled', 'Cancellation joins the winning control rather than masking recovery with operation_in_progress')
    const reopened = f.buildEngine(), snapshot = await reopened.inspect(f.id)
    assert.ok(snapshot); assert.equal(snapshot.checkpoint.status, 'cancelled')
    const state = latest(snapshot)
    assert.equal(state.phase.status, 'outcome_unknown'); assert.ok(state.phase.intentHash)
    const outstanding = decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes)
    assert.ok(outstanding > 0)
    const recovered = await reopened.recover(f.id, state.row.id)
    assert.equal(latest(recovered).phase.status, 'outcome_unknown'); assert.equal(recovered.checkpoint.status, 'cancelled')
    assert.ok(decodeStorageBytes(recovered.checkpoint.storage.outstandingBytes) > 0)
    assert.equal(recovered.checkpoint.budget.attempts, snapshot.checkpoint.budget.attempts)
    assert.equal(attempts - before, 1); assertConservation(recovered)
  })
  assert.equal(serverFailures, 0); assert.equal(unhandled.length, 0)
  assert.ok(![...storage.values()].some(value => Object.values(sourceBodies).some(text => value.includes(text))), 'No body window is stored in billing/settings')
  console.log(JSON.stringify({ protocol: 'body-producer-engine-controls-v1', passed: cases.length, cases, loopbackRequests: calls.length,
    externalRequests: 0, sourceAdmission: 'real author body-revision action', path: 'engine → SDK loopback → durable response → shared compiler',
    quality: 'synthetic controls only; no semantic or live-readiness pass' }, null, 2))
} finally {
  globalThis.fetch = originalFetch; process.removeListener('unhandledRejection', onUnhandled)
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
}
