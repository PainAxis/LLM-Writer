/** Presentation/ownership smoke only. Fake engines below never count as SDK,
 * native persistence, actual-App, or literary acceptance. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import type { Page } from '@playwright/test'
import { waitForCreativeIoState } from './lib/creative-pilot-browser'
import { useCreativePilotLab, type createCreativePilotLegacyRouter } from '../src/composables/useCreativePilotLab'
import * as Hosts from '../src/composables/creativePilotHost'
import { creativePilotRepositoryKey } from '../src/composables/creativePilotHost'
import { createCreativePilotEngine } from '../src/services/writerCampaign/creativePilotEngine'
import { createCreativePilotRepository } from '../src/services/writerCampaign/creativePilotStore'
import { compileCreativeInput } from '../src/services/writerCampaign/creativePilotContext'
import * as Protocol from '../src/services/writerCampaign/protocol'
import { campaignKeys } from '../src/services/writerCampaign/store'
import type { CreativeArtifact, CreativeBriefV1, CreativeDryPreview, CreativeHeadCommand, CreativePhase, CreativePilotEngine, CreativeProgressEvent, CreativeRequest, CreativeSnapshot } from '../src/types/creativePilot'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'

const campaignId = 'creative-ui-presentation', hash = 'a'.repeat(64), otherHash = 'b'.repeat(64)
const runtime = { runtimeIdentity: `campaign-core-sha256:${hash}`, source: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }
const draft: CreativeBriefV1 = { protocol: 'creative-brief-v1', language: 'en', premise: '  An arbitrary brief.\nKeep its spaces. <script>not executable</script>', constraints: ['Do not normalize this: e\u0301.'] }
const cases: string[] = [], views: ReturnType<typeof useCreativePilotLab>[] = []
let appWaitCases = 0
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function flush() { for (let n = 0; n < 30; n++) await Promise.resolve(); await Vue.nextTick() }
async function test(id: string, action: () => Promise<void>) {
  if (process.argv.includes('--app-waits-only')) return
  if (process.argv.includes('--observer-only') && !id.startsWith('observer_')) return
  await action(); cases.push(id); console.log(`PASS ${id}`)
}
function memory() {
  const rows = new Map<string, string>(); let writes = 0
  const io: CampaignRepositoryIO = {
    async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(row => (rows.get(row.key) ?? null) !== row.expectedValue)) return false
      for (const row of entries) rows.set(row.key, row.value)
      writes++; return true
    },
  }
  return { repository: createCreativePilotRepository({ io }), rows, writes: () => writes }
}
const seedDisk = memory(), seedEngine = createCreativePilotEngine({ repository: seedDisk.repository, identity: runtime })
const seed = await seedEngine.prepare({ campaignId, operationId: 'ui-seed', brief: draft })
seedEngine.dispose()
const seedInput = await compileCreativeInput(seed, 'outline')
function fixture(ready = false, observer?: (event: Readonly<CreativeProgressEvent>) => void) {
  let record = structuredClone(seed), lastCommand: CreativeHeadCommand | null = null
  const calls = { inspect: 0, prepare: 0, dry: 0, replace: 0, start: 0, resume: 0, resolve: 0, cancel: 0, stop: 0, dispose: 0 }
  const id = Vue.ref(campaignId), selected = Vue.ref(ready), externalBusy = Vue.ref(false)
  const reads: Array<Promise<CreativeSnapshot | null>> = [], dry: Array<Promise<CreativeDryPreview>> = [], runs: Array<Promise<CreativeSnapshot>> = [], prepares: Array<Promise<CreativeSnapshot>> = []
  let listener: ((event: Readonly<CreativeProgressEvent>) => void) | null = null
  const engine: CreativePilotEngine = {
    async inspect() { calls.inspect++; return reads.shift() ?? structuredClone(record) },
    async prepare(command) { calls.prepare++; record.candidate.brief = structuredClone(command.brief); return prepares.shift() ?? structuredClone(record) },
    async dryPrepare() { calls.dry++; return dry.shift() ?? { campaignId, rawHead: record.rawHead, candidateHash: record.candidate.hash, prepared: seedInput,
      readiness: 'offline_control_ready', adapter: { mode: 'offline_control', adapterId: 'creative-pilot-sdk-v1', adapterVersion: 'creative-pilot-sdk-v1', requestedModelId: 'synthetic', effectiveModelId: 'synthetic', endpointIdentity: 'http://127.0.0.1:1/v1', configurationRevision: 'presentation-only' } } },
    async replaceBrief(command) { calls.replace++; lastCommand = command; record.candidate.brief = structuredClone(command.brief); record.candidate.hash = otherHash; record.checkpoint.candidateHash = otherHash; record.checkpoint.metadata.replacementUsed = true; record.rawHead = 'presentation-replaced'; return structuredClone(record) },
    async start(command) { calls.start++; lastCommand = command; return runs.shift() ?? structuredClone(record) },
    async resume(command) { calls.resume++; lastCommand = command; return runs.shift() ?? structuredClone(record) },
    async resolveRetained(command) { calls.resolve++; lastCommand = command; return structuredClone(record) },
    async cancel(command) { calls.cancel++; lastCommand = command; record.checkpoint.status = 'cancelled'; return structuredClone(record) },
    stop() { calls.stop++ }, dispose() { calls.dispose++ },
    subscribeProgress(next) { listener = next; return () => { listener = null } },
  }
  const app = Vue.createApp({ render: () => null })
  if (observer) app.provide(Hosts.creativePilotProgressObserverKey, observer)
  const ui = app.runWithContext(() => useCreativePilotLab({ campaignId: id, selectedV4: selected, externalBusy, engine, newId: () => campaignId }))
  views.push(ui)
  return { ui, calls, id, selected, externalBusy, engine, record: () => record, command: () => lastCommand,
    setRecord(value: CreativeSnapshot) { record = value },
    emit(event: Partial<CreativeProgressEvent>) { listener?.({ ownerId: 1, campaignId, kind: 'verifying', taskId: 'outline', attemptsReserved: 0, acceptedTasks: 0, acceptedBodies: 0, bodyCanonicalScalars: 0, ...event }) },
    holdRead() { const gate = deferred<CreativeSnapshot | null>(); reads.push(gate.promise); return gate },
    holdDry() { const gate = deferred<CreativeDryPreview>(); dry.push(gate.promise); return gate },
    holdRun() { const gate = deferred<CreativeSnapshot>(); runs.push(gate.promise); return gate },
    holdPrepare() { const gate = deferred<CreativeSnapshot>(); prepares.push(gate.promise); return gate },
    async ready() { selected.value = true; await flush(); assert.ok(ui.snapshot.value) },
    async grant() { await ui.dryPrepare(); ui.consent.value = true; assert.equal(ui.canStart.value || ui.canResume.value, true) },
  }
}
function withOpen(phaseStatus: CreativePhase['status']): CreativeSnapshot {
  const value = structuredClone(seed), request = { schemaVersion: 1, protocol: 'creative-pilot-request-v1', campaignId, id: 'ui-request', operationId: 'ui-attempt', manifestHash: value.manifest.hash, candidateHash: value.candidate.hash,
    taskId: 'outline', taskRevision: 0, dependencies: [], prepared: seedInput, adapter: null, invocationId: 'ui-run', reservation: value.checkpoint.budget, createdAt: Date.now(), expiresAt: Date.now() + 60000, storageAllocationBytes: '0000000000000000', hash } as unknown as CreativeRequest
  const phase: CreativePhase = { schemaVersion: 1, protocol: 'creative-pilot-phase-v1', campaignId, requestHash: hash, revision: 0, parentHash: null, status: phaseStatus, intentHash: null, dispatchWire: null, responseHash: null, resolution: null, reason: null, hash: otherHash }
  value.requests.set(hash, request); value.phases.set(otherHash, phase)
  value.checkpoint.requests = [{ id: request.id, requestHash: hash, phaseHash: otherHash, phaseRevision: 0 }]
  value.checkpoint.budget.attempts = 1; value.checkpoint.status = 'running'
  return value
}
const panelSource = fs.readFileSync(new URL('../src/components/CreativePilotPanel.vue', import.meta.url), 'utf8')
const compiled = ts.transpileModule(compileScript(parse(panelSource).descriptor, { id: 'creative-ui', inlineTemplate: true }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
async function render(ui: ReturnType<typeof useCreativePilotLab>) {
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', compiled)((id: string) => {
    if (id === 'vue') return Vue
    if (id === '@/composables/useCreativePilotLab') return { useCreativePilotLab: () => ui }
    throw new Error(`unexpected_creative_panel_import:${id}`)
  }, exports)
  return renderToString(Vue.createSSRApp(exports.default!, { campaignId, selectedV4: true, ids: [campaignId] }))
}
/** Import substitution for route ownership only, not native or source validation. */
function routeFixture() {
  let raw: string | null = null, selected = campaignId, legacyFailure = false, legacyReads = 0
  const reads: Array<Promise<Map<string, string | null>>> = []
  const source = fs.readFileSync(new URL('../src/composables/useCreativePilotLab.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {} as { createCreativePilotLegacyRouter: typeof createCreativePilotLegacyRouter }
  const engine = { async list() { return [campaignId] }, async inspect() { legacyReads++; if (legacyFailure) throw new Error('legacy_schema_refusal'); return null } }
  new Function('require', 'exports', js)((name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/services/writerCampaign/protocol') return Protocol
    if (name === '@/services/writerCampaign/creativePilotEngine') return { createCreativePilotEngine }
    if (name === './creativePilotHost') return Hosts
    if (name === '@/services/writerCampaign/engine') return { createOfflineCampaignEngine: () => engine }
    if (name === '@/services/blobStore') return { idbGetMany: async () => reads.shift() ?? new Map([[campaignKeys.head(campaignId), raw]]) }
    if (name === '@/services/writerCampaign/store') return { campaignKeys }
    throw new Error(`unexpected_router_import:${name}`)
  }, exports)
  const router = exports.createCreativePilotLegacyRouter({ currentId: () => selected })
  return { router, legacyReads: () => legacyReads, setRaw(value: string | null) { raw = value }, failLegacy() { legacyFailure = true },
    select(value: string) { selected = value; router.reset() }, hold() { const gate = deferred<Map<string, string | null>>(); reads.push(gate.promise); return gate } }
}
/** Playwright's polling contract checks predicate truthiness synchronously.
 * This page double tests driver synchronization only, not App/native acceptance. */
function appWaitFixture(timeout = false) {
  const state = { held: false, activeRepositoryOperations: 1, activeIoOperations: 1, pendingRequestOutcomes: 1, readCalls: 0 }
  const module = { observeCreativeIoHold: () => ({ ...state }) }
  let poll: () => void = () => {}, polls = 0, disposed = 0
  const page = {
    async evaluateHandle(_action: unknown, url: string) {
      assert.equal(url, 'controlled-helper'); return { dispose: async () => { disposed++ } }
    },
    async waitForFunction(predicate: (value: { helper: typeof module; state: string }) => unknown, value: { state: string }, options: { timeout: number }) {
      assert.equal(options.timeout, 65000)
      if (timeout) throw Object.assign(new Error('controlled_wait_timeout'), { name: 'TimeoutError' })
      return new Promise(resolve => {
        poll = () => {
          const success = predicate({ helper: module, state: value.state }); polls++
          // A Promise would be truthy before its boolean resolves: reject that
          // exact regression rather than making this double await predicates.
          assert.equal(typeof success, 'boolean')
          if (success) resolve(success)
        }
        poll()
      })
    },
  } as unknown as Page
  return { page, state, poll: () => poll(), polls: () => polls, disposed: () => disposed }
}
async function appWaitControls() {
  // Reproduce why the old async predicate returned before a hold was entered.
  const oldResult = (async () => false)()
  assert.equal(Boolean(oldResult), true); assert.equal(await oldResult, false)
  const held = appWaitFixture(); let heldDone = false
  const holding = waitForCreativeIoState(held.page, 'controlled-helper', 'held').then(() => { heldDone = true })
  await flush(); assert.equal(heldDone, false); assert.equal(held.polls(), 1)
  // Three completed reads do not themselves prove the fourth-read hold.
  held.state.readCalls = 3; held.poll(); await flush(); assert.equal(heldDone, false)
  held.state.held = true; held.poll(); await holding
  assert.equal(heldDone, true); assert.equal(held.disposed(), 1); appWaitCases++
  const drained = appWaitFixture(); let drainDone = false
  const draining = waitForCreativeIoState(drained.page, 'controlled-helper', 'drained').then(() => { drainDone = true })
  await flush(); assert.equal(drainDone, false)
  drained.state.activeRepositoryOperations = 0; drained.poll(); await flush(); assert.equal(drainDone, false)
  drained.state.activeIoOperations = 0; drained.poll(); await flush(); assert.equal(drainDone, false)
  drained.state.pendingRequestOutcomes = 0; drained.state.held = true; drained.poll(); await flush(); assert.equal(drainDone, false)
  drained.state.held = false; drained.poll(); await draining
  assert.equal(drainDone, true); assert.equal(drained.disposed(), 1); appWaitCases++
  const timed = appWaitFixture(true)
  await assert.rejects(waitForCreativeIoState(timed.page, 'controlled-helper', 'held'), { name: 'TimeoutError', message: 'controlled_wait_timeout' })
  assert.equal(timed.disposed(), 1); appWaitCases++
  for (const path of ['./lib/creative-pilot-browser.ts', './browser-creative-pilot.mjs']) {
    assert.doesNotMatch(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), /waitForFunction\(async\b/)
  }
}
try {
  if (!process.argv.includes('--observer-only')) await appWaitControls()
  await test('observer_is_detached_exception_isolated_and_not_presentation_authority', async () => {
    const observed: Readonly<CreativeProgressEvent>[] = []
    const f = fixture(false, event => { observed.push(event); assert.ok(Object.isFrozen(event)); assert.equal(Reflect.set(event, 'acceptedTasks', 99), false); throw new Error('observer_failure') })
    await f.ready(); await f.grant(); const gate = f.holdRun(), pending = f.ui.start()
    f.emit({ ownerId: 1 }); f.emit({ ownerId: 1, kind: 'accepted', acceptedTasks: 1 })
    assert.equal(f.ui.acceptedTasks.value, 1); assert.equal(f.calls.start, 1)
    f.emit({ ownerId: 2, campaignId: 'foreign-campaign', kind: 'verifying' })
    assert.equal(f.ui.progress.value!.ownerId, 1); assert.equal(observed.length, 3)
    f.engine.stop = () => { f.calls.stop++; f.emit({ ownerId: 1, kind: 'stopped' }) }
    f.ui.dispose(); assert.equal(observed.at(-1)!.kind, 'stopped')
    const count = observed.length; f.emit({ kind: 'accepted', acceptedTasks: 9 }); assert.equal(observed.length, count)
    gate.resolve(f.record()); assert.equal(await pending, false); assert.equal(f.ui.progress.value, null)
    const asyncFailure = fixture(false, async () => { throw new Error('asynchronous_observer_failure') })
    asyncFailure.emit({ kind: 'verifying' }); await flush()
    assert.equal(asyncFailure.ui.progress.value, null); assert.equal(asyncFailure.calls.start, 0); asyncFailure.ui.dispose()
  })
  await test('route_v4_only_probes_then_requires_full_panel_inspection', async () => {
    const f = routeFixture(); f.setRaw(seed.rawHead)
    assert.equal(await f.router.engine.inspect(campaignId), null); assert.equal(f.router.version.value, 4); assert.equal(f.legacyReads(), 0)
    f.router.dispose()
  })
  await test('route_v3_keeps_producer_panel_on_expected_legacy_refusal', async () => {
    const f = routeFixture(); f.setRaw(JSON.stringify({ schemaVersion: 3 })); f.failLegacy()
    await assert.rejects(() => f.router.engine.inspect(campaignId), /legacy_schema_refusal/)
    assert.equal(f.router.version.value, 'legacy'); assert.equal(f.router.error.value, ''); assert.equal(f.legacyReads(), 1); f.router.dispose()
  })
  await test('route_corrupt_and_future_heads_are_not_empty_campaigns', async () => {
    for (const [raw, code] of [['{', 'corrupt_head'], [JSON.stringify({ schemaVersion: 4 }), 'corrupt_head'], [JSON.stringify({ schemaVersion: 5 }), 'unsupported_head_version']]) {
      const f = routeFixture(); f.setRaw(raw!); await assert.rejects(() => f.router.engine.inspect(campaignId))
      assert.equal(f.router.version.value, 'unknown'); assert.equal(f.router.error.value, code); assert.equal(f.legacyReads(), 0); f.router.dispose()
    }
  })
  await test('route_late_probe_loses_selection_authority', async () => {
    const f = routeFixture(), gate = f.hold(), pending = f.router.engine.inspect(campaignId)
    f.select('another-campaign'); gate.resolve(new Map([[campaignKeys.head(campaignId), seed.rawHead]])); await pending
    assert.equal(f.router.version.value, 'unknown'); assert.equal(f.legacyReads(), 0); f.router.dispose()
  })
  await test('default_app_repository_injection_never_grants_transport', async () => {
    const disk = memory(), selected = Vue.ref(false), id = Vue.ref('')
    const prior = Object.getOwnPropertyDescriptor(globalThis, '__WRITER_CAMPAIGN_BUILD_IDENTITY__')
    Object.defineProperty(globalThis, '__WRITER_CAMPAIGN_BUILD_IDENTITY__', { configurable: true, value: runtime })
    try {
      const app = Vue.createApp({ render: () => null }); app.provide(creativePilotRepositoryKey, disk.repository)
      const ui = app.runWithContext(() => useCreativePilotLab({ campaignId: id, selectedV4: selected, newId: () => 'ui-real-default', onCreated(value) { id.value = value; selected.value = true } })); views.push(ui)
      ui.edit('language', 'en'); ui.edit('premise', draft.premise); ui.edit('constraints', JSON.stringify(draft.constraints))
      assert.equal(await ui.prepare(), true); await flush(); await ui.refresh(); assert.equal(ui.snapshot.value?.candidate.brief.premise, draft.premise)
      assert.ok(disk.writes() > 0); assert.equal(await ui.dryPrepare(), true)
      assert.equal(ui.preview.value?.readiness, 'unconfigured'); ui.consent.value = true
      assert.equal(await ui.start(), false); assert.equal(ui.snapshot.value!.checkpoint.budget.attempts, 0)
      const prompt = JSON.parse(ui.preview.value!.prepared.wire.prompt)
      assert.equal(prompt.brief.premise, draft.premise); assert.deepEqual(prompt.brief.constraints, draft.constraints)
    } finally { if (prior) Object.defineProperty(globalThis, '__WRITER_CAMPAIGN_BUILD_IDENTITY__', prior); else Reflect.deleteProperty(globalThis, '__WRITER_CAMPAIGN_BUILD_IDENTITY__') }
  })
  await test('selection_and_refresh_are_inspection_only', async () => {
    const f = fixture(); assert.equal(f.calls.inspect + f.calls.prepare + f.calls.start, 0); await f.ready(); await f.ui.refresh()
    assert.equal(f.calls.prepare + f.calls.start + f.calls.resume + f.calls.resolve, 0)
  })
  await test('arbitrary_brief_prepare_preserves_text_without_dispatch', async () => {
    const f = fixture(); f.ui.edit('language', 'en'); f.ui.edit('premise', draft.premise); f.ui.edit('constraints', JSON.stringify(draft.constraints))
    assert.equal(await f.ui.prepare(), true); assert.deepEqual(f.record().candidate.brief, draft)
    assert.equal(f.calls.prepare, 1); assert.equal(f.calls.start + f.calls.dry, 0)
  })
  for (const [id, premise, constraints] of [
    ['empty', '', '[]'], ['invalid_json', 'text', '{'], ['non_array', 'text', '{}'], ['non_string', 'text', '[2]'],
    ['blank_constraint', 'text', '["  "]'], ['too_many_constraints', 'text', JSON.stringify(Array(9).fill('x'))],
    ['scalar_invalid', '\ud800', '[]'], ['utf16_limit', 'x'.repeat(1025), '[]'],
  ]) await test(`invalid_brief_${id}_has_no_write`, async () => {
    const f = fixture(); f.ui.edit('premise', premise!); f.ui.edit('constraints', constraints!); assert.equal(await f.ui.prepare(), false)
    assert.equal(f.calls.prepare, 0); assert.equal(f.ui.error.value, 'input_invalid')
  })
  await test('start_requires_fresh_preview_and_explicit_consent', async () => {
    const f = fixture(); await f.ready(); assert.equal(await f.ui.start(), false); await f.ui.dryPrepare()
    assert.equal(await f.ui.start(), false); f.ui.consent.value = true; assert.equal(await f.ui.start(), true)
    assert.equal(f.calls.start, 1); assert.equal(f.ui.preview.value, null); assert.equal(f.ui.consent.value, false)
    assert.equal(f.command()!.expectedRawHead, seed.rawHead); assert.equal(f.command()!.expectedCandidateHash, seed.candidate.hash)
  })
  await test('uncommitted_brief_cannot_silently_run_old_candidate', async () => {
    const f = fixture(); await f.ready(); await f.grant(); f.ui.edit('premise', 'A genuinely different brief.')
    assert.equal(f.ui.preview.value, null); assert.equal(f.ui.consent.value, false); assert.equal(await f.ui.dryPrepare(), false)
    assert.equal(await f.ui.start(), false); assert.equal(await f.ui.previewReplacement(), true); assert.equal(await f.ui.replace(), true)
    assert.equal(f.calls.replace, 1); assert.equal(f.record().candidate.brief.premise, 'A genuinely different brief.'); assert.equal(f.ui.canReplace.value, false)
  })
  await test('replacement_preview_is_revoked_by_second_edit', async () => {
    const f = fixture(); await f.ready(); f.ui.edit('premise', 'new brief'); await f.ui.previewReplacement(); assert.ok(f.ui.replacementPreview.value)
    f.ui.edit('premise', 'newer brief'); assert.equal(await f.ui.replace(), false); assert.equal(f.calls.replace, 0)
  })
  await test('replacement_language_is_immutable', async () => {
    const f = fixture(); await f.ready(); assert.equal(f.ui.edit('language', 'zh'), false); assert.equal(f.ui.language.value, 'en')
  })
  await test('any_reservation_refuses_replacement_and_uses_resume', async () => {
    const f = fixture(); f.setRecord(withOpen('reserved')); await f.ready(); assert.equal(f.ui.canReplace.value, false)
    assert.equal(f.ui.edit('premise', 'not admitted'), false); await f.grant(); assert.equal(f.ui.canStart.value, false); assert.equal(f.ui.canResume.value, true)
    assert.equal(await f.ui.resume(), true); assert.equal(f.calls.resume, 1); assert.equal(f.calls.start, 0)
  })
  await test('duplicate_start_has_one_engine_action', async () => {
    const f = fixture(); await f.ready(); await f.grant(); const gate = f.holdRun(), pending = f.ui.start()
    assert.equal(await f.ui.start(), false); assert.equal(f.calls.start, 1); gate.resolve(f.record()); assert.equal(await pending, true)
  })
  await test('stop_discards_late_completion_and_requires_reinspection', async () => {
    const f = fixture(); await f.ready(); await f.grant(); const gate = f.holdRun(), pending = f.ui.start(); f.ui.stop()
    gate.resolve(f.record()); assert.equal(await pending, false); assert.equal(f.ui.notice.value, 'stopped'); assert.equal(f.ui.canDryPrepare.value, false)
    assert.equal(f.ui.canCancel.value, false); await f.ui.refresh(); assert.equal(f.ui.canDryPrepare.value, true); assert.equal(f.ui.consent.value, false)
  })
  await test('selection_discards_late_run_and_stage_events', async () => {
    const f = fixture(); await f.ready(); await f.grant(); const gate = f.holdRun(), pending = f.ui.start()
    f.id.value = 'another-campaign'; f.selected.value = false; f.emit({ kind: 'accepted', acceptedTasks: 9 }); gate.resolve(f.record())
    assert.equal(await pending, false); assert.equal(f.ui.snapshot.value, null); assert.equal(f.ui.progress.value, null); assert.equal(f.ui.premise.value, '')
  })
  await test('old_read_cannot_restore_selection', async () => {
    const f = fixture(); await f.ready(); const gate = f.holdRead(), pending = f.ui.refresh(); f.id.value = 'another-campaign'; f.selected.value = false
    gate.resolve(f.record()); assert.equal(await pending, false); assert.equal(f.ui.snapshot.value, null)
  })
  await test('old_dry_preview_cannot_restore_after_stop', async () => {
    const f = fixture(); await f.ready(); const gate = f.holdDry(), pending = f.ui.dryPrepare(); f.ui.stop()
    gate.resolve({ campaignId, rawHead: seed.rawHead, candidateHash: seed.candidate.hash, prepared: seedInput, readiness: 'unconfigured', adapter: null })
    assert.equal(await pending, false); assert.equal(f.ui.preview.value, null)
  })
  await test('external_busy_disables_all_mutating_actions', async () => {
    const f = fixture(); await f.ready(); await f.grant(); f.externalBusy.value = true
    assert.equal(await f.ui.start(), false); assert.equal(await f.ui.cancel(), false); assert.equal(f.ui.canEdit.value, false)
  })
  await test('per_stage_owner_progress_rejects_late_prior_owners', async () => {
    const f = fixture(); await f.ready(); await f.grant(); const gate = f.holdRun(), pending = f.ui.start()
    f.emit({ ownerId: 1, kind: 'reserved' }); assert.equal(f.ui.progress.value, null)
    f.emit({ ownerId: 1 }); f.emit({ ownerId: 1, kind: 'accepted', acceptedTasks: 1 }); assert.equal(f.ui.acceptedTasks.value, 1)
    f.emit({ ownerId: 2, taskId: 'characters' }); f.emit({ ownerId: 2, kind: 'accepted', acceptedTasks: 2 }); assert.equal(f.ui.acceptedTasks.value, 2)
    f.emit({ ownerId: 1, kind: 'verifying' }); f.emit({ ownerId: 1, kind: 'accepted', acceptedTasks: 9 }); assert.equal(f.ui.acceptedTasks.value, 2)
    f.emit({ ownerId: 3, campaignId: 'foreign-campaign', kind: 'verifying' }); assert.equal(f.ui.progress.value!.ownerId, 2)
    gate.resolve(f.record()); await pending
  })
  for (const phase of ['dispatch_intent', 'outcome_unknown'] as const) await test(`${phase}_blocks_replay_and_local_resolution`, async () => {
    const f = fixture(); f.setRecord(withOpen(phase)); await f.ready(); assert.equal(f.ui.unknownCount.value, 1)
    assert.equal(await f.ui.dryPrepare(), false); assert.equal(await f.ui.start(), false); assert.equal(await f.ui.resume(), false)
    assert.equal(await f.ui.resolve(), false); assert.equal(await f.ui.closeWithoutPublication(), false)
    assert.match(await render(f.ui), /禁止重新调用/)
  })
  for (const close of [false, true]) await test(`retained_local_${close ? 'close' : 'resolve'}_never_calls_run`, async () => {
    const f = fixture(); f.setRecord(withOpen('response_retained')); await f.ready()
    assert.equal(await (close ? f.ui.closeWithoutPublication() : f.ui.resolve()), true)
    assert.equal(f.calls.resolve, 1); assert.equal(f.calls.start + f.calls.resume, 0)
    assert.equal((f.command() as CreativeHeadCommand & { disposition: string }).disposition, close ? 'accounting_only' : 'publish_if_valid')
  })
  await test('safe_error_does_not_render_provider_message', async () => {
    const f = fixture(); await f.ready(); const gate = f.holdDry(), pending = f.ui.dryPrepare()
    gate.reject({ code: 'configuration_changed', message: 'secret-provider-text' }); assert.equal(await pending, false)
    assert.equal(f.ui.error.value, 'configuration_changed'); assert.doesNotMatch(await render(f.ui), /secret-provider-text/)
  })
  await test('retained_text_json_and_compiled_artifact_are_separate_escaped_readouts', async () => {
    const f = fixture(), value = withOpen('response_retained'), text = '<script>raw & untrusted</script>\ud800'
    value.phases.get(otherHash)!.responseHash = hash
    value.responses.set(hash, { schemaVersion: 1, protocol: 'creative-pilot-response-v1', campaignId, requestHash: hash, intentHash: otherHash, hash,
      evidenceId: 'presentation-only', textJson: JSON.stringify(text), textJsonHash: otherHash, textUtf16: text.length, scalarMetrics: null,
      finishReason: 'length', contentEvidence: { stepCount: 1, anomalies: [] }, reportedModel: { status: 'matched', value: 'synthetic' },
      usage: { status: 'partial', provenance: 'synthetic_control', inputTokens: null, outputTokens: 0, reasoningTokens: null } })
    const artifact: CreativeArtifact = { schemaVersion: 1, protocol: 'creative-pilot-artifact-v1', campaignId, candidateHash: value.candidate.hash, taskId: 'outline', taskRevision: 0, revision: 0, kind: 'outline', dependencies: [], requestHash: hash, responseHash: hash,
      compilerVersion: 'creative-plan-compiler-v1', promptVersion: 'creative-pilot-prompt-v1', hash: otherHash,
      text: '<img src=x onerror=alert(1)>compiled-not-reviewed', raw: { hash, utf8Bytes: 1, utf16Units: 1, scalars: 1 }, canonical: { hash, utf8Bytes: 1, utf16Units: 1, scalars: 1 }, catalogRoot: hash, semanticStatus: 'not_reviewed' }
    value.artifacts = new Map([...value.artifacts, [otherHash, structuredClone(artifact)]]); value.checkpoint.tasks[0]!.artifactHash = otherHash
    f.setRecord(value); await f.ready(); const html = await render(f.ui)
    assert.match(html, /&lt;script&gt;raw &amp; untrusted&lt;\/script&gt;/); assert.match(html, /\\ud800/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;compiled-not-reviewed/)
    assert.doesNotMatch(html, /<script>raw|<img src=x/); assert.match(html, /creative-pilot-response/); assert.match(html, /creative-pilot-artifact/)
    assert.equal(f.ui.observedUsage.value.input, null); assert.equal(f.ui.observedUsage.value.output, 0); assert.equal(f.ui.observedUsage.value.reasoning, null)
  })
  await test('terminal_completed_and_cancelled_do_not_offer_cancel', async () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const f = fixture(); f.record().checkpoint.status = status; await f.ready(); assert.equal(f.ui.canCancel.value, false); assert.equal(await f.ui.cancel(), false)
    }
  })
  await test('escaped_exact_input_and_honest_accounting_presentation', async () => {
    const f = fixture(); await f.ready(); await f.ui.dryPrepare(); const html = await render(f.ui)
    assert.doesNotMatch(html, /<script>not executable<\/script>/); assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/)
    for (const phrase of ['NOT_RUN', 'not_enforced_offline_control', 'Not a bill', 'unknown', '36,864']) {
      assert.ok(html.includes(phrase), phrase)
    }
    assert.match(html, /creative-pilot-exact-input/); assert.match(html, /creative-pilot-source-inventory/)
    assert.doesNotMatch(panelSource, /v-html|localStorage|indexedDB|fetch\(/)
    const view = fs.readFileSync(new URL('../src/views/CampaignLab.vue', import.meta.url), 'utf8')
    assert.match(view, /CreativePilotPanel/); assert.match(view, /createCreativePilotLegacyRouter/); assert.doesNotMatch(view, /localStorage|indexedDB|idbGetMany|fetch\(/)
    const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(main, /creative-pilot-app|installCreativePilotApp|creativePilotHostKey|creativePilotRepositoryKey/)
  })
  await test('dispose_revokes_inflight_owner_and_unsubscribes', async () => {
    const f = fixture(); await f.ready(); await f.grant(); const gate = f.holdRun(), pending = f.ui.start(); f.ui.dispose()
    f.emit({ kind: 'accepted', acceptedTasks: 9 }); gate.resolve(f.record()); assert.equal(await pending, false)
    assert.equal(f.ui.progress.value, null); assert.equal(f.calls.dispose, 1); assert.equal(await f.ui.refresh(), false)
  })
  console.log(`Creative pilot UI: ${cases.length} presentation/ownership cases passed. Real default-engine injected-memory Prepare/dry-preview included; actual App/native/SDK/literary acceptance NOT_RUN here.`)
  console.log(`Creative App wait synchronization: ${appWaitCases} browser-free polling controls passed (separate from presentation and actual-App denominators).`)
} finally { for (const view of views) view.dispose() }
