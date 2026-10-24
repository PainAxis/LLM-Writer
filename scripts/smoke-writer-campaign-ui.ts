/** Focused presentation/lifecycle tests. Synthetic facade here is NOT persistence evidence.
 * Real engine/repository coverage is separate; actual SFC setup/render/unmount executes below. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { useWriterCampaign, type CampaignLabEngine } from '../src/composables/useWriterCampaign'
import type { CampaignSnapshot } from '../src/types/writerCampaign'

async function runCampaignUiSmoke() {
const hash = 'a'.repeat(64)
const zero = { attempts: 0, inputBytes: 0, inputUtf16: 0, outputTokens: 0, reasoningTokens: 0,
  responseBytes: 0, activeMs: 0, serializedBytes: 0, storageReservedBytes: 0, artifacts: 0, operations: 0 }
const makeSnapshot = (id: string, status: CampaignSnapshot['checkpoint']['status'] = 'prepared'): CampaignSnapshot => ({
  manifest: { schemaVersion: 1, protocolVersion: 'campaign-v1', campaignId: id, candidateId: 'candidate-1', language: 'zh',
    bodyTarget: { unit: 'unicode_scalar', characters: 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1',
    fixtureVersion: 'ui-presentation-only', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: 'ui-test',
    source: { commit: '0'.repeat(40), tree: '0'.repeat(40) }, createdAt: 1, expiresAt: 1_000_000,
    maxRepairRounds: 0, maxProviderRetries: 0, tasks: [{ id: 'outline', kind: 'outline', chapterOrdinal: null, dependsOn: [] }],
    budget: { ...zero, attempts: 5, serializedBytes: 1_000_000 }, recoveryReserveBytes: 1000, hash },
  head: { schemaVersion: 1, campaignId: id, sequence: 1, manifestHash: hash, checkpointHash: hash, executionEpoch: 1, status, receiptId: 'create' },
  checkpoint: { schemaVersion: 1, campaignId: id, sequence: 1, manifestHash: hash, previousHash: null, operationId: 'create', bodyCharacters: 0,
    hash, status, reason: null, executionEpoch: 1, candidateId: 'candidate-1', tasks: [{ taskId: 'outline', revision: 1, status: 'pending', artifact: null, priorArtifact: null, request: null }],
    budget: { ...zero }, lastWallTime: 1 },
  receipt: { schemaVersion: 1, campaignId: id, operationId: 'create', kind: 'create', businessDigest: hash, expectedSequence: null,
    sequence: 1, executionEpoch: 1, manifestHash: hash, checkpointHash: hash, artifactHashes: [], requestHashes: [], serializedBytes: 1, hash },
  artifacts: new Map(), requests: new Map(), rawHead: 'presentation-only',
})
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); await Vue.nextTick() }
function fixture() {
  const records = new Map<string, CampaignSnapshot>()
  const calls = { list: 0, inspect: 0, prepare: 0, step: 0, pause: 0, resume: 0, cancel: 0, recover: 0, stop: 0 }
  let readGate: ReturnType<typeof deferred<CampaignSnapshot | null>> | null = null
  let stepGate: ReturnType<typeof deferred<void>> | null = null
  let prepareGate: ReturnType<typeof deferred<void>> | null = null
  let failCancel = false
  const engine: CampaignLabEngine = {
    async list() { calls.list++; return [...records.keys()] },
    async inspect(id) { calls.inspect++; const gate = readGate; readGate = null; return gate ? gate.promise : records.get(id) ?? null },
    async prepare({ campaignId }) { calls.prepare++; if (prepareGate) await prepareGate.promise; records.set(campaignId, makeSnapshot(campaignId)) },
    async step(id) { calls.step++; if (stepGate) await stepGate.promise; else records.set(id, makeSnapshot(id, 'running')) },
    async pause(id) { calls.pause++; records.set(id, makeSnapshot(id, 'paused')) },
    async resume(id) { calls.resume++; records.set(id, makeSnapshot(id, 'running')) },
    async cancel(id) { calls.cancel++; if (failCancel) throw new Error('private fixture text must never reach UI'); records.set(id, makeSnapshot(id, 'cancelled')) },
    async recoverSaveOnly(id) { calls.recover++; records.set(id, makeSnapshot(id, 'running')) },
    stopLocal() { calls.stop++ },
  }
  const ui = useWriterCampaign({ engine, newId: () => 'ui-created' })
  return { ui, engine, calls, records, holdRead() { return readGate = deferred() },
    holdStep() { return stepGate = deferred() }, holdPrepare() { return prepareGate = deferred() },
    rejectCancel() { failCancel = true }, async ready() { await ui.create('zh'); assert.equal(ui.canStep.value, true) } }
}

{
  const f = fixture()
  assert.deepEqual(f.calls, { list: 0, inspect: 0, prepare: 0, step: 0, pause: 0, resume: 0, cancel: 0, recover: 0, stop: 0 })
  await f.ui.refresh()
  assert.equal(f.calls.step, 0); assert.equal(f.calls.prepare, 0); assert.equal(f.ui.selectedId.value, '')
  await f.ready(); assert.equal(f.calls.step, 0)
  await f.ui.refresh(); assert.equal(f.calls.step, 0)
  f.ui.dispose()
}
{
  const f = fixture(), gate = f.holdPrepare()
  const pending = f.ui.create('en'); assert.equal(await f.ui.create('zh'), false)
  gate.resolve(); await pending; assert.equal(f.calls.prepare, 1); assert.equal(f.calls.step, 0)
  f.ui.dispose()
}
{
  const f = fixture(); await f.ready(); const gate = f.holdStep()
  const pending = f.ui.step(); assert.equal(await f.ui.step(), false); assert.equal(f.calls.step, 1)
  gate.resolve(); const stop = f.ui.cancel() // Resolving does not run awaited continuation before sync cancellation.
  await Promise.all([pending, stop]); assert.equal(f.ui.status.value, 'cancelled'); assert.equal(f.ui.persistentOutcome.value, 'confirmed')
  assert.equal(f.ui.canStep.value, false); assert.equal(f.calls.cancel, 1)
  f.ui.dispose()
}
{
  const f = fixture(); await f.ready(); const gate = f.holdStep()
  const pending = f.ui.step(); gate.resolve(); f.ui.dispose(); await pending
  assert.equal(f.ui.snapshot.value?.checkpoint.status, 'prepared', 'Unmounted continuation cannot publish even after resolve')
  assert.ok(f.calls.stop >= 2)
}
{
  const f = fixture(); await f.ready(); f.records.set('second', makeSnapshot('second', 'paused')); await f.ui.refresh()
  const gate = f.holdRead(), pending = f.ui.refresh()
  await flush(); const selected = f.ui.select('second'); gate.resolve(makeSnapshot('ui-created', 'completed'))
  await Promise.all([pending, selected]); assert.equal(f.ui.selectedId.value, 'second'); assert.equal(f.ui.status.value, 'paused')
  f.ui.dispose()
}
{
  const f = fixture(); await f.ready(); f.rejectCancel()
  assert.equal(await f.ui.cancel(), false); assert.equal(f.ui.locallyStopped.value, true)
  assert.equal(f.ui.persistentOutcome.value, 'unconfirmed'); assert.equal(f.ui.canStep.value, false)
  assert.match(f.ui.error.value, /持久状态未确认/); assert.doesNotMatch(f.ui.error.value, /private fixture/)
  await f.ui.refresh(); assert.equal(f.ui.persistentOutcome.value, 'unconfirmed'); assert.equal(f.ui.canStep.value, false)
  f.ui.dispose()
}
{
  const f = fixture(); await f.ready(); await f.ui.pause(); assert.equal(f.ui.status.value, 'paused')
  assert.equal(f.ui.persistentOutcome.value, 'confirmed'); assert.equal(f.calls.step, 0)
  await f.ui.resume(); assert.equal(f.ui.status.value, 'running'); assert.equal(f.calls.step, 0)
  const unknown = makeSnapshot('ui-created', 'blocked'); unknown.checkpoint.tasks[0].status = 'outcome_unknown'
  f.records.set('ui-created', unknown); await f.ui.refresh()
  assert.equal(f.ui.unresolved.value, true); assert.equal(await f.ui.step(), false); assert.equal(await f.ui.resume(), false)
  f.ui.dispose()
}
{
  const f = fixture(); await f.ready()
  const retained = makeSnapshot('ui-created', 'blocked'); retained.checkpoint.tasks[0].status = 'response_retained'
  f.records.set('ui-created', retained); await f.ui.refresh()
  assert.equal(f.ui.canStep.value, false); assert.equal(f.ui.canSaveOnly.value, true)
  await f.ui.saveOnly(); assert.equal(f.calls.recover, 1); assert.equal(f.calls.step, 0)
  f.ui.dispose()
}


// Actual production facade and validating repository; only the atomic IO transport
// is an in-memory test port. Real browser durability is deliberately not claimed.
{
  const disk = new Map<string, string>()
  const repository = createCampaignRepository({
    async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(entry => (disk.get(entry.key) ?? null) !== entry.expectedValue)) return false
      for (const entry of entries) disk.set(entry.key, entry.value)
      return true
    },
  })
  let dispatches = 0
  const engine = createOfflineCampaignEngine({ repository, identity: { runtimeIdentity: 'controlled-ui-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }, fixture: { onDispatch() { dispatches++ } } })
  const ui = useWriterCampaign({ engine, newId: () => 'ui-real-runtime' })
  assert.equal(await ui.create('zh'), true); assert.equal(dispatches, 0)
  await ui.step(); assert.equal(ui.completedTasks.value, 1); assert.equal(dispatches, 1)
  await ui.pause(); assert.equal(ui.status.value, 'paused'); assert.equal(ui.persistentOutcome.value, 'confirmed')
  await ui.resume(); assert.equal(dispatches, 1)
  await ui.cancel(); assert.equal(ui.status.value, 'cancelled'); assert.equal(await ui.step(), false)
  const bytes = [...disk.entries()]
  await ui.refresh(); assert.deepEqual([...disk.entries()], bytes)
  ui.dispose()
}

const source = fs.readFileSync(fileURLToPath(new URL('../src/views/CampaignLab.vue', import.meta.url)), 'utf8')
const compiled = ts.transpileModule(compileScript(parse(source).descriptor, { id: 'campaign-lab-ui', inlineTemplate: true }).content,
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function component(ui: ReturnType<typeof useWriterCampaign>) {
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', compiled)((id: string) => {
    if (id === 'vue') return Vue
    if (id === '@/composables/useWriterCampaign') return { useWriterCampaign: () => ui }
    throw new Error('Unexpected Campaign Lab import')
  }, exports)
  return exports.default!
}
{
  const f = fixture(); await f.ready()
  const artifact = { schemaVersion: 1 as const, campaignId: 'ui-created', candidateId: 'candidate-1', taskId: 'outline', taskRevision: 1,
    revision: 1, kind: 'outline' as const, dependencies: [], parentHash: null, text: '<script>not executable</script>&<b>plain text</b>',
    raw: { hash, utf8Bytes: 20, utf16Units: 20, scalars: 20 }, canonical: { hash, utf8Bytes: 20, utf16Units: 20, scalars: 20 }, semanticStatus: 'not_reviewed' as const, hash }
  f.ui.snapshot.value!.artifacts.set(hash, artifact)
  const html = await renderToString(Vue.createSSRApp(component(f.ui)))
  for (const id of ['lab', 'create-zh', 'create-en', 'refresh', 'status', 'task-progress', 'target-progress', 'acceptance', 'head', 'budgets', 'artifacts', 'receipts', 'step', 'pause', 'resume', 'cancel']) assert.ok(html.includes(`data-testid="campaign-${id}"`))
  assert.match(html, /离线持久化验证，非自主小说/); assert.match(html, /longformAcceptance: NOT_RUN/)
  assert.match(html, /普通 Writer 备份与恢复不包含/); assert.match(html, /&lt;script&gt;not executable/)
  assert.doesNotMatch(html, /<script>not executable/); assert.doesNotMatch(source, /v-html|localStorage|indexedDB|apiConfig|fetch\(/)
  f.ui.snapshot.value = makeSnapshot('ui-created', 'completed')
  const complete = await renderToString(Vue.createSSRApp(component(f.ui)))
  assert.match(complete, /fixture_complete/); assert.match(complete, /NOT_RUN/)
  assert.match(complete.match(/<button[^>]*data-testid="campaign-step"[^>]*>/)![0], /disabled/)
  f.ui.dispose()
}
{
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const f = fixture(), app = renderer.createApp(component(f.ui))
  app.mount({}); await flush(); assert.equal(f.calls.list, 1); assert.equal(f.calls.step, 0); assert.equal(f.calls.prepare, 0)
  app.unmount(); assert.equal(f.calls.stop, 1)
  assert.equal(await f.ui.create('zh'), false)
}

const routerSource = fs.readFileSync(fileURLToPath(new URL('../src/router/index.ts', import.meta.url)), 'utf8')
assert.doesNotMatch(routerSource, /import Dashboard from/)
assert.match(routerSource, /component: \(\) => import\('@\/views\/Dashboard.vue'\)/)
console.log('Campaign UI: lifecycle, no-auto-run, unknown/cancel publication fences and actual SFC checks passed. Persistence/browser acceptance is separate.')
}

try {
  await runCampaignUiSmoke()
} catch {
  // Assertion diagnostics may contain rendered HTML or artifact text. Never emit
  // raw actual/expected values, error messages or stacks into CI stdout/stderr.
  process.stderr.write('Campaign UI smoke: 1 suite failed (ui_boundary_assertion_failed).\n')
  process.exitCode = 1
}
