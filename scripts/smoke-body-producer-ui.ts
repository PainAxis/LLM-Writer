/** Presentation/ownership checks plus a real injected-IO adoption/revision path. No transport; native UI is CI-only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { useBodyProducer } from '../src/composables/useBodyProducer'
import { bodyProducerEngineKey } from '../src/composables/bodyProducerHost'
import type { BodyProducerEngine, BodyProducerIdentity, BodyProducerRequest, BodyProducerReview, BodyProducerVerificationEvent, PreparedBodyProducerHandle, ProducerCampaignSnapshot } from '../src/types/bodyProducer'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createProducerCampaignRepository } from '../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine } from '../src/services/writerCampaign/bodyProducerEngine'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import { bodyEvidenceSourceView } from '../src/services/writerCampaign/bodyEvidence'
import { compileProducedBodyEvidence, prepareBodyProducerInput } from '../src/services/writerCampaign/bodyProducerEvidence'
import { decodeStorageBytes, hashText } from '../src/services/writerCampaign/protocol'

const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64), campaignId = 'producer-ui-local'
const runtime = { runtimeIdentity: 'producer-ui-test', source: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }
const identity: BodyProducerIdentity = { adapterId: 'ui-control', adapterVersion: 'ui-v1', mode: 'offline_control', requestedModelId: 'synthetic', effectiveModelId: 'synthetic', configurationRevision: 'config-1', endpointIdentity: 'local-synthetic-only' }
const cases: string[] = [], views: ReturnType<typeof useBodyProducer>[] = []
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); await Vue.nextTick() }
const disk = new Map<string, string>()
const io: CampaignRepositoryIO = {
  async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
  async compareAndSwapMany(entries, canCommit = () => true) { if (!canCommit() || entries.some(row => (disk.get(row.key) ?? null) !== row.expectedValue)) return false; for (const row of entries) disk.set(row.key, row.value); return true },
}
const repository = createCampaignRepository(io)
const legacyEngine = createOfflineCampaignEngine({ repository, identity: runtime })
let legacy = await legacyEngine.prepareBodyEvidence({ campaignId, language: 'en' })
for (let i = 0; i < 9; i++) legacy = await legacyEngine.step(campaignId, `ui-seed-${i}`)
assert.equal(legacy.head.status, 'completed')
function seed(): ProducerCampaignSnapshot {
  return {
    manifest: { schemaVersion: 3, protocolVersion: 'campaign-v3', campaignId, adoptedRawHead: legacy.rawHead, adoptedManifestHash: legacy.manifest.hash,
      ...runtime, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, policy: { protocol: 'body-producer-policy-v1', requestLimit: 8, openLimit: 1, liveEnabled: false, retention: 'local_campaign_lifetime_no_automatic_deletion' }, hash },
    head: { schemaVersion: 3, protocolVersion: 'campaign-v3-head', campaignId, manifestHash: hash, sequence: 40, checkpointHash: hash, receiptId: 'ui-adopt', executionEpoch: 1, status: 'active' },
    checkpoint: { schemaVersion: 3, protocolVersion: 'campaign-v3-checkpoint', campaignId, manifestHash: hash, sequence: 40, previousHash: legacy.checkpoint.hash, operationId: 'ui-adopt',
      status: 'active', executionEpoch: 1, sourceEpoch: 0, candidateId: legacy.checkpoint.candidateId, tasks: structuredClone(legacy.checkpoint.tasks), bodyCharacters: legacy.checkpoint.bodyCharacters,
      producerRequests: [], budget: { ...legacy.checkpoint.budget }, storage: structuredClone(legacy.checkpoint.storage), lastWallTime: Date.now(), hash },
    receipt: { schemaVersion: 3, protocolVersion: 'campaign-v3-receipt', campaignId, operationId: 'ui-adopt', kind: 'adopt', businessDigest: hash, sequence: 40,
      previousHash: legacy.checkpoint.hash, checkpointHash: hash, manifestHash: hash, recovery: false, event: { requestHash: null, phaseHash: null, responseHash: null, reviewHash: null, artifact: null },
      serializedBytes: '0000000000000000', storageEffect: { allocatedBytes: '0000000000000000', consumedBytes: '0000000000000000', releasedBytes: '0000000000000000', source: 'direct', requestId: null }, hash },
    origin: structuredClone(legacy), source: bodyEvidenceSourceView(structuredClone(legacy)), requests: new Map(), phases: new Map(), responses: new Map(), reviews: new Map(), artifacts: new Map(legacy.artifacts), rawHead: 'presentation-only-v3',
  }
}
function fixture(adopted = true, authorized = true) {
  let record: ProducerCampaignSnapshot | null = adopted ? seed() : null
  const calls = { inspect: 0, adopt: 0, revise: 0, prepare: 0, invoke: 0, recover: 0, cancel: 0, stop: 0 }
  const inspectGates: Array<Promise<ProducerCampaignSnapshot | null>> = [], prepareGates: Array<Promise<PreparedBodyProducerHandle>> = [], invokeGates: Array<Promise<void>> = []
  let lastHandle: PreparedBodyProducerHandle | null = null, command = '', revisionText = '', sequence = 0
  const engine: BodyProducerEngine = {
    async inspect(id) { calls.inspect++; return inspectGates.shift() ?? (id === campaignId ? record : null) },
    async adopt() { calls.adopt++; record = seed(); return record },
    async reviseBody(_id, _ordinal, text, expectedRawHead) {
      assert.equal(expectedRawHead, record!.rawHead, 'The preview must carry the exact displayed source head')
      calls.revise++; revisionText = text; const next = structuredClone(record!); next.checkpoint.sourceEpoch++; record = next; return next
    },
    async prepare(_id, selection, producerId) {
      calls.prepare++; assert.equal(producerId, identity.adapterId)
      const prepared = await prepareBodyProducerInput(record!.source, selection)
      lastHandle = { id: `handle-${calls.prepare}`, campaignId, sourceEpoch: record!.checkpoint.sourceEpoch, aggregateManifestHash: hash,
        producer: identity, prepared, reservation: { attempts: 1, inputBytes: prepared.inputBytes, inputUtf16: prepared.inputUtf16, outputTokens: 1200, reasoningTokens: 0, responseBytes: 65536, activeMs: 60000, artifacts: 0, operations: 0 }, createdAt: Date.now(), expiresAt: Date.now() + 300_000, invocationAllowed: authorized }
      return prepareGates.shift() ?? lastHandle
    },
    async invoke(handle, operationId = 'ui-invoke') {
      calls.invoke++; command = operationId
      const gate = invokeGates.shift(); if (gate) await gate
      const value = structuredClone(record!), text = handle.prepared.window.text
      const responseText = JSON.stringify({ protocol: 'body-producer-output-v1', items: [
        { kind: 'world_assertion', statement: '<script>wrong meaning remains unreviewed</script>', polarity: 'affirmed', spans: [{ startUtf16: 0, endUtf16: 1, quote: text.slice(0, 1) }], subjects: [{ spanIndex: 1, label: text.slice(0, 1), planningReference: null, role: 'topic' }] },
        { kind: 'unresolved', reason: 'character_change_out_of_scope', intendedKind: 'character_change', explanation: 'Outside-window before state is missing.', spans: [{ startUtf16: 0, endUtf16: 1, quote: text.slice(0, 1) }], subjects: [] },
      ], saturated: true, examination: { status: 'not_declared', intervals: [] } })
      const requestId = 'request-ui', request: BodyProducerRequest = { schemaVersion: 1, protocol: 'body-producer-request-v1', campaignId, id: requestId, operationId,
        aggregateManifestHash: hash, sourceEpoch: value.checkpoint.sourceEpoch, prepared: handle.prepared, producer: identity,
        reservation: { ...handle.reservation }, createdAt: Date.now(), expiresAt: Date.now() + 300_000, hash }
      const result = await compileProducedBodyEvidence(value.source, handle.prepared, responseText, {
        requestId, requestHash: hash, responseHash: otherHash, intentHash: hash, aggregateManifestHash: hash, sourceEpoch: value.checkpoint.sourceEpoch,
        producer: identity, reportedModelId: 'provider-asserted-only',
      })
      const review: BodyProducerReview = { schemaVersion: 1, protocol: 'body-producer-review-v1', campaignId, requestId, requestHash: hash, responseHash: otherHash, result, hash: otherHash }
      value.requests.set(hash, request); value.reviews.set(otherHash, review)
      value.phases.set(hash, { schemaVersion: 1, protocol: 'body-producer-phase-v1', campaignId, requestId, requestHash: hash, revision: 3, parentHash: otherHash, status: 'resolved',
        intentHash: hash, responseHash: otherHash, resolution: { outcome: 'review_ready', reason: null, reviewHash: otherHash }, reason: null, hash })
      value.checkpoint.producerRequests = [{ id: requestId, requestHash: hash, phaseHash: hash, phaseRevision: 3 }]
      record = value; return value
    },
    async recover() { calls.recover++; return record! },
    async cancel() { calls.cancel++; record = structuredClone(record!); record.checkpoint.status = 'cancelled'; return record },
    cancelLocal() { calls.stop++ }, availableProducers() { return [identity] },
  }
  const versions: Array<3 | null> = []
  const ui = useBodyProducer({ engine, legacySnapshot: () => legacy, operationId: () => `ui-command-${++sequence}`, onVersion: version => versions.push(version) }); views.push(ui)
  return { ui, engine, calls, versions, current: () => record, setRecord(value: ProducerCampaignSnapshot | null) { record = value },
    lastHandle: () => lastHandle!, command: () => command, revisionText: () => revisionText,
    holdInspect() { const gate = deferred<ProducerCampaignSnapshot | null>(); inspectGates.push(gate.promise); return gate },
    holdPrepare() { const gate = deferred<PreparedBodyProducerHandle>(); prepareGates.push(gate.promise); return gate },
    holdInvoke() { const gate = deferred<void>(); invokeGates.push(gate.promise); return gate },
    async ready() { assert.equal(await ui.select(campaignId), true) },
  }
}
async function test(id: string, action: () => Promise<void>) { await action(); cases.push(id); console.log(`PASS ${id}`) }
async function renderPanel(ui: ReturnType<typeof useBodyProducer>) {
  const source = fs.readFileSync(new URL('../src/components/ProducerLabPanel.vue', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(compileScript(parse(source).descriptor, { id: 'body-producer-panel', inlineTemplate: true }).content,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', compiled)((id: string) => {
    if (id === 'vue') return Vue
    if (id === '@/composables/useBodyProducer') return { useBodyProducer: () => ({ ...ui, select: async () => true }) }
    if (id === '@/services/writerCampaign/protocol') return { decodeStorageBytes }
    throw new Error(`unexpected_ui_import:${id}`)
  }, exports)
  return renderToString(Vue.createSSRApp(exports.default!, { campaignId }))
}
/** Gate actual repository IO after a real session progress event, never synthesize progress or source. */
function verificationFixture(mode: 'before_io' | 'after_io') {
  const localDisk = new Map(disk), entered = deferred<void>(), release = deferred<void>()
  const events: BodyProducerVerificationEvent[] = [], listeners: Array<(event: BodyProducerVerificationEvent) => void> = []
  let progressSeen = false, held = false
  const localIo: CampaignRepositoryIO = {
    async getMany(keys) {
      const pause = progressSeen && !held
      if (pause) held = true
      if (pause && mode === 'before_io') { entered.resolve(); await release.promise }
      const rows = new Map(keys.map(key => [key, localDisk.get(key) ?? null]))
      if (pause && mode === 'after_io') { entered.resolve(); await release.promise }
      return rows
    },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(row => (localDisk.get(row.key) ?? null) !== row.expectedValue)) return false
      for (const row of entries) localDisk.set(row.key, row.value)
      return true
    },
  }
  const engine = createBodyProducerEngine({ repository: createProducerCampaignRepository({ io: localIo }), identity: runtime })
  assert.equal(typeof engine.subscribeVerification, 'function', 'Production engine supplies real verification events')
  const subscribe = engine.subscribeVerification!.bind(engine)
  const stop = subscribe(event => {
    events.push(structuredClone(event))
    if (event.status === 'progress' && event.progress && event.progress.verifiedOperations >= 8) progressSeen = true
  })
  engine.subscribeVerification = listener => { listeners.push(listener); return subscribe(listener) }
  const ui = useBodyProducer({ engine }); views.push(ui)
  const waitHolding = (operation: Promise<boolean>) => Promise.race([entered.promise, operation.then(() => { throw new Error('verification_finished_without_real_progress_hold') })])
  return { ui, engine, events, listeners, localDisk, release: () => release.resolve(), waitHolding, stop }
}
try {
  await test('app_scoped_injection_is_explicit_and_default_stays_unconfigured', async () => {
    const injected = fixture(), explicit = fixture()
    explicit.engine.availableProducers = () => [{ ...identity, adapterId: 'explicit-host-control' }]
    async function resolveInSetup(host?: BodyProducerEngine, override?: BodyProducerEngine) {
      let ui!: ReturnType<typeof useBodyProducer>
      const app = Vue.createSSRApp({ setup() { ui = useBodyProducer({ engine: override }); views.push(ui); return () => Vue.h('main') } })
      if (host) app.provide(bodyProducerEngineKey, host)
      await renderToString(app)
      return ui
    }
    const supplied = await resolveInSetup(injected.engine)
    assert.equal(supplied.producers.value[0]!.adapterId, identity.adapterId)
    const overridden = await resolveInSetup(injected.engine, explicit.engine)
    assert.equal(overridden.producers.value[0]!.adapterId, 'explicit-host-control')
    assert.equal(injected.calls.inspect + injected.calls.prepare + injected.calls.invoke, 0)
    assert.equal(explicit.calls.inspect + explicit.calls.prepare + explicit.calls.invoke, 0)
    // Supply only the build-time identity required by the real default factory;
    // no transport registry or authorization is installed in this test process.
    const key = '__WRITER_CAMPAIGN_BUILD_IDENTITY__', previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value: { ...runtime, runtimeIdentity: `campaign-core-sha256:${hash}` } })
    try {
      const normal = await resolveInSetup()
      const outsideSetup = useBodyProducer(); views.push(outsideSetup)
      for (const ui of [normal, outsideSetup]) {
        assert.equal(ui.producers.value.length, 1)
        assert.equal(ui.producers.value[0]!.effectiveModelId, 'unconfigured')
        assert.equal(ui.producers.value[0]!.endpointIdentity, 'not-configured')
        assert.equal(ui.canInvoke.value, false); assert.equal(await ui.invoke(), false)
      }
    } finally { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key) }
  })
  await test('no_automatic_adoption_or_dispatch', async () => {
    const f = fixture(false); assert.equal(f.calls.inspect + f.calls.adopt + f.calls.invoke, 0)
    await f.ready(); assert.equal(f.ui.canAdopt.value, true); assert.equal(f.calls.adopt + f.calls.invoke, 0)
    assert.equal(await f.ui.adopt(), true); assert.equal(f.calls.adopt, 1); assert.equal(f.calls.invoke, 0); assert.equal(f.versions.at(-1), 3)
    await f.ui.refresh(); assert.equal(f.calls.invoke, 0)
  })
  await test('prepare_actual_selection_with_no_default_plan_disclosure', async () => {
    const f = fixture(); await f.ready(); assert.ok(f.ui.planningChoices.value.length)
    assert.equal(f.ui.selectedPlanningKeys.value.length, 0); assert.equal(f.ui.setWindow(1, 8), true); assert.equal(await f.ui.prepare(), true)
    assert.equal(f.ui.prepared.value!.prepared.window.text, f.ui.selectedText.value.slice(1, 8))
    assert.equal(f.ui.prepared.value!.prepared.catalog.length, 0); assert.equal(f.calls.invoke, 0)
  })
  for (const change of ['window', 'producer', 'planning', 'chapter', 'revision', 'refresh'] as const) await test(`input_change_revokes_handle_${change}`, async () => {
    const f = fixture(); await f.ready(); await f.ui.prepare(); assert.ok(f.ui.prepared.value); const stopped = f.calls.stop
    if (change === 'window') f.ui.setWindow(1, 5)
    if (change === 'producer') f.ui.setProducer(identity.adapterId)
    if (change === 'planning') f.ui.setPlanning([])
    if (change === 'chapter') f.ui.setChapter(2)
    if (change === 'revision') f.ui.setRevisionText('Explicitly replaced body revision input.')
    if (change === 'refresh') await f.ui.refresh()
    assert.equal(f.ui.prepared.value, null); assert.equal(await f.ui.invoke(), false); assert.equal(f.calls.invoke, 0)
    assert.ok(f.calls.stop > stopped, 'Input replacement revokes engine ownership, not only the visible button')
  })
  await test('unconfigured_handle_cannot_invoke', async () => {
    const f = fixture(true, false); await f.ready(); await f.ui.prepare()
    assert.equal(f.ui.canInvoke.value, false); assert.equal(await f.ui.invoke(), false); assert.equal(f.calls.invoke, 0)
  })
  await test('duplicate_clicks_join_one_operation_and_unresolved_review', async () => {
    const f = fixture(); await f.ready(); await f.ui.prepare(); const gate = f.holdInvoke(), stopped = f.calls.stop
    const first = f.ui.invoke(), second = f.ui.invoke(); assert.equal(first, second); assert.equal(f.calls.invoke, 1)
    gate.resolve(); assert.equal(await first, true); assert.ok(f.command()); assert.equal(f.ui.prepared.value, null)
    assert.ok(f.ui.currentReview.value!.result.unresolvedObservationCount >= 3)
    assert.equal(f.ui.currentReview.value!.result.packet.coverage.semanticReview.status, 'not_reviewed')
    assert.equal(f.ui.currentReview.value!.result.packet.coverage.examinedDeclaration.status, 'not_run')
    assert.equal(f.calls.stop, stopped, 'Publishing the current invocation must not revoke its engine ownership')
    assert.equal(await f.ui.invoke(), false); assert.equal(f.calls.invoke, 1)
    await f.ui.refresh(); assert.equal(f.ui.currentReview.value, null)
    assert.equal(await f.ui.recover('request-ui'), true); assert.equal(f.calls.recover, 1); assert.equal(f.calls.invoke, 1)
  })
  await test('late_invocation_cannot_restore_cancelled_owner', async () => {
    const f = fixture(); await f.ready(); await f.ui.prepare(); const gate = f.holdInvoke(), pending = f.ui.invoke()
    f.ui.cancelLocal(); gate.resolve(); assert.equal(await pending, false); assert.equal(f.ui.currentReview.value, null)
    assert.equal(f.ui.notice.value, 'local_cancelled_outcome_unconfirmed'); assert.ok(f.calls.stop > 0)
  })
  await test('late_prepare_cannot_restore_previous_campaign', async () => {
    const f = fixture(); await f.ready(); const gate = f.holdPrepare(), pending = f.ui.prepare(); await flush()
    await f.ui.select('another-campaign'); gate.resolve(f.lastHandle()); assert.equal(await pending, false)
    assert.equal(f.ui.prepared.value, null); assert.equal(f.ui.snapshot.value, null)
  })
  await test('late_read_cannot_restore_previous_campaign', async () => {
    const f = fixture(); await f.ready(); const gate = f.holdInspect(), pending = f.ui.refresh()
    await f.ui.select('another-campaign'); gate.resolve(seed()); assert.equal(await pending, false); assert.equal(f.ui.snapshot.value, null)
  })
  await test('manual_revision_requires_current_exact_preview', async () => {
    const f = fixture(); await f.ready(); const text = 'A dynamic body, not a fixed fixture. 😀'
    assert.equal(f.ui.setRevisionText(text), true); assert.equal(await f.ui.commitRevision(), false)
    assert.equal(await f.ui.previewRevision(), true); assert.equal(f.ui.revisionPreview.value!.hash, await hashText(text))
    assert.equal(f.ui.revisionPreview.value!.expectedRawHead, f.current()!.rawHead)
    assert.deepEqual(f.ui.revisionPreview.value!.invalidatedChapters, [2, 3])
    f.ui.setRevisionText(`${text}!`); assert.equal(f.ui.revisionPreview.value, null); assert.equal(await f.ui.commitRevision(), false)
    await f.ui.previewRevision(); assert.equal(await f.ui.commitRevision(), true); assert.equal(f.revisionText(), `${text}!`)
    assert.equal(f.calls.revise, 1); assert.equal(f.calls.invoke, 0)
  })
  await test('oversized_and_invalid_revision_not_retained', async () => {
    const f = fixture(); await f.ready(); const old = f.ui.revisionText.value
    assert.equal(f.ui.setRevisionText('x'.repeat(65_537)), false); assert.equal(f.ui.revisionText.value, old)
    assert.equal(f.ui.setRevisionText('\ud800'), false); assert.equal(f.ui.revisionText.value, old); assert.equal(f.calls.revise, 0)
  })
  await test('dispose_discards_late_invocation', async () => {
    const f = fixture(); await f.ready(); await f.ui.prepare(); const gate = f.holdInvoke(), pending = f.ui.invoke()
    f.ui.dispose(); gate.resolve(); assert.equal(await pending, false); assert.equal(f.ui.currentReview.value, null)
  })
  await test('source_refresh_invalidates_old_handle_and_review', async () => {
    const f = fixture(); await f.ready(); await f.ui.prepare(); await f.ui.invoke(); assert.ok(f.ui.currentReview.value)
    const newer = structuredClone(f.current()!); newer.checkpoint.sourceEpoch++; f.setRecord(newer)
    await f.ui.refresh(); assert.equal(f.ui.currentReview.value, null); assert.equal(f.ui.requestRows.value[0]!.stale, true)
    await f.ui.recover('request-ui'); assert.equal(f.ui.currentReview.value, null)
  })
  await test('reserved_or_unknown_recovery_is_local_and_adopted_version_cannot_regress', async () => {
    const f = fixture(); await f.ready(); await f.ui.prepare(); await f.ui.invoke()
    const value = structuredClone(f.current()!), phase = value.phases.get(hash)!
    phase.status = 'reserved'; phase.responseHash = null; phase.resolution = null; f.setRecord(value)
    await f.ui.refresh(); assert.equal(f.ui.requestRows.value[0]!.canRecover, true)
    assert.equal(await f.ui.recover('request-ui'), true); assert.equal(f.calls.invoke, 1)
    const gate = f.holdInspect(), pending = f.ui.refresh(); gate.reject(new Error('storage unavailable'))
    assert.equal(await pending, false); assert.equal(f.versions.at(-1), 3); assert.equal(f.ui.canAdopt.value, false)
  })
  await test('private_error_messages_never_enter_ui', async () => {
    const f = fixture(); await f.ready(); const gate = f.holdInspect(), pending = f.ui.refresh()
    gate.reject(new Error('private credential and source text')); assert.equal(await pending, false)
    assert.equal(f.ui.error.value, 'operation_unconfirmed'); assert.doesNotMatch(f.ui.error.value, /credential|source text/)
  })
  await test('revocation_recovery_and_bounded_verification_have_safe_explicit_codes', async () => {
    const f = fixture(); await f.ready()
    for (const code of ['prepared_revoked', 'recovery_pending', 'operation_timeout', 'verification_capacity', 'verification_quantum_exceeded']) {
      const gate = f.holdInspect(), pending = f.ui.refresh()
      gate.reject({ code, message: 'Private provider detail must not appear.' })
      assert.equal(await pending, false); assert.equal(f.ui.error.value, code)
    }
  })
  await test('actual_sfc_escaped_readonly_supported_and_unresolved_presentation', async () => {
    const f = fixture(); await f.ready(); await f.ui.prepare(); await f.ui.invoke()
    const html = await renderPanel(f.ui)
    for (const marker of ['body-producer-claims', 'body-producer-unresolved', 'body-producer-review-counts', 'body-producer-semantic-boundary']) assert.ok(html.includes(marker))
    assert.match(html, /character_change_out_of_scope/); assert.match(html, /output_capacity/); assert.match(html, /unmapped_topic/)
    assert.match(html, /&lt;script&gt;wrong meaning/); assert.doesNotMatch(html, /<script>wrong meaning/)
    assert.match(html, /not_reviewed/); assert.match(html, /not_assessed/)
    assert.doesNotMatch(html, /data-testid="(?:accept-to-canon|apply-writer|confirm-claim)"/)
    assert.equal(f.calls.invoke, 1)
  })
  await test('actual_engine_adoption_revision_and_unconfigured_preparation', async () => {
    const engine = createBodyProducerEngine({ repository: createProducerCampaignRepository({ io }), identity: runtime })
    const ui = useBodyProducer({ engine, legacySnapshot: () => legacy }); views.push(ui)
    assert.equal(await ui.select(campaignId), true, 'Opening an eligible v2 source is not an operation failure')
    assert.equal(ui.canAdopt.value, true); assert.equal(await ui.adopt(), true)
    assert.equal(ui.snapshot.value!.manifest.schemaVersion, 3); assert.equal(ui.setChapter(3), true)
    const text = 'Arbitrary current body input: the glass lever is cold. 😀'
    assert.equal(ui.setRevisionText(text), true); assert.equal(await ui.previewRevision(), true); assert.equal(await ui.commitRevision(), true)
    assert.equal(ui.selectedText.value, text); assert.equal(ui.setWindow(0, text.length), true)
    const before = [...disk], attempts = ui.snapshot.value!.checkpoint.budget.attempts
    assert.equal(await ui.prepare(), true); assert.equal(ui.prepared.value!.prepared.window.text, text)
    assert.equal(ui.prepared.value!.prepared.catalog.length, 0); assert.equal(ui.prepared.value!.invocationAllowed, false)
    assert.equal(await ui.invoke(), false); assert.deepEqual([...disk], before); assert.equal(ui.snapshot.value!.checkpoint.budget.attempts, attempts)
    assert.equal(ui.requestRows.value.length, 0)
    for (const change of ['window', 'producer', 'planning', 'chapter', 'revision', 'refresh', 'prepare'] as const) {
      assert.equal(await ui.prepare(), true)
      const captured = ui.prepared.value!
      if (change === 'window') assert.equal(ui.setWindow(1, 5), true)
      if (change === 'producer') assert.equal(ui.setProducer(ui.producerId.value), true)
      if (change === 'planning') assert.equal(ui.setPlanning([]), true)
      if (change === 'chapter') assert.equal(ui.setChapter(2), true)
      if (change === 'revision') assert.equal(ui.setRevisionText('A pending manual edit changes the disclosed input.'), true)
      if (change === 'refresh') assert.equal(await ui.refresh(), true)
      if (change === 'prepare') assert.equal(await ui.prepare(), true)
      // Simulate an already queued handler holding the opaque capability, not
      // the composable's now-cleared ref. The real engine rejects before I/O.
      await assert.rejects(engine.invoke(captured, `stale-ui-${change}`), { code: 'prepared_revoked' })
      assert.deepEqual([...disk], before, `Revoking ${change} performs no durable write`)
    }
    assert.equal(ui.snapshot.value!.checkpoint.budget.attempts, attempts)
  })
  await test('actual_engine_revision_preview_refuses_two_tab_source_replacement', async () => {
    const engine = createBodyProducerEngine({ repository: createProducerCampaignRepository({ io }), identity: runtime })
    const other = createBodyProducerEngine({ repository: createProducerCampaignRepository({ io }), identity: runtime })
    const ui = useBodyProducer({ engine }); views.push(ui)
    assert.equal(await ui.select(campaignId), true); assert.equal(ui.setChapter(3), true)
    const draftA = 'The first tab previews this edit against exactly the displayed body.'
    assert.equal(ui.setRevisionText(draftA), true); assert.equal(await ui.previewRevision(), true)
    const previewHead = ui.revisionPreview.value!.expectedRawHead
    const secondBefore = (await other.inspect(campaignId))!
    assert.equal(secondBefore.rawHead, previewHead)
    const draftB = 'The second tab has now committed a different body.'
    const secondAfter = await other.reviseBody(campaignId, 3, draftB, secondBefore.rawHead, 'ui-other-tab-revision')
    assert.notEqual(secondAfter.rawHead, previewHead)
    const afterB = [...disk]
    assert.equal(await ui.commitRevision(), false); assert.equal(ui.error.value, 'source_changed')
    assert.deepEqual([...disk], afterB, 'A stale preview cannot overwrite B or append any durable record')
    assert.equal((await other.inspect(campaignId))!.rawHead, secondAfter.rawHead)
    assert.equal(ui.revisionPreview.value, null)
    assert.equal(await ui.refresh(), true); assert.equal(ui.selectedText.value, draftB)
    assert.equal(ui.setRevisionText(draftA), true); assert.equal(await ui.previewRevision(), true)
    assert.equal(ui.revisionPreview.value!.expectedRawHead, secondAfter.rawHead)
    assert.equal(await ui.commitRevision(), true); assert.equal(ui.selectedText.value, draftA)
    assert.notEqual(ui.snapshot.value!.rawHead, secondAfter.rawHead)
    other.cancelLocal()
  })
  for (const mode of ['before_io', 'after_io'] as const) await test(`real_verification_${mode}_progress_cancels_without_partial_readiness`, async () => {
    const f = verificationFixture(mode), before = [...f.localDisk]
    try {
      const pending = f.ui.select(campaignId); await f.waitHolding(pending)
      assert.ok(f.events.some(event => event.status === 'started' && event.progress === null))
      assert.ok(f.events.some(event => event.status === 'progress' && event.progress && event.progress.verifiedOperations >= 8))
      assert.equal(f.ui.verification.value?.status, 'progress'); assert.ok(f.ui.verification.value?.progress)
      assert.equal(f.ui.loading.value, true); assert.equal(f.ui.snapshot.value, null)
      assert.equal(f.ui.canPrepare.value, false); assert.equal(f.ui.canInvoke.value, false)
      assert.equal(f.ui.prepared.value, null); assert.equal(f.ui.currentReview.value, null)
      const html = await renderPanel(f.ui)
      for (const marker of ['body-producer-verification', 'body-producer-verification-phase', 'body-producer-verification-counts', 'body-producer-verification-boundary', 'body-producer-stop-local']) assert.ok(html.includes(marker))
      assert.doesNotMatch(html, /data-testid="body-producer-(?:identity|prepared|source-text|review)"/)
      assert.match(html, /No partial source is ready/)
      const oldListeners = [...f.listeners], oldEvents = structuredClone(f.events)
      f.ui.cancelLocal(); assert.equal(f.ui.verification.value, null); assert.equal(f.ui.loading.value, false)
      f.release(); assert.equal(await pending, false); await flush()
      for (const listener of oldListeners) for (const event of oldEvents) listener(event)
      assert.equal(f.ui.verification.value, null); assert.equal(f.ui.snapshot.value, null)
      assert.deepEqual([...f.localDisk], before, 'Verification and cancellation make zero durable writes')
      assert.equal(await f.ui.refresh(), true); assert.equal(f.ui.verification.value, null)
      assert.ok(f.ui.snapshot.value); assert.equal(f.ui.prepared.value, null)
      assert.equal(f.ui.producers.value[0]!.effectiveModelId, 'unconfigured')
      assert.equal(await f.ui.prepare(), true); assert.equal(f.ui.prepared.value!.invocationAllowed, false)
      assert.equal(await f.ui.invoke(), false); assert.deepEqual([...f.localDisk], before)
    } finally { f.release(); f.ui.dispose(); f.stop() }
  })
  await test('real_verification_navigation_and_reopen_discard_progress_and_late_events', async () => {
    const f = verificationFixture('after_io'), before = [...f.localDisk]
    try {
      const pending = f.ui.select(campaignId); await f.waitHolding(pending)
      const oldListeners = [...f.listeners], oldEvents = structuredClone(f.events)
      const navigated = f.ui.select('another-campaign'); f.release()
      assert.equal(await pending, false); assert.equal(await navigated, true)
      for (const listener of oldListeners) for (const event of oldEvents) listener(event)
      assert.equal(f.ui.verification.value, null); assert.equal(f.ui.snapshot.value, null)
      f.ui.dispose()
      const reopened = useBodyProducer({ engine: f.engine }); views.push(reopened)
      assert.equal(reopened.verification.value, null); assert.equal(reopened.snapshot.value, null)
      assert.equal(await reopened.select(campaignId), true); assert.equal(reopened.verification.value, null)
      assert.ok(reopened.snapshot.value); assert.equal(reopened.prepared.value, null); assert.equal(reopened.currentReview.value, null)
      for (const listener of oldListeners) for (const event of oldEvents) listener(event)
      assert.equal(reopened.verification.value, null); assert.deepEqual([...f.localDisk], before)
    } finally { f.release(); f.ui.dispose(); f.stop() }
  })
  await test('real_verification_completion_alone_does_not_publish_action_readiness', async () => {
    const f = verificationFixture('before_io'), returned = deferred<void>(), publish = deferred<void>()
    const inspect = f.engine.inspect.bind(f.engine)
    f.engine.inspect = async id => { const value = await inspect(id); returned.resolve(); await publish.promise; return value }
    try {
      const pending = f.ui.select(campaignId); await f.waitHolding(pending); f.release(); await returned.promise
      assert.ok(f.events.some(event => event.status === 'completed'))
      assert.equal(f.ui.verification.value, null); assert.equal(f.ui.loading.value, true)
      assert.equal(f.ui.snapshot.value, null); assert.equal(f.ui.canPrepare.value, false)
      publish.resolve(); assert.equal(await pending, true); assert.ok(f.ui.snapshot.value)
      assert.equal(f.ui.prepared.value, null); assert.equal(f.ui.currentReview.value, null)
    } finally { f.release(); publish.resolve(); f.ui.dispose(); f.stop() }
  })
  console.log(JSON.stringify({ protocol: 'body-producer-ui-smoke-v1', cases: cases.length, passed: true, nativeUi: 'not_run_ci_only', casesPassed: cases }))
} finally { for (const ui of views) ui.dispose(); legacyEngine.stopLocal() }
